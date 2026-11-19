import * as THREE from 'three';
import { makeRng, type Rng } from '../core/rng';
import {
  PAD_HALF_LENGTH, PAD_HALF_WIDTH, RAMP_HEIGHT, RAMP_SAMPLES, type ThemeId, type Track, type TrackSample,
} from '../sim/track';
import { THEMES } from './themes';

type ColorFn = (i: number) => number | null;
type LatFn = (s: TrackSample) => number;

/** Builds a flat strip following the track between two lateral offsets. */
function ribbon(track: Track, latA: LatFn, latB: LatFn, y: number, color: ColorFn): THREE.BufferGeometry {
  const pos: number[] = [];
  const col: number[] = [];
  const c = new THREE.Color();
  for (let i = 0; i < track.count; i++) {
    const hex = color(i);
    if (hex === null) continue;
    c.set(hex);
    const s0 = track.samples[i];
    const s1 = track.sample(i + 1);
    const p = (s: TrackSample, l: number) => [s.x + s.nx * l, y, s.y + s.ny * l];
    const a0 = p(s0, latA(s0));
    const b0 = p(s0, latB(s0));
    const a1 = p(s1, latA(s1));
    const b1 = p(s1, latB(s1));
    pos.push(...a0, ...b0, ...a1, ...b0, ...b1, ...a1);
    for (let k = 0; k < 6; k++) col.push(c.r, c.g, c.b);
  }
  return finish(pos, col);
}

/** Builds a barrier (two faces and a top) along one side of the track. */
function wall(track: Track, side: number, thickness: number, height: number, color: ColorFn): THREE.BufferGeometry {
  const pos: number[] = [];
  const col: number[] = [];
  const c = new THREE.Color();
  for (let i = 0; i < track.count; i++) {
    c.set(color(i) ?? 0xffffff);
    const s0 = track.samples[i];
    const s1 = track.sample(i + 1);
    const p = (s: TrackSample, extra: number, y: number) => {
      const l = side * (s.wall + extra);
      return [s.x + s.nx * l, y, s.y + s.ny * l];
    };
    const quads = [
      [p(s0, 0, 0), p(s1, 0, 0), p(s0, 0, height), p(s1, 0, height)],
      [p(s0, 0, height), p(s1, 0, height), p(s0, thickness, height), p(s1, thickness, height)],
      [p(s0, thickness, 0), p(s1, thickness, 0), p(s0, thickness, height), p(s1, thickness, height)],
    ];
    for (const [a, b, d, e] of quads) {
      pos.push(...a, ...b, ...d, ...b, ...e, ...d);
      for (let k = 0; k < 6; k++) col.push(c.r, c.g, c.b);
    }
  }
  return finish(pos, col);
}

function finish(pos: number[], col: number[]): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}

