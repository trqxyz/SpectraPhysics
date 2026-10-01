'use strict'
// A* over the move graph. The search can be spread over several ticks (compute() returns 'partial' while
// it is still thinking) and always offers the best path found so far.

const { performance } = require('perf_hooks')
const { neighbours } = require('./moves')

// Plain A* (optimal) while the search converges. When it keeps expanding without reaching the goal, as when
// digging makes the real cost far higher than any estimate, the heuristic gets more weight step by step and
// the search turns greedy enough to find a route in time.
const RELAX_EVERY = 2000
const RELAX_FACTOR = 2
const MAX_WEIGHT = 10000

const OFFSET = 2 ** 19
const SPAN = 2 ** 20

class Heap {
  constructor () { this.items = [] }
  get size () { return this.items.length }

  push (n) {
    const a = this.items
    a.push(n)
    let i = a.length - 1
    n.heapIndex = i
    while (i > 0) {
      const p = (i - 1) >> 1
      if (!less(a[i], a[p])) break
      swap(a, i, p)
      i = p
    }
  }

  pop () {
    const a = this.items
    const top = a[0]
    const last = a.pop()
    if (a.length) {
      a[0] = last
      last.heapIndex = 0
      this.down(0)
    }
    top.heapIndex = -1
    return top
  }

  update (n) {
    const a = this.items
    let i = n.heapIndex
    while (i > 0) {
      const p = (i - 1) >> 1
      if (!less(a[i], a[p])) break
      swap(a, i, p)
      i = p
    }
  }

  down (i) {
    const a = this.items
    for (;;) {
      const l = 2 * i + 1
      const r = l + 1
      let m = i
      if (l < a.length && less(a[l], a[m])) m = l
      if (r < a.length && less(a[r], a[m])) m = r
      if (m === i) return
      swap(a, i, m)
      i = m
    }
  }
}

const less = (a, b) => a.f < b.f || (a.f === b.f && a.h < b.h)
function swap (a, i, j) {
  const t = a[i]; a[i] = a[j]; a[j] = t
  a[i].heapIndex = i; a[j].heapIndex = j
}

class AStar {
  constructor (start, goal, terrain, opts) {
    this.goal = goal
    this.terrain = terrain
    this.opts = opts
    this.ox = start.x
    this.oz = start.z
    this.nodes = new Map()
    this.open = new Heap()
    this.started = performance.now()
    this.visited = 0
    this.weight = 1
    const first = this.record(start)
    first.g = 0
    first.h = goal.heuristic(start)
    first.f = first.h
    this.best = first
    this.open.push(first)
  }

  key (x, y, z) {
    return ((x - this.ox + OFFSET) * SPAN + (z - this.oz + OFFSET)) * 8192 + (y + 4096)
  }

  record (n) {
    const key = this.key(n.x, n.y, n.z)
    let r = this.nodes.get(key)
    if (!r) {
      r = { ...n, g: Infinity, h: 0, f: Infinity, parent: null, heapIndex: -1, closed: false }
      this.nodes.set(key, r)
    }
    return r
  }

  // runs until the goal is found, the tick budget is spent, or the search gives up
  compute () {
    const { tickTimeout, thinkTimeout, maxNodes } = this.opts
    const tickStart = performance.now()
    const goal = this.goal
    while (this.open.size) {
      if (performance.now() - tickStart > tickTimeout) return this.result('partial')
      if (performance.now() - this.started > thinkTimeout || this.visited > maxNodes) return this.result('timeout')
      if (this.visited > 0 && this.visited % RELAX_EVERY === 0 && this.weight < MAX_WEIGHT) this.relax()
      const cur = this.open.pop()
      if (goal.isEnd(cur)) return this.result('success', cur)
      cur.closed = true
      this.visited++
      for (const nb of neighbours(cur, this.terrain, this.opts)) {
        const r = this.record(nb)
        if (r.closed) continue
        const g = cur.g + nb.cost
        if (g >= r.g) continue
        Object.assign(r, nb)
        r.parent = cur
        r.g = g
        r.h = goal.heuristic(r)
        r.f = g + r.h * this.weight
        if (r.h < this.best.h || (r.h === this.best.h && g < this.best.g)) this.best = r
        if (r.heapIndex < 0) this.open.push(r)
        else this.open.update(r)
      }
    }
    return this.result('noPath')
  }

  relax () {
    this.weight = Math.min(MAX_WEIGHT, this.weight * RELAX_FACTOR)
    const items = this.open.items
    for (const n of items) n.f = n.g + n.h * this.weight
    for (let i = (items.length >> 1) - 1; i >= 0; i--) this.open.down(i)
  }

  result (status, end = this.best) {
    const path = []
    for (let n = end; n && n.parent; n = n.parent) path.push(n)
    path.reverse()
    return {
      status,
      path,
      cost: end.g,
      time: performance.now() - this.started,
      visitedNodes: this.visited,
      generatedNodes: this.nodes.size
    }
  }
}

module.exports = { AStar }
