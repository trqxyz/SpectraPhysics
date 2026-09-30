'use strict'
// ClientboundPlayerPositionPacket handling and the answer each client version sends back.

const conv = require('mineflayer/lib/conversions')
const { f32, clamp } = require('../engine/mth')

function relativeFlags (flags) {
  if (flags && typeof flags === 'object') {
    return {
      x: !!flags.x, y: !!flags.y, z: !!flags.z, yaw: !!flags.yaw, pitch: !!flags.pitch,
      dx: !!flags.dx, dy: !!flags.dy, dz: !!flags.dz, rotateDelta: !!flags.yawDelta
    }
  }
  const n = flags | 0
  return { x: !!(n & 1), y: !!(n & 2), z: !!(n & 4), yaw: !!(n & 8), pitch: !!(n & 16) }
}

// 1.16 - 1.21.1: relative axes keep their velocity, absolute ones reset it
function legacyTarget (player, packet, r) {
  const v = { ...player.vel }
  const pos = {
    x: r.x ? player.pos.x + packet.x : packet.x,
    y: r.y ? player.pos.y + packet.y : packet.y,
    z: r.z ? player.pos.z + packet.z : packet.z
  }
  if (!r.x) v.x = 0
  if (!r.y) v.y = 0
  if (!r.z) v.z = 0
  let yaw = f32(packet.yaw)
  let pitch = f32(packet.pitch)
  if (r.pitch) pitch = f32(pitch + player.xRot)
  if (r.yaw) yaw = f32(yaw + player.yRot)
  return { pos, vel: v, yaw: f32(yaw % 360), pitch: f32(clamp(pitch, -90, 90) % 360) }
}

// 1.21.2+: PositionMoveRotation#calculateAbsolute
function modernTarget (player, packet, r) {
  const pos = {
    x: (r.x ? player.pos.x : 0) + packet.x,
    y: (r.y ? player.pos.y : 0) + packet.y,
    z: (r.z ? player.pos.z : 0) + packet.z
  }
  const yaw = f32((r.yaw ? player.yRot : 0) + packet.yaw)
  const pitch = f32(clamp(f32((r.pitch ? player.xRot : 0) + packet.pitch), -90, 90))
  let v = { ...player.vel }
  if (r.rotateDelta) {
    const ax = (player.xRot - pitch) * Math.PI / 180
    const ay = (player.yRot - yaw) * Math.PI / 180
    const y1 = v.y * Math.cos(ax) + v.z * Math.sin(ax)
    const z1 = v.z * Math.cos(ax) - v.y * Math.sin(ax)
    v = { x: v.x * Math.cos(ay) + z1 * Math.sin(ay), y: y1, z: z1 * Math.cos(ay) - v.x * Math.sin(ay) }
  }
  const delta = (current, change, relative) => relative ? current + (change ?? 0) : (change ?? 0)
  return {
    pos,
    vel: { x: delta(v.x, packet.dx, r.dx), y: delta(v.y, packet.dy, r.dy), z: delta(v.z, packet.dz, r.dz) },
    yaw,
    pitch
  }
}

function installTeleport (ctx) {
  const { bot, client, V, player, state } = ctx

  const answerPosition = () => ctx.send('position_look', {
    x: player.pos.x,
    y: player.pos.y,
    z: player.pos.z,
    yaw: player.yRot,
    pitch: player.xRot,
    onGround: false,
    flags: { onGround: false, hasHorizontalCollision: false }
  })

  client.on('position', (packet) => {
    const r = relativeFlags(packet.flags)
    const target = V.relativeTeleportVelocity ? modernTarget(player, packet, r) : legacyTarget(player, packet, r)
    if (!bot.vehicle) {
      player.pos = target.pos
      player.vel = target.vel
      player.onGround = false
    }
    player.yRot = target.yaw
    player.xRot = target.pitch
    bot.entity.yaw = conv.fromNotchianYaw(target.yaw)
    bot.entity.pitch = conv.fromNotchianPitch(target.pitch)
    ctx.syncEntity()

    if (V.posRotBeforeConfirm) {
      answerPosition()
      ctx.send('teleport_confirm', { teleportId: packet.teleportId })
    } else {
      if (bot.supportFeature('teleportUsesOwnPacket')) ctx.send('teleport_confirm', { teleportId: packet.teleportId })
      answerPosition()
    }
    state.positionReceived = true
    bot.emit('forcedMove')
  })

  client.on('player_rotation', (packet) => {
    player.yRot = f32(packet.yaw)
    player.xRot = f32(clamp(packet.pitch, -90, 90))
    bot.entity.yaw = conv.fromNotchianYaw(player.yRot)
    bot.entity.pitch = conv.fromNotchianPitch(player.xRot)
  })
}

module.exports = { installTeleport }
