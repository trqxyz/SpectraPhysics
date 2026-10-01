'use strict'
// Goals for the pathfinder, with the same shape as mineflayer-pathfinder's (heuristic, isEnd, hasChanged,
// isValid) so code written for it keeps working. Heuristics are in ticks, matching the move costs: the
// fastest way over flat ground is sprinting (about 3.56 ticks per block), so they never overestimate.

const { COST } = require('./costs')

function horizontal (dx, dz) {
  const ax = Math.abs(dx)
  const az = Math.abs(dz)
  return Math.max(ax, az) + (Math.SQRT2 - 1) * Math.min(ax, az)
}

// lower bound on the ticks needed to cover the offset: going up is at least a walk per block,
// going down at least the fall time per block
function estimate (dx, dy, dz) {
  return COST.walk * Math.max(horizontal(dx, dz), Math.max(0, dy)) + COST.fallTick * Math.max(0, -dy)
}

class Goal {
  heuristic () { return 0 }
  isEnd () { return true }
  hasChanged () { return false }
  isValid () { return true }
}

class GoalBlock extends Goal {
  constructor (x, y, z) {
    super()
    this.x = Math.floor(x); this.y = Math.floor(y); this.z = Math.floor(z)
  }

  heuristic (node) { return estimate(this.x - node.x, this.y - node.y, this.z - node.z) }
  isEnd (node) { return node.x === this.x && node.y === this.y && node.z === this.z }
}

class GoalNear extends Goal {
  constructor (x, y, z, range) {
    super()
    this.x = Math.floor(x); this.y = Math.floor(y); this.z = Math.floor(z)
    this.rangeSq = range * range
    this.range = range
  }

  heuristic (node) {
    const d = estimate(this.x - node.x, this.y - node.y, this.z - node.z)
    return Math.max(0, d - this.range * COST.walk)
  }

  isEnd (node) {
    const dx = this.x - node.x; const dy = this.y - node.y; const dz = this.z - node.z
    return dx * dx + dy * dy + dz * dz <= this.rangeSq
  }
}

class GoalXZ extends Goal {
  constructor (x, z) {
    super()
    this.x = Math.floor(x); this.z = Math.floor(z)
  }

  heuristic (node) { return COST.walk * horizontal(this.x - node.x, this.z - node.z) }
  isEnd (node) { return node.x === this.x && node.z === this.z }
}

class GoalNearXZ extends Goal {
  constructor (x, z, range) {
    super()
    this.x = Math.floor(x); this.z = Math.floor(z)
    this.range = range
    this.rangeSq = range * range
  }

  heuristic (node) { return Math.max(0, COST.walk * (horizontal(this.x - node.x, this.z - node.z) - this.range)) }
  isEnd (node) {
    const dx = this.x - node.x; const dz = this.z - node.z
    return dx * dx + dz * dz <= this.rangeSq
  }
}

class GoalY extends Goal {
  constructor (y) {
    super()
    this.y = Math.floor(y)
  }

  heuristic (node) { return estimate(0, this.y - node.y, 0) }
  isEnd (node) { return node.y === this.y }
}

// stand next to a block (any of the 6 neighbours, or on top of it)
class GoalGetToBlock extends Goal {
  constructor (x, y, z) {
    super()
    this.x = Math.floor(x); this.y = Math.floor(y); this.z = Math.floor(z)
  }

  heuristic (node) {
    const dx = this.x - node.x; const dy = this.y - node.y; const dz = this.z - node.z
    return Math.max(0, estimate(dx, dy, dz) - COST.walk)
  }

  isEnd (node) {
    return Math.abs(this.x - node.x) + Math.abs(this.y - node.y) + Math.abs(this.z - node.z) === 1
  }
}

// a face of the block can be seen and reached from the eyes (survival 4.5 blocks)
class GoalLookAtBlock extends Goal {
  constructor (pos, world, options = {}) {
    super()
    this.x = Math.floor(pos.x); this.y = Math.floor(pos.y); this.z = Math.floor(pos.z)
    this.world = world
    this.reach = options.reach ?? 4.5
    this.eyeHeight = options.eyeHeight ?? 1.62
    this.reachSq = this.reach * this.reach
  }

