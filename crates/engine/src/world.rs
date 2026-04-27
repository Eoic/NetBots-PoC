use serde::{Deserialize, Serialize};
use std::collections::HashMap;

pub const ARENA_WIDTH: f64 = 1200.0;
pub const ARENA_HEIGHT: f64 = 800.0;
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
pub const MAX_TEAMS: u8 = 16;
pub const HIT_REWARD_MULTIPLIER: f64 = 2.0;
pub const ROBOT_COLLISION_DAMAGE: f64 = 1.0;
pub const COLLISION_SEPARATION_BUFFER: f64 = 0.5;
pub const MIN_BULLET_POWER: f64 = 1.0;
pub const MAX_BULLET_POWER: f64 = 3.0;
pub const GUN_HEAT_BASE: f64 = 1.0;
pub const GUN_HEAT_POWER_DIVISOR: f64 = 5.0;
pub const BULLET_DAMAGE_MULTIPLIER: f64 = 4.0;

#[derive(Debug, Clone)]
pub struct RobotConfig {
    pub name: String,
    pub team: u8,
    pub spawn: Option<SpawnPoint>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SpawnPoint {
    pub x: f64,
    pub y: f64,
    pub heading: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GameWorld {
    pub tick: u32,
    pub max_ticks: u32,
    pub arena_width: f64,
    pub arena_height: f64,
    pub robots: Vec<Robot>,
    pub bullets: Vec<Bullet>,
    pub status: GameStatus,
}

impl GameWorld {
    pub fn new(configs: &[RobotConfig]) -> Self {
        Self::new_with_max_ticks(configs, MAX_TICKS)
    }

    pub fn new_with_max_ticks(configs: &[RobotConfig], max_ticks: u32) -> Self {
        debug_assert!(
            configs.iter().all(|config| config.team < MAX_TEAMS),
            "Robot team ids must be in range 0..{}",
            MAX_TEAMS - 1
        );

        let mut team_order: Vec<u8> = Vec::new();
        let mut team_members: HashMap<u8, Vec<usize>> = HashMap::new();

        for (idx, config) in configs.iter().enumerate() {
            if !team_members.contains_key(&config.team) {
                team_order.push(config.team);
            }
            team_members.entry(config.team).or_default().push(idx);
        }

        let team_count = team_order.len().max(1);
        let mut team_default_x: HashMap<u8, f64> = HashMap::new();

        for (team_rank, team) in team_order.iter().enumerate() {
            let x = ARENA_WIDTH * (team_rank as f64 + 1.0) / (team_count as f64 + 1.0);
            team_default_x.insert(*team, x);
        }

        let mut robots = vec![None; configs.len()];

        for team in team_order {
            let members = team_members.get(&team).expect("Team members should exist");

            let default_x = *team_default_x
                .get(&team)
                .expect("Team default x should exist");

            let default_heading = if default_x <= ARENA_WIDTH / 2.0 {
                0.0
            } else {
                180.0
            };

            for (row_index, &config_i) in members.iter().enumerate() {
                let config = &configs[config_i];

                robots[config_i] = Some(Robot {
                    id: config_i,
                    name: config.name.clone(),
                    team: config.team,

                    x: config
                        .spawn
                        .as_ref()
                        .map(|spawn| spawn.x)
                        .unwrap_or(default_x),

                    y: config.spawn.as_ref().map(|spawn| spawn.y).unwrap_or(
                        ARENA_HEIGHT * (row_index as f64 + 1.0) / (members.len() as f64 + 1.0),
                    ),

                    heading: config
                        .spawn
                        .as_ref()
                        .and_then(|spawn| spawn.heading)
                        .unwrap_or(default_heading),

                    speed: 0.0,
                    energy: STARTING_ENERGY,
                    gun_heat: STARTING_GUN_HEAT,
                    alive: true,
                });
            }
        }

        Self {
            tick: 0,
            max_ticks: max_ticks.max(1),
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_new_world_distributes_default_spawns_per_team_column() {
        let world = GameWorld::new(&[
            RobotConfig {
                name: "bot-a".to_string(),
                team: 2,
                spawn: None,
            },
            RobotConfig {
                name: "bot-b".to_string(),
                team: 7,
                spawn: None,
            },
            RobotConfig {
                name: "bot-c".to_string(),
                team: 12,
                spawn: None,
            },
        ]);

        assert_eq!(world.robots.len(), 3);
        assert!((world.robots[0].x - (ARENA_WIDTH * 1.0 / 4.0)).abs() < 0.001);
        assert!((world.robots[1].x - (ARENA_WIDTH * 2.0 / 4.0)).abs() < 0.001);
        assert!((world.robots[2].x - (ARENA_WIDTH * 3.0 / 4.0)).abs() < 0.001);
        assert_eq!(world.robots[0].heading, 0.0);
        assert_eq!(world.robots[1].heading, 0.0);
        assert_eq!(world.robots[2].heading, 180.0);
    }

    #[test]
    fn test_explicit_spawn_overrides_default_position_and_heading() {
        let world = GameWorld::new(&[RobotConfig {
            name: "bot-a".to_string(),
            team: 3,
            spawn: Some(SpawnPoint {
                x: 321.0,
                y: 654.0,
                heading: Some(270.0),
            }),
        }]);

        assert_eq!(world.robots.len(), 1);
        assert!((world.robots[0].x - 321.0).abs() < 0.001);
        assert!((world.robots[0].y - 654.0).abs() < 0.001);
        assert_eq!(world.robots[0].heading, 270.0);
    }
}
