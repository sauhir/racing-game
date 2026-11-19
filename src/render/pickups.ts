import * as THREE from 'three';
import type { Race } from '../sim/race';
import { WEAPON } from '../sim/weapons';

const MAX_MISSILES = 8;
const MAX_MINES = 40;
const MAX_OIL = 24;
const MAX_RINGS = 4;
const RING_TIME = 0.5;

function questionTexture(): THREE.Texture {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 64;
  const ctx = cv.getContext('2d')!;
  ctx.fillStyle = '#ffc928';
  ctx.fillRect(0, 0, 64, 64);
  ctx.strokeStyle = '#ff8a1f';
  ctx.lineWidth = 6;
  ctx.strokeRect(3, 3, 58, 58);
  ctx.fillStyle = '#ffffff';
  ctx.font = '900 48px "Trebuchet MS", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('?', 32, 35);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Mystery boxes and live weapons: missiles, mines, oil slicks and shockwave rings. */
export class WorldItems {
  readonly group = new THREE.Group();
  private readonly boxes: THREE.InstancedMesh;
  private readonly missiles: THREE.Group[] = [];
  private readonly mines: THREE.Group[] = [];
  private readonly oils: THREE.Mesh[] = [];
  private readonly rings: { mesh: THREE.Mesh; age: number }[] = [];
  private readonly dummy = new THREE.Object3D();

  constructor(boxCount: number) {
    this.boxes = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1.7, 1.7, 1.7),
      new THREE.MeshLambertMaterial({ map: questionTexture(), emissive: 0x6b4a00 }),
      Math.max(1, boxCount),
    );
    this.boxes.castShadow = true;
    this.boxes.frustumCulled = false;
    this.group.add(this.boxes);

    const red = new THREE.MeshStandardMaterial({ color: 0xe8413a, roughness: 0.35 });
    const white = new THREE.MeshStandardMaterial({ color: 0xf7f7fa, roughness: 0.35 });
    for (let i = 0; i < MAX_MISSILES; i++) {
      const g = new THREE.Group();
      const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.28, 1.3, 4, 10), white);
      body.rotation.z = Math.PI / 2;
      const nose = new THREE.Mesh(new THREE.SphereGeometry(0.3, 10, 8), red);
      nose.scale.x = 1.8;
      nose.position.x = 0.75;
      g.add(body, nose);
      for (const [y, z] of [[0.3, 0], [-0.3, 0], [0, 0.3], [0, -0.3]]) {
        const fin = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.08 + Math.abs(y), 0.08 + Math.abs(z)), red);
        fin.position.set(-0.7, y, z);
        g.add(fin);
      }
      g.traverse((o) => (o.castShadow = true));
      g.visible = false;
      this.missiles.push(g);
      this.group.add(g);
    }

    const mineBody = new THREE.MeshStandardMaterial({ color: 0x3a3f52, roughness: 0.5, flatShading: true });
    const mineLight = new THREE.MeshBasicMaterial({ color: 0xff3b30 });
    for (let i = 0; i < MAX_MINES; i++) {
      const g = new THREE.Group();
      const ball = new THREE.Mesh(new THREE.IcosahedronGeometry(0.75, 0), mineBody);
      ball.castShadow = true;
      const light = new THREE.Mesh(new THREE.SphereGeometry(0.28, 8, 6), mineLight);
      light.position.y = 0.7;
      g.add(ball, light);
      g.visible = false;
      this.mines.push(g);
      this.group.add(g);
    }

    const oilMat = new THREE.MeshStandardMaterial({
      color: 0x14121c, roughness: 0.08, metalness: 0.5, transparent: true, opacity: 0.92,
      polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3,
    });
    const oilGeo = new THREE.CircleGeometry(WEAPON.oilRadius, 18);
    for (let i = 0; i < MAX_OIL; i++) {
      const m = new THREE.Mesh(oilGeo, oilMat);
      m.rotation.x = -Math.PI / 2;
      m.visible = false;
      this.oils.push(m);
      this.group.add(m);
    }

    const ringGeo = new THREE.RingGeometry(0.82, 1, 48);
    for (let i = 0; i < MAX_RINGS; i++) {
      const mesh = new THREE.Mesh(
        ringGeo,
        new THREE.MeshBasicMaterial({ color: 0xb78bff, transparent: true, depthWrite: false, side: THREE.DoubleSide }),
      );
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.y = 0.6;
      mesh.visible = false;
      this.rings.push({ mesh, age: RING_TIME });
      this.group.add(mesh);
    }
  }

  shockwave(x: number, z: number): void {
    const ring = this.rings.reduce((a, b) => (b.age > a.age ? b : a));
    ring.age = 0;
    ring.mesh.position.set(x, 0.6, z);
  }

  update(race: Race, time: number, alpha: number, dt: number): void {
    race.boxes.forEach((box, i) => {
      const d = this.dummy;
      // Boxes pop back in over the last moments of their respawn timer.
      const scale = box.respawn > 0.25 ? 0 : 1 - box.respawn / 0.25;
      d.position.set(box.x, 1.7 + Math.sin(time * 2.4 + i) * 0.25, box.y);
      d.rotation.set(0.62, time * 1.8 + i, 0.62);
      d.scale.setScalar(Math.max(0.0001, scale));
      d.updateMatrix();
      this.boxes.setMatrixAt(i, d.matrix);
    });
    this.boxes.count = race.boxes.length;
    this.boxes.instanceMatrix.needsUpdate = true;

    const missiles = race.weapons.missiles;
    this.missiles.forEach((g, i) => {
      const m = missiles[i];
      g.visible = !!m;
      if (!m) return;
      g.position.set(m.prevX + (m.x - m.prevX) * alpha, 1.1, m.prevY + (m.y - m.prevY) * alpha);
      g.rotation.set(time * 9, -m.heading, 0, 'YXZ');
    });

    let mine = 0;
    let oil = 0;
    for (const h of race.weapons.hazards) {
      const grow = Math.min(1, h.age / 0.25);
      if (h.kind === 'mine' && mine < MAX_MINES) {
        const g = this.mines[mine++];
        g.visible = true;
        g.position.set(h.x, 0.6, h.y);
        g.scale.setScalar(grow);
        // The light blinks once the mine is armed.
        g.children[1].visible = h.age < WEAPON.armDelay || Math.floor(time * 5) % 2 === 0;
      } else if (h.kind === 'oil' && oil < MAX_OIL) {
        const m = this.oils[oil++];
        m.visible = true;
        m.position.set(h.x, 0.08, h.y);
        m.scale.setScalar(grow * Math.min(1, (WEAPON.oilLife - h.age) / 1.5));
      }
    }
    for (let i = mine; i < MAX_MINES; i++) this.mines[i].visible = false;
    for (let i = oil; i < MAX_OIL; i++) this.oils[i].visible = false;

    for (const ring of this.rings) {
      ring.age += dt;
      const t = ring.age / RING_TIME;
      ring.mesh.visible = t < 1;
      if (t >= 1) continue;
      ring.mesh.scale.setScalar(1 + WEAPON.shockRadius * (1 - (1 - t) ** 2));
      (ring.mesh.material as THREE.MeshBasicMaterial).opacity = 0.85 * (1 - t);
    }
  }
}
