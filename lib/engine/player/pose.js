'use strict'

const AABB = require('../aabb')
const { f32 } = require('../mth')

const POSES = {
  standing: { width: f32(0.6), height: f32(1.8), eye: f32(1.62) },
  crouching: { width: f32(0.6), height: f32(1.5), eye: f32(1.27) },
  swimming: { width: f32(0.6), height: f32(0.6), eye: f32(0.4) }
}

function boxFor (pose, x, y, z) {
  const d = POSES[pose]
  const r = f32(d.width / 2)
  return new AABB(x - r, y, z - r, x + r, y + d.height, z + r)
}

function canEnterPose (player, pose, x = player.pos.x, y = player.pos.y, z = player.pos.z) {
  return player.world.noCollision(boxFor(pose, x, y, z).deflate(1.0e-7))
}

// Player#updatePlayerPose, end of the tick
function updatePose (player) {
  if (!canEnterPose(player, 'swimming')) return
  let pose = 'standing'
  if (player.swimming) pose = 'swimming'
  else if (player.input.shift && !player.abilities.flying) pose = 'crouching'
  if (!canEnterPose(player, pose)) pose = canEnterPose(player, 'crouching') ? 'crouching' : 'swimming'
  player.pose = pose
}

// LocalPlayer#isMovingSlowly, decided from the previous tick's keys and pose
function isMovingSlowly (player, previousShift) {
  const crouching = !player.abilities.flying && !player.swimming && canEnterPose(player, 'crouching') &&
    (previousShift || !canEnterPose(player, 'standing'))
  const crawling = player.pose === 'swimming' && !player.isInWater()
  return crouching || crawling
}

function suffocatesAt (player, bx, bz) {
  const bb = player.bb()
  const box = new AABB(bx, bb.minY, bz, bx + 1, bb.maxY, bz + 1).deflate(1.0e-7)
  const x0 = Math.floor(box.minX); const x1 = Math.floor(box.maxX)
  const y0 = Math.floor(box.minY); const y1 = Math.floor(box.maxY)
  const z0 = Math.floor(box.minZ); const z1 = Math.floor(box.maxZ)
  for (let x = x0; x <= x1; x++) {
    for (let y = y0; y <= y1; y++) {
      for (let z = z0; z <= z1; z++) {
        const block = player.world.blockAt(x, y, z)
        if (!block.suffocating) continue
        for (const s of block.shapes) {
          if (box.intersectsBox([s[0] + x, s[1] + y, s[2] + z, s[3] + x, s[4] + y, s[5] + z])) return true
        }
      }
    }
  }
  return false
}

const SIDES = [[-1, 0], [1, 0], [0, -1], [0, 1]] // west east north south

function moveTowardsClosestSpace (player, x, z) {
  const bx = Math.floor(x)
  const bz = Math.floor(z)
  if (!suffocatesAt(player, bx, bz)) return
  const rx = x - bx
  const rz = z - bz
  let best = null
  let bestDistance = Infinity
  for (const [sx, sz] of SIDES) {
    const along = sx !== 0 ? rx : rz
    const distance = (sx > 0 || sz > 0) ? 1 - along : along
    if (distance < bestDistance && !suffocatesAt(player, bx + sx, bz + sz)) {
      bestDistance = distance
      best = [sx, sz]
    }
  }
  if (!best) return
  if (best[0] !== 0) player.vel.x = 0.1 * best[0]
  else player.vel.z = 0.1 * best[1]
}

// LocalPlayer pushes itself out of blocks it is stuck in, probing the four corners of its box
function pushOutOfBlocks (player) {
  const bb = player.bb()
  const w = (bb.maxX - bb.minX) * 0.35
  const d = (bb.maxZ - bb.minZ) * 0.35
  const { x, z } = player.pos
  moveTowardsClosestSpace(player, x - w, z + d)
  moveTowardsClosestSpace(player, x - w, z - d)
  moveTowardsClosestSpace(player, x + w, z - d)
  moveTowardsClosestSpace(player, x + w, z + d)
}

module.exports = { POSES, boxFor, canEnterPose, updatePose, isMovingSlowly, pushOutOfBlocks }
