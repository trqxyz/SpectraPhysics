'use strict'
// Block breaking the way MultiPlayerGameMode does it: look at a visible face, START on one tick, add the
// destroy progress and swing every tick, STOP on the tick it reaches 1, then wait 5 ticks before the next
// block. mineflayer's dig() runs on a wall clock and swings every 350 ms instead.

const { Vec3 } = require('vec3')

const DESTROY_DELAY = 5
const FACES = [
  { axis: 'y', sign: -1, face: 0 }, { axis: 'y', sign: 1, face: 1 },
  { axis: 'z', sign: -1, face: 2 }, { axis: 'z', sign: 1, face: 3 },
  { axis: 'x', sign: -1, face: 4 }, { axis: 'x', sign: 1, face: 5 }
]

function installDigger (ctx) {
  const { bot, client, V } = ctx
  const hasSequence = V.protocol >= 759
  let sequence = 0
  let job = null
  let delay = 0

  const send = (status, block, face) => {
    const packet = { status, location: block.position, face }
    if (hasSequence) packet.sequence = status === 0 || status === 2 ? ++sequence : 0
    client.write('block_dig', packet)
  }

  // faces the eyes can see, aimed at through the open side; closest first
  function aimPoints (block) {
    const eye = bot.entity.position.offset(0, bot.entity.eyeHeight ?? 1.62, 0)
    const c = block.position.offset(0.5, 0.5, 0.5)
    const out = []
    for (const f of FACES) {
      const toward = f.sign * (eye[f.axis] - c[f.axis])
      if (toward <= 0.5) continue
      const point = c.clone()
      point[f.axis] += f.sign * 0.5
      const dir = point.minus(eye).normalize()
      const hit = bot.world.raycast(eye, dir, 6)
      if (!hit || !hit.position.equals(block.position)) continue
      out.push({ point: hit.intersect ?? point, face: hit.face ?? f.face, distance: eye.distanceTo(point) })
    }
    return out.sort((a, b) => a.distance - b.distance)
  }

  async function equipBest (block) {
    const tool = bestTool(bot, block)
    if (tool && bot.heldItem?.type !== tool.type) await bot.equip(tool, 'hand')
  }

  bot.on('physicsTick', () => {
    if (delay > 0) delay--
    if (!job) return
    const block = bot.blockAt(job.block.position)
    if (!block || block.type !== job.block.type) return finish(null)
    if (!job.started) {
      if (delay > 0) return
      job.started = true
      const ticks = Math.ceil(bot.digTime(block) / 50)
      send(0, block, job.face)
      bot.swingArm()
      if (ticks <= 1) return finish(null, true)
      return
    }
    if (job.waitingBreak) {
      if (++job.waited > 20) finish(new Error('the server did not break the block'))
      return
    }
    job.progress += 50 / Math.max(50, bot.digTime(block))
    bot.swingArm()
    if (job.progress >= 1 - 1e-9) {
      send(2, block, job.face)
      delay = DESTROY_DELAY
      job.waitingBreak = true
      job.waited = 0
    }
  })

  bot.on('blockUpdate', (oldBlock, newBlock) => {
    if (!job || !newBlock || !newBlock.position.equals(job.block.position)) return
    if (newBlock.type !== job.block.type) finish(null)
  })

  function finish (err) {
    const j = job
    job = null
    if (!j) return
    if (err) j.reject(err)
    else j.resolve()
  }

  ctx.dig = async (block) => {
    if (job) throw new Error('already digging')
    const aim = aimPoints(block)[0]
    if (!aim) throw new Error(`${block.name} is not in view`)
    await bot.lookAt(aim.point)
    await equipBest(block)
    if (bot.digTime(block) === Infinity) throw new Error(`cannot dig ${block.name}`)
    return new Promise((resolve, reject) => {
      job = { block, face: aim.face, progress: 0, started: false, resolve, reject }
      setTimeout(() => { if (job && job.block === block) finish(new Error('dig timeout')) }, 60000)
    })
  }

  ctx.stopDigging = () => {
    if (!job) return
    if (job.started && !job.waitingBreak) send(1, job.block, job.face)
    finish(new Error('digging stopped'))
  }

  ctx.isDigging = () => !!job
}

// the inventory item that breaks a block fastest (null: the empty hand is as good)
function bestTool (bot, block) {
  let best = null
  let bestTime = bot.digTime ? digTimeWith(bot, block, null) : Infinity
  for (const item of bot.inventory.items()) {
    const t = digTimeWith(bot, block, item)
    if (t < bestTime) { best = item; bestTime = t }
  }
  return best
}

function digTimeWith (bot, block, item) {
  let enchants = []
  try { enchants = item?.enchants ?? [] } catch { enchants = [] }
  return block.digTime(item ? item.type : null, bot.game?.gameMode === 'creative', bot.entity.isInWater, !bot.entity.onGround,
    Array.isArray(enchants) ? enchants : [], bot.entity.effects)
}

module.exports = { installDigger, bestTool, Vec3 }
