'use strict'

const spectraPhysics = require('./lib/client')
const { PlayerPhysics } = require('./lib/engine/player')
const BoatPhysics = require('./lib/engine/boat')
const WorldView = require('./lib/engine/world')
const AABB = require('./lib/engine/aabb')
const { versionFlags } = require('./lib/engine/version')

// mineflayer.createBot with SpectraPhysics installed in place of the built-in physics plugin
function createBot (options = {}) {
  const mineflayer = require('mineflayer')
  const { spectra, ...botOptions } = options
  return mineflayer.createBot({
    ...botOptions,
    plugins: { ...(botOptions.plugins ?? {}), physics: spectraPhysics(spectra) }
  })
}

module.exports = spectraPhysics
module.exports.spectraPhysics = spectraPhysics
module.exports.createBot = createBot
module.exports.PlayerPhysics = PlayerPhysics
module.exports.BoatPhysics = BoatPhysics
module.exports.WorldView = WorldView
module.exports.AABB = AABB
module.exports.versionFlags = versionFlags
module.exports.goals = require('./lib/pathfinder/goals')
