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
}

#[derive(Deserialize)]
pub struct RobotEntry {
    pub name: String,
    pub source: String,
    pub team: u8,
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

pub async fn run(Json(req): Json<RunRequest>) -> (StatusCode, Json<RunResponse>) {
    if req.robots.is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(RunResponse {
                ok: false,
                replay: None,
                winner_team: None,
                total_ticks: None,
                errors: vec![RobotError {
                    robot: String::new(),
                    error: "No robots provided".to_string(),
                }],
                logs: vec![],
            }),
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
        })
        .collect();

    // Run simulation (blocking — use spawn_blocking)
    let result =
        tokio::task::spawn_blocking(move || match_runner::run_match(&configs, &wasm_modules))
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
