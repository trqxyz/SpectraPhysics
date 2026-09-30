'use strict'
// SpectraPhysics: drop-in replacement for mineflayer's `physics` plugin that behaves like the vanilla client.
//  * ticks like Minecraft#tick (held item sync -> entity tick -> movement packets -> tick end)
//  * LocalPlayer#sendPosition semantics (stale last-sent values after teleports, 20-tick reminder, 2e-4 threshold)
//  * version specific teleport answers, client-loaded gating (1.21.4+), tick_end (1.21.2+)
//  * boat / minecart passenger ticking (paddle, rotation, input and vehicle move packets)
//  * vanilla echoes: held-slot confirmation, arm swing from animation packets, configuration-phase brand

const { Vec3 } = require('vec3')
const { performance } = require('perf_hooks')
const conv = require('mineflayer/lib/conversions')
const { versionFlags } = require('./engine/version')
const WorldView = require('./engine/world')
const { PlayerPhysics } = require('./engine/physics')
const BoatPhysics = require('./engine/boat')
const { f32, wrapDegrees, clamp } = require('./engine/mth')

const TICK_MS = 50
const F_015 = f32(0.15)
const SPRINT_UUID = '662a6b8d-da3e-4c1c-8813-96ea6097278d'
const OP = { add_value: 0, add_multiplied_base: 1, add_multiplied_total: 2 }

