'use strict'
// Fingerprint of the engine output: every position of every player over a course, hashed.
// Used to check that optimisations do not change a single bit of the simulation.
const crypto = require('crypto')
const { makePlayer, keys } = require('../test/helpers')

function course (w) {
  w.fill(-30, 63, -30, 30, 63, 30, 'stone')
  for (let x = -28; x <= 28; x += 6) {
    w.fill(x, 64, -28, x, 64, 28, 'smooth_stone_slab', { type: 'bottom', waterlogged: false })
    w.fill(x + 2, 64, -28, x + 2, 65, -10, 'oak_fence', { east: false, west: false, north: false, south: false, waterlogged: false })
    w.fill(x + 3, 64, 5, x + 4, 64, 28, 'water')
    w.fill(x + 1, 64, 0, x + 1, 66, 2, 'cobweb')
    w.fill(x + 5, 63, -5, x + 5, 63, -3, 'soul_sand')
    w.fill(x + 4, 63, -9, x + 4, 63, -7, 'honey_block')
  }
}

const inputs = [
  keys({ forward: true, sprint: true, jump: true }),
  keys({ forward: true, left: true }),
  keys({ back: true, sneak: true }),
  keys({ forward: true, sprint: true })
]

module.exports = function fingerprint (version, players = 12, ticks = 400) {
  const hash = crypto.createHash('sha256')
  for (let i = 0; i < players; i++) {
    const { p } = makePlayer(version, course)
    p.pos = { x: -25 + (i % 4) * 13.3, y: 64, z: -25 + Math.floor(i / 4) * 17.1 }
    p.yRot = (i * 37) % 360
    for (let t = 0; t < ticks; t++) {
      if (t % 30 === 0) p.yRot = (p.yRot + 73) % 360
      p.tick(inputs[(i + Math.floor(t / 50)) % inputs.length])
      hash.update(`${p.pos.x},${p.pos.y},${p.pos.z},${p.vel.x},${p.vel.y},${p.vel.z},${p.onGround}|`)
    }
  }
  return hash.digest('hex').slice(0, 16)
}

// node bench/trajectory.js           print the fingerprints
// node bench/trajectory.js --save    store them in bench/baseline.json
// node bench/trajectory.js --check   compare with bench/baseline.json
if (require.main === module) {
  const path = require('path')
  const file = path.join(__dirname, 'baseline.json')
  const versions = ['1.16.5', '1.17.1', '1.18.2', '1.20.4', '1.21.1', '1.21.3', '1.21.4', '1.21.5', '1.21.8', '1.21.11', '26.1']
  const out = {}
  for (const v of versions) out[v] = module.exports(v)
  if (process.argv.includes('--save')) {
    require('fs').writeFileSync(file, JSON.stringify(out, null, 2) + '\n')
  } else if (process.argv.includes('--check')) {
    const base = JSON.parse(require('fs').readFileSync(file, 'utf8'))
    const changed = versions.filter(v => base[v] !== out[v])
    console.log(changed.length ? `changed: ${changed.join(', ')}` : 'identical')
    process.exitCode = changed.length ? 1 : 0
  } else {
    console.log(JSON.stringify(out, null, 1))
  }
}
