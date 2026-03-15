use axum::http::StatusCode;
use axum::response::Json;
use std::collections::HashSet;

use crate::routes::{error_response, RunRequest, RunResponse, SpawnPointRequest};

const MAX_ROBOTS: usize = 16;
const MAX_SOURCE_BYTES: usize = 64 * 1024;
const MAX_ALLOWED_TICKS: u32 = 100_000;

pub struct ValidatedRobot {
    pub name: String,
    pub source: String,
    pub team: u8,
    pub spawn: Option<engine::world::SpawnPoint>,
}

pub struct ValidatedRequest {
    pub robots: Vec<ValidatedRobot>,
    pub max_ticks: u32,
}

pub fn validate_run_request(
    req: &RunRequest,
) -> Result<ValidatedRequest, (StatusCode, Json<RunResponse>)> {
    if req.robots.is_empty() {
        return Err(error_response(StatusCode::BAD_REQUEST, "No robots provided"));
    }

    if req.robots.len() > MAX_ROBOTS {
        return Err(error_response(
            StatusCode::BAD_REQUEST,
            &format!("Too many robots (max {})", MAX_ROBOTS),
        ));
    }

    let mut teams_in_match: HashSet<u8> = HashSet::new();

    for entry in &req.robots {
        if entry.team >= engine::world::MAX_TEAMS {
            return Err(error_response(
                StatusCode::BAD_REQUEST,
                &format!(
                    "Team id for '{}' must be in range 0..{}",
                    entry.name,
                    engine::world::MAX_TEAMS - 1
                ),
            ));
        }

        teams_in_match.insert(entry.team);

        if entry.source.len() > MAX_SOURCE_BYTES {
            return Err(error_response(
                StatusCode::BAD_REQUEST,
                &format!(
                    "Source for '{}' exceeds {} KB limit",
                    entry.name,
                    MAX_SOURCE_BYTES / 1024
                ),
            ));
        }

        if let Some(spawn) = &entry.spawn {
            validate_spawn_point(&entry.name, spawn)?;
        }
    }

    if teams_in_match.len() > engine::world::MAX_TEAMS as usize {
        return Err(error_response(
            StatusCode::BAD_REQUEST,
            &format!(
                "Too many teams in a single match (max {})",
                engine::world::MAX_TEAMS
            ),
        ));
    }

    let max_ticks = req.max_ticks.unwrap_or(engine::world::MAX_TICKS);

    if max_ticks == 0 {
        return Err(error_response(
            StatusCode::BAD_REQUEST,
            "max_ticks must be at least 1",
        ));
    }

    if max_ticks > MAX_ALLOWED_TICKS {
        return Err(error_response(
            StatusCode::BAD_REQUEST,
            &format!("max_ticks exceeds limit ({})", MAX_ALLOWED_TICKS),
        ));
    }

    let robots = req
        .robots
        .iter()
        .map(|entry| ValidatedRobot {
            name: entry.name.clone(),
            source: entry.source.clone(),
            team: entry.team,
            spawn: entry.spawn.as_ref().map(|s| engine::world::SpawnPoint {
                x: s.x,
                y: s.y,
                heading: s.heading,
            }),
        })
        .collect();

    Ok(ValidatedRequest { robots, max_ticks })
}

fn validate_spawn_point(
    robot_name: &str,
    spawn: &SpawnPointRequest,
) -> Result<(), (StatusCode, Json<RunResponse>)> {
    if !spawn.x.is_finite() || !spawn.y.is_finite() {
        return Err(error_response(
            StatusCode::BAD_REQUEST,
            &format!("Spawn for '{}' must be finite coordinates", robot_name),
        ));
    }

    if spawn.x < engine::world::ROBOT_RADIUS
        || spawn.x > engine::world::ARENA_WIDTH - engine::world::ROBOT_RADIUS
        || spawn.y < engine::world::ROBOT_RADIUS
        || spawn.y > engine::world::ARENA_HEIGHT - engine::world::ROBOT_RADIUS
    {
        return Err(error_response(
            StatusCode::BAD_REQUEST,
            &format!("Spawn for '{}' is outside arena bounds", robot_name),
        ));
    }

    if let Some(heading) = spawn.heading {
        if !heading.is_finite() {
            return Err(error_response(
                StatusCode::BAD_REQUEST,
                &format!("Spawn heading for '{}' must be finite", robot_name),
            ));
        }
    }

    Ok(())
}
