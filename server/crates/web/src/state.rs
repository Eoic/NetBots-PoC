use std::sync::{Arc, Mutex};

use dashmap::DashMap;
use engine::world::TickSnapshot;
use serde::Serialize;

#[derive(Clone)]
pub struct AppState {
    pub matches: Arc<DashMap<String, Arc<Mutex<GameMatch>>>>,
}

impl AppState {
    pub fn new() -> Self {
        Self {
            matches: Arc::new(DashMap::new()),
        }
    }
}

pub struct GameMatch {
    pub id: String,
    pub players: Vec<Player>,
    pub status: MatchStatus,
    pub wasm_modules: Vec<Option<Vec<u8>>>,
    pub replay: Option<Vec<TickSnapshot>>,
}

pub struct Player {
    pub id: String,
    pub token: String,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub enum MatchStatus {
    WaitingForPlayers,
    Compiling,
    Running,
    Finished { winner: Option<usize> },
    Error(String),
}
