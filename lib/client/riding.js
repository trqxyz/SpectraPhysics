'use strict'
// Passenger tick: the boat moves first (client controlled), then the rider sends rotation, input and vehicle move.

const conv = require('mineflayer/lib/conversions')
const BoatPhysics = require('../engine/boat')
const { f32, clamp, wrapDegrees } = require('../engine/mth')
const { readKeys } = require('../engine/player/input')

const isBoat = (entity) => /boat|raft/.test(entity?.name ?? '')

function riderOffset (vehicle) {
  if (isBoat(vehicle)) return f32(-0.1 + -0.35)
  if (/minecart/.test(vehicle?.name ?? '')) return f32(-0.35)
  return (vehicle?.height ?? 1) * 0.75 - 0.35
}

function installRiding (ctx) {
  const { bot, V, player, state, world } = ctx

  function tickBoat (vehicle, keys) {
    if (!state.boat || state.boat.entityId !== vehicle.id) {
      state.boat = new BoatPhysics(world, V, { position: vehicle.position, yawDegrees: f32(conv.toNotchianYaw(vehicle.yaw)) })
      state.boat.entityId = vehicle.id
    }
    state.boat.tick({ forward: keys.forward, back: keys.back, left: keys.left, right: keys.right })
    ctx.send('steer_boat', { leftPaddle: state.boat.paddle[0], rightPaddle: state.boat.paddle[1] })
    vehicle.position.set(state.boat.pos.x, state.boat.pos.y, state.boat.pos.z)
  }

  ctx.ridingTick = (vehicle) => {
    const keys = ctx.keys()
    const controlling = vehicle.passengers?.[0] === bot.entity
    if (isBoat(vehicle) && controlling) tickBoat(vehicle, keys)
    else state.boat = null

    player.riding = true
    player.vel = { x: 0, y: 0, z: 0 }
    readKeys(player, keys, false)
    player.pos = { x: vehicle.position.x, y: vehicle.position.y + riderOffset(vehicle), z: vehicle.position.z }
    ctx.turn()
    if (isBoat(vehicle)) {
      const boatYaw = state.boat ? state.boat.yRot : f32(conv.toNotchianYaw(vehicle.yaw))
      const offset = wrapDegrees(player.yRot - boatYaw)
      player.yRot = f32(player.yRot + clamp(offset, -105, 105) - offset)
    }
    ctx.syncEntity()

    if (!V.playerInputPacket) {
      ctx.sendLook()
      const flags = (player.input.jumping ? 1 : 0) | (player.input.shift ? 2 : 0)
      ctx.send('steer_vehicle', { sideways: player.input.left, forward: player.input.forward, jump: flags })
      if (state.boat) ctx.sendVehicleMove()
      return
    }
    ctx.sendShift()
    ctx.sendInput()
    ctx.sendLook()
    if (state.boat) {
      ctx.sendVehicleMove()
      ctx.sendSprinting()
    }
  }
}

module.exports = { installRiding }
