'use strict'
// Client-controlled boat (Boat#tick when isControlledByLocalInstance()).

const AABB = require('./aabb')
const { f32, sin, cos, degToRadF } = require('./mth')
const { collideLegacy, collideModern } = require('./collision')

const BOAT_W = f32(1.375)
const BOAT_H = f32(0.5625)
const G = f32(-0.04) // (double)-0.04F == -0.03999999910593033

class BoatPhysics {
  constructor (world, V, entity) {
    this.world = world
    this.V = V
    this.pos = { x: entity.position.x, y: entity.position.y, z: entity.position.z }
    this.vel = { x: 0, y: 0, z: 0 }
    this.yRot = entity.yawDegrees ?? 0
    this.xRot = 0
    this.deltaRotation = 0
    this.status = 'IN_AIR'
    this.oldStatus = 'IN_AIR'
    this.landFriction = 0
    this.waterLevel = 0
    this.onGround = false
    this.paddle = [false, false]
  }

  bb () {
    const h = f32(BOAT_W / 2)
    return new AABB(this.pos.x - h, this.pos.y, this.pos.z - h, this.pos.x + h, this.pos.y + BOAT_H, this.pos.z + h)
  }

  groundFriction () {
    const bb = this.bb()
    const probe = new AABB(bb.minX, bb.minY - 0.001, bb.minZ, bb.maxX, bb.minY, bb.maxZ)
    const x0 = Math.floor(probe.minX) - 1; const x1 = Math.ceil(probe.maxX) + 1
    const y0 = Math.floor(probe.minY) - 1; const y1 = Math.ceil(probe.maxY) + 1
    const z0 = Math.floor(probe.minZ) - 1; const z1 = Math.ceil(probe.maxZ) + 1
    let sum = 0; let n = 0
    for (let x = x0; x < x1; x++) {
      for (let z = z0; z < z1; z++) {
        const edges = (x === x0 || x === x1 - 1 ? 1 : 0) + (z === z0 || z === z1 - 1 ? 1 : 0)
        if (edges === 2) continue
        for (let y = y0; y < y1; y++) {
          if (edges > 0 && !(y !== y0 && y !== y1 - 1)) continue
          const b = this.world.blockAt(x, y, z)
          if (b.name.includes('lily_pad')) continue
          let hit = false
          for (const s of b.shapes) {
            if (probe.intersectsBox([s[0] + x, s[1] + y, s[2] + z, s[3] + x, s[4] + y, s[5] + z])) { hit = true; break }
          }
          if (hit) { sum += b.friction; n++ }
        }
      }
    }
    return n > 0 ? f32(sum / n) : 0
  }

  inWater () {
    const bb = this.bb()
    const x0 = Math.floor(bb.minX); const x1 = Math.ceil(bb.maxX)
    const y0 = Math.floor(bb.minY); const y1 = Math.ceil(bb.minY + 0.001)
    const z0 = Math.floor(bb.minZ); const z1 = Math.ceil(bb.maxZ)
    let found = false
    this.waterLevel = -Infinity
    for (let x = x0; x < x1; x++) {
      for (let y = y0; y < y1; y++) {
        for (let z = z0; z < z1; z++) {
          const fl = this.world.fluidAt(x, y, z)
          if (fl && fl.type === 'water') {
            const top = y + this.world.fluidHeight(x, y, z, fl)
            this.waterLevel = Math.max(top, this.waterLevel)
            found = found || bb.minY < top
          }
        }
      }
    }
    return found
  }

  getStatus () {
    if (this.inWater()) return 'IN_WATER'
    const f = this.groundFriction()
    if (f > 0) { this.landFriction = f; return 'ON_LAND' }
    return 'IN_AIR'
  }

  floatBoat () {
    let d2 = 0
    let inv = f32(0.05)
    if (this.oldStatus === 'IN_AIR' && this.status !== 'IN_AIR' && this.status !== 'ON_LAND') {
      this.pos.y = this.waterLevel - BOAT_H + 0.101
      this.vel.y = 0
      this.status = 'IN_WATER'
      return
    }
    if (this.status === 'IN_WATER') { d2 = (this.waterLevel - this.pos.y) / BOAT_H; inv = f32(0.9) } else if (this.status === 'IN_AIR') inv = f32(0.9)
    else if (this.status === 'ON_LAND') { inv = this.landFriction; this.landFriction = f32(this.landFriction / 2) }
    this.vel.x *= inv
    this.vel.y += G
    this.vel.z *= inv
    this.deltaRotation = f32(this.deltaRotation * inv)
    if (d2 > 0) this.vel.y = (this.vel.y + d2 * 0.06153846016296973) * 0.75
  }

  controlBoat (keys) {
    let f = 0
    if (keys.left) this.deltaRotation = f32(this.deltaRotation - 1)
    if (keys.right) this.deltaRotation = f32(this.deltaRotation + 1)
    if (keys.right !== keys.left && !keys.forward && !keys.back) f = f32(f + f32(0.005))
    this.yRot = f32(this.yRot + this.deltaRotation)
    if (keys.forward) f = f32(f + f32(0.04))
    if (keys.back) f = f32(f - f32(0.005))
    const r = degToRadF(this.yRot)
    this.vel.x += sin(f32(-r)) * f
    this.vel.z += cos(r) * f
    this.paddle = [(keys.right && !keys.left) || keys.forward, (keys.left && !keys.right) || keys.forward]
  }

  tick (keys) {
    this.oldStatus = this.status
    this.status = this.getStatus()
    this.floatBoat()
    this.controlBoat(keys)
    const collide = this.V.modernStepUp ? collideModern : collideLegacy
    const r = collide(this.world, this.vel.x, this.vel.y, this.vel.z, this.bb(), this.onGround, 0)
    if (r.x * r.x + r.y * r.y + r.z * r.z > 1.0e-7) { this.pos.x += r.x; this.pos.y += r.y; this.pos.z += r.z }
    const vertical = this.vel.y !== r.y
    this.onGround = vertical && this.vel.y < 0
    if (this.vel.x !== r.x) this.vel.x = 0
    if (this.vel.z !== r.z) this.vel.z = 0
    if (vertical) this.vel.y = 0
  }
}

module.exports = BoatPhysics
