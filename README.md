# SpectraPhysics

[![npm](https://img.shields.io/npm/v/spectra-physics)](https://www.npmjs.com/package/spectra-physics)
[![Tests](https://github.com/trqxyz/SpectraPhysics/actions/workflows/test.yml/badge.svg)](https://github.com/trqxyz/SpectraPhysics/actions/workflows/test.yml)

Improved physics and movement engine for [mineflayer](https://github.com/PrismarineJS/mineflayer).

SpectraPhysics replaces mineflayer's built-in `physics` plugin with a port of the vanilla client's movement code
(`LocalPlayer#aiStep` → `LivingEntity#travel` → `Entity#move`) and of the way the client ticks and reports its
position to the server. Movement is computed in the same order and with the same float rounding as the game client,
so positions, velocities and packet timing match a vanilla player tick for tick.

Supported versions: **1.16.5 – 26.1** (every version mineflayer supports in that range).

## Why

mineflayer's default physics (prismarine-physics) is a close approximation, but it differs from the client in
several places that are visible to the server:

| | mineflayer physics | SpectraPhysics |
|---|---|---|
| Collision | legacy 1.8 algorithm | `Shapes.collide` with VoxelShape epsilons, Y → larger horizontal axis order |
| Step-up | single step | pre-1.21 heuristic and 1.21+ candidate step heights |
| First tick after a teleport | moves immediately | no movement, gravity applied after `move`, like vanilla |
| Position packets | time based, last-sent values reset on teleport | `sendPosition` rules: 0.03 threshold before 1.18.2 and 2·10⁻⁴ after, 20-tick reminder, last-sent values kept across teleports |
| Input | raw ±1 | per version: sneak/item scaling then 0.98 up to 1.21.4, normalized square movement from 1.21.5 |
| Wall collisions | always zeroes the blocked axis | 1.14–1.18.1 keep X speed in corners, 1.18.2+ compare with an epsilon |
| Block effects | during the move | during the move before 1.21.2, after travel along the path from 1.21.2 |
| Rotation | continuous interpolation | whole mouse steps of 0.15°, accumulated in float |
| Sprint | applied the same tick | speed attribute updated at the end of the tick, as in `Player#aiStep` |
| Tick loop | fixed interval | `Minecraft` timer: catches up at most 10 ticks |
| 1.21.2+ | no `tick_end` | `tick_end` after every tick, `player_input` on key change |
| 1.21.4+ | `player_loaded` on first health update | sent once the level around the player is loaded |
| Teleport answer | one order for all versions | per version (1.21.2–1.21.3 send position before the confirmation) |
| Vehicles | rotation packets only | boat simulation with paddle / input / vehicle move packets, minecart riding |
| Brand, 1.20.2+ | sent in play state | sent in the configuration phase, once |
| Open container | keeps moving | movement keys are ignored while a window is open, as in the game |

It also fixes three mineflayer issues that leave a bot stuck:

- an empty full chunk (no sections) sent to a 1.16 client is treated as an unload, so the player never ticks in it;
- a removed vehicle is never dismounted (`entityGone` is listened for on the wrong emitter);
- an out-of-range hotbar slot from the server throws inside the packet handler.

## Installation

```bash
npm install spectra-physics mineflayer
```

Requires Node.js 22 or newer and mineflayer 4.30 or newer.

## Usage

```js
const { createBot } = require('spectra-physics')

const bot = createBot({
  host: 'localhost',
  port: 25565,
  username: 'Steve',
  version: '1.21.4',
  spectra: { turnSpeed: 30 }
})

bot.once('spawn', async () => {
  await bot.lookAt(bot.entity.position.offset(5, 1.6, 0))
  bot.setControlState('forward', true)
  bot.setControlState('sprint', true)
  await bot.waitForTicks(40)
  bot.clearControlStates()
})
```

With an existing `mineflayer.createBot` call, install it under the `physics` key so it replaces the built-in plugin:

```js
const mineflayer = require('mineflayer')
const spectraPhysics = require('spectra-physics')

const bot = mineflayer.createBot({
  host: 'localhost',
  username: 'Steve',
  plugins: { physics: spectraPhysics() }
})
```

More in [`examples/`](examples).

### Options

| option | default | |
|---|---|---|
| `turnSpeed` | `35` | maximum rotation per tick in degrees |
| `brand` | `'vanilla'` | client brand sent to the server |
| `debug` | `false` | `true` logs every outgoing packet, or pass a function `(...args) => {}` |

### Bot API

The standard mineflayer movement API keeps working:
`setControlState`, `getControlState`, `clearControlStates`, `controlState`, `look`, `lookAt`, `waitForTicks`,
`physicsEnabled`, events `physicsTick`, `move`, `forcedMove`, `mount`, `dismount`.

Added:

- `bot.spectra.player` – the simulated player (`pos`, `vel`, `yRot`, `xRot`, `onGround`, `horizontalCollision`, `fallDistance`, `sprinting`, `abilities`, …)
- `bot.spectra.flags` – version switches in effect for the connected protocol
- `bot.spectra.world` – block and fluid lookups used by the engine
- event `clientLoaded` – 1.21.4+, emitted when `player_loaded` is sent

### Standalone engine

The engine can run without a connection, for prediction or tests:

```js
const { PlayerPhysics, WorldView, versionFlags } = require('spectra-physics')

// `source` needs { registry, world: { getColumn(chunkX, chunkZ) }, game: { minY, height } }
const player = new PlayerPhysics(new WorldView(source), versionFlags(source.registry), {
  attribute: (name, def) => def,
  movementSpeed: (sprinting) => (sprinting ? 0.13 : 0.1),
  effect: () => null,
  food: () => 20,
  usingItem: () => false,
  gameMode: () => 'survival',
  ultraWarm: () => false
})

player.pos = { x: 0.5, y: 80, z: 0.5 }
player.tick({ forward: true, back: false, left: false, right: false, jump: false, sprint: false, sneak: false })
```

See [`test/helpers.js`](test/helpers.js) for a complete in-memory world.

## What is simulated

- gravity, air drag and ground friction (slipperiness per block, supporting block on 1.20+)
- collisions against block shapes, step-up, sneaking edge back-off
- walking, sprinting (double-tap and key), sprint-jumping, crouching, crawling and swimming poses
- water and lava with flow pushing, swimming, climbing (ladders, vines, scaffolding, trapdoors over ladders, powder snow in leather boots)
- cobweb (and weaving), sweet berry bush, powder snow, honey sliding, bubble columns, soul sand, slime and bed bouncing
- being pushed out of blocks and by overlapping entities
- levitation, slow falling, jump boost, dolphin's grace, depth strider and soul speed,
  attributes: movement speed, gravity, jump strength, step height, sneaking speed, movement and water efficiency
- creative flight, including toggling with a double jump and landing
- knockback and explosion velocity, 1.21.2+ relative teleports with velocity
- riding boats (client-controlled) and minecarts

Not simulated yet: elytra flight, riptide, world border.

## Tests

```bash
npm test
```

Offline tests for 1.16.5 – 26.1 cover free fall, landing on blocks and slabs, walking and sprinting speed,
jump height, step-up, walls and corners, sneaking at an edge, input per version, swimming, cobwebs, bubble columns,
ice, soul sand, pushing, and the position reporting thresholds.

## Layout

```
lib/engine          world access, collisions, version switches, boat
lib/engine/player   the player tick: input, fluids, blocks under the player, move, travel, block effects, pose, pushing
lib/client          mineflayer integration: controls, teleports, server packets, position reporting, riding, tick loop
```

## License

[GPL-3.0](LICENSE)
