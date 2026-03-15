use askama::Template;
use axum::http::StatusCode;
use axum::response::{Html, Json};
use serde::{Deserialize, Serialize};

use engine::world::RobotConfig;

use crate::compiler;
use crate::match_runner;
use crate::validation;

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

pub fn error_response(status: StatusCode, msg: &str) -> (StatusCode, Json<RunResponse>) {
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
    let validated = match validation::validate_run_request(&req) {
        Ok(v) => v,
        Err(err) => return err,
    };

    let compile_futures: Vec<_> = validated
        .robots
        .iter()
        .map(|robot| {
            let source = robot.source.clone();
            let name = robot.name.clone();
            async move { (name, compiler::compile(&source).await) }
        })
        .collect();

    let results = futures::future::join_all(compile_futures).await;
    let mut wasm_modules = Vec::new();
    let mut errors = Vec::new();

    for (name, result) in results {
        match result {
            Ok(bytes) => wasm_modules.push(bytes),
            Err(error) => errors.push(RobotError {
                robot: name,
                error: format!("{:#}", error),
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

    let configs: Vec<RobotConfig> = validated
        .robots
        .iter()
        .map(|robot| RobotConfig {
            name: robot.name.clone(),
            team: robot.team,
            spawn: robot.spawn.clone(),
        })
        .collect();

    let max_ticks = validated.max_ticks;

    let result = tokio::task::spawn_blocking(move || {
        match_runner::run_match(&configs, &wasm_modules, max_ticks)
    })
    .await;

    match result {
        Ok(Ok(match_result)) => {
            let robots: Vec<RobotInfo> = validated
                .robots
                .iter()
                .map(|robot| RobotInfo {
                    name: robot.name.clone(),
                    team: robot.team,
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
        Ok(Err(error)) => error_response(
            StatusCode::INTERNAL_SERVER_ERROR,
            &format!("Simulation error: {:#}", error),
        ),
        Err(error) => error_response(
            StatusCode::INTERNAL_SERVER_ERROR,
            &format!("Task error: {}", error),
        ),
    }
}
