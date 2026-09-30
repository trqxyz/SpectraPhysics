'use strict'

const { f32, sin, cos, degToRadF, clamp } = require('../mth')
const { moveRelative } = require('./input')
const { move } = require('./move')
const { fluidFallingAdjusted } = require('./fluids')
const blocks = require('./blocks')

const F_098 = f32(0.98)
const F_091 = f32(0.91)
const F_08 = f32(0.8)
const F_09 = f32(0.9)
const F_096 = f32(0.96)
const F_002 = f32(0.02)
const F_0026 = f32(0.025999999)
const F_0216 = f32(0.21600002)
const F_0546 = f32(0.54600006)
const F_015 = f32(0.15)
const F_042 = f32(0.42)
const F_01 = f32(0.1)
const F_02 = f32(0.2)
const F_004 = f32(0.04)
const F_06 = 0.6000000238418579
const F_03 = 0.30000001192092896

function flyingSpeed (player) {
  if (!player.V.flyingSpeedLive) return player.legacyFlyingSpeed
  if (player.abilities.flying) return player.sprinting ? f32(player.abilities.flyingSpeed * 2) : player.abilities.flyingSpeed
  return player.sprinting ? F_0026 : F_002
}

function frictionInfluencedSpeed (player, friction) {
  if (player.onGround) return f32(player.speed * f32(F_0216 / f32(f32(friction * friction) * friction)))
  return flyingSpeed(player)
}

function handleOnClimbable (player) {
  if (!blocks.onClimbable(player)) return
  player.fallDistance = 0
  player.vel.x = clamp(player.vel.x, -F_015, F_015)
  player.vel.z = clamp(player.vel.z, -F_015, F_015)
  let vy = Math.max(player.vel.y, -F_015)
  if (vy < 0 && !blocks.feetBlock(player).isScaffolding && player.input.shift) vy = 0
  player.vel.y = vy
}

function isFree (player, dx, dy, dz) {
  const box = player.bb().move(dx, dy, dz)
  return player.world.noCollision(box) && !player.world.containsAnyLiquid(box)
}

// LivingEntity#jumpFromGround
function jumpFromGround (player) {
  const V = player.V
  const strength = V.attributes2005 ? f32(player.env.attribute('jump_strength', 0.42)) : F_042
  let power = f32(strength * blocks.jumpFactor(player))
  const boost = player.env.effect('jump_boost')
  if (boost != null) power = f32(power + f32(F_01 * (boost + 1)))
  if (V.attributes2005 && power <= 1.0e-5) return
  player.vel.y = V.jumpKeepsHigherY ? Math.max(power, player.vel.y) : power
  if (!player.sprinting) return
  const r = degToRadF(player.yRot)
  if (V.jumpDoubleSprintBoost) {
    player.vel.x += -sin(r) * 0.2
    player.vel.z += cos(r) * 0.2
  } else {
    player.vel.x += f32(-sin(r) * F_02)
    player.vel.z += f32(cos(r) * F_02)
  }
}

// jump handling in LivingEntity#aiStep
function handleJump (player) {
  if (!player.input.jumping || player.abilities.flying) {
    player.noJumpDelay = 0
    return
  }
  const inLava = player.isInLava()
  const height = inLava ? player.fluidHeight.lava : player.fluidHeight.water
  const inWater = player.isInWater() && height > 0
  const threshold = player.eyeHeight() < 0.4 ? 0 : 0.4
  if (inWater && !(player.onGround && !(height > threshold))) {
    player.vel.y += F_004
  } else if (inLava && !(player.onGround && !(height > threshold))) {
    player.vel.y += F_004
  } else if ((player.onGround || (inWater && height <= threshold)) && player.noJumpDelay === 0) {
    jumpFromGround(player)
    player.noJumpDelay = 10
  }
}

