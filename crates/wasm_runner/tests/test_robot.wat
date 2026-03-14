(module
  ;; Import host functions
  (import "env" "set_speed" (func $set_speed (param f64)))
  (import "env" "rotate" (func $rotate (param f64)))
  (import "env" "shoot" (func $shoot (param f64)))
  (import "env" "scan" (func $scan (result f64)))
  (import "env" "log_i32" (func $log_i32 (param i32)))
  (import "env" "log_f64" (func $log_f64 (param f64)))

  ;; on_tick: move forward and try to shoot
  (func $on_tick (export "on_tick")
    (param $tick i32) (param $energy f64)
    (param $x f64) (param $y f64)
    (param $heading f64) (param $speed f64) (param $gun_heat f64)

    ;; Always move forward at speed 3.0
    (call $set_speed (f64.const 3.0))

    ;; Rotate 2 degrees per tick
    (call $rotate (f64.const 2.0))

    ;; Try to shoot if gun is cool
    (f64.eq (local.get $gun_heat) (f64.const 0.0))
    (if (then
      (call $shoot (f64.const 1.0))
    ))
  )

  ;; on_hit: turn away
  (func $on_hit (export "on_hit") (param $damage f64)
    (call $rotate (f64.const 90.0))
    (call $set_speed (f64.const 5.0))
  )

  ;; on_collision: reverse direction
  (func $on_collision (export "on_collision")
    (param $kind i32) (param $x f64) (param $y f64)
    (call $rotate (f64.const 180.0))
    (call $set_speed (f64.const 4.0))
  )
)
