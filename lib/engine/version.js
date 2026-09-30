'use strict'
// Version switches for client behaviour that differs between 1.16.5 and 26.x.
// Uses the protocol version number so "1.21.3" (768) == "1.21.2" etc.

const PV = {
  '1.16.5': 754,
  '1.17': 755,
  '1.19.4': 762,
  '1.20': 763,
  '1.20.2': 764,
  '1.20.3': 765,
  '1.20.5': 766,
  '1.21': 767,
  '1.21.2': 768,
  '1.21.4': 769,
  '1.21.5': 770,
  '1.21.6': 771,
  '1.21.9': 773
}

function versionFlags (registry) {
  const pv = registry.version['>='] ? registry.version.version : registry.version
  const at = (name) => pv >= PV[name]
  return {
    protocol: pv,
    name: registry.version.minecraftVersion,
    // login / configuration
    configPhase: at('1.20.2'), // brand + client information are sent in the configuration phase
    // movement packets
    movementFlags: at('1.21.2'), // onGround + horizontalCollision bitflags in move packets
    tickEnd: at('1.21.2'), // ServerboundClientTickEndPacket after every client tick
    playerInputPacket: at('1.21.2'), // ServerboundPlayerInputPacket sent on key change (replaces steer_vehicle)
    shiftInInput: at('1.21.6'), // no more PRESS/RELEASE_SHIFT_KEY player commands
    clientLoaded: at('1.21.4'), // player does not tick until the level screen closes, then sends player_loaded
    posRotBeforeConfirm: pv === PV['1.21.2'], // 1.21.2/1.21.3 answer teleports with pos-rot *before* accept-teleportation
    relativeTeleportVelocity: at('1.21.2'), // teleport packet carries delta movement + delta flags
    lpVelocity: at('1.21.9'), // entity_velocity uses lpVec3 (already blocks/tick)
    // physics
    posFromBoundingBox: !at('1.17'), // 1.16 recalculates the position from the bounding box centre
    flyingSpeedLive: at('1.19.4'), // Player#getFlyingSpeed() instead of the lagging flyingSpeed field
    minorCollision: at('1.19.4'), // sprinting survives "minor" horizontal collisions
    supportingBlock: at('1.20'), // mainSupportingBlockPos drives the block below
    attributes2005: at('1.20.5'), // gravity / step_height / jump_strength attributes
    jumpKeepsHigherY: at('1.21'),
    modernStepUp: at('1.21'), // collectCandidateStepUpHeights step algorithm
    normalizedInput: at('1.21.2'), // KeyboardInput#moveVector is normalized
    modernBackOff: at('1.21.2'), // canFallAtLeast based sneak edge back-off
    squareInput: at('1.21.5'), // modifyInputSpeedForSquareMovement
    fallDistanceDouble: at('1.21.5'),
    // vehicles
    moveVehicleOnGround: at('1.21.2')
  }
}

module.exports = { versionFlags, PV }
