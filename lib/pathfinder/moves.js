'use strict'
// Neighbours of a node for A*. A node is the block the feet are in plus the exact floor height, so slabs,
// stairs and carpets are walked over rather than jumped. Costs are in ticks (see costs.js).

const { COST } = require('./costs')
const { PLAYER_HEIGHT, STEP } = require('./terrain')

const JUMP = 1.25 // highest floor a jump reaches
const CARDINAL = [[1, 0], [-1, 0], [0, 1], [0, -1]]
const DIAGONAL = [[1, 1], [1, -1], [-1, 1], [-1, -1]]

function node (x, y, z, floor, kind, cost, extra) {
  return { x, y, z, floor, kind, cost, dig: extra?.dig ?? [], water: !!extra?.water, climb: !!extra?.climb, gap: extra?.gap ?? 0 }
}

function digCost (terrain, dig) {
  let ticks = 0
  for (const d of dig) ticks += terrain.digCost(d[3]) + COST.digSetup
  return ticks
}

// blocks between two heights in a column are free for the body (nothing dug)
function columnClear (terrain, x, z, from, to) {
  for (let y = Math.floor(from); y <= Math.floor(to - 1e-6); y++) {
    const t = terrain.at(x, y, z)
    if (!t || t.danger || !t.empty) return false
  }
  return true
}

// headroom above the current position for a jump of `rise`
function jumpRoom (terrain, n, rise, dig) {
  const top = n.floor + PLAYER_HEIGHT + rise
  for (let y = Math.floor(n.floor + PLAYER_HEIGHT); y <= Math.floor(top - 1e-6); y++) {
    const t = terrain.at(n.x, y, n.z)
    if (!t || t.danger) return false
    if (t.empty) continue
    if (!dig || !terrain.canDigAt(n.x, y, n.z, t)) return false
    dig.push([n.x, y, n.z, t])
  }
  return true
}

function waterNode (terrain, x, y, z) {
  const feet = terrain.at(x, y, z)
  if (!feet || !feet.water) return false
  const head = terrain.at(x, y + 1, z)
  return !!head && (head.water || head.empty) && !head.danger
}

function climbNode (terrain, x, y, z) {
  const feet = terrain.at(x, y, z)
  if (!feet || !feet.climbable) return false
  const head = terrain.at(x, y + 1, z)
  return !!head && (head.empty || head.climbable) && !head.danger
}

// where a player falling down column x/z from `fromFloor` ends up: a floor or water
function landing (terrain, x, startY, z, fromFloor, maxDrop) {
  for (let y = startY; y >= startY - 64; y--) {
    const t = terrain.at(x, y, z)
    if (!t || t.danger) return null
    if (t.water) return { y, floor: y, water: true }
    const floor = terrain.floorAt(x, y, z)
    if (floor != null) {
      if (fromFloor - floor > maxDrop + 1e-6) return null
      return { y, floor }
    }
    if (!t.empty && !t.climbable) return null
    if (t.climbable) return { y, floor: y, climb: true }
  }
  return null
}

function neighbours (n, terrain, opts, out = []) {
  const inWater = n.water
  for (const [dx, dz] of CARDINAL) step(n, dx, dz, terrain, opts, out, false)
  for (const [dx, dz] of DIAGONAL) step(n, dx, dz, terrain, opts, out, true)
  if (opts.allowParkour && !inWater && !n.climb) for (const [dx, dz] of CARDINAL) parkour(n, dx, dz, terrain, opts, out)
  vertical(n, terrain, opts, out)
  return out
}

// the column between two heights is free for the body; blocks in the way go to `dig` when allowed
function clearColumn (terrain, x, z, from, to, dig) {
  const y0 = Math.floor(from)
  for (let y = y0; y <= Math.floor(to - 1e-6); y++) {
    const t = terrain.at(x, y, z)
    if (!t || t.danger) return false
    if (t.empty) continue
    if (y === y0 && y + t.top <= from + 1e-6) continue
    if (!dig || !terrain.canDigAt(x, y, z, t)) return false
    if (!dig.some(d => d[0] === x && d[1] === y && d[2] === z)) dig.push([x, y, z, t])
  }
  return true
}

