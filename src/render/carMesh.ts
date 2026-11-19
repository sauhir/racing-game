import * as THREE from 'three';
import { lerpAngle } from '../core/math';
import type { Car } from '../sim/car';

const SPHERE = new THREE.SphereGeometry(1, 24, 16);
const GLASS = new THREE.MeshStandardMaterial({ color: 0x1c2a44, roughness: 0.15, metalness: 0.3 });
const TYRE = new THREE.MeshLambertMaterial({ color: 0x23232b });
const CHROME = new THREE.MeshStandardMaterial({ color: 0xeef1f6, roughness: 0.25, metalness: 0.5 });
const LAMP = new THREE.MeshBasicMaterial({ color: 0xfff6c8 });
const TAIL = new THREE.MeshBasicMaterial({ color: 0xff3b30 });
const STRIPE = new THREE.MeshStandardMaterial({ color: 0xfafafa, roughness: 0.4 });
const SHIELD = new THREE.MeshBasicMaterial({
  color: 0x6fe8ff, transparent: true, opacity: 0.32, depthWrite: false,
});
const TYRE_GEO = new THREE.CylinderGeometry(0.5, 0.5, 0.46, 14);
const HUB_GEO = new THREE.SphereGeometry(0.3, 12, 8);
const BUMPER_GEO = new THREE.CapsuleGeometry(0.1, 1.5, 4, 10);

/** An ellipsoid: the building block for every curved body panel. */
function blob(
  mat: THREE.Material, sx: number, sy: number, sz: number, x: number, y: number, z: number, shadow = true,
): THREE.Mesh {
  const m = new THREE.Mesh(SPHERE, mat);
  m.scale.set(sx, sy, sz);
  m.position.set(x, y, z);
  m.castShadow = shadow;
  return m;
}

/** Rounded bubble car with a domed cabin and bulging fenders, pointing along +X. */
export class CarMesh {
  readonly root = new THREE.Group();
  private readonly body = new THREE.Group();
  private readonly wheels: THREE.Group[] = [];
  private readonly frontPivots: THREE.Group[] = [];
  private readonly paint: THREE.MeshStandardMaterial;
  private readonly baseColor: THREE.Color;
  private readonly shield: THREE.Mesh;
  private roll = 0;

  constructor(readonly car: Car) {
    this.baseColor = new THREE.Color(car.color);
    const paint = (this.paint = new THREE.MeshStandardMaterial({ color: car.color, roughness: 0.32, metalness: 0.08 }));
    const b = this.body;

    // Shell, bonnet, sloping tail and the cabin dome.
    b.add(blob(paint, 2.0, 0.6, 0.9, 0, 0.86, 0));
    b.add(blob(paint, 1.0, 0.5, 0.78, 1.0, 1.0, 0));
    b.add(blob(paint, 1.05, 0.55, 0.8, -1.0, 1.02, 0));
    b.add(blob(paint, 1.2, 0.84, 0.84, -0.3, 1.32, 0));

    // Glass poking just proud of the dome: windscreen, rear window, side windows.
    b.add(blob(GLASS, 0.5, 0.42, 0.7, 0.52, 1.56, 0, false));
    b.add(blob(GLASS, 0.42, 0.36, 0.62, -1.16, 1.54, 0, false));
    for (const side of [1, -1]) {
      b.add(blob(GLASS, 0.66, 0.34, 0.3, -0.3, 1.62, side * 0.56, false));
    }

    // Fenders bulging over each wheel, with the lamps set into them.
    for (const side of [1, -1]) {
      b.add(blob(paint, 0.8, 0.5, 0.4, 1.28, 0.78, side * 0.8));
      b.add(blob(paint, 0.85, 0.52, 0.4, -1.28, 0.78, side * 0.8));
      b.add(blob(LAMP, 0.16, 0.2, 0.2, 1.93, 0.92, side * 0.72, false));
      b.add(blob(CHROME, 0.14, 0.24, 0.24, 1.88, 0.92, side * 0.72, false));
      b.add(blob(TAIL, 0.1, 0.14, 0.16, -2.04, 0.9, side * 0.7, false));
    }

    for (const x of [2.08, -2.1]) {
      const bumper = new THREE.Mesh(BUMPER_GEO, CHROME);
      bumper.rotation.x = Math.PI / 2;
      bumper.position.set(x, 0.56, 0);
      bumper.castShadow = true;
      b.add(bumper);
    }

    if (car.isPlayer) {
      // Racing stripe: thin slices of the same curved panels, a hair larger.
      b.add(blob(STRIPE, 2.012, 0.612, 0.2, 0, 0.86, 0, false));
      b.add(blob(STRIPE, 1.012, 0.512, 0.2, 1.0, 1.0, 0, false));
      b.add(blob(STRIPE, 1.062, 0.562, 0.2, -1.0, 1.02, 0, false));
      b.add(blob(STRIPE, 1.212, 0.852, 0.2, -0.3, 1.32, 0, false));
    }
    this.root.add(b);

    for (const [x, z] of [[1.3, 0.95], [1.3, -0.95], [-1.3, 0.95], [-1.3, -0.95]]) {
      const pivot = new THREE.Group();
      pivot.position.set(x, 0.5, z);
      const spin = new THREE.Group();
      const tyre = new THREE.Mesh(TYRE_GEO, TYRE);
      tyre.rotation.x = Math.PI / 2;
      tyre.castShadow = true;
      const hub = new THREE.Mesh(HUB_GEO, CHROME);
      hub.scale.set(1, 1, 0.5);
      hub.position.z = Math.sign(z) * 0.16;
      spin.add(tyre, hub);
      pivot.add(spin);
      this.root.add(pivot);
      this.wheels.push(spin);
      if (x > 0) this.frontPivots.push(pivot);
    }

    this.shield = new THREE.Mesh(SPHERE, SHIELD);
    this.shield.scale.set(3, 2.2, 2.4);
    this.shield.position.y = 1;
    this.shield.visible = false;
    this.root.add(this.shield);
  }

  /** Sync with the simulation, interpolating between the last two physics steps. */
  update(alpha: number, dt: number, time: number): void {
    const c = this.car;
    const x = c.prevX + (c.x - c.prevX) * alpha;
    const z = c.prevY + (c.y - c.prevY) * alpha;
    const heading = lerpAngle(c.prevHeading, c.heading, alpha);
    this.root.position.set(x, 0, z);
    this.root.rotation.y = -heading;

    // Gone while wrecked; blinking while briefly invulnerable after a respawn.
    this.root.visible = c.wrecked <= 0 && !(c.invulnerable > 0 && Math.floor(time * 12) % 2 === 0);
    this.shield.visible = c.shield > 0;
    if (c.shield > 0) {
      const pulse = 1 + Math.sin(time * 9) * 0.04;
      this.shield.scale.set(3 * pulse, 2.2 * pulse, 2.4 * pulse);
      // Flicker as it runs out.
      this.shield.visible = c.shield > 1.5 || Math.floor(time * 10) % 2 === 0;
    }
    // Paint gets sooty as the car takes damage.
    const soot = (1 - c.health) * 0.55;
    this.paint.color.copy(this.baseColor).multiplyScalar(1 - soot);

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
