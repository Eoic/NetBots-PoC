let scanDir: f64 = 1.0;
let ticksSinceContact: i32 = 0;

export function on_tick(
  tick: u32, energy: f64,
  x: f64, y: f64, heading: f64, speed: f64, gun_heat: f64
): void {
  const dist: f64 = scan();

  if (dist > 0.0) {
    ticksSinceContact = 0;
    if (gun_heat == 0.0) {
      if (dist < 200.0) {
        shoot(3.0);
      } else {
        shoot(1.5);
      }
    }

    set_speed(6.0);
    rotate(scanDir * 2.0);
  } else {
    ticksSinceContact += 1;
    set_speed(4.0);
    rotate(scanDir * 8.0);

    if (ticksSinceContact > 20) {
      scanDir = -scanDir;
      ticksSinceContact = 0;
    }
  }

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
