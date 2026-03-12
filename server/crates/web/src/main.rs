mod compiler;
mod match_runner;
mod routes;
mod state;
mod ws;

use axum::routing::{get, post};
use axum::Router;
use tower_http::cors::CorsLayer;
use tower_http::services::ServeDir;

use state::AppState;

#[tokio::main]
async fn main() {
    let state = AppState::new();

    let app = Router::new()
        .route("/api/match/create", post(routes::create_match))
        .route("/api/match/{id}/join", post(routes::join_match))
        .route("/api/match/{id}/submit", post(routes::submit_code))
        .route("/api/match/{id}/status", get(routes::match_status))
        .route("/ws/match/{id}", get(ws::ws_handler))
        .nest_service("/", ServeDir::new("../client"))
        .layer(CorsLayer::permissive())
        .with_state(state);

    let listener = tokio::net::TcpListener::bind("0.0.0.0:3000")
        .await
        .expect("Failed to bind to port 3000");

    println!("NetBots server running on http://localhost:3000");

    axum::serve(listener, app).await.expect("Server failed");
}
