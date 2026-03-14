// Wall-hugger: drives at speed 6 along walls, shoots opportunistically, turns right on impact.

@external("env", "set_speed") declare function set_speed(speed: f64): void;
@external("env", "rotate") declare function rotate(angle: f64): void;
@external("env", "shoot") declare function shoot(power: f64): void;
@external("env", "scan") declare function scan(): f64;
@external("env", "log_i32") declare function log_i32(val: i32): void;
@external("env", "log_f64") declare function log_f64(val: f64): void;

export function on_tick(
  tick: u32, energy: f64,
  x: f64, y: f64, heading: f64, speed: f64, gun_heat: f64
): void {
  set_speed(6.0);

  const dist: f64 = scan();
  if (dist > 0.0 && gun_heat == 0.0) {
    shoot(2.0);
  }
}

export function on_hit(damage: f64): void {
  set_speed(8.0);
}

// Both wall (kind=0) and robot (kind=1) collisions: turn right (-90 degrees)
export function on_collision(kind: i32, x: f64, y: f64): void {
  rotate(-90.0);
}
