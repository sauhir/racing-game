import { describe, expect, it } from 'vitest';
import { MEADOW } from '../src/data/tracks/meadow';
import { Track } from '../src/sim/track';

describe('Track', () => {
  const track = new Track(MEADOW);

  it('resamples the spline into an evenly spaced closed loop', () => {
    expect(track.count).toBeGreaterThan(300);
    expect(track.length).toBeCloseTo(track.count * track.spacing, 6);
    for (let i = 0; i < track.count; i++) {
      const a = track.samples[i];
      const b = track.sample(i + 1);
      const d = Math.hypot(b.x - a.x, b.y - a.y);
      expect(d).toBeGreaterThan(track.spacing * 0.9);
      expect(d).toBeLessThan(track.spacing * 1.1);
    }
  });

  it('has no corner tighter than the walls allow', () => {
    const maxCurv = Math.max(...track.samples.map((s) => Math.abs(s.curv)));
    expect(1 / maxCurv).toBeGreaterThan(track.wallDist * 1.3);
  });

  it('never runs close to another part of itself', () => {
    let min = Infinity;
    for (let i = 0; i < track.count; i += 2) {
      for (let j = i + 40; j < track.count; j += 2) {
        if (track.count - j + i < 40) continue;
        const a = track.samples[i];
        const b = track.samples[j];
        min = Math.min(min, Math.hypot(a.x - b.x, a.y - b.y));
      }
    }
    expect(min).toBeGreaterThan(track.wallDist * 2 + 10);
  });

  it('projects points back onto the centreline', () => {
    const i = 120;
    const s = track.samples[i];
    const x = s.x + s.nx * 3;
    const y = s.y + s.ny * 3;
    expect(track.nearest(x, y, i - 5)).toBe(i);
    expect(track.nearestGlobal(x, y)).toBe(i);
    expect(track.lateral(i, x, y)).toBeCloseTo(3, 6);
    expect(track.along(i, x, y)).toBeCloseTo(0, 6);
  });

  it('keeps the racing line on the road', () => {
    for (const s of track.samples) expect(Math.abs(s.line)).toBeLessThan(track.halfWidth - 2);
  });
});
