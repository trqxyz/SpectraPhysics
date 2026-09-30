'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { makePlayer, keys } = require('./helpers')
const { move } = require('../lib/engine/player/move')
const { readKeys } = require('../lib/engine/player/input')
const { installReporter } = require('../lib/client/reporter')

const f32 = Math.fround

function spawn (p, x, y, z) {
  p.pos = { x, y, z }
  p.vel = { x: 0, y: 0, z: 0 }
}

function reporterFor (p) {
  const sent = []
  const ctx = {
    bot: { entity: { id: 1 }, emit () {} },
    V: p.V,
    player: p,
    state: { last: { x: 0, y: 0, z: 0, yRot: 0, xRot: 0, onGround: false, horizontalCollision: false }, positionReminder: 0, lastInput: {} },
    keys: () => keys(),
    send: (name, params) => sent.push({ name, params })
  }
  installReporter(ctx)
  return { ctx, sent }
}

test('position is reported after 0.03 before 1.18.2 and after 0.0002 later', () => {
  for (const [version, expectPacket] of [['1.16.5', false], ['1.18.2', true], ['1.21.4', true]]) {
    const { p } = makePlayer(version)
    spawn(p, 0.5, 100, 0.5)
    const { ctx, sent } = reporterFor(p)
    ctx.state.last = { x: 0.5, y: 100, z: 0.5, yRot: 0, xRot: 0, onGround: false, horizontalCollision: false }
    p.pos.x += 0.02
    ctx.sendPosition()
    assert.equal(sent.some(s => s.name === 'position'), expectPacket, version)
  }
})

test('position reminder after 20 ticks without movement', () => {
  const { p } = makePlayer('1.20.4')
  spawn(p, 0.5, 100, 0.5)
  const { ctx, sent } = reporterFor(p)
  ctx.state.last = { x: 0.5, y: 100, z: 0.5, yRot: 0, xRot: 0, onGround: false, horizontalCollision: false }
  for (let i = 0; i < 19; i++) ctx.sendPosition()
  assert.equal(sent.filter(s => s.name === 'position').length, 0)
  ctx.sendPosition()
  assert.equal(sent.filter(s => s.name === 'position').length, 1)
})

test('corner collision keeps X velocity on 1.16.5 but not on 1.18.2+', () => {
  const corner = (w) => {
    w.fill(-3, 64, -3, 3, 64, 3, 'stone')
    w.fill(1, 65, -3, 1, 66, 3, 'stone')
    w.fill(-3, 65, 1, 3, 66, 1, 'stone')
  }
  for (const [version, keepsX] of [['1.16.5', true], ['1.18.2', false], ['1.21.4', false]]) {
    const { p } = makePlayer(version, corner)
    spawn(p, 0.69, 65, 0.69)
    p.onGround = true
    p.vel = { x: 0.1, y: 0, z: 0.1 }
    move(p, 0.1, 0, 0.1)
    assert.equal(p.vel.z, 0, version)
    assert.equal(p.vel.x !== 0, keepsX, version)
  }
})

test('input: legacy scales raw keys, 1.21.5+ normalizes then squares', () => {
  const diagonal = { ...keys({ forward: true, left: true }) }
  const legacy = makePlayer('1.21.4').p
  readKeys(legacy, diagonal, false)
  assert.equal(legacy.input.forward, f32(0.98))
  assert.equal(legacy.input.left, f32(0.98))

  const modern = makePlayer('26.1').p
  readKeys(modern, diagonal, false)
  const length = Math.hypot(modern.input.left, modern.input.forward)
  assert.ok(Math.abs(length - 1) < 1e-6, `length ${length}`)
  readKeys(modern, keys({ forward: true }), false)
  assert.equal(modern.input.forward, f32(0.98))
})

test('tiny horizontal speed is cut by length on 1.21.5+, per axis before', () => {
  for (const [version, kept] of [['1.20.4', false], ['1.21.4', false], ['26.1', true]]) {
    const { p } = makePlayer(version, (w) => w.fill(-3, 64, -3, 3, 64, 3, 'stone'))
    spawn(p, 0.5, 65, 0.5)
    p.onGround = true
    p.vel = { x: 0.0029, y: 0, z: 0.0029 }
    p.cutTinyVelocity()
    assert.equal(p.vel.x !== 0, kept, version)
  }
})

test('sprinting underwater switches to the swimming pose', () => {
  const { p } = makePlayer('1.20.4', (w) => {
    w.fill(-5, 60, -5, 5, 60, 20, 'stone')
    w.fill(-5, 61, -5, 5, 64, 20, 'water', { level: 0 })
  })
  spawn(p, 0.5, 61.5, 0.5)
  for (let i = 0; i < 10; i++) p.tick(keys())
  for (let i = 0; i < 20; i++) p.tick(keys({ forward: true, sprint: true }))
  assert.equal(p.swimming, true)
  assert.equal(p.pose, 'swimming')
  assert.equal(p.height(), f32(0.6))
})

for (const version of ['1.21.4', '26.1']) {
  test(`${version}: cobweb applies after travel and slows the next move`, () => {
    const { p } = makePlayer(version, (w) => w.fill(-1, 60, -1, 1, 70, 1, 'cobweb'))
    spawn(p, 0.5, 70, 0.5)
    for (let i = 0; i < 20; i++) p.tick(keys())
    assert.ok(p.pos.y > 69, `y ${p.pos.y}`)
  })
}

test('upward bubble column lifts the player', () => {
  const { p } = makePlayer('1.20.4', (w) => {
    w.fill(-1, 59, -1, 1, 59, 1, 'stone')
    w.fill(0, 60, 0, 0, 70, 0, 'bubble_column', { drag: false })
  })
  spawn(p, 0.5, 61, 0.5)
  for (let i = 0; i < 10; i++) p.tick(keys())
  assert.ok(p.pos.y > 62, `y ${p.pos.y}`)
})

test('a player inside a block is pushed towards the free side', () => {
  const { p } = makePlayer('1.20.4', (w) => {
    w.fill(-3, 64, -3, 3, 64, 3, 'stone')
    w.fill(0, 65, -3, 3, 66, 3, 'stone')
  })
  spawn(p, 0.1, 65, 0.5)
  p.tick(keys())
  assert.ok(p.pos.x < 0.1, `x ${p.pos.x}`)
})

test('overlapping entities push the player away', () => {
  const { p } = makePlayer('1.20.4', (w) => w.fill(-3, 64, -3, 3, 64, 3, 'stone'))
  p.env.nearbyEntities = () => [{ x: 0.8, y: 65, z: 0.5, width: 0.6, height: 1.8 }]
  spawn(p, 0.5, 65, 0.5)
  p.onGround = true
  p.tick(keys())
  assert.ok(p.vel.x < 0, `vx ${p.vel.x}`)
})

test('soul sand slows walking, flying ignores it', () => {
  const run = (flying) => {
    const { p } = makePlayer('1.20.4', (w) => w.fill(-5, 64, -5, 5, 64, 60, 'soul_sand'))
    spawn(p, 0.5, 65, 0.5)
    p.abilities.flying = flying
    p.onGround = !flying
    for (let i = 0; i < 20; i++) p.tick(keys({ forward: true }))
    return p.pos.z
  }
  assert.ok(run(false) < run(true))
})
