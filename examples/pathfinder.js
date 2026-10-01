'use strict'
// Walks to the player who types "come" in chat, and follows whoever types "follow me".
// node examples/pathfinder.js <host> <port> <version> <username>

const { createBot, goals } = require('..')

const [host = '127.0.0.1', port = '25565', version = '1.21.4', username = 'Spectra'] = process.argv.slice(2)

const bot = createBot({ host, port: Number(port), version, username, auth: 'offline' })

bot.on('chat', async (sender, message) => {
  const player = bot.players[sender]?.entity
  if (!player) return
  if (message === 'come') {
    const p = player.position
    try {
      await bot.pathfinder.goto(new goals.GoalNear(p.x, p.y, p.z, 1))
      bot.chat('here')
    } catch (err) {
      bot.chat(`can't get there: ${err.message}`)
    }
  } else if (message === 'follow me') {
    bot.pathfinder.setGoal(new goals.GoalFollow(player, 2), true)
  } else if (message === 'stop') {
    bot.pathfinder.stop()
  }
})

bot.on('path_update', (r) => console.log(`path ${r.status}: ${r.path.length} moves, ${r.visitedNodes} nodes in ${r.time.toFixed(0)} ms`))
bot.on('kicked', (reason) => console.log('kicked:', reason))
bot.on('error', (err) => console.log('error:', err.message))
