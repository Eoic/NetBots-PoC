use crate::world::*;

pub fn normalize_angle(angle: f64) -> f64 {
    let mut angle = angle;

    while angle > 180.0 {
        angle -= 360.0;
    }

    while angle < -180.0 {
        angle += 360.0;
    }

    angle
}

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
        let dy = -(other.y - robot.y);
        let angle_to = dy.atan2(dx);
        let angle_diff = normalize_angle((heading_rad - angle_to).to_degrees());

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