function spectraPhysics (opts = {}) {
  const turnPerTick = opts.turnSpeed ?? 35 // max degrees of "mouse" rotation per tick
  const debug = typeof opts.debug === 'function' ? opts.debug : (opts.debug ? (...a) => console.log('[spectra]', ...a) : null)
  const logPacket = debug ? (name, params) => debug('C->S', name, JSON.stringify(params)) : null

  return function inject (bot) {
    const client = bot._client
    const registry = bot.registry
    const V = versionFlags(registry)
    const world = new WorldView(bot)

    // ---------------- attribute / effect helpers ----------------
    const normKey = (k) => String(k).replace(/^minecraft:/, '').replace(/^(generic|player)\./, '')
      .replace(/([a-z])([A-Z])/g, '$1_$2').toLowerCase()
    function findAttr (name) {
      const attrs = bot.entity?.attributes
      if (!attrs) return null
      for (const k of Object.keys(attrs)) if (normKey(k) === name) return attrs[k]
      return null
    }
    const isSprintMod = (m) => m.uuid === SPRINT_UUID || m.id === 'minecraft:sprinting' || m.id === 'sprinting'
    function attrValue (prop, extraMods = []) {
      const mods = prop.modifiers.filter(m => !isSprintMod(m)).concat(extraMods)
      const op = (m) => typeof m.operation === 'number' ? m.operation : (OP[m.operation] ?? 0)
      let x = prop.value
      for (const m of mods) if (op(m) === 0) x += m.amount
      let y = x
      for (const m of mods) if (op(m) === 1) y += x * m.amount
      for (const m of mods) if (op(m) === 2) y *= 1 + m.amount
      return y
    }
    const effectIds = {}
    for (const [name, e] of Object.entries(registry.effectsByName ?? {})) effectIds[name.toLowerCase()] = e.id
    const env = {
      attribute (name, def) {
        const a = findAttr(name)
        return a ? attrValue(a) : def
      },
      movementSpeed (sprinting) {
        const a = findAttr('movement_speed')
        const base = a ?? { value: 0.1, modifiers: [] }
        return attrValue(base, sprinting ? [{ amount: 0.3, operation: 2 }] : [])
      },
      effect (name) {
        const id = effectIds[name.replace(/_/g, '')]
        if (id == null) return null
        const e = bot.entity?.effects?.[id]
        return e ? e.amplifier : null
      },
      food: () => bot.food ?? 20,
      usingItem: () => !!bot.usingHeldItem,
      gameMode: () => bot.game?.gameMode,
      ultraWarm: () => /nether/.test(String(bot.game?.dimension ?? ''))
    }
    const phys = new PlayerPhysics(world, V, env)

    // ---------------- raw writing / vanilla ordering fixes ----------------
    const rawWrite = client.write.bind(client)
    let internal = false
    function send (name, params) {
      if (logPacket) logPacket(name, params)
      internal = true
      try { rawWrite(name, params) } finally { internal = false }
    }
    const isBrand = (ch) => ch === 'minecraft:brand' || ch === 'MC|Brand'
    const brandName = opts.brand ?? bot._client.options?.brand ?? 'vanilla'
    function brandPayload () {
      const s = Buffer.from(brandName, 'utf8')
      const len = []
      let n = s.length
      do { let b = n & 0x7f; n >>>= 7; if (n) b |= 0x80; len.push(b) } while (n)
      return { channel: 'minecraft:brand', data: Buffer.concat([Buffer.from(len), s]) }
    }

    const S = {
      inLevel: false,
      positionReceived: false,
      clientLoaded: false,
      loadedReadyTicks: 0,
      loadTimeout: 60,
      last: { x: 0, y: 0, z: 0, yRot: 0, xRot: 0, onGround: false, hc: false },
      positionReminder: 0,
      wasSprinting: false,
      wasShift: false,
      lastInput: { forward: false, backward: false, left: false, right: false, jump: false, shift: false, sprint: false },
      selected: 0,
      carriedIndex: 0,
      boat: null,
      configBrandSent: false,
      suppressPlaySettings: false,
      playSettingsSent: false,
      heldBrand: null
    }

    client.write = function (name, params) {
      if (!internal) {
        if (name === 'player_loaded' && V.clientLoaded) return // sent by us when the level screen would close
        if (name === 'custom_payload' && isBrand(params?.channel) && client.state === 'play') {
          if (V.configPhase && S.configBrandSent) return // 1.20.2+: brand only once, during configuration
          if (!V.configPhase && !S.playSettingsSent) { S.heldBrand = params; return } // vanilla: settings, then brand
        }
        if (name === 'settings') {
          if (client.state === 'configuration' && V.configPhase && !S.configBrandSent) {
            send('custom_payload', brandPayload()) // LoginAcknowledged -> brand -> client information
            S.configBrandSent = true
          } else if (client.state === 'play') {
            if (S.suppressPlaySettings) { S.suppressPlaySettings = false; return }
            if (logPacket) logPacket(name, params)
            rawWrite(name, params)
            S.playSettingsSent = true
            if (S.heldBrand) { const b = S.heldBrand; S.heldBrand = null; rawWrite('custom_payload', b) }
            return
          }
        }
      }
      if (logPacket && !internal) logPacket(name, params)
      return rawWrite(name, params)
    }
    client.on('finish_configuration', () => { S.suppressPlaySettings = true })

    // ---------------- controls / API ----------------
    const controlState = { forward: false, back: false, left: false, right: false, jump: false, sprint: false, sneak: false }
    bot.physicsEnabled = true
    bot.physics = { gravity: 0.08, yawSpeed: 3, pitchSpeed: 3, stepHeight: 0.6, engine: 'spectra' }
    bot.spectra = { flags: V, player: phys, state: S, world }

    bot.setControlState = (control, state) => {
      if (!(control in controlState)) throw new Error(`invalid control: ${control}`)
      controlState[control] = !!state
    }
    bot.getControlState = (control) => controlState[control]
    bot.clearControlStates = () => { for (const k in controlState) controlState[k] = false }
    bot.controlState = {}
    for (const k of Object.keys(controlState)) {
      Object.defineProperty(bot.controlState, k, { get: () => controlState[k], set: (v) => { controlState[k] = !!v } })
    }

    // rotation targets (degrees, vanilla convention) derived from bot.entity.yaw/pitch
    let lookWaiters = []
    function targetYaw () { return conv.toNotchianYaw(bot.entity.yaw) }
    function targetPitch () { return conv.toNotchianPitch(bot.entity.pitch) }
    bot.look = async (yaw, pitch, force) => {
      bot.entity.yaw = yaw
      bot.entity.pitch = pitch
      if (force) {
        applyTurn(Infinity)
        return
      }
      await new Promise(resolve => lookWaiters.push(resolve))
    }
    bot.lookAt = async (point, force) => {
      const delta = point.minus(bot.entity.position.offset(0, phys.eyeHeight(), 0))
      const yaw = Math.atan2(-delta.x, -delta.z)
      const pitch = Math.atan2(delta.y, Math.sqrt(delta.x * delta.x + delta.z * delta.z))
      await bot.look(yaw, pitch, force)
    }
    bot.waitForTicks = async (ticks) => {
      if (ticks <= 0) return
      await new Promise(resolve => {
        const l = () => { if (--ticks <= 0) { bot.removeListener('physicsTick', l); resolve() } }
        bot.on('physicsTick', l)
      })
    }
    bot.elytraFly = async () => { throw new Error('elytra flight is not simulated') }

    // vanilla mouse turning: whole "pixels" of 0.15 degrees, accumulated in float
    function applyTurn (maxDeg = turnPerTick, target) {
      const ty = target?.yaw ?? targetYaw()
      const tp = target?.pitch ?? targetPitch()
      const dy = wrapDegrees(ty - phys.yRot)
      const dp = tp - phys.xRot
      const lim = maxDeg / F_015
      const py = clamp(Math.round(dy / F_015), -lim, lim)
      const pp = clamp(Math.round(dp / F_015), -lim, lim)
      if (py !== 0) phys.yRot = f32(phys.yRot + f32(f32(py) * F_015))
      if (pp !== 0) phys.xRot = f32(clamp(f32(phys.xRot + f32(f32(pp) * F_015)), -90, 90))
      if (Math.abs(wrapDegrees(ty - phys.yRot)) < F_015 && Math.abs(tp - phys.xRot) < F_015 && lookWaiters.length) {
        const w = lookWaiters; lookWaiters = []
        for (const r of w) r()
      }
    }

    // ---------------- level lifecycle ----------------
    function resetForNewPlayer () {
      const abilities = phys.abilities
      phys.reset()
      phys.abilities = abilities
      S.positionReceived = false
      S.clientLoaded = false
      S.loadedReadyTicks = 0
      S.loadTimeout = 60
      S.last = { x: 0, y: 0, z: 0, yRot: 0, xRot: 0, onGround: false, hc: false }
      S.positionReminder = 0
      S.wasSprinting = false
      S.wasShift = false
      S.lastInput = { forward: false, backward: false, left: false, right: false, jump: false, shift: false, sprint: false }
      S.boat = null
    }
    client.on('login', () => {
      S.inLevel = true
      S.playSettingsSent = false
      S.selected = 0
      S.carriedIndex = 0
      resetForNewPlayer()
      startTicking()
    })
    client.on('respawn', () => { resetForNewPlayer() })
    client.on('start_configuration', () => { S.inLevel = false })

    // ---------------- server -> client handlers ----------------
    function relFlags (flags) {
      if (typeof flags === 'object' && flags !== null) {
        return { x: !!flags.x, y: !!flags.y, z: !!flags.z, yaw: !!flags.yaw, pitch: !!flags.pitch, dx: !!flags.dx, dy: !!flags.dy, dz: !!flags.dz, rotDelta: !!flags.yawDelta }
      }
      const n = flags | 0
      return { x: !!(n & 1), y: !!(n & 2), z: !!(n & 4), yaw: !!(n & 8), pitch: !!(n & 16) }
    }

    function sendTeleportPosRot () {
      send('position_look', {
        x: phys.pos.x, y: phys.pos.y, z: phys.pos.z, yaw: phys.yRot, pitch: phys.xRot,
        onGround: false, flags: { onGround: false, hasHorizontalCollision: false }
      })
    }

    client.on('position', (packet) => {
      const r = relFlags(packet.flags)
      const p = phys
      let nx, ny, nz, yaw, pitch
      let vx = p.vel.x; let vy = p.vel.y; let vz = p.vel.z
      if (!V.relativeTeleportVelocity) {
        if (r.x) { nx = p.pos.x + packet.x } else { nx = packet.x; vx = 0 }
        if (r.y) { ny = p.pos.y + packet.y } else { ny = packet.y; vy = 0 }
        if (r.z) { nz = p.pos.z + packet.z } else { nz = packet.z; vz = 0 }
        yaw = f32(packet.yaw); pitch = f32(packet.pitch)
        if (r.pitch) pitch = f32(pitch + p.xRot)
        if (r.yaw) yaw = f32(yaw + p.yRot)
        yaw = f32(yaw % 360)
        pitch = f32(clamp(pitch, -90, 90) % 360)
      } else {
        nx = (r.x ? p.pos.x : 0) + packet.x
        ny = (r.y ? p.pos.y : 0) + packet.y
        nz = (r.z ? p.pos.z : 0) + packet.z
        yaw = f32((r.yaw ? p.yRot : 0) + packet.yaw)
        pitch = f32(clamp(f32((r.pitch ? p.xRot : 0) + packet.pitch), -90, 90))
        if (r.rotDelta) {
          const ax = (p.xRot - pitch) * Math.PI / 180; const ay = (p.yRot - yaw) * Math.PI / 180
          const cy1 = Math.cos(ax); const sy1 = Math.sin(ax)
          let tx = vx; let ty = vy * cy1 + vz * sy1; let tz = vz * cy1 - vy * sy1
          const c2 = Math.cos(ay); const s2 = Math.sin(ay)
          const ux = tx * c2 + tz * s2; const uz = tz * c2 - tx * s2
          tx = ux; tz = uz
          vx = tx; vy = ty; vz = tz
        }
        vx = r.dx ? vx + (packet.dx ?? 0) : (packet.dx ?? 0)
        vy = r.dy ? vy + (packet.dy ?? 0) : (packet.dy ?? 0)
        vz = r.dz ? vz + (packet.dz ?? 0) : (packet.dz ?? 0)
      }
      if (!bot.vehicle) {
        p.pos.x = nx; p.pos.y = ny; p.pos.z = nz
        p.vel.x = vx; p.vel.y = vy; p.vel.z = vz
      }
      p.yRot = yaw
      p.xRot = pitch
      bot.entity.yaw = conv.fromNotchianYaw(yaw)
      bot.entity.pitch = conv.fromNotchianPitch(pitch)
      syncEntity()

      if (V.posRotBeforeConfirm) {
        sendTeleportPosRot()
        send('teleport_confirm', { teleportId: packet.teleportId })
      } else {
        if (bot.supportFeature('teleportUsesOwnPacket')) send('teleport_confirm', { teleportId: packet.teleportId })
        sendTeleportPosRot()
      }
      S.positionReceived = true
      bot.emit('forcedMove')
    })

    client.on('player_rotation', (packet) => {
      phys.yRot = f32(packet.yaw)
      phys.xRot = f32(clamp(packet.pitch, -90, 90))
      bot.entity.yaw = conv.fromNotchianYaw(phys.yRot)
      bot.entity.pitch = conv.fromNotchianPitch(phys.xRot)
    })

    client.on('abilities', (packet) => {
      const fl = packet.flags
      phys.abilities.invulnerable = !!(fl & 1)
      phys.abilities.flying = !!(fl & 2)
      phys.abilities.mayfly = !!(fl & 4)
      phys.abilities.instabuild = !!(fl & 8)
      phys.abilities.flyingSpeed = f32(packet.flyingSpeed)
      phys.abilities.walkingSpeed = f32(packet.walkingSpeed)
    })

    client.on('entity_velocity', (packet) => {
      if (!bot.entity || packet.entityId !== bot.entity.id) return
      const v = packet.velocity
      const k = V.lpVelocity ? 1 : 1 / 8000
      phys.vel.x = v.x * k; phys.vel.y = v.y * k; phys.vel.z = v.z * k
    })

    client.on('explosion', (packet) => {
      const kb = packet.playerKnockback ?? (('playerMotionX' in packet) ? { x: packet.playerMotionX, y: packet.playerMotionY, z: packet.playerMotionZ } : null)
      if (kb) { phys.vel.x += kb.x; phys.vel.y += kb.y; phys.vel.z += kb.z }
    })

    // Held item: vanilla only changes the selected slot for valid hotbar indices and confirms it on the next tick.
    client.removeAllListeners('held_item_slot')
    client.on('held_item_slot', (packet) => {
      const slot = packet.slot ?? packet.slotId
      if (slot >= 0 && slot <= 8) {
        S.selected = slot
        bot.quickBarSlot = slot
        try { bot.updateHeldItem?.() } catch (e) {}
      }
    })
    bot.setQuickBarSlot = (slot) => {
      if (!(slot >= 0 && slot < 9)) throw new Error('invalid hotbar slot ' + slot)
      S.selected = slot
      bot.quickBarSlot = slot
      try { bot.updateHeldItem?.() } catch (e) {}
    }

    // LocalPlayer#swing is triggered by ClientboundAnimatePacket for our own entity and echoes a swing packet
    client.on('animation', (packet) => {
      if (!bot.entity || packet.entityId !== bot.entity.id) return
      if (packet.animation === 0) send('arm_animation', { hand: 0 })
      else if (packet.animation === 3) send('arm_animation', { hand: 1 })
    })

    // Pre-1.17: a full chunk with an empty section bitmap is a *loaded* empty chunk for the vanilla client,
    // mineflayer drops it as an unload and the player would never tick inside it.
    const Chunk = require('prismarine-chunk')(registry)
    client.on('map_chunk', (packet) => {
      const empty = packet.bitMap === 0 || (Array.isArray(packet.bitMap) && packet.bitMap.every(n => !n || (Array.isArray(n) && n.every(m => !m))))
      if (!empty || !packet.groundUp) return
      if (bot.world.getColumn(packet.x, packet.z)) return
      const column = new Chunk({ minY: bot.game.minY, worldHeight: bot.game.height })
      try { if (packet.biomes !== undefined) column.loadBiomes(packet.biomes) } catch (e) {}
      bot.world.setColumn(packet.x, packet.z, column)
    })

    // mineflayer listens for 'entityGone' on the wrong emitter, so a removed vehicle is never left: do it here
    client.on('entity_destroy', (packet) => {
      const v = bot.vehicle
      if (!v || !packet.entityIds.includes(v.id)) return
      bot.vehicle = null
      if (bot.entity) bot.entity.vehicle = null
      S.boat = null
      bot.emit('dismount', v)
    })

    // server corrected our vehicle
    client.on('vehicle_move', (packet) => {
      if (!S.boat) return
      S.boat.pos.x = packet.x; S.boat.pos.y = packet.y; S.boat.pos.z = packet.z
      S.boat.yRot = f32(packet.yaw); S.boat.xRot = f32(packet.pitch)
      sendVehicleMove()
    })

    // ---------------- per tick ----------------
    function syncEntity () {
      if (!bot.entity) return
      bot.entity.position.set(phys.pos.x, phys.pos.y, phys.pos.z)
      bot.entity.velocity.set(phys.vel.x, phys.vel.y, phys.vel.z)
      bot.entity.onGround = phys.onGround
      bot.entity.isInWater = phys.isInWater()
      bot.entity.isInLava = phys.isInLava()
      bot.entity.height = phys.height()
      bot.entity.eyeHeight = phys.eyeHeight()
      bot.entity.isCollidedHorizontally = phys.horizontalCollision
      bot.entity.isCollidedVertically = phys.verticalCollision
    }

    const flagsOf = () => ({ onGround: phys.onGround, hasHorizontalCollision: phys.horizontalCollision })

    function sendIsSprintingIfNeeded () {
      if (phys.sprinting !== S.wasSprinting) {
        send('entity_action', { entityId: bot.entity.id, actionId: phys.sprinting ? 'start_sprinting' : 'stop_sprinting', jumpBoost: 0 })
        S.wasSprinting = phys.sprinting
      }
    }
    function sendShiftKeyState () {
      if (V.shiftInInput) return
      const sh = phys.input.shift
      if (sh !== S.wasShift) {
        send('entity_action', { entityId: bot.entity.id, actionId: sh ? 'start_sneaking' : 'stop_sneaking', jumpBoost: 0 })
        S.wasShift = sh
      }
    }
    function sendPlayerInputIfChanged () {
      const k = controlState
      const cur = { forward: k.forward, backward: k.back, left: k.left, right: k.right, jump: k.jump, shift: k.sneak, sprint: k.sprint }
      const l = S.lastInput
      if (Object.keys(cur).some(n => cur[n] !== l[n])) {
        send('player_input', { inputs: cur })
        S.lastInput = cur
      }
    }

    // LocalPlayer#sendPosition
    function sendPosition () {
      sendIsSprintingIfNeeded()
      if (!V.playerInputPacket) sendShiftKeyState()
      const p = phys
      const L = S.last
      const dx = p.pos.x - L.x; const dy = p.pos.y - L.y; const dz = p.pos.z - L.z
      const dr = p.yRot - L.yRot; const dp = p.xRot - L.xRot
      S.positionReminder++
      const moved = (dx * dx + dy * dy + dz * dz) > 4.0000000000000003e-8 || S.positionReminder >= 20
      const rotated = dr !== 0 || dp !== 0
      const base = { onGround: p.onGround, flags: flagsOf() }
      const old = new Vec3(L.x, L.y, L.z)
      if (moved && rotated) send('position_look', { x: p.pos.x, y: p.pos.y, z: p.pos.z, yaw: p.yRot, pitch: p.xRot, ...base })
      else if (moved) send('position', { x: p.pos.x, y: p.pos.y, z: p.pos.z, ...base })
      else if (rotated) send('look', { yaw: p.yRot, pitch: p.xRot, ...base })
      else if (L.onGround !== p.onGround || (V.movementFlags && L.hc !== p.horizontalCollision)) send('flying', base)
      if (moved) { L.x = p.pos.x; L.y = p.pos.y; L.z = p.pos.z; S.positionReminder = 0 }
      if (rotated) { L.yRot = p.yRot; L.xRot = p.xRot; S.lastRotationSentAt = Date.now() }
      L.onGround = p.onGround
      L.hc = p.horizontalCollision
      if (moved || rotated) bot.emit('move', old)
    }

    function sendVehicleMove () {
      const b = S.boat
      send('vehicle_move', { x: b.pos.x, y: b.pos.y, z: b.pos.z, yaw: b.yRot, pitch: b.xRot, onGround: b.onGround })
    }

    const isBoat = (e) => /boat|raft/.test(e?.name ?? '')
    function ridingOffset (vehicle) {
      if (isBoat(vehicle)) return f32(-0.1 + -0.35)
      if (/minecart/.test(vehicle?.name ?? '')) return f32(0 + -0.35)
      return (vehicle?.height ?? 1) * 0.75 - 0.35
    }

    function ridingTick (vehicle) {
      const controller = vehicle.passengers?.[0] === bot.entity
      if (isBoat(vehicle) && controller) {
        if (!S.boat || S.boat.entityId !== vehicle.id) {
          S.boat = new BoatPhysics(world, V, { position: vehicle.position, yawDegrees: f32(conv.toNotchianYaw(vehicle.yaw)) })
          S.boat.entityId = vehicle.id
        }
        const k = controlState
        S.boat.tick({ forward: k.forward, back: k.back, left: k.left, right: k.right })
        send('steer_boat', { leftPaddle: S.boat.paddle[0], rightPaddle: S.boat.paddle[1] })
        vehicle.position.set(S.boat.pos.x, S.boat.pos.y, S.boat.pos.z)
      } else {
        S.boat = null
      }
      // Entity#rideTick: velocity zeroed, then positionRider
      phys.vel.x = 0; phys.vel.y = 0; phys.vel.z = 0
      phys.computeInput(controlState, false)
      const xxa = f32(phys.input.left * f32(0.98))
      const zza = f32(phys.input.forward * f32(0.98))
      phys.pos.x = vehicle.position.x
      phys.pos.y = vehicle.position.y + ridingOffset(vehicle)
      phys.pos.z = vehicle.position.z
      applyTurn()
      if (isBoat(vehicle)) {
        // Boat#clampRotation
        const by = S.boat ? S.boat.yRot : f32(conv.toNotchianYaw(vehicle.yaw))
        const f = wrapDegrees(phys.yRot - by)
        const f1 = clamp(f, -105, 105)
        phys.yRot = f32(phys.yRot + f1 - f)
      }
      syncEntity()
      if (!V.playerInputPacket) {
        send('look', { yaw: phys.yRot, pitch: phys.xRot, onGround: phys.onGround })
        S.lastRotationSentAt = Date.now()
        send('steer_vehicle', { sideways: xxa, forward: zza, jump: (phys.input.jumping ? 1 : 0) | (phys.input.shift ? 2 : 0) })
        if (S.boat) sendVehicleMove()
      } else {
        if (!V.shiftInInput) sendShiftKeyState()
        sendPlayerInputIfChanged()
        send('look', { yaw: phys.yRot, pitch: phys.xRot, onGround: phys.onGround, flags: flagsOf() })
        S.lastRotationSentAt = Date.now()
        if (S.boat) { sendVehicleMove(); sendIsSprintingIfNeeded() }
      }
    }

    function playerTick () {
      if (!S.positionReceived) return
      if (!world.hasChunk(phys.pos.x, phys.pos.z)) return // LocalPlayer#tick needs its chunk
      if (V.clientLoaded && !S.clientLoaded) {
        const outside = phys.pos.y < world.minY || phys.pos.y >= world.maxY
        S.loadedReadyTicks = (outside || world.hasChunk(phys.pos.x, phys.pos.z)) ? S.loadedReadyTicks + 1 : 0
        if (S.loadedReadyTicks >= 2 || --S.loadTimeout <= 0) {
          S.clientLoaded = true
          send('player_loaded', {})
          bot.emit('clientLoaded')
        }
        return
      }
      if (bot.isAlive === false) return
      applyTurn()
      if (bot.physicsEnabled) {
        phys.tick(controlState)
        if (phys.events.abilitiesChanged) {
          phys.events.abilitiesChanged = false
          send('abilities', { flags: phys.abilities.flying ? 2 : 0 })
        }
      }
      syncEntity()
      if (V.playerInputPacket) {
        sendShiftKeyState()
        sendPlayerInputIfChanged()
      }
      sendPosition()
    }

    function clientTick () {
      if (client.state !== 'play' || !S.inLevel || !bot.entity) return
      // MultiPlayerGameMode#tick -> ensureHasSentCarriedItem
      if (S.selected !== S.carriedIndex) {
        S.carriedIndex = S.selected
        send('held_item_slot', { slotId: S.selected })
      }
      if (S.heldBrand) { const b = S.heldBrand; S.heldBrand = null; send('custom_payload', b) }
      const vehicle = bot.vehicle
      if (vehicle && vehicle !== bot.entity && S.positionReceived) ridingTick(vehicle)
      else { S.boat = null; playerTick() }
      if (V.tickEnd) send('tick_end', {})
      bot.emit('physicsTick')
    }

    // ---------------- scheduler (Minecraft timer: catch up at most 10 ticks) ----------------
    let timer = null
    let nextAt = 0
    function startTicking () {
      if (timer) return
      nextAt = performance.now() + TICK_MS
      const loop = () => {
        const now = performance.now()
        let n = 0
        while (now >= nextAt && n < 10) {
          try { clientTick() } catch (err) { bot.emit('error', err) }
          nextAt += TICK_MS
          n++
        }
        if (now - nextAt > 1000) nextAt = now + TICK_MS
        timer = setTimeout(loop, Math.max(0, nextAt - performance.now()))
      }
      timer = setTimeout(loop, TICK_MS)
    }
    bot.on('end', () => { clearTimeout(timer); timer = null })
  }
}

module.exports = spectraPhysics
