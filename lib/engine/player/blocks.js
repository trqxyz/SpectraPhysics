'use strict'

const AABB = require('../aabb')
const { f32 } = require('../mth')

const ON_POS = f32(0.2)
const BELOW_MODERN = f32(0.500001)
const BELOW_LEGACY = 0.5000001

// Entity#getOnPos(yOffset)
function onPos (player, yOffset = ON_POS) {
  const { pos, world } = player
  const support = player.supportingBlock
  if (player.V.supportingBlock && support) {
    if (!(yOffset > 1.0e-5)) return support
    const block = world.blockAt(support.x, support.y, support.z)
    if (!(yOffset <= 0.5) || !block.isFenceLike) return { x: support.x, y: Math.floor(pos.y - yOffset), z: support.z }
    return support
  }
  const p = { x: Math.floor(pos.x), y: Math.floor(pos.y - yOffset), z: Math.floor(pos.z) }
  if (!player.V.supportingBlock && yOffset === ON_POS && world.blockAt(p.x, p.y, p.z).isAir) {
    if (world.blockAt(p.x, p.y - 1, p.z).isFenceLike) return { x: p.x, y: p.y - 1, z: p.z }
  }
  return p
}

function belowPos (player) {
  if (player.V.supportingBlock) return onPos(player, BELOW_MODERN)
  return { x: Math.floor(player.pos.x), y: Math.floor(player.pos.y - BELOW_LEGACY), z: Math.floor(player.pos.z) }
}

function feetBlock (player) {
  return player.world.blockAt(Math.floor(player.pos.x), Math.floor(player.pos.y), Math.floor(player.pos.z))
}

function friction (player) {
  const p = belowPos(player)
  return player.world.blockAt(p.x, p.y, p.z).friction
}

function soulSpeed (player, block) {
  return block.name === 'soul_sand' && player.V.soulSpeedBoots && player.env.bootsEnchant('soul_speed') > 0
}

function blockSpeed (player, block) {
  return soulSpeed(player, block) ? 1 : block.speedFactor
}

// Entity#getBlockSpeedFactor
function speedFactor (player) {
  if (player.abilities.flying) return 1
  const inside = feetBlock(player)
  let factor = blockSpeed(player, inside)
  const keepsOwn = inside.name === 'water' || inside.name === 'bubble_column' ||
    (!player.V.supportingBlock && inside.name === 'soul_sand')
  if (factor === 1 && !keepsOwn) {
    const p = belowPos(player)
    factor = blockSpeed(player, player.world.blockAt(p.x, p.y, p.z))
  }
  if (player.V.efficiencyAttributes) {
    const efficiency = f32(player.env.attribute('movement_efficiency', 0))
    factor = f32(factor + efficiency * (1 - factor))
  }
  return factor
}

function jumpFactor (player) {
  const inside = feetBlock(player).jumpFactor
  if (inside !== 1) return inside
  const p = belowPos(player)
  return player.world.blockAt(p.x, p.y, p.z).jumpFactor
}

function onClimbable (player) {
  const { world } = player
  const bx = Math.floor(player.pos.x)
  const by = Math.floor(player.pos.y)
  const bz = Math.floor(player.pos.z)
  const block = world.blockAt(bx, by, bz)
  if (block.climbable) return true
  if (block.isTrapdoor && (block.props.open === true || block.props.open === 'true')) {
    const below = world.blockAt(bx, by - 1, bz)
    return below.isLadder && below.props.facing === block.props.facing
  }
  return false
}

function onPowderSnowWithBoots (player) {
  return player.V.powderSnow && feetBlock(player).isPowderSnow && player.env.bootsItem() === 'leather_boots'
}

function findSupport (player, box) {
  let best = null
  let bestDistance = Infinity
  const x0 = Math.floor(box.minX) - 1; const x1 = Math.floor(box.maxX) + 1
  const y0 = Math.floor(box.minY) - 1; const y1 = Math.floor(box.maxY) + 1
  const z0 = Math.floor(box.minZ) - 1; const z1 = Math.floor(box.maxZ) + 1
  for (let x = x0; x <= x1; x++) {
    for (let y = y0; y <= y1; y++) {
      for (let z = z0; z <= z1; z++) {
        const shapes = player.world.blockAt(x, y, z).shapes
        if (!shapes.some(s => box.intersectsBox([s[0] + x, s[1] + y, s[2] + z, s[3] + x, s[4] + y, s[5] + z]))) continue
        const cx = x + 0.5 - player.pos.x
        const cy = y + 0.5 - player.pos.y
        const cz = z + 0.5 - player.pos.z
        const distance = cx * cx + cy * cy + cz * cz
        const greater = best && (y !== best.y ? y > best.y : (z !== best.z ? z > best.z : x > best.x))
        if (distance < bestDistance || (distance === bestDistance && (!best || greater))) {
          bestDistance = distance
          best = { x, y, z }
        }
      }
    }
  }
  return best
}

// Entity#checkSupportingBlock, 1.20+
function updateSupportingBlock (player, onGround, mx, mz) {
  if (!player.V.supportingBlock) return
  if (!onGround) {
    player.supportingBlock = null
    player.onGroundNoBlocks = false
    return
  }
  const bb = player.bb()
  const feet = new AABB(bb.minX, bb.minY - 1.0e-6, bb.minZ, bb.maxX, bb.minY, bb.maxZ)
  let found = findSupport(player, feet)
  if (!found && !player.onGroundNoBlocks) found = findSupport(player, feet.move(-mx, 0, -mz))
  player.supportingBlock = found
  player.onGroundNoBlocks = !found
}

module.exports = { onPos, belowPos, feetBlock, friction, speedFactor, jumpFactor, onClimbable, onPowderSnowWithBoots, updateSupportingBlock }
