'use strict'
// SpectraPhysics: replacement for mineflayer's `physics` plugin that ticks and reports movement like the game client.

const { versionFlags } = require('../engine/version')
const WorldView = require('../engine/world')
const { PlayerPhysics } = require('../engine/player')
const { createEnvironment } = require('./environment')
const { installConnection } = require('./connection')
const { installControls } = require('./controls')
const { installTeleport } = require('./teleport')
const { installServerHandlers } = require('./server')
const { installReporter } = require('./reporter')
const { installRiding } = require('./riding')
const { installTicker } = require('./ticker')
const { installItemUse } = require('./items')
const { installInteract } = require('./interact')
const { installProtocolPatches } = require('./protocol')
const { installSimulation } = require('./simulation')
const { installPathfinder } = require('../pathfinder')

function debugLogger (option) {
  if (typeof option === 'function') return option
  return option ? (...args) => console.log('[spectra]', ...args) : null
}

function spectraPhysics (options = {}) {
  return function inject (bot) {
    const registry = bot.registry
    const V = versionFlags(registry)
    const world = new WorldView(bot)
    const state = {
      inLevel: false,
      configBrandSent: false,
      suppressPlaySettings: false,
      playSettingsSent: false,
      heldBrand: null,
      selectedSlot: 0,
      carriedSlot: 0,
      lastRotationAt: 0,
      using: null
    }
    const player = new PlayerPhysics(world, V, createEnvironment(bot, state))

    const ctx = {
      bot,
      client: bot._client,
      registry,
      V,
      world,
      player,
      options,
      debug: debugLogger(options.debug),
      onSend: options.onSend ?? null,
      outgoing: [],
      state
    }

    bot.physicsEnabled = true
    bot.physics = { gravity: 0.08, yawSpeed: 3, pitchSpeed: 3, stepHeight: 0.6, engine: 'spectra' }
    bot.spectra = {
      player,
      flags: V,
      world,
      state: ctx.state,
      get lastRotationAt () { return ctx.state.lastRotationAt },
      get onSend () { return ctx.onSend },
      set onSend (fn) { ctx.onSend = typeof fn === 'function' ? fn : null }
    }

    installProtocolPatches(ctx)
    installConnection(ctx)
    installItemUse(ctx)
    installControls(ctx)
    installInteract(ctx)
    installReporter(ctx)
    installTicker(ctx)
    installTeleport(ctx)
    installServerHandlers(ctx)
    installRiding(ctx)
    installSimulation(ctx)
    installPathfinder(ctx)
  }
}

module.exports = spectraPhysics
