'use strict'
// LocalPlayer#sendPosition and the state packets around it.

const { Vec3 } = require('vec3')
const { PV } = require('../engine/version')

const POINT_THREE_SQ = 9.0e-4 // 0.03, before 1.18.2
const MODERN_SQ = 4.0000000000000003e-8 // 2.0E-4 squared
const REMINDER_TICKS = 20

function installReporter (ctx) {
  const { bot, V, player, state } = ctx
  const moveThresholdSq = V.pointThree ? POINT_THREE_SQ : MODERN_SQ
  const groundFlags = () => ({ onGround: player.onGround, hasHorizontalCollision: player.horizontalCollision })

  ctx.sendSprinting = () => {
    if (player.sprinting === state.wasSprinting) return
    ctx.send('entity_action', { entityId: bot.entity.id, actionId: player.sprinting ? 'start_sprinting' : 'stop_sprinting', jumpBoost: 0 })
    state.wasSprinting = player.sprinting
  }

  ctx.sendShift = () => {
    if (V.shiftInInput) return
    const shift = player.input.shift
    if (shift === state.wasShift) return
    ctx.send('entity_action', { entityId: bot.entity.id, actionId: shift ? 'start_sneaking' : 'stop_sneaking', jumpBoost: 0 })
    state.wasShift = shift
  }

  ctx.sendInput = () => {
    const k = ctx.keys()
    const current = { forward: k.forward, backward: k.back, left: k.left, right: k.right, jump: k.jump, shift: k.sneak, sprint: k.sprint }
    const last = state.lastInput
    if (!Object.keys(current).some(key => current[key] !== last[key])) return
    ctx.send('player_input', { inputs: current })
    state.lastInput = current
  }

  ctx.sendLook = () => {
    ctx.send('look', { yaw: player.yRot, pitch: player.xRot, onGround: player.onGround, flags: groundFlags() })
    state.lastRotationAt = Date.now()
  }

  ctx.sendVehicleMove = () => {
    const boat = state.boat
    ctx.send('vehicle_move', { x: boat.pos.x, y: boat.pos.y, z: boat.pos.z, yaw: boat.yRot, pitch: boat.xRot, onGround: boat.onGround })
  }

  ctx.sendPosition = () => {
    ctx.sendSprinting()
    if (!V.playerInputPacket) ctx.sendShift()
    const last = state.last
    const { pos } = player
    const dx = pos.x - last.x
    const dy = pos.y - last.y
    const dz = pos.z - last.z
    state.positionReminder++
    const rotated = player.yRot !== last.yRot || player.xRot !== last.xRot
    // Grim drops the vertical 0.03 slack for skipped airborne and landing ticks, so those are always reported;
    // 1.17+ position_look packets under 0.03 would be taken for the item-use duplicate and ignored
    const airborne = !player.onGround || !last.onGround
    const reportSmall = V.pointThree && airborne && dy !== 0 && !(rotated && V.protocol >= PV['1.17'])
    const distanceSq = dx * dx + dy * dy + dz * dz
    const moved = distanceSq > (reportSmall ? MODERN_SQ : moveThresholdSq) || state.positionReminder >= REMINDER_TICKS
    state.creeping = V.pointThree && V.protocol >= PV['1.17'] && airborne && dy !== 0 && distanceSq <= POINT_THREE_SQ
    const flags = { onGround: player.onGround, flags: groundFlags() }
    const previous = new Vec3(last.x, last.y, last.z)

    if (moved && rotated) ctx.send('position_look', { x: pos.x, y: pos.y, z: pos.z, yaw: player.yRot, pitch: player.xRot, ...flags })
    else if (moved) ctx.send('position', { x: pos.x, y: pos.y, z: pos.z, ...flags })
    else if (rotated) ctx.send('look', { yaw: player.yRot, pitch: player.xRot, ...flags })
    else if (last.onGround !== player.onGround || (V.movementFlags && last.horizontalCollision !== player.horizontalCollision)) ctx.send('flying', flags)

    if (moved) {
      last.x = pos.x
      last.y = pos.y
      last.z = pos.z
      state.positionReminder = 0
    }
    if (rotated) {
      last.yRot = player.yRot
      last.xRot = player.xRot
      state.lastRotationAt = Date.now()
    }
    last.onGround = player.onGround
    last.horizontalCollision = player.horizontalCollision
    if (moved || rotated) bot.emit('move', previous)
  }
}

module.exports = { installReporter }
