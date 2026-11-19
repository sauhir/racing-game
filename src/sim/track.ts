import { clamp, wrapAngle } from '../core/math';

export interface TrackDef {
  id: string;
  name: string;
  /** Half the width of the drivable road surface, in metres. */
  halfWidth: number;
  /** Width of the slow off-road strip between road edge and wall. */
  verge: number;
  /** Closed loop of spline control points; the start line is at the first point. */
  points: [number, number][];
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
}

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
  readonly halfWidth: number;
  readonly wallDist: number;

  constructor(def: TrackDef) {
    this.def = def;
    this.halfWidth = def.halfWidth;
    this.wallDist = def.halfWidth + def.verge;

    const P = def.points;
    const n = P.length;
    const dense: [number, number][] = [];
    for (let i = 0; i < n; i++) {
      const p0 = P[(i - 1 + n) % n];
      const p1 = P[i];
      const p2 = P[(i + 1) % n];
      const p3 = P[(i + 2) % n];
      for (let s = 0; s < SUBDIVISIONS; s++) {
        const t = s / SUBDIVISIONS;
        dense.push([catmull(p0[0], p1[0], p2[0], p3[0], t), catmull(p0[1], p1[1], p2[1], p3[1], t)]);
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
    let j = 0;
    for (let k = 0; k < this.count; k++) {
      const d = k * this.spacing;
      while (cum[j + 1] < d) j++;
      const t = (d - cum[j]) / (cum[j + 1] - cum[j] || 1);
      const a = dense[j];
      const b = dense[(j + 1) % m];
      pts.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    }

    const N = this.count;
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
    const maxLine = this.halfWidth - 2.6;
    let line = smoothLoop(curv, 10).map((c) => clamp(c * 60, -1, 1) * maxLine);
    line = smoothLoop(line, 6);

    for (let i = 0; i < N; i++) {
      const tx = Math.cos(headings[i]);
      const ty = Math.sin(headings[i]);
      this.samples.push({ x: pts[i][0], y: pts[i][1], tx, ty, nx: -ty, ny: tx, curv: curv[i], line: line[i] });
    }
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

  /** World position and heading at a distance along the track with a lateral offset. */
  pointAt(dist: number, lateral: number): { x: number; y: number; heading: number; index: number } {
    const index = this.wrap(Math.round(dist / this.spacing));
    const s = this.samples[index];
    return { x: s.x + s.nx * lateral, y: s.y + s.ny * lateral, heading: Math.atan2(s.ty, s.tx), index };
  }
}
