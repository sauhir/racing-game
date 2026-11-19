import { clamp, wrapAngle } from '../core/math';
import type { Car } from './car';
import { applyHit, type HitResult } from './damage';
import type { ItemType } from './items';
import type { Track } from './track';

export interface Missile {
  x: number;
  y: number;
  prevX: number;
  prevY: number;
  heading: number;
  owner: Car;
  target: Car | null;
  life: number;
  sampleIdx: number;
}

export interface Hazard {
  kind: 'mine' | 'oil';
  x: number;
  y: number;
  owner: Car;
  age: number;
}

export type WeaponEvent =
  | { type: 'explosion'; x: number; y: number }
  | { type: 'shockwave'; x: number; y: number }
  | { type: 'oiled'; car: Car }
  | { type: 'struck'; car: Car; by: Car; result: HitResult; weapon: 'missile' | 'mine' | 'shockwave' };

export const WEAPON = {
  missileSpeed: 78,
  missileTurn: 4.5,
  missileLife: 6,
  missileRange: 260,
  blastRadius: 5.5,
  blastDamage: 0.4,
  blastSpin: 1.1,
  blastKick: 9,
  mineTrigger: 2.7,
  mineLife: 45,
  mineDamage: 0.45,
  oilRadius: 3.3,
  oilLife: 14,
  oilTime: 1.6,
  /** Dropped hazards ignore everyone briefly, so the dropper drives clear. */
  armDelay: 0.7,
  shieldTime: 8,
  shockRadius: 14,
  shockKick: 24,
  shockDamage: 0.12,
  shockSpin: 0.6,
};

/** Live weapon entities and the rules for using and resolving them. */
export class Weapons {
  readonly missiles: Missile[] = [];
  readonly hazards: Hazard[] = [];

  /** Uses up the car's held item. */
  use(car: Car, cars: readonly Car[], track: Track): WeaponEvent[] {
    const item: ItemType | null = car.item;
    car.item = null;
    const ch = Math.cos(car.heading);
    const sh = Math.sin(car.heading);
    switch (item) {
      case 'missile': {
        const x = car.x + ch * 3;
        const y = car.y + sh * 3;
        this.missiles.push({
          x, y, prevX: x, prevY: y, heading: car.heading, owner: car,
          target: pickTarget(car, cars, track), life: WEAPON.missileLife, sampleIdx: car.sampleIdx,
        });
        return [];
      }
      case 'mine':
      case 'oil':
        this.hazards.push({ kind: item, x: car.x - ch * 3.6, y: car.y - sh * 3.6, owner: car, age: 0 });
        return [];
      case 'shield':
        car.shield = WEAPON.shieldTime;
        return [];
      case 'nitro':
        car.boost = 1;
        return [];
      case 'shockwave':
        return this.shockwave(car, cars);
      default:
        return [];
    }
  }

  private shockwave(car: Car, cars: readonly Car[]): WeaponEvent[] {
    const events: WeaponEvent[] = [{ type: 'shockwave', x: car.x, y: car.y }];
    for (const o of cars) {
      if (o === car) continue;
      const dx = o.x - car.x;
      const dy = o.y - car.y;
      const d = Math.hypot(dx, dy);
      if (d > WEAPON.shockRadius) continue;
      const near = 1 - d / WEAPON.shockRadius;
      const result = applyHit(o, WEAPON.shockDamage, d < 8 ? WEAPON.shockSpin : 0, dx * car.vy - dy * car.vx);
      if (result === 'none') continue;
      if (result === 'hit') {
        const kick = 6 + WEAPON.shockKick * near;
        o.vx += (dx / (d || 1)) * kick;
        o.vy += (dy / (d || 1)) * kick;
      }
      events.push({ type: 'struck', car: o, by: car, result, weapon: 'shockwave' });
    }
    return events;
  }

