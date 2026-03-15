use crate::world::*;

#[derive(Debug)]
pub struct BulletHit {
    pub bullet_index: usize,
    pub robot_id: usize,
    pub damage: f64,
    pub power: f64,
    pub shooter_id: usize,
}

#[derive(Debug)]
pub struct WallCollision {
    pub robot_id: usize,
    pub x: f64,
    pub y: f64,
}

#[derive(Debug)]
pub struct RobotCollision {
    pub robot_a: usize,
    pub robot_b: usize,
    pub x: f64,
    pub y: f64,
}

fn distance(x1: f64, y1: f64, x2: f64, y2: f64) -> f64 {
    ((x2 - x1).powi(2) + (y2 - y1).powi(2)).sqrt()
}

pub fn detect_bullet_robot_collisions(world: &GameWorld) -> Vec<BulletHit> {
    let mut hits = Vec::new();
    for (bi, bullet) in world.bullets.iter().enumerate() {
        for robot in &world.robots {
            if !robot.alive || robot.team == bullet.owner_team {
                continue;
            }
            if distance(bullet.x, bullet.y, robot.x, robot.y) < ROBOT_RADIUS {
                hits.push(BulletHit {
                    bullet_index: bi,
                    robot_id: robot.id,
                    damage: bullet.power * BULLET_DAMAGE_MULTIPLIER,
                    power: bullet.power,
                    shooter_id: bullet.owner_id,
                });
            }
        }
    }
    hits
}

pub fn detect_robot_wall_collisions(world: &GameWorld) -> Vec<WallCollision> {
    let mut collisions = Vec::new();
    for robot in &world.robots {
        if !robot.alive {
            continue;
        }
        if robot.x <= ROBOT_RADIUS
            || robot.x >= world.arena_width - ROBOT_RADIUS
            || robot.y <= ROBOT_RADIUS
            || robot.y >= world.arena_height - ROBOT_RADIUS
        {
            collisions.push(WallCollision {
                robot_id: robot.id,
                x: robot.x,
                y: robot.y,
            });
        }
    }
    collisions
}

pub fn detect_robot_robot_collisions(world: &GameWorld) -> Vec<RobotCollision> {
    let mut collisions = Vec::new();
    for i in 0..world.robots.len() {
        for j in (i + 1)..world.robots.len() {
            let a = &world.robots[i];
            let b = &world.robots[j];
            if !a.alive || !b.alive {
                continue;
            }
            if distance(a.x, a.y, b.x, b.y) < ROBOT_RADIUS * 2.0 {
                let mid_x = (a.x + b.x) / 2.0;
                let mid_y = (a.y + b.y) / 2.0;
                collisions.push(RobotCollision {
                    robot_a: a.id,
                    robot_b: b.id,
                    x: mid_x,
                    y: mid_y,
                });
            }
        }
    }
    collisions
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::tick::test_world_2v2;

    #[test]
    fn test_bullet_hits_robot() {
        let mut world = test_world_2v2();
        world.bullets.push(Bullet {
            owner_id: 0,
            owner_team: 0,
            x: world.robots[1].x,
            y: world.robots[1].y,
            heading: 0.0,
            speed: BULLET_SPEED,
            power: 1.0,
        });
        let hits = detect_bullet_robot_collisions(&world);
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].robot_id, 1);
        assert_eq!(hits[0].damage, 4.0);
    }

    #[test]
    fn test_bullet_doesnt_hit_teammate() {
        let mut world = test_world_2v2();
        world.bullets.push(Bullet {
            owner_id: 0,
            owner_team: 0,
            x: 100.0,
            y: 300.0,
            heading: 0.0,
            speed: BULLET_SPEED,
            power: 1.0,
        });
        let hits = detect_bullet_robot_collisions(&world);
        assert_eq!(hits.len(), 0);
    }

    #[test]
    fn test_wall_collision_at_boundary() {
        let mut world = test_world_2v2();
        world.robots[0].x = 5.0;
        let collisions = detect_robot_wall_collisions(&world);
        assert_eq!(collisions.len(), 1);
        assert_eq!(collisions[0].robot_id, 0);
    }

    #[test]
    fn test_wall_collision_on_exact_arena_border() {
        let mut world = test_world_2v2();
        world.robots[0].x = ROBOT_RADIUS;
        let collisions = detect_robot_wall_collisions(&world);
        assert_eq!(collisions.len(), 1);
        assert_eq!(collisions[0].robot_id, 0);

        world.robots[0].x = world.arena_width - ROBOT_RADIUS;
        let collisions = detect_robot_wall_collisions(&world);
        assert_eq!(collisions.len(), 1);
        assert_eq!(collisions[0].robot_id, 0);
    }

    #[test]
    fn test_robot_robot_collision() {
        let mut world = test_world_2v2();
        world.robots[0].x = 400.0;
        world.robots[0].y = 300.0;
        world.robots[1].x = 420.0;
        world.robots[1].y = 300.0;
        let collisions = detect_robot_robot_collisions(&world);
        assert_eq!(collisions.len(), 1);
    }
}
