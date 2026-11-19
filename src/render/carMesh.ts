import * as THREE from 'three';
import { lerpAngle } from '../core/math';
import type { Car } from '../sim/car';

const GLASS = new THREE.MeshLambertMaterial({ color: 0x24324f });
const TYRE = new THREE.MeshLambertMaterial({ color: 0x23232b });
const HUB = new THREE.MeshLambertMaterial({ color: 0xe8ecf2 });
const LAMP = new THREE.MeshBasicMaterial({ color: 0xfff6c8 });
const TAIL = new THREE.MeshBasicMaterial({ color: 0xff3b30 });
const TRIM = new THREE.MeshLambertMaterial({ color: 0xf7f7fa });

function box(w: number, h: number, d: number, mat: THREE.Material, x: number, y: number, z: number): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  return m;
}

/** Chunky low-poly toy car, pointing along +X, built entirely from primitives. */
export class CarMesh {
  readonly root = new THREE.Group();
  private readonly body = new THREE.Group();
  private readonly wheels: THREE.Group[] = [];
  private readonly frontPivots: THREE.Group[] = [];
  private roll = 0;

  constructor(readonly car: Car) {
    const paint = new THREE.MeshLambertMaterial({ color: car.color });
    const b = this.body;
    b.add(box(4.1, 0.62, 1.95, paint, 0, 0.72, 0));
    b.add(box(1.2, 0.3, 1.8, paint, 1.35, 1.1, 0));
    b.add(box(1.9, 0.62, 1.6, GLASS, -0.3, 1.3, 0));
    b.add(box(1.6, 0.12, 1.66, paint, -0.3, 1.66, 0));
    b.add(box(0.5, 0.1, 2.1, paint, -2.0, 1.5, 0));
    b.add(box(0.12, 0.45, 0.12, TRIM, -1.95, 1.25, 0.7));
    b.add(box(0.12, 0.45, 0.12, TRIM, -1.95, 1.25, -0.7));
    b.add(box(0.3, 0.3, 2.05, TRIM, 2.05, 0.56, 0));
    b.add(box(0.3, 0.3, 2.05, TRIM, -2.05, 0.56, 0));
    b.add(box(0.1, 0.22, 0.42, LAMP, 2.08, 0.86, 0.62));
    b.add(box(0.1, 0.22, 0.42, LAMP, 2.08, 0.86, -0.62));
    b.add(box(0.1, 0.2, 0.5, TAIL, -2.08, 0.86, 0.62));
    b.add(box(0.1, 0.2, 0.5, TAIL, -2.08, 0.86, -0.62));
    if (car.isPlayer) {
      b.add(box(4.14, 0.02, 0.5, TRIM, 0, 1.04, 0));
      b.add(box(1.62, 0.02, 0.5, TRIM, -0.3, 1.73, 0));
    }
    this.root.add(b);

    const tyreGeo = new THREE.CylinderGeometry(0.5, 0.5, 0.42, 10);
    const hubGeo = new THREE.CylinderGeometry(0.24, 0.24, 0.44, 6);
    for (const [x, z] of [[1.3, 1], [1.3, -1], [-1.3, 1], [-1.3, -1]]) {
      const pivot = new THREE.Group();
      pivot.position.set(x, 0.5, z);
      const spin = new THREE.Group();
      const tyre = new THREE.Mesh(tyreGeo, TYRE);
      tyre.rotation.x = Math.PI / 2;
      tyre.castShadow = true;
      const hub = new THREE.Mesh(hubGeo, HUB);
      hub.rotation.x = Math.PI / 2;
      spin.add(tyre, hub);
      pivot.add(spin);
      this.root.add(pivot);
      this.wheels.push(spin);
      if (x > 0) this.frontPivots.push(pivot);
    }
  }

  /** Sync with the simulation, interpolating between the last two physics steps. */
  update(alpha: number, dt: number): void {
    const c = this.car;
    const x = c.prevX + (c.x - c.prevX) * alpha;
    const z = c.prevY + (c.y - c.prevY) * alpha;
    const heading = lerpAngle(c.prevHeading, c.heading, alpha);
    this.root.position.set(x, 0, z);
    this.root.rotation.y = -heading;

    const vf = c.forwardSpeed;
    for (const w of this.wheels) w.rotation.z -= (vf / 0.5) * dt;
    const steer = Math.max(-0.5, Math.min(0.5, c.angVel * 0.35));
    for (const p of this.frontPivots) p.rotation.y = -steer;

    // Lean out of corners and squat under boost.
    const targetRoll = Math.max(-0.16, Math.min(0.16, -c.angVel * 0.07 * Math.min(1, c.speed / 20)));
    this.roll += (targetRoll - this.roll) * Math.min(1, 8 * dt);
    this.body.rotation.x = this.roll;
    this.body.rotation.z = c.boosting ? 0.035 : 0;
  }
}