function canvasTexture(w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  draw(cv.getContext('2d')!);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function checkerTexture(cols: number, rows: number): THREE.Texture {
  const tex = canvasTexture(cols, rows, (ctx) => {
    for (let x = 0; x < cols; x++) {
      for (let y = 0; y < rows; y++) {
        ctx.fillStyle = (x + y) % 2 ? '#15161c' : '#ffffff';
        ctx.fillRect(x, y, 1, 1);
      }
    }
  });
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  return tex;
}

/** Chevrons pointing along +U, used on boost pads and ramps. */
function chevronTexture(back: string, arrow: string): THREE.CanvasTexture {
  const tex = canvasTexture(64, 64, (ctx) => {
    ctx.fillStyle = back;
    ctx.fillRect(0, 0, 64, 64);
    ctx.strokeStyle = arrow;
    ctx.lineWidth = 12;
    ctx.lineJoin = 'miter';
    for (const x of [-22, 10, 42]) {
      ctx.beginPath();
      ctx.moveTo(x, 4);
      ctx.lineTo(x + 26, 32);
      ctx.lineTo(x, 60);
      ctx.stroke();
    }
  });
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

export interface TrackScene {
  group: THREE.Group;
  /** Animates boost pads. */
  update(time: number): void;
  dispose(): void;
}

/** Everything static in the world: ground, road, kerbs, barriers, ramps, pads, scenery. */
export function buildTrackScene(track: Track): TrackScene {
  const theme = THEMES[track.def.theme];
  const group = new THREE.Group();
  const flat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });

  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const s of track.samples) {
    minX = Math.min(minX, s.x);
    maxX = Math.max(maxX, s.x);
    minY = Math.min(minY, s.y);
    maxY = Math.max(maxY, s.y);
  }

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(2600, 2600),
    new THREE.MeshLambertMaterial({ color: theme.ground }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.set((minX + maxX) / 2, 0, (minY + maxY) / 2);
  ground.receiveShadow = true;
  group.add(ground);

  const add = (geo: THREE.BufferGeometry) => {
    const m = new THREE.Mesh(geo, flat);
    m.receiveShadow = true;
    group.add(m);
    return m;
  };

  add(ribbon(track, (s) => -s.wall, (s) => s.wall, 0.02, (i) => theme.verge[Math.floor(i / 8) % 2]));
  add(ribbon(track, (s) => -s.hw, (s) => s.hw, 0.04, () => theme.road));
  add(ribbon(track, () => -0.18, () => 0.18, 0.05, (i) => (i % 6 < 3 ? theme.line : null)));
  const kerb: ColorFn = (i) => theme.kerb[Math.floor(i / 2) % 2];
  add(ribbon(track, (s) => s.hw - 0.3, (s) => s.hw + 1.1, 0.06, kerb));
  add(ribbon(track, (s) => -s.hw + 0.3, (s) => -s.hw - 1.1, 0.06, kerb));

  const barrier: ColorFn = (i) => theme.barrier[Math.floor(i / 3) % 2];
  for (const side of [1, -1]) add(wall(track, side, 0.8, 1.1, barrier)).castShadow = true;

  // Start line and gantry.
  const s0 = track.samples[0];
  const heading = Math.atan2(s0.ty, s0.tx);
  const line = new THREE.Mesh(
    new THREE.PlaneGeometry(3, s0.hw * 2),
    new THREE.MeshLambertMaterial({ map: checkerTexture(3, 16) }),
  );
  line.rotation.x = -Math.PI / 2;
  line.rotation.z = -heading;
  line.position.set(s0.x, 0.07, s0.y);
  line.receiveShadow = true;
  group.add(line);

  const gantry = new THREE.Group();
  const postMat = new THREE.MeshLambertMaterial({ color: 0x2c3a6b });
  const span = s0.wall * 2 + 2;
  for (const side of [1, -1]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(1, 9, 1), postMat);
    post.position.set(0, 4.5, (side * span) / 2);
    post.castShadow = true;
    gantry.add(post);
  }
  const banner = new THREE.Mesh(
    new THREE.BoxGeometry(0.6, 2, span),
    new THREE.MeshLambertMaterial({ map: checkerTexture(2, 26) }),
  );
  banner.position.y = 8.5;
  banner.castShadow = true;
  gantry.add(banner);
  gantry.position.set(s0.x, 0, s0.y);
  gantry.rotation.y = -heading;
  group.add(gantry);

  // Ramps: a wedge across the road, rising to the lip at the jump's sample.
  const rampTex = chevronTexture('#ff9a2e', '#fff3c4');
  rampTex.repeat.set(1, 3);
  const rampMat = new THREE.MeshLambertMaterial({ map: rampTex, side: THREE.DoubleSide });
  const rampSide = new THREE.MeshLambertMaterial({ color: 0xc9601e, side: THREE.DoubleSide });
  for (const j of track.jumps) {
    const lip = track.samples[j];
    const length = RAMP_SAMPLES * track.spacing;
    const w = lip.hw - 0.4;
    const geo = new THREE.BufferGeometry();
    // Local frame: x along the track (0 = lip, -length = foot), z across.
    const v = [
      -length, 0.05, -w, -length, 0.05, w, 0, RAMP_HEIGHT, -w,
      -length, 0.05, w, 0, RAMP_HEIGHT, w, 0, RAMP_HEIGHT, -w,
    ];
    geo.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 0, 1, 1, 0, 0, 1, 1, 1, 1, 0], 2));
    geo.computeVertexNormals();
    const top = new THREE.Mesh(geo, rampMat);
    top.castShadow = top.receiveShadow = true;
    const sides = new THREE.BufferGeometry();
    sides.setAttribute('position', new THREE.Float32BufferAttribute([
      -length, 0, -w, 0, 0, -w, 0, RAMP_HEIGHT, -w,
      -length, 0, w, 0, 0, w, 0, RAMP_HEIGHT, w,
      0, 0, -w, 0, 0, w, 0, RAMP_HEIGHT, -w,
      0, 0, w, 0, RAMP_HEIGHT, w, 0, RAMP_HEIGHT, -w,
    ], 3));
    sides.computeVertexNormals();
    const ramp = new THREE.Group();
    ramp.add(top, new THREE.Mesh(sides, rampSide));
    ramp.position.set(lip.x, 0, lip.y);
    ramp.rotation.y = -Math.atan2(lip.ty, lip.tx);
    group.add(ramp);
  }

  // Boost pads: glowing chevrons that scroll forwards.
  const padTex = chevronTexture('#1ec8ff', '#ffffff');
  padTex.repeat.set(2, 1);
  const padMat = new THREE.MeshBasicMaterial({
    // Brighter than white, so the pads glow through the bloom pass.
    color: new THREE.Color(0xffffff).multiplyScalar(1.5),
    map: padTex, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
  });
  for (const pad of track.pads) {
    const s = track.samples[pad.index];
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(PAD_HALF_LENGTH * 2 * track.spacing, PAD_HALF_WIDTH * 2),
      padMat,
    );
    m.rotation.x = -Math.PI / 2;
    m.rotation.z = -Math.atan2(s.ty, s.tx);
    m.position.set(s.x + s.nx * pad.lat, 0.08, s.y + s.ny * pad.lat);
    group.add(m);
  }

  group.add(scenery(track, track.def.theme, minX, maxX, minY, maxY));

  return {
    group,
    update(time: number) {
      padTex.offset.x = -time * 2.2;
    },
    dispose() {
      group.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.geometry) return;
        mesh.geometry.dispose();
        for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
          (m as THREE.MeshLambertMaterial).map?.dispose();
          m.dispose();
        }
      });
    },
  };
}

