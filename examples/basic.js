'use strict'
// Connects, waits until the player is placed in the world and walks a small square.
// node examples/basic.js <host> <port> <version> <username>

const { createBot } = require('..')

const [host = '127.0.0.1', port = '25565', version = '1.21.4', username = 'Spectra'] = process.argv.slice(2)

const bot = createBot({
  host,
  port: Number(port),
  version,
  username,
  auth: 'offline',
  spectra: { turnSpeed: 30 }
})

bot.on('forcedMove', () => {
  const p = bot.entity.position
  console.log(`teleported to ${p.x.toFixed(2)} ${p.y.toFixed(2)} ${p.z.toFixed(2)}`)
})

bot.once('spawn', async () => {
  const steps = [['forward', 30], ['left', 30], ['back', 30], ['right', 30]]
  for (const [control, ticks] of steps) {
    bot.setControlState(control, true)
    await bot.waitForTicks(ticks)
    bot.setControlState(control, false)
  }
  const p = bot.entity.position
  console.log(`done at ${p.x.toFixed(2)} ${p.y.toFixed(2)} ${p.z.toFixed(2)}, onGround=${bot.entity.onGround}`)
  bot.quit()
})

bot.on('kicked', (reason) => console.log('kicked:', reason))
bot.on('error', (err) => console.log('error:', err.message))
