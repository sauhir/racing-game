import { TAU, wrapAngle } from '../core/math';
import type { Car } from './car';

export const WRECK_TIME = 2;
export const RESPAWN_IMMUNITY = 2;
export const REPAIR_AMOUNT = 0.5;

/** Closing speed (m/s) below which a crash is just a bump. */
const IMPACT_THRESHOLD = 18;

export type HitResult = 'none' | 'blocked' | 'hit' | 'wreck';

/**
 * Applies a weapon hit. A shield soaks up one hit and pops; wrecked, freshly
 * respawned and finished cars are immune.
 */
export function applyHit(car: Car, damage: number, spin: number, spinDir = 1): HitResult {
  if (car.wrecked > 0 || car.invulnerable > 0 || car.finished) return 'none';
  if (car.shield > 0) {
    car.shield = 0;
    return 'blocked';
  }
  if (spin > car.spin) {
    // Whole turns only, so the car comes out of the spin facing the way it went in.
    const home = car.spin > 0 ? car.spinHome : car.heading;
    const turns = Math.max(1, Math.round(spin * 1.6));
    car.spinHome = home;
    car.spinRate = ((spinDir >= 0 ? 1 : -1) * TAU * turns + wrapAngle(home - car.heading)) / spin;
    car.spin = spin;
  }
  return hurt(car, damage);
}

/** Damage from a hard crash. A shield shrugs these off without popping. */
export function applyImpact(car: Car, closingSpeed: number): HitResult {
  if (closingSpeed <= IMPACT_THRESHOLD) return 'none';
  if (car.wrecked > 0 || car.invulnerable > 0 || car.finished || car.shield > 0) return 'none';
  return hurt(car, Math.min(0.2, (closingSpeed - IMPACT_THRESHOLD) / 150));
}

function hurt(car: Car, damage: number): HitResult {
  car.health -= damage * car.stats.armour;
  if (car.health > 0.0001) return 'hit';
  car.health = 0;
  car.wrecked = WRECK_TIME;
  car.vx = car.vy = car.angVel = 0;
  car.spin = car.oiled = car.shield = 0;
  car.boosting = car.drifting = false;
  car.slide = 0;
  car.item = null;
  return 'wreck';
}

export function repair(car: Car): void {
  car.health = Math.min(1, car.health + REPAIR_AMOUNT);
}
