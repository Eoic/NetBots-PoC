use wasmtime::Module;

pub const FUEL_PER_CALL: u64 = 100_000;

/// Validate that a WASM module exports the required robot functions.
pub fn validate_wasm_exports(module: &Module) -> anyhow::Result<()> {
    let required_exports = ["on_tick"];

    for name in &required_exports {
        let found = module.exports().any(|e| e.name() == *name);
        if !found {
            anyhow::bail!("WASM module missing required export: {}", name);
        }
    }

    Ok(())
}
