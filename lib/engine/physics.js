'use strict'
// Client-side player movement: a port of LocalPlayer#aiStep -> Player#aiStep -> LivingEntity#aiStep
// -> LivingEntity#travel -> Entity#move, following vanilla ordering and float rounding.

const AABB = require('./aabb')
const WorldView = require('./world')
const { f32, sin, cos, degToRadF, clamp, equal } = require('./mth')
const { collideLegacy, collideModern } = require('./collision')

const WIDTH = f32(0.6)
const HALF = f32(WIDTH / 2)
const HEIGHT_STAND = f32(1.8)
const HEIGHT_CROUCH = f32(1.5)
const EYE_STAND = f32(1.62)
const EYE_CROUCH = f32(1.27)
const STEP = f32(0.6)
const F_098 = f32(0.98)
const F_091 = f32(0.91)
const F_080 = f32(0.8)
const F_090 = f32(0.9)
const F_002 = f32(0.02)
const F_03 = f32(0.3)
const F_02 = f32(0.2)
const F_042 = f32(0.42)
const F_01 = f32(0.1)
const F_0216 = f32(0.21600002)
const F_015 = f32(0.15)
const F_004 = f32(0.04)
const F_005 = f32(0.05)
const F_0026 = f32(0.025999999)
const F_011111111 = f32(0.11111111)
const F_05000001 = 0.5000001
const F_0500001 = f32(0.500001)
const F_ONPOS = f32(0.2)
const F_066 = f32(0.66)
const F_096 = f32(0.96)
const F_1EM5 = f32(1.0e-5)
const F_ACOS_MINOR = f32(0.13962634)

class PlayerPhysics {
  constructor (world, V, env) {
    this.world = world // WorldView
    this.V = V
    this.env = env // { attribute(name, def), effect(name) -> amplifier|null, food(), usingItem(), gameMode() }
    this.reset()
  }

  reset () {
    this.pos = { x: 0, y: 0, z: 0 }
    this.vel = { x: 0, y: 0, z: 0 }
    this.yRot = 0
    this.xRot = 0
    this.onGround = false
    this.horizontalCollision = false
    this.minorHorizontalCollision = false
    this.verticalCollision = false
    this.fallDistance = 0
    this.sprinting = false
    this.crouching = false // pose (affects bounding box), updated at the end of the tick
    this.noJumpDelay = 0
    this.jumpTriggerTime = 0
    this.sprintTriggerTime = 0
    this.speed = f32(0.1) // LivingEntity#speed, refreshed at the end of Player#aiStep
    this.legacyFlyingSpeed = F_002
    this.stuck = null
    this.wasTouchingWater = false
    this.fluidHeight = { water: 0, lava: 0 }
    this.eyeInWater = false
    this.wasEyeInWater = false
    this.firstTick = true
    this.supportingBlock = null
    this.abilities = { invulnerable: false, flying: false, mayfly: false, instabuild: false, flyingSpeed: f32(0.05), walkingSpeed: f32(0.1) }
    this.input = { left: 0, forward: 0, jumping: false, shift: false, keys: {} }
    this.xxa = 0
    this.zza = 0
    this.events = { abilitiesChanged: false }
  }

  // ---------- geometry ----------
  height () { return this.crouching ? HEIGHT_CROUCH : HEIGHT_STAND }
  eyeHeight () { return this.crouching ? EYE_CROUCH : EYE_STAND }
  bbAt (x, y, z, h = this.height()) { return new AABB(x - HALF, y, z - HALF, x + HALF, y + h, z + HALF) }
  bb () { return this.bbAt(this.pos.x, this.pos.y, this.pos.z) }

  canEnterPose (crouch) {
    const h = crouch ? HEIGHT_CROUCH : HEIGHT_STAND
    return this.world.noCollision(this.bbAt(this.pos.x, this.pos.y, this.pos.z, h).deflate(1.0e-7))
  }

  blockPosition () {
    return { x: Math.floor(this.pos.x), y: Math.floor(this.pos.y), z: Math.floor(this.pos.z) }
  }

  maxUpStep () {
    return this.V.attributes2005 ? f32(this.env.attribute('step_height', 0.6)) : STEP
  }

  gravity () {
    return this.V.attributes2005 ? this.env.attribute('gravity', 0.08) : 0.08
  }

  isAffectedByFluids () { return !this.abilities.flying }
  isInWater () { return this.wasTouchingWater }
  isInLava () { return !this.firstTick && this.fluidHeight.lava > 0 }
  isUnderWater () { return this.wasEyeInWater && this.isInWater() }

