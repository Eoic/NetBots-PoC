let wallTurn: f64 = 1.0;
let huntTicks: i32 = 0;

export function on_tick(
  player: PlayerContext
): void {
  const dist: f64 = player.scan;
  if (dist > 0.0) {
    huntTicks = 10;
    if (dist > 260.0) {
      set_speed(8.0);
      rotate(wallTurn * 3.0);
    } else {
      set_speed(6.0);
      rotate(wallTurn * 6.0);
    }

    if (player.gun_heat == 0.0) {
      if (dist < 120.0) shoot(3.0);
      else shoot(1.8);
    }
    return;
  }

  if (huntTicks > 0) {
    huntTicks -= 1;
    set_speed(7.0);
    rotate(wallTurn * 5.0);
  } else {
    set_speed(6.0);
    rotate(wallTurn * 8.0);
  }
}

export function on_hit(damage: f64): void {
  wallTurn = -wallTurn;
  rotate(30.0 * wallTurn);
  set_speed(8.0);
}

export function on_collision(kind: i32, x: f64, y: f64): void {
  wallTurn = -wallTurn;
  if (kind == 0) rotate(120.0 * wallTurn);
  else rotate(80.0 * wallTurn);
  set_speed(8.0);
}
