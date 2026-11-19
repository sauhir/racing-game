import * as THREE from 'three';
import type { Race } from '../sim/race';
import { WEAPON } from '../sim/weapons';

const MAX_MISSILES = 8;
const MAX_MINES = 40;
const MAX_OIL = 24;
const MAX_PULSES = 12;
const BOX_SIZE = 2.3;

/** White "?" on black: the shader uses it as a mask over its own colours. */
function questionMask(): THREE.Texture {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 128;
  const ctx = cv.getContext('2d')!;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, 128, 128);
  ctx.strokeStyle = '#555';
  ctx.lineWidth = 10;
  ctx.strokeRect(5, 5, 118, 118);
  ctx.fillStyle = '#fff';
  ctx.font = '900 100px "Trebuchet MS", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('?', 64, 70);
  return new THREE.CanvasTexture(cv);
}

const INSTANCE_VERTEX = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vNormal;
  varying vec3 vView;
  varying float vSeed;
  void main() {
    vUv = uv;
    mat4 m = modelMatrix;
    #ifdef USE_INSTANCING
      m = modelMatrix * instanceMatrix;
    #endif
    vec4 world = m * vec4(position, 1.0);
    vNormal = normalize(mat3(m) * normal);
    vView = normalize(cameraPosition - world.xyz);
    vSeed = m[3].x * 0.05 + m[3].z * 0.031;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const HUE = /* glsl */ `
  vec3 hue(float h) {
    return clamp(abs(fract(h + vec3(0.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - 3.0) - 1.0, 0.0, 1.0);
  }
`;

/** Mystery box: a rainbow that sweeps across each face, a glowing rim and a white-hot "?". */
function boxMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { time: { value: 0 }, mask: { value: questionMask() } },
    vertexShader: INSTANCE_VERTEX,
    fragmentShader: /* glsl */ `
      uniform float time;
      uniform sampler2D mask;
      varying vec2 vUv;
      varying vec3 vNormal;
      varying vec3 vView;
      varying float vSeed;
      ${HUE}
      void main() {
        float m = texture2D(mask, vUv).r;
        vec3 base = hue(vSeed + time * 0.35 + (vUv.x + vUv.y) * 0.35);
        // A bright band of light slides diagonally over the faces.
        float sweep = smoothstep(0.12, 0.0, abs(fract((vUv.x - vUv.y) * 0.5 + time * 0.8 + vSeed) - 0.5));
        float rim = pow(1.0 - abs(dot(normalize(vNormal), normalize(vView))), 2.0);
        float pulse = 0.85 + 0.15 * sin(time * 6.0 + vSeed * 20.0);
        vec3 col = base * (0.7 + 0.25 * pulse) + sweep * 0.6 + rim * vec3(0.5) + m * vec3(1.7);
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });
}

/** Column of light standing on each box so they can be spotted from far up the road. */
function beamMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { time: { value: 0 } },
    transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
    vertexShader: INSTANCE_VERTEX,
    fragmentShader: /* glsl */ `
      uniform float time;
      varying vec2 vUv;
      varying float vSeed;
      ${HUE}
      void main() {
        float fade = pow(1.0 - vUv.y, 1.8);
        float streaks = 0.65 + 0.35 * sin(vUv.x * 50.0 + time * 5.0 + vSeed * 9.0);
        float rise = 0.75 + 0.25 * sin(vUv.y * 14.0 - time * 7.0);
        vec3 col = mix(vec3(1.0), hue(vSeed + time * 0.35), 0.75);
        gl_FragColor = vec4(col, fade * streaks * rise * 0.2);
      }
    `,
  });
}

/** Expanding ring or flash: brightest at the leading edge, fading with age. */
function pulseMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { color: { value: new THREE.Color() }, age: { value: 0 }, fill: { value: 0 } },
    transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 color;
      uniform float age;
      uniform float fill;
      varying vec2 vUv;
      void main() {
        float r = length(vUv - 0.5) * 2.0;
        float ring = smoothstep(0.6, 0.93, r) * smoothstep(1.0, 0.95, r);
        float disc = (1.0 - smoothstep(0.0, 1.0, r)) * fill * 0.4;
        float a = (ring + disc) * (1.0 - age) * (1.0 - age);
        gl_FragColor = vec4(color * 1.3, a);
      }
    `,
  });
}

interface Pulse {
  mesh: THREE.Mesh;
  mat: THREE.ShaderMaterial;
  age: number;
  life: number;
  radius: number;
}

/** Mystery boxes and live weapons: missiles, mines, oil slicks, and ring/flash pulses. */
export class WorldItems {
  readonly group = new THREE.Group();
  private readonly boxes: THREE.InstancedMesh;
  private readonly beams: THREE.InstancedMesh;
  private readonly boxMat = boxMaterial();
  private readonly beamMat = beamMaterial();
  private readonly missiles: THREE.Group[] = [];
  private readonly mines: THREE.Group[] = [];
  private readonly oils: THREE.Mesh[] = [];
  private readonly pulses: Pulse[] = [];
  private readonly dummy = new THREE.Object3D();

