let turnDir: f64 = 1.0;

export function on_tick(
  player: PlayerContext
): void {
  const dist: f64 = player.scan;
  if (dist > 0.0) {
    rotate(turnDir * 4.0);
    set_speed(4.0);
    if (player.gun_heat == 0.0) {
      if (dist < 140.0) shoot(2.6);
      else shoot(1.4);
    }
  } else {
    rotate(turnDir * 9.0);
    set_speed(6.0);
  }
}

export function on_hit(damage: f64): void {
  turnDir = -turnDir;
  rotate(35.0 * turnDir);
  set_speed(7.0);
}

export function on_collision(kind: i32, x: f64, y: f64): void {
  turnDir = -turnDir;
  if (kind == 0) rotate(100.0 * turnDir);
  else rotate(65.0 * turnDir);
  set_speed(8.0);
}
