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
const TYRE_GEO = new THREE.CylinderGeometry(1, 1, 1, 14);
const HUB_GEO = new THREE.SphereGeometry(0.3, 12, 8);
const DARK = new THREE.MeshStandardMaterial({ color: 0x2a2d38, roughness: 0.6 });
const HELMET = new THREE.MeshStandardMaterial({ color: 0xfafafa, roughness: 0.3 });
const CAGE_GEO = new THREE.TorusGeometry(0.78, 0.07, 6, 14, Math.PI);
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

interface Wheels {
  radius: number;
  width: number;
  /** [x, z] of each wheel; front wheels have x > 0. */
  at: [number, number][];
}

type Part = [THREE.Material, number, number, number, number, number, number];

function bumper(b: THREE.Group, x: number, y: number, length = 1.5): void {
  const m = new THREE.Mesh(BUMPER_GEO, CHROME);
  m.rotation.x = Math.PI / 2;
  m.scale.y = length / 1.5;
  m.position.set(x, y, 0);
  m.castShadow = true;
  b.add(m);
}

/** Lamps at both ends, mirrored left and right. */
function lamps(b: THREE.Group, front: [number, number, number], rear: [number, number, number]): void {
  for (const side of [1, -1]) {
    b.add(blob(LAMP, 0.16, 0.2, 0.2, front[0], front[1], side * front[2], false));
    b.add(blob(CHROME, 0.14, 0.24, 0.24, front[0] - 0.05, front[1], side * front[2], false));
    b.add(blob(TAIL, 0.1, 0.14, 0.16, rear[0], rear[1], side * rear[2], false));
  }
}

/**
 * Adds painted panels; on the player's car each also gets a racing stripe, a
 * thin slice of the same curved panel made a hair larger.
 */
function panels(b: THREE.Group, paint: THREE.Material, stripe: boolean, list: Part[]): void {
  for (const [, sx, sy, sz, x, y, z] of list) {
    b.add(blob(paint, sx, sy, sz, x, y, z));
    if (stripe) b.add(blob(STRIPE, sx + 0.012, sy + 0.012, 0.2, x, y, z, false));
  }
}

type BodyBuilder = (b: THREE.Group, paint: THREE.Material, stripe: boolean) => Wheels;

/** The four body styles, all built from ellipsoids and pointing along +X. */
const BODIES: Record<string, BodyBuilder> = {
  // Classic bubble car: domed cabin, bulging fenders.
  bubble(b, paint, stripe) {
    panels(b, paint, stripe, [
      [paint, 2.0, 0.6, 0.9, 0, 0.86, 0],
      [paint, 1.0, 0.5, 0.78, 1.0, 1.0, 0],
      [paint, 1.05, 0.55, 0.8, -1.0, 1.02, 0],
      [paint, 1.2, 0.84, 0.84, -0.3, 1.32, 0],
    ]);
    b.add(blob(GLASS, 0.5, 0.42, 0.7, 0.52, 1.56, 0, false));
    b.add(blob(GLASS, 0.42, 0.36, 0.62, -1.16, 1.54, 0, false));
    for (const side of [1, -1]) {
      b.add(blob(GLASS, 0.66, 0.34, 0.3, -0.3, 1.62, side * 0.56, false));
      b.add(blob(paint, 0.8, 0.5, 0.4, 1.28, 0.78, side * 0.8));
      b.add(blob(paint, 0.85, 0.52, 0.4, -1.28, 0.78, side * 0.8));
    }
    lamps(b, [1.93, 0.92, 0.72], [-2.04, 0.9, 0.7]);
    bumper(b, 2.08, 0.56);
    bumper(b, -2.1, 0.56);
    return { radius: 0.5, width: 0.46, at: [[1.3, 0.95], [1.3, -0.95], [-1.3, 0.95], [-1.3, -0.95]] };
  },

  // Tall rounded van.
  van(b, paint, stripe) {
    panels(b, paint, stripe, [
      [paint, 2.05, 0.72, 0.98, 0, 1.0, 0],
      [paint, 1.75, 0.98, 0.93, -0.2, 1.68, 0],
      [paint, 0.75, 0.48, 0.86, 1.45, 0.98, 0],
    ]);
    b.add(blob(GLASS, 0.45, 0.44, 0.78, 1.14, 1.98, 0, false));
    b.add(blob(GLASS, 0.32, 0.42, 0.72, -1.66, 1.92, 0, false));
    for (const side of [1, -1]) {
      b.add(blob(GLASS, 1.05, 0.38, 0.3, -0.2, 2.02, side * 0.66, false));
      b.add(blob(paint, 0.8, 0.5, 0.4, 1.3, 0.8, side * 0.86));
      b.add(blob(paint, 0.82, 0.52, 0.4, -1.3, 0.8, side * 0.86));
    }
    for (const x of [0.35, -0.75]) {
      const rail = new THREE.Mesh(BUMPER_GEO, CHROME);
      rail.rotation.x = Math.PI / 2;
      rail.position.set(x, 2.68, 0);
      b.add(rail);
    }
    lamps(b, [2.08, 0.98, 0.7], [-2.02, 1.0, 0.74]);
    bumper(b, 2.2, 0.58, 1.7);
    bumper(b, -2.1, 0.58, 1.7);
    return { radius: 0.54, width: 0.5, at: [[1.3, 0.98], [1.3, -0.98], [-1.3, 0.98], [-1.3, -0.98]] };
  },

  // Low open-top roadster with a driver.
  roadster(b, paint, stripe) {
    panels(b, paint, stripe, [
      [paint, 2.25, 0.45, 0.92, 0, 0.78, 0],
      [paint, 1.35, 0.4, 0.72, 0.9, 0.9, 0],
      [paint, 0.95, 0.42, 0.8, -1.35, 0.95, 0],
    ]);
    b.add(blob(DARK, 0.72, 0.3, 0.6, -0.3, 1.02, 0, false));
    b.add(blob(GLASS, 0.14, 0.34, 0.62, 0.36, 1.2, 0, false));
    b.add(blob(paint, 0.55, 0.3, 0.28, -1.0, 1.24, 0));
    b.add(blob(HELMET, 0.27, 0.27, 0.27, -0.42, 1.36, 0));
    for (const side of [1, -1]) {
      b.add(blob(paint, 0.72, 0.42, 0.36, 1.4, 0.72, side * 0.84));
      b.add(blob(paint, 0.82, 0.48, 0.38, -1.4, 0.76, side * 0.84));
    }
    lamps(b, [2.1, 0.84, 0.66], [-2.2, 0.9, 0.62]);
    bumper(b, 2.3, 0.5, 1.3);
    bumper(b, -2.32, 0.52, 1.3);
    return { radius: 0.48, width: 0.48, at: [[1.4, 0.96], [1.4, -0.96], [-1.4, 0.96], [-1.4, -0.96]] };
  },

  // Dune buggy: small tub, roll cage, big exposed wheels.
  buggy(b, paint, stripe) {
    panels(b, paint, stripe, [
      [paint, 1.5, 0.46, 0.78, 0, 1.08, 0],
      [paint, 0.75, 0.36, 0.6, 1.15, 1.04, 0],
    ]);
    b.add(blob(DARK, 0.55, 0.42, 0.62, -1.35, 1.2, 0));
    b.add(blob(DARK, 0.55, 0.26, 0.5, -0.3, 1.34, 0, false));
    b.add(blob(HELMET, 0.27, 0.27, 0.27, -0.3, 1.66, 0));
    for (const x of [0.3, -0.85]) {
      const hoop = new THREE.Mesh(CAGE_GEO, CHROME);
      hoop.rotation.y = Math.PI / 2;
      hoop.position.set(x, 1.2, 0);
      hoop.castShadow = true;
      b.add(hoop);
    }
    for (const z of [0.5, -0.5]) {
      const bar = new THREE.Mesh(BUMPER_GEO, CHROME);
      bar.rotation.z = Math.PI / 2;
      bar.scale.y = 0.72;
      bar.position.set(-0.28, 1.78, z);
      b.add(bar);
    }
    lamps(b, [1.78, 1.1, 0.34], [-1.82, 1.2, 0.4]);
    bumper(b, 1.95, 0.8, 1.5);
    return { radius: 0.66, width: 0.56, at: [[1.3, 1.12], [1.3, -1.12], [-1.3, 1.12], [-1.3, -1.12]] };
  },
};

