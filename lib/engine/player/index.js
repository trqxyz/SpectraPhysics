'use strict'
// One client tick of the local player: LocalPlayer#aiStep -> Player#aiStep -> LivingEntity#aiStep -> travel.

const { f32 } = require('../mth')
const pose = require('./pose')
const { readKeys } = require('./input')
const { updateFluids } = require('./fluids')
const { travel, handleJump } = require('./travel')
const { applyEffectsAfterTravel } = require('./effects')
const { pushByEntities } = require('./push')

const F_002 = f32(0.02)
const F_004 = f32(0.04)
const F_1EM5 = f32(1.0e-5)
const LEGACY_AIR_SPRINT = f32(F_002 + 0.005999999865889549)
const AIR_SPRINT = f32(F_002 + f32(0.006))
const STEP = f32(0.6)

const DEFAULT_ENV = {
  attribute: (name, fallback) => fallback,
  movementSpeed: (sprinting) => sprinting ? 0.13 : 0.1,
  effect: () => null,
  bootsEnchant: () => 0,
  bootsItem: () => null,
  food: () => 20,
  usingItem: () => false,
  gameMode: () => 'survival',
  ultraWarm: () => false,
  nearbyEntities: () => []
}

class PlayerPhysics {
  constructor (world, V, env = {}) {
    this.world = world
    this.V = V
    this.env = { ...DEFAULT_ENV, ...env }
    this.reset()
  }

  reset () {
    this.pos = { x: 0, y: 0, z: 0 }
    this.vel = { x: 0, y: 0, z: 0 }
    this.yRot = 0
    this.xRot = 0
    this.pose = 'standing'
    this.onGround = false
    this.horizontalCollision = false
    this.minorHorizontalCollision = false
    this.verticalCollision = false
    this.fallDistance = 0
    this.sprinting = false
    this.swimming = false
    this.riding = false
    this.noJumpDelay = 0
    this.jumpTriggerTime = 0
    this.sprintTriggerTime = 0
    this.legacyFlyingSpeed = F_002
    this.stuck = null
    this.wasTouchingWater = false
    this.fluidHeight = { water: 0, lava: 0 }
    this.eyeInWater = false
    this.wasEyeInWater = false
    this.firstTick = true
    this.supportingBlock = null
    this.onGroundNoBlocks = false
    this.movesThisTick = []
    this.tickStart = { x: 0, y: 0, z: 0 }
    this.abilities = { invulnerable: false, flying: false, mayfly: false, instabuild: false, flyingSpeed: f32(0.05), walkingSpeed: f32(0.1) }
    this.input = { left: 0, forward: 0, forwardKey: 0, jumping: false, shift: false, keys: {} }
    this.xxa = 0
    this.zza = 0
    this.events = { abilitiesChanged: false }
  }

  height () { return pose.POSES[this.pose].height }
  eyeHeight () { return pose.POSES[this.pose].eye }
  bbAt (x, y, z) { return pose.boxFor(this.pose, x, y, z) }
  bb () { return this.bbAt(this.pos.x, this.pos.y, this.pos.z) }

  maxUpStep () {
    return this.V.attributes2005 ? f32(this.env.attribute('step_height', 0.6)) : STEP
  }

  // the server applies the sprint modifier as soon as it sees START_SPRINTING, so the speed follows it in the same tick
  movementSpeed () { return f32(this.env.movementSpeed(this.sprinting)) }

  isInWater () { return this.wasTouchingWater }
  isInLava () { return !this.firstTick && this.fluidHeight.lava > 0 }
  isUnderWater () { return this.wasEyeInWater && this.isInWater() }

  hasEnoughImpulseToStartSprint () {
    if (this.isUnderWater()) return this.input.forward > F_1EM5
    return this.input.forwardKey > 0 && (this.V.inputModel === 'modern' || this.input.forward >= 0.8)
  }

