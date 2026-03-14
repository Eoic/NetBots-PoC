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

#[derive(Debug, Clone)]
pub struct RobotConfig {
    pub name: String,
    pub team: u8,
}

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
    /// Create a new game world. Invariant: `robot.id == index in self.robots`.
    /// Collision structs store robot IDs which are used as direct vector indices.
    pub fn new(configs: &[RobotConfig]) -> Self {
        let team0: Vec<usize> = configs
            .iter()
            .enumerate()
            .filter(|(_, c)| c.team == 0)
            .map(|(i, _)| i)
            .collect();
        let team1_plus: Vec<usize> = configs
            .iter()
            .enumerate()
            .filter(|(_, c)| c.team != 0)
            .map(|(i, _)| i)
            .collect();

        let team0_count = team0.len();
        let team1_count = team1_plus.len();

        let mut robots = vec![None; configs.len()];

        for (idx, &config_i) in team0.iter().enumerate() {
            let c = &configs[config_i];
            robots[config_i] = Some(Robot {
                id: config_i,
                name: c.name.clone(),
                team: c.team,
                x: 100.0,
                y: ARENA_HEIGHT * (idx as f64 + 1.0) / (team0_count as f64 + 1.0),
                heading: 0.0,
                speed: 0.0,
                energy: STARTING_ENERGY,
                gun_heat: STARTING_GUN_HEAT,
                alive: true,
            });
        }

        for (idx, &config_i) in team1_plus.iter().enumerate() {
            let c = &configs[config_i];
            robots[config_i] = Some(Robot {
                id: config_i,
                name: c.name.clone(),
                team: c.team,
                x: 550.0,
                y: ARENA_HEIGHT * (idx as f64 + 1.0) / (team1_count as f64 + 1.0),
                heading: 180.0,
                speed: 0.0,
                energy: STARTING_ENERGY,
                gun_heat: STARTING_GUN_HEAT,
                alive: true,
            });
        }

        Self {
            tick: 0,
            arena_width: ARENA_WIDTH,
            arena_height: ARENA_HEIGHT,
            robots: robots.into_iter().map(|r| r.unwrap()).collect(),
            bullets: Vec::new(),
            status: GameStatus::Running,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Robot {
    pub id: usize,
    pub name: String,
    pub team: u8,
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
    pub owner_team: u8,
    pub x: f64,
    pub y: f64,
    pub heading: f64,
    pub speed: f64,
    pub power: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum GameStatus {
    Running,
    Finished { winner_team: Option<u8> },
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
    pub name: String,
    pub team: u8,
    pub x: f64,
    pub y: f64,
    pub heading: f64,
    pub energy: f64,
    pub alive: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BulletSnapshot {
    pub owner_id: usize,
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