  // ---------- fluids (Entity#updateInWaterStateAndDoFluidPushing) ----------
  updateFluids () {
    this.fluidHeight.water = 0
    this.fluidHeight.lava = 0
    if (this.updateFluidHeightAndDoFluidPushing('water', 0.014)) {
      this.fallDistance = 0
      this.wasTouchingWater = true
    } else {
      this.wasTouchingWater = false
    }
    if (!this.wasTouchingWater) {
      this.updateFluidHeightAndDoFluidPushing('lava', this.env.ultraWarm() ? 0.007 : 0.0023333333333333335)
    }
    // updateFluidOnEyes
    this.wasEyeInWater = this.eyeInWater
    const ey = this.pos.y + this.eyeHeight() - F_011111111
    const bx = Math.floor(this.pos.x); const by = Math.floor(ey); const bz = Math.floor(this.pos.z)
    const fl = this.world.fluidAt(bx, by, bz)
    this.eyeInWater = !!(fl && fl.type === 'water' && (by + this.world.fluidHeight(bx, by, bz, fl)) > ey)
  }

  updateFluidHeightAndDoFluidPushing (type, scale) {
    const bb = this.bb().deflate(0.001)
    const x0 = Math.floor(bb.minX); const x1 = Math.ceil(bb.maxX)
    const y0 = Math.floor(bb.minY); const y1 = Math.ceil(bb.maxY)
    const z0 = Math.floor(bb.minZ); const z1 = Math.ceil(bb.maxZ)
    let height = 0
    const pushed = !this.abilities.flying
    let touching = false
    let fx = 0; let fy = 0; let fz = 0; let n = 0
    for (let x = x0; x < x1; x++) {
      for (let y = y0; y < y1; y++) {
        for (let z = z0; z < z1; z++) {
          const fl = this.world.fluidAt(x, y, z)
          if (!fl || fl.type !== type) continue
          const top = y + this.world.fluidHeight(x, y, z, fl)
          if (top >= bb.minY) {
            touching = true
            height = Math.max(top - bb.minY, height)
            if (pushed) {
              const f = this.flow(x, y, z, fl)
              let k = 1
              if (height < 0.4) k = height
              fx += f.x * k; fy += f.y * k; fz += f.z * k
              n++
            }
          }
        }
      }
    }
    const len = Math.sqrt(fx * fx + fy * fy + fz * fz)
    if (len > 0) {
      if (n > 0) { fx /= n; fy /= n; fz /= n }
      fx *= scale; fy *= scale; fz *= scale
      if (Math.abs(this.vel.x) < 0.003 && Math.abs(this.vel.z) < 0.003 && Math.sqrt(fx * fx + fy * fy + fz * fz) < 0.0045000000000000005) {
        const l = Math.sqrt(fx * fx + fy * fy + fz * fz)
        fx = fx / l * 0.0045000000000000005; fy = fy / l * 0.0045000000000000005; fz = fz / l * 0.0045000000000000005
      }
      this.vel.x += fx; this.vel.y += fy; this.vel.z += fz
    }
    this.fluidHeight[type] = height
    return touching
  }

  // FlowingFluid#getFlow
  flow (x, y, z, fl) {
    const own = WorldView.ownHeight(fl)
    let dx = 0; let dz = 0
    const dirs = [[0, -1], [0, 1], [-1, 0], [1, 0]]
    for (const [sx, sz] of dirs) {
      const nx = x + sx; const nz = z + sz
      const nf = this.world.fluidAt(nx, y, nz)
      const affects = !nf || nf.type === fl.type
      if (!affects) continue
      let h = nf ? WorldView.ownHeight(nf) : 0
      let d = 0
      if (h === 0) {
        const b = this.world.blockAt(nx, y, nz)
        if (!(b.shapes.length > 0 && !b.fluid)) {
          const below = this.world.fluidAt(nx, y - 1, nz)
          if (!below || below.type === fl.type) {
            h = below ? WorldView.ownHeight(below) : 0
            if (h > 0) d = f32(own - f32(h - f32(0.8888889)))
          }
        }
      } else if (h > 0) {
        d = f32(own - h)
      }
      if (d !== 0) { dx += sx * d; dz += sz * d }
    }
    let vx = dx; let vy = 0; let vz = dz
    if (fl.falling) {
      for (const [sx, sz] of dirs) {
        const a = this.world.blockAt(x + sx, y, z + sz); const b = this.world.blockAt(x + sx, y + 1, z + sz)
        if ((a.fullCube && !a.fluid) || (b.fullCube && !b.fluid)) {
          const l = Math.sqrt(vx * vx + vz * vz)
          if (l > 1.0e-4) { vx /= l; vz /= l } else { vx = 0; vz = 0 }
          vy = -6
          break
        }
      }
    }
    const l = Math.sqrt(vx * vx + vy * vy + vz * vz)
    return l < 1.0e-4 ? { x: 0, y: 0, z: 0 } : { x: vx / l, y: vy / l, z: vz / l }
  }

