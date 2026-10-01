'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const { makePlayer, keys } = require('./helpers')
const { forEachBetweenCorners } = require('../lib/engine/player/traversal')
const { effectIdMapper, entityCategory } = require('../lib/client/registries')
const { installItemUse } = require('../lib/client/items')
const { versionFlags } = require('..')

test('leather boots hold the player on top of powder snow, sneaking sinks', () => {
  const run = (boots, sneak) => {
    const { p } = makePlayer('1.20.4', (w) => {
      w.fill(-3, 60, -3, 3, 60, 3, 'stone')
      w.fill(-3, 61, -3, 3, 64, 3, 'powder_snow')
    })
    p.env.bootsItem = () => boots ? 'leather_boots' : null
    p.pos = { x: 0.5, y: 65, z: 0.5 }
    for (let i = 0; i < 10; i++) p.tick(keys({ sneak }))
    return p.pos.y
  }
  assert.equal(run(true, false), 65)
  assert.ok(run(false, false) < 65)
  assert.ok(run(true, true) < 65)
})

test('blocks between corners are walked away from the movement direction', () => {
  const order = []
  forEachBetweenCorners(0, 0, 0, 1, 1, 0, { x: -1, y: -0.5, z: 0 }, (x, y, z) => { order.push(`${x},${y}`) })
  assert.deepEqual(order, ['1,1', '0,1', '1,0', '0,0'])
})

test('effect ids follow the game registry, 1-based before 1.20.2', () => {
  const old = effectIdMapper(require('prismarine-registry')('1.16.5'))
  const now = effectIdMapper(require('prismarine-registry')('1.21.4'))
  assert.equal(old('dolphins_grace'), 30)
  assert.equal(now('dolphins_grace'), 29)
  assert.equal(now('speed'), 0)
})

test('only living entities, boats and minecarts push', () => {
  assert.equal(entityCategory({ name: 'arrow', type: 'mob' }), 'projectile')
  assert.equal(entityCategory({ name: 'item', type: 'mob' }), 'other')
  assert.equal(entityCategory({ name: 'zombie', type: 'mob' }), 'hostile')
})

function itemBot (version, held, offhand) {
  const registry = require('prismarine-registry')(version)
  const client = new EventEmitter()
  const slots = []
  slots[36] = held ? { name: held } : null
  slots[45] = offhand ? { name: offhand } : null
  const bot = Object.assign(new EventEmitter(), {
    registry,
    _client: client,
    entity: { id: 5 },
    food: 20,
    game: { gameMode: 'survival' },
    inventory: { slots },
    get heldItem () { return slots[36] }
  })
  const ctx = { bot, client, V: versionFlags(registry), state: {}, outgoing: [] }
  installItemUse(ctx)
  const send = (name, params) => ctx.outgoing.forEach(w => w(name, params))
  return { ctx, bot, client, send }
}

test('only usable items start item use; finishing or releasing stops it', () => {
  const block = itemBot('1.21.4', 'stone')
  block.send('use_item', { hand: 0 })
  assert.equal(block.ctx.state.using, null)

  const fullBread = itemBot('1.21.4', 'bread')
  fullBread.send('use_item', { hand: 0 })
  assert.equal(fullBread.ctx.state.using, null)

  const apple = itemBot('1.21.4', 'golden_apple')
  apple.send('use_item', { hand: 0 })
  assert.deepEqual(apple.ctx.state.using, { hand: 0, name: 'golden_apple' })
  apple.client.emit('entity_status', { entityId: 99, entityStatus: 9 })
  assert.ok(apple.ctx.state.using, 'another entity finishing does not stop us')
  apple.client.emit('entity_status', { entityId: 5, entityStatus: 9 })
  assert.equal(apple.ctx.state.using, null)

  const shield = itemBot('1.21.4', 'stone_sword', 'shield')
  shield.send('use_item', { hand: 1 })
  assert.equal(shield.ctx.state.using?.hand, 1)
  shield.send('block_dig', { status: 5 })
  assert.equal(shield.ctx.state.using, null)
})

test('item use slows walking to a fifth', () => {
  const walk = (using) => {
    const { p } = makePlayer('1.20.4', (w) => w.fill(-5, 63, -5, 5, 63, 40, 'stone'))
    p.env.usingItem = () => using
    p.pos = { x: 0.5, y: 64, z: 0.5 }
    for (let i = 0; i < 20; i++) p.tick(keys({ forward: true }))
    return p.pos.z
  }
  const slow = walk(true) - 0.5
  const normal = walk(false) - 0.5
  assert.ok(slow > 0 && slow < normal * 0.3, `${slow} vs ${normal}`)
})
