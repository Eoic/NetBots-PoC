use anyhow::{Context, Result};
use engine::tick::*;
use engine::world::*;
use wasm_runner::RobotRunner;

pub struct MatchResult {
    pub replay: Vec<TickSnapshot>,
    pub winner_team: Option<u8>,
    pub total_ticks: u32,
    pub logs: Vec<(String, Vec<String>)>,
}

pub fn run_match(configs: &[RobotConfig], wasm_modules: &[Vec<u8>]) -> Result<MatchResult> {
    let mut runners: Vec<RobotRunner> = wasm_modules
        .iter()
        .enumerate()
        .map(|(id, bytes)| {
            RobotRunner::new(bytes, id).context(format!("Failed to create runner for robot {}", id))
        })
        .collect::<Result<Vec<_>>>()?;

    let mut world = GameWorld::new(configs);
    let mut replay = Vec::new();

    while world.status == GameStatus::Running && world.tick < MAX_TICKS {
        let (tick_events, _) = run_events_phase(&mut world);

        let mut all_actions: Vec<PlayerActions> =
            vec![PlayerActions::default(); world.robots.len()];

        for hit in &tick_events.hits {
            if hit.robot_id < runners.len() && world.robots[hit.robot_id].alive {
                if let Ok(actions) = runners[hit.robot_id].call_on_hit(hit.damage) {
                    all_actions[hit.robot_id].actions.extend(actions);
                }
                if runners[hit.robot_id].has_trapped() {
                    world.robots[hit.robot_id].alive = false;
                    world.robots[hit.robot_id].energy = 0.0;
                }
            }
        }

        for col in &tick_events.collisions {
            if col.robot_id < runners.len() && world.robots[col.robot_id].alive {
                if let Ok(actions) = runners[col.robot_id].call_on_collision(col.kind, col.x, col.y)
                {
                    all_actions[col.robot_id].actions.extend(actions);
                }
                if runners[col.robot_id].has_trapped() {
                    world.robots[col.robot_id].alive = false;
                    world.robots[col.robot_id].energy = 0.0;
                }
            }
        }

        for i in 0..world.robots.len() {
            if !world.robots[i].alive || i >= runners.len() {
                continue;
            }
            let scan = compute_scan(&world, i);
            let robot = &world.robots[i];
            if let Ok(actions) = runners[i].call_on_tick(
                world.tick + 1,
                robot.energy,
                robot.x,
                robot.y,
                robot.heading,
                robot.speed,
                robot.gun_heat,
                scan,
            ) {
                all_actions[i].actions.extend(actions);
            }
            if runners[i].has_trapped() {
                world.robots[i].alive = false;
                world.robots[i].energy = 0.0;
            }
        }

        let snapshot = run_tick(&mut world, &all_actions);
        replay.push(snapshot);
    }

    let winner_team = match world.status {
        GameStatus::Finished { winner_team } => winner_team,
        _ => None,
    };

    let logs: Vec<(String, Vec<String>)> = configs
        .iter()
        .enumerate()
        .map(|(i, config)| (config.name.clone(), runners[i].take_logs()))
        .collect();

    Ok(MatchResult {
        replay,
        winner_team,
        total_ticks: world.tick,
        logs,
    })
}
