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

    // Bullet-robot collisions
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
        // Shooter gains energy
        if let Some(shooter) = world.robots.iter_mut().find(|r| r.id == hit.shooter_id) {
            shooter.energy += hit.power * 2.0;
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

    // Remove hit bullets (reverse order to preserve indices)
    for &bi in bullets_to_remove.iter().rev() {
        if bi < world.bullets.len() {
            world.bullets.remove(bi);
        }
    }

    // Robot-wall collisions
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

    // Robot-robot collisions
    let robot_collisions = detect_robot_robot_collisions(world);
    for rc in &robot_collisions {
        // Both robots take 1 damage
        for &rid in &[rc.robot_a, rc.robot_b] {
            if let Some(robot) = world.robots.iter_mut().find(|r| r.id == rid) {
                robot.energy -= 1.0;
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

        // Push robots apart
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
            let push = overlap / 2.0 + 0.5;
            let nx = dx / dist;
            let ny = dy / dist;
            world.robots[rc.robot_a].x -= nx * push;
            world.robots[rc.robot_a].y -= ny * push;
            world.robots[rc.robot_b].x += nx * push;
            world.robots[rc.robot_b].y += ny * push;
        }
    }

    (tick_events, game_events)
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
                    let power = power.clamp(1.0, 3.0);
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
                    world.robots[i].gun_heat = 1.0 + power / 5.0;
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
    // Move robots
    for robot in world.robots.iter_mut() {
        if !robot.alive {
            continue;
        }
        let heading_rad = robot.heading.to_radians();
        robot.x += heading_rad.cos() * robot.speed;
        robot.y -= heading_rad.sin() * robot.speed; // Y-down screen coords

        // Clamp to arena
        robot.x = robot
            .x
            .clamp(ROBOT_RADIUS, world.arena_width - ROBOT_RADIUS);
        robot.y = robot
            .y
            .clamp(ROBOT_RADIUS, world.arena_height - ROBOT_RADIUS);

        // Cool gun
        robot.gun_heat = (robot.gun_heat - GUN_COOLDOWN_RATE).max(0.0);
    }

    // Move bullets
    for bullet in world.bullets.iter_mut() {
        let heading_rad = bullet.heading.to_radians();
        bullet.x += heading_rad.cos() * bullet.speed;
        bullet.y -= heading_rad.sin() * bullet.speed;
    }

    // Remove out-of-bounds bullets
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
        // Sum energy per team, highest total wins
        let mut team_energy: std::collections::HashMap<u8, f64> = std::collections::HashMap::new();
        for robot in world.robots.iter().filter(|r| r.alive) {
            *team_energy.entry(robot.team).or_insert(0.0) += robot.energy;
        }
        let winner_team = team_energy
            .into_iter()
            .max_by(|a, b| a.1.partial_cmp(&b.1).unwrap())
            .map(|(team, _)| team);
        world.status = GameStatus::Finished { winner_team };
    }
}

/// Compute scan result for a robot: distance to nearest enemy within ±SCAN_ARC_DEGREES of heading.
pub fn compute_scan(world: &GameWorld, robot_id: usize) -> f64 {
    let robot = &world.robots[robot_id];
    if !robot.alive {
        return -1.0;
    }

    let mut min_dist = f64::MAX;
    let heading_rad = robot.heading.to_radians();

    for other in &world.robots {
        if other.team == robot.team || !other.alive {
            continue;
        }
        let dx = other.x - robot.x;
        let dy = -(other.y - robot.y); // Y-down → math coords
        let angle_to = dy.atan2(dx);
        let mut angle_diff = (heading_rad - angle_to).to_degrees();
        // Normalize to [-180, 180]
        while angle_diff > 180.0 {
            angle_diff -= 360.0;
        }
        while angle_diff < -180.0 {
            angle_diff += 360.0;
        }

        if angle_diff.abs() <= SCAN_ARC_DEGREES {
            let dist = (dx * dx + dy * dy).sqrt();
            if dist < min_dist {
                min_dist = dist;
            }
        }
    }

    if min_dist == f64::MAX {
        -1.0
    } else {
        min_dist
    }
}

/// Run a complete tick. The caller is responsible for calling WASM functions
/// (on_hit, on_collision, on_tick) and collecting actions.
/// This function handles resolution, physics, capture, and win check.
pub fn run_tick(world: &mut GameWorld, all_actions: &[PlayerActions]) -> TickSnapshot {
    world.tick += 1;

    // Phase 1: Events (collision detection + damage) is handled externally
    // so that WASM callbacks can be invoked between events and decisions.
    // By the time this function is called, events have already been processed
    // and actions collected.

    // Phase 3: Resolution
    let game_events = run_resolution_phase(world, all_actions);

    // Phase 4: Physics
    run_physics_phase(world);

    // Phase 5: Capture
    let snapshot = capture_snapshot(world, game_events);

    // Phase 6: Win check
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

        // Robot 0 heading is 0° (right), so x should increase
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
        world.robots[0].gun_heat = 0.0; // Cool the gun

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
                actions: vec![
                    RobotAction::SetSpeed(3.0),
                    RobotAction::SetSpeed(7.0), // should be ignored
                ],
            },
            PlayerActions::default(),
        ];

        run_tick(&mut world, &actions);
        assert!((world.robots[0].speed - 3.0).abs() < 0.001);
    }

    #[test]
    fn test_gun_heat_prevents_shooting() {
        let mut world = test_world_2v2();
        // gun_heat starts at 1.0

        let actions = vec![
            PlayerActions {
                actions: vec![RobotAction::Shoot(1.0)],
            },
            PlayerActions::default(),
        ];

        run_tick(&mut world, &actions);
        assert_eq!(world.bullets.len(), 0); // Can't shoot, gun is hot
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
    fn test_scan_finds_enemy_in_arc() {
        let world = test_world_2v2();
        // Robot 0 at x=100 heading 0°, Robot 1 at x=550 — directly ahead
        let dist = compute_scan(&world, 0);
        assert!(dist > 0.0);
        assert!((dist - 450.0).abs() < 1.0);
    }

    #[test]
    fn test_scan_misses_enemy_outside_arc() {
        let mut world = test_world_2v2();
        world.robots[0].heading = 90.0; // Facing up, enemy is to the right
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
            x: 799.0,
            y: 300.0,
            heading: 0.0,
            speed: BULLET_SPEED,
            power: 1.0,
        });

        run_physics_phase(&mut world);
        assert_eq!(world.bullets.len(), 0);
    }
}
