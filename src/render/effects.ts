import * as THREE from 'three';
import type { Car } from '../sim/car';
import type { Missile } from '../sim/weapons';

const MAX_SKID_QUADS = 4000;
const REAR_X = -1.3;
const WHEEL_Z = 1;
const RAINBOW = [0xff3b5c, 0xffa02e, 0xffe14a, 0x4fe36a, 0x38c8ff, 0xb46bff];

interface Particle {
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  life: number; maxLife: number;
  size: number; grow: number; gravity: number;
}

type PoolKind = 'smoke' | 'fire' | 'glow';

/**
 * A fixed pool of instanced blobs. 'smoke' is plain; 'fire' is brighter than
 * white so it blooms, but opaque enough not to stack into a white-out; 'glow'
 * is additive, for small sparks and confetti.
 */
class ParticlePool {
  readonly mesh: THREE.InstancedMesh;
  private readonly particles: Particle[] = [];
  private readonly dummy = new THREE.Object3D();
  private readonly color = new THREE.Color();
  private next = 0;

  constructor(
    private readonly size: number,
    private readonly kind: PoolKind,
  ) {
    const glow = kind === 'glow';
    this.mesh = new THREE.InstancedMesh(
      new THREE.IcosahedronGeometry(0.5, glow ? 1 : 0),
      glow
        ? new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })
        : new THREE.MeshBasicMaterial({ transparent: true, opacity: kind === 'fire' ? 0.9 : 0.8, depthWrite: false }),
      size,
    );
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = glow ? 4 : kind === 'fire' ? 3 : 2;
    this.dummy.scale.setScalar(0);
    this.dummy.updateMatrix();
    for (let i = 0; i < size; i++) {
      this.particles.push({
        x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, life: 0, maxLife: 1, size: 1, grow: 0, gravity: 0,
      });
      this.mesh.setMatrixAt(i, this.dummy.matrix);
      this.mesh.setColorAt(i, this.color.set(0xffffff));
    }
  }

  spawn(
    x: number, y: number, z: number, vx: number, vy: number, vz: number,
    life: number, size: number, grow: number, color: number, gravity = 0,
  ): void {
    const i = this.next;
    this.next = (this.next + 1) % this.size;
    const p = this.particles[i];
    p.x = x; p.y = y; p.z = z;
    p.vx = vx; p.vy = vy; p.vz = vz;
    p.life = p.maxLife = life;
    p.size = size;
    p.grow = grow;
    p.gravity = gravity;
    this.color.set(color);
    // Fire and glow colours are pushed past white so the bloom pass picks them up.
    if (this.kind !== 'smoke') this.color.multiplyScalar(this.kind === 'fire' ? 1.9 : 1.5);
    this.mesh.setColorAt(i, this.color);
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  update(dt: number): void {
    for (let i = 0; i < this.size; i++) {
      const p = this.particles[i];
      if (p.life <= 0) continue;
      p.life -= dt;
      p.vy -= p.gravity * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      p.vx *= 1 - 2 * dt;
      p.vz *= 1 - 2 * dt;
      if (p.y < 0.15 && p.gravity > 0) {
        p.y = 0.15;
        p.vy = Math.abs(p.vy) * 0.45;
      }
      const t = 1 - Math.max(0, p.life) / p.maxLife;
      // Swell with age, then shrink away over the final third.
      const fade = t > 0.66 ? (1 - t) / 0.34 : 1;
      const s = p.life <= 0 ? 0 : Math.max(0, p.size + p.grow * t) * fade;
      this.dummy.position.set(p.x, Math.max(0.15, p.y), p.z);
      this.dummy.scale.setScalar(s);
      this.dummy.updateMatrix();
      this.mesh.setMatrixAt(i, this.dummy.matrix);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  clear(): void {
    for (const p of this.particles) p.life = 0;
    this.dummy.scale.setScalar(0);
    this.dummy.updateMatrix();
    for (let i = 0; i < this.size; i++) this.mesh.setMatrixAt(i, this.dummy.matrix);
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

/**
 * Smoke, dirt and skid marks, plus a glowing additive layer for sparks,
 * flames, confetti and bursts. All pooled, no allocation per frame.
 */
export class Effects {
  readonly group = new THREE.Group();
  private readonly smoke = new ParticlePool(900, 'smoke');
  private readonly fire = new ParticlePool(500, 'fire');
  private readonly glow = new ParticlePool(1800, 'glow');
  /** Colours of the dirt kicked up off the road; set per track theme. */
  dirt: [number, number] = [0x8a6a42, 0x6fae4f];

  private readonly skidPos = new Float32Array(MAX_SKID_QUADS * 18);
  private readonly skidGeo = new THREE.BufferGeometry();
  private skidNext = 0;
  private skidCount = 0;
  private readonly lastWheel = new Map<Car, [number, number, number, number] | null>();
  private readonly emitDebt = new Map<Car, number>();

  constructor() {
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
    this.group.add(skids, this.smoke.mesh, this.fire.mesh, this.glow.mesh);
  }

  /** Sparks from a collision. */
  burst(x: number, z: number, strength: number): void {
    const n = Math.min(40, 10 + Math.floor(strength * 1.5));
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = 5 + Math.random() * 14;
      this.glow.spawn(x, 0.8, z, Math.cos(a) * v, 4 + Math.random() * 8, Math.sin(a) * v,
        0.3 + Math.random() * 0.4, 0.28, -0.2, Math.random() < 0.5 ? 0xffe36b : 0xff9a2e, 26);
    }
  }

  /** Fireball, embers, smoke and sparks for missiles, mines and wrecked cars. */
  explosion(x: number, z: number): void {
    for (let i = 0; i < 34; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = Math.random() * 11;
      this.fire.spawn(x, 0.8 + Math.random() * 1.5, z, Math.cos(a) * v, 2 + Math.random() * 9, Math.sin(a) * v,
        0.35 + Math.random() * 0.45, 1.3, 3.4, [0xfff2a0, 0xffb02e, 0xff5a1a][i % 3]);
    }
    for (let i = 0; i < 40; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = 8 + Math.random() * 22;
      this.glow.spawn(x, 1, z, Math.cos(a) * v, 6 + Math.random() * 16, Math.sin(a) * v,
        0.6 + Math.random() * 0.8, 0.3, -0.1, i % 2 ? 0xffd24a : 0xff7a1a, 30);
    }
    for (let i = 0; i < 18; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = 2 + Math.random() * 6;
      this.smoke.spawn(x, 1.5, z, Math.cos(a) * v, 4 + Math.random() * 5, Math.sin(a) * v,
        0.9 + Math.random() * 0.8, 1.6, 4, 0x3f3f4a);
    }
  }

  /** Rainbow confetti fountain for grabbing a mystery box. */
  pickup(x: number, z: number): void {
    for (let i = 0; i < 70; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = 4 + Math.random() * 13;
      this.glow.spawn(x, 1.6, z, Math.cos(a) * v, 7 + Math.random() * 13, Math.sin(a) * v,
        0.6 + Math.random() * 0.7, 0.34, -0.1, RAINBOW[i % RAINBOW.length], 30);
    }
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2;
      this.glow.spawn(x, 1.6, z, Math.cos(a) * 16, 0.5, Math.sin(a) * 16, 0.3, 0.9, -0.6, 0xffffff);
    }
  }

  /** Twinkles drifting up around a waiting mystery box. */
  sparkle(x: number, z: number, hue: number): void {
    const a = Math.random() * Math.PI * 2;
    const r = 0.8 + Math.random() * 1.4;
    this.glow.spawn(x + Math.cos(a) * r, 0.4 + Math.random() * 2.6, z + Math.sin(a) * r,
      0, 1.2 + Math.random() * 1.5, 0, 0.5 + Math.random() * 0.5, 0.22, -0.1, RAINBOW[hue % RAINBOW.length]);
  }

  /** A ring of sparks thrown outward along the ground (shockwave, shield pop, boost pad). */
  ringBurst(x: number, z: number, color: number, speed: number, count = 36): void {
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2;
      this.glow.spawn(x, 0.7, z, Math.cos(a) * speed, 1 + Math.random() * 2, Math.sin(a) * speed,
        0.35 + Math.random() * 0.2, 0.5, -0.3, color);
    }
  }

  /** Puff of dust and a few sparks where a car lands from a jump. */
  landing(car: Car): void {
    for (let i = 0; i < 14; i++) {
      const a = Math.random() * Math.PI * 2;
      this.smoke.spawn(car.x, 0.4, car.y, car.vx * 0.3 + Math.cos(a) * 6, 1 + Math.random() * 2,
        car.vy * 0.3 + Math.sin(a) * 6, 0.4 + Math.random() * 0.3, 0.7, 2.2, 0xe9edf2);
    }
    for (let i = 0; i < 12; i++) {
      const a = Math.random() * Math.PI * 2;
      this.glow.spawn(car.x, 0.3, car.y, car.vx * 0.5 + Math.cos(a) * 8, 2 + Math.random() * 5,
        car.vy * 0.5 + Math.sin(a) * 8, 0.3 + Math.random() * 0.3, 0.22, 0, 0xffd98a, 26);
    }
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
    const j = () => (Math.random() - 0.5) * 2;
    for (const m of missiles) {
      const bx = m.x - Math.cos(m.heading) * 1.2;
      const bz = m.y - Math.sin(m.heading) * 1.2;
      this.fire.spawn(bx, 1.1, bz, j(), 0.5, j(), 0.22 + Math.random() * 0.15, 0.8, -0.5,
        Math.random() < 0.5 ? 0xffb02e : 0xfff2a0);
      this.smoke.spawn(bx, 1.1, bz, j() * 2, 0.8, j() * 2, 0.5 + Math.random() * 0.3, 0.5, 1.6, 0xf2f4f8);
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

      const sliding = car.slide > 0.25 && !car.offroad && car.speed > 6 && !car.airborne;
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
        if (sliding && Math.random() < 0.25 + car.slide * 0.5) {
          this.smoke.spawn(wx, 0.4, wz, car.vx * 0.15 + j(), 1.5 + Math.random(), car.vy * 0.15 + j(),
            0.5 + Math.random() * 0.4, 0.7, 2.6, 0xf2f4f8);
        }
        // Drift sparks: blue while the boost meter fills, turning hot orange near full.
        if (sliding && car.drifting && car.speed > 15 && Math.random() < 0.7) {
          const hot = car.boost > 0.85 ? 0xff5cf0 : car.boost > 0.5 ? 0xffa02e : 0x4fc8ff;
          this.glow.spawn(wx, 0.25, wz, car.vx * 0.25 + j() * 4, 2 + Math.random() * 4, car.vy * 0.25 + j() * 4,
            0.2 + Math.random() * 0.25, 0.2, 0, hot, 22);
        }
        if (car.offroad && car.speed > 8 && !car.airborne && Math.random() < 0.5) {
          this.smoke.spawn(wx, 0.3, wz, car.vx * 0.2 + j() * 2, 2 + Math.random() * 3, car.vy * 0.2 + j() * 2,
            0.35 + Math.random() * 0.25, 0.5, 0.8, this.dirt[Math.random() < 0.5 ? 0 : 1]);
        }
        // Battered cars trail smoke, then flames, from under the bonnet.
        if (car.health < 0.7 && Math.random() < (1 - car.health) * 0.45) {
          const fire = car.health < 0.3 && Math.random() < 0.5;
          const fx = car.x + ch * 1.2 + j() * 0.3;
          const fz = car.y + sh * 1.2 + j() * 0.3;
          if (fire) {
            this.fire.spawn(fx, 1.2, fz, car.vx * 0.3 + j(), 3 + Math.random() * 2, car.vy * 0.3 + j(),
              0.3, 0.7, 0.4, 0xff8a1f);
          } else {
            this.smoke.spawn(fx, 1.2, fz, car.vx * 0.3 + j(), 3 + Math.random() * 2, car.vy * 0.3 + j(),
              0.7 + Math.random() * 0.4, 0.6, 2.2, car.health < 0.4 ? 0x3c3c46 : 0x8d8f99);
          }
        }
        if (car.boosting || car.pad > 0) {
          const bx = car.x - ch * 2.3;
          const bz = car.y - sh * 2.3;
          const pad = !car.boosting;
          for (let k = 0; k < 2; k++) {
            this.fire.spawn(bx + j() * 0.35, 0.8 + j() * 0.15, bz + j() * 0.35, car.vx - ch * 16, j(),
              car.vy - sh * 16, 0.16 + Math.random() * 0.14, 1.0, -2.2,
              pad ? (k ? 0x7fe9ff : 0x2f9bff) : k ? 0xfff2a0 : 0xff6a1a);
          }
        }
        // A shielded car sheds little cyan motes.
        if (car.shield > 0 && Math.random() < 0.35) {
          const a = Math.random() * Math.PI * 2;
          this.glow.spawn(car.x + Math.cos(a) * 2.4, 0.5 + Math.random() * 2, car.y + Math.sin(a) * 2.4,
            car.vx * 0.8, 1.5, car.vy * 0.8, 0.35, 0.2, -0.1, 0x7ff0ff);
        }
      }
      this.emitDebt.set(car, debt);
    }

    this.smoke.update(dt);
    this.fire.update(dt);
    this.glow.update(dt);
    this.skidGeo.attributes.position.needsUpdate = true;
    this.skidGeo.setDrawRange(0, this.skidCount * 6);
  }

  clear(): void {
    this.skidCount = this.skidNext = 0;
    this.lastWheel.clear();
    this.smoke.clear();
    this.fire.clear();
    this.glow.clear();
  }
}