  tick (keys) {
    this.tickStart = { ...this.pos }
    this.movesThisTick.length = 0
    this.baseTick()

    const previousJump = this.input.jumping
    const previousShift = this.input.shift
    const previousImpulse = this.hasEnoughImpulseToStartSprint()
    const slow = pose.isMovingSlowly(this, previousShift)
    readKeys(this, keys, slow)
    pose.pushOutOfBlocks(this)
    this.updateSprinting(keys, previousShift, previousImpulse, slow)
    this.updateFlightToggle(previousJump)
    if (this.isInWater() && this.input.shift && !this.abilities.flying) this.vel.y -= F_004
    if (this.abilities.flying) {
      const direction = (this.input.jumping ? 1 : 0) - (this.input.shift ? 1 : 0)
      if (direction !== 0) this.vel.y += f32(f32(direction * this.abilities.flyingSpeed) * 3)
    }
    if (this.jumpTriggerTime > 0) this.jumpTriggerTime--

    this.livingAiStep()

    this.legacyFlyingSpeed = this.sprinting ? (this.V.airSprintFloatSum ? AIR_SPRINT : LEGACY_AIR_SPRINT) : F_002
    if (this.onGround && this.abilities.flying && this.env.gameMode() !== 'spectator') {
      this.abilities.flying = false
      this.events.abilitiesChanged = true
    }
    pose.updatePose(this)
  }

  // Entity#baseTick
  baseTick () {
    updateFluids(this)
    if (this.isInLava()) this.fallDistance = this.V.fallDistanceDouble ? this.fallDistance * 0.5 : f32(this.fallDistance * 0.5)
    this.firstTick = false
  }

  livingAiStep () {
    if (this.noJumpDelay > 0) this.noJumpDelay--
    this.cutTinyVelocity()
    this.xxa = this.input.left
    this.zza = this.input.forward
    handleJump(this)
    if (this.env.gameMode() === 'spectator') {
      this.pos.x += this.vel.x; this.pos.y += this.vel.y; this.pos.z += this.vel.z
      return
    }
    travel(this)
    applyEffectsAfterTravel(this)
    pushByEntities(this)
  }

  cutTinyVelocity () {
    const v = this.vel
    if (this.V.horizontalThreshold && !this.riding) {
      if (v.x * v.x + v.z * v.z < 9.0e-6) { v.x = 0; v.z = 0 }
    } else {
      if (Math.abs(v.x) < 0.003) v.x = 0
      if (Math.abs(v.z) < 0.003) v.z = 0
    }
    if (Math.abs(v.y) < 0.003) v.y = 0
  }

  // sprint rules of LocalPlayer#aiStep
  updateSprinting (keys, previousShift, previousImpulse, slow) {
    const V = this.V
    const food = this.env.food() > 6 || this.abilities.mayfly
    const blocked = this.env.usingItem() || this.env.effect('blindness') != null ||
      (V.playerInputPacket && slow && !this.isUnderWater())
    if (previousShift) this.sprintTriggerTime = 0
    if (this.sprintTriggerTime > 0) this.sprintTriggerTime--

    const impulse = this.hasEnoughImpulseToStartSprint()
    if (!this.sprinting && (this.onGround || this.isUnderWater()) && !previousShift && !previousImpulse && impulse && food && !blocked) {
      if (this.sprintTriggerTime <= 0 && !keys.sprint) this.sprintTriggerTime = 7
      else this.sprinting = true
    }
    if (!this.sprinting && (!this.isInWater() || this.isUnderWater()) && impulse && food && !blocked && keys.sprint) {
      this.sprinting = true
    }
    if (!this.sprinting) return

    const noForward = !(this.input.forward > F_1EM5) || !food
    if (this.swimming) {
      if ((!this.onGround && !this.input.shift && noForward) || !this.isInWater()) this.sprinting = false
      return
    }
    const wall = V.minorCollision ? this.horizontalCollision && !this.minorHorizontalCollision : this.horizontalCollision
    const sneaking = V.playerInputPacket && slow && !this.isUnderWater()
    if (noForward || wall || (this.isInWater() && !this.isUnderWater()) || sneaking) this.sprinting = false
  }

  // double tap jump toggles creative flight
  updateFlightToggle (previousJump) {
    if (!this.abilities.mayfly || this.env.gameMode() === 'spectator') return
    if (previousJump || !this.input.jumping) return
    if (this.jumpTriggerTime === 0) {
      this.jumpTriggerTime = 7
      return
    }
    this.abilities.flying = !this.abilities.flying
    this.events.abilitiesChanged = true
    this.jumpTriggerTime = 0
  }
}

module.exports = { PlayerPhysics }
