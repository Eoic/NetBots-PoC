mod compiler;
mod match_runner;
mod routes;

use axum::routing::{get, post};
use axum::Router;
use tower_http::cors::CorsLayer;
use tower_http::services::ServeDir;

#[tokio::main]
async fn main() {
    let app = Router::new()
        .route("/api/run", post(routes::run))
        .route("/", get(routes::index))
        .nest_service("/static", ServeDir::new("crates/web/static"))
        .layer(CorsLayer::permissive());

    let listener = tokio::net::TcpListener::bind("0.0.0.0:3000")
        .await
        .expect("Failed to bind to port 3000");

    println!("NetBots server running on http://localhost:3000");

    axum::serve(listener, app).await.expect("Server failed");
}
