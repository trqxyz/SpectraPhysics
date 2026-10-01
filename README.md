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
| Block effects | during the move | during the move before 1.21.2; from 1.21.2 after travel, walking the path in each version's own block order |
| Powder snow | never solid | solid from above in leather boots (not while sneaking), 0.9 high when falling onto it |
| Item use | any `activateItem`, cleared by any entity's status | only items with a use animation (food when hungry, potions, shield, bow with arrows, …), ended by release, slot change or the server; movement slowed to a fifth |
| Actions | sent whenever called | use, dig, interact, attack and swing go out at the start of the next tick, before movement; `use_item` carries that tick's rotation |
| Entity clicks, mounting | `interact` only | aim, `interact_at` with the hit point, `interact`, swing; leaving a vehicle by holding sneak |
| Rotation | continuous interpolation | whole mouse steps of 0.15°, accumulated in float |
| Sprint | applied the same tick | speed follows the sprint state in the tick it is sent, as the server applies it |
| Tick loop | fixed interval | `Minecraft` timer: catches up at most 10 ticks |
| 1.21.2+ | no `tick_end` | `tick_end` after every tick, `player_input` on key change |
| 1.21.4+ | `player_loaded` on first health update | sent once the level around the player is loaded |
| Teleport answer | one order for all versions | per version (1.21.2–1.21.3 send position before the confirmation) |
| Vehicles | rotation packets only | boat simulation with paddle / input / vehicle move packets (input applies a tick later, as in the game), minecart riding |
| Brand, 1.20.2+ | sent in play state | sent in the configuration phase, once |
| Open container | keeps moving | movement keys are ignored while a window is open, as in the game |

It also works around mineflayer issues that break movement:

- an empty full chunk (no sections) sent to a 1.16 client is treated as an unload, so the player never ticks in it;
- a removed vehicle is never dismounted (`entityGone` is listened for on the wrong emitter);
- an out-of-range hotbar slot from the server throws inside the packet handler;
- player attributes are misread: stored under `undefined` on 1.16.5 – 1.20.4 and named from an outdated id table
  on 1.21+ (on 1.21.2 – 1.21.5 movement speed arrives as step height), so speed effects and step height go wrong;
- `set_passengers` without the bot never clears `bot.vehicle`, so after every dismount the bot keeps acting as a passenger;
- enchantments on 1.20.5+ items are not a list (reading boots throws), and from 1.21 their ids come from the server's registry;
- the 1.16 data numbers dolphin's grace wrong and marks every entity, arrows and items included, as a mob;
- recipe packets on 1.20.5 – 1.21.3 and advancements on 1.21.2 – 1.21.3 fail to parse; they arrive as raw buffers there.

Before 1.18.2 the client only reports moves longer than 0.03. Airborne moves shorter than that are still reported,
and on 1.17 – 1.18.1 the mouse holds a turn for up to two seconds while such moves last, because anti-cheats
cannot reconstruct the skipped vertical movement.

## Performance

All bots in a process share one 20 TPS clock. Inside a tick the engine memoises chunk columns and block data and
reuses its collision boxes, so a player tick costs about 3 µs (`node bench/tick.js`, 50 players on a course of
slabs, fences, water, cobwebs and honey). `node bench/trajectory.js --check` compares a fingerprint of every
simulated position with `bench/baseline.json`, which is how optimisations are checked to change nothing.

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

### Pathfinder

A built-in pathfinder with the same API as mineflayer-pathfinder, driven by the engine itself:

```js
const { createBot, goals } = require('spectra-physics')

const bot = createBot({ host: 'localhost', username: 'Steve', version: '1.21.4' })

bot.once('spawn', async () => {
  await bot.pathfinder.goto(new goals.GoalBlock(120, 64, -40))
  bot.pathfinder.setGoal(new goals.GoalFollow(bot.nearestEntity(e => e.name === 'cow'), 2), true)
})
```

- A* with costs in ticks, so it picks the fastest route: walking, sprinting, slabs and stairs without jumping,
  jumps, drops, sprint-jumps over gaps, ladders and vines, swimming, and digging through, up and down
- keys are chosen by simulating the player a few ticks ahead with this engine: when to sprint, when to jump,
  which corners can be cut
- turning goes through the mouse model; blocks are broken tick by tick like the game client (face in view,
  progress and swing every tick, 5 ticks between blocks), also available as `bot.spectra.dig(block)`
- the route is planned again when blocks on it change, the goal moves or the bot gets stuck
- goals: `GoalBlock`, `GoalNear`, `GoalXZ`, `GoalNearXZ`, `GoalY`, `GoalGetToBlock`, `GoalLookAtBlock`,
  `GoalFollow`, `GoalCompositeAny`, `GoalCompositeAll`, `GoalInvert`
- `bot.pathfinder.settings`: `canDig`, `allowParkour`, `allowLongParkour`, `allowSprinting`, `maxDropDown`,
  `thinkTimeout`, `tickTimeout`; events `path_update`, `path_reset`, `path_stop`, `goal_reached`, `goal_updated`

mineflayer-pathfinder works too: `bot.physics.simulatePlayer` runs its look-ahead on this engine.

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
- using items: eating, drinking, blocking with a shield, drawing a bow
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
powder snow, ice, soul sand, pushing, item use, and the position reporting thresholds.

## Layout

```
lib/engine          world access, collisions, version switches, boat
lib/engine/player   the player tick: input, fluids, blocks under the player, move, travel, block effects and their
                    traversal order, pose, pushing
lib/pathfinder      goals, terrain, moves, A*, block breaking and the path follower
lib/client          mineflayer integration: controls, teleports, server packets, position reporting, riding, item use,
                    entity interaction, registry tables, protocol fixes, the shared clock
bench               tick cost and bit-exact output fingerprints
```

## License

[GPL-3.0](LICENSE)
