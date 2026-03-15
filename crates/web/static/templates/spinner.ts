let turnDir: f64 = 1.0;
let chargeTicks: i32 = 0;

export function on_tick(
  player: PlayerContext
): void {
  const dist: f64 = player.scan;

  if (dist > 0.0) {
    chargeTicks = 8;
    rotate(turnDir * 7.0);
    if (dist > 240.0) set_speed(7.0);
    else set_speed(5.0);

    if (player.gun_heat == 0.0) {
      if (dist < 140.0) shoot(2.8);
      else shoot(1.6);
    }
    return;
  }

  if (chargeTicks > 0) {
    chargeTicks -= 1;
    set_speed(7.0);
    rotate(turnDir * 6.0);
  } else {
    set_speed(6.0);
    rotate(turnDir * 10.0);
  }
}

export function on_hit(damage: f64): void {
  turnDir = -turnDir;
  rotate(turnDir * 28.0);
  set_speed(8.0);
}

export function on_collision(kind: i32, x: f64, y: f64): void {
  turnDir = -turnDir;
  if (kind == 0) rotate(105.0 * turnDir);
  else rotate(65.0 * turnDir);
  set_speed(8.0);
}
