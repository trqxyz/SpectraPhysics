'use strict'
// Block / fluid access layer for the vanilla physics port.
// Reads mineflayer's world (prismarine-world) and caches per-stateId block traits.

const { f32 } = require('./mth')

const CLIMBABLE = new Set([
  'ladder', 'vine', 'scaffolding', 'weeping_vines', 'weeping_vines_plant',
  'twisting_vines', 'twisting_vines_plant', 'cave_vines', 'cave_vines_plant'
])
const WATER_SOURCES = new Set(['seagrass', 'tall_seagrass', 'kelp', 'kelp_plant', 'bubble_column'])
const FRICTION = { ice: 0.98, packed_ice: 0.98, frosted_ice: 0.98, blue_ice: 0.989, slime_block: 0.8, slime: 0.8 }
const SPEED_FACTOR = { soul_sand: 0.4, honey_block: 0.4 }
const JUMP_FACTOR = { honey_block: 0.5 }

const FULL = [0, 0, 0, 1, 1, 1]
const NO_SHAPES = []
const SNOW_FULL = [FULL]
const SNOW_FALLING = [[0, 0, 0, 1, f32(0.9), 1]]
const ABOVE_EPSILON = f32(1.0e-5)

class WorldView {
  constructor (bot) {
    this.bot = bot
    this.registry = bot.registry
    this.Block = require('prismarine-block')(bot.registry)
    let states = 1
    for (const b of bot.registry.blocksArray ?? []) states = Math.max(states, (b.maxStateId ?? b.id) + 1)
    this.infos = new Array(states).fill(null)
    this.boxes = []
    this.boxPool = []
    this.pos = { x: 0, y: 0, z: 0 }
    // collision context of the entity that is moving: { bottom, fallDistance, walksOnPowderSnow, descending }
    this.entity = null
    // while an entity ticks nothing else can change the world, so column lookups are memoised
    this.ticking = false
    this.columns = new Map()
    this.bottom = 0
    this.top = 256
  }

  beginTick (entity = null) {
    this.entity = entity
    this.ticking = true
    this.columns.clear()
    this.bottom = this.minY
    this.top = this.maxY
  }

  endTick () {
    this.entity = null
    this.ticking = false
  }

  column (cx, cz) {
    if (!this.ticking) return this.bot.world.getColumn(cx, cz)
    const key = cx * 4194304 + cz
    let col = this.columns.get(key)
    if (col === undefined) {
      col = this.bot.world.getColumn(cx, cz) ?? null
      this.columns.set(key, col)
    }
    return col
  }

  // PowderSnowBlock#getCollisionShape
  powderSnowShapes (y) {
    const e = this.entity
    if (!e) return NO_SHAPES
    if (e.fallDistance > 2.5) return SNOW_FALLING
    if (e.walksOnPowderSnow && e.bottom > y + 1 - ABOVE_EPSILON && !e.descending) return SNOW_FULL
    return NO_SHAPES
  }

  get minY () { return this.bot.game?.minY ?? 0 }
  get maxY () { return this.minY + (this.bot.game?.height ?? 256) }

  hasChunk (bx, bz) {
    return !!this.column(Math.floor(bx) >> 4, Math.floor(bz) >> 4)
  }

  // returns null when the column is not loaded
  stateAt (x, y, z) {
    const col = this.column(x >> 4, z >> 4)
    if (!col) return null
    if (this.ticking ? (y < this.bottom || y >= this.top) : (y < this.minY || y >= this.maxY)) return 0
    this.pos.x = x & 15; this.pos.y = y; this.pos.z = z & 15
    return col.getBlockStateId(this.pos)
  }

  info (stateId) {
    let i = this.infos[stateId]
    if (i == null) i = this.infos[stateId] = this._build(stateId)
    return i
  }

  blockAt (x, y, z) {
    const s = this.stateAt(x, y, z)
    return this.info(s ?? 0)
  }

