import { clamp, wrapAngle } from '../../core/math';
import type { Rng } from '../../core/rng';
import type { Personality } from '../../data/rivals';
import type { Car, CarInput } from '../car';
import type { PickupBox } from '../items';
import type { Track } from '../track';
import type { Missile } from '../weapons';

/** The parts of the combat state a CPU driver pays attention to. */
export interface AIWorld {
  boxes: readonly PickupBox[];
  missiles: readonly Missile[];
}

const BRAKE_DECEL = 30;

/**
 * CPU driver. Looks at the track ahead and produces the same inputs a human
 * would, so CPU cars obey exactly the same physics as the player.
 */
export class AIDriver {
  private wander = 0;
  private wanderTarget = 0;
  private wanderTimer = 0;
  private avoid = 0;
  private mistake = 0;
  private drifting = 0;
  private itemHeld = 0;

  constructor(
    readonly personality: Personality,
    private readonly rng: Rng,
  ) {}

  update(car: Car, track: Track, others: readonly Car[], dt: number, world?: AIWorld): CarInput {
    const p = this.personality;
    const sp = track.spacing;
    const speed = car.speed;

    // Slow drift across the road so the pack does not drive in single file.
    this.wanderTimer -= dt;
    if (this.wanderTimer <= 0) {
      this.wanderTimer = 2 + this.rng() * 3;
      this.wanderTarget = (this.rng() * 2 - 1) * (1.2 + (1 - p.skill) * 3);
    }
    this.wander += (this.wanderTarget - this.wander) * Math.min(1, dt);

    // Occasionally misjudge a corner.
    if (this.mistake > 0) this.mistake -= dt;
    else if (this.rng() < p.errorRate * dt) this.mistake = 0.6 + this.rng() * 0.8;

    // Move aside for cars just ahead; aggressive drivers barely bother.
    let avoid = 0;
    for (const o of others) {
      if (o === car) continue;
      let gap = o.progress - car.progress;
      if (gap > track.length / 2) gap -= track.length;
      if (gap <= 0 || gap > 18) continue;
      const dl = o.lat - car.lat;
      if (Math.abs(dl) > 3.6) continue;
      avoid += (dl >= 0 ? -1 : 1) * (3.6 - Math.abs(dl)) * (1 - gap / 18) * (1.6 - p.aggression);
    }
    this.avoid += (clamp(avoid, -4, 4) - this.avoid) * Math.min(1, 5 * dt);

    // Steer at a point on the racing line some way ahead.
    const look = 9 + speed * 0.42;
    const target = track.sample(car.sampleIdx + Math.round(look / sp));
    const maxOff = target.hw - 1.8;
    const box = world && !car.item && !car.finished ? this.boxAhead(car, track, world.boxes) : null;
    const lane = box ?? target.line * (0.5 + 0.5 * p.skill) + this.wander;
    const offset = clamp(lane + this.avoid * (box === null ? 1 : 0.4), -maxOff, maxOff);
    const want = Math.atan2(target.y + target.ny * offset - car.y, target.x + target.nx * offset - car.x);
    const diff = wrapAngle(want - car.heading);
    const steer = clamp(diff * 2.4, -1, 1);

    // Brake for the tightest thing inside the stopping horizon.
    const lateral = (24 + 14 * p.skill) * (this.mistake > 0 ? 1.5 : 1);
    const horizon = Math.ceil((20 + speed * 2.2) / sp);
    let allowed = Infinity;
    for (let j = 0; j <= horizon; j += 2) {
      const c = Math.abs(track.sample(car.sampleIdx + j).curv);
      if (c < 1e-4) continue;
      const v = Math.sqrt(lateral / c + 2 * BRAKE_DECEL * j * sp);
      if (v < allowed) allowed = v;
    }

    let throttle = speed < allowed ? 1 : 0;
    const brake = speed > allowed + 1.5 ? clamp((speed - allowed) / 8, 0.3, 1) : 0;
    if (Math.abs(diff) > 1.2) throttle *= 0.5;

    // Flick the handbrake into corners for style and boost charge.
    if (this.drifting > 0) this.drifting -= dt;
    else if (speed > 20 && Math.abs(diff) > 0.42 - 0.12 * p.drift && !car.offroad && this.rng() < p.drift * 6 * dt) {
      this.drifting = 0.25 + 0.25 * p.drift;
    }
    const handbrake = this.drifting > 0 && Math.abs(diff) > 0.2;

    const boost =
      (car.boosting || car.boost >= p.boostAt) && allowed > speed + 6 && Math.abs(diff) < 0.2 && !car.offroad;

    let useItem = false;
    if (car.item && world) {
      this.itemHeld += dt;
      if (this.itemHeld > 0.6 + (1 - p.itemUse) * 2.5) {
        useItem = this.wantsToUse(car, track, others, world, allowed > speed + 6 && Math.abs(diff) < 0.2);
      }
    } else {
      this.itemHeld = 0;
    }

    return { throttle, brake, steer, handbrake, boost, useItem };
  }

  /** Lateral position of a mystery box coming up that is worth lining up for. */
  private boxAhead(car: Car, track: Track, boxes: readonly PickupBox[]): number | null {
    const s = track.samples[car.sampleIdx];
    let best: number | null = null;
    let bestShift = Infinity;
    for (const b of boxes) {
      if (b.respawn > 0.5) continue;
      const dx = b.x - car.x;
      const dy = b.y - car.y;
      const ahead = dx * s.tx + dy * s.ty;
      if (ahead < 10 || ahead > 60) continue;
      const shift = dx * s.nx + dy * s.ny;
      if (Math.abs(shift) < bestShift) {
        bestShift = Math.abs(shift);
        best = car.lat + shift;
      }
    }
    return bestShift < 9 ? best : null;
  }

  private wantsToUse(car: Car, track: Track, others: readonly Car[], world: AIWorld, straight: boolean): boolean {
    const gapTo = (o: Car): number => {
      let gap = (o.progress - car.progress) % track.length;
      if (gap > track.length / 2) gap -= track.length;
      else if (gap < -track.length / 2) gap += track.length;
      return gap;
    };
    const rivals = others.filter((o) => o !== car && o.wrecked <= 0 && !o.finished);
    switch (car.item) {
      case 'missile':
        return this.itemHeld > 12 || rivals.some((o) => gapTo(o) > 10 && gapTo(o) < 140);
      case 'mine':
      case 'oil':
        return (
          this.itemHeld > 10 ||
          rivals.some((o) => gapTo(o) < -4 && gapTo(o) > -24 && Math.abs(o.lat - car.lat) < 5)
        );
      case 'shockwave':
        return rivals.some((o) => (o.x - car.x) ** 2 + (o.y - car.y) ** 2 < 100);
      case 'shield':
        return (
          this.itemHeld > 4 + 8 * (1 - this.personality.itemUse) ||
          world.missiles.some((m) => m.target === car && (m.x - car.x) ** 2 + (m.y - car.y) ** 2 < 70 * 70)
        );
      case 'nitro':
        return straight && car.boost < 0.4;
      default:
        return false;
    }
  }
}
