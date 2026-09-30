'use strict'

const AABB = require('../aabb')
const { f32 } = require('../mth')

const F_098 = f32(0.98)
const F_08 = f32(0.8)
const F_09 = f32(0.9)
const F_005 = f32(0.05)
const F_1EM5 = f32(1.0e-5)
const LONG_MOVE = f32(0.99999) * f32(0.99999)
const HALF_WIDTH = f32(0.3)

const STUCK = {
  cobweb: { x: 0.25, y: F_005, z: 0.25 },
  cobwebWeaving: { x: 0.5, y: 0.25, z: 0.5 },
  berryBush: { x: F_08, y: 0.75, z: F_08 },
  powderSnow: { x: F_09, y: 1.5, z: F_09 }
}

function makeStuck (player, multiplier) {
  player.fallDistance = 0
  player.stuck = multiplier
}

// 1.21.2 moved block effects after gravity and drag; honey keeps its old numbers by converting back and forth
const oldDeltaY = (player, vy) => player.V.blockEffectsAfterTravel ? vy / F_098 + 0.08 : vy
const newDeltaY = (player, vy) => player.V.blockEffectsAfterTravel ? (vy - 0.08) * F_098 : vy

function honeySlide (player, bx, by, bz) {
  if (player.onGround) return
  if (player.pos.y > by + 0.9375 - 1.0e-7) return
  const vy = oldDeltaY(player, player.vel.y)
  if (vy >= -0.08) return
  const dx = Math.abs(bx + 0.5 - player.pos.x)
  const dz = Math.abs(bz + 0.5 - player.pos.z)
  const edge = 0.4375 + HALF_WIDTH
  if (!(dx + 1.0e-7 > edge || dz + 1.0e-7 > edge)) return
  if (vy < -0.13) {
    const k = -0.05 / vy
    player.vel.x *= k
    player.vel.z *= k
  }
  player.vel.y = newDeltaY(player, -0.05)
  player.fallDistance = 0
}

function bubbleColumn (player, block, bx, by, bz) {
  const surface = player.world.blockAt(bx, by + 1, bz).isAir
  const vy = player.vel.y
  if (block.bubbleDrag) player.vel.y = surface ? Math.max(-0.9, vy - 0.03) : Math.max(-0.3, vy - 0.03)
  else player.vel.y = surface ? Math.min(1.8, vy + 0.1) : Math.min(0.7, vy + 0.06)
  player.fallDistance = 0
}

function onInsideBlock (player, block, bx, by, bz, withVelocityEffects) {
  if (block.isCobweb) {
    makeStuck(player, player.env.effect('weaving') != null ? STUCK.cobwebWeaving : STUCK.cobweb)
  } else if (block.isBerryBush) {
    makeStuck(player, STUCK.berryBush)
  } else if (block.isPowderSnow) {
    if (bx === Math.floor(player.pos.x) && by === Math.floor(player.pos.y) && bz === Math.floor(player.pos.z)) {
      makeStuck(player, STUCK.powderSnow)
    }
  } else if (block.isBubbleColumn) {
    if (withVelocityEffects) bubbleColumn(player, block, bx, by, bz)
  } else if (block.isHoney) {
    honeySlide(player, bx, by, bz)
  }
}

function forEachBlockIn (box, visit) {
  const x0 = Math.floor(box.minX); const x1 = Math.floor(box.maxX)
  const y0 = Math.floor(box.minY); const y1 = Math.floor(box.maxY)
  const z0 = Math.floor(box.minZ); const z1 = Math.floor(box.maxZ)
  for (let x = x0; x <= x1; x++) {
    for (let y = y0; y <= y1; y++) {
      for (let z = z0; z <= z1; z++) visit(x, y, z)
    }
  }
}

function settleStuck (player) {
  if (player.abilities.flying) player.stuck = null
}

