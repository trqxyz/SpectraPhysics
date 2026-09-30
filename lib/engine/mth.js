'use strict'
// Port of net.minecraft.util.Mth pieces that affect movement results bit-for-bit.

const f32 = Math.fround

const SIN = new Float32Array(65536)
for (let i = 0; i < 65536; i++) SIN[i] = Math.sin(i * Math.PI * 2 / 65536)

const F_10430 = f32(10430.378)
const F_16384 = f32(16384)
const DEG_TO_RAD_F = f32(Math.PI / 180) // (float)Math.PI / 180F

function sin (value) {
  return SIN[Math.trunc(f32(f32(value) * F_10430)) & 65535]
}

function cos (value) {
  return SIN[Math.trunc(f32(f32(f32(value) * F_10430) + F_16384)) & 65535]
}

// yRot (float degrees) -> radians exactly like `yRot * ((float)Math.PI / 180F)`
function degToRadF (deg) {
  return f32(f32(deg) * DEG_TO_RAD_F)
}

function clamp (v, lo, hi) {
  return v < lo ? lo : (v > hi ? hi : v)
}

// Mth.equal(double, double) uses 1.0E-5F
const EQ_EPS = f32(1.0e-5)
function equal (a, b) {
  return Math.abs(b - a) < EQ_EPS
}

function wrapDegrees (deg) {
  let d = deg % 360
  if (d >= 180) d -= 360
  if (d < -180) d += 360
  return d
}

function lengthSqr (x, y, z) {
  return x * x + y * y + z * z
}

module.exports = { f32, sin, cos, degToRadF, clamp, equal, wrapDegrees, lengthSqr }
