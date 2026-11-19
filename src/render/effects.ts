import * as THREE from 'three';
import type { Car } from '../sim/car';
import type { Missile } from '../sim/weapons';

const MAX_PARTICLES = 700;
const MAX_SKID_QUADS = 4000;
const REAR_X = -1.3;
const WHEEL_Z = 1;

interface Particle {
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  life: number; maxLife: number;
  size: number; grow: number;
}

/** Tyre smoke, boost flames, dirt, sparks and skid marks. All pooled, no allocation per frame. */
export class Effects {
  readonly group = new THREE.Group();
  private readonly particles: Particle[] = [];
  private readonly mesh: THREE.InstancedMesh;
  private readonly dummy = new THREE.Object3D();
  private readonly color = new THREE.Color();
  private next = 0;

  private readonly skidPos = new Float32Array(MAX_SKID_QUADS * 18);
  private readonly skidGeo = new THREE.BufferGeometry();
  private skidNext = 0;
  private skidCount = 0;
  private readonly lastWheel = new Map<Car, [number, number, number, number] | null>();
  private readonly emitDebt = new Map<Car, number>();

  constructor() {
    this.mesh = new THREE.InstancedMesh(
      new THREE.IcosahedronGeometry(0.5, 0),
      new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.8, depthWrite: false }),
      MAX_PARTICLES,
    );
    this.mesh.frustumCulled = false;
    this.dummy.scale.setScalar(0);
    this.dummy.updateMatrix();
    for (let i = 0; i < MAX_PARTICLES; i++) {
      this.particles.push({ x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, life: 0, maxLife: 1, size: 1, grow: 0 });
      this.mesh.setMatrixAt(i, this.dummy.matrix);
      this.mesh.setColorAt(i, this.color.set(0xffffff));
    }

    this.skidGeo.setAttribute('position', new THREE.BufferAttribute(this.skidPos, 3));
    this.skidGeo.setDrawRange(0, 0);
    const skids = new THREE.Mesh(
      this.skidGeo,
      new THREE.MeshBasicMaterial({
        color: 0x1b1c22, transparent: true, opacity: 0.4, depthWrite: false, side: THREE.DoubleSide,
        polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
      }),
    );
    skids.frustumCulled = false;
    this.group.add(skids, this.mesh);
  }

  private spawn(
    x: number, y: number, z: number, vx: number, vy: number, vz: number,
    life: number, size: number, grow: number, color: number,
  ): void {
    const i = this.next;
    this.next = (this.next + 1) % MAX_PARTICLES;
    const p = this.particles[i];
    p.x = x; p.y = y; p.z = z;
    p.vx = vx; p.vy = vy; p.vz = vz;
    p.life = p.maxLife = life;
    p.size = size;
    p.grow = grow;
    this.mesh.setColorAt(i, this.color.set(color));
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  burst(x: number, z: number, strength: number): void {
    const n = Math.min(24, 6 + Math.floor(strength));
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = 4 + Math.random() * 10;
      this.spawn(x, 0.8, z, Math.cos(a) * v, 3 + Math.random() * 6, Math.sin(a) * v,
        0.25 + Math.random() * 0.3, 0.35, -0.5, Math.random() < 0.5 ? 0xffe36b : 0xff9a2e);
    }
  }

  /** Fireball, smoke and sparks for missiles, mines and wrecked cars. */
  explosion(x: number, z: number): void {
    for (let i = 0; i < 26; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = Math.random() * 9;
      this.spawn(x, 0.8 + Math.random(), z, Math.cos(a) * v, 2 + Math.random() * 7, Math.sin(a) * v,
        0.35 + Math.random() * 0.35, 1.2, 3.2, [0xfff2a0, 0xffb02e, 0xff6a1a][i % 3]);
    }
    for (let i = 0; i < 12; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = 2 + Math.random() * 5;
      this.spawn(x, 1.5, z, Math.cos(a) * v, 4 + Math.random() * 4, Math.sin(a) * v,
        0.8 + Math.random() * 0.6, 1.4, 3.5, 0x4a4a55);
    }
    this.burst(x, z, 20);
  }

  private addSkid(ax: number, az: number, bx: number, bz: number): void {
    const dx = bx - ax;
    const dz = bz - az;
    const len = Math.hypot(dx, dz);
    if (len < 0.01 || len > 6) return;
    const px = (-dz / len) * 0.2;
    const pz = (dx / len) * 0.2;
    const o = this.skidNext * 18;
    const y = 0.07;
    const v = [
      ax - px, y, az - pz, ax + px, y, az + pz, bx - px, y, bz - pz,
      ax + px, y, az + pz, bx + px, y, bz + pz, bx - px, y, bz - pz,
    ];
    this.skidPos.set(v, o);
    this.skidNext = (this.skidNext + 1) % MAX_SKID_QUADS;
    this.skidCount = Math.min(MAX_SKID_QUADS, this.skidCount + 1);
  }

  /** Emit from the cars' current state, then advance all particles. */
  update(cars: readonly Car[], missiles: readonly Missile[], dt: number): void {
    for (const m of missiles) {
      this.spawn(m.x, 1.1, m.y, (Math.random() - 0.5) * 2, 0.5, (Math.random() - 0.5) * 2,
        0.3 + Math.random() * 0.2, 0.5, 1.2, Math.random() < 0.3 ? 0xffb02e : 0xf2f4f8);
    }
    for (const car of cars) {
      if (car.wrecked > 0) {
        this.lastWheel.set(car, null);
        continue;
      }
      const ch = Math.cos(car.heading);
      const sh = Math.sin(car.heading);
      const wheel = (side: number): [number, number] => [
        car.x + ch * REAR_X - sh * WHEEL_Z * side,
        car.y + sh * REAR_X + ch * WHEEL_Z * side,
      ];
      const [lx, lz] = wheel(1);
      const [rx, rz] = wheel(-1);

      const sliding = car.slide > 0.25 && !car.offroad && car.speed > 6;
      const last = this.lastWheel.get(car);
      if (sliding) {
        if (last) {
          this.addSkid(last[0], last[1], lx, lz);
          this.addSkid(last[2], last[3], rx, rz);
        }
        this.lastWheel.set(car, [lx, lz, rx, rz]);
      } else if (last) {
        this.lastWheel.set(car, null);
      }

      let debt = (this.emitDebt.get(car) ?? 0) + dt * 60;
      while (debt >= 1) {
        debt -= 1;
        const side = Math.random() < 0.5 ? 1 : -1;
        const [wx, wz] = side > 0 ? [lx, lz] : [rx, rz];
        const j = () => (Math.random() - 0.5) * 2;
        if (sliding && Math.random() < 0.25 + car.slide * 0.5) {
          this.spawn(wx, 0.4, wz, car.vx * 0.15 + j(), 1.5 + Math.random(), car.vy * 0.15 + j(),
            0.5 + Math.random() * 0.4, 0.7, 2.6, 0xf2f4f8);
        }
        if (car.offroad && car.speed > 8 && Math.random() < 0.5) {
          this.spawn(wx, 0.3, wz, car.vx * 0.2 + j() * 2, 2 + Math.random() * 3, car.vy * 0.2 + j() * 2,
            0.35 + Math.random() * 0.25, 0.5, 0.8, Math.random() < 0.5 ? 0x8a6a42 : 0x6fae4f);
        }
        // Battered cars trail smoke, then flames, from under the bonnet.
        if (car.health < 0.7 && Math.random() < (1 - car.health) * 0.45) {
          const fire = car.health < 0.3 && Math.random() < 0.5;
          this.spawn(car.x + ch * 1.2 + j() * 0.3, 1.2, car.y + sh * 1.2 + j() * 0.3,
            car.vx * 0.3 + j(), 3 + Math.random() * 2, car.vy * 0.3 + j(),
            fire ? 0.3 : 0.7 + Math.random() * 0.4, fire ? 0.7 : 0.6, fire ? 0.6 : 2.2,
            fire ? 0xff8a1f : car.health < 0.4 ? 0x3c3c46 : 0x8d8f99);
        }
        if (car.boosting) {
          const bx = car.x - ch * 2.3;
          const bz = car.y - sh * 2.3;
          this.spawn(bx + j() * 0.3, 0.8, bz + j() * 0.3, car.vx - ch * 14, j(), car.vy - sh * 14,
            0.16 + Math.random() * 0.12, 0.9, -2, Math.random() < 0.4 ? 0xfff2a0 : 0xff7a1a);
        }
      }
      this.emitDebt.set(car, debt);
    }

    for (let i = 0; i < MAX_PARTICLES; i++) {
      const p = this.particles[i];
      if (p.life <= 0) continue;
      p.life -= dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      p.vx *= 1 - 2 * dt;
      p.vz *= 1 - 2 * dt;
      const t = 1 - Math.max(0, p.life) / p.maxLife;
      // Swell with age, then shrink away over the final third.
      const fade = t > 0.66 ? (1 - t) / 0.34 : 1;
      const s = p.life <= 0 ? 0 : Math.max(0, p.size + p.grow * t) * fade;
      this.dummy.position.set(p.x, Math.max(0.2, p.y), p.z);
      this.dummy.scale.setScalar(s);
      this.dummy.updateMatrix();
      this.mesh.setMatrixAt(i, this.dummy.matrix);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    this.skidGeo.attributes.position.needsUpdate = true;
    this.skidGeo.setDrawRange(0, this.skidCount * 6);
  }

  clear(): void {
    this.skidCount = this.skidNext = 0;
    this.lastWheel.clear();
    for (const p of this.particles) p.life = 0;
    this.dummy.scale.setScalar(0);
    this.dummy.updateMatrix();
    for (let i = 0; i < MAX_PARTICLES; i++) this.mesh.setMatrixAt(i, this.dummy.matrix);
  }
}
