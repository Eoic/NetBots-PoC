use anyhow::Result;
use wasmtime::*;

use engine::world::RobotAction;

use crate::linker::{create_linker, RobotState};
use crate::sandbox::{validate_wasm_exports, FUEL_PER_CALL};

pub struct RobotRunner {
    store: Store<RobotState>,
    instance: Instance,
}

impl RobotRunner {
    pub fn new(wasm_bytes: &[u8], robot_id: usize) -> Result<Self> {
        let mut config = Config::new();
        config.consume_fuel(true);
        let engine = Engine::new(&config)?;

        let module = Module::new(&engine, wasm_bytes)?;
        validate_wasm_exports(&module)?;

        let linker = create_linker(&engine)?;
        let mut store = Store::new(&engine, RobotState::new(robot_id));
        store.set_fuel(FUEL_PER_CALL)?;

        let instance = linker.instantiate(&mut store, &module)?;

        Ok(Self { store, instance })
    }

    pub fn take_logs(&mut self) -> Vec<String> {
        std::mem::take(&mut self.store.data_mut().logs)
    }

    pub fn has_trapped(&self) -> bool {
        self.store.data().trapped
    }

    fn refuel(&mut self) -> Result<()> {
        // Drain remaining fuel and set fresh amount
        let _ = self.store.get_fuel()?;
        self.store.set_fuel(FUEL_PER_CALL)?;
        Ok(())
    }

    pub fn call_on_tick(
        &mut self,
        tick: u32,
        energy: f64,
        x: f64,
        y: f64,
        heading: f64,
        speed: f64,
        gun_heat: f64,
        scan_result: f64,
    ) -> Result<Vec<RobotAction>> {
        self.store.data_mut().clear_actions();
        self.store.data_mut().scan_result = scan_result;
        self.refuel()?;

        let on_tick = self
            .instance
            .get_typed_func::<(u32, f64, f64, f64, f64, f64, f64), ()>(&mut self.store, "on_tick")?;

        match on_tick.call(&mut self.store, (tick, energy, x, y, heading, speed, gun_heat)) {
            Ok(()) => {}
            Err(e) => {
                // If fuel exhausted, robot forfeits turn but doesn't crash
                if e.downcast_ref::<Trap>().map_or(false, |t| *t == Trap::OutOfFuel) {
                    eprintln!("[robot {}] out of fuel on tick {}", self.store.data().robot_id, tick);
                } else {
                    // Non-fuel trap — log it, set trapped flag (caller will kill robot)
                    self.store.data_mut().logs.push(format!("WASM trap: {}", e));
                    self.store.data_mut().trapped = true;
                }
            }
        }

        Ok(self.store.data().actions.clone())
    }

    pub fn call_on_hit(&mut self, damage: f64) -> Result<Vec<RobotAction>> {
        self.store.data_mut().clear_actions();
        self.refuel()?;

        let on_hit = self
            .instance
            .get_typed_func::<(f64,), ()>(&mut self.store, "on_hit")?;

        match on_hit.call(&mut self.store, (damage,)) {
            Ok(()) => {}
            Err(e) => {
                if e.downcast_ref::<Trap>().map_or(false, |t| *t == Trap::OutOfFuel) {
                    eprintln!("[robot {}] out of fuel on on_hit", self.store.data().robot_id);
                } else {
                    // Non-fuel trap — log it, set trapped flag (caller will kill robot)
                    self.store.data_mut().logs.push(format!("WASM trap: {}", e));
                    self.store.data_mut().trapped = true;
                }
            }
        }

        Ok(self.store.data().actions.clone())
    }

    pub fn call_on_collision(&mut self, kind: i32, x: f64, y: f64) -> Result<Vec<RobotAction>> {
        self.store.data_mut().clear_actions();
        self.refuel()?;

        let on_collision = self
            .instance
            .get_typed_func::<(i32, f64, f64), ()>(&mut self.store, "on_collision")?;

        match on_collision.call(&mut self.store, (kind, x, y)) {
            Ok(()) => {}
            Err(e) => {
                if e.downcast_ref::<Trap>().map_or(false, |t| *t == Trap::OutOfFuel) {
                    eprintln!("[robot {}] out of fuel on on_collision", self.store.data().robot_id);
                } else {
                    // Non-fuel trap — log it, set trapped flag (caller will kill robot)
                    self.store.data_mut().logs.push(format!("WASM trap: {}", e));
                    self.store.data_mut().trapped = true;
                }
            }
        }

        Ok(self.store.data().actions.clone())
    }
}