  // ---------- block helpers ----------
  onPos (yOffset) {
    const V = this.V
    if (V.supportingBlock && this.supportingBlock) {
      const sb = this.supportingBlock
      if (!(yOffset > 1.0e-5)) return sb
      const st = this.world.blockAt(sb.x, sb.y, sb.z)
      if (!(yOffset <= 0.5) || !st.isFenceLike) return { x: sb.x, y: Math.floor(this.pos.y - yOffset), z: sb.z }
      return sb
    }
    const p = { x: Math.floor(this.pos.x), y: Math.floor(this.pos.y - yOffset), z: Math.floor(this.pos.z) }
    if (!V.supportingBlock && yOffset === F_ONPOS) {
      const b = this.world.blockAt(p.x, p.y, p.z)
      if (b.isAir) {
        const below = this.world.blockAt(p.x, p.y - 1, p.z)
        if (below.isFenceLike) return { x: p.x, y: p.y - 1, z: p.z }
      }
    }
    return p
  }

  posBelowAffectingMovement () {
    if (this.V.supportingBlock) return this.onPos(F_0500001)
    return { x: Math.floor(this.pos.x), y: Math.floor(this.bb().minY - F_05000001), z: Math.floor(this.pos.z) }
  }

  checkSupportingBlock (onGround, mx, my, mz) {
    if (!this.V.supportingBlock) return
    if (!onGround) { this.supportingBlock = null; this.onGroundNoBlocks = false; return }
    const bb = this.bb()
    const feet = new AABB(bb.minX, bb.minY - 1.0e-6, bb.minZ, bb.maxX, bb.minY, bb.maxZ)
    const find = (box) => {
      let best = null; let bestD = Infinity
      const x0 = Math.floor(box.minX) - 1; const x1 = Math.floor(box.maxX) + 1
      const y0 = Math.floor(box.minY) - 1; const y1 = Math.floor(box.maxY) + 1
      const z0 = Math.floor(box.minZ) - 1; const z1 = Math.floor(box.maxZ) + 1
      for (let x = x0; x <= x1; x++) {
        for (let y = y0; y <= y1; y++) {
          for (let z = z0; z <= z1; z++) {
            const info = this.world.blockAt(x, y, z)
            let hit = false
            for (const s of info.shapes) {
              if (box.intersectsBox([s[0] + x, s[1] + y, s[2] + z, s[3] + x, s[4] + y, s[5] + z])) { hit = true; break }
            }
            if (!hit) continue
            const cx = x + 0.5 - this.pos.x; const cy = y + 0.5 - this.pos.y; const cz = z + 0.5 - this.pos.z
            const d = cx * cx + cy * cy + cz * cz
            // Vec3i#compareTo orders by y, then z, then x; vanilla keeps the greater one on ties
            const greater = best && (y !== best.y ? y > best.y : (z !== best.z ? z > best.z : x > best.x))
            if (d < bestD || (d === bestD && (!best || greater))) {
              bestD = d; best = { x, y, z }
            }
          }
        }
      }
      return best
    }
    let found = find(feet)
    if (!found && !this.onGroundNoBlocks) {
      found = find(feet.move(-mx, 0, -mz))
      this.supportingBlock = found
    } else {
      this.onGroundNoBlocks = false
      this.supportingBlock = found
    }
    this.onGroundNoBlocks = !found
  }

  onClimbable () {
    const p = this.blockPosition()
    const st = this.world.blockAt(p.x, p.y, p.z)
    if (st.climbable) return true
    if (st.isTrapdoor && (st.props.open === true || st.props.open === 'true')) {
      const below = this.world.blockAt(p.x, p.y - 1, p.z)
      if (below.isLadder && below.props.facing === st.props.facing) return true
    }
    return false
  }

  blockSpeedFactor () {
    const p = this.blockPosition()
    const b = this.world.blockAt(p.x, p.y, p.z)
    const f = b.speedFactor
    if (b.name !== 'water' && b.name !== 'bubble_column') {
      if (f === 1.0) {
        const q = this.posBelowAffectingMovement()
        return this.world.blockAt(q.x, q.y, q.z).speedFactor
      }
      return f
    }
    return f
  }

