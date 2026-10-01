'use strict'
// Clientbound packets that change the local player, answered the way the game client does.

const { f32 } = require('../engine/mth')

function installServerHandlers (ctx) {
  const { bot, client, V, player, state, registry } = ctx

  client.on('abilities', (packet) => {
    const flags = packet.flags
    player.abilities.invulnerable = !!(flags & 1)
    player.abilities.flying = !!(flags & 2)
    player.abilities.mayfly = !!(flags & 4)
    player.abilities.instabuild = !!(flags & 8)
    player.abilities.flyingSpeed = f32(packet.flyingSpeed)
    player.abilities.walkingSpeed = f32(packet.walkingSpeed)
  })

  client.on('entity_velocity', (packet) => {
    if (!bot.entity || packet.entityId !== bot.entity.id) return
    const scale = V.lpVelocity ? 1 : 1 / 8000
    player.vel = { x: packet.velocity.x * scale, y: packet.velocity.y * scale, z: packet.velocity.z * scale }
  })

  client.on('explosion', (packet) => {
    const push = packet.playerKnockback ??
      (('playerMotionX' in packet) ? { x: packet.playerMotionX, y: packet.playerMotionY, z: packet.playerMotionZ } : null)
    if (!push) return
    player.vel.x += push.x
    player.vel.y += push.y
    player.vel.z += push.z
  })

  // an invalid slot is ignored, a valid one is confirmed on the next tick by MultiPlayerGameMode#tick
  client.removeAllListeners('held_item_slot')
  const select = (slot) => {
    state.selectedSlot = slot
    bot.quickBarSlot = slot
    try { bot.updateHeldItem?.() } catch (e) {}
  }
  client.on('held_item_slot', (packet) => {
    const slot = packet.slot ?? packet.slotId
    if (slot >= 0 && slot <= 8) select(slot)
  })
  bot.setQuickBarSlot = (slot) => {
    if (!(slot >= 0 && slot < 9)) throw new Error('invalid hotbar slot ' + slot)
    select(slot)
  }

  // LocalPlayer#swing is triggered by the animate packet for our own entity and sends a swing back
  client.on('animation', (packet) => {
    if (!bot.entity || packet.entityId !== bot.entity.id) return
    if (packet.animation === 0) ctx.send('arm_animation', { hand: 0 })
    else if (packet.animation === 3) ctx.send('arm_animation', { hand: 1 })
  })

  client.on('vehicle_move', (packet) => {
    const boat = state.boat
    if (!boat) return
    boat.pos = { x: packet.x, y: packet.y, z: packet.z }
    boat.yRot = f32(packet.yaw)
    boat.xRot = f32(packet.pitch)
    ctx.sendVehicleMove()
  })

  // mineflayer treats a full chunk without sections as an unload before 1.17; the game client keeps it loaded
  const Chunk = require('prismarine-chunk')(registry)
  client.on('map_chunk', (packet) => {
    const empty = packet.bitMap === 0 ||
      (Array.isArray(packet.bitMap) && packet.bitMap.every(n => !n || (Array.isArray(n) && n.every(m => !m))))
    if (!empty || !packet.groundUp || bot.world.getColumn(packet.x, packet.z)) return
    const column = new Chunk({ minY: bot.game.minY, worldHeight: bot.game.height })
    try {
      if (packet.biomes !== undefined) column.loadBiomes(packet.biomes)
    } catch (e) {}
    bot.world.setColumn(packet.x, packet.z, column)
  })

  // mineflayer listens for 'entityGone' on the client instead of the bot, so a removed vehicle is never left
  client.on('entity_destroy', (packet) => {
    const vehicle = bot.vehicle
    if (!vehicle || !packet.entityIds.includes(vehicle.id)) return
    bot.vehicle = null
    if (bot.entity) bot.entity.vehicle = null
    state.boat = null
    bot.emit('dismount', vehicle)
  })

  // the passenger list replaces the old one; mineflayer only appends and only leaves on vehicle id -1,
  // which the server never sends, so a bot stays "mounted" after every dismount
  client.on('set_passengers', ({ entityId, passengers }) => {
    const vehicle = bot.entities[entityId]
    if (vehicle) vehicle.passengers = passengers.map(id => bot.entities[id]).filter(Boolean)
    const current = bot.vehicle
    if (!current || current.id !== entityId || passengers.includes(bot.entity?.id)) return
    bot.vehicle = null
    if (bot.entity) bot.entity.vehicle = null
    state.boat = null
    bot.emit('dismount', current)
  })
}

module.exports = { installServerHandlers }
