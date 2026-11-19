import { describe, expect, it } from 'vitest';
import { MEADOW } from '../src/data/tracks/meadow';
import { Car, TUNING } from '../src/sim/car';
import { collideCars, collideWall } from '../src/sim/collision';
import { Track } from '../src/sim/track';

describe('collisions', () => {
  it('separates overlapping cars and conserves momentum', () => {
    const a = new Car(0, 'A', 0, false);
    const b = new Car(1, 'B', 0, false);
    a.place(0, 0, 0);
    b.place(2, 0, 0);
    a.vx = 20;
    b.vx = 5;
    const impact = collideCars(a, b);
    expect(impact).toBeCloseTo(15, 6);
    expect(Math.hypot(b.x - a.x, b.y - a.y)).toBeCloseTo(TUNING.radius * 1.9, 6);
    expect(a.vx + b.vx).toBeCloseTo(25, 6);
    expect(b.vx).toBeGreaterThan(a.vx);
  });

  it('ignores cars that are apart or already separating', () => {
    const a = new Car(0, 'A', 0, false);
    const b = new Car(1, 'B', 0, false);
    a.place(0, 0, 0);
    b.place(10, 0, 0);
    expect(collideCars(a, b)).toBe(0);
    b.place(2, 0, 0);
    b.vx = 10;
    expect(collideCars(a, b)).toBe(0);
    expect(b.vx).toBe(10);
  });

  it('keeps a car inside the wall and bounces it back', () => {
    const track = new Track(MEADOW);
    const i = 30;
    const s = track.samples[i];
    const car = new Car(0, 'A', 0, false);
    const lat = track.wallDist + 1;
    car.place(s.x + s.nx * lat, s.y + s.ny * lat, Math.atan2(s.ny, s.nx));
    car.sampleIdx = i;
    car.lat = lat;
    car.vx = s.nx * 20 + s.tx * 10;
    car.vy = s.ny * 20 + s.ty * 10;
    const impact = collideWall(car, track);
    expect(impact).toBeCloseTo(20, 6);
    expect(track.lateral(i, car.x, car.y)).toBeLessThan(track.wallDist);
    expect(car.vx * s.nx + car.vy * s.ny).toBeLessThan(0);
    expect(car.vx * s.tx + car.vy * s.ty).toBeGreaterThan(0);
  });
});
