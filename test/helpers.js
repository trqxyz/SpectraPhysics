'use strict'
// Offline world + player for engine tests (no server needed).

const { Vec3 } = require('vec3')
const { PlayerPhysics, WorldView, versionFlags } = require('..')

function makeWorld (version) {
  const registry = require('prismarine-registry')(version)
  const Chunk = require('prismarine-chunk')(registry)
  const Block = require('prismarine-block')(registry)
  const minY = registry.version['>=']('1.18') ? -64 : 0
  const height = registry.version['>=']('1.18') ? 384 : 256
  const columns = new Map()
  const key = (x, z) => x + ',' + z
  const world = {
    getColumn: (x, z) => columns.get(key(x, z)) ?? null
  }
  function column (cx, cz) {
    let c = columns.get(key(cx, cz))
    if (!c) {
      c = new Chunk({ minY, worldHeight: height })
      columns.set(key(cx, cz), c)
    }
    return c
  }
  // load an empty area of chunks around the origin
  for (let cx = -2; cx <= 2; cx++) for (let cz = -2; cz <= 2; cz++) column(cx, cz)

  const state = (name, props) => props
    ? Block.fromProperties(name, props, 0).stateId
    : registry.blocksByName[name].defaultState
  function set (x, y, z, name, props) {
    const c = column(x >> 4, z >> 4)
    c.setBlockStateId(new Vec3(x & 15, y, z & 15), state(name, props))
  }
  function fill (x0, y0, z0, x1, y1, z1, name, props) {
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) set(x, y, z, name, props)
  }
  const bot = { registry, world, game: { minY, height, gameMode: 'survival' } }
  return { registry, bot, set, fill }
}

function makePlayer (version, setup) {
  const w = makeWorld(version)
  if (setup) setup(w)
  const env = {
    attribute: (name, def) => def,
    movementSpeed: (sprinting) => sprinting ? 0.1 * 1.3 : 0.1,
    effect: () => null,
    food: () => 20,
    usingItem: () => false,
    gameMode: () => 'survival',
    ultraWarm: () => false
  }
  const p = new PlayerPhysics(new WorldView(w.bot), versionFlags(w.registry), env)
  return { p, w }
}

const keys = (k = {}) => ({ forward: false, back: false, left: false, right: false, jump: false, sprint: false, sneak: false, ...k })

module.exports = { makeWorld, makePlayer, keys }
