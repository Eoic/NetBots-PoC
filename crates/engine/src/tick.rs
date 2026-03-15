use crate::collision::*;
use crate::world::*;

/// Represents collision events that occurred during a tick, to be passed to WASM callbacks.
#[derive(Debug, Clone)]
pub struct CollisionEvent {
    pub robot_id: usize,
    pub kind: i32, // 0=wall, 1=robot
    pub x: f64,
    pub y: f64,
}

/// Represents hit events that occurred during a tick, to be passed to WASM callbacks.
#[derive(Debug, Clone)]
pub struct HitEvent {
    pub robot_id: usize,
    pub damage: f64,
}

/// Result of the events phase — tells the caller what WASM callbacks to invoke.
#[derive(Debug, Clone, Default)]
pub struct TickEvents {
    pub hits: Vec<HitEvent>,
    pub collisions: Vec<CollisionEvent>,
}

/// Run the events phase (phase 1): detect collisions, apply damage, return events for WASM callbacks.
pub fn run_events_phase(world: &mut GameWorld) -> (TickEvents, Vec<GameEvent>) {
    let mut tick_events = TickEvents::default();
    let mut game_events = Vec::new();

    process_bullet_hits(world, &mut tick_events, &mut game_events);
    process_wall_collisions(world, &mut tick_events, &mut game_events);
    process_robot_collisions(world, &mut tick_events, &mut game_events);

    (tick_events, game_events)
}

fn process_bullet_hits(
    world: &mut GameWorld,
    tick_events: &mut TickEvents,
    game_events: &mut Vec<GameEvent>,
) {
    let bullet_hits = detect_bullet_robot_collisions(world);
    let mut bullets_to_remove: Vec<usize> = bullet_hits.iter().map(|h| h.bullet_index).collect();
    bullets_to_remove.sort_unstable();
    bullets_to_remove.dedup();

    for hit in &bullet_hits {
        if let Some(robot) = world.robots.iter_mut().find(|r| r.id == hit.robot_id) {
            robot.energy -= hit.damage;
            if robot.energy <= 0.0 {
                robot.alive = false;
                game_events.push(GameEvent::RobotDied { robot_id: robot.id });
            }
        }
        if let Some(shooter) = world.robots.iter_mut().find(|r| r.id == hit.shooter_id) {
            shooter.energy += hit.power * HIT_REWARD_MULTIPLIER;
        }

        tick_events.hits.push(HitEvent {
            robot_id: hit.robot_id,
            damage: hit.damage,
        });
        game_events.push(GameEvent::Hit {
            robot_id: hit.robot_id,
            damage: hit.damage,
        });
    }

    for &bi in bullets_to_remove.iter().rev() {
        if bi < world.bullets.len() {
            world.bullets.remove(bi);
        }
    }
}

fn process_wall_collisions(
    world: &mut GameWorld,
    tick_events: &mut TickEvents,
    game_events: &mut Vec<GameEvent>,
) {
    let wall_collisions = detect_robot_wall_collisions(world);

    for wc in &wall_collisions {
        tick_events.collisions.push(CollisionEvent {
            robot_id: wc.robot_id,
            kind: 0,
            x: wc.x,
            y: wc.y,
        });
        game_events.push(GameEvent::Collision {
            robot_id: wc.robot_id,
            kind: "wall".to_string(),
        });
    }
}

fn process_robot_collisions(
    world: &mut GameWorld,
    tick_events: &mut TickEvents,
    game_events: &mut Vec<GameEvent>,
) {
    let robot_collisions = detect_robot_robot_collisions(world);
    for rc in &robot_collisions {
        for &rid in &[rc.robot_a, rc.robot_b] {
            if let Some(robot) = world.robots.iter_mut().find(|r| r.id == rid) {
                robot.energy -= ROBOT_COLLISION_DAMAGE;
                if robot.energy <= 0.0 {
                    robot.alive = false;
                    game_events.push(GameEvent::RobotDied { robot_id: rid });
                }
            }

            tick_events.collisions.push(CollisionEvent {
                robot_id: rid,
                kind: 1,
                x: rc.x,
                y: rc.y,
            });

            game_events.push(GameEvent::Collision {
                robot_id: rid,
                kind: "robot".to_string(),
            });
        }

        let (ax, ay) = {
            let a = &world.robots[rc.robot_a];
            (a.x, a.y)
        };

        let (bx, by) = {
            let b = &world.robots[rc.robot_b];
            (b.x, b.y)
        };

        let dx = bx - ax;
        let dy = by - ay;
        let dist = (dx * dx + dy * dy).sqrt().max(0.01);
        let overlap = ROBOT_RADIUS * 2.0 - dist;

        if overlap > 0.0 {
            let push = overlap / 2.0 + COLLISION_SEPARATION_BUFFER;
            let nx = dx / dist;
            let ny = dy / dist;
            world.robots[rc.robot_a].x -= nx * push;
            world.robots[rc.robot_a].y -= ny * push;
            world.robots[rc.robot_b].x += nx * push;
            world.robots[rc.robot_b].y += ny * push;
        }
    }
}