function step (n, dx, dz, terrain, opts, out, diagonal) {
  const x = n.x + dx
  const z = n.z + dz
  const base = diagonal ? COST.diagonal : COST.walk

  if (diagonal) {
    // the box clips the corner unless both sides are open
    const lo = n.floor
    if (!columnClear(terrain, n.x + dx, n.z, lo, lo + PLAYER_HEIGHT)) return
    if (!columnClear(terrain, n.x, n.z + dz, lo, lo + PLAYER_HEIGHT)) return
  }

  // into water
  for (const y of [n.y, n.y + 1]) {
    if (!waterNode(terrain, x, y, z)) continue
    if (y > n.y && !jumpRoom(terrain, n, 1, null)) continue
    if (!terrain.bodyFits(x, y, z, null)) continue
    out.push(node(x, y, z, y, 'swim', COST.swim * (diagonal ? Math.SQRT2 : 1), { water: true }))
    return
  }

  // up a block, level, or down a block; with digging the floor may be the block under a wall
  const canDig = opts.canDig && !diagonal && !n.water
  for (const y of [n.y + 1, n.y, n.y - 1]) {
    let floor = terrain.floorAt(x, y, z)
    if (floor == null && canDig) floor = terrain.floorUnder(x, y, z)
    else if (y === n.y - 1) continue // a natural lower floor is a drop, handled below
    if (floor == null) continue
    const rise = floor - n.floor
    if (rise > JUMP + 1e-6 || rise < -1.5) continue
    if (rise < -STEP - 1e-6 && y !== n.y - 1) continue
    const jump = rise > STEP + 1e-6
    if (jump && diagonal) continue
    if (jump && n.water && rise > 1 + 1e-6) continue
    const dig = canDig ? [] : null
    if (jump && !n.climb && !jumpRoom(terrain, n, rise, dig)) continue
    if (!clearColumn(terrain, x, z, floor, Math.max(floor, n.floor) + PLAYER_HEIGHT, dig)) continue
    let cost = jump ? COST.jumpUp : (rise < -STEP ? COST.dropDown : base)
    if (n.water) cost += COST.swim
    cost += terrain.floorPenalty(x, floor, z)
    if (dig) cost += digCost(terrain, dig)
    const kind = jump ? (n.climb ? 'climb' : 'jump') : (rise < -STEP ? 'drop' : 'walk')
    out.push(node(x, y, z, floor, kind, cost, { dig: (dig ?? []).sort((a, b) => b[1] - a[1]) }))
    if (!dig || dig.length === 0) return
  }

  // a climbable column next to us
  if (climbNode(terrain, x, n.y, z) && terrain.bodyFits(x, n.y, z, null)) {
    out.push(node(x, n.y, z, n.y, 'walk', base + COST.climbDown, { climb: true }))
    return
  }

  // walking off an edge
  if (n.water) return
  if (!columnClear(terrain, x, z, n.floor, n.floor + PLAYER_HEIGHT)) return
  const land = landing(terrain, x, n.y - 1, z, n.floor, opts.maxDropDown)
  if (!land) return
  if (!land.water && !terrain.bodyFits(x, land.floor, z, null)) return
  const fall = n.floor - land.floor
  if (fall <= STEP + 1e-6) return
  out.push(node(x, land.y, z, land.floor, 'drop', base + COST.fallTick * fall + 1, { water: land.water, climb: land.climb }))
}

// sprint-jump over a gap of one or two blocks (three with allowLongParkour)
function parkour (n, dx, dz, terrain, opts, out) {
  const maxGap = opts.allowLongParkour ? 3 : 2
  const top = n.floor + PLAYER_HEIGHT + 1.25
  for (let g = 1; g <= maxGap; g++) {
    const gx = n.x + dx * g
    const gz = n.z + dz * g
    // the gap column must be open from below the feet to above the jump
    if (terrain.floorAt(gx, n.y, gz) != null || terrain.floorAt(gx, n.y + 1, gz) != null) return
    if (!columnClear(terrain, gx, gz, n.floor, top)) return
    if (!columnClear(terrain, n.x, n.z, n.floor + PLAYER_HEIGHT, top)) return
    const lx = n.x + dx * (g + 1)
    const lz = n.z + dz * (g + 1)
    for (const y of [n.y, n.y - 1, n.y + 1]) {
      const floor = terrain.floorAt(lx, y, lz)
      if (floor == null) continue
      const rise = floor - n.floor
      if (rise > 1 + 1e-6 && g > 1) continue
      if (rise > JUMP - 0.25 || rise < -2) continue
      if (!terrain.bodyFits(lx, floor, lz, null) || !columnClear(terrain, lx, lz, floor, top)) continue
      // only worth it when walking around or dropping in is not an option: the gap is deep or dangerous
      const below = landing(terrain, gx, n.y - 1, gz, n.floor, opts.maxDropDown)
      if (below && !below.water && n.floor - below.floor <= 1) return
      out.push(node(lx, y, lz, floor, 'parkour', COST.walk * (g + 1) + COST.parkourGap * g, { gap: g }))
      return
    }
  }
}

function vertical (n, terrain, opts, out) {
  // climbing
  if (climbNode(terrain, n.x, n.y + 1, n.z) || (n.climb && terrain.at(n.x, n.y + 1, n.z)?.climbable)) {
    if (terrain.bodyFits(n.x, n.y + 1, n.z, null)) out.push(node(n.x, n.y + 1, n.z, n.y + 1, 'climb', COST.climbUp, { climb: true }))
  }
  if (n.climb || climbNode(terrain, n.x, n.y - 1, n.z)) {
    if (climbNode(terrain, n.x, n.y - 1, n.z)) {
      out.push(node(n.x, n.y - 1, n.z, n.y - 1, 'climb', COST.climbDown, { climb: true }))
    } else if (n.climb) {
      const floor = terrain.floorAt(n.x, n.y - 1, n.z)
      if (floor != null) out.push(node(n.x, n.y - 1, n.z, floor, 'climb', COST.climbDown))
    }
  }

  // swimming up and down
  if (n.water) {
    if (waterNode(terrain, n.x, n.y + 1, n.z)) out.push(node(n.x, n.y + 1, n.z, n.y + 1, 'swim', COST.swim, { water: true }))
    if (waterNode(terrain, n.x, n.y - 1, n.z)) out.push(node(n.x, n.y - 1, n.z, n.y - 1, 'swim', COST.swim, { water: true }))
    return
  }

  // digging the floor away and dropping onto the block below it
  if (opts.canDig && !n.climb && n.floor === Math.floor(n.floor)) {
    const below = terrain.at(n.x, n.y - 1, n.z)
    if (!below || below.empty || !terrain.canDigAt(n.x, n.y - 1, n.z, below)) return
    const floor = terrain.floorAt(n.x, n.y - 1, n.z)
    const under = terrain.at(n.x, n.y - 2, n.z)
    if (floor != null || !under || under.empty || under.danger || under.water || under.top < 1) return
    const dig = [[n.x, n.y - 1, n.z, below]]
    out.push(node(n.x, n.y - 1, n.z, n.y - 1, 'dig-down', COST.dropDown + digCost(terrain, dig), { dig }))
  }
}

module.exports = { neighbours, waterNode, climbNode }
