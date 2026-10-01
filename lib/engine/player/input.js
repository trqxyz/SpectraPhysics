'use strict'

const { f32, sin, cos, degToRadF } = require('../mth')

const F_098 = f32(0.98)
const F_02 = f32(0.2)
const F_03 = f32(0.3)
const F_MIN_LENGTH = f32(1.0e-4)

const impulse = (positive, negative) => positive === negative ? 0 : (positive ? 1 : -1)

const slowedByItem = (player) => player.env.usingItem() && !player.riding

function sneakMultiplier (player) {
  return player.V.efficiencyAttributes ? f32(player.env.attribute('sneaking_speed', 0.3)) : F_03
}

// KeyboardInput + LivingEntity#aiStep scaling, 1.16 - 1.21.4
function legacyInput (player, left, forward, slow) {
  let x = left
  let z = forward
  if (slow) {
    const k = sneakMultiplier(player)
    x = f32(x * k); z = f32(z * k)
  }
  if (slowedByItem(player)) { x = f32(x * F_02); z = f32(z * F_02) }
  return [f32(x * F_098), f32(z * F_098)]
}

// LocalPlayer#modifyInput, 1.21.5+
function modernInput (player, left, forward, slow) {
  const length = f32(Math.sqrt(f32(left * left + forward * forward)))
  if (length < F_MIN_LENGTH) return [0, 0]
  let x = f32(f32(left / length) * F_098)
  let z = f32(f32(forward / length) * F_098)
  if (slowedByItem(player)) { x = f32(x * F_02); z = f32(z * F_02) }
  if (slow) {
    const k = sneakMultiplier(player)
    x = f32(x * k); z = f32(z * k)
  }
  const scaled = f32(Math.sqrt(f32(x * x + z * z)))
  if (scaled <= 0) return [x, z]
  const nx = f32(x / scaled)
  const nz = f32(z / scaled)
  const ax = Math.abs(nx)
  const az = Math.abs(nz)
  const ratio = az > ax ? f32(ax / az) : f32(az / ax)
  const toSquare = f32(Math.sqrt(f32(1 + f32(ratio * ratio))))
  const k = Math.min(f32(scaled * toSquare), 1)
  return [f32(nx * k), f32(nz * k)]
}

function readKeys (player, keys, slow) {
  const forward = impulse(keys.forward, keys.back)
  const left = impulse(keys.left, keys.right)
  const [xxa, zza] = player.V.inputModel === 'modern'
    ? modernInput(player, left, forward, slow)
    : legacyInput(player, left, forward, slow)
  if (slowedByItem(player)) player.sprintTriggerTime = 0
  player.input = {
    left: xxa,
    forward: zza,
    forwardKey: forward,
    jumping: !!keys.jump,
    shift: !!keys.sneak,
    keys: { ...keys }
  }
}

// Entity#moveRelative
function moveRelative (player, speed, ix, iy, iz) {
  const lengthSq = ix * ix + iy * iy + iz * iz
  if (lengthSq < 1.0e-7) return
  let x = ix; let y = iy; let z = iz
  if (lengthSq > 1) {
    const length = player.V.floatSqrt ? f32(Math.sqrt(lengthSq)) : Math.sqrt(lengthSq)
    if (length < player.V.normalizeEpsilon) return
    x /= length; y /= length; z /= length
  }
  x *= speed; y *= speed; z *= speed
  const r = degToRadF(player.yRot)
  const s = sin(r)
  const c = cos(r)
  player.vel.x += x * c - z * s
  player.vel.y += y
  player.vel.z += z * c + x * s
}

module.exports = { readKeys, moveRelative }
