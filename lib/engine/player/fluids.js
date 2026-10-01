'use strict'

const WorldView = require('../world')
const { f32 } = require('../mth')

const EYE_OFFSET = f32(0.11111111)
const WATER_PUSH = 0.014
const MIN_PUSH = 0.0045000000000000005
const SIDES = [[0, -1], [0, 1], [-1, 0], [1, 0]]

// FlowingFluid#getFlow
function flowAt (world, x, y, z, fluid) {
  const own = WorldView.ownHeight(fluid)
  let dx = 0
  let dz = 0
  for (const [sx, sz] of SIDES) {
    const nx = x + sx
    const nz = z + sz
    const other = world.fluidAt(nx, y, nz)
    if (other && other.type !== fluid.type) continue
    let height = other ? WorldView.ownHeight(other) : 0
    let diff = 0
    if (height === 0) {
      const block = world.blockAt(nx, y, nz)
      if (block.shapes.length === 0 || block.fluid) {
        const below = world.fluidAt(nx, y - 1, nz)
        if (!below || below.type === fluid.type) {
          height = below ? WorldView.ownHeight(below) : 0
          if (height > 0) diff = f32(own - f32(height - f32(0.8888889)))
        }
      }
    } else {
      diff = f32(own - height)
    }
    dx += sx * diff
    dz += sz * diff
  }
  let vx = dx; let vy = 0; let vz = dz
  if (fluid.falling) {
    for (const [sx, sz] of SIDES) {
      const side = world.blockAt(x + sx, y, z + sz)
      const sideAbove = world.blockAt(x + sx, y + 1, z + sz)
      if ((side.fullCube && !side.fluid) || (sideAbove.fullCube && !sideAbove.fluid)) {
        const l = Math.sqrt(vx * vx + vz * vz)
        if (l < 1.0e-4) { vx = 0; vz = 0 } else { vx /= l; vz /= l }
        vy = -6
        break
      }
    }
  }
  const length = Math.sqrt(vx * vx + vy * vy + vz * vz)
  return length < 1.0e-4 ? { x: 0, y: 0, z: 0 } : { x: vx / length, y: vy / length, z: vz / length }
}

// Entity#updateFluidHeightAndDoFluidPushing
function touchFluid (player, type, scale) {
  const bb = player.bb().deflate(0.001)
  const x0 = Math.floor(bb.minX); const x1 = Math.ceil(bb.maxX)
  const y0 = Math.floor(bb.minY); const y1 = Math.ceil(bb.maxY)
  const z0 = Math.floor(bb.minZ); const z1 = Math.ceil(bb.maxZ)
  const pushed = !player.abilities.flying
  let height = 0
  let touching = false
  let px = 0; let py = 0; let pz = 0; let count = 0
  for (let x = x0; x < x1; x++) {
    for (let y = y0; y < y1; y++) {
      for (let z = z0; z < z1; z++) {
        const fluid = player.world.fluidAt(x, y, z)
        if (!fluid || fluid.type !== type) continue
        const top = y + player.world.fluidHeight(x, y, z, fluid)
        if (top < bb.minY) continue
        touching = true
        height = Math.max(top - bb.minY, height)
        if (!pushed) continue
        const flow = flowAt(player.world, x, y, z, fluid)
        const k = height < 0.4 ? height : 1
        px += flow.x * k; py += flow.y * k; pz += flow.z * k
        count++
      }
    }
  }
  if (px * px + py * py + pz * pz > 0) {
    px /= count; py /= count; pz /= count
    px *= scale; py *= scale; pz *= scale
    const length = Math.sqrt(px * px + py * py + pz * pz)
    if (Math.abs(player.vel.x) < 0.003 && Math.abs(player.vel.z) < 0.003 && length < MIN_PUSH) {
      px = px / length * MIN_PUSH; py = py / length * MIN_PUSH; pz = pz / length * MIN_PUSH
    }
    player.vel.x += px; player.vel.y += py; player.vel.z += pz
  }
  player.fluidHeight[type] = height
  return touching
}

// Entity#updateInWaterStateAndDoWaterCurrentPushing
function updateWater (player) {
  player.wasTouchingWater = touchFluid(player, 'water', WATER_PUSH)
  if (player.wasTouchingWater) player.fallDistance = 0
}

function updateEyes (player) {
  player.wasEyeInWater = player.eyeInWater
  const eyeY = player.pos.y + player.eyeHeight() - EYE_OFFSET
  const bx = Math.floor(player.pos.x)
  const by = Math.floor(eyeY)
  const bz = Math.floor(player.pos.z)
  const fluid = player.world.fluidAt(bx, by, bz)
  const top = fluid && fluid.type === 'water' ? by + player.world.fluidHeight(bx, by, bz, fluid) : -Infinity
  // 26.1 EntityFluidInteraction counts the surface itself as inside
  player.eyeInWater = player.V.fluidInteraction ? top >= eyeY : top > eyeY
}

const lavaPush = (player) => player.env.ultraWarm() ? 0.007 : 0.0023333333333333335

// 26.1 Entity#updateFluidInteraction: water and lava together
function updateFluidInteraction (player) {
  player.fluidHeight.water = 0
  player.fluidHeight.lava = 0
  updateWater(player)
  touchFluid(player, 'lava', lavaPush(player))
}

// Player#updateSwimming
function updateSwimming (player) {
  if (player.abilities.flying || player.riding) {
    player.swimming = false
  } else if (player.swimming) {
    player.swimming = player.sprinting && player.isInWater()
  } else {
    const fluid = player.world.fluidAt(Math.floor(player.pos.x), Math.floor(player.pos.y), Math.floor(player.pos.z))
    const feet = !player.V.swimmingNeedsFeetInWater || (fluid && fluid.type === 'water')
    player.swimming = player.sprinting && player.isUnderWater() && !!feet
  }
}

function updateFluids (player) {
  updateFluidInteraction(player)
  updateEyes(player)
  updateSwimming(player)
}

// LivingEntity#getFluidFallingAdjustedMovement
function fluidFallingAdjusted (player, gravity, falling) {
  if (player.sprinting) return
  const vy = player.vel.y
  if (falling && Math.abs(vy - 0.005) >= 0.003 && Math.abs(vy - gravity / 16) < 0.003) player.vel.y = -0.003
  else player.vel.y = vy - gravity / 16
}

module.exports = { updateFluids, updateWater, updateFluidInteraction, fluidFallingAdjusted }
