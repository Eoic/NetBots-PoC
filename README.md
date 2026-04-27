# NetBots

A proof of concept robot battle simulator.

## Requirements

- Rust
- Node.js and NPM

## Setup

Install the front-end dependencies:

```sh
cd crates/web
npm install
```

Build the front-end assets:

```sh
npm run build
```

## Run

From the repository root:

```sh
cargo run -p web
```

Open:

```text
http://localhost:3000
```

For front-end development, run the Vite watcher:

```sh
cd crates/web
npm run dev
```

Then, run the web server from the root directory:

```sh
cargo run -p web
```