// Entity#checkInsideBlocks, before 1.21.2: runs inside Entity#move against the new box
function checkInsideBlocksLegacy (player) {
  const box = player.bb().deflate(player.V.insideBlockDeflate)
  forEachBlockIn(box, (x, y, z) => {
    const block = player.world.blockAt(x, y, z)
    if (!block.isAir) onInsideBlock(player, block, x, y, z, true)
  })
  settleStuck(player)
}

// voxel walk of the box corner between two points, used for moves longer than a block
function blocksAlongTravel (from, to, box, out) {
  const dx = to.x - from.x; const dy = to.y - from.y; const dz = to.z - from.z
  const start = { x: box.minX - dx, y: box.minY - dy, z: box.minZ - dz }
  let cx = Math.floor(start.x); let cy = Math.floor(start.y); let cz = Math.floor(start.z)
  const sx = Math.sign(dx); const sy = Math.sign(dy); const sz = Math.sign(dz)
  const tx = sx === 0 ? Infinity : sx / dx
  const ty = sy === 0 ? Infinity : sy / dy
  const tz = sz === 0 ? Infinity : sz / dz
  const frac = (v) => v - Math.floor(v)
  let nx = tx * (sx > 0 ? 1 - frac(start.x) : frac(start.x))
  let ny = ty * (sy > 0 ? 1 - frac(start.y) : frac(start.y))
  let nz = tz * (sz > 0 ? 1 - frac(start.z) : frac(start.z))
  const sizeX = box.maxX - box.minX; const sizeY = box.maxY - box.minY; const sizeZ = box.maxZ - box.minZ
  for (let steps = 0; (nx <= 1 || ny <= 1 || nz <= 1) && steps <= 16; steps++) {
    if (nx < ny) {
      if (nx < nz) { cx += sx; nx += tx } else { cz += sz; nz += tz }
    } else if (ny < nz) { cy += sy; ny += ty } else { cz += sz; nz += tz }
    forEachBlockIn(new AABB(cx, cy, cz, cx + sizeX, cy + sizeY, cz + sizeZ), (x, y, z) => out.add(`${x},${y},${z}`))
  }
}

// Entity#applyEffectsFromBlocks, 1.21.2+: after travel, along every movement made this tick
function applyEffectsAfterTravel (player) {
  if (!player.V.blockEffectsAfterTravel) return
  player.stuck = null
  const end = { ...player.pos }
  const moves = player.V.blockEffectsPerAxis && player.movesThisTick.length ? [...player.movesThisTick] : [{ from: player.tickStart, to: end }]
  const last = moves[moves.length - 1].to
  if ((last.x - end.x) ** 2 + (last.y - end.y) ** 2 + (last.z - end.z) ** 2 > 9.9999994e-11) moves.push({ from: last, to: end })
  const visited = new Set()
  for (const { from, to } of moves) {
    const endBox = player.bbAt(to.x, to.y, to.z).deflate(F_1EM5)
    const keys = new Set()
    forEachBlockIn(endBox, (x, y, z) => keys.add(`${x},${y},${z}`))
    const lengthSq = (to.x - from.x) ** 2 + (to.y - from.y) ** 2 + (to.z - from.z) ** 2
    const far = lengthSq >= LONG_MOVE
    if (player.V.blockEffectsPerAxis && lengthSq > 0) {
      forEachBlockIn(player.bbAt(from.x, from.y, from.z).deflate(F_1EM5), (x, y, z) => keys.add(`${x},${y},${z}`))
    }
    if (far) blocksAlongTravel(from, to, endBox, keys)
    for (const key of keys) {
      if (visited.has(key)) continue
      visited.add(key)
      const [x, y, z] = key.split(',').map(Number)
      const block = player.world.blockAt(x, y, z)
      if (block.isAir) continue
      const inEndBox = endBox.intersectsBox([x, y, z, x + 1, y + 1, z + 1])
      onInsideBlock(player, block, x, y, z, far || inEndBox)
    }
  }
  player.movesThisTick.length = 0
  settleStuck(player)
}

module.exports = { checkInsideBlocksLegacy, applyEffectsAfterTravel }
