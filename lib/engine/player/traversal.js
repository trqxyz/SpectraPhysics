'use strict'
// Which blocks Entity#applyEffectsFromBlocks visits after travel (1.21.2+), and in what order. The order
// matters: effects such as bubble columns depend on the velocity left by the blocks visited before them.
// Each client version walks the movement differently; the four variants below follow those versions.

const { f32 } = require('../mth')

const EPS = 1.0e-7
const DEFLATE = f32(1.0e-5)
const SHORT_MOVE_SQ = f32(f32(0.99999) * f32(0.99999))
const TINY_MOVE_SQ = DEFLATE * DEFLATE
const FAR_SQ = 0.9999900000002526 * 0.9999900000002526
const STEP_LIMIT = 16

// insertion-ordered set of block positions, small enough that a linear scan beats hashing
class BlockList {
  constructor () { this.coords = []; this.length = 0 }

  clear () { this.length = 0; return this }

  has (x, y, z) {
    const c = this.coords
    for (let i = 0; i < this.length * 3; i += 3) if (c[i] === x && c[i + 1] === y && c[i + 2] === z) return true
    return false
  }

  // true when the position was not in the list yet
  add (x, y, z) {
    if (this.has(x, y, z)) return false
    const i = this.length * 3
    this.coords[i] = x; this.coords[i + 1] = y; this.coords[i + 2] = z
    this.length++
    return true
  }

  forEach (visit) {
    const c = this.coords
    for (let i = 0; i < this.length * 3; i += 3) visit(c[i], c[i + 1], c[i + 2])
  }
}

const seenAlong = new BlockList()
const seenBetween = new BlockList()
const ordered = new BlockList()

const frac = (v) => v - Math.floor(v)
const sign = (v) => v === 0 ? 0 : (v > 0 ? 1 : -1)

// BlockPos.betweenClosed: x fastest, then y, then z
function forEachBetweenClosed (box, visit) {
  const x0 = Math.floor(box.minX); const y0 = Math.floor(box.minY); const z0 = Math.floor(box.minZ)
  const x1 = Math.floor(box.maxX); const y1 = Math.floor(box.maxY); const z1 = Math.floor(box.maxZ)
  for (let z = z0; z <= z1; z++) {
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) visit(x, y, z)
    }
  }
}

// Y first, then the smaller of x/z ... matching Direction.axisStepOrder
const axisStepOrder = (v) => Math.abs(v.x) < Math.abs(v.z) ? 'yzx' : 'yxz'

// BlockPos.betweenCornersInDirection: starts at the corner facing away from the direction,
// walks Y, then the smaller of x/z, then the other one (innermost)
function forEachBetweenCorners (ax, ay, az, bx, by, bz, dir, visit) {
  const minX = Math.min(ax, bx); const minY = Math.min(ay, by); const minZ = Math.min(az, bz)
  const sizeX = Math.max(ax, bx) - minX; const sizeY = Math.max(ay, by) - minY; const sizeZ = Math.max(az, bz) - minZ
  const sx = dir.x >= 0 ? 1 : -1; const sy = dir.y >= 0 ? 1 : -1; const sz = dir.z >= 0 ? 1 : -1
  const x0 = sx > 0 ? minX : minX + sizeX; const y0 = sy > 0 ? minY : minY + sizeY; const z0 = sz > 0 ? minZ : minZ + sizeZ
  const zSecond = Math.abs(dir.x) < Math.abs(dir.z)
  for (let i = 0; i <= sizeY; i++) {
    const y = y0 + sy * i
    if (zSecond) {
      for (let j = 0; j <= sizeZ; j++) {
        const z = z0 + sz * j
        for (let k = 0; k <= sizeX; k++) if (visit(x0 + sx * k, y, z) === false) return false
      }
    } else {
      for (let j = 0; j <= sizeX; j++) {
        const x = x0 + sx * j
        for (let k = 0; k <= sizeZ; k++) if (visit(x, y, z0 + sz * k) === false) return false
      }
    }
  }
  return true
}

