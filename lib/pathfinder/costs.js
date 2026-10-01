'use strict'
// Move costs in game ticks, from the engine's own speeds: sprinting 0.2806 blocks per tick, climbing
// 0.1176 up and 0.15 down, swimming about 0.11. A* then finds the fastest route, not just the shortest.

const walk = 1 / 0.2806

const COST = {
  walk,
  diagonal: walk * Math.SQRT2,
  jumpUp: walk + 2.5, // the jump costs a few ticks of forward speed
  dropDown: walk + 1, // plus fallTick per block fallen
  fallTick: 1.2,
  parkourGap: 2, // extra for every jump over a gap, on top of the distance
  climbUp: 1 / 0.1176,
  climbDown: 1 / 0.15,
  swim: 9,
  digSetup: 6, // stopping and turning to the block
  avoid: 40 // stepping somewhere unpleasant but harmless (soul sand, honey, a cobweb we must cross)
}

module.exports = { COST }