  constructor(boxCount: number) {
    const count = Math.max(1, boxCount);
    this.boxes = new THREE.InstancedMesh(new THREE.BoxGeometry(BOX_SIZE, BOX_SIZE, BOX_SIZE), this.boxMat, count);
    this.boxes.castShadow = true;
    this.boxes.frustumCulled = false;
    const beamGeo = new THREE.CylinderGeometry(1.5, 1.9, 9, 20, 1, true);
    beamGeo.translate(0, 4.5, 0);
    this.beams = new THREE.InstancedMesh(beamGeo, this.beamMat, count);
    this.beams.frustumCulled = false;
    this.beams.renderOrder = 2;
    this.group.add(this.boxes, this.beams);

    const red = new THREE.MeshStandardMaterial({ color: 0xe8413a, roughness: 0.35 });
    const white = new THREE.MeshStandardMaterial({ color: 0xf7f7fa, roughness: 0.35 });
    const flame = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffa02e).multiplyScalar(2.2) });
    for (let i = 0; i < MAX_MISSILES; i++) {
      const g = new THREE.Group();
      const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.28, 1.3, 4, 10), white);
      body.rotation.z = Math.PI / 2;
      const nose = new THREE.Mesh(new THREE.SphereGeometry(0.3, 10, 8), red);
      nose.scale.x = 1.8;
      nose.position.x = 0.75;
      const jet = new THREE.Mesh(new THREE.SphereGeometry(0.3, 8, 6), flame);
      jet.scale.x = 2.2;
      jet.position.x = -1.2;
      g.add(body, nose, jet);
      for (const [y, z] of [[0.3, 0], [-0.3, 0], [0, 0.3], [0, -0.3]]) {
        const fin = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.08 + Math.abs(y), 0.08 + Math.abs(z)), red);
        fin.position.set(-0.7, y, z);
        g.add(fin);
      }
      g.traverse((o) => (o.castShadow = o !== jet));
      g.visible = false;
      this.missiles.push(g);
      this.group.add(g);
    }

    const mineBody = new THREE.MeshStandardMaterial({ color: 0x3a3f52, roughness: 0.5, flatShading: true });
    const mineLight = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xff3b30).multiplyScalar(2.5) });
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

    const pulseGeo = new THREE.PlaneGeometry(2, 2);
    for (let i = 0; i < MAX_PULSES; i++) {
      const mat = pulseMaterial();
      const mesh = new THREE.Mesh(pulseGeo, mat);
      mesh.rotation.x = -Math.PI / 2;
      mesh.visible = false;
      mesh.renderOrder = 4;
      this.pulses.push({ mesh, mat, age: 1, life: 1, radius: 1 });
      this.group.add(mesh);
    }
  }

  /**
   * A glowing ring racing outward along the ground from (x, z). `fill` (0..1)
   * adds a flash of light inside the ring.
   */
  pulse(x: number, z: number, color: number, radius: number, life = 0.5, fill = 0): void {
    const p = this.pulses.reduce((a, b) => (b.age / b.life > a.age / a.life ? b : a));
    p.age = 0;
    p.life = life;
    p.radius = radius;
    p.mesh.position.set(x, 0.5, z);
    (p.mat.uniforms.color.value as THREE.Color).set(color);
    p.mat.uniforms.fill.value = fill;
  }

  update(race: Race, time: number, alpha: number, dt: number): void {
    this.boxMat.uniforms.time.value = time;
    this.beamMat.uniforms.time.value = time;
    race.boxes.forEach((box, i) => {
      const d = this.dummy;
      // Boxes pop back in, overshooting a little, over the last moments of their respawn timer.
      const t = 1 - box.respawn / 0.5;
      const scale = t <= 0 ? 0.0001 : t < 1 ? t * (1.4 - 0.4 * t) * 1.08 : 1 + Math.sin(time * 5 + i) * 0.06;
      d.position.set(box.x, 2 + Math.sin(time * 2.4 + i) * 0.3, box.y);
      d.rotation.set(0.62, time * 2.2 + i, 0.62);
      d.scale.setScalar(scale);
      d.updateMatrix();
      this.boxes.setMatrixAt(i, d.matrix);
      d.position.set(box.x, 0.1, box.y);
      d.rotation.set(0, time * 0.6 + i, 0);
      d.scale.set(t <= 0 ? 0.0001 : 1, t <= 0 ? 0.0001 : 0.85 + Math.sin(time * 3 + i * 1.7) * 0.15, t <= 0 ? 0.0001 : 1);
      d.updateMatrix();
      this.beams.setMatrixAt(i, d.matrix);
    });
    this.boxes.count = this.beams.count = race.boxes.length;
    this.boxes.instanceMatrix.needsUpdate = true;
    this.beams.instanceMatrix.needsUpdate = true;

    const missiles = race.weapons.missiles;
    this.missiles.forEach((g, i) => {
      const m = missiles[i];
      g.visible = !!m;
      if (!m) return;
      g.position.set(m.prevX + (m.x - m.prevX) * alpha, 1.1, m.prevY + (m.y - m.prevY) * alpha);
      g.rotation.set(time * 9, -m.heading, 0, 'YXZ');
      g.children[2].scale.set(1.6 + Math.random() * 1.2, 1, 1);
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

    for (const p of this.pulses) {
      p.age += dt;
      const t = p.age / p.life;
      p.mesh.visible = t < 1;
      if (t >= 1) continue;
      p.mesh.scale.setScalar(0.5 + p.radius * (1 - (1 - t) ** 3));
      p.mat.uniforms.age.value = t;
    }
  }
}
