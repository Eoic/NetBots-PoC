let rngState: u32 = 12345;

function rng(): f64 {
  rngState ^= rngState << 13;
  rngState ^= rngState >> 17;
  rngState ^= rngState << 5;
  return f64(rngState & 0x7FFFFFFF) / f64(0x7FFFFFFF);
}

export function on_tick(
  tick: u32, energy: f64,
  x: f64, y: f64, heading: f64, speed: f64, gun_heat: f64
): void {
  const dist: f64 = scan();
  rngState = rngState ^ tick ^ u32(x * 7.0) ^ u32(y * 13.0);

  if (dist > 0.0 && gun_heat == 0.0) {
    const power: f64 = 1.0 + rng() * 2.0;
    shoot(power);
  }

  const spd: f64 = 2.0 + rng() * 6.0;
  set_speed(spd);

  if (rng() < 0.15) {
    rotate(-5.0 - rng() * 5.0);
  } else {
    rotate(2.0 + rng() * 4.0);
  }

  if (x < 80.0) { rotate(-8.0); set_speed(6.0); }
  if (x > 720.0) { rotate(8.0); set_speed(6.0); }
  if (y < 80.0) { rotate(-6.0); set_speed(6.0); }
  if (y > 520.0) { rotate(6.0); set_speed(6.0); }
}

export function on_hit(damage: f64): void {
  const angle: f64 = 60.0 + rng() * 60.0;

  if (rng() < 0.5) {
    rotate(angle);
  } else {
    rotate(-angle);
  }

  set_speed(8.0);
}

export function on_collision(kind: i32, x: f64, y: f64): void {
  const angle: f64 = 90.0 + rng() * 90.0;
  rotate(angle);
  set_speed(5.0 + rng() * 3.0);
}
