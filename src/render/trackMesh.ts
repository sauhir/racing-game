import * as THREE from 'three';
import { makeRng } from '../core/rng';
import type { Track } from '../sim/track';

type ColorFn = (i: number) => number | null;

/** Builds a flat strip following the track between two lateral offsets. */
function ribbon(track: Track, latA: number, latB: number, y: number, color: ColorFn): THREE.BufferGeometry {
  const pos: number[] = [];
  const col: number[] = [];
  const c = new THREE.Color();
  for (let i = 0; i < track.count; i++) {
    const hex = color(i);
    if (hex === null) continue;
    c.set(hex);
    const s0 = track.samples[i];
    const s1 = track.sample(i + 1);
    const a0 = [s0.x + s0.nx * latA, y, s0.y + s0.ny * latA];
    const b0 = [s0.x + s0.nx * latB, y, s0.y + s0.ny * latB];
    const a1 = [s1.x + s1.nx * latA, y, s1.y + s1.ny * latA];
    const b1 = [s1.x + s1.nx * latB, y, s1.y + s1.ny * latB];
    pos.push(...a0, ...b0, ...a1, ...b0, ...b1, ...a1);
    for (let k = 0; k < 6; k++) col.push(c.r, c.g, c.b);
  }
  return finish(pos, col);
}

