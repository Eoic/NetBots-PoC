let sweepDir: f64 = 1.0;
let strafeDir: f64 = 1.0;
let blindTicks: i32 = 0;
const HARD_MARGIN: f64 = 60.0;
const SOFT_MARGIN: f64 = 130.0;
const MAX_TURN: f64 = 10.0;

export function on_tick(player: PlayerContext): void {
  let desiredSpeed: f64 = 8.0;
  let desiredTurn: f64 = sweepDir * 5.5;

  if (player.x <= HARD_MARGIN) {
    desiredTurn = util.turn_toward(0.0, player.heading, MAX_TURN);
    desiredSpeed = 8.0;
  } else if (player.x >= world.arena_width - HARD_MARGIN) {
    desiredTurn = util.turn_toward(180.0, player.heading, MAX_TURN);
    desiredSpeed = 8.0;
  } else if (player.y <= HARD_MARGIN) {
    desiredTurn = util.turn_toward(270.0, player.heading, MAX_TURN);
    desiredSpeed = 8.0;
  } else if (player.y >= world.arena_height - HARD_MARGIN) {
    desiredTurn = util.turn_toward(90.0, player.heading, MAX_TURN);
    desiredSpeed = 8.0;
  } else {
    const dist: f64 = player.scan;

    if (dist > 0.0) {
      blindTicks = 0;

      if (dist > 320.0) {
        desiredSpeed = 8.0;
        desiredTurn = sweepDir * 2.4;
      } else if (dist > 160.0) {
        desiredSpeed = 8.0;
        desiredTurn = sweepDir * 1.0;
      } else if (dist > 80.0) {
        desiredSpeed = 7.2;
        desiredTurn = sweepDir * 0.4;
      } else {
        desiredSpeed = 6.5;
        desiredTurn = strafeDir * 2.0;
      }

      if (player.gun_heat == 0.0) {
        if (dist < 100.0) shoot(3.0);
        else if (dist < 200.0) shoot(2.4);
        else shoot(1.8);
      }

      if (util.chance(0.04)) strafeDir = -strafeDir;
      if (util.chance(0.03)) sweepDir = -sweepDir;
    } else {
      blindTicks += 1;
      desiredSpeed = 8.0;
      desiredTurn = blindTicks < 12 ? sweepDir * 6.0 : sweepDir * 9.0;
      if (blindTicks > 12 && blindTicks % 10 == 0) sweepDir = -sweepDir;
    }
  }

  if (player.x <= SOFT_MARGIN) {
    desiredTurn = util.turn_toward(0.0, player.heading, MAX_TURN);
    desiredSpeed = 8.0;
  } else if (player.x >= world.arena_width - SOFT_MARGIN) {
    desiredTurn = util.turn_toward(180.0, player.heading, MAX_TURN);
    desiredSpeed = 8.0;
  } else if (player.y <= SOFT_MARGIN) {
    desiredTurn = util.turn_toward(270.0, player.heading, MAX_TURN);
    desiredSpeed = 8.0;
  } else if (player.y >= world.arena_height - SOFT_MARGIN) {
    desiredTurn = util.turn_toward(90.0, player.heading, MAX_TURN);
    desiredSpeed = 8.0;
  }

  set_speed(desiredSpeed);
  rotate(desiredTurn);
}

export function on_hit(damage: f64): void {
  strafeDir = -strafeDir;
  rotate(strafeDir * util.range(20.0, 35.0));
  set_speed(8.0);
}

export function on_collision(kind: i32, x: f64, y: f64): void {
  sweepDir = -sweepDir;
  strafeDir = -strafeDir;

  if (kind == 0) {
    set_speed(-1.5);
    rotate(100.0 * sweepDir);
  } else {
    set_speed(7.5);
    rotate(45.0 * sweepDir);
  }
}