  visible (node) {
    if (!this.world?.raycast) return true
    const { Vec3 } = require('vec3')
    const eye = new Vec3(node.x + 0.5, (node.floor ?? node.y) + this.eyeHeight, node.z + 0.5)
    const faces = [[0.5, 1.001, 0.5], [0.5, -0.001, 0.5], [-0.001, 0.5, 0.5], [1.001, 0.5, 0.5], [0.5, 0.5, -0.001], [0.5, 0.5, 1.001]]
    for (const [fx, fy, fz] of faces) {
      const target = new Vec3(this.x + fx, this.y + fy, this.z + fz)
      const dir = target.minus(eye)
      const length = dir.norm()
      if (length > this.reach) continue
      const hit = this.world.raycast(eye, dir.normalize(), length + 0.01)
      if (hit && hit.position.x === this.x && hit.position.y === this.y && hit.position.z === this.z) return true
    }
    return false
  }

  heuristic (node) {
    const d = estimate(this.x - node.x, this.y - node.y, this.z - node.z)
    return Math.max(0, d - (this.reach - 1) * COST.walk)
  }

  isEnd (node) {
    const dx = this.x + 0.5 - (node.x + 0.5)
    const dy = this.y + 0.5 - (node.y + this.eyeHeight)
    const dz = this.z + 0.5 - (node.z + 0.5)
    if (node.x === this.x && node.z === this.z && (node.y === this.y || node.y + 1 === this.y)) return false
    return dx * dx + dy * dy + dz * dz <= this.reachSq && this.visible(node)
  }
}

class GoalCompositeAny extends Goal {
  constructor (goals = []) {
    super()
    this.goals = goals
  }

  push (goal) { this.goals.push(goal) }
  heuristic (node) { return Math.min(...this.goals.map(g => g.heuristic(node))) }
  isEnd (node) { return this.goals.some(g => g.isEnd(node)) }
  hasChanged () { return this.goals.some(g => g.hasChanged()) }
  isValid () { return this.goals.every(g => g.isValid()) }
}

class GoalCompositeAll extends Goal {
  constructor (goals = []) {
    super()
    this.goals = goals
  }

  push (goal) { this.goals.push(goal) }
  heuristic (node) { return Math.max(...this.goals.map(g => g.heuristic(node))) }
  isEnd (node) { return this.goals.every(g => g.isEnd(node)) }
  hasChanged () { return this.goals.some(g => g.hasChanged()) }
  isValid () { return this.goals.every(g => g.isValid()) }
}

class GoalInvert extends Goal {
  constructor (goal) {
    super()
    this.goal = goal
  }

  heuristic (node) { return -this.goal.heuristic(node) }
  isEnd (node) { return !this.goal.isEnd(node) }
  hasChanged () { return this.goal.hasChanged() }
  isValid () { return this.goal.isValid() }
}

// stay within range of an entity; the path is refreshed when it moves away from where it was planned to
class GoalFollow extends Goal {
  constructor (entity, range) {
    super()
    this.entity = entity
    this.range = range
    this.rangeSq = range * range
    this.update()
  }

  update () {
    const p = this.entity.position
    this.x = Math.floor(p.x); this.y = Math.floor(p.y); this.z = Math.floor(p.z)
  }

  heuristic (node) {
    const d = estimate(this.x - node.x, this.y - node.y, this.z - node.z)
    return Math.max(0, d - this.range * COST.walk)
  }

  isEnd (node) {
    const dx = this.x - node.x; const dy = this.y - node.y; const dz = this.z - node.z
    return dx * dx + dy * dy + dz * dz <= this.rangeSq
  }

  hasChanged () {
    const p = this.entity.position
    const x = Math.floor(p.x); const y = Math.floor(p.y); const z = Math.floor(p.z)
    if (x === this.x && y === this.y && z === this.z) return false
    this.x = x; this.y = y; this.z = z
    return true
  }

  isValid () { return this.entity != null && this.entity.isValid !== false }
}

module.exports = {
  Goal,
  GoalBlock,
  GoalNear,
  GoalXZ,
  GoalNearXZ,
  GoalY,
  GoalGetToBlock,
  GoalLookAtBlock,
  GoalCompositeAny,
  GoalCompositeAll,
  GoalInvert,
  GoalFollow
}
