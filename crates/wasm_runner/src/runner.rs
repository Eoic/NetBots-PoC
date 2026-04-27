use anyhow::Result;
use wasmtime::*;

use engine::world::RobotAction;

use crate::linker::{create_linker, RobotState};
use crate::sandbox::{validate_wasm_exports, FUEL_PER_CALL};

pub struct RobotRunner {
    store: Store<RobotState>,
    instance: Instance,
    has_on_hit: bool,
    has_on_collision: bool,
}

impl RobotRunner {
    pub fn new(wasm_bytes: &[u8], robot_id: usize) -> Result<Self> {
        let mut config = Config::new();
        config.consume_fuel(true);
        let engine = Engine::new(&config)?;

        let module = Module::new(&engine, wasm_bytes)?;
        let has_on_hit = module.exports().any(|e| e.name() == "on_hit");
        let has_on_collision = module.exports().any(|e| e.name() == "on_collision");
        validate_wasm_exports(&module)?;

        let linker = create_linker(&engine)?;
        let mut store = Store::new(&engine, RobotState::new(robot_id));
        store.set_fuel(FUEL_PER_CALL)?;

        let instance = linker.instantiate(&mut store, &module)?;

        Ok(Self {
            store,
            instance,
            has_on_hit,
            has_on_collision,
        })
    }

    pub fn take_logs(&mut self) -> Vec<String> {
        std::mem::take(&mut self.store.data_mut().logs)
    }

    pub fn has_trapped(&self) -> bool {
        self.store.data().trapped
    }

    fn refuel(&mut self) -> Result<()> {
        let _ = self.store.get_fuel()?;
        self.store.set_fuel(FUEL_PER_CALL)?;
        Ok(())
    }

    fn handle_call_result(&mut self, context: &str, result: anyhow::Result<()>) {
        if let Err(error) = result {
            if error
                .downcast_ref::<Trap>()
                .is_some_and(|t| *t == Trap::OutOfFuel)
            {
                eprintln!(
                    "[robot {}] out of fuel on {}",
                    self.store.data().robot_id,
                    context
                );
            } else {
                self.store
                    .data_mut()
                    .logs
                    .push(format!("WASM trap: {}", error));
                self.store.data_mut().trapped = true;
            }
        }
    }

    #[allow(clippy::too_many_arguments)]
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
            .get_typed_func::<(u32, f64, f64, f64, f64, f64, f64), ()>(
                &mut self.store,
                "on_tick",
            )?;

        let result = on_tick.call(
            &mut self.store,
            (tick, energy, x, y, heading, speed, gun_heat),
        );

        self.handle_call_result(&format!("tick {}", tick), result);

        Ok(self.store.data().actions.clone())
    }

    pub fn call_on_hit(&mut self, damage: f64) -> Result<Vec<RobotAction>> {
        self.store.data_mut().clear_actions();

        if !self.has_on_hit {
            return Ok(self.store.data().actions.clone());
        }

        self.refuel()?;

        let on_hit = self
            .instance
            .get_typed_func::<(f64,), ()>(&mut self.store, "on_hit")?;

        let result = on_hit.call(&mut self.store, (damage,));
        self.handle_call_result("on_hit", result);
        Ok(self.store.data().actions.clone())
    }

    pub fn call_on_collision(&mut self, kind: i32, x: f64, y: f64) -> Result<Vec<RobotAction>> {
        self.store.data_mut().clear_actions();

        if !self.has_on_collision {
            return Ok(self.store.data().actions.clone());
        }

        self.refuel()?;

        let on_collision = self
            .instance
            .get_typed_func::<(i32, f64, f64), ()>(&mut self.store, "on_collision")?;

        let result = on_collision.call(&mut self.store, (kind, x, y));
        self.handle_call_result("on_collision", result);

        Ok(self.store.data().actions.clone())
    }
}
