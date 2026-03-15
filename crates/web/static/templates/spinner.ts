export function on_tick(
  tick: u32, energy: f64,
  x: f64, y: f64, heading: f64, speed: f64, gun_heat: f64
): void {
  rotate(7.0);

  if (gun_heat == 0.0) {
    shoot(1.0);
  }
}

export function on_hit(damage: f64): void {}

export function on_collision(kind: i32, x: f64, y: f64): void {
  set_speed(3.0);
}
