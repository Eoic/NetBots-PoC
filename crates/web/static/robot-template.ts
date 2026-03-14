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

// Simple pseudo-random number generator (seed from tick + position)
let rngState: u32 = 12345;

function rand(): f64 {
  rngState ^= rngState << 13;
  rngState ^= rngState >> 17;
  rngState ^= rngState << 5;
  return f64(rngState & 0x7FFFFFFF) / f64(0x7FFFFFFF);
}

// Called every tick with your robot's current state
export function on_tick(
  tick: u32, energy: f64,
  x: f64, y: f64, heading: f64, speed: f64, gun_heat: f64
): void {
  // Mix tick and position into RNG for variety
  rngState = rngState ^ tick ^ u32(x * 7.0) ^ u32(y * 13.0);

  // Scan for enemies
  const dist: f64 = scan();

  if (dist > 0.0 && gun_heat == 0.0) {
    // Enemy detected and gun is ready - fire with random power
    const power: f64 = 1.0 + rand() * 2.0;
    shoot(power);
  }

  // Randomize movement: vary speed between 2 and 8
  const spd: f64 = 2.0 + rand() * 6.0;
  set_speed(spd);

  // Random rotation: sweep with occasional direction changes
  if (rand() < 0.15) {
    // 15% chance to reverse rotation direction
    rotate(-5.0 - rand() * 5.0);
  } else {
    rotate(2.0 + rand() * 4.0);
  }

  // Avoid walls: steer away if too close to edges
  if (x < 80.0) { rotate(-8.0); set_speed(6.0); }
  if (x > 720.0) { rotate(8.0); set_speed(6.0); }
  if (y < 80.0) { rotate(-6.0); set_speed(6.0); }
  if (y > 520.0) { rotate(6.0); set_speed(6.0); }
}

// Called when your robot is hit by a bullet
export function on_hit(damage: f64): void {
  // Evade with random turn angle
  const angle: f64 = 60.0 + rand() * 60.0;
  if (rand() < 0.5) {
    rotate(angle);
  } else {
    rotate(-angle);
  }
  set_speed(8.0);
}

// Called when your robot collides with a wall (kind=0) or another robot (kind=1)
export function on_collision(kind: i32, x: f64, y: f64): void {
  // Turn a random amount away from collision
  const angle: f64 = 90.0 + rand() * 90.0;
  rotate(angle);
  set_speed(5.0 + rand() * 3.0);
}
