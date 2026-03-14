// Chaser: actively hunts the enemy — scans, closes in, fires, and avoids walls.

@external("env", "set_speed") declare function set_speed(speed: f64): void;
@external("env", "rotate") declare function rotate(angle: f64): void;
@external("env", "shoot") declare function shoot(power: f64): void;
@external("env", "scan") declare function scan(): f64;
@external("env", "log_i32") declare function log_i32(val: i32): void;
@external("env", "log_f64") declare function log_f64(val: f64): void;

// Alternating scan direction: +1 or -1
let scanDir: f64 = 1.0;

export function on_tick(
  tick: u32, energy: f64,
  x: f64, y: f64, heading: f64, speed: f64, gun_heat: f64
): void {
  const dist: f64 = scan();

  if (dist > 0.0) {
    // Enemy detected: engage
    if (gun_heat == 0.0) {
      if (dist < 200.0) {
        shoot(3.0);
      } else {
        shoot(1.5);
      }
    }
    set_speed(6.0);
    // Narrow sweep to track target
    rotate(scanDir * 3.0);
  } else {
    // No contact: sweep wider to search
    set_speed(4.0);
    rotate(scanDir * 12.0);
  }

  // Alternate scan direction each tick
  scanDir = -scanDir;

  // Wall avoidance near edges (arena 800x600)
  if (x < 80.0)  { rotate(-15.0); set_speed(6.0); }
  if (x > 720.0) { rotate(15.0);  set_speed(6.0); }
  if (y < 80.0)  { rotate(-12.0); set_speed(6.0); }
  if (y > 520.0) { rotate(12.0);  set_speed(6.0); }
}

export function on_hit(damage: f64): void {
  rotate(45.0);
  set_speed(8.0);
}

export function on_collision(kind: i32, x: f64, y: f64): void {
  rotate(90.0);
}