/// Run the resolution phase (phase 3): apply buffered actions to robots.
pub fn run_resolution_phase(
    world: &mut GameWorld,
    all_actions: &[PlayerActions],
) -> Vec<GameEvent> {
    let mut game_events = Vec::new();

    for (i, player_actions) in all_actions.iter().enumerate() {
        if i >= world.robots.len() || !world.robots[i].alive {
            continue;
        }

        let mut speed_set = false;
        let mut rotated = false;
        let mut shot = false;

        for action in &player_actions.actions {
            match action {
                RobotAction::SetSpeed(speed) if !speed_set => {
                    world.robots[i].speed = speed.clamp(-MAX_BACKWARD_SPEED, MAX_FORWARD_SPEED);
                    speed_set = true;
                }
                RobotAction::Rotate(angle) if !rotated => {
                    let clamped = angle.clamp(-MAX_ROTATION_PER_TICK, MAX_ROTATION_PER_TICK);
                    world.robots[i].heading = (world.robots[i].heading + clamped) % 360.0;
                    if world.robots[i].heading < 0.0 {
                        world.robots[i].heading += 360.0;
                    }
                    rotated = true;
                }
                RobotAction::Shoot(power) if !shot && world.robots[i].gun_heat <= 0.0 => {
                    let power = power.clamp(MIN_BULLET_POWER, MAX_BULLET_POWER);
                    let robot = &world.robots[i];
                    let heading_rad = robot.heading.to_radians();
                    world.bullets.push(Bullet {
                        owner_id: robot.id,
                        owner_team: robot.team,
                        x: robot.x + heading_rad.cos() * ROBOT_RADIUS,
                        y: robot.y - heading_rad.sin() * ROBOT_RADIUS,
                        heading: robot.heading,
                        speed: BULLET_SPEED,
                        power,
                    });
                    world.robots[i].gun_heat = GUN_HEAT_BASE + power / GUN_HEAT_POWER_DIVISOR;
                    game_events.push(GameEvent::ShotFired { robot_id: i });
                    shot = true;
                }
                _ => {}
            }
        }
    }

    game_events
}

/// Run the physics phase (phase 4): move entities, remove OOB bullets, cool guns, clamp robots.
pub fn run_physics_phase(world: &mut GameWorld) {
    for robot in world.robots.iter_mut() {
        if !robot.alive {
            continue;
        }
        let heading_rad = robot.heading.to_radians();
        robot.x += heading_rad.cos() * robot.speed;
        robot.y -= heading_rad.sin() * robot.speed;

        robot.x = robot
            .x
            .clamp(ROBOT_RADIUS, world.arena_width - ROBOT_RADIUS);
        robot.y = robot
            .y
            .clamp(ROBOT_RADIUS, world.arena_height - ROBOT_RADIUS);

        robot.gun_heat = (robot.gun_heat - GUN_COOLDOWN_RATE).max(0.0);
    }

    for bullet in world.bullets.iter_mut() {
        let heading_rad = bullet.heading.to_radians();
        bullet.x += heading_rad.cos() * bullet.speed;
        bullet.y -= heading_rad.sin() * bullet.speed;
    }

    world.bullets.retain(|b| {
        b.x >= 0.0 && b.x <= world.arena_width && b.y >= 0.0 && b.y <= world.arena_height
    });
}

