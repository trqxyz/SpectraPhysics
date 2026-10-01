'use strict'
// Fixes for packet layouts minecraft-data gets wrong. They are merged into the client's custom packets
// before the play state starts, so the parser is built with them.

const { PV } = require('../engine/version')

// recipe and advancement packets whose layout in minecraft-data does not match the game; mineflayer reads neither
function brokenPackets (pv) {
  if (pv >= PV['1.20.5'] && pv < PV['1.21.2']) return ['declare_recipes']
  if (pv === PV['1.21.2']) return ['declare_recipes', 'recipe_book_add', 'advancements']
  return []
}

// minecraft-protocol merges custom packets field by field, so every original field has to be overridden:
// the first one takes the whole payload, the others read nothing
function rawLayout (original) {
  const fields = Array.isArray(original?.[1]) ? original[1] : [{}]
  return ['container', fields.map((field, i) => i === 0
    ? { name: 'data', type: 'restBuffer' }
    : { name: field.name ?? `unused${i}`, type: 'void' })]
}

function installProtocolPatches (ctx) {
  const { client, registry } = ctx
  const names = brokenPackets(registry.version.version)
  if (!names.length) return
  const types = registry.protocol?.play?.toClient?.types ?? {}
  const patch = {}
  for (const name of names) patch[`packet_${name}`] = rawLayout(types[`packet_${name}`])

  const major = registry.version.majorVersion
  const custom = client.customPackets ?? {}
  const own = custom[major] ?? {}
  const userTypes = own.play?.toClient?.types ?? {}
  custom[major] = {
    ...own,
    play: { ...own.play, toClient: { ...own.play?.toClient, types: { ...patch, ...userTypes } } }
  }
  client.customPackets = custom
}

module.exports = { installProtocolPatches }
