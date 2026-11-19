import { clamp, lerpAngle, wrapAngle } from '../core/math';
import { Car, TUNING } from './car';
import type { Track } from './track';

const RESTITUTION = 0.35;

/** Circle-vs-circle car collision. Returns the closing speed of the impact, or 0. */
export function collideCars(a: Car, b: Car): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const min = TUNING.radius * 1.9;
  const d2 = dx * dx + dy * dy;
  if (d2 >= min * min) return 0;
  const d = Math.sqrt(d2) || 0.001;
  const nx = dx / d;
  const ny = dy / d;
  const push = (min - d) / 2;
  a.x -= nx * push;
  a.y -= ny * push;
  b.x += nx * push;
  b.y += ny * push;
  const rv = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
  if (rv >= 0) return 0;
  const j = (-(1 + RESTITUTION) * rv) / 2;
  a.vx -= j * nx;
  a.vy -= j * ny;
  b.vx += j * nx;
  b.vy += j * ny;
  return -rv;
}

/**
 * Keeps a car inside the walls that run parallel to the track. Uses car.sampleIdx
 * and car.lat, so call it after progress has been updated. Returns impact speed.
 */
export function collideWall(car: Car, track: Track): number {
  const limit = track.wallDist - TUNING.radius * 0.8;
  const over = Math.abs(car.lat) - limit;
  if (over <= 0) return 0;
  const s = track.samples[car.sampleIdx];
  const side = Math.sign(car.lat);
  const nx = s.nx * side;
  const ny = s.ny * side;
  car.x -= nx * over;
  car.y -= ny * over;
  car.lat = side * limit;
  const vn = car.vx * nx + car.vy * ny;
  if (vn <= 0) return 0;
  car.vx -= (1 + 0.2) * vn * nx;
  car.vy -= (1 + 0.2) * vn * ny;
  const keep = 1 - clamp(vn / 70, 0.02, 0.45);
  car.vx *= keep;
  car.vy *= keep;
  // Glance the nose back along the wall so nobody gets pinned against it.
  const along = car.vx * s.tx + car.vy * s.ty;
  const wallHeading = Math.atan2(s.ty, s.tx) + (along < 0 ? Math.PI : 0);
  if (Math.abs(wrapAngle(wallHeading - car.heading)) < Math.PI * 0.6) {
    car.heading = lerpAngle(car.heading, wallHeading, clamp(vn / 25, 0.05, 0.35));
  }
  return vn;
}