  blockJumpFactor () {
    const p = this.blockPosition()
    const f = this.world.blockAt(p.x, p.y, p.z).jumpFactor
    const q = this.posBelowAffectingMovement()
    const f1 = this.world.blockAt(q.x, q.y, q.z).jumpFactor
    return f === 1.0 ? f1 : f
  }

  // ---------- movement primitives ----------
  moveRelative (speed, ix, iy, iz) {
    const lsq = ix * ix + iy * iy + iz * iz
    if (lsq < 1.0e-7) return
    let x = ix; let y = iy; let z = iz
    if (lsq > 1) { const l = Math.sqrt(lsq); x /= l; y /= l; z /= l }
    x *= speed; y *= speed; z *= speed
    const r = degToRadF(this.yRot)
    const s = sin(r); const c = cos(r)
    this.vel.x += x * c - z * s
    this.vel.y += y
    this.vel.z += z * c + x * s
  }

  isStayingOnGroundSurface () { return this.input.shift }

  isAboveGround (step) {
    if (this.onGround) return true
    if (this.V.modernBackOff) {
      return this.fallDistance < step && !this.canFallAtLeast(0, 0, step - this.fallDistance)
    }
    return this.fallDistance < step && !this.world.noCollision(this.bb().move(0, this.fallDistance - step, 0))
  }

  canFallAtLeast (x, z, dist) {
    const bb = this.bb()
    return this.world.noCollision(new AABB(bb.minX + 1.0e-7 + x, bb.minY - dist - 1.0e-7, bb.minZ + 1.0e-7 + z,
      bb.maxX - 1.0e-7 + x, bb.minY, bb.maxZ - 1.0e-7 + z))
  }

  maybeBackOffFromEdge (vx, vy, vz) {
    const step = this.maxUpStep()
    if (this.abilities.flying || !this.isStayingOnGroundSurface()) return [vx, vz]
    if (this.V.modernBackOff) {
      if (vy > 0 || !this.isAboveGround(step)) return [vx, vz]
      let d0 = vx; let d1 = vz
      const d3 = Math.sign(d0) * 0.05; const d4 = Math.sign(d1) * 0.05
      while (d0 !== 0 && this.canFallAtLeast(d0, 0, step)) { if (Math.abs(d0) <= 0.05) { d0 = 0; break } d0 -= d3 }
      while (d1 !== 0 && this.canFallAtLeast(0, d1, step)) { if (Math.abs(d1) <= 0.05) { d1 = 0; break } d1 -= d4 }
      while (d0 !== 0 && d1 !== 0 && this.canFallAtLeast(d0, d1, step)) {
        if (Math.abs(d0) <= 0.05) d0 = 0; else d0 -= d3
        if (Math.abs(d1) <= 0.05) d1 = 0; else d1 -= d4
      }
      return [d0, d1]
    }
    if (!(vy <= 0) || !this.isAboveGround(step)) return [vx, vz]
    let d0 = vx; let d1 = vz
    const bb = this.bb()
    const free = (x, z) => this.world.noCollision(bb.move(x, -step, z))
    while (d0 !== 0 && free(d0, 0)) { if (d0 < 0.05 && d0 >= -0.05) d0 = 0; else if (d0 > 0) d0 -= 0.05; else d0 += 0.05 }
    while (d1 !== 0 && free(0, d1)) { if (d1 < 0.05 && d1 >= -0.05) d1 = 0; else if (d1 > 0) d1 -= 0.05; else d1 += 0.05 }
    while (d0 !== 0 && d1 !== 0 && free(d0, d1)) {
      if (d0 < 0.05 && d0 >= -0.05) d0 = 0; else if (d0 > 0) d0 -= 0.05; else d0 += 0.05
      if (d1 < 0.05 && d1 >= -0.05) d1 = 0; else if (d1 > 0) d1 -= 0.05; else d1 += 0.05
    }
    return [d0, d1]
  }

  isHorizontalCollisionMinor (mx, mz) {
    const f = degToRadF(this.yRot)
    const d0 = sin(f); const d1 = cos(f)
    const d2 = this.xxa * d1 - this.zza * d0
    const d3 = this.zza * d1 + this.xxa * d0
    const d4 = d2 * d2 + d3 * d3
    const d5 = mx * mx + mz * mz
    if (!(d4 < F_1EM5) && !(d5 < F_1EM5)) {
      const d6 = d2 * mx + d3 * mz
      return Math.acos(d6 / Math.sqrt(d4 * d5)) < F_ACOS_MINOR
    }
    return false
  }

