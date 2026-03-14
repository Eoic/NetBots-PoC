use std::sync::{Arc, Mutex};

use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::Json;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::compiler;
use crate::match_runner;
use crate::state::*;

#[derive(Serialize)]
pub struct CreateMatchResponse {
    pub match_id: String,
}

pub async fn create_match(State(state): State<AppState>) -> Json<CreateMatchResponse> {
    let match_id = Uuid::new_v4().to_string();
    let game_match = GameMatch {
        id: match_id.clone(),
        players: Vec::new(),
        status: MatchStatus::WaitingForPlayers,
        wasm_modules: vec![None, None],
        replay: None,
    };
    state
        .matches
        .insert(match_id.clone(), Arc::new(Mutex::new(game_match)));
    Json(CreateMatchResponse { match_id })
}

#[derive(Serialize)]
pub struct JoinMatchResponse {
    pub player_id: String,
    pub token: String,
    pub player_index: usize,
}

#[derive(Serialize)]
pub struct ErrorResponse {
    pub error: String,
}

pub async fn join_match(
    State(state): State<AppState>,
    Path(match_id): Path<String>,
) -> Result<Json<JoinMatchResponse>, (StatusCode, Json<ErrorResponse>)> {
    let game = state.matches.get(&match_id).ok_or((
        StatusCode::NOT_FOUND,
        Json(ErrorResponse {
            error: "Match not found".to_string(),
        }),
    ))?;

    let mut game = game.lock().unwrap();

    if game.players.len() >= 2 {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse {
                error: "Match is full".to_string(),
            }),
        ));
    }

    let player_id = Uuid::new_v4().to_string();
    let token = Uuid::new_v4().to_string();
    let player_index = game.players.len();

    game.players.push(Player {
        id: player_id.clone(),
        token: token.clone(),
    });

    Ok(Json(JoinMatchResponse {
        player_id,
        token,
        player_index,
    }))
}

#[derive(Deserialize)]
pub struct SubmitRequest {
    pub source: String,
    pub language: String,
    pub token: String,
}

#[derive(Serialize)]
pub struct SubmitResponse {
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub game_started: Option<bool>,
}

pub async fn submit_code(
    State(state): State<AppState>,
    Path(match_id): Path<String>,
    Json(req): Json<SubmitRequest>,
) -> Result<Json<SubmitResponse>, (StatusCode, Json<ErrorResponse>)> {
    // Find match and validate token
    let game_arc = state.matches.get(&match_id).ok_or((
        StatusCode::NOT_FOUND,
        Json(ErrorResponse {
            error: "Match not found".to_string(),
        }),
    ))?.clone();

    let player_index = {
        let game = game_arc.lock().unwrap();
        game.players
            .iter()
            .position(|p| p.token == req.token)
            .ok_or((
                StatusCode::UNAUTHORIZED,
                Json(ErrorResponse {
                    error: "Invalid token".to_string(),
                }),
            ))?
    };

    // Compile the source code
    let wasm_bytes = match compiler::compile(&req.source, &req.language).await {
        Ok(bytes) => bytes,
        Err(e) => {
            return Ok(Json(SubmitResponse {
                ok: false,
                error: Some(format!("Compilation failed: {}", e)),
                game_started: None,
            }));
        }
    };

    // Store compiled WASM and check if both players are ready
    let should_run = {
        let mut game = game_arc.lock().unwrap();
        game.wasm_modules[player_index] = Some(wasm_bytes);
        game.wasm_modules.iter().all(|m| m.is_some())
    };

    if should_run {
        // Both players submitted — run the simulation
        let wasm_modules: Vec<Vec<u8>> = {
            let game = game_arc.lock().unwrap();
            game.wasm_modules
                .iter()
                .map(|m| m.as_ref().unwrap().clone())
                .collect()
        };

        {
            let mut game = game_arc.lock().unwrap();
            game.status = MatchStatus::Running;
        }

        match match_runner::run_match(&wasm_modules) {
            Ok((replay, winner)) => {
                let mut game = game_arc.lock().unwrap();
                game.replay = Some(replay);
                game.status = MatchStatus::Finished { winner };
            }
            Err(e) => {
                let mut game = game_arc.lock().unwrap();
                game.status = MatchStatus::Error(format!("Simulation failed: {}", e));
            }
        }

        return Ok(Json(SubmitResponse {
            ok: true,
            error: None,
            game_started: Some(true),
        }));
    }

    Ok(Json(SubmitResponse {
        ok: true,
        error: None,
        game_started: Some(false),
    }))
}

#[derive(Serialize)]
pub struct MatchStatusResponse {
    pub status: MatchStatus,
    pub players: usize,
    pub has_replay: bool,
}

pub async fn match_status(
    State(state): State<AppState>,
    Path(match_id): Path<String>,
) -> Result<Json<MatchStatusResponse>, (StatusCode, Json<ErrorResponse>)> {
    let game_arc = state.matches.get(&match_id).ok_or((
        StatusCode::NOT_FOUND,
        Json(ErrorResponse {
            error: "Match not found".to_string(),
        }),
    ))?;

    let game = game_arc.lock().unwrap();
    Ok(Json(MatchStatusResponse {
        status: game.status.clone(),
        players: game.players.len(),
        has_replay: game.replay.is_some(),
    }))
}