/** Scatters instanced props over the free ground around the circuit. */
class Scatter {
  readonly group = new THREE.Group();
  private readonly dummy = new THREE.Object3D();

  constructor(
    private readonly track: Track,
    readonly rng: Rng,
    private readonly bounds: [number, number, number, number],
  ) {}

  /** A random spot at least `clear` metres beyond the walls, or null. */
  spot(clear: number): [number, number] | null {
    const [minX, maxX, minY, maxY] = this.bounds;
    const margin = 140;
    const x = minX - margin + this.rng() * (maxX - minX + margin * 2);
    const y = minY - margin + this.rng() * (maxY - minY + margin * 2);
    for (let i = 0; i < this.track.count; i += 2) {
      const s = this.track.samples[i];
      const d = s.wall + clear;
      if ((s.x - x) ** 2 + (s.y - y) ** 2 < d * d) return null;
    }
    return [x, y];
  }

  mesh(geo: THREE.BufferGeometry, color: number, count: number, shadow = true): THREE.InstancedMesh {
    const m = new THREE.InstancedMesh(geo, new THREE.MeshLambertMaterial({ color, flatShading: true }), count);
    m.castShadow = shadow;
    m.receiveShadow = true;
    m.count = 0;
    this.group.add(m);
    return m;
  }

