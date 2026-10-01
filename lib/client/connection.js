'use strict'
// Outgoing packets. Also reorders what mineflayer sends on login so it matches the game client:
// brand + client information in the configuration phase (1.20.2+), settings before brand on older versions,
// and player_loaded only when the level has actually loaded.

// actions the game sends from Minecraft#handleKeybinds, before the movement packet of the same tick
const TICK_ACTIONS = new Set(['use_item', 'block_dig', 'block_place', 'use_entity', 'attack', 'arm_animation', 'entity_action', 'spectate'])

const isBrand = (channel) => channel === 'minecraft:brand' || channel === 'MC|Brand'

function brandPayload (brand) {
  const text = Buffer.from(brand, 'utf8')
  const length = []
  let n = text.length
  do {
    let byte = n & 0x7f
    n >>>= 7
    if (n) byte |= 0x80
    length.push(byte)
  } while (n)
  return { channel: 'minecraft:brand', data: Buffer.concat([Buffer.from(length), text]) }
}

function installConnection (ctx) {
  const { client, V, state } = ctx
  const rawWrite = client.write.bind(client)
  const brand = ctx.options.brand ?? client.options?.brand ?? 'vanilla'
  let ours = false

  const report = (name, params) => {
    for (const watch of ctx.outgoing) watch(name, params)
    if (ctx.onSend) ctx.onSend(name, params)
    if (ctx.debug) ctx.debug('C->S', name, JSON.stringify(params))
  }

  ctx.send = (name, params) => {
    report(name, params)
    ours = true
    try { rawWrite(name, params) } finally { ours = false }
  }

  const queued = []

  client.write = function (name, params) {
    if (!ours && TICK_ACTIONS.has(name) && client.state === 'play' && state.inLevel) {
      queued.push([name, params])
      return
    }
    if (!ours) {
      if (name === 'player_loaded' && V.clientLoaded) return
      if (name === 'custom_payload' && isBrand(params?.channel) && client.state === 'play') {
        if (V.configPhase && state.configBrandSent) return
        if (!V.configPhase && !state.playSettingsSent) {
          state.heldBrand = params
          return
        }
      }
      if (name === 'settings') {
        if (client.state === 'configuration' && V.configPhase && !state.configBrandSent) {
          ctx.send('custom_payload', brandPayload(brand))
          state.configBrandSent = true
        } else if (client.state === 'play') {
          if (state.suppressPlaySettings) {
            state.suppressPlaySettings = false
            return
          }
          report(name, params)
          rawWrite(name, params)
          state.playSettingsSent = true
          if (state.heldBrand) {
            const held = state.heldBrand
            state.heldBrand = null
            rawWrite('custom_payload', held)
          }
          return
        }
      }
      report(name, params)
    }
    return rawWrite(name, params)
  }

  client.on('finish_configuration', () => { state.suppressPlaySettings = true })

  // use_item carries the rotation of the tick it is sent in (checked by servers since 1.21)
  ctx.flushActions = () => {
    while (queued.length) {
      const [name, params] = queued.shift()
      if (name === 'use_item' && params.rotation) params.rotation = { x: ctx.player.yRot, y: ctx.player.xRot }
      report(name, params)
      rawWrite(name, params)
    }
  }

  ctx.flushHeldBrand = () => {
    if (!state.heldBrand) return
    const held = state.heldBrand
    state.heldBrand = null
    ctx.send('custom_payload', held)
  }
}

module.exports = { installConnection }