/** A rounded toy car in one of four body styles. */
export class CarMesh {
  readonly root = new THREE.Group();
  private readonly body = new THREE.Group();
  private readonly wheels: THREE.Group[] = [];
  private readonly frontPivots: THREE.Group[] = [];
  private readonly paint: THREE.MeshStandardMaterial;
  private readonly baseColor: THREE.Color;
  private readonly shield: THREE.Mesh;
  private readonly wheelRadius: number;
  private roll = 0;
  private pitch = 0;

  constructor(readonly car: Car) {
    this.baseColor = new THREE.Color(car.color);
    this.paint = new THREE.MeshStandardMaterial({ color: car.color, roughness: 0.32, metalness: 0.08 });
    const spec = (BODIES[car.model] ?? BODIES.bubble)(this.body, this.paint, car.isPlayer);
    this.wheelRadius = spec.radius;
    this.root.add(this.body);

    for (const [x, z] of spec.at) {
      const pivot = new THREE.Group();
      pivot.position.set(x, spec.radius, z);
      const spin = new THREE.Group();
      const tyre = new THREE.Mesh(TYRE_GEO, TYRE);
      tyre.rotation.x = Math.PI / 2;
      tyre.scale.set(spec.radius, spec.width, spec.radius);
      tyre.castShadow = true;
      const hub = new THREE.Mesh(HUB_GEO, CHROME);
      hub.scale.set(spec.radius * 2, spec.radius * 2, 0.5);
      hub.position.z = Math.sign(z) * (spec.width / 2 - 0.07);
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
    const height = c.prevZ + (c.z - c.prevZ) * alpha + c.lift;
    this.root.position.set(x, height, z);
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
    for (const w of this.wheels) w.rotation.z -= (vf / this.wheelRadius) * dt;
    const steer = Math.max(-0.5, Math.min(0.5, c.angVel * 0.35));
    for (const p of this.frontPivots) p.rotation.y = -steer;

    // Lean out of corners and squat under boost.
    const targetRoll = Math.max(-0.16, Math.min(0.16, -c.angVel * 0.07 * Math.min(1, c.speed / 20)));
    this.roll += (targetRoll - this.roll) * Math.min(1, 8 * dt);
    this.body.rotation.x = this.roll;
    // Nose up on the ramp and at take-off, down on the way back to earth.
    const targetPitch = c.lift > 0 ? 0.17 : c.airborne ? Math.max(-0.3, Math.min(0.3, c.vz * 0.03)) : 0;
    this.pitch += (targetPitch - this.pitch) * Math.min(1, 10 * dt);
    this.root.rotation.z = this.pitch;
    this.body.rotation.z = c.boosting || c.pad > 0 ? 0.035 : 0;
  }
}
