'use strict'
// Ids the server uses for attributes, effects and enchantments. minecraft-data is outdated or wrong for
// several of them, so the tables here follow the game registries instead.

const { PV } = require('../engine/version')

const normalizeKey = (key) => String(key)
  .replace(/^minecraft:/, '')
  .replace(/^(generic|player|zombie)\./, '')
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

// MobEffects registration order (stable for the effects movement cares about); 1-based before 1.20.2
const EFFECTS = [
  'speed', 'slowness', 'haste', 'mining_fatigue', 'strength', 'instant_health', 'instant_damage', 'jump_boost',
  'nausea', 'regeneration', 'resistance', 'fire_resistance', 'water_breathing', 'invisibility', 'blindness',
  'night_vision', 'hunger', 'weakness', 'poison', 'wither', 'health_boost', 'absorption', 'saturation', 'glowing',
  'levitation', 'luck', 'unluck', 'slow_falling', 'conduit_power', 'dolphins_grace', 'bad_omen',
  'hero_of_the_village', 'darkness'
]

function effectIdMapper (registry) {
  const zeroBased = registry.version.version >= PV['1.20.2']
  return (name) => {
    const index = EFFECTS.indexOf(name)
    return index < 0 ? null : index + (zeroBased ? 0 : 1)
  }
}

// enchantments: item NBT names before 1.20.5, built-in ids in 1.20.5 - 1.20.6, the server's registry from 1.21
function createEnchantmentReader (bot) {
  const registry = bot.registry
  let synced = null
  bot._client.on('registry_data', (packet) => {
    if (!/enchantment$/.test(String(packet.id ?? ''))) return
    synced = (packet.entries ?? []).map(e => normalizeKey(e.key ?? e.id ?? ''))
  })
  const nameOf = (id) => synced?.[id] ?? registry.enchantments?.[id]?.name ?? null

  return (item, name) => {
    if (!item) return 0
    const component = item.components?.find?.(c => c.type === 'enchantments')
    if (component) {
      const list = component.data?.enchantments ?? []
      return list.find(e => nameOf(e.id) === name)?.level ?? 0
    }
    let legacy
    try { legacy = item.enchants } catch { legacy = null }
    return Array.isArray(legacy) ? (legacy.find(e => normalizeKey(e.name) === name)?.lvl ?? 0) : 0
  }
}

// entity categories; the 1.16 tables mark every entity as a mob, so a later table is used by name
let entityTable = null
function entityCategory (entity) {
  entityTable ??= require('minecraft-data')('1.20.4').entitiesByName
  return entityTable[entity.name]?.type ?? entity.type
}

module.exports = { normalizeKey, attributeKeyMapper, effectIdMapper, createEnchantmentReader, entityCategory }
