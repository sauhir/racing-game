import { clamp, lerp } from '../core/math';
import type { ItemType } from './items';

export interface CarInput {
  /** 0..1 */
  throttle: number;
  /** 0..1; reverses once the car has stopped. */
  brake: number;
  /** -1..1; positive steers towards increasing heading. */
  steer: number;
  handbrake: boolean;
  boost: boolean;
  /** Fires the held item on the press (edge), not while held. */
  useItem: boolean;
}

export const NO_INPUT: CarInput = { throttle: 0, brake: 0, steer: 0, handbrake: false, boost: false, useItem: false };

/** Every handling tunable in one place. Units are metres and seconds. */
export const TUNING = {
  maxSpeed: 46,
  accel: 24,
  brake: 48,
  reverseSpeed: 12,
  coastDrag: 0.5,
  /** Yaw rate (rad/s) at low speed; scaled down to highSpeedTurn at top speed. */
  turnRate: 2.7,
  highSpeedTurn: 0.62,
  steerResponse: 9,
  /** Lateral velocity damping per second when gripping / drifting. */
  grip: 5,
  driftGrip: 3,
  driftTurnBonus: 1.6,
  /** Sideways speed (m/s) at which the tyres let go, and at which they bite again. */
  driftEnterSlip: 6,
  driftExitSlip: 2.5,
  /** Slip angle (rad) a drift settles at with the steering held; stops spins. */
  driftMaxAngle: 1,
  handbrakeMinSpeed: 10,
  handbrakeDrag: 0.3,
  /** Share of the speed scrubbed off by sliding that is handed back, keeping drifts fast. */
  driftSpeedKeep: 0.35,
  offroadSpeed: 0.55,
  boostSpeed: 1.28,
  boostAccel: 2.2,
  boostDrain: 0.4,
  boostMinStart: 0.15,
  boostCharge: 0.22,
  boostChargeMinSpeed: 15,
  radius: 1.7,
};

export interface CarStats {
  maxSpeed: number;
  accel: number;
  turnRate: number;
  grip: number;
  /** Multiplier on damage taken: below 1 is tougher, above 1 more fragile. */
  armour: number;
  /** Multipliers from upgrades: off-road top speed, boost charge rate, boost burn rate. */
  offroad: number;
  boostCharge: number;
  boostDrain: number;
}

const GRAVITY = 26;
/** How long a boost pad keeps pushing after the car leaves it. */
export const PAD_TIME = 1;

export const BASE_STATS: CarStats = {
  maxSpeed: TUNING.maxSpeed,
  accel: TUNING.accel,
  turnRate: TUNING.turnRate,
  grip: TUNING.grip,
  armour: 1,
  offroad: 1,
  boostCharge: 1,
  boostDrain: 1,
};

export class Car {
  x = 0;
  y = 0;
  heading = 0;
  vx = 0;
  vy = 0;
  angVel = 0;

  prevX = 0;
  prevY = 0;
  prevHeading = 0;

  /** Boost meter, 0..1. */
  boost = 0;
  boosting = false;
  drifting = false;
  /** 0..1, how hard the car is sliding (drives smoke, skids, tyre noise). */
  slide = 0;
  throttle = 0;

  /** Height above the road and vertical speed (jumps). */
  z = 0;
  vz = 0;
  prevZ = 0;
  /** Visual-only height while driving up a ramp. */
  lift = 0;
  /** Seconds of boost-pad push left. */
  pad = 0;
  /** Track surface: road grip multiplier and off-road top-speed factor. */
  gripScale = 1;
  offroadSpeed = TUNING.offroadSpeed;
  /** Body style, used by the renderer. */
  model = 'bubble';

  /** 0..1; at zero the car is wrecked and respawns. */
  health = 1;
  item: ItemType | null = null;
  usePrev = false;
  /** Seconds of shield bubble left. */
  shield = 0;
  /** Seconds left of an uncontrolled spin-out. */
  spin = 0;
  /** Yaw rate of the spin, chosen so it ends facing spinHome (the original heading). */
  spinRate = 0;
  spinHome = 0;
  /** Seconds left sliding on oil. */
  oiled = 0;
  /** Seconds until a wrecked car respawns (0 = alive). */
  wrecked = 0;
  /** Seconds of post-respawn immunity left. */
  invulnerable = 0;

  /** Multiplier on top speed (CPU skill and rubber-banding). */
  speedScale = 1;

  // Race bookkeeping, maintained by Race.
  sampleIdx = 0;
  lap = 0;
  lat = 0;
  progress = 0;
  offroad = false;
  finished = false;
  finishTime = 0;
  stuckTime = 0;

  constructor(
    readonly id: number,
    readonly name: string,
    readonly color: number,
    readonly isPlayer: boolean,
    readonly stats: CarStats = BASE_STATS,
  ) {}

  get speed(): number {
    return Math.hypot(this.vx, this.vy);
  }

  /** Speed along the direction the car points (negative when reversing). */
  get forwardSpeed(): number {
    return this.vx * Math.cos(this.heading) + this.vy * Math.sin(this.heading);
  }

  place(x: number, y: number, heading: number): void {
    this.x = this.prevX = x;
    this.y = this.prevY = y;
    this.heading = this.prevHeading = heading;
    this.vx = this.vy = this.angVel = 0;
    this.drifting = this.boosting = false;
    this.slide = 0;
    this.spin = this.oiled = 0;
    this.z = this.prevZ = this.vz = this.lift = this.pad = 0;
  }

  get airborne(): boolean {
    return this.z > 0 || this.vz > 0;
  }