/// Capture the current state as a snapshot.
pub fn capture_snapshot(world: &GameWorld, events: Vec<GameEvent>) -> TickSnapshot {
    TickSnapshot {
        tick: world.tick,
        robots: world
            .robots
            .iter()
            .map(|r| RobotSnapshot {
                id: r.id,
                name: r.name.clone(),
                team: r.team,
                x: r.x,
                y: r.y,
                heading: r.heading,
                energy: r.energy,
                alive: r.alive,
            })
            .collect(),
        bullets: world
            .bullets
            .iter()
            .map(|b| BulletSnapshot {
                owner_id: b.owner_id,
                x: b.x,
                y: b.y,
                heading: b.heading,
            })
            .collect(),
        events,
    }
}

/// Check win conditions and update game status.
pub fn check_win(world: &mut GameWorld) {
    const ENERGY_TIE_EPSILON: f64 = 1e-9;

    let alive_teams: std::collections::HashSet<u8> = world
        .robots
        .iter()
        .filter(|r| r.alive)
        .map(|r| r.team)
        .collect();

    if alive_teams.len() <= 1 {
        world.status = GameStatus::Finished {
            winner_team: alive_teams.into_iter().next(),
        };
    } else if world.tick >= world.max_ticks {
        let mut team_energy: std::collections::HashMap<u8, f64> = std::collections::HashMap::new();
        for robot in world.robots.iter().filter(|r| r.alive) {
            *team_energy.entry(robot.team).or_insert(0.0) += robot.energy;
        }

        let mut ranked_teams: Vec<(u8, f64)> = team_energy.into_iter().collect();
        ranked_teams.sort_by(|a, b| b.1.total_cmp(&a.1).then_with(|| a.0.cmp(&b.0)));

        let winner_team = match ranked_teams.as_slice() {
            [] => None,
            [(team, _)] => Some(*team),
            [(top_team, top_energy), (_, second_energy), ..] => {
                if (top_energy - second_energy).abs() <= ENERGY_TIE_EPSILON {
                    None
                } else {
                    Some(*top_team)
                }
            }
        };

        world.status = GameStatus::Finished { winner_team };
    }
}

/// Run a complete tick. The caller is responsible for calling WASM functions
/// (on_hit, on_collision, on_tick) and collecting actions.
/// This function handles resolution, physics, capture, and win check.
pub fn run_tick(world: &mut GameWorld, all_actions: &[PlayerActions]) -> TickSnapshot {
    world.tick += 1;

    let game_events = run_resolution_phase(world, all_actions);

    run_physics_phase(world);

    let snapshot = capture_snapshot(world, game_events);

    check_win(world);

    snapshot
}