  private explode(
    x: number, y: number, damage: number, by: Car, immune: Car | null, weapon: 'missile' | 'mine',
    cars: readonly Car[], events: WeaponEvent[],
  ): void {
    events.push({ type: 'explosion', x, y });
    for (const o of cars) {
      if (o === immune) continue;
      const dx = o.x - x;
      const dy = o.y - y;
      const d = Math.hypot(dx, dy);
      if (d > WEAPON.blastRadius) continue;
      const near = 1 - d / (WEAPON.blastRadius * 1.6);
      const result = applyHit(o, damage * near, d < 3.6 ? WEAPON.blastSpin : 0, dx * o.vy - dy * o.vx);
      if (result === 'none') continue;
      if (result === 'hit') {
        o.vx = o.vx * 0.55 + (dx / (d || 1)) * WEAPON.blastKick * near;
        o.vy = o.vy * 0.55 + (dy / (d || 1)) * WEAPON.blastKick * near;
      }
      events.push({ type: 'struck', car: o, by, result, weapon });
    }
  }

  step(dt: number, cars: readonly Car[], track: Track): WeaponEvent[] {
    const events: WeaponEvent[] = [];

    for (let i = this.missiles.length - 1; i >= 0; i--) {
      const m = this.missiles[i];
      m.prevX = m.x;
      m.prevY = m.y;
      m.life -= dt;
      if (m.target && (m.target.wrecked > 0 || m.target.finished)) m.target = null;

      // Follow the road until the target is close, then go straight for it.
      let ax: number;
      let ay: number;
      const t = m.target;
      if (t && (t.x - m.x) ** 2 + (t.y - m.y) ** 2 < 45 * 45) {
        ax = t.x;
        ay = t.y;
      } else {
        const s = track.sample(m.sampleIdx + 9);
        const lane = t ? clamp(t.lat, -track.halfWidth, track.halfWidth) * 0.6 : 0;
        ax = s.x + s.nx * lane;
        ay = s.y + s.ny * lane;
      }
      const turn = wrapAngle(Math.atan2(ay - m.y, ax - m.x) - m.heading);
      m.heading += clamp(turn, -WEAPON.missileTurn * dt, WEAPON.missileTurn * dt);
      m.x += Math.cos(m.heading) * WEAPON.missileSpeed * dt;
      m.y += Math.sin(m.heading) * WEAPON.missileSpeed * dt;
      m.sampleIdx = track.nearest(m.x, m.y, m.sampleIdx);

      let boom = m.life <= 0 || Math.abs(track.lateral(m.sampleIdx, m.x, m.y)) > track.wallDist - 0.6;
      for (const o of cars) {
        if (o === m.owner || o.wrecked > 0) continue;
        if ((o.x - m.x) ** 2 + (o.y - m.y) ** 2 < 2.8 * 2.8) boom = true;
      }
      if (boom) {
        this.missiles.splice(i, 1);
        this.explode(m.x, m.y, WEAPON.blastDamage, m.owner, m.owner, 'missile', cars, events);
      }
    }

    for (let i = this.hazards.length - 1; i >= 0; i--) {
      const h = this.hazards[i];
      h.age += dt;
      if (h.age > (h.kind === 'mine' ? WEAPON.mineLife : WEAPON.oilLife)) {
        this.hazards.splice(i, 1);
        continue;
      }
      if (h.age < WEAPON.armDelay) continue;
      const radius = h.kind === 'mine' ? WEAPON.mineTrigger : WEAPON.oilRadius;
      for (const o of cars) {
        if (o.wrecked > 0 || o.finished || o.invulnerable > 0) continue;
        if ((o.x - h.x) ** 2 + (o.y - h.y) ** 2 > radius * radius) continue;
        if (h.kind === 'mine') {
          this.hazards.splice(i, 1);
          this.explode(h.x, h.y, WEAPON.mineDamage, h.owner, null, 'mine', cars, events);
          break;
        }
        if (o.oiled <= 0 && o.shield <= 0 && o.speed > 8) {
          o.oiled = WEAPON.oilTime;
          events.push({ type: 'oiled', car: o });
        }
      }
    }
    return events;
  }
}

/** The nearest car ahead on the road, within missile range. */
function pickTarget(car: Car, cars: readonly Car[], track: Track): Car | null {
  let best: Car | null = null;
  let bestGap = WEAPON.missileRange;
  for (const o of cars) {
    if (o === car || o.wrecked > 0 || o.finished) continue;
    let gap = (o.progress - car.progress) % track.length;
    if (gap < 0) gap += track.length;
    if (gap > 1 && gap < bestGap) {
      bestGap = gap;
      best = o;
    }
  }
  return best;
}