  // Entity#move(MoverType.SELF, vec)
  move (vx, vy, vz) {
    if (this.stuck) {
      vx *= this.stuck.x; vy *= this.stuck.y; vz *= this.stuck.z
      this.stuck = null
      this.vel.x = 0; this.vel.y = 0; this.vel.z = 0
    }
    const bo = this.maybeBackOffFromEdge(vx, vy, vz)
    vx = bo[0]; vz = bo[1]
    const bb = this.bb()
    const collide = this.V.modernStepUp ? collideModern : collideLegacy
    const r = collide(this.world, vx, vy, vz, bb, this.onGround, this.maxUpStep())
    const lsq = r.x * r.x + r.y * r.y + r.z * r.z
    if (lsq > 1.0e-7) {
      if (this.V.posFromBoundingBox) {
        const nb = bb.move(r.x, r.y, r.z)
        this.pos.x = (nb.minX + nb.maxX) / 2
        this.pos.y = nb.minY
        this.pos.z = (nb.minZ + nb.maxZ) / 2
      } else {
        this.pos.x += r.x; this.pos.y += r.y; this.pos.z += r.z
      }
    }
    const hx = !equal(vx, r.x); const hz = !equal(vz, r.z)
    this.horizontalCollision = hx || hz
    this.minorHorizontalCollision = this.V.minorCollision && this.horizontalCollision && this.isHorizontalCollisionMinor(r.x, r.z)
    this.verticalCollision = vy !== r.y
    this.onGround = this.verticalCollision && vy < 0
    this.checkSupportingBlock(this.onGround, r.x, r.y, r.z)

    const op = this.onPos(F_ONPOS)
    const onBlock = this.world.blockAt(op.x, op.y, op.z)
    // checkFallDamage
    if (this.onGround) {
      this.fallDistance = 0
    } else if (r.y < 0) {
      this.fallDistance = this.V.fallDistanceDouble ? this.fallDistance - r.y : f32(this.fallDistance - r.y)
    }
    if (vx !== r.x || vz !== r.z) {
      if (vx !== r.x) this.vel.x = 0
      if (vz !== r.z) this.vel.z = 0
    }
    if (vy !== r.y) this.updateEntityAfterFallOn(onBlock)
    if (this.onGround && !this.input.shift) this.stepOn(onBlock)
    this.checkInsideBlocks()
    const sf = this.blockSpeedFactor()
    this.vel.x *= sf
    this.vel.z *= sf
  }

  updateEntityAfterFallOn (block) {
    const suppress = this.input.shift
    if (block.isSlime && !suppress) {
      if (this.vel.y < 0) this.vel.y = -this.vel.y
      return
    }
    if (block.isBed && !suppress) {
      if (this.vel.y < 0) this.vel.y = -this.vel.y * F_066
      return
    }
    this.vel.y = 0
  }

  stepOn (block) {
    if (block.isSlime) {
      const d0 = Math.abs(this.vel.y)
      if (d0 < 0.1) {
        const d1 = 0.4 + d0 * 0.2
        this.vel.x *= d1; this.vel.z *= d1
      }
    }
  }

  checkInsideBlocks () {
    const bb = this.bb()
    const x0 = Math.floor(bb.minX + 0.001); const x1 = Math.floor(bb.maxX - 0.001)
    const y0 = Math.floor(bb.minY + 0.001); const y1 = Math.floor(bb.maxY - 0.001)
    const z0 = Math.floor(bb.minZ + 0.001); const z1 = Math.floor(bb.maxZ - 0.001)
    for (let x = x0; x <= x1; x++) {
      for (let y = y0; y <= y1; y++) {
        for (let z = z0; z <= z1; z++) {
          const b = this.world.blockAt(x, y, z)
          if (b.isCobweb) this.makeStuck(0.25, F_005, 0.25)
          else if (b.isBerryBush) this.makeStuck(F_080, 0.75, F_080)
          else if (b.isPowderSnow) this.makeStuck(F_090, 1.5, F_090)
          else if (b.isHoney) this.honeySlide(x, y, z)
        }
      }
    }
  }

  makeStuck (x, y, z) {
    this.fallDistance = 0
    this.stuck = { x, y, z }
  }

