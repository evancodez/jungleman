// Movement tuning. Everything that defines the "feel" lives here.
export const P = {
  radius: 0.36,
  height: 1.8,
  crouchHeight: 1.05,
  handHeight: 2.05, // hands above feet when hanging

  gravity: 32,
  maxFall: 45,
  jumpVel: 11.2,
  jumpCutGravity: 2.4,
  coyote: 0.13,
  jumpBuffer: 0.15,
  skidJumpVel: 13.5,

  runSpeed: 11,
  accel: 40,
  decel: 44,
  turnLow: 16,
  turnHigh: 6.5,
  overDecay: 2.2,
  skidDot: -0.5,
  skidMinSpeed: 7,
  skidDecel: 42,

  airAccel: 22,
  airBaseMax: 9.5,

  stepHeight: 0.5,
  snapDown: 0.55,

  slideMin: 5.0,
  slideFriction: 2.2,
  slideSteer: 2.6,
  slopeAccel: 17,
  slideJumpBoost: 1.12,

  runMaxSlope: 0.6, // steeper rails always grind
  grindGravity: 12,
  grindFriction: 0.05,
  grindMax: 24,
  grindJump: 10.8,

  swingPump: 7,
  swingMax: 18,
  swingCatchMax: 15,
  swingReleaseUp: 4.8,
  swingReleaseMult: 1.04,

  wallRunGravity: 0.42,
  wallRunTime: 1.2,
  trunkRunGravity: 0.55,
  climbUp: 5.2,
  climbDown: 7,
  climbSide: 4.2,
  climbLeap: 11.5,
  wallKick: 8,
  wallKickUp: 10.5,

  vineCatch: 0.95, // touching a vine within this distance catches it
  airAssist: 9, // m/s^2 nudge toward a branch/vine you're flying at

  swimSpeed: 4.2,
  maxSpeed: 34,
};
