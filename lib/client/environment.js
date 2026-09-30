'use strict'
// What the movement engine needs to know about the player besides the world.

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

const isSprintModifier = (m) => m.uuid === SPRINT_UUID || m.id === 'minecraft:sprinting' || m.id === 'sprinting'
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

  function findAttribute (name) {
    const attributes = bot.entity?.attributes
    if (!attributes) return null
    for (const key of Object.keys(attributes)) if (normalizeKey(key) === name) return attributes[key]
    return null
  }

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
