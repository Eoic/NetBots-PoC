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

export function on_collision(kind: i32, x: f64, y: f64): void {
  rotate(-90.0);
}