function clipPoint (best, delta, side, startSide, minA, maxA, minB, maxB, startA, deltaA, startB, deltaB) {
  const t = (side - startSide) / delta
  const a = startA + t * deltaA
  const b = startB + t * deltaB
  if (t > 0 && t < best.t && minA - EPS < a && a < maxA + EPS && minB - EPS < b && b < maxB + EPS) {
    best.t = t
    best.hit = true
  }
}

// AABB.clip of the unit cube at (x, y, z) against the segment start -> end
function clip (x, y, z, start, end) {
  const dx = end.x - start.x; const dy = end.y - start.y; const dz = end.z - start.z
  const best = { t: 1, hit: false }
  if (dx > EPS) clipPoint(best, dx, x, start.x, y, y + 1, z, z + 1, start.y, dy, start.z, dz)
  else if (dx < -EPS) clipPoint(best, dx, x + 1, start.x, y, y + 1, z, z + 1, start.y, dy, start.z, dz)
  if (dy > EPS) clipPoint(best, dy, y, start.y, z, z + 1, x, x + 1, start.z, dz, start.x, dx)
  else if (dy < -EPS) clipPoint(best, dy, y + 1, start.y, z, z + 1, x, x + 1, start.z, dz, start.x, dx)
  if (dz > EPS) clipPoint(best, dz, z, start.z, x, x + 1, y, y + 1, start.x, dx, start.y, dy)
  else if (dz < -EPS) clipPoint(best, dz, z + 1, start.z, x, x + 1, y, y + 1, start.x, dx, start.y, dy)
  return best.hit ? { x: start.x + best.t * dx, y: start.y + best.t * dy, z: start.z + best.t * dz } : null
}

// voxel walk of one corner of the box from start to end; calls hit(cx, cy, cz, point, step) on every cell it enters
function walk (start, end, limited, hit) {
  const d = { x: end.x - start.x, y: end.y - start.y, z: end.z - start.z }
  let cx = Math.floor(start.x); let cy = Math.floor(start.y); let cz = Math.floor(start.z)
  const sx = sign(d.x); const sy = sign(d.y); const sz = sign(d.z)
  const tx = sx === 0 ? Number.MAX_VALUE : sx / d.x
  const ty = sy === 0 ? Number.MAX_VALUE : sy / d.y
  const tz = sz === 0 ? Number.MAX_VALUE : sz / d.z
  let nx = tx * (sx > 0 ? 1 - frac(start.x) : frac(start.x))
  let ny = ty * (sy > 0 ? 1 - frac(start.y) : frac(start.y))
  let nz = tz * (sz > 0 ? 1 - frac(start.z) : frac(start.z))
  let steps = 0
  while (nx <= 1 || ny <= 1 || nz <= 1) {
    if (nx < ny) {
      if (nx < nz) { cx += sx; nx += tx } else { cz += sz; nz += tz }
    } else if (ny < nz) { cy += sy; ny += ty } else { cz += sz; nz += tz }
    if (limited && steps++ > STEP_LIMIT) break
    const point = clip(cx, cy, cz, start, end)
    if (!point) continue
    if (!limited) steps++
    if (hit(cx, cy, cz, point, steps) === false) return -1
  }
  return steps
}

const clamp = (v, lo, hi) => v < lo ? lo : (v > hi ? hi : v)
const clampInto = (point, cx, cy, cz) => ({
  x: clamp(point.x, cx + DEFLATE, cx + 1 - DEFLATE),
  y: clamp(point.y, cy + DEFLATE, cy + 1 - DEFLATE),
  z: clamp(point.z, cz + DEFLATE, cz + 1 - DEFLATE)
})