  put(
    mesh: THREE.InstancedMesh, x: number, y: number, z: number,
    scale: number | [number, number, number] = 1, rotY = 0, tilt = 0,
  ): void {
    const d = this.dummy;
    d.position.set(x, y, z);
    d.rotation.set(tilt, rotY, 0, 'YXZ');
    if (typeof scale === 'number') d.scale.setScalar(scale);
    else d.scale.set(...scale);
    d.updateMatrix();
    mesh.setMatrixAt(mesh.count++, d.matrix);
  }

  /** Small coloured blobs dotted about: flowers, shells, pebbles. */
  dots(count: number, colors: number[], size: number): void {
    const mesh = this.mesh(new THREE.IcosahedronGeometry(size, 0), 0xffffff, count, false);
    const color = new THREE.Color();
    for (let i = 0; i < count; i++) {
      const p = this.spot(3);
      if (!p) continue;
      mesh.setColorAt(mesh.count, color.set(colors[Math.floor(this.rng() * colors.length)]));
      this.put(mesh, p[0], size * 0.5, p[1], 0.6 + this.rng() * 0.6);
    }
  }

  rocks(count: number, color: number, maxScale = 1.8): void {
    const mesh = this.mesh(new THREE.IcosahedronGeometry(1.4, 0), color, count);
    for (let i = 0; i < count; i++) {
      const p = this.spot(5);
      if (p) this.put(mesh, p[0], 0.4, p[1], 0.5 + this.rng() * (maxScale - 0.5), this.rng() * 6.28);
    }
  }

  pines(count: number, lower: number, upper: number): void {
    const trunks = this.mesh(new THREE.CylinderGeometry(0.5, 0.7, 3, 6), 0x8a5a3b, count);
    const a = this.mesh(new THREE.ConeGeometry(3.2, 6, 7), lower, count);
    const b = this.mesh(new THREE.ConeGeometry(2.4, 4.5, 7), upper, count);
    for (let i = 0; i < count; i++) {
      const p = this.spot(5);
      if (!p) continue;
      const s = 0.7 + this.rng() * 0.8;
      const rot = this.rng() * 6.28;
      this.put(trunks, p[0], 1.5 * s, p[1], s, rot);
      this.put(a, p[0], 5.2 * s, p[1], s, rot);
      this.put(b, p[0], 8.2 * s, p[1], s, rot);
    }
  }
}

