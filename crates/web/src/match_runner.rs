use anyhow::{Context, Result};
use engine::tick::*;
use engine::world::*;
use wasm_runner::RobotRunner;

pub fn run_match(wasm_modules: &[Vec<u8>]) -> Result<(Vec<TickSnapshot>, Option<usize>)> {
    let mut runners: Vec<RobotRunner> = wasm_modules
        .iter()
        .enumerate()
        .map(|(id, bytes)| RobotRunner::new(bytes, id).context(format!("Failed to create runner for robot {}", id)))
        .collect::<Result<Vec<_>>>()?;

    let mut world = GameWorld::new();
    let mut replay = Vec::new();

    while world.status == GameStatus::Running && world.tick < MAX_TICKS {
        // Phase 1: Events
        let (tick_events, _event_game_events) = run_events_phase(&mut world);

        // Call WASM event callbacks
        let mut all_actions: Vec<PlayerActions> = vec![PlayerActions::default(); world.robots.len()];

        for hit in &tick_events.hits {
            if hit.robot_id < runners.len() && world.robots[hit.robot_id].alive {
                if let Ok(actions) = runners[hit.robot_id].call_on_hit(hit.damage) {
                    all_actions[hit.robot_id].actions.extend(actions);
                }
            }
        }

        for col in &tick_events.collisions {
            if col.robot_id < runners.len() && world.robots[col.robot_id].alive {
                if let Ok(actions) = runners[col.robot_id].call_on_collision(col.kind, col.x, col.y) {
                    all_actions[col.robot_id].actions.extend(actions);
                }
            }
        }

        // Phase 2: Decisions (call on_tick for each alive robot)
        for (i, robot) in world.robots.iter().enumerate() {
            if !robot.alive || i >= runners.len() {
                continue;
            }
            let scan = compute_scan(&world, i);
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
        }

        // Phases 3-6: Resolution, Physics, Capture, Win Check
        let snapshot = run_tick(&mut world, &all_actions);
        replay.push(snapshot);
    }

    let winner = match world.status {
        GameStatus::Finished { winner } => winner,
        _ => None,
    };

    Ok((replay, winner))
}
