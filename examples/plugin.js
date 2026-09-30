'use strict'
// Installing SpectraPhysics into an existing mineflayer setup instead of using createBot().
// node examples/plugin.js <host> <port> <version> <username>

const mineflayer = require('mineflayer')
const spectraPhysics = require('..')

const [host = '127.0.0.1', port = '25565', version = '1.21.4', username = 'Spectra'] = process.argv.slice(2)

const bot = mineflayer.createBot({
  host,
  port: Number(port),
  version,
  username,
  auth: 'offline',
  // the key must be `physics`: it replaces mineflayer's built-in physics plugin
  plugins: { physics: spectraPhysics({ debug: false }) }
})

bot.once('spawn', async () => {
  // look around with vanilla mouse steps, then sprint-jump forward
  await bot.look(Math.PI / 2, 0)
  bot.setControlState('forward', true)
  bot.setControlState('sprint', true)
  bot.setControlState('jump', true)
  await bot.waitForTicks(40)
  bot.clearControlStates()

  // sneak to an edge without falling off
  bot.setControlState('sneak', true)
  bot.setControlState('forward', true)
  await bot.waitForTicks(60)
  bot.clearControlStates()

  const { player, flags } = bot.spectra
  console.log(`protocol ${flags.protocol}, y=${player.pos.y.toFixed(4)}, onGround=${player.onGround}, fallDistance=${player.fallDistance}`)
  bot.quit()
})

bot.on('error', (err) => console.log('error:', err.message))