function travelInWater (player, ix, iy, iz, gravity, falling) {
  const V = player.V
  const startY = player.pos.y
  let friction = player.sprinting ? F_09 : F_08
  let speed = F_002
  let strider = V.efficiencyAttributes
    ? f32(player.env.attribute('water_movement_efficiency', 0))
    : Math.min(3, player.env.bootsEnchant('depth_strider'))
  if (!player.onGround) strider = f32(strider * 0.5)
  if (strider > 0) {
    const divisor = V.efficiencyAttributes ? 1 : 3
    friction = f32(friction + f32(f32(f32(F_0546 - friction) * strider) / divisor))
    speed = f32(speed + f32(f32(f32(player.speed - speed) * strider) / divisor))
  }
  if (player.env.effect('dolphins_grace') != null) friction = F_096
  moveRelative(player, speed, ix, iy, iz)
  move(player, player.vel.x, player.vel.y, player.vel.z)
  if (player.horizontalCollision && blocks.onClimbable(player)) player.vel.y = 0.2
  player.vel.x *= friction
  player.vel.y *= F_08
  player.vel.z *= friction
  fluidFallingAdjusted(player, gravity, falling)
  if (player.horizontalCollision && isFree(player, player.vel.x, player.vel.y + F_06 - player.pos.y + startY, player.vel.z)) {
    player.vel.y = F_03
  }
}

function travelInLava (player, ix, iy, iz, gravity, falling) {
  const startY = player.pos.y
  moveRelative(player, F_002, ix, iy, iz)
  move(player, player.vel.x, player.vel.y, player.vel.z)
  if (player.fluidHeight.lava <= 0.4) {
    player.vel.x *= 0.5
    player.vel.y *= F_08
    player.vel.z *= 0.5
    fluidFallingAdjusted(player, gravity, falling)
  } else {
    player.vel.x *= 0.5
    player.vel.y *= 0.5
    player.vel.z *= 0.5
  }
  player.vel.y += -gravity / 4
  if (player.horizontalCollision && isFree(player, player.vel.x, player.vel.y + F_06 - player.pos.y + startY, player.vel.z)) {
    player.vel.y = F_03
  }
}

function travelInAir (player, ix, iy, iz, gravity) {
  const below = blocks.belowPos(player)
  const friction = player.world.blockAt(below.x, below.y, below.z).friction
  const drag = player.onGround ? f32(friction * F_091) : F_091
  moveRelative(player, frictionInfluencedSpeed(player, friction), ix, iy, iz)
  handleOnClimbable(player)
  move(player, player.vel.x, player.vel.y, player.vel.z)
  if ((player.horizontalCollision || player.input.jumping) && (blocks.onClimbable(player) || blocks.onPowderSnowWithBoots(player))) {
    player.vel.y = 0.2
  }
  let vy = player.vel.y
  const levitation = player.env.effect('levitation')
  if (levitation != null) {
    vy += (0.05 * (levitation + 1) - player.vel.y) * 0.2
    player.fallDistance = 0
  } else if (!player.world.hasChunk(below.x, below.z)) {
    vy = player.pos.y > player.world.minY ? -0.1 : 0
  } else {
    vy -= gravity
  }
  player.vel.x *= drag
  player.vel.y = vy * F_098
  player.vel.z *= drag
}

// LivingEntity#travel
function livingTravel (player, ix, iy, iz) {
  const falling = player.vel.y <= 0
  let gravity = player.V.attributes2005 ? player.env.attribute('gravity', 0.08) : 0.08
  if (falling && player.env.effect('slow_falling') != null) {
    gravity = player.V.attributes2005 ? Math.min(gravity, 0.01) : 0.01
    player.fallDistance = 0
  }
  const affected = !player.abilities.flying
  if (player.isInWater() && affected) travelInWater(player, ix, iy, iz, gravity, falling)
  else if (player.isInLava() && affected) travelInLava(player, ix, iy, iz, gravity, falling)
  else travelInAir(player, ix, iy, iz, gravity)
}

function swimTowardsLook (player) {
  const lookY = -sin(degToRadF(player.xRot))
  const k = lookY < -0.2 ? 0.085 : 0.06
  const above = player.world.fluidAt(Math.floor(player.pos.x), Math.floor(player.pos.y + 1 - 0.1), Math.floor(player.pos.z))
  if (lookY <= 0 || player.input.jumping || above) player.vel.y += (lookY - player.vel.y) * k
}

// Player#travel
function travel (player) {
  const ix = player.xxa
  const iz = player.zza
  if (player.swimming && !player.riding) swimTowardsLook(player)
  if (!player.abilities.flying) {
    livingTravel(player, ix, 0, iz)
    return
  }
  const startVy = player.vel.y
  const saved = player.legacyFlyingSpeed
  if (!player.V.flyingSpeedLive) player.legacyFlyingSpeed = f32(player.abilities.flyingSpeed * (player.sprinting ? 2 : 1))
  livingTravel(player, ix, 0, iz)
  player.vel.y = startVy * 0.6
  player.legacyFlyingSpeed = saved
  player.fallDistance = 0
}

module.exports = { travel, handleJump }