  honeySlide (bx, by, bz) {
    if (this.onGround) return
    if (this.pos.y > by + 0.9375 - 1.0e-7) return
    if (this.vel.y >= -0.08) return
    const d0 = Math.abs(bx + 0.5 - this.pos.x); const d1 = Math.abs(bz + 0.5 - this.pos.z)
    const d2 = 0.4375 + HALF
    if (!(d0 + 1.0e-7 > d2 || d1 + 1.0e-7 > d2)) return
    if (this.vel.y < -0.13) {
      const k = -0.05 / this.vel.y
      this.vel.x *= k; this.vel.y = -0.05; this.vel.z *= k
    } else {
      this.vel.y = -0.05
    }
    this.fallDistance = 0
  }

  isFree (x, y, z) {
    const bb = this.bb().move(x, y, z)
    return this.world.noCollision(bb) && !this.world.containsAnyLiquid(bb)
  }

  fluidFallingAdjusted (gravity, falling) {
    if (!this.sprinting) {
      const vy = this.vel.y
      if (falling && Math.abs(vy - 0.005) >= 0.003 && Math.abs(vy - gravity / 16.0) < 0.003) this.vel.y = -0.003
      else this.vel.y = vy - gravity / 16.0
    }
  }

  flyingSpeed () {
    if (this.V.flyingSpeedLive) {
      if (this.abilities.flying) return this.sprinting ? f32(this.abilities.flyingSpeed * 2) : this.abilities.flyingSpeed
      return this.sprinting ? F_0026 : F_002
    }
    return this.legacyFlyingSpeed
  }

  frictionInfluencedSpeed (friction) {
    if (this.onGround) return f32(this.speed * f32(F_0216 / f32(f32(friction * friction) * friction)))
    return this.flyingSpeed()
  }

  handleOnClimbable () {
    if (!this.onClimbable()) return
    this.fallDistance = 0
    this.vel.x = clamp(this.vel.x, -F_015, F_015)
    this.vel.z = clamp(this.vel.z, -F_015, F_015)
    let d2 = Math.max(this.vel.y, -F_015)
    const p = this.blockPosition()
    if (d2 < 0 && !this.world.blockAt(p.x, p.y, p.z).isScaffolding && this.input.shift) d2 = 0
    this.vel.y = d2
  }

  // LivingEntity#travel
  travel (ix, iy, iz) {
    const V = this.V
    const falling = this.vel.y <= 0
    let gravity = this.gravity()
    if (falling && this.env.effect('slow_falling') != null) {
      gravity = V.attributes2005 ? Math.min(gravity, 0.01) : 0.01
      this.fallDistance = 0
    }
    if (this.isInWater() && this.isAffectedByFluids()) {
      const y0 = this.pos.y
      let f5 = this.sprinting ? F_090 : F_080
      const f6 = F_002
      if (this.env.effect('dolphins_grace') != null) f5 = F_096
      this.moveRelative(f6, ix, iy, iz)
      this.move(this.vel.x, this.vel.y, this.vel.z)
      if (this.horizontalCollision && this.onClimbable()) this.vel.y = 0.2
      this.vel.x *= f5; this.vel.y *= F_080; this.vel.z *= f5
      this.fluidFallingAdjusted(gravity, falling)
      if (this.horizontalCollision && this.isFree(this.vel.x, this.vel.y + 0.6000000238418579 - this.pos.y + y0, this.vel.z)) this.vel.y = 0.30000001192092896
    } else if (this.isInLava() && this.isAffectedByFluids()) {
      const y0 = this.pos.y
      this.moveRelative(F_002, ix, iy, iz)
      this.move(this.vel.x, this.vel.y, this.vel.z)
      if (this.fluidHeight.lava <= 0.4) {
        this.vel.x *= 0.5; this.vel.y *= F_080; this.vel.z *= 0.5
        this.fluidFallingAdjusted(gravity, falling)
      } else {
        this.vel.x *= 0.5; this.vel.y *= 0.5; this.vel.z *= 0.5
      }
      this.vel.y += -gravity / 4.0
      if (this.horizontalCollision && this.isFree(this.vel.x, this.vel.y + 0.6000000238418579 - this.pos.y + y0, this.vel.z)) this.vel.y = 0.30000001192092896
    } else {
      const below = this.posBelowAffectingMovement()
      const friction = this.world.blockAt(below.x, below.y, below.z).friction
      const f4 = this.onGround ? f32(friction * F_091) : F_091
      // handleRelativeFrictionAndCalculateMovement
      this.moveRelative(this.frictionInfluencedSpeed(friction), ix, iy, iz)
      this.handleOnClimbable()
      this.move(this.vel.x, this.vel.y, this.vel.z)
      if ((this.horizontalCollision || this.input.jumping) && this.onClimbable()) this.vel.y = 0.2
      let d2 = this.vel.y
      const lev = this.env.effect('levitation')
      if (lev != null) {
        d2 += (0.05 * (lev + 1) - this.vel.y) * 0.2
        this.fallDistance = 0
      } else if (!this.world.hasChunk(below.x, below.z)) {
        d2 = this.pos.y > this.world.minY ? -0.1 : 0
      } else {
        d2 -= gravity
      }
      this.vel.x *= f4
      this.vel.y = d2 * F_098
      this.vel.z *= f4
    }
  }

