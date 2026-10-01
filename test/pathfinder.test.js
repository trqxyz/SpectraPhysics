'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { makeWorld } = require('./helpers')
const WorldView = require('../lib/engine/world')
const { Terrain } = require('../lib/pathfinder/terrain')
const { AStar } = require('../lib/pathfinder/astar')
const goals = require('../lib/pathfinder/goals')

function plan (setup, start, goal, options = {}) {
  const w = makeWorld('1.21.4')
  w.fill(-20, 63, -20, 20, 63, 20, 'stone')
  setup(w)
  const opts = { canDig: false, allowParkour: true, maxDropDown: 3, tickTimeout: 2000, thinkTimeout: 4000, maxNodes: 200000, ...options }
  const terrain = new Terrain(new WorldView(w.bot), opts)
  const node = { x: start[0], y: start[1], z: start[2], floor: terrain.floorAt(start[0], start[1], start[2]), dig: [] }
  return new AStar(node, goal, terrain, opts).compute()
}

const kinds = (r) => r.path.map(n => n.kind)

test('walks around a wall instead of through it', () => {
  const r = plan(w => w.fill(2, 64, -10, 2, 66, 10, 'stone'), [0, 64, 0], new goals.GoalBlock(4, 64, 0))
  assert.equal(r.status, 'success')
  assert.ok(r.path.every(n => n.dig.length === 0))
  assert.ok(r.path.some(n => Math.abs(n.z) >= 10))
})

test('tunnels through a wall it cannot walk around', () => {
  const r = plan(w => w.fill(2, 64, -20, 2, 66, 20, 'stone'), [0, 64, 0], new goals.GoalBlock(4, 64, 0), { canDig: true })
  assert.equal(r.status, 'success')
  assert.deepEqual(r.path.find(n => n.dig.length).dig.map(d => d[1]), [65, 64])
})

test('jumps up a block and steps up slabs without jumping', () => {
  const up = plan(w => w.fill(2, 64, -20, 20, 64, 20, 'stone'), [0, 64, 0], new goals.GoalBlock(4, 65, 0))
  assert.ok(kinds(up).includes('jump'))
  const slabs = plan(w => {
    w.fill(2, 64, -20, 20, 64, 20, 'smooth_stone_slab', { type: 'bottom', waterlogged: false })
    w.fill(4, 64, -20, 20, 64, 20, 'stone')
  }, [0, 64, 0], new goals.GoalBlock(6, 65, 0))
  assert.equal(slabs.status, 'success')
  assert.ok(!kinds(slabs).includes('jump'))
})

test('climbs a ladder, jumps a lava gap, crosses water', () => {
  const ladder = plan(w => {
    w.fill(3, 64, -20, 3, 70, 20, 'stone')
    w.fill(2, 64, 0, 2, 70, 0, 'ladder', { facing: 'west', waterlogged: false })
  }, [0, 64, 0], new goals.GoalBlock(3, 71, 0))
  assert.equal(ladder.status, 'success')
  assert.ok(kinds(ladder).filter(k => k === 'climb').length >= 6)

  const lava = plan(w => w.fill(2, 63, -20, 3, 63, 20, 'lava'), [0, 64, 0], new goals.GoalBlock(6, 64, 0))
  assert.ok(kinds(lava).includes('parkour'))

  const water = plan(w => w.fill(2, 60, -20, 10, 63, 20, 'water'), [0, 64, 0], new goals.GoalBlock(12, 64, 0))
  assert.equal(water.status, 'success')
  assert.ok(kinds(water).includes('swim'))
})

test('never steps into lava or onto magma', () => {
  const r = plan(w => {
    w.fill(2, 63, -20, 2, 63, 20, 'magma_block')
    w.fill(3, 63, -20, 3, 63, 20, 'lava')
  }, [0, 64, 0], new goals.GoalBlock(6, 64, 0), { allowParkour: false })
  assert.notEqual(r.status, 'success')
})

test('digs straight down to a level', () => {
  const r = plan(w => w.fill(-20, 50, -20, 20, 63, 20, 'stone'), [0, 64, 0], new goals.GoalY(60), { canDig: true })
  assert.equal(r.status, 'success')
  assert.equal(r.path.at(-1).y, 60)
})