// 1.21.2 - 1.21.8: the min corner of the box walks the movement; every cell hit adds a box-sized block range
function legacyAlongTravel (box, direction, nudge, visit) {
  const len = Math.sqrt(direction.x ** 2 + direction.y ** 2 + direction.z ** 2)
  const n = nudge ? { x: direction.x / len * EPS, y: direction.y / len * EPS, z: direction.z / len * EPS } : { x: 0, y: 0, z: 0 }
  const end = { x: box.minX + n.x, y: box.minY + n.y, z: box.minZ + n.z }
  const start = { x: box.minX - direction.x - n.x, y: box.minY - direction.y - n.y, z: box.minZ - direction.z - n.z }
  const sizeX = box.maxX - box.minX; const sizeY = box.maxY - box.minY; const sizeZ = box.maxZ - box.minZ
  return walk(start, end, true, (cx, cy, cz, point, step) => {
    const c = clampInto(point, cx, cy, cz)
    const ex = Math.floor(c.x + sizeX); const ey = Math.floor(c.y + sizeY); const ez = Math.floor(c.z + sizeZ)
    for (let x = cx; x <= ex; x++) {
      for (let y = cy; y <= ey; y++) {
        for (let z = cz; z <= ez; z++) visit(x, y, z, step)
      }
    }
  })
}

// BlockCollisions#getFurthestCorner (1.21.10+)
function furthestCorner (v) {
  const ax = Math.abs(v.x); const ay = Math.abs(v.y); const az = Math.abs(v.z)
  const xs = v.x >= 0 ? 1 : -1; const ys = v.y >= 0 ? 1 : -1; const zs = v.z >= 0 ? 1 : -1
  if (ax <= ay && ax <= az) return { x: -xs, y: -zs, z: ys }
  return ay <= az ? { x: zs, y: -ys, z: -xs } : { x: -ys, y: xs, z: -zs }
}

// 1.21.9+: BlockGetter#forEachBlockIntersectedBetween
function modernBetween (from, to, box, visit) {
  const d = { x: to.x - from.x, y: to.y - from.y, z: to.z - from.z }
  if (d.x * d.x + d.y * d.y + d.z * d.z < TINY_MOVE_SQ) {
    forEachBetweenClosed(box, (x, y, z) => visit(x, y, z, 0))
    return
  }
  const seen = seenBetween.clear()
  const back = box.move(-d.x, -d.y, -d.z)
  const ok = forEachBetweenCorners(Math.floor(back.minX), Math.floor(back.minY), Math.floor(back.minZ),
    Math.floor(back.maxX), Math.floor(back.maxY), Math.floor(back.maxZ), d, (x, y, z) => {
      if (visit(x, y, z, 0) === false) return false
      seen.add(x, y, z)
    })
  if (!ok) return
  const sizeX = box.maxX - box.minX; const sizeY = box.maxY - box.minY; const sizeZ = box.maxZ - box.minZ
  const corner = furthestCorner(d)
  const center = { x: box.minX + 0.5 * sizeX, y: box.minY + 0.5 * sizeY, z: box.minZ + 0.5 * sizeZ }
  const end = { x: center.x + sizeX * 0.5 * corner.x, y: center.y + sizeY * 0.5 * corner.y, z: center.z + sizeZ * 0.5 * corner.z }
  const start = { x: end.x - d.x, y: end.y - d.y, z: end.z - d.z }
  const steps = walk(start, end, false, (cx, cy, cz, point, step) => {
    const c = clampInto(point, cx, cy, cz)
    const ex = Math.floor(c.x - sizeX * corner.x); const ey = Math.floor(c.y - sizeY * corner.y); const ez = Math.floor(c.z - sizeZ * corner.z)
    return forEachBetweenCorners(cx, cy, cz, ex, ey, ez, d, (x, y, z) => {
      if (seen.add(x, y, z)) return visit(x, y, z, step)
    })
  })
  if (steps < 0) return
  forEachBetweenCorners(Math.floor(box.minX), Math.floor(box.minY), Math.floor(box.minZ),
    Math.floor(box.maxX), Math.floor(box.maxY), Math.floor(box.maxZ), d, (x, y, z) => {
      if (seen.add(x, y, z)) return visit(x, y, z, steps + 1)
    })
}

