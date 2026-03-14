use engine::world::{GameStatus, GameWorld, PlayerActions, RobotAction, RobotConfig};
use engine::tick::*;
use wasm_runner::RobotRunner;

const TEST_WAT: &str = include_str!("test_robot.wat");

fn create_runner(robot_id: usize) -> RobotRunner {
    let engine = wasmtime::Engine::new(&{
        let mut c = wasmtime::Config::new();
        c.consume_fuel(false); // The runner handles fuel internally
        c
    }).unwrap();
    let wasm_bytes = wat::parse_str(TEST_WAT).expect("Failed to parse WAT");
    RobotRunner::new(&wasm_bytes, robot_id).expect("Failed to create runner")
}

#[test]
fn test_runner_loads_and_calls_on_tick() {
    let mut runner = create_runner(0);

    let actions = runner
        .call_on_tick(1, 100.0, 100.0, 300.0, 0.0, 0.0, 1.0, -1.0)
        .expect("on_tick failed");

    // Should have set_speed and rotate (no shoot because gun_heat > 0)
    assert!(actions.len() >= 2, "Expected at least 2 actions, got {}", actions.len());
    assert!(matches!(actions[0], RobotAction::SetSpeed(_)));
    assert!(matches!(actions[1], RobotAction::Rotate(_)));
}

#[test]
fn test_runner_shoots_when_gun_cool() {
    let mut runner = create_runner(0);

    let actions = runner
        .call_on_tick(1, 100.0, 100.0, 300.0, 0.0, 0.0, 0.0, -1.0) // gun_heat = 0
        .expect("on_tick failed");

    // Should have set_speed, rotate, and shoot
    assert!(actions.len() >= 3, "Expected at least 3 actions, got {}", actions.len());
    assert!(matches!(actions[2], RobotAction::Shoot(_)));
}

#[test]
fn test_runner_calls_on_hit() {
    let mut runner = create_runner(0);

    let actions = runner.call_on_hit(4.0).expect("on_hit failed");

    assert!(!actions.is_empty());
    assert!(matches!(actions[0], RobotAction::Rotate(_)));
}

#[test]
fn test_runner_calls_on_collision() {
    let mut runner = create_runner(0);

    let actions = runner.call_on_collision(0, 100.0, 300.0).expect("on_collision failed");

    assert!(!actions.is_empty());
    assert!(matches!(actions[0], RobotAction::Rotate(_)));
}

#[test]
fn test_full_simulation_with_wasm() {
    let wasm_bytes = wat::parse_str(TEST_WAT).expect("Failed to parse WAT");
    let mut runners = vec![
        RobotRunner::new(&wasm_bytes, 0).expect("Failed to create runner 0"),
        RobotRunner::new(&wasm_bytes, 1).expect("Failed to create runner 1"),
    ];

    let mut world = GameWorld::new(&[
        RobotConfig { name: "bot-0".to_string(), team: 0 },
        RobotConfig { name: "bot-1".to_string(), team: 1 },
    ]);

    for _ in 0..50 {
        if world.status != GameStatus::Running {
            break;
        }

        // Phase 1: Events
        let (tick_events, mut all_game_events) = run_events_phase(&mut world);

        // Call WASM callbacks for events
        let mut all_actions: Vec<PlayerActions> = vec![PlayerActions::default(); 2];

        for hit in &tick_events.hits {
            if let Ok(actions) = runners[hit.robot_id].call_on_hit(hit.damage) {
                all_actions[hit.robot_id].actions.extend(actions);
            }
        }
        for col in &tick_events.collisions {
            if let Ok(actions) = runners[col.robot_id].call_on_collision(col.kind, col.x, col.y) {
                all_actions[col.robot_id].actions.extend(actions);
            }
        }

        // Phase 2: Decisions (call on_tick)
        for (i, robot) in world.robots.iter().enumerate() {
            if !robot.alive {
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
        let _snapshot = run_tick(&mut world, &all_actions);
    }

    // After 50 ticks, robots should have moved from their starting positions
    assert!(world.robots[0].x != 100.0 || world.robots[0].y != 300.0,
        "Robot 0 should have moved");
    assert!(world.robots[1].x != 700.0 || world.robots[1].y != 300.0,
        "Robot 1 should have moved");
    assert!(world.tick >= 50 || world.status != GameStatus::Running,
        "Should have run 50 ticks or game ended");
}
