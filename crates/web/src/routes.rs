use askama::Template;
use axum::http::StatusCode;
use axum::response::{Html, Json};
use serde::{Deserialize, Serialize};

use engine::world::RobotConfig;

use crate::compiler;
use crate::match_runner;

#[derive(Template)]
#[template(path = "index.html")]
pub struct IndexTemplate;

pub async fn index() -> Html<String> {
    Html(IndexTemplate.render().unwrap())
}

#[derive(Deserialize)]
pub struct RunRequest {
    pub robots: Vec<RobotEntry>,
    pub max_ticks: Option<u32>,
}

#[derive(Deserialize)]
pub struct RobotEntry {
    pub name: String,
    pub source: String,
    pub team: u8,
    pub spawn: Option<SpawnPointRequest>,
}

#[derive(Deserialize)]
pub struct SpawnPointRequest {
    pub x: f64,
    pub y: f64,
    pub heading: Option<f64>,
}

#[derive(Serialize)]
pub struct RunResponse {
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub replay: Option<ReplayData>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub winner_team: Option<u8>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub total_ticks: Option<u32>,
    #[serde(default)]
    pub errors: Vec<RobotError>,
    #[serde(default)]
    pub logs: Vec<RobotLog>,
}

#[derive(Serialize)]
pub struct ReplayData {
    pub arena: ArenaInfo,
    pub robots: Vec<RobotInfo>,
    pub ticks: Vec<engine::world::TickSnapshot>,
}

#[derive(Serialize)]
pub struct ArenaInfo {
    pub width: f64,
    pub height: f64,
}

#[derive(Serialize)]
pub struct RobotInfo {
    pub name: String,
    pub team: u8,
}

#[derive(Serialize)]
pub struct RobotError {
    pub robot: String,
    pub error: String,
}

#[derive(Serialize)]
pub struct RobotLog {
    pub robot: String,
    pub messages: Vec<String>,
}

const MAX_ROBOTS: usize = 16;
const MAX_SOURCE_BYTES: usize = 64 * 1024; // 64 KB per robot
const MAX_ALLOWED_TICKS: u32 = 100_000;

fn error_response(status: StatusCode, msg: &str) -> (StatusCode, Json<RunResponse>) {
    (
        status,
        Json(RunResponse {
            ok: false,
            replay: None,
            winner_team: None,
            total_ticks: None,
            errors: vec![RobotError {
                robot: String::new(),
                error: msg.to_string(),
            }],
            logs: vec![],
        }),
    )
}

