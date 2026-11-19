import { clamp, wrapAngle } from '../core/math';

export type ThemeId = 'meadow' | 'beach' | 'snow' | 'desert';

export interface TrackDef {
  id: string;
  name: string;
  theme: ThemeId;
  /** Default half-width of the drivable road surface, in metres. */
  halfWidth: number;
  /** Width of the slow off-road strip between road edge and wall. */
  verge: number;
  /**
   * Closed loop of spline control points; the start line is at the first point.
   * An optional third number overrides the road half-width around that point.
   */
  points: ([number, number] | [number, number, number])[];
  /** Moves the start line this fraction (0..1) of a lap on from the first point. */
  start?: number;
  /** Road grip multiplier (1 = tarmac). */
  grip?: number;
  /** Top-speed multiplier off the road; defaults to the standard grass value. */
  offroadSpeed?: number;
  /** Jump ramps, as fractions (0..1) of the lap. Put them on straights. */
  jumps?: number[];
  /** Boost pads as [lap fraction, lateral position as a fraction of the half-width]. */
  pads?: [number, number][];
  /** Where rows of mystery boxes sit, as fractions (0..1) of the lap. */
  boxRows: number[];
}

export interface TrackSample {
  x: number;
  y: number;
  /** Unit tangent (direction of travel). */
  tx: number;
  ty: number;
  /** Unit normal, tangent rotated +90 degrees. Lateral offsets are measured along it. */
  nx: number;
  ny: number;
  /** Signed curvature (1/m); positive turns towards the normal. */
  curv: number;
  /** Racing-line lateral offset for CPU drivers. */
  line: number;
  /** Half-width of the road here. */
  hw: number;
  /** Lateral distance from the centreline to the walls here. */
  wall: number;
}

export interface BoostPad {
  index: number;
  lat: number;
}

/** Ramp length in samples; the lip (take-off point) is at the jump's sample index. */
export const RAMP_SAMPLES = 4;
export const RAMP_HEIGHT = 1.4;
export const PAD_HALF_LENGTH = 2;
export const PAD_HALF_WIDTH = 2.3;

const TARGET_SPACING = 2;
const SUBDIVISIONS = 24;

function catmull(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const t2 = t * t;
  const t3 = t2 * t;
  return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
}

function smoothLoop(values: number[], radius: number): number[] {
  const n = values.length;
  const out = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    let sum = 0;
    for (let k = -radius; k <= radius; k++) sum += values[(i + k + n) % n];
    out[i] = sum / (2 * radius + 1);
  }
  return out;
}

/**
 * A closed circuit: a spline resampled into evenly spaced samples. Everything
 * else (meshes, walls, lap progress, CPU racing line) is derived from these.
 */
export class Track {
  readonly def: TrackDef;
  readonly samples: TrackSample[] = [];
  readonly count: number;
  readonly spacing: number;
  readonly length: number;
  /** The default half-width; individual samples may be wider or narrower (see sample.hw). */
  readonly halfWidth: number;
  readonly wallDist: number;
  /** Sample indices of the jump lips. */
  readonly jumps: number[];
  readonly pads: BoostPad[];

  constructor(def: TrackDef) {
    this.def = def;
    this.halfWidth = def.halfWidth;
    this.wallDist = def.halfWidth + def.verge;

    const P = def.points;
    const n = P.length;
    const dense: [number, number][] = [];
    const denseW: number[] = [];
    const widthAt = (i: number): number => P[i][2] ?? def.halfWidth;
    for (let i = 0; i < n; i++) {
      const p0 = P[(i - 1 + n) % n];
      const p1 = P[i];
      const p2 = P[(i + 1) % n];
      const p3 = P[(i + 2) % n];
      for (let s = 0; s < SUBDIVISIONS; s++) {
        const t = s / SUBDIVISIONS;
        dense.push([catmull(p0[0], p1[0], p2[0], p3[0], t), catmull(p0[1], p1[1], p2[1], p3[1], t)]);
        denseW.push(widthAt(i) + (widthAt((i + 1) % n) - widthAt(i)) * t);
      }
    }
    const m = dense.length;
    const cum = [0];
    for (let i = 0; i < m; i++) {
      const a = dense[i];
      const b = dense[(i + 1) % m];
      cum.push(cum[i] + Math.hypot(b[0] - a[0], b[1] - a[1]));
    }
    this.length = cum[m];
    this.count = Math.round(this.length / TARGET_SPACING);
    this.spacing = this.length / this.count;

    const pts: [number, number][] = [];
    let widths: number[] = [];
    let j = 0;
    for (let k = 0; k < this.count; k++) {
      const d = k * this.spacing;
      while (cum[j + 1] < d) j++;
      const t = (d - cum[j]) / (cum[j + 1] - cum[j] || 1);
      const a = dense[j];
      const b = dense[(j + 1) % m];
      pts.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
      widths.push(denseW[j] + (denseW[(j + 1) % m] - denseW[j]) * t);
    }

    const N = this.count;
    const shift = Math.round((def.start ?? 0) * N) % N;
    if (shift > 0) {
      pts.push(...pts.splice(0, shift));
      widths.push(...widths.splice(0, shift));
    }
    const headings: number[] = [];
    for (let i = 0; i < N; i++) {
      const a = pts[(i - 1 + N) % N];
      const b = pts[(i + 1) % N];
      headings.push(Math.atan2(b[1] - a[1], b[0] - a[0]));
    }
    let curv: number[] = [];
    for (let i = 0; i < N; i++) {
      curv.push(wrapAngle(headings[(i + 1) % N] - headings[(i - 1 + N) % N]) / (2 * this.spacing));
    }
    curv = smoothLoop(curv, 2);
    widths = smoothLoop(widths, 5);
    let line = smoothLoop(curv, 10).map((c, i) => clamp(c * 60, -1, 1) * (widths[i] - 2.6));
    line = smoothLoop(line, 6);

    for (let i = 0; i < N; i++) {
      const tx = Math.cos(headings[i]);
      const ty = Math.sin(headings[i]);
      this.samples.push({
        x: pts[i][0], y: pts[i][1], tx, ty, nx: -ty, ny: tx, curv: curv[i], line: line[i],
        hw: widths[i], wall: widths[i] + def.verge,
      });
    }
    const indexAt = (fraction: number): number => this.wrap(Math.round(fraction * N));
    this.jumps = (def.jumps ?? []).map(indexAt);
    this.pads = (def.pads ?? []).map(([f, l]) => {
      const index = indexAt(f);
      return { index, lat: l * (this.samples[index].hw - PAD_HALF_WIDTH) };
    });
  }

