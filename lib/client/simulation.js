'use strict'
// bot.physics.simulatePlayer for plugins written against prismarine-physics (mineflayer-pathfinder plans
// its jumps with it): the prediction runs on this engine, so plans match how the bot really moves.

const conv = require('mineflayer/lib/conversions')

function installSimulation (ctx) {
  const { bot, player } = ctx
  const running = new WeakMap()

  bot.physics.simulatePlayer = (state) => {
    let sim = running.get(state)
    if (!sim) {
      sim = player.clone()
      running.set(state, sim)
    }
    sim.pos = { x: state.pos.x, y: state.pos.y, z: state.pos.z }
    sim.vel = { x: state.vel.x, y: state.vel.y, z: state.vel.z }
    sim.onGround = !!state.onGround
    sim.yRot = conv.toNotchianYaw(state.yaw)
    sim.xRot = conv.toNotchianPitch(state.pitch)
    const c = state.control ?? {}
    sim.tick({ forward: !!c.forward, back: !!c.back, left: !!c.left, right: !!c.right, jump: !!c.jump, sprint: !!c.sprint, sneak: !!c.sneak })
    state.pos.set(sim.pos.x, sim.pos.y, sim.pos.z)
    state.vel.set(sim.vel.x, sim.vel.y, sim.vel.z)
    state.onGround = sim.onGround
    state.isInWater = sim.isInWater()
    state.isInLava = sim.isInLava()
    state.isCollidedHorizontally = sim.horizontalCollision
    state.isCollidedVertically = sim.verticalCollision
    return state
  }
}

module.exports = { installSimulation }
