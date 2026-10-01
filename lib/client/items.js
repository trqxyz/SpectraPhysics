'use strict'
// LocalPlayer#startedUsingItem: whether a held item is being used, which slows movement to a fifth.
// mineflayer's usingHeldItem is set for any item and cleared by any entity's status packet, so the state is
// rebuilt here from what the client sends and from the server's own view of the player.

const ALWAYS_EDIBLE = new Set(['golden_apple', 'enchanted_golden_apple', 'chorus_fruit', 'honey_bottle', 'suspicious_stew'])
const DRINKS = new Set(['potion', 'milk_bucket', 'ominous_bottle'])
const HELD_USE = new Set(['shield', 'trident', 'spyglass', 'goat_horn'])
const ARROWS = new Set(['arrow', 'spectral_arrow', 'tipped_arrow'])
const OFFHAND_SLOT = 45
const FINISHED_USING = 9

function isCharged (item) {
  const projectiles = item.components?.find?.(c => c.type === 'charged_projectiles')
  if (projectiles) return (projectiles.data?.projectiles ?? projectiles.data ?? []).length > 0
  return item.nbt?.value?.Charged?.value === 1
}

function installItemUse (ctx) {
  const { bot, client, V, state } = ctx
  const flagsIndex = V.protocol >= 755 ? 8 : 7
  const cooldowns = new Map()
  state.using = null

  const itemIn = (hand) => hand === 1 ? bot.inventory.slots[OFFHAND_SLOT] : bot.heldItem
  const creative = () => bot.game?.gameMode === 'creative'
  const hasAmmo = () => creative() || bot.inventory.slots.some(i => i && ARROWS.has(i.name))

  // Item#use returning CONSUME / startUsingItem for the items that have a use animation
  function canStartUsing (item) {
    if (!item || (cooldowns.get(item.name) ?? 0) > Date.now()) return false
    const name = item.name
    if (DRINKS.has(name) || HELD_USE.has(name)) return true
    if (name === 'bow') return hasAmmo()
    if (name === 'crossbow') return !isCharged(item) && (hasAmmo() || bot.inventory.slots[OFFHAND_SLOT]?.name === 'firework_rocket')
    if (bot.registry.foodsByName?.[name]) return ALWAYS_EDIBLE.has(name) || creative() || (bot.food ?? 20) < 20
    return false
  }

  const start = (hand) => {
    const item = itemIn(hand)
    state.using = item ? { hand, name: item.name } : null
  }
  const stop = () => { state.using = null }

  ctx.outgoing.push((name, params) => {
    if (name === 'use_item') {
      const hand = params.hand ?? 0
      if (canStartUsing(itemIn(hand))) start(hand)
    } else if (name === 'block_place' && params.direction === -1) {
      if (canStartUsing(bot.heldItem)) start(0)
    } else if (name === 'block_dig' && params.status === 5) {
      stop()
    }
  })

  client.on('entity_status', (packet) => {
    if (packet.entityId === bot.entity?.id && packet.entityStatus === FINISHED_USING) stop()
  })

  // the server's living entity flags override the client state (LocalPlayer#onSyncedDataUpdated)
  client.on('entity_metadata', (packet) => {
    if (packet.entityId !== bot.entity?.id) return
    const entry = packet.metadata?.find(m => m.key === flagsIndex)
    if (!entry || typeof entry.value !== 'number') return
    const active = (entry.value & 1) !== 0
    if (active && !state.using) start((entry.value & 2) !== 0 ? 1 : 0)
    else if (!active && state.using) stop()
  })

  client.on('set_cooldown', (packet) => {
    const key = packet.cooldownGroup ?? bot.registry.items[packet.itemID]?.name
    if (key) cooldowns.set(String(key).replace(/^minecraft:/, ''), Date.now() + (packet.cooldownTicks ?? 0) * 50)
  })

  client.on('respawn', stop)
  bot.on('death', stop)

  // LivingEntity#updatingUsingItem: switching or losing the item stops the use
  ctx.updateItemUse = () => {
    if (state.using && itemIn(state.using.hand)?.name !== state.using.name) stop()
  }
}

module.exports = { installItemUse }