  wrap(i: number): number {
    const n = this.count;
    return ((i % n) + n) % n;
  }

  sample(i: number): TrackSample {
    return this.samples[this.wrap(i)];
  }

  /** Nearest sample index, searching only a window around a previous index. */
  nearest(x: number, y: number, hint: number, window = 14): number {
    let best = this.wrap(hint);
    let bestD = Infinity;
    for (let k = -window; k <= window; k++) {
      const i = this.wrap(hint + k);
      const s = this.samples[i];
      const d = (s.x - x) * (s.x - x) + (s.y - y) * (s.y - y);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return best;
  }

  nearestGlobal(x: number, y: number): number {
    return this.nearest(x, y, 0, Math.ceil(this.count / 2));
  }

  lateral(i: number, x: number, y: number): number {
    const s = this.samples[i];
    return (x - s.x) * s.nx + (y - s.y) * s.ny;
  }

  along(i: number, x: number, y: number): number {
    const s = this.samples[i];
    return (x - s.x) * s.tx + (y - s.y) * s.ty;
  }

  /** Height of a ramp's surface under a point at sample i (0 away from ramps). */
  rampHeight(i: number, x: number, y: number): number {
    for (const j of this.jumps) {
      const back = this.wrap(j - i);
      if (back > RAMP_SAMPLES) continue;
      const d = back * this.spacing - this.along(i, x, y);
      const length = RAMP_SAMPLES * this.spacing;
      if (d >= 0 && d <= length) return RAMP_HEIGHT * (1 - d / length);
    }
    return 0;
  }

  /** World position and heading at a distance along the track with a lateral offset. */
  pointAt(dist: number, lateral: number): { x: number; y: number; heading: number; index: number } {
    const index = this.wrap(Math.round(dist / this.spacing));
    const s = this.samples[index];
    return { x: s.x + s.nx * lateral, y: s.y + s.ny * lateral, heading: Math.atan2(s.ty, s.tx), index };
  }
}

/**
 * Checks that a circuit is drivable: no corner tighter than its walls allow and
 * no two stretches of road close enough for their walls to overlap. Returns a
 * list of problems (empty when the track is fine).
 */
export function trackProblems(track: Track): string[] {
  const problems: string[] = [];
  const N = track.count;
  for (let i = 0; i < N; i++) {
    const s = track.samples[i];
    if (Math.abs(s.curv) * s.wall * 1.3 > 1) {
      problems.push(`corner too tight at sample ${i}: radius ${(1 / Math.abs(s.curv)).toFixed(0)} m`);
      break;
    }
  }
  const skip = Math.ceil(70 / track.spacing);
  outer: for (let i = 0; i < N; i += 2) {
    const a = track.samples[i];
    for (let j = i + skip; j < N; j += 2) {
      if (N - j + i < skip) continue;
      const b = track.samples[j];
      if (Math.hypot(a.x - b.x, a.y - b.y) < a.wall + b.wall + 8) {
        problems.push(`road too close to itself at samples ${i} and ${j}`);
        break outer;
      }
    }
  }
  for (const j of track.jumps) {
    for (let k = -8; k <= 45; k++) {
      if (Math.abs(track.sample(j + k).curv) > 0.006) {
        problems.push(`jump at sample ${j} is not on a straight`);
        break;
      }
    }
  }
  return problems;
}
