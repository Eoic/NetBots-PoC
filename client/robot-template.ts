// NetBots Robot - AssemblyScript
// Available actions: set_speed, rotate, shoot, scan, log_i32, log_f64

@external("env", "set_speed")
declare function set_speed(speed: f64): void;

@external("env", "rotate")
declare function rotate(angle: f64): void;

@external("env", "shoot")
declare function shoot(power: f64): void;

@external("env", "scan")
declare function scan(): f64;

@external("env", "log_i32")
declare function log_i32(val: i32): void;

@external("env", "log_f64")
declare function log_f64(val: f64): void;

// Called every tick with your robot's current state
export function on_tick(
  tick: u32, energy: f64,
  x: f64, y: f64, heading: f64, speed: f64, gun_heat: f64
): void {
  // Scan for enemies
  const dist: f64 = scan();

  if (dist > 0.0 && gun_heat == 0.0) {
    // Enemy detected and gun is ready - fire!
    shoot(1.0);
  }

  // Move forward
  set_speed(4.0);

  // Slowly rotate to sweep the arena
  rotate(3.0);
}

// Called when your robot is hit by a bullet
export function on_hit(damage: f64): void {
  // Evade! Turn and run
  rotate(90.0);
  set_speed(8.0);
}

// Called when your robot collides with a wall (kind=0) or another robot (kind=1)
export function on_collision(kind: i32, x: f64, y: f64): void {
  // Turn away from the collision
  rotate(180.0);
  set_speed(5.0);
}
