'use strict'
// Minecraft#tick for the local player plus the timer that drives it.

const { performance } = require('perf_hooks')

const TICK_MS = 50
const MAX_CATCH_UP = 10
const LOAD_TIMEOUT_TICKS = 60
const MAX_TURN_DELAY = 40

const released = () => ({ forward: false, backward: false, left: false, right: false, jump: false, shift: false, sprint: false })

function installTicker (ctx) {
  const { bot, client, V, player, state, world } = ctx

  ctx.syncEntity = () => {
    const e = bot.entity
    if (!e) return
    e.position.set(player.pos.x, player.pos.y, player.pos.z)
    e.velocity.set(player.vel.x, player.vel.y, player.vel.z)
    e.onGround = player.onGround
    e.isInWater = player.isInWater()
    e.isInLava = player.isInLava()
    e.height = player.height()
    e.eyeHeight = player.eyeHeight()
    e.isCollidedHorizontally = player.horizontalCollision
    e.isCollidedVertically = player.verticalCollision
  }

  function resetPlayer () {
    const abilities = player.abilities
    player.reset()
    player.abilities = abilities
    Object.assign(state, {
      positionReceived: false,
      clientLoaded: false,
      loadedReadyTicks: 0,
      loadTimeout: LOAD_TIMEOUT_TICKS,
      last: { x: 0, y: 0, z: 0, yRot: 0, xRot: 0, onGround: false, horizontalCollision: false },
      positionReminder: 0,
      creeping: false,
      turnDelay: 0,
      wasSprinting: false,
      wasShift: false,
      lastInput: released(),
      boat: null
    })
  }

  // 1.21.4+: the player only ticks once the level screen closes, which is when player_loaded is sent
  function waitForLevel () {
    const outside = player.pos.y < world.minY || player.pos.y >= world.maxY
    state.loadedReadyTicks = (outside || world.hasChunk(player.pos.x, player.pos.z)) ? state.loadedReadyTicks + 1 : 0
    if (state.loadedReadyTicks < 2 && --state.loadTimeout > 0) return false
    state.clientLoaded = true
    ctx.send('player_loaded', {})
    bot.emit('clientLoaded')
    return true
  }

  function playerTick () {
    if (!state.positionReceived) return
    if (!world.hasChunk(player.pos.x, player.pos.z)) return
    if (V.clientLoaded && !state.clientLoaded) {
      waitForLevel()
      return
    }
    if (bot.isAlive === false) return
    player.riding = false
    // 1.17 - 1.18.1: a turn while creeping through the air can't be reported cleanly, the mouse waits a moment
    if (state.creeping && state.turnDelay < MAX_TURN_DELAY) state.turnDelay++
    else {
      ctx.turn(state.turnDelay >= MAX_TURN_DELAY ? Infinity : undefined)
      state.turnDelay = 0
    }
    if (bot.physicsEnabled) {
      player.tick(ctx.keys())
      if (player.events.abilitiesChanged) {
        player.events.abilitiesChanged = false
        ctx.send('abilities', { flags: player.abilities.flying ? 2 : 0 })
      }
    }
    ctx.syncEntity()
    if (V.playerInputPacket) {
      ctx.sendShift()
      ctx.sendInput()
    }
    ctx.sendPosition()
  }

  function clientTick () {
    if (client.state !== 'play' || !state.inLevel || !bot.entity) return
    if (state.selectedSlot !== state.carriedSlot) {
      state.carriedSlot = state.selectedSlot
      ctx.send('held_item_slot', { slotId: state.selectedSlot })
    }
    ctx.flushHeldBrand()
    const vehicle = bot.vehicle
    if (vehicle && vehicle !== bot.entity && state.positionReceived) {
      ctx.ridingTick(vehicle)
    } else {
      state.boat = null
      playerTick()
    }
    if (V.tickEnd) ctx.send('tick_end', {})
    bot.emit('physicsTick')
  }

  let timer = null
  let nextAt = 0
  function start () {
    if (timer) return
    nextAt = performance.now() + TICK_MS
    const loop = () => {
      const now = performance.now()
      for (let n = 0; now >= nextAt && n < MAX_CATCH_UP; n++) {
        try { clientTick() } catch (err) { bot.emit('error', err) }
        nextAt += TICK_MS
      }
      if (now - nextAt > 1000) nextAt = now + TICK_MS
      timer = setTimeout(loop, Math.max(0, nextAt - performance.now()))
    }
    timer = setTimeout(loop, TICK_MS)
  }

  client.on('login', () => {
    state.inLevel = true
    state.playSettingsSent = false
    state.selectedSlot = 0
    state.carriedSlot = 0
    resetPlayer()
    start()
  })
  client.on('respawn', resetPlayer)
  client.on('start_configuration', () => { state.inLevel = false })
  bot.on('end', () => {
    clearTimeout(timer)
    timer = null
  })

  resetPlayer()
}

module.exports = { installTicker }
