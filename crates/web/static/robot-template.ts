let sweepDir: f64 = 1.0;
let strafeDir: f64 = 1.0;
let lastSeenTicks: i32 = 0;
const HARD_MARGIN: f64 = 60.0;
const SOFT_MARGIN: f64 = 130.0;
const MAX_TURN: f64 = 10.0;

function maybeFlipDirection(chance: f64): void {
  if (util.chance(chance)) {
    sweepDir = -sweepDir;
  }

  if (util.chance(chance * 0.7)) {
    strafeDir = -strafeDir;
  }
}

export function on_tick(player: PlayerContext): void {
  let desiredSpeed: f64 = 7.0;
  let desiredTurn: f64 = sweepDir * 7.0;

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
      lastSeenTicks = 0;
      if (dist > 320.0) {
        desiredSpeed = 8.0;
        desiredTurn = sweepDir * 3.0;
      } else if (dist > 140.0) {
        desiredSpeed = 7.0;
        desiredTurn = sweepDir * 2.0;
      } else {
        desiredSpeed = 5.0;
        desiredTurn = strafeDir * 8.5;
      }

      if (player.gun_heat == 0.0) {
        if (dist < 120.0) shoot(3.0);
        else if (dist < 260.0) shoot(2.2);
        else shoot(1.3);
      }

      maybeFlipDirection(0.08);
    } else {
      lastSeenTicks += 1;
      desiredSpeed = 7.0;
      if (lastSeenTicks < 10) desiredTurn = sweepDir * 6.0;
      else desiredTurn = sweepDir * 10.0;
      maybeFlipDirection(0.05);
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
  rotate(strafeDir * util.range(35.0, 55.0));
  set_speed(8.0);
}

export function on_collision(kind: i32, x: f64, y: f64): void {
  sweepDir = -sweepDir;
  strafeDir = -strafeDir;

  if (kind == 0) {
    set_speed(-2.0);
    rotate(130.0 * sweepDir);
  } else {
    set_speed(8.0);
    rotate(75.0 * sweepDir);
  }
}
