'use strict'

const { f32, sin, cos, degToRadF, equal } = require('../mth')
const { collideLegacy, collideModern } = require('../collision')
const { onPos, speedFactor, updateSupportingBlock } = require('./blocks')
const { checkInsideBlocksLegacy } = require('./effects')
const { updateWater, updateFluidInteraction } = require('./fluids')

const F_066 = f32(0.66)
const F_1EM5 = f32(1.0e-5)
const MINOR_ANGLE = f32(0.13962634)

// Entity#maybeBackOffFromEdge (1.11+ form, which is also what server-side prediction uses)
function backOffFromEdge (player, vx, vy, vz) {
  if (player.abilities.flying || !player.input.shift || vy > 0) return [vx, vz]
  const step = player.maxUpStep()
  const bb = player.bb()
  const aboveGround = player.onGround ||
    (player.fallDistance < step && !player.world.noCollision(bb.move(0, player.fallDistance - step, 0)))
  if (!aboveGround) return [vx, vz]
  const free = (x, z) => player.world.noCollision(bb.move(x, -step, z))
  const shrink = (d) => (d < 0.05 && d >= -0.05) ? 0 : (d > 0 ? d - 0.05 : d + 0.05)
  let x = vx
  let z = vz
  while (x !== 0 && free(x, 0)) x = shrink(x)
  while (z !== 0 && free(0, z)) z = shrink(z)
  while (x !== 0 && z !== 0 && free(x, z)) { x = shrink(x); z = shrink(z) }
  return [x, z]
}

// LocalPlayer#isHorizontalCollisionMinor
function isMinorCollision (player, mx, mz) {
  const r = degToRadF(player.yRot)
  const s = sin(r)
  const c = cos(r)
  const ix = player.xxa * c - player.zza * s
  const iz = player.zza * c + player.xxa * s
  const inputSq = ix * ix + iz * iz
  const moveSq = mx * mx + mz * mz
  if (inputSq < F_1EM5 || moveSq < F_1EM5) return false
  return Math.acos((ix * mx + iz * mz) / Math.sqrt(inputSq * moveSq)) < MINOR_ANGLE
}

function landOn (player, block) {
  const bounce = !player.input.shift && (block.isSlime ? 1 : (block.isBed ? F_066 : 0))
  if (bounce && player.vel.y < 0) player.vel.y = -player.vel.y * bounce
  else if (!bounce) player.vel.y = 0
}

function stepOn (player, block) {
  if (!block.isSlime) return
  const vy = Math.abs(player.vel.y)
  if (vy < 0.1) {
    const k = 0.4 + vy * 0.2
    player.vel.x *= k
    player.vel.z *= k
  }
}

function applyPosition (player, bb, r) {
  if (player.V.posFromBoundingBox) {
    const moved = bb.move(r.x, r.y, r.z)
    player.pos.x = (moved.minX + moved.maxX) / 2
    player.pos.y = moved.minY
    player.pos.z = (moved.minZ + moved.maxZ) / 2
  } else {
    player.pos.x += r.x
    player.pos.y += r.y
    player.pos.z += r.z
  }
}

function zeroBlockedAxes (player, vx, vz, r) {
  const V = player.V
  if (V.epsilonCollisionFlags) {
    if (!equal(vx, r.x)) player.vel.x = 0
    if (!equal(vz, r.z)) player.vel.z = 0
    return
  }
  // 1.14 - 1.18.1: the second write restores X when both axes are blocked
  const x = player.vel.x
  if (vx !== r.x) player.vel.x = 0
  if (vz !== r.z) {
    if (V.keepsXOnCornerCollision) player.vel.x = x
    player.vel.z = 0
  }
}

// Entity#move(MoverType.SELF, movement)
function move (player, mx, my, mz) {
  const V = player.V
  if (player.stuck) {
    mx *= player.stuck.x; my *= player.stuck.y; mz *= player.stuck.z
    player.stuck = null
    player.vel = { x: 0, y: 0, z: 0 }
  }
  const [bx, bz] = backOffFromEdge(player, mx, my, mz)
  mx = bx; mz = bz

  const bb = player.bb()
  const from = V.blockEffectsPerAxis ? { ...player.pos } : null
  const collide = V.modernStepUp ? collideModern : collideLegacy
  const r = collide(player.world, mx, my, mz, bb, player.onGround, player.maxUpStep())
  const lengthSq = r.x * r.x + r.y * r.y + r.z * r.z
  const wantedSq = mx * mx + my * my + mz * mz
  const applies = V.modernMoveThreshold ? (lengthSq > 1.0e-7 || wantedSq - lengthSq < 1.0e-7) : lengthSq > 1.0e-7
  if (applies) applyPosition(player, bb, r)

  const xBlocked = V.epsilonCollisionFlags ? !equal(mx, r.x) : mx !== r.x
  const zBlocked = V.epsilonCollisionFlags ? !equal(mz, r.z) : mz !== r.z
  player.horizontalCollision = xBlocked || zBlocked
  player.minorHorizontalCollision = V.minorCollision && player.horizontalCollision && isMinorCollision(player, r.x, r.z)
  player.verticalCollision = my !== r.y
  player.onGround = player.verticalCollision && my < 0
  updateSupportingBlock(player, player.onGround, r.x, r.z)

  if (V.fluidRecheckInMove && !player.wasTouchingWater && !player.riding) {
    if (V.fluidInteraction) updateFluidInteraction(player)
    else updateWater(player)
  }
  if (player.onGround) {
    player.fallDistance = 0
  } else if (r.y < 0) {
    player.fallDistance = V.fallDistanceDouble ? player.fallDistance - r.y : f32(player.fallDistance - r.y)
  }

  zeroBlockedAxes(player, mx, mz, r)
  const standingOn = onPos(player)
  const block = player.world.blockAt(standingOn.x, standingOn.y, standingOn.z)
  if (my !== r.y) landOn(player, block)
  if (player.onGround && !player.input.shift) stepOn(player, block)

  if (V.blockEffectsPerAxis && applies) player.movesThisTick.push({ from, to: { ...player.pos }, input: { x: mx, y: my, z: mz } })
  if (!V.blockEffectsAfterTravel) checkInsideBlocksLegacy(player)

  const factor = speedFactor(player)
  player.vel.x *= factor
  player.vel.z *= factor
}

module.exports = { move }
