'use strict'
// What the movement engine needs to know about the player besides the world.

const { PV } = require('../engine/version')
const SPRINT_UUID = '662a6b8d-da3e-4c1c-8813-96ea6097278d'
const OPERATIONS = { add_value: 0, add_multiplied_base: 1, add_multiplied_total: 2 }
const PUSH_RANGE = 4
const PUSHABLE_OBJECTS = /boat|raft|minecart/
const LIVING_TYPES = new Set(['player', 'mob', 'animal', 'hostile', 'passive', 'water_creature', 'ambient'])
const BOOTS_SLOT = 8

const normalizeKey = (key) => String(key)
  .replace(/^minecraft:/, '')
  .replace(/^(generic|player)\./, '')
  .replace(/([a-z])([A-Z])/g, '$1_$2')
  .toLowerCase()

// attribute registry order from 1.21 on; the protocol tables in minecraft-data stop at the 1.20.5 list
function attributeRegistry (pv) {
  if (pv < PV['1.21']) return null
  return [
    'armor', 'armor_toughness', 'attack_damage', 'attack_knockback', 'attack_speed', 'block_break_speed',
    'block_interaction_range', 'burning_time', ...(pv >= PV['1.21.6'] ? ['camera_distance'] : []),
    'explosion_knockback_resistance', 'entity_interaction_range', 'fall_damage_multiplier', 'flying_speed',
    'follow_range', 'gravity', 'jump_strength', 'knockback_resistance', 'luck', 'max_absorption', 'max_health',
    'mining_efficiency', 'movement_efficiency', 'movement_speed', 'oxygen_bonus', 'safe_fall_distance', 'scale',
    'sneaking_speed', 'spawn_reinforcements', 'step_height', 'submerged_mining_speed', 'sweeping_damage_ratio',
    ...(pv >= PV['1.21.2'] ? ['tempt_range'] : []), 'water_movement_efficiency',
    ...(pv >= PV['1.21.6'] ? ['waypoint_receive_range', 'waypoint_transmit_range'] : [])
  ]
}

// mineflayer names attributes through the outdated table; map those names back to ids and then to the real names
function attributeKeyMapper (registry) {
  const names = attributeRegistry(registry.version.version)
  const type = registry.protocol?.play?.toClient?.types?.packet_entity_update_attributes
  const table = type && JSON.stringify(type).match(/"mappings":(\{[^}]*\})/)
  if (!names || !table) return normalizeKey
  const ids = {}
  for (const [id, name] of Object.entries(JSON.parse(table[1]))) ids[name] = Number(id)
  return (key) => ids[key] != null && names[ids[key]] ? names[ids[key]] : normalizeKey(key)
}

const SPRINT_IDS = new Set([SPRINT_UUID, 'minecraft:sprinting', 'sprinting'])
const isSprintModifier = (m) => SPRINT_IDS.has(m.uuid) || SPRINT_IDS.has(m.id)
const operationOf = (m) => typeof m.operation === 'number' ? m.operation : (OPERATIONS[m.operation] ?? 0)

// AttributeInstance#calculateValue, with the sprint modifier owned by the client
function attributeValue (property, extra = []) {
  const modifiers = property.modifiers.filter(m => !isSprintModifier(m)).concat(extra)
  let base = property.value
  for (const m of modifiers) if (operationOf(m) === 0) base += m.amount
  let value = base
  for (const m of modifiers) if (operationOf(m) === 1) value += base * m.amount
  for (const m of modifiers) if (operationOf(m) === 2) value *= 1 + m.amount
  return value
}

function createEnvironment (bot) {
  const effectIds = {}
  for (const [name, effect] of Object.entries(bot.registry.effectsByName ?? {})) effectIds[name.toLowerCase()] = effect.id
  const attributeName = attributeKeyMapper(bot.registry)

  // kept from the packets directly: mineflayer files 1.16 - 1.20.4 attributes under "undefined"
  let attributes = {}
  const onAttributes = (packet) => {
    if (packet.entityId !== bot.entity?.id) return
    for (const p of packet.properties) attributes[attributeName(p.key ?? p.name)] = { value: p.value, modifiers: p.modifiers ?? [] }
  }
  bot._client.on('entity_update_attributes', onAttributes)
  bot._client.on('update_attributes', onAttributes)
  bot._client.on('login', () => { attributes = {} })

  const findAttribute = (name) => attributes[name] ?? null

  function boots () {
    return bot.inventory?.slots?.[BOOTS_SLOT] ?? null
  }

  function isPushable (e) {
    if (!e || e === bot.entity || !e.position || e.isValid === false) return false
    if (e === bot.vehicle || e.vehicle === bot.entity) return false
    return LIVING_TYPES.has(e.type) || PUSHABLE_OBJECTS.test(e.name ?? '')
  }

  return {
    attribute (name, fallback) {
      const property = findAttribute(name)
      return property ? attributeValue(property) : fallback
    },
    movementSpeed (sprinting) {
      const property = findAttribute('movement_speed') ?? { value: 0.1, modifiers: [] }
      return attributeValue(property, sprinting ? [{ amount: 0.3, operation: 2 }] : [])
    },
    effect (name) {
      const id = effectIds[name.replace(/_/g, '')]
      if (id == null) return null
      const effect = bot.entity?.effects?.[id]
      return effect ? effect.amplifier : null
    },
    bootsEnchant (name) {
      const enchants = boots()?.enchants ?? []
      return enchants.find(e => e.name === name)?.lvl ?? 0
    },
    bootsItem: () => boots()?.name ?? null,
    food: () => bot.food ?? 20,
    usingItem: () => !!bot.usingHeldItem,
    gameMode: () => bot.game?.gameMode,
    ultraWarm: () => /nether/.test(String(bot.game?.dimension ?? '')),
    nearbyEntities () {
      const me = bot.entity?.position
      if (!me) return []
      const out = []
      for (const e of Object.values(bot.entities)) {
        if (!isPushable(e)) continue
        const p = e.position
        if (Math.abs(p.x - me.x) > PUSH_RANGE || Math.abs(p.y - me.y) > PUSH_RANGE || Math.abs(p.z - me.z) > PUSH_RANGE) continue
        out.push({ x: p.x, y: p.y, z: p.z, width: e.width ?? 0.6, height: e.height ?? 1.8 })
      }
      return out
    }
  }
}

module.exports = { createEnvironment }
