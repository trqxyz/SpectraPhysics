'use strict'
// One 20 TPS timer for every bot in the process (Minecraft's Timer: catches up at most 10 ticks,
// gives up after falling a second behind).

const { performance } = require('perf_hooks')

const TICK_MS = 50
const MAX_CATCH_UP = 10

const tickers = new Set()
let timer = null
let nextAt = 0

function loop () {
  const now = performance.now()
  for (let n = 0; now >= nextAt && n < MAX_CATCH_UP; n++) {
    for (const tick of tickers) tick()
    nextAt += TICK_MS
  }
  if (now - nextAt > 1000) nextAt = now + TICK_MS
  timer = tickers.size ? setTimeout(loop, Math.max(0, nextAt - performance.now())) : null
}

function startTicking (tick) {
  tickers.add(tick)
  if (timer) return
  nextAt = performance.now() + TICK_MS
  timer = setTimeout(loop, TICK_MS)
}

function stopTicking (tick) {
  tickers.delete(tick)
  if (tickers.size || !timer) return
  clearTimeout(timer)
  timer = null
}

module.exports = { startTicking, stopTicking, TICK_MS }
