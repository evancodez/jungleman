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

  runSpeed: 10.5,
  accel: 32,
  decel: 44,
  turnLow: 16,
  turnHigh: 5.0,
  overDecay: 2.2,
  skidDot: -0.5,
  skidMinSpeed: 7,
  skidDecel: 42,

  airAccel: 18,
  airBaseMax: 8.5,

  stepHeight: 0.5,
  snapDown: 0.55,

  slideMin: 5.0,
  slideFriction: 2.2,
  slideSteer: 2.6,
  slopeAccel: 17,
  slideJumpBoost: 1.12,

  grindGravity: 12,
  grindFriction: 0.05,
  grindMax: 24,
  grindJump: 10.8,

  swingPump: 12,
  swingMax: 26,
  swingReleaseUp: 5.0,
  swingReleaseMult: 1.08,

  wallRunGravity: 0.42,
  wallRunTime: 1.2,
  trunkRunGravity: 0.55,
  climbUp: 3.4,
  climbDown: 5.5,
  climbSide: 3.2,
  climbLeap: 10,
  wallKick: 8,
  wallKickUp: 10.5,

  swimSpeed: 4.2,
  maxSpeed: 34,
};
