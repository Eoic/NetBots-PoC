use engine::scan::*;
use engine::tick::*;
use engine::world::{GameStatus, GameWorld, PlayerActions, RobotAction, RobotConfig};
use wasm_runner::RobotRunner;

const TEST_WAT: &str = include_str!("test_robot.wat");
const TEST_WAT_ON_TICK_ONLY: &str = r#"
(module
  (type $t0 (func (param i32 f64 f64 f64 f64 f64 f64)))
  (type $t1 (func (param f64)))
  (type $t2 (func (param f64)))
  (import "env" "set_speed" (func $set_speed (type $t1)))
  (import "env" "rotate" (func $rotate (type $t2)))
  (func $on_tick (export "on_tick") (type $t0)
    local.get 5
    call $set_speed
    f64.const 1.0
    call $rotate
  )
)
"#;

fn create_runner(robot_id: usize) -> RobotRunner {
    let _engine = wasmtime::Engine::new(&{
        let mut config = wasmtime::Config::new();
        config.consume_fuel(false);
        config
    })
    .unwrap();

    let wasm_bytes = wat::parse_str(TEST_WAT).expect("Failed to parse WAT");
    RobotRunner::new(&wasm_bytes, robot_id).expect("Failed to create runner")
}

#[test]
fn test_runner_loads_and_calls_on_tick() {
    let mut runner = create_runner(0);

    let actions = runner
        .call_on_tick(1, 100.0, 100.0, 300.0, 0.0, 0.0, 1.0, -1.0)
        .expect("on_tick failed");

    assert!(
        actions.len() >= 2,
        "Expected at least 2 actions, got {}",
        actions.len()
    );

    assert!(matches!(actions[0], RobotAction::SetSpeed(_)));
    assert!(matches!(actions[1], RobotAction::Rotate(_)));
}

#[test]
fn test_runner_shoots_when_gun_cool() {
    let mut runner = create_runner(0);

    let actions = runner
        .call_on_tick(1, 100.0, 100.0, 300.0, 0.0, 0.0, 0.0, -1.0)
        .expect("on_tick failed");

    assert!(
        actions.len() >= 3,
        "Expected at least 3 actions, got {}",
        actions.len()
    );

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

    let actions = runner
        .call_on_collision(0, 100.0, 300.0)
        .expect("on_collision failed");

    assert!(!actions.is_empty());
    assert!(matches!(actions[0], RobotAction::Rotate(_)));
}

#[test]
fn test_runner_allows_missing_optional_event_handlers() {
    let wasm_bytes = wat::parse_str(TEST_WAT_ON_TICK_ONLY).expect("Failed to parse WAT");
    let mut runner = RobotRunner::new(&wasm_bytes, 0).expect("Failed to create runner");

    let tick_actions = runner
        .call_on_tick(1, 100.0, 100.0, 300.0, 0.0, 7.0, 0.0, -1.0)
        .expect("on_tick failed");

    assert!(
        !tick_actions.is_empty(),
        "Expected on_tick actions for minimal bot"
    );

    let on_hit_actions = runner.call_on_hit(5.0).expect("on_hit failed");

    assert!(
        on_hit_actions.is_empty(),
        "Expected empty actions when on_hit is not exported"
    );

    let on_collision_actions = runner
        .call_on_collision(0, 10.0, 20.0)
        .expect("on_collision failed");

    assert!(
        on_collision_actions.is_empty(),
        "Expected empty actions when on_collision is not exported"
    );
}

#[test]
fn test_full_simulation_with_wasm() {
    let wasm_bytes = wat::parse_str(TEST_WAT).expect("Failed to parse WAT");

    let mut runners = vec![
        RobotRunner::new(&wasm_bytes, 0).expect("Failed to create runner 0"),
        RobotRunner::new(&wasm_bytes, 1).expect("Failed to create runner 1"),
    ];

    let mut world = GameWorld::new(&[
        RobotConfig {
            name: "bot-0".to_string(),
            team: 0,
            spawn: None,
        },
        RobotConfig {
            name: "bot-1".to_string(),
            team: 1,
            spawn: None,
        },
    ]);

    for _ in 0..50 {
        if world.status != GameStatus::Running {
            break;
        }

        let (tick_events, _all_game_events) = run_events_phase(&mut world);
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

        let _snapshot = run_tick(&mut world, &all_actions);
    }

    assert!(
        world.robots[0].x != 100.0 || world.robots[0].y != 300.0,
        "Robot 0 should have moved"
    );

    assert!(
        world.robots[1].x != 700.0 || world.robots[1].y != 300.0,
        "Robot 1 should have moved"
    );

    assert!(
        world.tick >= 50 || world.status != GameStatus::Running,
        "Should have run 50 ticks or game ended"
    );
}