pub async fn run(Json(req): Json<RunRequest>) -> (StatusCode, Json<RunResponse>) {
    if req.robots.is_empty() {
        return error_response(StatusCode::BAD_REQUEST, "No robots provided");
    }

    if req.robots.len() > MAX_ROBOTS {
        return error_response(
            StatusCode::BAD_REQUEST,
            &format!("Too many robots (max {})", MAX_ROBOTS),
        );
    }

    for r in &req.robots {
        if r.source.len() > MAX_SOURCE_BYTES {
            return error_response(
                StatusCode::BAD_REQUEST,
                &format!(
                    "Source for '{}' exceeds {} KB limit",
                    r.name,
                    MAX_SOURCE_BYTES / 1024
                ),
            );
        }

        if let Some(spawn) = &r.spawn {
            if !spawn.x.is_finite() || !spawn.y.is_finite() {
                return error_response(
                    StatusCode::BAD_REQUEST,
                    &format!("Spawn for '{}' must be finite coordinates", r.name),
                );
            }

            if spawn.x < engine::world::ROBOT_RADIUS
                || spawn.x > engine::world::ARENA_WIDTH - engine::world::ROBOT_RADIUS
                || spawn.y < engine::world::ROBOT_RADIUS
                || spawn.y > engine::world::ARENA_HEIGHT - engine::world::ROBOT_RADIUS
            {
                return error_response(
                    StatusCode::BAD_REQUEST,
                    &format!("Spawn for '{}' is outside arena bounds", r.name),
                );
            }

            if let Some(heading) = spawn.heading {
                if !heading.is_finite() {
                    return error_response(
                        StatusCode::BAD_REQUEST,
                        &format!("Spawn heading for '{}' must be finite", r.name),
                    );
                }
            }
        }
    }

    let max_ticks = req.max_ticks.unwrap_or(engine::world::MAX_TICKS);
    if max_ticks == 0 {
        return error_response(StatusCode::BAD_REQUEST, "max_ticks must be at least 1");
    }
    if max_ticks > MAX_ALLOWED_TICKS {
        return error_response(
            StatusCode::BAD_REQUEST,
            &format!("max_ticks exceeds limit ({})", MAX_ALLOWED_TICKS),
        );
    }

    // Compile all robots concurrently
    let compile_futures: Vec<_> = req
        .robots
        .iter()
        .map(|r| {
            let source = r.source.clone();
            let name = r.name.clone();
            async move { (name, compiler::compile(&source).await) }
        })
        .collect();

    let results = futures::future::join_all(compile_futures).await;

    let mut wasm_modules = Vec::new();
    let mut errors = Vec::new();

    for (name, result) in results {
        match result {
            Ok(bytes) => wasm_modules.push(bytes),
            Err(e) => errors.push(RobotError {
                robot: name,
                error: e.to_string(),
            }),
        }
    }

    if !errors.is_empty() {
        return (
            StatusCode::OK,
            Json(RunResponse {
                ok: false,
                replay: None,
                winner_team: None,
                total_ticks: None,
                errors,
                logs: vec![],
            }),
        );
    }

    let configs: Vec<RobotConfig> = req
        .robots
        .iter()
        .map(|r| RobotConfig {
            name: r.name.clone(),
            team: r.team,
            spawn: r.spawn.as_ref().map(|spawn| engine::world::SpawnPoint {
                x: spawn.x,
                y: spawn.y,
                heading: spawn.heading.unwrap_or(if r.team == 0 { 0.0 } else { 180.0 }),
            }),
        })
        .collect();

    // Run simulation (blocking — use spawn_blocking)
    let result = tokio::task::spawn_blocking(move || {
        match_runner::run_match(&configs, &wasm_modules, max_ticks)
    })
    .await;

    match result {
        Ok(Ok(match_result)) => {
            let robots: Vec<RobotInfo> = req
                .robots
                .iter()
                .map(|r| RobotInfo {
                    name: r.name.clone(),
                    team: r.team,
                })
                .collect();

            let logs: Vec<RobotLog> = match_result
                .logs
                .into_iter()
                .filter(|(_, msgs)| !msgs.is_empty())
                .map(|(name, messages)| RobotLog {
                    robot: name,
                    messages,
                })
                .collect();

            (
                StatusCode::OK,
                Json(RunResponse {
                    ok: true,
                    replay: Some(ReplayData {
                        arena: ArenaInfo {
                            width: engine::world::ARENA_WIDTH,
                            height: engine::world::ARENA_HEIGHT,
                        },
                        robots,
                        ticks: match_result.replay,
                    }),
                    winner_team: match_result.winner_team,
                    total_ticks: Some(match_result.total_ticks),
                    errors: vec![],
                    logs,
                }),
            )
        }
        Ok(Err(e)) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(RunResponse {
                ok: false,
                replay: None,
                winner_team: None,
                total_ticks: None,
                errors: vec![RobotError {
                    robot: String::new(),
                    error: format!("Simulation error: {}", e),
                }],
                logs: vec![],
            }),
        ),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(RunResponse {
                ok: false,
                replay: None,
                winner_team: None,
                total_ticks: None,
                errors: vec![RobotError {
                    robot: String::new(),
                    error: format!("Task error: {}", e),
                }],
                logs: vec![],
            }),
        ),
    }
}
