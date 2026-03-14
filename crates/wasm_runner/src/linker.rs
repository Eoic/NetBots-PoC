use engine::world::RobotAction;
use wasmtime::{Caller, Engine, Linker};

/// State passed to WASM host functions via Wasmtime's Caller.
pub struct RobotState {
    pub robot_id: usize,
    pub actions: Vec<RobotAction>,
    pub scan_result: f64, // pre-computed before calling on_tick
}

impl RobotState {
    pub fn new(robot_id: usize) -> Self {
        Self {
            robot_id,
            actions: Vec::new(),
            scan_result: -1.0,
        }
    }

    pub fn clear_actions(&mut self) {
        self.actions.clear();
    }
}

pub fn create_linker(engine: &Engine) -> anyhow::Result<Linker<RobotState>> {
    let mut linker = Linker::new(engine);

    linker.func_wrap("env", "set_speed", |mut caller: Caller<'_, RobotState>, speed: f64| {
        caller.data_mut().actions.push(RobotAction::SetSpeed(speed));
    })?;

    linker.func_wrap("env", "rotate", |mut caller: Caller<'_, RobotState>, angle: f64| {
        caller.data_mut().actions.push(RobotAction::Rotate(angle));
    })?;

    linker.func_wrap("env", "shoot", |mut caller: Caller<'_, RobotState>, power: f64| {
        caller.data_mut().actions.push(RobotAction::Shoot(power));
    })?;

    linker.func_wrap("env", "scan", |caller: Caller<'_, RobotState>| -> f64 {
        caller.data().scan_result
    })?;

    linker.func_wrap("env", "log_i32", |_caller: Caller<'_, RobotState>, val: i32| {
        println!("[robot] i32: {}", val);
    })?;

    linker.func_wrap("env", "log_f64", |_caller: Caller<'_, RobotState>, val: f64| {
        println!("[robot] f64: {}", val);
    })?;

    Ok(linker)
}
