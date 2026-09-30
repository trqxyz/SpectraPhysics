'use strict'
// mineflayer movement API on top of the simulated player: control states and mouse-like turning.

const conv = require('mineflayer/lib/conversions')
const { f32, clamp, wrapDegrees } = require('../engine/mth')

const MOUSE_STEP = f32(0.15) // degrees per mouse pixel at default sensitivity
const RELEASED = Object.freeze({ forward: false, back: false, left: false, right: false, jump: false, sprint: false, sneak: false })

function installControls (ctx) {
  const { bot, player } = ctx
  const keys = { ...RELEASED }
  const turnSpeed = ctx.options.turnSpeed ?? 35
  let lookWaiters = []

  bot.setControlState = (control, value) => {
    if (!(control in keys)) throw new Error(`invalid control: ${control}`)
    keys[control] = !!value
  }
  bot.getControlState = (control) => keys[control]
  bot.clearControlStates = () => { for (const k in keys) keys[k] = false }
  bot.controlState = {}
  for (const k of Object.keys(keys)) {
    Object.defineProperty(bot.controlState, k, { get: () => keys[k], set: (v) => { keys[k] = !!v } })
  }

  // with a container open the game client stops reading movement keys
  ctx.keys = () => bot.currentWindow ? RELEASED : keys

  ctx.turn = (maxDegrees = turnSpeed) => {
    const targetYaw = conv.toNotchianYaw(bot.entity.yaw)
    const targetPitch = conv.toNotchianPitch(bot.entity.pitch)
    const limit = maxDegrees / MOUSE_STEP
    const dx = clamp(Math.round(wrapDegrees(targetYaw - player.yRot) / MOUSE_STEP), -limit, limit)
    const dy = clamp(Math.round((targetPitch - player.xRot) / MOUSE_STEP), -limit, limit)
    if (dx !== 0) player.yRot = f32(player.yRot + f32(f32(dx) * MOUSE_STEP))
    if (dy !== 0) player.xRot = f32(clamp(f32(player.xRot + f32(f32(dy) * MOUSE_STEP)), -90, 90))
    const reached = Math.abs(wrapDegrees(targetYaw - player.yRot)) < MOUSE_STEP && Math.abs(targetPitch - player.xRot) < MOUSE_STEP
    if (reached && lookWaiters.length) {
      const waiters = lookWaiters
      lookWaiters = []
      for (const resolve of waiters) resolve()
    }
  }

  bot.look = async (yaw, pitch, force) => {
    bot.entity.yaw = yaw
    bot.entity.pitch = pitch
    if (force) {
      ctx.turn(Infinity)
      return
    }
    await new Promise(resolve => lookWaiters.push(resolve))
  }

  bot.lookAt = async (point, force) => {
    const delta = point.minus(bot.entity.position.offset(0, player.eyeHeight(), 0))
    const yaw = Math.atan2(-delta.x, -delta.z)
    const pitch = Math.atan2(delta.y, Math.sqrt(delta.x * delta.x + delta.z * delta.z))
    await bot.look(yaw, pitch, force)
  }

  bot.waitForTicks = async (ticks) => {
    if (ticks <= 0) return
    await new Promise(resolve => {
      const onTick = () => {
        if (--ticks > 0) return
        bot.removeListener('physicsTick', onTick)
        resolve()
      }
      bot.on('physicsTick', onTick)
    })
  }

  bot.elytraFly = async () => { throw new Error('elytra flight is not simulated') }
}

module.exports = { installControls }
