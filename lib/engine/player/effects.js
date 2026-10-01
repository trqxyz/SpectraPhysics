'use strict'

const { f32 } = require('../mth')
const { traverseMoves, BlockList } = require('./traversal')

const F_098 = f32(0.98)
const F_08 = f32(0.8)
const F_09 = f32(0.9)
const F_005 = f32(0.05)
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

const visited = new BlockList()

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

// Entity#applyEffectsFromBlocks, 1.21.2+: after travel, along every movement made this tick
function applyEffectsAfterTravel (player) {
  if (!player.V.blockEffectsAfterTravel) return
  player.stuck = null
  const end = { x: player.pos.x, y: player.pos.y, z: player.pos.z }
  const moves = player.V.blockEffectsPerAxis && player.movesThisTick.length ? player.movesThisTick.slice() : [{ from: player.tickStart, to: end, input: null }]
  const last = moves[moves.length - 1].to
  if ((last.x - end.x) ** 2 + (last.y - end.y) ** 2 + (last.z - end.z) ** 2 > 9.9999994e-11) moves.push({ from: last, to: end, input: null })
  visited.clear()
  traverseMoves(player, moves, (x, y, z, applyVelocity) => {
    const block = player.world.blockAt(x, y, z)
    if (block.isAir || !visited.add(x, y, z)) return
    onInsideBlock(player, block, x, y, z, applyVelocity)
  })
  player.movesThisTick.length = 0
  settleStuck(player)
}

module.exports = { checkInsideBlocksLegacy, applyEffectsAfterTravel }
