# SpectraPhysics

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
| Position packets | time based, last-sent values reset on teleport | `sendPosition` rules: 2·10⁻⁴ threshold, 20-tick reminder, last-sent values kept across teleports |
| Rotation | continuous interpolation | whole mouse steps of 0.15°, accumulated in float |
| Sprint | applied the same tick | speed attribute updated at the end of the tick, as in `Player#aiStep` |
| Tick loop | fixed interval | `Minecraft` timer: catches up at most 10 ticks |
| 1.21.2+ | no `tick_end` | `tick_end` after every tick, `player_input` on key change |
| 1.21.4+ | `player_loaded` on first health update | sent once the level around the player is loaded |
| Teleport answer | one order for all versions | per version (1.21.2–1.21.3 send position before the confirmation) |
| Vehicles | rotation packets only | boat simulation with paddle / input / vehicle move packets, minecart riding |
| Brand, 1.20.2+ | sent in play state | sent in the configuration phase, once |

It also fixes three mineflayer issues that leave a bot stuck:

- an empty full chunk (no sections) sent to a 1.16 client is treated as an unload, so the player never ticks in it;
- a removed vehicle is never dismounted (`entityGone` is listened for on the wrong emitter);
- an out-of-range hotbar slot from the server throws inside the packet handler.

## Installation

```bash
npm install github:trqxyz/SpectraPhysics
```

`mineflayer` is a peer dependency (4.30 or newer).

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
- collisions against block shapes, step-up, sneaking edge back-off (both the old and the 1.21.2+ rules)
- walking, sprinting (double-tap and key), sprint-jumping, crouch pose and its bounding box
- water and lava with flow pushing, climbing (ladders, vines, scaffolding, trapdoors over ladders)
- cobweb, sweet berry bush, powder snow, honey (sliding), soul sand, slime and bed bouncing
- levitation, slow falling, jump boost, speed / slowness via attributes, dolphin's grace
- creative flight, including toggling with a double jump and landing
- knockback and explosion velocity, 1.21.2+ relative teleports with velocity
- riding boats (client-controlled) and minecarts

Not simulated yet: elytra flight, swimming pose, bubble columns, entity collisions, world border.

## Tests

```bash
npm test
```

Offline tests for 1.16.5, 1.18.2, 1.20.4, 1.21.4 and 26.1 cover free fall, landing on full blocks and slabs,
walking and sprinting speed, jump height, step-up, wall collision, sneaking at an edge, ice and cobwebs.

## License

[GPL-3.0](LICENSE)
