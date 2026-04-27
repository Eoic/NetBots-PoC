use std::collections::HashMap;

use axum::http::StatusCode;
use axum::response::Json;

use crate::routes::{error_response, RunRequest, RunResponse, SpawnPointRequest};

const MAX_ROBOTS: usize = 16;
const MAX_FILES: usize = 50;
const MAX_TOTAL_SIZE: usize = 512 * 1024;
const MAX_FILE_SIZE: usize = 64 * 1024;
const MAX_ALLOWED_TICKS: u32 = 100_000;

pub struct ValidatedRobot {
    pub name: String,
    pub file: String,
    pub team: u8,
    pub spawn: Option<engine::world::SpawnPoint>,
}

pub struct ValidatedRequest {
    pub robots: Vec<ValidatedRobot>,
    pub files: HashMap<String, String>,
    pub max_ticks: u32,
}

#[allow(clippy::result_large_err)]
pub fn validate_run_request(
    req: &RunRequest,
) -> Result<ValidatedRequest, (StatusCode, Json<RunResponse>)> {
    if req.files.is_empty() {
        return Err(error_response(StatusCode::BAD_REQUEST, "No files provided"));
    }

    if req.files.len() > MAX_FILES {
        return Err(error_response(
            StatusCode::BAD_REQUEST,
            &format!("Too many files (max {})", MAX_FILES),
        ));
    }

    let mut total_size: usize = 0;
    for (path, content) in &req.files {
        if let Err(msg) = validate_file_path(path) {
            return Err(error_response(StatusCode::BAD_REQUEST, &msg));
        }

        if content.len() > MAX_FILE_SIZE {
            return Err(error_response(
                StatusCode::BAD_REQUEST,
                &format!("File '{}' exceeds {} KB limit", path, MAX_FILE_SIZE / 1024),
            ));
        }

        total_size += content.len();
    }

    if total_size > MAX_TOTAL_SIZE {
        return Err(error_response(
            StatusCode::BAD_REQUEST,
            &format!("Total file size exceeds {} KB limit", MAX_TOTAL_SIZE / 1024),
        ));
    }

    if req.robots.is_empty() {
        return Err(error_response(
            StatusCode::BAD_REQUEST,
            "No robots provided",
        ));
    }

    if req.robots.len() > MAX_ROBOTS {
        return Err(error_response(
            StatusCode::BAD_REQUEST,
            &format!("Too many robots (max {})", MAX_ROBOTS),
        ));
    }

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

        if !req.files.contains_key(&entry.file) {
            return Err(error_response(
                StatusCode::BAD_REQUEST,
                &format!(
                    "Entrypoint '{}' for robot '{}' not found in files",
                    entry.file, entry.name
                ),
            ));
        }

        if let Some(spawn) = &entry.spawn {
            validate_spawn_point(&entry.name, spawn)?;
        }
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
            file: entry.file.clone(),
            team: entry.team,
            spawn: entry.spawn.as_ref().map(|s| engine::world::SpawnPoint {
                x: s.x,
                y: s.y,
                heading: s.heading,
            }),
        })
        .collect();

    Ok(ValidatedRequest {
        robots,
        files: req.files.clone(),
        max_ticks,
    })
}

fn validate_file_path(path: &str) -> Result<(), String> {
    if path.is_empty() {
        return Err("Empty file path".to_string());
    }
    if path.starts_with('/') {
        return Err(format!("Absolute path not allowed: {}", path));
    }
    if path.contains('\0') {
        return Err(format!("Null byte in path: {}", path));
    }
    if path.split('/').any(|seg| seg == "..") {
        return Err(format!("Path traversal not allowed: {}", path));
    }
    if path.contains("//") || path.ends_with('/') {
        return Err(format!("Invalid path segments: {}", path));
    }
    Ok(())
}

#[allow(clippy::result_large_err)]
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