/** Builds a barrier (two faces and a top) following the track at a lateral offset. */
function wall(track: Track, lat: number, thickness: number, height: number, color: ColorFn): THREE.BufferGeometry {
  const pos: number[] = [];
  const col: number[] = [];
  const c = new THREE.Color();
  const latB = lat + Math.sign(lat) * thickness;
  for (let i = 0; i < track.count; i++) {
    c.set(color(i) ?? 0xffffff);
    const s0 = track.samples[i];
    const s1 = track.sample(i + 1);
    const p = (s: typeof s0, l: number, y: number) => [s.x + s.nx * l, y, s.y + s.ny * l];
    const quads = [
      [p(s0, lat, 0), p(s1, lat, 0), p(s0, lat, height), p(s1, lat, height)],
      [p(s0, lat, height), p(s1, lat, height), p(s0, latB, height), p(s1, latB, height)],
      [p(s0, latB, 0), p(s1, latB, 0), p(s0, latB, height), p(s1, latB, height)],
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

function checkerTexture(cols: number, rows: number): THREE.Texture {
  const cv = document.createElement('canvas');
  cv.width = cols;
  cv.height = rows;
  const ctx = cv.getContext('2d')!;
  for (let x = 0; x < cols; x++) {
    for (let y = 0; y < rows; y++) {
      ctx.fillStyle = (x + y) % 2 ? '#15161c' : '#ffffff';
      ctx.fillRect(x, y, 1, 1);
    }
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Everything static in the world: ground, road, kerbs, barriers, start gantry, scenery. */
export function buildTrackScene(track: Track): THREE.Group {
  const group = new THREE.Group();
  const flat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
  const hw = track.halfWidth;

  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const s of track.samples) {
    minX = Math.min(minX, s.x);
    maxX = Math.max(maxX, s.x);
    minY = Math.min(minY, s.y);
    maxY = Math.max(maxY, s.y);
  }
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(2400, 2400),
    new THREE.MeshLambertMaterial({ color: 0x79c257 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(cx, 0, cy);
  ground.receiveShadow = true;
  group.add(ground);

  const add = (geo: THREE.BufferGeometry, shadow = true) => {
    const m = new THREE.Mesh(geo, flat);
    m.receiveShadow = shadow;
    group.add(m);
    return m;
  };

  add(ribbon(track, -track.wallDist, track.wallDist, 0.02, (i) => (Math.floor(i / 8) % 2 ? 0x8ed267 : 0x86cc60)));
  add(ribbon(track, -hw, hw, 0.04, () => 0x545a68));
  add(ribbon(track, -0.18, 0.18, 0.05, (i) => (i % 6 < 3 ? 0xf4f1e4 : null)));
  const kerb: ColorFn = (i) => (Math.floor(i / 2) % 2 ? 0xe8473d : 0xfafafa);
  add(ribbon(track, hw - 0.3, hw + 1.1, 0.06, kerb));
  add(ribbon(track, -hw + 0.3, -hw - 1.1, 0.06, kerb));

  const barrier: ColorFn = (i) => (Math.floor(i / 3) % 2 ? 0xe8473d : 0xf7f7fa);
  for (const side of [1, -1]) {
    const m = add(wall(track, side * track.wallDist, 0.8, 1.1, barrier));
    m.castShadow = true;
  }

  // Start line and gantry.
  const s0 = track.samples[0];
  const heading = Math.atan2(s0.ty, s0.tx);
  const line = new THREE.Mesh(
    new THREE.PlaneGeometry(3, hw * 2),
    new THREE.MeshLambertMaterial({ map: checkerTexture(3, 16) }),
  );
  line.rotation.x = -Math.PI / 2;
  line.rotation.z = -heading;
  line.position.set(s0.x, 0.07, s0.y);
  line.receiveShadow = true;
  group.add(line);

  const gantry = new THREE.Group();
  const postMat = new THREE.MeshLambertMaterial({ color: 0x2c3a6b });
  const span = track.wallDist * 2 + 2;
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

  group.add(scenery(track, minX, maxX, minY, maxY));
  return group;
}

function scenery(track: Track, minX: number, maxX: number, minY: number, maxY: number): THREE.Group {
  const group = new THREE.Group();
  const rng = makeRng(7);
  const margin = 130;
  const clear = track.wallDist + 5;

  const freeSpot = (): [number, number] | null => {
    const x = minX - margin + rng() * (maxX - minX + margin * 2);
    const y = minY - margin + rng() * (maxY - minY + margin * 2);
    for (let i = 0; i < track.count; i += 2) {
      const s = track.samples[i];
      if ((s.x - x) ** 2 + (s.y - y) ** 2 < clear * clear) return null;
    }
    return [x, y];
  };

  const instanced = (geo: THREE.BufferGeometry, color: number, count: number): THREE.InstancedMesh => {
    const m = new THREE.InstancedMesh(geo, new THREE.MeshLambertMaterial({ color, flatShading: true }), count);
    m.castShadow = true;
    m.receiveShadow = true;
    group.add(m);
    return m;
  };

  const TREES = 520;
  const trunks = instanced(new THREE.CylinderGeometry(0.5, 0.7, 3, 6), 0x8a5a3b, TREES);
  const leavesA = instanced(new THREE.ConeGeometry(3.2, 6, 7), 0x3f9b4b, TREES);
  const leavesB = instanced(new THREE.ConeGeometry(2.4, 4.5, 7), 0x55b85a, TREES);
  const ROCKS = 140;
  const rocks = instanced(new THREE.IcosahedronGeometry(1.4, 0), 0xa9adb5, ROCKS);
  const FLOWERS = 500;
  const flowers = instanced(new THREE.IcosahedronGeometry(0.45, 0), 0xffffff, FLOWERS);
  flowers.castShadow = false;

  const dummy = new THREE.Object3D();
  const place = (mesh: THREE.InstancedMesh, i: number, x: number, y: number, z: number, scale: number, rot = 0) => {
    dummy.position.set(x, y, z);
    dummy.rotation.set(0, rot, 0);
    dummy.scale.setScalar(scale);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
  };
  const hide = (mesh: THREE.InstancedMesh, i: number) => place(mesh, i, 0, -100, 0, 0.001);

  for (let i = 0; i < TREES; i++) {
    const p = freeSpot();
    if (!p) {
      hide(trunks, i);
      hide(leavesA, i);
      hide(leavesB, i);
      continue;
    }
    const s = 0.7 + rng() * 0.8;
    const rot = rng() * 6.28;
    place(trunks, i, p[0], 1.5 * s, p[1], s, rot);
    place(leavesA, i, p[0], 5.2 * s, p[1], s, rot);
    place(leavesB, i, p[0], 8.2 * s, p[1], s, rot);
  }
  for (let i = 0; i < ROCKS; i++) {
    const p = freeSpot();
    if (p) place(rocks, i, p[0], 0.4, p[1], 0.5 + rng() * 1.3, rng() * 6.28);
    else hide(rocks, i);
  }
  const petals = [0xffffff, 0xffe066, 0xff8fb1, 0xb39bff];
  const color = new THREE.Color();
  for (let i = 0; i < FLOWERS; i++) {
    const p = freeSpot();
    if (p) place(flowers, i, p[0], 0.25, p[1], 0.6 + rng() * 0.6);
    else hide(flowers, i);
    flowers.setColorAt(i, color.set(petals[Math.floor(rng() * petals.length)]));
  }
  return group;
}
