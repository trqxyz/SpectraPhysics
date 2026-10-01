'use strict'
// Client behaviour that changed between 1.16.5 and 26.x, keyed by protocol number
// ("1.21.3" is 768, the same as 1.21.2).

const PV = {
  '1.16.5': 754,
  '1.17': 755,
  '1.18.2': 758,
  '1.19.4': 762,
  '1.20': 763,
  '1.20.2': 764,
  '1.20.5': 766,
  '1.21': 767,
  '1.21.2': 768,
  '1.21.4': 769,
  '1.21.5': 770,
  '1.21.6': 771,
  '1.21.9': 773,
  '26.1': 775
}

function versionFlags (registry) {
  const pv = registry.version.version
  const at = (name) => pv >= PV[name]
  return {
    protocol: pv,
    name: registry.version.minecraftVersion,

    // connection
    configPhase: at('1.20.2'),
    movementFlags: at('1.21.2'),
    tickEnd: at('1.21.2'),
    playerInputPacket: at('1.21.2'),
    shiftInInput: at('1.21.6'),
    clientLoaded: at('1.21.4'),
    posRotBeforeConfirm: pv === PV['1.21.2'],
    relativeTeleportVelocity: at('1.21.2'),
    lpVelocity: at('1.21.9'),
    pointThree: !at('1.18.2'), // position is only reported after moving 0.03 (later 0.0002)

    // input
    inputModel: at('1.21.5') ? 'modern' : 'legacy',
    floatSqrt: !at('1.17'),
    normalizeEpsilon: at('1.21.2') ? Math.fround(1.0e-5) : 1.0e-4,
    horizontalThreshold: at('1.21.5'), // tiny horizontal speed is cut by length, not per axis

    // movement
    posFromBoundingBox: !at('1.17'),
    epsilonCollisionFlags: at('1.18.2'),
    keepsXOnCornerCollision: !at('1.18.2'), // 1.14 - 1.18.1 bug
    modernMoveThreshold: at('1.21.2'),
    modernStepUp: at('1.21'),
    supportingBlock: at('1.20'),
    minorCollision: at('1.19.4'),
    fallDistanceDouble: at('1.21.5'),

    // speed
    flyingSpeedLive: at('1.19.4'),
    airSprintFloatSum: at('1.18.2'),
    attributes2005: at('1.20.5'),
    efficiencyAttributes: at('1.21'), // movement_efficiency / water_movement_efficiency
    soulSpeedBoots: pv >= 751 && !at('1.21'),
    jumpDoubleSprintBoost: at('1.20.5'),
    jumpKeepsHigherY: at('1.21.2'),

    // world interaction
    blockEffectsAfterTravel: at('1.21.2'),
    blockEffectsPerAxis: at('1.21.5'),
    insideBlockDeflate: at('1.19.4') ? 1.0e-5 : 0.001,
    fluidRecheckInMove: pv !== PV['1.21.4'],
    fluidInteraction: at('26.1'), // one pass over water and lava, also used by the recheck in move
    swimmingNeedsFeetInWater: at('1.17'),
    powderSnow: at('1.17'),

    // vehicles
    moveVehicleOnGround: at('1.21.2')
  }
}

module.exports = { versionFlags, PV }
