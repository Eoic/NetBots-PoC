use serde::{Deserialize, Serialize};

// Game configuration constants
pub const ARENA_WIDTH: f64 = 800.0;
pub const ARENA_HEIGHT: f64 = 600.0;
pub const ROBOT_RADIUS: f64 = 18.0;
pub const STARTING_ENERGY: f64 = 100.0;
pub const STARTING_GUN_HEAT: f64 = 1.0;
pub const MAX_TICKS: u32 = 1000;
pub const BULLET_SPEED: f64 = 8.0;
pub const MAX_ROTATION_PER_TICK: f64 = 10.0;
pub const MAX_FORWARD_SPEED: f64 = 8.0;
pub const MAX_BACKWARD_SPEED: f64 = 2.0;
pub const GUN_COOLDOWN_RATE: f64 = 0.1;
pub const SCAN_ARC_DEGREES: f64 = 10.0;

pub const SPAWN_POSITIONS: [(f64, f64, f64); 2] = [
    (100.0, 300.0, 0.0),   // Robot 0: x, y, heading
    (700.0, 300.0, 180.0),  // Robot 1: x, y, heading
];

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GameWorld {
    pub tick: u32,
    pub arena_width: f64,
    pub arena_height: f64,
    pub robots: Vec<Robot>,
    pub bullets: Vec<Bullet>,
    pub status: GameStatus,
}

impl GameWorld {
    pub fn new() -> Self {
        let robots = SPAWN_POSITIONS
            .iter()
            .enumerate()
            .map(|(id, &(x, y, heading))| Robot {
                id,
                x,
                y,
                heading,
                speed: 0.0,
                energy: STARTING_ENERGY,
                gun_heat: STARTING_GUN_HEAT,
                alive: true,
            })
            .collect();

        Self {
            tick: 0,
            arena_width: ARENA_WIDTH,
            arena_height: ARENA_HEIGHT,
            robots,
            bullets: Vec::new(),
            status: GameStatus::Running,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Robot {
    pub id: usize,
    pub x: f64,
    pub y: f64,
    pub heading: f64,
    pub speed: f64,
    pub energy: f64,
    pub gun_heat: f64,
    pub alive: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Bullet {
    pub owner_id: usize,
    pub x: f64,
    pub y: f64,
    pub heading: f64,
    pub speed: f64,
    pub power: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum GameStatus {
    WaitingForPlayers,
    Running,
    Finished { winner: Option<usize> },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TickSnapshot {
    pub tick: u32,
    pub robots: Vec<RobotSnapshot>,
    pub bullets: Vec<BulletSnapshot>,
    pub events: Vec<GameEvent>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RobotSnapshot {
    pub id: usize,
    pub x: f64,
    pub y: f64,
    pub heading: f64,
    pub energy: f64,
    pub alive: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BulletSnapshot {
    pub x: f64,
    pub y: f64,
    pub heading: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum GameEvent {
    ShotFired { robot_id: usize },
    Hit { robot_id: usize, damage: f64 },
    Collision { robot_id: usize, kind: String },
    RobotDied { robot_id: usize },
}

#[derive(Debug, Clone)]
pub enum RobotAction {
    SetSpeed(f64),
    Rotate(f64),
    Shoot(f64),
}

#[derive(Debug, Clone, Default)]
pub struct PlayerActions {
    pub actions: Vec<RobotAction>,
}
