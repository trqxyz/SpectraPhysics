'use strict'
// How the pathfinder sees blocks: where a player can stand (with slabs, stairs and carpets), whether its
// body fits, water and climbables, what hurts, and what can be dug and how long that takes.

const { COST } = require('./costs')

const PLAYER_HEIGHT = 1.8
const STEP = 0.6
const MAX_FLOOR = 1 // never stand on fences and walls (1.5 high)

// entering these hurts, traps or slows the player for a long time
const DANGER = new Set([
  'lava', 'fire', 'soul_fire', 'cactus', 'sweet_berry_bush', 'wither_rose', 'campfire', 'soul_campfire',
  'magma_block', 'powder_snow', 'nether_portal', 'end_portal', 'end_gateway', 'pointed_dripstone'
])
const SLOW = new Set(['cobweb', 'soul_sand', 'honey_block', 'web'])
const NO_BREAK = new Set([
  'chest', 'trapped_chest', 'ender_chest', 'barrel', 'spawner', 'trial_spawner', 'vault', 'beacon',
  'furnace', 'blast_furnace', 'smoker', 'hopper', 'dispenser', 'dropper', 'brewing_stand', 'lectern'
])
const FALLING = /^(sand|red_sand|gravel|suspicious_sand|suspicious_gravel|.*_concrete_powder|anvil|chipped_anvil|damaged_anvil|pointed_dripstone|scaffolding)$/

class Terrain {
  constructor (world, options = {}) {
    this.world = world
    this.registry = world.registry
    this.Block = world.Block
    this.options = options
    this.traits = []
    this.digTicks = new Map()
    this.tools = [null]
    this.effects = {}
  }

  // the inventory and effects at planning time decide which blocks are worth digging
  prepare (bot) {
    this.digTicks.clear()
    const seen = new Set()
    this.tools = [null]
    for (const item of bot.inventory?.items?.() ?? []) {
      if (seen.has(item.type)) continue
      seen.add(item.type)
      this.tools.push(item)
    }
    this.effects = bot.entity?.effects ?? {}
  }

  trait (stateId) {
    let t = this.traits[stateId]
    if (t) return t
    const info = this.world.info(stateId)
    let top = 0
    for (const s of info.shapes) top = Math.max(top, s[4])
    const block = this.registry.blocksByStateId?.[stateId]
    // ladders and vines are thin panels against the wall: the body fits beside them
    t = {
      name: info.name,
      empty: info.shapes.length === 0 || info.climbable || info.isLadder,
      top,
      water: info.fluid?.type === 'water' && !info.shapes.length,
      waterlogged: info.fluid?.type === 'water',
      lava: info.fluid?.type === 'lava',
      climbable: info.climbable || info.isLadder,
      danger: DANGER.has(info.name) || info.fluid?.type === 'lava',
      slow: SLOW.has(info.name),
      falls: FALLING.test(info.name),
      breakable: !!block && block.diggable !== false && (block.hardness ?? 0) >= 0 && !NO_BREAK.has(info.name) && !info.fluid,
      stateId
    }
    this.traits[stateId] = t
    return t
  }

  // null when the chunk is not loaded
  at (x, y, z) {
    const s = this.world.stateAt(x, y, z)
    if (s == null) return null
    return this.trait(s)
  }

  // ticks to break a block with the best tool in the inventory
  digCost (t) {
    if (!t.breakable) return Infinity
    let ticks = this.digTicks.get(t.stateId)
    if (ticks !== undefined) return ticks
    ticks = Infinity
    let block
    try { block = this.Block.fromStateId(t.stateId, 0) } catch { block = null }
    if (block) {
      const effects = this.effects
      for (const tool of this.tools) {
        let enchants = []
        try { enchants = tool?.enchants ?? [] } catch { enchants = [] }
        const ms = block.digTime(tool ? tool.type : null, false, false, false, Array.isArray(enchants) ? enchants : [], effects)
        if (ms < Infinity) ticks = Math.min(ticks, Math.ceil(ms / 50))
      }
    }
    if (this.options.maxDigTicks != null && ticks > this.options.maxDigTicks) ticks = Infinity
    this.digTicks.set(t.stateId, ticks)
    return ticks
  }

  // feet height when standing with the feet in block y, or null
  floorAt (x, y, z) {
    const feet = this.at(x, y, z)
    if (!feet || feet.danger) return null
    if (!feet.empty) {
      if (feet.top <= 0.5) return y + feet.top
      return null
    }
    const below = this.at(x, y - 1, z)
    if (!below || below.danger || below.empty || below.top <= 0.5 || below.top > MAX_FLOOR) return null
    return y - 1 + below.top
  }

  // the floor the block under the feet would give once the feet and head blocks are dug out
  floorUnder (x, y, z) {
    const below = this.at(x, y - 1, z)
    if (!below || below.danger || below.empty || below.top <= 0.5 || below.top > MAX_FLOOR) return null
    return y - 1 + below.top
  }

  // the body fits between `floor` and floor + 1.8 in column x/z; blocks in the way are added to `dig`
  bodyFits (x, floor, z, dig) {
    const y0 = Math.floor(floor)
    const y1 = Math.floor(floor + PLAYER_HEIGHT - 1e-6)
    for (let y = y0; y <= y1; y++) {
      const t = this.at(x, y, z)
      if (!t) return false
      if (t.danger) return false
      if (t.empty) continue
      if (y === y0 && y + t.top <= floor + 1e-6) continue // what we stand on
      if (!dig || !this.canDigAt(x, y, z, t)) return false
      dig.push([x, y, z, t])
    }
    return true
  }

  // digging must not let liquid or a falling block into the hole
  canDigAt (x, y, z, t) {
    if (!this.options.canDig || !t.breakable) return false
    if (this.digCost(t) === Infinity) return false
    const above = this.at(x, y + 1, z)
    if (!above || above.falls || above.lava || above.water) return false
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const side = this.at(x + dx, y, z + dz)
      if (!side || side.lava || side.water) return false
    }
    return true
  }

  isWater (x, y, z) {
    const t = this.at(x, y, z)
    return !!t && t.water
  }

  isClimbable (x, y, z) {
    const t = this.at(x, y, z)
    return !!t && t.climbable
  }

  // extra ticks for standing somewhere slow
  floorPenalty (x, floor, z) {
    const t = this.at(x, Math.floor(floor) - (floor % 1 === 0 ? 1 : 0), z)
    return t && t.slow ? COST.avoid : 0
  }
}

module.exports = { Terrain, PLAYER_HEIGHT, STEP }