/**
 * Visits the blocks touched by this tick's movements in game order.
 * moves: [{ from, to, input }] where input is the movement asked of Entity#move (1.21.5+), or null.
 * visit(x, y, z, applyVelocity)
 */
function traverseMoves (player, moves, visit) {
  const pv = player.V.protocol
  const boxAt = (p) => player.bbAt(p.x, p.y, p.z).deflate(DEFLATE)

  if (pv < 769) { // 1.21.2 - 1.21.3: the final box, nudged walk
    const box = player.bb().deflate(DEFLATE)
    for (const { from, to } of moves) {
      const d = { x: to.x - from.x, y: to.y - from.y, z: to.z - from.z }
      if (d.x * d.x + d.y * d.y + d.z * d.z < SHORT_MOVE_SQ) {
        forEachBetweenClosed(box, (x, y, z) => visit(x, y, z, true))
        continue
      }
      const list = ordered.clear()
      const add = (x, y, z) => { list.add(x, y, z) }
      legacyAlongTravel(box, d, true, add)
      forEachBetweenClosed(box, add)
      list.forEach((x, y, z) => visit(x, y, z, true))
    }
    return
  }

  if (pv < 770) { // 1.21.4: box at the end of each movement
    for (const { from, to } of moves) {
      const box = boxAt(to)
      const d = { x: to.x - from.x, y: to.y - from.y, z: to.z - from.z }
      if (d.x * d.x + d.y * d.y + d.z * d.z < SHORT_MOVE_SQ) {
        forEachBetweenClosed(box, (x, y, z) => visit(x, y, z, true))
        continue
      }
      const list = ordered.clear()
      const add = (x, y, z) => { list.add(x, y, z) }
      legacyAlongTravel(box, d, false, add)
      forEachBetweenClosed(box, add)
      list.forEach((x, y, z) => visit(x, y, z, true))
    }
    return
  }

  const modern = pv >= 773
  for (const move of moves) {
    const delta = { x: move.to.x - move.from.x, y: move.to.y - move.from.y, z: move.to.z - move.from.z }
    let budget = STEP_LIMIT
    const segment = (from, to, limit) => {
      const box = boxAt(to)
      if (!modern) {
        const d = { x: to.x - from.x, y: to.y - from.y, z: to.z - from.z }
        if (d.x * d.x + d.y * d.y + d.z * d.z < SHORT_MOVE_SQ) {
          forEachBetweenClosed(box, (x, y, z) => visit(x, y, z, true))
          return 0
        }
        const seen = seenAlong.clear()
        const steps = legacyAlongTravel(box, d, false, (x, y, z) => {
          if (seen.add(x, y, z)) visit(x, y, z, true)
        })
        forEachBetweenClosed(box, (x, y, z) => { if (!seen.has(x, y, z)) visit(x, y, z, true) })
        return steps
      }
      const far = (to.x - from.x) ** 2 + (to.y - from.y) ** 2 + (to.z - from.z) ** 2 > FAR_SQ
      let reached = 0
      modernBetween(from, to, box, (x, y, z, step) => {
        if (step >= limit) return false
        reached = step
        visit(x, y, z, far || box.intersects(x, y, z, x + 1, y + 1, z + 1))
      })
      return reached + 1
    }
    if (move.input && (delta.x || delta.y || delta.z)) {
      let from = move.from
      for (const axis of axisStepOrder(modern ? move.input : delta)) {
        const value = delta[axis]
        if (value === 0) continue
        const to = { ...from, [axis]: from[axis] + value }
        budget -= segment(from, to, budget)
        from = to
      }
    } else {
      budget -= segment(move.from, move.to, STEP_LIMIT)
    }
    if (modern && budget <= 0) segment(move.to, move.to, 1)
  }
}

module.exports = { traverseMoves, BlockList, forEachBetweenCorners, furthestCorner, clip }