#[cfg(test)]
pub(crate) fn test_world_2v2() -> GameWorld {
    GameWorld::new(&[
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
    ])
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::scan::compute_scan;

    #[test]
    fn test_robot_moves_forward() {
        let mut world = test_world_2v2();
        let initial_x = world.robots[0].x;
        let actions = vec![
            PlayerActions {
                actions: vec![RobotAction::SetSpeed(5.0)],
            },
            PlayerActions::default(),
        ];

        run_tick(&mut world, &actions);

        assert!(world.robots[0].x > initial_x);
    }

    #[test]
    fn test_robot_rotates() {
        let mut world = test_world_2v2();
        let actions = vec![
            PlayerActions {
                actions: vec![RobotAction::Rotate(5.0)],
            },
            PlayerActions::default(),
        ];

        run_tick(&mut world, &actions);
        assert!((world.robots[0].heading - 5.0).abs() < 0.001);
    }

    #[test]
    fn test_robot_shoots() {
        let mut world = test_world_2v2();
        world.robots[0].gun_heat = 0.0;

        let actions = vec![
            PlayerActions {
                actions: vec![RobotAction::Shoot(2.0)],
            },
            PlayerActions::default(),
        ];

        run_tick(&mut world, &actions);
        assert_eq!(world.bullets.len(), 1);
        assert!(world.robots[0].gun_heat > 0.0);
    }

    #[test]
    fn test_speed_clamped() {
        let mut world = test_world_2v2();
        let actions = vec![
            PlayerActions {
                actions: vec![RobotAction::SetSpeed(100.0)],
            },
            PlayerActions::default(),
        ];

        run_tick(&mut world, &actions);
        assert!((world.robots[0].speed - MAX_FORWARD_SPEED).abs() < 0.001);
    }

    #[test]
    fn test_rotation_clamped() {
        let mut world = test_world_2v2();
        let actions = vec![
            PlayerActions {
                actions: vec![RobotAction::Rotate(50.0)],
            },
            PlayerActions::default(),
        ];

        run_tick(&mut world, &actions);
        assert!((world.robots[0].heading - MAX_ROTATION_PER_TICK).abs() < 0.001);
    }

    #[test]
    fn test_only_first_action_of_each_type_applied() {
        let mut world = test_world_2v2();
        let actions = vec![
            PlayerActions {
                actions: vec![RobotAction::SetSpeed(3.0), RobotAction::SetSpeed(7.0)],
            },
            PlayerActions::default(),
        ];

        run_tick(&mut world, &actions);
        assert!((world.robots[0].speed - 3.0).abs() < 0.001);
    }

    #[test]
    fn test_gun_heat_prevents_shooting() {
        let mut world = test_world_2v2();

        let actions = vec![
            PlayerActions {
                actions: vec![RobotAction::Shoot(1.0)],
            },
            PlayerActions::default(),
        ];

        run_tick(&mut world, &actions);
        assert_eq!(world.bullets.len(), 0);
    }

    #[test]
    fn test_win_condition_last_alive() {
        let mut world = test_world_2v2();
        world.robots[1].alive = false;

        let actions = vec![PlayerActions::default(), PlayerActions::default()];
        run_tick(&mut world, &actions);

        assert_eq!(
            world.status,
            GameStatus::Finished {
                winner_team: Some(0)
            }
        );
    }

    #[test]
    fn test_timeout_win_uses_highest_team_energy() {
        let mut world = GameWorld::new_with_max_ticks(
            &[
                RobotConfig {
                    name: "bot-0".to_string(),
                    team: 0,
                    spawn: None,
                },
                RobotConfig {
                    name: "bot-1".to_string(),
                    team: 4,
                    spawn: None,
                },
                RobotConfig {
                    name: "bot-2".to_string(),
                    team: 7,
                    spawn: None,
                },
            ],
            1,
        );
        world.robots[0].energy = 10.0;
        world.robots[1].energy = 55.0;
        world.robots[2].energy = 30.0;

        let actions = vec![
            PlayerActions::default(),
            PlayerActions::default(),
            PlayerActions::default(),
        ];
        run_tick(&mut world, &actions);

        assert_eq!(
            world.status,
            GameStatus::Finished {
                winner_team: Some(4)
            }
        );
    }

    #[test]
    fn test_timeout_tie_results_in_draw() {
        let mut world = GameWorld::new_with_max_ticks(
            &[
                RobotConfig {
                    name: "bot-0".to_string(),
                    team: 2,
                    spawn: None,
                },
                RobotConfig {
                    name: "bot-1".to_string(),
                    team: 9,
                    spawn: None,
                },
            ],
            1,
        );
        world.robots[0].energy = 42.0;
        world.robots[1].energy = 42.0;

        let actions = vec![PlayerActions::default(), PlayerActions::default()];
        run_tick(&mut world, &actions);

        assert_eq!(world.status, GameStatus::Finished { winner_team: None });
    }

    #[test]
    fn test_scan_finds_enemy_in_arc() {
        let world = test_world_2v2();
        let dist = compute_scan(&world, 0);
        assert!(dist > 0.0);
        assert!((dist - 400.0).abs() < 1.0);
    }

    #[test]
    fn test_scan_misses_enemy_outside_arc() {
        let mut world = test_world_2v2();
        world.robots[0].heading = 90.0;
        let dist = compute_scan(&world, 0);
        assert_eq!(dist, -1.0);
    }

    #[test]
    fn test_bullet_moves() {
        let mut world = test_world_2v2();

        world.bullets.push(Bullet {
            owner_id: 0,
            owner_team: 0,
            x: 400.0,
            y: 300.0,
            heading: 0.0,
            speed: BULLET_SPEED,
            power: 1.0,
        });

        run_physics_phase(&mut world);
        assert!((world.bullets[0].x - (400.0 + BULLET_SPEED)).abs() < 0.001);
    }

    #[test]
    fn test_bullet_removed_out_of_bounds() {
        let mut world = test_world_2v2();

        world.bullets.push(Bullet {
            owner_id: 0,
            owner_team: 0,
            x: world.arena_width - 1.0,
            y: 300.0,
            heading: 0.0,
            speed: BULLET_SPEED,
            power: 1.0,
        });

        run_physics_phase(&mut world);
        assert_eq!(world.bullets.len(), 0);
    }
}