  // Player#travel wrapper (flying)
  playerTravel (ix, iy, iz) {
    if (this.abilities.flying) {
      const d5 = this.vel.y
      const old = this.legacyFlyingSpeed
      if (!this.V.flyingSpeedLive) this.legacyFlyingSpeed = f32(this.abilities.flyingSpeed * (this.sprinting ? 2 : 1))
      this.travel(ix, iy, iz)
      this.vel.y = d5 * 0.6
      if (!this.V.flyingSpeedLive) this.legacyFlyingSpeed = old
      this.fallDistance = 0
    } else {
      this.travel(ix, iy, iz)
    }
  }

  jumpFromGround () {
    let f
    if (this.V.attributes2005) f = f32(f32(this.env.attribute('jump_strength', 0.42)) * this.blockJumpFactor())
    else f = f32(F_042 * this.blockJumpFactor())
    const jb = this.env.effect('jump_boost')
    if (jb != null) f = f32(f + f32(F_01 * (jb + 1)))
    if (this.V.jumpKeepsHigherY) {
      if (f <= 1.0e-5) return
      this.vel.y = Math.max(f, this.vel.y)
    } else {
      this.vel.y = f
    }
    if (this.sprinting) {
      const r = degToRadF(this.yRot)
      this.vel.x += -sin(r) * F_02
      this.vel.z += cos(r) * F_02
    }
  }

  // ---------- input ----------
  computeInput (keys, slow) {
    const V = this.V
    const fwd = keys.forward === keys.back ? 0 : (keys.forward ? 1 : -1)
    const left = keys.left === keys.right ? 0 : (keys.left ? 1 : -1)
    let lx = left; let fz = fwd
    if (V.normalizedInput) {
      const l = f32(Math.sqrt(f32(lx * lx + fz * fz)))
      if (l < f32(1.0e-4)) { lx = 0; fz = 0 } else { lx = f32(lx / l); fz = f32(fz / l) }
      if (this.env.usingItem()) { lx = f32(lx * F_02); fz = f32(fz * F_02) }
      if (slow) {
        const s = f32(this.env.attribute('sneaking_speed', 0.3))
        lx = f32(lx * s); fz = f32(fz * s)
      }
      if (V.squareInput) {
        const len = f32(Math.sqrt(f32(lx * lx + fz * fz)))
        if (len > 0) {
          const nx = f32(lx / len); const nz = f32(fz / len)
          const ax = Math.abs(nx); const az = Math.abs(nz)
          const r = az > ax ? f32(ax / az) : f32(az / ax)
          const dist = f32(Math.sqrt(f32(1 + f32(r * r))))
          const k = Math.min(f32(len * dist), 1)
          lx = f32(nx * k); fz = f32(nz * k)
        }
      }
    } else {
      if (slow) { lx = f32(lx * 0.3); fz = f32(fz * 0.3) }
      if (this.env.usingItem()) { lx = f32(lx * F_02); fz = f32(fz * F_02) }
    }
    this.input.left = lx
    this.input.forward = fz
    this.input.rawForward = fwd
    this.input.jumping = !!keys.jump
    this.input.shift = !!keys.sneak
    this.input.keys = { ...keys }
  }

  hasEnoughImpulseToStartSprinting () {
    if (this.isUnderWater()) return this.input.forward > F_1EM5
    return (this.V.normalizedInput ? this.input.rawForward : this.input.forward) >= 0.8
  }

  setSprinting (v) {
    this.sprinting = v
  }

