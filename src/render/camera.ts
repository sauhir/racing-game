import * as THREE from 'three';
import { damp, lerpAngle, wrapAngle } from '../core/math';

const HEIGHT = 27;
const BACK = 17;

/** Tilted chase camera: sits above and behind the car, swinging round with it. */
export class ChaseCamera {
  private heading = 0;
  private zoom = 0;
  private shake = 0;
  private readonly target = new THREE.Vector3();
  private first = true;

  constructor(private readonly camera: THREE.PerspectiveCamera) {}

  snap(): void {
    this.first = true;
  }

  addShake(amount: number): void {
    this.shake = Math.min(1.2, this.shake + amount);
  }

  update(
    x: number, z: number, heading: number, vx: number, vz: number, boosting: boolean, dt: number,
  ): void {
    const speed = Math.hypot(vx, vz);
    // Mostly follow the direction of travel, not the nose, so the view stays
    // steady while the car hangs sideways in a drift.
    if (speed > 6) {
      const travel = Math.atan2(vz, vx);
      const slip = wrapAngle(heading - travel);
      if (Math.abs(slip) < Math.PI / 2) heading = travel + slip * 0.35;
    }
    if (this.first) {
      this.heading = heading;
      this.zoom = 0;
      this.first = false;
    }
    this.heading = lerpAngle(this.heading, heading, damp(3, dt));
    this.zoom += ((boosting ? 1.5 : speed / 46) - this.zoom) * damp(2.5, dt);
    this.shake *= Math.exp(-6 * dt);

    const fx = Math.cos(this.heading);
    const fz = Math.sin(this.heading);
    const back = BACK + this.zoom * 5;
    const height = HEIGHT + this.zoom * 7;
    const ahead = 5 + this.zoom * 7;
    const sx = (Math.random() - 0.5) * this.shake;
    const sz = (Math.random() - 0.5) * this.shake;
    this.camera.position.set(x - fx * back + sx, height, z - fz * back + sz);
    this.target.set(x + fx * ahead + sx, 0, z + fz * ahead + sz);
    this.camera.lookAt(this.target);
  }

  /** Slow circling shot for the title screen. */
  orbit(x: number, z: number, t: number, radius = 30, height = 16, lookDown = 0): void {
    const a = t * 0.25;
    this.camera.position.set(x + Math.cos(a) * radius, height, z + Math.sin(a) * radius);
    // Aiming below the subject lifts it clear of menus at the bottom of the screen.
    this.target.set(x, 1 + lookDown, z);
    this.camera.lookAt(this.target);
    this.first = true;
  }
}