function scenery(
  track: Track, theme: ThemeId, minX: number, maxX: number, minY: number, maxY: number,
): THREE.Group {
  const sc = new Scatter(track, makeRng(7), [minX, maxX, minY, maxY]);
  const rng = sc.rng;

  if (theme === 'meadow') {
    sc.pines(520, 0x3f9b4b, 0x55b85a);
    sc.rocks(140, 0xa9adb5);
    sc.dots(500, [0xffffff, 0xffe066, 0xff8fb1, 0xb39bff], 0.45);
  } else if (theme === 'snow') {
    sc.pines(480, 0x3d8a66, 0xf4fbff);
    sc.rocks(120, 0xb9cfe0);
    const N = 70;
    const body = sc.mesh(new THREE.SphereGeometry(1, 10, 8), 0xffffff, N * 2);
    const nose = sc.mesh(new THREE.ConeGeometry(0.16, 0.7, 6), 0xff8a2e, N, false);
    for (let i = 0; i < N; i++) {
      const p = sc.spot(4);
      if (!p) continue;
      const rot = rng() * 6.28;
      sc.put(body, p[0], 1, p[1], 1.15);
      sc.put(body, p[0], 2.5, p[1], 0.75);
      sc.put(nose, p[0] + Math.sin(rot) * 0.85, 2.55, p[1] + Math.cos(rot) * 0.85, 1, rot, Math.PI / 2);
    }
    sc.dots(260, [0xffffff, 0xe6f2fb], 0.9);
  } else if (theme === 'beach') {
    const N = 300;
    const trunk = sc.mesh(new THREE.CylinderGeometry(0.28, 0.42, 7, 6), 0xa9794a, N);
    const frond = sc.mesh(new THREE.SphereGeometry(1, 8, 6), 0x3fae5a, N * 3);
    const nut = sc.mesh(new THREE.SphereGeometry(0.32, 6, 5), 0x6b4a2a, N, false);
    for (let i = 0; i < N; i++) {
      const p = sc.spot(5);
      if (!p) continue;
      const s = 0.8 + rng() * 0.6;
      const rot = rng() * 6.28;
      sc.put(trunk, p[0], 3.5 * s, p[1], s, rot, 0.08);
      for (let k = 0; k < 3; k++) sc.put(frond, p[0], 7.1 * s, p[1], [3.6 * s, 0.35 * s, 0.95 * s], rot + (k * Math.PI) / 3);
      sc.put(nut, p[0], 6.7 * s, p[1], s);
    }
    // Parasols.
    const P = 90;
    const pole = sc.mesh(new THREE.CylinderGeometry(0.08, 0.08, 3, 5), 0xf7f7fa, P);
    const shade = sc.mesh(new THREE.ConeGeometry(2.1, 0.9, 10), 0xffffff, P);
    const color = new THREE.Color();
    const shades = [0xff5a4d, 0xffc928, 0x2fb6e8, 0xff8fb1];
    for (let i = 0; i < P; i++) {
      const p = sc.spot(4);
      if (!p) continue;
      shade.setColorAt(shade.count, color.set(shades[Math.floor(rng() * shades.length)]));
      sc.put(pole, p[0], 1.5, p[1]);
      sc.put(shade, p[0], 3.2, p[1], 1, rng() * 6.28, 0.12);
    }
    sc.rocks(70, 0xcbb894, 1.4);
    sc.dots(320, [0xffffff, 0xffb3a1, 0xffe9c9], 0.35);
  } else {
    // Desert: cacti, flat-topped mesas and boulders.
    const N = 260;
    const cactus = sc.mesh(new THREE.CapsuleGeometry(0.5, 3, 3, 8), 0x4f9a52, N * 3);
    for (let i = 0; i < N; i++) {
      const p = sc.spot(4);
      if (!p) continue;
      const s = 0.7 + rng() * 0.8;
      const rot = rng() * 6.28;
      const dx = Math.cos(rot) * s;
      const dz = -Math.sin(rot) * s;
      sc.put(cactus, p[0], 2 * s, p[1], s);
      sc.put(cactus, p[0] + dx, 2.4 * s, p[1] + dz, [0.6 * s, 0.5 * s, 0.6 * s]);
      sc.put(cactus, p[0] - dx, 3 * s, p[1] - dz, [0.6 * s, 0.4 * s, 0.6 * s]);
    }
    const M = 46;
    const mesa = sc.mesh(new THREE.CylinderGeometry(0.8, 1, 1, 9), 0xc9743c, M);
    const cap = sc.mesh(new THREE.CylinderGeometry(0.82, 0.82, 0.12, 9), 0xe09a58, M);
    for (let i = 0; i < M; i++) {
      const p = sc.spot(26);
      if (!p) continue;
      const r = 9 + rng() * 14;
      const h = 7 + rng() * 14;
      const rot = rng() * 6.28;
      sc.put(mesa, p[0], h / 2, p[1], [r, h, r * (0.7 + rng() * 0.5)], rot);
      sc.put(cap, p[0], h, p[1], [r, h, r * 0.85], rot);
    }
    sc.rocks(200, 0xb9774a, 2.4);
    sc.dots(240, [0xd9b27a, 0xc79a5e], 0.5);
  }

  for (const child of sc.group.children) {
    const m = child as THREE.InstancedMesh;
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  }
  return sc.group;
}