  // ---------- one client tick (LocalPlayer#tick -> aiStep) ----------
  tick (keys) {
    const V = this.V
    // Entity#baseTick
    this.updateFluids()
    this.firstTick = false

    // LocalPlayer#aiStep
    if (this.sprintTriggerTime > 0) this.sprintTriggerTime--
    const prevJump = this.input.jumping
    const prevShift = this.input.shift
    const prevEnough = this.hasEnoughImpulseToStartSprinting()
    const crouchingNow = !this.abilities.flying && prevShift && this.canEnterPose(true)
    this.computeInput(keys, crouchingNow)
    const canSprintFood = this.env.food() > 6 || this.abilities.mayfly
    const blind = this.env.effect('blindness') != null
    if (prevShift) this.sprintTriggerTime = 0
    if ((this.onGround || this.isUnderWater()) && !prevShift && !prevEnough && this.hasEnoughImpulseToStartSprinting() &&
      !this.sprinting && canSprintFood && !this.env.usingItem() && !blind) {
      if (this.sprintTriggerTime <= 0 && !keys.sprint) this.sprintTriggerTime = 7
      else this.setSprinting(true)
    }
    if (!this.sprinting && (!this.isInWater() || this.isUnderWater()) && this.hasEnoughImpulseToStartSprinting() &&
      canSprintFood && !this.env.usingItem() && !blind && keys.sprint && !this.input.shift) {
      this.setSprinting(true)
    }
    if (this.sprinting) {
      const noForward = !(this.input.forward > F_1EM5) || !canSprintFood
      const collided = V.minorCollision ? (this.horizontalCollision && !this.minorHorizontalCollision) : this.horizontalCollision
      if (noForward || collided || (this.isInWater() && !this.isUnderWater()) || (V.normalizedInput && this.input.shift)) this.setSprinting(false)
    }
    // double-tap jump toggles flight when allowed
    if (this.abilities.mayfly && this.env.gameMode() !== 'spectator') {
      if (!prevJump && this.input.jumping) {
        if (this.jumpTriggerTime === 0) {
          this.jumpTriggerTime = 7
        } else {
          this.abilities.flying = !this.abilities.flying
          this.events.abilitiesChanged = true
          this.jumpTriggerTime = 0
        }
      }
    }
    if (this.isInWater() && this.input.shift && this.isAffectedByFluids()) this.vel.y -= F_004
    if (this.abilities.flying) {
      let j = 0
      if (this.input.shift) j--
      if (this.input.jumping) j++
      if (j !== 0) this.vel.y += f32(f32(j * this.abilities.flyingSpeed) * 3)
    }

    // Player#aiStep
    if (this.jumpTriggerTime > 0) this.jumpTriggerTime--

    // LivingEntity#aiStep
    if (this.noJumpDelay > 0) this.noJumpDelay--
    if (Math.abs(this.vel.x) < 0.003) this.vel.x = 0
    if (Math.abs(this.vel.y) < 0.003) this.vel.y = 0
    if (Math.abs(this.vel.z) < 0.003) this.vel.z = 0
    this.xxa = this.input.left
    this.zza = this.input.forward
    const jumping = this.input.jumping
    if (jumping && this.isAffectedByFluids()) {
      const d7 = this.isInLava() ? this.fluidHeight.lava : this.fluidHeight.water
      const inW = this.isInWater() && d7 > 0
      const d8 = 0.4
      if (!inW || (this.onGround && !(d7 > d8))) {
        if (!this.isInLava() || (this.onGround && !(d7 > d8))) {
          if ((this.onGround || (inW && d7 <= d8)) && this.noJumpDelay === 0) {
            this.jumpFromGround()
            this.noJumpDelay = 10
          }
        } else {
          this.vel.y += F_004
        }
      } else {
        this.vel.y += F_004
      }
    } else {
      this.noJumpDelay = 0
    }
    this.xxa = f32(this.xxa * F_098)
    this.zza = f32(this.zza * F_098)
    if (this.env.gameMode() === 'spectator') {
      this.pos.x += this.vel.x; this.pos.y += this.vel.y; this.pos.z += this.vel.z
    } else {
      this.playerTravel(this.xxa, 0, this.zza)
    }

    // end of Player#aiStep: values used on the *next* tick
    this.legacyFlyingSpeed = this.sprinting ? f32(F_002 + F_002 * 0.3) : F_002
    this.speed = f32(this.env.movementSpeed(this.sprinting))

    // LocalPlayer#aiStep tail
    if (this.onGround && this.abilities.flying && this.env.gameMode() !== 'spectator') {
      this.abilities.flying = false
      this.events.abilitiesChanged = true
    }

    // Player#tick -> updatePlayerPose
    const wantCrouch = !this.abilities.flying && this.input.shift
    if (wantCrouch !== this.crouching) {
      if (wantCrouch) this.crouching = this.canEnterPose(true)
      else if (this.canEnterPose(false)) this.crouching = false
    }
  }
}

module.exports = { PlayerPhysics, HALF, HEIGHT_STAND }
