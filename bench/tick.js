'use strict'
// Engine tick cost: players sprint-jumping through a course of stairs, slabs, walls, water and fences.
// usage: node bench/tick.js [version] [players] [ticks]

const { performance } = require('perf_hooks')
const { makePlayer, keys } = require('../test/helpers')

const version = process.argv[2] ?? '1.21.4'
const players = Number(process.argv[3] ?? 50)
const ticks = Number(process.argv[4] ?? 2000)

function course (w) {
  w.fill(-30, 63, -30, 30, 63, 30, 'stone')
  for (let x = -28; x <= 28; x += 6) {
    w.fill(x, 64, -28, x, 64, 28, 'smooth_stone_slab', { type: 'bottom', waterlogged: false })
    w.fill(x + 2, 64, -28, x + 2, 65, -10, 'oak_fence', { east: false, west: false, north: false, south: false, waterlogged: false })
    w.fill(x + 3, 64, 5, x + 4, 64, 28, 'water')
  }
}

const sims = []
for (let i = 0; i < players; i++) {
  const { p } = makePlayer(version, course)
  p.pos = { x: -25 + (i % 10) * 5, y: 64, z: -25 + Math.floor(i / 10) * 5 }
  p.yRot = (i * 37) % 360
  sims.push(p)
}
const input = keys({ forward: true, sprint: true, jump: true })

const warm = Math.min(200, ticks)
for (let t = 0; t < warm; t++) for (const p of sims) p.tick(input)

const start = performance.now()
for (let t = 0; t < ticks; t++) {
  for (const p of sims) {
    if (t % 40 === 0) p.yRot = (p.yRot + 90) % 360
    p.tick(input)
  }
}
const ms = performance.now() - start
const per = ms * 1000 / (ticks * players)
console.log(`${version}: ${players} players x ${ticks} ticks in ${ms.toFixed(0)} ms, ${per.toFixed(1)} us per player tick`)