  step(inp: CarInput, dt: number): void {
    const T = TUNING;
    const st = this.stats;
    this.prevX = this.x;
    this.prevY = this.y;
    this.prevHeading = this.heading;

    this.prevZ = this.z;

    if (this.wrecked > 0) return;
    this.shield = Math.max(0, this.shield - dt);
    this.pad = Math.max(0, this.pad - dt);

    // In the air there is no grip, steering or drive: the car just flies.
    if (this.airborne) {
      this.vz -= GRAVITY * dt;
      this.z += this.vz * dt;
      if (this.z <= 0) this.z = this.vz = 0;
      this.angVel *= Math.exp(-3 * dt);
      this.heading += this.angVel * dt;
      this.x += this.vx * dt;
      this.y += this.vy * dt;
      this.slide = 0;
      return;
    }

    this.oiled = Math.max(0, this.oiled - dt);
    this.invulnerable = Math.max(0, this.invulnerable - dt);
    const spinning = this.spin > 0;
    if (spinning) {
      this.spin = Math.max(0, this.spin - dt);
      inp = NO_INPUT;
    }

    const ch = Math.cos(this.heading);
    const sh = Math.sin(this.heading);
    let vf = this.vx * ch + this.vy * sh;
    let vl = -this.vx * sh + this.vy * ch;
    const speedBefore = Math.hypot(vf, vl);

    // Boost: needs a minimum charge to light, then burns until released or empty.
    if (inp.boost && this.boost > 0 && (this.boosting || this.boost >= T.boostMinStart)) {
      this.boosting = true;
      this.boost = Math.max(0, this.boost - T.boostDrain * st.boostDrain * dt);
      if (this.boost === 0) this.boosting = false;
    } else {
      this.boosting = false;
    }

    // Damage costs up to 12% of top speed.
    let top = st.maxSpeed * this.speedScale * (0.88 + 0.12 * this.health);
    let acc = st.accel;
    if (this.boosting || this.pad > 0) {
      top *= T.boostSpeed;
      acc *= T.boostAccel;
    }
    if (this.offroad) top *= Math.min(0.9, this.offroadSpeed * st.offroad);

    const throttle = clamp(inp.throttle, 0, 1);
    const brake = clamp(inp.brake, 0, 1);
    this.throttle = throttle;
    if (throttle > 0 && vf < top) {
      const ratio = Math.max(vf, 0) / top;
      vf = Math.min(top, vf + acc * throttle * (1 - 0.7 * ratio * ratio) * dt);
    }
    if (vf > top) vf -= (vf - top) * 1.8 * dt;
    if (brake > 0) {
      if (vf > 0.5) vf = Math.max(0, vf - T.brake * brake * dt);
      else vf = Math.max(-T.reverseSpeed, vf - acc * 0.6 * brake * dt);
    }
    if (throttle === 0 && brake === 0) vf -= vf * T.coastDrag * dt;

    // Steering: yaw rate fades in from standstill and eases off at speed.
    const steer = clamp(inp.steer, -1, 1) * (this.oiled > 0 ? 0.35 : 1);
    const speedFactor =
      clamp(Math.abs(vf) / 6, 0, 1) * lerp(1, T.highSpeedTurn, clamp(Math.abs(vf) / st.maxSpeed, 0, 1));
    let yawTarget = steer * st.turnRate * speedFactor * (vf < 0 ? -1 : 1);

    const handbrake = inp.handbrake && speedBefore > T.handbrakeMinSpeed;
    if (!this.drifting) {
      if ((handbrake && Math.abs(steer) > 0.2) || Math.abs(vl) > T.driftEnterSlip) this.drifting = true;
    } else if (!handbrake && Math.abs(vl) < T.driftExitSlip) {
      this.drifting = false;
    }
    if (this.oiled > 0) {
      // On oil the tyres let go and the car snakes about.
      this.drifting = true;
      yawTarget += Math.sin(this.oiled * 11) * 1.3 * speedFactor;
    }
    if (spinning) this.drifting = true;
    if (this.drifting) {
      yawTarget *= T.driftTurnBonus;
      // Steering deeper into the slide fades out near the maximum slip angle, so
      // simply holding the key gives a steady, controllable drift.
      if (yawTarget * vl < 0 && vf > 0) {
        const maxAngle = T.driftMaxAngle * (handbrake ? 1.35 : 1);
        yawTarget *= clamp(1 - Math.abs(Math.atan2(vl, vf)) / maxAngle, 0, 1);
      }
    }
    if (handbrake) vf -= vf * T.handbrakeDrag * dt;

    this.angVel += (yawTarget - this.angVel) * Math.min(1, T.steerResponse * dt);
    if (spinning) {
      this.angVel = this.spinRate;
      vf -= vf * 1.2 * dt;
    }
    this.heading += this.angVel * dt;

    // Tyres: sideways velocity bleeds away quickly with grip, slowly in a drift.
    const vlBefore = vl;
    vl *= Math.exp(-(this.drifting ? T.driftGrip : st.grip) * this.gripScale * dt);
    if (this.drifting && vf > 0) {
      const lost = Math.hypot(vf, vlBefore) - Math.hypot(vf, vl);
      vf += lost * T.driftSpeedKeep;
    }

    this.slide = clamp((Math.abs(vl) - 2) / 10, 0, 1);
    // Only real, moving drifts charge boost; no farming it with donuts.
    if (this.drifting && Math.abs(vl) > 3 && speedBefore > T.boostChargeMinSpeed && !this.offroad
      && this.spin <= 0 && this.oiled <= 0) {
      this.boost = Math.min(1, this.boost + T.boostCharge * st.boostCharge * clamp(Math.abs(vl) / 12, 0.3, 1) * dt);
    }

    // Recompose with the pre-turn basis: the body rotates, the momentum does not.
    this.vx = vf * ch - vl * sh;
    this.vy = vf * sh + vl * ch;
    this.x += this.vx * dt;
    this.y += this.vy * dt;
  }
}