  _build (stateId) {
    let b
    try { b = this.Block.fromStateId(stateId, 0) } catch (e) { b = null }
    const name = b?.name ?? 'air'
    const props = (b && b.getProperties) ? b.getProperties() : {}
    const shapes = (b && Array.isArray(b.shapes)) ? b.shapes.filter(s => s && s.length === 6) : []
    const info = {
      stateId,
      name,
      props,
      shapes,
      isAir: name === 'air' || name === 'cave_air' || name === 'void_air',
      friction: f32(FRICTION[name] ?? 0.6),
      speedFactor: f32(SPEED_FACTOR[name] ?? 1.0),
      jumpFactor: f32(JUMP_FACTOR[name] ?? 1.0),
      climbable: CLIMBABLE.has(name),
      isTrapdoor: name.endsWith('_trapdoor'),
      isLadder: name === 'ladder',
      isSlime: name === 'slime_block' || name === 'slime',
      isBed: name.endsWith('_bed') || name === 'bed',
      isHoney: name === 'honey_block',
      isCobweb: name === 'cobweb' || name === 'web',
      isBerryBush: name === 'sweet_berry_bush',
      isPowderSnow: name === 'powder_snow',
      isScaffolding: name === 'scaffolding',
      isFenceLike: name.endsWith('_fence') || name.endsWith('_wall') || name.endsWith('_fence_gate'),
      isBubbleColumn: name === 'bubble_column',
      bubbleDrag: props.drag === true || props.drag === 'true',
      fullCube: shapes.length === 1 && shapes[0].every((v, k) => v === FULL[k]),
      fluid: null
    }
    info.suffocating = info.fullCube && !(b?.transparent ?? true)
    // fluids
    if (name === 'water' || name === 'lava' || name === 'flowing_water' || name === 'flowing_lava') {
      const level = Number(props.level ?? 0)
      const falling = level >= 8
      const amount = falling ? 8 : (level === 0 ? 8 : 8 - level)
      info.fluid = { type: name.includes('water') ? 'water' : 'lava', amount, falling, source: level === 0 }
    } else if (props.waterlogged === true || props.waterlogged === 'true' || WATER_SOURCES.has(name)) {
      info.fluid = { type: 'water', amount: 8, falling: false, source: true }
    }
    return info
  }

  fluidAt (x, y, z) {
    const s = this.stateAt(x, y, z)
    if (s == null) return null
    return this.info(s).fluid
  }

  // FluidState.getOwnHeight()
  static ownHeight (fluid) {
    return fluid ? f32(fluid.amount / 9.0) : 0
  }

  // FluidState.getHeight(level, pos)
  fluidHeight (x, y, z, fluid) {
    if (!fluid) return 0
    const above = this.fluidAt(x, y + 1, z)
    if (above && above.type === fluid.type) return 1.0
    return WorldView.ownHeight(fluid)
  }

  // Collect every collision box that could touch `bb` (BlockCollisions semantics:
  // unloaded chunks collide with nothing, outside build height is air).
  // The returned list and its boxes are reused by the next call.
  collisionBoxes (bb) {
    this.boxes.length = 0
    this.scan(bb, false)
    return this.boxes
  }

  noCollision (bb) {
    return !this.scan(bb, true)
  }

  // walks the blocks around bb; with test set, stops at the first box that overlaps bb
  scan (bb, test) {
    const pool = this.boxPool
    const out = this.boxes
    const x0 = Math.floor(bb.minX - 1.0e-7) - 1; const x1 = Math.floor(bb.maxX + 1.0e-7) + 1
    const y0 = Math.floor(bb.minY - 1.0e-7) - 1; const y1 = Math.floor(bb.maxY + 1.0e-7) + 1
    const z0 = Math.floor(bb.minZ - 1.0e-7) - 1; const z1 = Math.floor(bb.maxZ + 1.0e-7) + 1
    for (let x = x0; x <= x1; x++) {
      for (let z = z0; z <= z1; z++) {
        const col = this.column(x >> 4, z >> 4)
        if (!col) continue
        const bottom = this.ticking ? this.bottom : this.minY
        const top = this.ticking ? this.top : this.maxY
        for (let y = y0; y <= y1; y++) {
          if (y < bottom || y >= top) continue
          this.pos.x = x & 15; this.pos.y = y; this.pos.z = z & 15
          const info = this.info(col.getBlockStateId(this.pos))
          const shapes = info.isPowderSnow ? this.powderSnowShapes(y) : info.shapes
          for (let k = 0; k < shapes.length; k++) {
            const s = shapes[k]
            if (test) {
              if (bb.intersects(s[0] + x, s[1] + y, s[2] + z, s[3] + x, s[4] + y, s[5] + z)) return true
              continue
            }
            const b = pool[out.length] ?? (pool[out.length] = new Array(6))
            b[0] = s[0] + x; b[1] = s[1] + y; b[2] = s[2] + z; b[3] = s[3] + x; b[4] = s[4] + y; b[5] = s[5] + z
            out.push(b)
          }
        }
      }
    }
    return false
  }

  containsAnyLiquid (bb) {
    const x0 = Math.floor(bb.minX); const x1 = Math.ceil(bb.maxX)
    const y0 = Math.floor(bb.minY); const y1 = Math.ceil(bb.maxY)
    const z0 = Math.floor(bb.minZ); const z1 = Math.ceil(bb.maxZ)
    for (let x = x0; x < x1; x++) {
      for (let y = y0; y < y1; y++) {
        for (let z = z0; z < z1; z++) {
          if (this.fluidAt(x, y, z)) return true
        }
      }
    }
    return false
  }
}

module.exports = WorldView
