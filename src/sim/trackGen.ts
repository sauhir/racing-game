import { makeRng } from '../core/rng';
import { Track, trackProblems, type ThemeId, type TrackDef } from './track';

const THEMES: ThemeId[] = ['meadow', 'beach', 'snow', 'desert'];
const SURFACE: Record<ThemeId, Pick<TrackDef, 'grip' | 'offroadSpeed'>> = {
  meadow: {},
  beach: { offroadSpeed: 0.47 },
  snow: { grip: 0.85 },
  desert: { offroadSpeed: 0.45 },
};

function candidate(seed: number): TrackDef {
  const rng = makeRng(seed);
  const count = 10 + Math.floor(rng() * 4);
  const base = 215 + rng() * 45;
  const stretch = 1.1 + rng() * 0.4;
  const phase = rng() * Math.PI * 2;
  const wobble = 2 + Math.floor(rng() * 3);
  const points: [number, number, number][] = [];
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2 + (rng() - 0.5) * (1.6 / count);
    const r = base * (0.8 + 0.22 * Math.sin(a * wobble + phase) + (rng() - 0.5) * 0.3);
    const width = rng() < 0.2 ? 6.8 : rng() < 0.25 ? 10 : 8.5;
    points.push([Math.cos(a) * r * stretch, Math.sin(a) * r, width]);
  }
  const theme = THEMES[Math.floor(rng() * THEMES.length)];
  return {
    id: `random-${seed}`, name: `Mystery Circuit ${seed}`, theme, halfWidth: 8.5, verge: 5,
    points, boxRows: [0.1, 0.3, 0.5, 0.7, 0.9], ...SURFACE[theme],
  };
}

/** Adds a ramp on the straightest stretch (if there is a proper straight) and some boost pads. */
function decorate(def: TrackDef, seed: number): TrackDef {
  const track = new Track(def);
  const rng = makeRng(seed ^ 0x5eed);
  const N = track.count;
  // Keep the ramp clear of the starting grid and the run to the line.
  const first = Math.ceil(40 / track.spacing);
  const last = N - Math.ceil(160 / track.spacing);
  const best = straightest(track, 20, 95, 0.0045, first, last);
  const pads: [number, number][] = [];
  for (let i = 0; i < 3; i++) pads.push([(i + 0.35 + rng() * 0.3) / 3, (rng() - 0.5) * 1.2]);
  return { ...def, jumps: best >= 0 ? [best / N] : [], pads };
}

/**
 * The sample whose surroundings (from `before` metres behind to `after` metres
 * ahead) are straightest, or -1 if nowhere is straighter than `limit`.
 */
function straightest(track: Track, before: number, after: number, limit: number, from = 0, to = track.count): number {
  const b = Math.ceil(before / track.spacing);
  const a = Math.ceil(after / track.spacing);
  let best = -1;
  let bestCurv = limit;
  for (let i = from; i < to; i += 3) {
    let worst = 0;
    for (let k = -b; k <= a; k++) worst = Math.max(worst, Math.abs(track.sample(i + k).curv));
    if (worst < bestCurv) {
      bestCurv = worst;
      best = i;
    }
  }
  return best;
}

/**
 * Builds a random but drivable circuit from a seed. Candidates that are too
 * short, too long, too tight or that run into themselves are thrown away and
 * the next variation is tried, so the same seed always gives the same track.
 */
export function generateTrack(seed: number): TrackDef {
  for (let attempt = 0; attempt < 400; attempt++) {
    const def = candidate(seed * 1000 + attempt);
    const track = new Track(def);
    if (track.length < 1600 || track.length > 2300) continue;
    if (trackProblems(track).length > 0) continue;
    // Put the start line on the straightest stretch so the grid lines up cleanly.
    const start = Math.max(0, straightest(track, 55, 40, Infinity)) / track.count;
    const full = decorate({ ...def, id: `random-${seed}`, name: `Mystery Circuit ${seed}`, start }, seed);
    if (trackProblems(new Track(full)).length === 0) return full;
  }
  throw new Error(`no drivable track found for seed ${seed}`);
}
