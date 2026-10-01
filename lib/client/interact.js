'use strict'
// Right click on an entity the way Minecraft#startUseItem does it: aim, interact_at with the hit point,
// then interact (a single packet with the location from 26.1), and leaving a vehicle by holding sneak.

const { Vec3 } = require('vec3')

const DISMOUNT_TICKS = 3

// where the look ray enters the entity's box, relative to the entity position
function hitPoint (eye, look, entity) {
  const w = (entity.width ?? 0.6) / 2
  const h = entity.height ?? 1.8
  const p = entity.position
  const min = [p.x - w, p.y, p.z - w]
  const max = [p.x + w, p.y + h, p.z + w]
  const origin = [eye.x, eye.y, eye.z]
  const dir = [look.x, look.y, look.z]
  let near = -Infinity
  let far = Infinity
  for (let i = 0; i < 3; i++) {
    if (Math.abs(dir[i]) < 1e-9) {
      if (origin[i] < min[i] || origin[i] > max[i]) return new Vec3(0, h / 2, 0)
      continue
    }
    let t1 = (min[i] - origin[i]) / dir[i]
    let t2 = (max[i] - origin[i]) / dir[i]
    if (t1 > t2) [t1, t2] = [t2, t1]
    near = Math.max(near, t1)
    far = Math.min(far, t2)
  }
  if (near > far || far < 0) return new Vec3(0, h / 2, 0)
  const t = Math.max(near, 0)
  return new Vec3(eye.x + dir[0] * t - p.x, eye.y + dir[1] * t - p.y, eye.z + dir[2] * t - p.z)
}

function installInteract (ctx) {
  const { bot, client, registry, player, state } = ctx
  const useEntityType = JSON.stringify(registry.protocol?.play?.toServer?.types?.packet_use_entity ?? '')
  const singleInteract = !useEntityType.includes('"mouse"')
  state.dismountTicks = 0

  function lookVector () {
    const yaw = player.yRot * Math.PI / 180
    const pitch = player.xRot * Math.PI / 180
    return { x: -Math.sin(yaw) * Math.cos(pitch), y: -Math.sin(pitch), z: Math.cos(yaw) * Math.cos(pitch) }
  }

  async function rightClick (entity, swing) {
    if (!entity?.position) throw new Error('entity is gone')
    await bot.lookAt(entity.position.offset(0, (entity.height ?? 1) / 2, 0))
    const eye = { x: player.pos.x, y: player.pos.y + player.eyeHeight(), z: player.pos.z }
    const hit = hitPoint(eye, lookVector(), entity)
    const sneaking = !!ctx.keys().sneak
    if (singleInteract) {
      client.write('use_entity', { target: entity.id, hand: 'main_hand', location: { x: hit.x, y: hit.y, z: hit.z }, sneaking })
    } else {
      client.write('use_entity', { target: entity.id, mouse: 2, x: hit.x, y: hit.y, z: hit.z, hand: 0, sneaking })
      client.write('use_entity', { target: entity.id, mouse: 0, hand: 0, sneaking })
    }
    if (swing) client.write('arm_animation', { hand: 0 })
  }

  bot.useOn = (entity) => rightClick(entity, false)
  bot.mount = (entity) => rightClick(entity, true)

  bot.dismount = () => {
    if (!bot.vehicle) {
      bot.emit('error', new Error('dismount: not mounted'))
      return
    }
    state.dismountTicks = DISMOUNT_TICKS
  }

  const readKeys = ctx.keys
  ctx.keys = () => state.dismountTicks > 0 ? { ...readKeys(), sneak: true } : readKeys()
  bot.on('physicsTick', () => { if (state.dismountTicks > 0) state.dismountTicks-- })
}

module.exports = { installInteract, hitPoint }
