use std::sync::{Arc, Mutex};

use axum::extract::ws::{Message, WebSocket};
use axum::extract::{Path, State, WebSocketUpgrade};
use axum::response::Response;
use serde_json::json;

use engine::world::ARENA_WIDTH;
use engine::world::ARENA_HEIGHT;

use crate::state::*;

pub async fn ws_handler(
    ws: WebSocketUpgrade,
    State(state): State<AppState>,
    Path(match_id): Path<String>,
) -> Response {
    let game_arc = state.matches.get(&match_id).map(|g| g.clone());
    ws.on_upgrade(move |socket| handle_socket(socket, game_arc))
}

async fn handle_socket(mut socket: WebSocket, game_arc: Option<Arc<Mutex<GameMatch>>>) {
    let Some(game_arc) = game_arc else {
        let _ = socket
            .send(Message::Text(
                json!({"type": "error", "message": "Match not found"}).to_string().into(),
            ))
            .await;
        return;
    };

    // Wait for the replay to be available (poll every 100ms)
    loop {
        let status = {
            let game = game_arc.lock().unwrap();
            game.status.clone()
        };

        match status {
            MatchStatus::Finished { .. } | MatchStatus::Error(_) => break,
            _ => {
                tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;
            }
        }
    }

    let (replay, players_count, status) = {
        let game = game_arc.lock().unwrap();
        (
            game.replay.clone(),
            game.players.len(),
            game.status.clone(),
        )
    };

    if let MatchStatus::Error(ref e) = status {
        let _ = socket
            .send(Message::Text(
                json!({"type": "error", "message": e}).to_string().into(),
            ))
            .await;
        return;
    }

    // Send game_start
    let players_json: Vec<serde_json::Value> = (0..players_count)
        .map(|i| json!({"id": format!("p{}", i), "name": format!("Bot {}", (b'A' + i as u8) as char)}))
        .collect();

    let _ = socket
        .send(Message::Text(
            json!({
                "type": "game_start",
                "arena": {"width": ARENA_WIDTH, "height": ARENA_HEIGHT},
                "players": players_json
            })
            .to_string().into(),
        ))
        .await;

    // Send all tick snapshots as a batch
    if let Some(replay) = replay {
        let replay_json = serde_json::to_string(&replay).unwrap_or_default();
        let _ = socket
            .send(Message::Text(
                json!({
                    "type": "replay",
                    "ticks": serde_json::from_str::<serde_json::Value>(&replay_json).unwrap_or_default()
                })
                .to_string().into(),
            ))
            .await;

        // Send game_over
        if let MatchStatus::Finished { winner } = status {
            let _ = socket
                .send(Message::Text(
                    json!({
                        "type": "game_over",
                        "winner": winner,
                        "total_ticks": replay.len()
                    })
                    .to_string().into(),
                ))
                .await;
        }
    }
}
