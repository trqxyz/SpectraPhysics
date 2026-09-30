'use strict'

const AABB = require('../aabb')
const { onClimbable } = require('./blocks')

// Entity#push(Entity): overlapping pushable entities nudge the player away
function pushByEntities (player) {
  if (player.riding || player.env.gameMode() === 'spectator' || onClimbable(player)) return
  const bb = player.bb()
  for (const e of player.env.nearbyEntities()) {
    const half = e.width / 2
    const box = new AABB(e.x - half, e.y, e.z - half, e.x + half, e.y + e.height, e.z + half)
    if (!(box.minX < bb.maxX && box.maxX > bb.minX && box.minY < bb.maxY && box.maxY > bb.minY && box.minZ < bb.maxZ && box.maxZ > bb.minZ)) continue
    let dx = player.pos.x - e.x
    let dz = player.pos.z - e.z
    let distance = Math.max(Math.abs(dx), Math.abs(dz))
    if (distance < 0.01) continue
    distance = Math.sqrt(distance)
    dx /= distance
    dz /= distance
    const falloff = Math.min(1, 1 / distance)
    player.vel.x += dx * falloff * 0.05
    player.vel.z += dz * falloff * 0.05
  }
}

module.exports = { pushByEntities }
