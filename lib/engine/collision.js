'use strict'
// Port of Entity.collide / collideBoundingBox / Shapes.collide (VoxelShape.collide semantics).

const { f32 } = require('./mth')

const EPS = 1.0e-7

// VoxelShape.collide(axis, aabb, d) for a list of boxes. axis: 0=x 1=y 2=z
function collideAxis (axis, bb, boxes, d) {
  if (Math.abs(d) < EPS) return 0
  const a1 = axis === 0 ? 1 : 0
  const a2 = axis === 2 ? 1 : 2
  const bbMin = bb.min(axis); const bbMax = bb.max(axis)
  const o1Min = bb.min(a1); const o1Max = bb.max(a1)
  const o2Min = bb.min(a2); const o2Max = bb.max(a2)
  for (let i = 0; i < boxes.length; i++) {
    const b = boxes[i]
    // overlap on the two other axes (cell index semantics of VoxelShape.collideX)
    if (!(b[a1 + 3] > o1Min + EPS && b[a1] <= o1Max - EPS)) continue
    if (!(b[a2 + 3] > o2Min + EPS && b[a2] <= o2Max - EPS)) continue
    if (d > 0) {
      if (b[axis] > bbMax - EPS) {
        const g = b[axis] - bbMax
        if (g >= -EPS && g < d) d = g
      }
    } else {
      if (b[axis + 3] <= bbMin + EPS) {
        const g = b[axis + 3] - bbMin
        if (g <= EPS && g > d) d = g
      }
    }
    if (Math.abs(d) < EPS) return 0
  }
  return d
}

// Entity.collideWithShapes / collideBoundingBox axis order: Y, then the larger horizontal axis last
function collideWithShapes (vx, vy, vz, bb, boxes) {
  if (boxes.length === 0) return { x: vx, y: vy, z: vz }
  let dx = vx; let dy = vy; let dz = vz
  if (dy !== 0) {
    dy = collideAxis(1, bb, boxes, dy)
    if (dy !== 0) bb = bb.move(0, dy, 0)
  }
  const zFirst = Math.abs(dx) < Math.abs(dz)
  if (zFirst && dz !== 0) {
    dz = collideAxis(2, bb, boxes, dz)
    if (dz !== 0) bb = bb.move(0, 0, dz)
  }
  if (dx !== 0) {
    dx = collideAxis(0, bb, boxes, dx)
    if (!zFirst && dx !== 0) bb = bb.move(dx, 0, 0)
  }
  if (!zFirst && dz !== 0) {
    dz = collideAxis(2, bb, boxes, dz)
  }
  return { x: dx, y: dy, z: dz }
}

function collideBoundingBox (world, vx, vy, vz, bb) {
  const boxes = world.collisionBoxes(bb.expandTowards(vx, vy, vz))
  return collideWithShapes(vx, vy, vz, bb, boxes)
}

const hdist = (v) => v.x * v.x + v.z * v.z

// pre-1.21 step-up (1.14 - 1.20.6)
function collideLegacy (world, vx, vy, vz, bb, onGround, maxUpStep) {
  const r = (vx * vx + vy * vy + vz * vz) === 0 ? { x: vx, y: vy, z: vz } : collideBoundingBox(world, vx, vy, vz, bb)
  const fx = vx !== r.x; const fy = vy !== r.y; const fz = vz !== r.z
  const groundish = onGround || (fy && vy < 0)
  if (maxUpStep > 0 && groundish && (fx || fz)) {
    let v1 = collideBoundingBox(world, vx, maxUpStep, vz, bb)
    const v2 = collideBoundingBox(world, 0, maxUpStep, 0, bb.expandTowards(vx, 0, vz))
    if (v2.y < maxUpStep) {
      const v3 = collideBoundingBox(world, vx, 0, vz, bb.move(v2.x, v2.y, v2.z))
      const v3a = { x: v3.x + v2.x, y: v3.y + v2.y, z: v3.z + v2.z }
      if (hdist(v3a) > hdist(v1)) v1 = v3a
    }
    if (hdist(v1) > hdist(r)) {
      const down = collideBoundingBox(world, 0, -v1.y + vy, 0, bb.move(v1.x, v1.y, v1.z))
      return { x: v1.x + down.x, y: v1.y + down.y, z: v1.z + down.z }
    }
  }
  return r
}

// Entity.collectCandidateStepUpHeights
function candidateStepHeights (bb, boxes, maxStep, skip) {
  const set = new Set()
  for (const b of boxes) {
    for (const yc of [b[1], b[4]]) {
      const f = f32(yc - bb.minY)
      if (f < 0 || f === skip) continue
      if (f > maxStep) break
      set.add(f)
    }
  }
  return [...set].sort((a, b) => a - b)
}

// 1.21+ step-up
function collideModern (world, vx, vy, vz, bb, onGround, maxUpStep) {
  const r = (vx * vx + vy * vy + vz * vz) === 0 ? { x: vx, y: vy, z: vz } : collideBoundingBox(world, vx, vy, vz, bb)
  const fx = vx !== r.x; const fy = vy !== r.y; const fz = vz !== r.z
  const landed = fy && vy < 0
  if (maxUpStep > 0 && (landed || onGround) && (fx || fz)) {
    const bb1 = landed ? bb.move(0, r.y, 0) : bb
    let bb2 = bb1.expandTowards(vx, maxUpStep, vz)
    if (!landed) bb2 = bb2.expandTowards(0, -f32(1.0e-5), 0)
    const boxes = world.collisionBoxes(bb2)
    const heights = candidateStepHeights(bb1, boxes, maxUpStep, f32(r.y))
    for (const h of heights) {
      const v = collideWithShapes(vx, h, vz, bb1, boxes)
      if (hdist(v) > hdist(r)) {
        const d0 = bb.minY - bb1.minY
        return { x: v.x, y: v.y - d0, z: v.z }
      }
    }
  }
  return r
}

module.exports = { collideAxis, collideWithShapes, collideBoundingBox, collideLegacy, collideModern }
