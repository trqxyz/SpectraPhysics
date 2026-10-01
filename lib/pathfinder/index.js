'use strict'
// Pathfinder that walks with the engine itself: A* over moves costed in ticks, and a follower that picks
// keys by simulating the player a few ticks ahead, turns like a mouse and breaks blocks tick by tick.
// The API mirrors mineflayer-pathfinder (setGoal, goto, stop, goals, path events).

const { Vec3 } = require('vec3')
const { AStar } = require('./astar')
const { Terrain } = require('./terrain')
const { installDigger, bestTool } = require('./digger')
const { f32, wrapDegrees } = require('../engine/mth')

const MOUSE_STEP = f32(0.15)
const STUCK_TICKS = 40
const LOOKAHEAD = 4
const KEYS = ['forward', 'back', 'left', 'right', 'jump', 'sprint', 'sneak']

const conv = require('mineflayer/lib/conversions')
const toDegrees = (yaw) => conv.toNotchianYaw(yaw)

function installPathfinder (ctx) {
  const { bot, player, world, state } = ctx
  installDigger(ctx)

  const settings = {
    canDig: true,
    allowParkour: true,
    allowLongParkour: false,
    allowSprinting: true,
    maxDropDown: 3,
    maxDigTicks: 400,
    thinkTimeout: 5000,
    tickTimeout: 25,
    maxNodes: 200000
  }
  const terrain = new Terrain(world, settings)

  let goal = null
  let dynamic = false
  let search = null
  let path = []
  let index = 0
  let needPlan = false
  let digging = false
  let stuck = { ticks: 0, pos: null }
  let owned = false

  // ---- keys and looking -------------------------------------------------------------------------

  function keys (k = {}) {
    if (process.env.SPECTRA_PATH_DEBUG) {
      const n = path[index]
      const p = player.pos
      console.log(`[path] ${index}/${path.length} ${n ? n.kind + '@' + n.x + ',' + n.y + ',' + n.z : '-'} pos ${p.x.toFixed(2)},${p.y.toFixed(2)},${p.z.toFixed(2)} yaw ${player.yRot.toFixed(1)} keys ${KEYS.filter(key => k[key]).join('+')}`)
    }
    owned = true
    for (const key of KEYS) bot.setControlState(key, !!k[key])
  }

  function release () {
    if (!owned) return
    owned = false
    for (const key of KEYS) bot.setControlState(key, false)
  }

  // where the mouse will be after a tick of turning toward yaw (game degrees), as controls.turn does it
  function turnStep (from, to) {
    const max = (ctx.options.turnSpeed ?? 35) / MOUSE_STEP
    const steps = Math.max(-max, Math.min(max, Math.round(wrapDegrees(to - from) / MOUSE_STEP)))
    return steps === 0 ? from : f32(from + f32(f32(steps) * MOUSE_STEP))
  }

  function yawTo (x, z) {
    return Math.atan2(-(x - player.pos.x), -(z - player.pos.z))
  }

  // ---- looking ahead with the engine -------------------------------------------------------------

  function simulate (k, yaw, ticks, until) {
    const sim = player.clone()
    const target = toDegrees(yaw)
    const input = { forward: false, back: false, left: false, right: false, jump: false, sprint: false, sneak: false, ...k }
    for (let i = 0; i < ticks; i++) {
      sim.yRot = turnStep(sim.yRot, target)
      sim.tick(input)
      const r = until(sim, i)
      if (r !== undefined) return r ? sim : null
    }
    return null
  }

  function reachedBy (sim, n) {
    const dx = sim.pos.x - (n.x + 0.5)
    const dz = sim.pos.z - (n.z + 0.5)
    if (Math.abs(dx) > 0.35 || Math.abs(dz) > 0.35) return false
    if (n.water) return sim.pos.y >= n.y - 0.3 && sim.pos.y <= n.y + 1.2
    if (n.climb) return sim.pos.y >= n.floor - 0.2 && sim.pos.y < n.floor + 1
    return Math.abs(sim.pos.y - n.floor) < 0.1 && sim.onGround
  }

  function reached (n) { return reachedBy(player, n) }

  // the run toward n with these keys gets there without falling below it or stalling
  function canRun (k, n, ticks = 30) {
    const yaw = yawTo(n.x + 0.5, n.z + 0.5)
    return !!simulate(k, yaw, ticks, (sim) => {
      if (reachedBy(sim, n)) return true
      if (!n.water && sim.pos.y < Math.min(n.floor, player.pos.y) - 0.6) return false
      if (sim.horizontalCollision && sim.onGround && !k.jump) return false
      return undefined
    })
  }

  // ---- planning ----------------------------------------------------------------------------------

  function currentNode () {
    const p = player.pos
    const x = Math.floor(p.x)
    const z = Math.floor(p.z)
    if (player.isInWater()) {
      const y = Math.floor(p.y + 0.1)
      return { x, y, z, floor: y, water: true, climb: false, dig: [] }
    }
    const feetY = Math.floor(p.y + 0.2)
    const feet = terrain.at(x, Math.floor(p.y), z)
    if (feet?.climbable && !player.onGround) return { x, y: Math.floor(p.y), z, floor: Math.floor(p.y), water: false, climb: true, dig: [] }
    if (player.onGround) return { x, y: feetY, z, floor: p.y, water: false, climb: !!feet?.climbable, dig: [] }
    // in the air: plan from the floor right below, unless still falling far
    for (let y = feetY; y >= feetY - 2; y--) {
      const floor = terrain.floorAt(x, y, z)
      if (floor != null && p.y - floor < 1.5) return { x, y, z, floor, water: false, climb: false, dig: [] }
    }
    return null
  }

  function plan () {
    const start = currentNode()
    if (!start) return false
    needPlan = false
    terrain.prepare(bot)
    terrain.traits.length = 0
    search = new AStar(start, goal, terrain, settings)
    return true
  }

  function adopt (result) {
    path = result.path
    index = 0
    aimed = -1
    stuck = { ticks: 0, pos: null }
    bot.emit('path_update', result)
    if (result.status === 'noPath' && !path.length) bot.emit('path_reset', 'no_path')
  }

  function reset (reason) {
    path = []
    index = 0
    search = null
    needPlan = true
    bot.emit('path_reset', reason)
  }

  // ---- following ---------------------------------------------------------------------------------

  const flat = (n) => n.kind === 'walk' && !n.dig.length && !n.water && !n.climb
  const dist2 = (ax, az, bx, bz) => (ax - bx) ** 2 + (az - bz) ** 2

  function advance () {
    for (let i = Math.min(path.length - 1, index + LOOKAHEAD); i >= index; i--) {
      if (reached(path[i]) && !path.slice(index, i + 1).some(n => pendingDig(n).length)) {
        index = i + 1
        break
      }
    }
    // cutting corners on level ground: the nearest of the next nodes is where we are on the route
    const p = player.pos
    if (player.onGround && index < path.length && flat(path[index])) {
      let best = index
      let bestD = Infinity
      for (let i = index; i < path.length && i <= index + LOOKAHEAD; i++) {
        const n = path[i]
        if (!flat(n) || Math.abs(p.y - n.floor) > 0.6) break
        const d = dist2(p.x, p.z, n.x + 0.5, n.z + 0.5)
        if (d < bestD) { bestD = d; best = i }
      }
      index = best
    }
    // a node is behind us once the next one is closer than it is
    while (index + 1 < path.length && player.onGround) {
      const a = path[index]
      const b = path[index + 1]
      if (!flat(a) || !flat(b) || Math.abs(a.floor - b.floor) > 0.6 || Math.abs(p.y - a.floor) > 0.6) break
      if (dist2(p.x, p.z, b.x + 0.5, b.z + 0.5) >= dist2(a.x + 0.5, a.z + 0.5, b.x + 0.5, b.z + 0.5)) break
      index++
    }
  }

  function pendingDig (n) {
    return n.dig.filter(([x, y, z]) => {
      const b = bot.blockAt(new Vec3(x, y, z))
      return b && b.boundingBox !== 'empty' && b.name !== 'air'
    })
  }

  // the furthest walk node straight ahead that a sprint reaches without detours; kept while it still works
  let aimed = -1
  function aimIndex (sprint) {
    if (aimed > index && aimed < path.length && aimed <= index + LOOKAHEAD && canRun({ forward: true, sprint }, path[aimed], 40)) return aimed
    aimed = pickAim(sprint)
    return aimed
  }

  function pickAim (sprint) {
    let target = index
    const first = path[index]
    if (first.kind !== 'walk' || first.dig.length || first.water || first.climb) return target
    for (let i = index + 1; i < path.length && i <= index + LOOKAHEAD; i++) {
      const n = path[i]
      if (n.kind !== 'walk' || n.dig.length || n.water || n.climb || Math.abs(n.floor - first.floor) > 0.6) break
      if (!canRun({ forward: true, sprint }, n, 40)) break
      target = i
    }
    return target
  }

  function moveToward (n, i) {
    const yaw = yawTo(n.x + 0.5, n.z + 0.5)
    // only the yaw follows the route; the pitch stays where the player left it
    bot.look(yaw, bot.entity.pitch).catch(() => {})
    const off = Math.abs(wrapDegrees(toDegrees(yaw) - player.yRot))
    const facing = off < 90
    const sprintOk = settings.allowSprinting && off < 30 && !player.isInWater()
    const dxz = Math.hypot(n.x + 0.5 - player.pos.x, n.z + 0.5 - player.pos.z)

    if (n.water || player.isInWater()) {
      const rise = n.y >= Math.floor(player.pos.y) || n.kind === 'jump'
      // holding sneak sinks four times faster than drifting down
      const sink = n.water && n.y < Math.floor(player.pos.y)
      return keys({ forward: dxz > 0.2, jump: rise && !sink, sneak: sink })
    }

    if (n.climb && n.kind === 'climb') {
      if (n.floor > player.pos.y + 0.1) return keys({ jump: true, forward: dxz > 0.25 })
      return keys({ forward: dxz > 0.25 })
    }

    if (n.kind === 'climb' || (n.kind === 'jump' && path[i - 1]?.climb)) {
      return keys({ forward: true, jump: true })
    }

    if (n.kind === 'jump' || n.kind === 'parkour') {
      const sprint = sprintOk && (n.kind === 'parkour' || dxz > 1.5)
      const jumpNow = player.onGround && canRun({ forward: true, sprint, jump: true }, n, 25)
      if (jumpNow) return keys({ forward: true, sprint, jump: true })
      // about to run out of floor before the jump would work: jump anyway
      const next = simulate({ forward: true, sprint }, yaw, 1, (sim) => sim.onGround)
      if (n.kind === 'parkour' && !next && player.onGround) return keys({ forward: true, sprint, jump: true })
      const blocked = player.horizontalCollision && player.onGround
      return keys({ forward: facing || dxz < 0.5, sprint, jump: blocked })
    }

    if (n.kind === 'dig-down') return keys({ forward: dxz > 0.3 && facing })

    // walk / drop
    const sprint = sprintOk && dxz > 0.8 && canRun({ forward: true, sprint: true }, n, 30)
    return keys({ forward: facing || dxz < 0.3, sprint })
  }

  function follow () {
    advance()
    if (index >= path.length) {
      path = []
      const here = currentNode()
      if (here && goal.isEnd(here)) return arrive()
      needPlan = true
      return
    }

    const n = path[index]
    const dig = pendingDig(n)
    if (dig.length) {
      if (Math.hypot(player.vel.x, player.vel.z) > 0.03 || (!player.onGround && !n.climb && !player.isInWater())) return release()
      release()
      const [x, y, z] = dig[0]
      const block = bot.blockAt(new Vec3(x, y, z))
      digging = true
      ctx.dig(block).catch(() => reset('dig_failed')).then(() => { digging = false })
      return
    }

    const aim = n.kind === 'walk' ? aimIndex(settings.allowSprinting) : index
    moveToward(path[aim], aim)

    // not moving for a while, or pushed far off the route: plan again from here
    const p = player.pos
    if (!stuck.pos || Math.hypot(p.x - stuck.pos.x, p.y - stuck.pos.y, p.z - stuck.pos.z) > 0.15) {
      stuck = { ticks: 0, pos: { x: p.x, y: p.y, z: p.z } }
    } else if (++stuck.ticks > STUCK_TICKS) return reset('stuck')
    const target = path[index]
    if (Math.hypot(target.x + 0.5 - p.x, target.floor - p.y, target.z + 0.5 - p.z) > 4) reset('off_path')
  }

  function arrive () {
    release()
    if (dynamic) return
    const reachedGoal = goal
    goal = null
    bot.emit('goal_reached', reachedGoal)
  }

  function tick () {
    if (!goal || !bot.entity) return
    if (!goal.isValid()) return pf.stop()
    if (goal.hasChanged()) needPlan = true
    if (digging || ctx.isDigging()) return

    if (needPlan && !search) {
      if (!path.length) release()
      plan()
    }
    if (search) {
      const result = search.compute()
      if (result.status === 'partial') {
        if (!path.length) release()
        else follow()
        return
      }
      search = null
      adopt(result)
    }

    if (!path.length) {
      const here = currentNode()
      if (here && goal.isEnd(here)) return arrive()
      if (!needPlan) needPlan = true
      return release()
    }
    follow()
  }

  bot.on('physicsTick', () => {
    try { tick() } catch (err) { reset('error'); bot.emit('error', err) }
  })

  // blocks changing on the planned route make it stale
  bot.on('blockUpdate', (oldBlock, newBlock) => {
    if (!path.length || !newBlock || oldBlock?.type === newBlock.type) return
    const p = newBlock.position
    // blocks we are digging ourselves are expected to change
    for (const n of path) if (n.dig.some(([x, y, z]) => x === p.x && y === p.y && z === p.z)) return
    for (let i = index; i < path.length && i < index + 20; i++) {
      const n = path[i]
      if (p.x === n.x && p.z === n.z && p.y >= Math.floor(n.floor) - 1 && p.y <= Math.floor(n.floor) + 2) return reset('block_updated')
    }
  })

  bot.on('death', () => pf.stop())

  const pf = {
    settings,
    goals: require('./goals'),

    setGoal (newGoal, isDynamic = false) {
      goal = newGoal
      dynamic = isDynamic
      path = []
      index = 0
      search = null
      needPlan = !!newGoal
      if (!newGoal) {
        if (ctx.isDigging()) ctx.stopDigging()
        release()
      }
      bot.emit('goal_updated', newGoal, isDynamic)
    },

    goto (newGoal) {
      return new Promise((resolve, reject) => {
        const cleanup = () => {
          bot.removeListener('goal_reached', onReached)
          bot.removeListener('path_update', onUpdate)
          bot.removeListener('path_stop', onStop)
          bot.removeListener('end', onEnd)
        }
        const onReached = (g) => { if (g === newGoal) { cleanup(); resolve() } }
        const onUpdate = (r) => {
          if (r.status === 'noPath' && r.path.length === 0) { cleanup(); pf.setGoal(null); reject(new Error('No path to the goal')) }
          if (r.status === 'timeout' && r.path.length === 0) { cleanup(); pf.setGoal(null); reject(new Error('Took to long to decide path to goal')) }
        }
        const onStop = () => { cleanup(); reject(new Error('Path was stopped before it could be completed')) }
        const onEnd = () => { cleanup(); reject(new Error('Bot disconnected')) }
        bot.on('goal_reached', onReached)
        bot.on('path_update', onUpdate)
        bot.on('path_stop', onStop)
        bot.on('end', onEnd)
        pf.setGoal(newGoal, false)
      })
    },

    stop () {
      if (!goal) return
      pf.setGoal(null)
      bot.emit('path_stop')
    },

    // a full search right now, without moving (for checks and tests)
    getPathTo (target, startNode = currentNode()) {
      if (!startNode) return { status: 'noPath', path: [] }
      terrain.prepare(bot)
      const s = new AStar(startNode, target, terrain, { ...settings, tickTimeout: settings.thinkTimeout })
      return s.compute()
    },

    setMovements (movements) {
      for (const key of ['canDig', 'allowParkour', 'allowSprinting', 'maxDropDown']) {
        if (movements && key in movements) settings[key] = movements[key]
      }
    },

    bestHarvestTool: (block) => bestTool(bot, block),
    isMoving: () => path.length > 0 && index < path.length,
    isMining: () => digging || ctx.isDigging(),
    isBuilding: () => false,
    isThinking: () => !!search,
    get goal () { return goal },
    get path () { return path.slice(index) }
  }

  bot.spectra.pathfinder = pf
  bot.spectra.dig = (block) => ctx.dig(block)
  if (!bot.pathfinder) bot.pathfinder = pf
  state.pathfinder = pf
}

module.exports = { installPathfinder, goals: require('./goals') }
