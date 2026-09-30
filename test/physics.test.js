'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { makePlayer, keys } = require('./helpers')

const f32 = Math.fround
const VERSIONS = ['1.16.5', '1.18.2', '1.20.4', '1.21.4', '26.1']

function spawn (p, x, y, z) {
  p.pos.x = x; p.pos.y = y; p.pos.z = z
  p.vel.x = 0; p.vel.y = 0; p.vel.z = 0
}

for (const version of VERSIONS) {
  test(`${version}: free fall follows (v - 0.08) * 0.98f, first tick does not move`, () => {
    const { p } = makePlayer(version)
    spawn(p, 0.5, 100, 0.5)
    let v = 0
    let y = 100
    for (let i = 0; i < 40; i++) {
      p.tick(keys())
      y += v // movement uses the velocity from the previous tick
      v = (v - 0.08) * f32(0.98)
      if (Math.abs(v) < 0.003) v = 0
      assert.ok(Math.abs(p.pos.y - y) < 1e-9, `tick ${i}: y=${p.pos.y} expected ${y}`)
    }
    assert.equal(p.onGround, false)
  })

  test(`${version}: lands exactly on top of a full block`, () => {
    const { p } = makePlayer(version, (w) => w.fill(-2, 64, -2, 2, 64, 2, 'stone'))
    spawn(p, 0.5, 70, 0.5)
    for (let i = 0; i < 60 && !p.onGround; i++) p.tick(keys())
    assert.equal(p.onGround, true)
    assert.equal(p.pos.y, 65)
    // on the ground vanilla keeps applying gravity: (0 - 0.08) * 0.98f
    assert.ok(Math.abs(p.vel.y - (-0.08 * f32(0.98))) < 1e-12, `vy ${p.vel.y}`)
  })

  test(`${version}: lands exactly on a bottom slab`, () => {
    const { p } = makePlayer(version, (w) => w.fill(-2, 64, -2, 2, 64, 2, 'stone_slab', { type: 'bottom', waterlogged: false }))
    spawn(p, 0.5, 70, 0.5)
    for (let i = 0; i < 60 && !p.onGround; i++) p.tick(keys())
    assert.equal(p.onGround, true)
    assert.equal(p.pos.y, 64.5)
  })

  test(`${version}: walking reaches vanilla speed (~0.2158 blocks/tick)`, () => {
    const { p } = makePlayer(version, (w) => w.fill(-20, 64, -40, 20, 64, 20, 'stone'))
    spawn(p, 0.5, 65, 0.5)
    p.tick(keys())
    let last = p.pos.z
    let speed = 0
    for (let i = 0; i < 60; i++) {
      p.tick(keys({ forward: true }))
      speed = Math.abs(p.pos.z - last)
      last = p.pos.z
    }
    assert.ok(Math.abs(speed - 0.21585) < 2e-3, `speed ${speed}`)
    assert.equal(p.sprinting, false)
  })

  test(`${version}: sprinting reaches vanilla speed (~0.2806 blocks/tick)`, () => {
    const { p } = makePlayer(version, (w) => w.fill(-20, 64, -60, 20, 64, 20, 'stone'))
    spawn(p, 0.5, 65, 0.5)
    p.tick(keys())
    let last = p.pos.z
    let speed = 0
    for (let i = 0; i < 60; i++) {
      p.tick(keys({ forward: true, sprint: true }))
      speed = Math.abs(p.pos.z - last)
      last = p.pos.z
    }
    assert.equal(p.sprinting, true)
    assert.ok(Math.abs(speed - 0.2806) < 3e-3, `speed ${speed}`)
  })

  test(`${version}: jump apex is ~1.2522 blocks`, () => {
    const { p } = makePlayer(version, (w) => w.fill(-2, 64, -2, 2, 64, 2, 'stone'))
    spawn(p, 0.5, 65, 0.5)
    p.tick(keys())
    p.tick(keys())
    let top = 65
    p.tick(keys({ jump: true }))
    for (let i = 0; i < 20; i++) { p.tick(keys()); top = Math.max(top, p.pos.y) }
    assert.ok(Math.abs(top - 65 - 1.2522) < 1e-3, `apex ${top - 65}`)
    assert.equal(p.pos.y, 65)
    assert.equal(p.onGround, true)
  })

  test(`${version}: steps up onto a slab while walking`, () => {
    const { p } = makePlayer(version, (w) => {
      w.fill(-2, 64, -2, 2, 64, 10, 'stone')
      w.fill(-2, 65, 3, 2, 65, 10, 'stone_slab', { type: 'bottom', waterlogged: false })
    })
    spawn(p, 0.5, 65, 0.5)
    p.tick(keys())
    // yaw 0 faces +z
    for (let i = 0; i < 30; i++) p.tick(keys({ forward: true }))
    assert.ok(p.pos.z > 3.3, `z ${p.pos.z}`)
    assert.equal(p.pos.y, 65.5)
    assert.equal(p.onGround, true)
  })

  test(`${version}: stops at a wall and reports horizontal collision`, () => {
    const { p } = makePlayer(version, (w) => {
      w.fill(-2, 64, -2, 2, 64, 10, 'stone')
      w.fill(-2, 65, 3, 2, 66, 3, 'stone')
    })
    spawn(p, 0.5, 65, 0.5)
    p.tick(keys())
    for (let i = 0; i < 30; i++) p.tick(keys({ forward: true }))
    assert.ok(Math.abs(p.pos.z - (3 - f32(0.3))) < 1e-6, `z ${p.pos.z}`)
    assert.equal(p.horizontalCollision, true)
  })

  test(`${version}: sneaking does not walk off an edge`, () => {
    const { p } = makePlayer(version, (w) => w.fill(0, 64, 0, 0, 64, 0, 'stone'))
    spawn(p, 0.5, 65, 0.5)
    p.tick(keys({ sneak: true }))
    for (let i = 0; i < 40; i++) p.tick(keys({ forward: true, sneak: true }))
    assert.equal(p.pos.y, 65)
    assert.equal(p.onGround, true)
    assert.ok(p.pos.z < 1.3 + 1e-6, `z ${p.pos.z}`)
    assert.ok(p.pos.z > 1.2, `z ${p.pos.z}`)
  })
}

test('ice keeps momentum longer than stone', () => {
  const slide = (block) => {
    const { p } = makePlayer('1.20.4', (w) => w.fill(-5, 64, -5, 5, 64, 60, block))
    spawn(p, 0.5, 65, 0.5)
    p.tick(keys())
    for (let i = 0; i < 20; i++) p.tick(keys({ forward: true }))
    const z0 = p.pos.z
    for (let i = 0; i < 40; i++) p.tick(keys())
    return p.pos.z - z0
  }
  assert.ok(slide('ice') > slide('stone') * 3)
})

test('cobweb slows falling to a crawl', () => {
  const { p } = makePlayer('1.20.4', (w) => w.fill(-1, 60, -1, 1, 70, 1, 'cobweb'))
  spawn(p, 0.5, 70, 0.5)
  for (let i = 0; i < 20; i++) p.tick(keys())
  assert.ok(p.pos.y > 69, `y ${p.pos.y}`)
})
