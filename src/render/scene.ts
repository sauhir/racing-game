import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import type { Quality } from '../core/settings';
import type { Theme } from './themes';

const SKY = 0x8fd3ff;

/**
 * Objects tagged with this layer glow; nothing else does. Tag with
 * `object.layers.enable(GLOW_LAYER)` (they stay on the default layer too).
 */
export const GLOW_LAYER = 1;
const glowLayers = new THREE.Layers();
glowLayers.set(GLOW_LAYER);
const BLACK = new THREE.MeshBasicMaterial({ color: 0x000000 });
const BLACK_BACKGROUND = new THREE.Color(0x000000);
const PASS_VERTEX =
  'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }';
const SUN_OFFSET = new THREE.Vector3(45, 90, 30);

/** Renderer, scene and lighting. The sun's shadow box follows a focus point. */
export class View {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(48, 1, 1, 900);
  private readonly sun: THREE.DirectionalLight;
  private readonly hemi: THREE.HemisphereLight;
  private quality: Quality = 'high';
  private readonly glowComposer: EffectComposer;
  private readonly composer: EffectComposer;
  private readonly hidden = new Map<THREE.Mesh, THREE.Material | THREE.Material[]>();

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;

    this.scene.background = new THREE.Color(SKY);
    this.scene.fog = new THREE.Fog(SKY, 180, 620);

    this.hemi = new THREE.HemisphereLight(0xdff3ff, 0x6fae4f, 1.5);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xfff2d6, 2.4);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const cam = this.sun.shadow.camera;
    cam.left = cam.bottom = -75;
    cam.right = cam.top = 75;
    cam.near = 10;
    cam.far = 260;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.04;
    this.scene.add(this.sun, this.sun.target);

    // Selective bloom. First the scene is drawn with everything except the
    // glow-tagged effects painted black, and that image is blurred; then the
    // normal picture is drawn and the blur is added on top. Sunlit paint, snow
    // and sand therefore never glow, however bright they are.
    const hdr = () => new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
    this.glowComposer = new EffectComposer(this.renderer, hdr());
    this.glowComposer.renderToScreen = false;
    this.glowComposer.addPass(new RenderPass(this.scene, this.camera));
    // Scrub invalid or negative pixels before blurring: one bad pixel would
    // otherwise be smeared into a large block.
    this.glowComposer.addPass(
      new ShaderPass(
        new THREE.ShaderMaterial({
          uniforms: { tDiffuse: { value: null } },
          vertexShader: PASS_VERTEX,
          fragmentShader:
            'uniform sampler2D tDiffuse; varying vec2 vUv;' +
            'void main() { vec3 c = texture2D(tDiffuse, vUv).rgb;' +
            ' if (!(c.r >= 0.0 && c.g >= 0.0 && c.b >= 0.0)) c = vec3(0.0);' +
            ' gl_FragColor = vec4(min(c, vec3(4.0)), 1.0); }',
        }),
        'tDiffuse',
      ),
    );
    const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.4, 0.35, 0);
    this.glowComposer.addPass(bloom);

    this.composer = new EffectComposer(this.renderer, hdr());
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    const add = new ShaderPass(
      new THREE.ShaderMaterial({
        // The pass's own blur buffer holds the halo alone. Its final output also
        // contains the glowing objects themselves, which would draw them twice.
        uniforms: { tDiffuse: { value: null }, glow: { value: bloom.renderTargetsHorizontal[0].texture } },
        vertexShader: PASS_VERTEX,
        fragmentShader:
          'uniform sampler2D tDiffuse; uniform sampler2D glow; varying vec2 vUv;' +
          // The comparison is false for invalid (NaN) values, so a bad glow pixel is dropped
          // instead of blacking out the picture.
          'void main() { vec3 g = texture2D(glow, vUv).rgb;' +
          ' if (!(g.r >= 0.0 && g.g >= 0.0 && g.b >= 0.0)) g = vec3(0.0);' +
          ' gl_FragColor = texture2D(tDiffuse, vUv) + vec4(min(g, vec3(4.0)), 0.0); }',
      }),
      'tDiffuse',
    );
    add.needsSwap = true;
    this.composer.addPass(add);
    this.composer.addPass(new OutputPass());

    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  /** Sky, fog and light colours for a track's theme. */
  setTheme(t: Theme): void {
    (this.scene.background as THREE.Color).set(t.sky);
    const fog = this.scene.fog as THREE.Fog;
    fog.color.set(t.sky);
    fog.near = t.fogNear;
    fog.far = t.fogFar;
    this.sun.color.set(t.sun);
    this.sun.intensity = t.sunIntensity;
    this.hemi.color.set(t.hemiSky);
    this.hemi.groundColor.set(t.hemiGround);
    this.hemi.intensity = t.hemiIntensity;
  }

  /** Graphics quality: trades resolution and shadows for speed. */
  setQuality(q: Quality): void {
    this.quality = q;
    const size = q === 'high' ? 2048 : 1024;
    this.sun.castShadow = q !== 'low';
    if (this.sun.shadow.mapSize.x !== size) {
      this.sun.shadow.mapSize.set(size, size);
      this.sun.shadow.map?.dispose();
      this.sun.shadow.map = null;
    }
    this.resize();
  }

  resize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const ratio = this.quality === 'high' ? Math.min(window.devicePixelRatio, 2) : 1;
    this.renderer.setPixelRatio(ratio);
    this.renderer.setSize(w, h, false);
    for (const c of [this.glowComposer, this.composer]) {
      c.setPixelRatio(ratio);
      c.setSize(w, h);
    }
    this.camera.aspect = w / h;
    // Keep a useful view ahead on tall, narrow windows.
    this.camera.fov = w / h < 1 ? 62 : 48;
    this.camera.userData.baseFov = this.camera.fov;
    this.camera.updateProjectionMatrix();
  }

  focus(x: number, z: number): void {
    this.sun.target.position.set(x, 0, z);
    this.sun.position.set(x + SUN_OFFSET.x, SUN_OFFSET.y, z + SUN_OFFSET.z);
  }

  render(): void {
    // Low quality skips the bloom pipeline entirely.
    if (this.quality === 'low') {
      this.renderer.render(this.scene, this.camera);
      return;
    }
    // Glow pass: black out everything that is not tagged to glow (it still
    // hides glowing things behind it), with no sky, fog or shadow work.
    const scene = this.scene;
    const { background, fog } = scene;
    this.scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh && !mesh.layers.test(glowLayers)) {
        this.hidden.set(mesh, mesh.material);
        mesh.material = BLACK;
      }
    });
    scene.background = BLACK_BACKGROUND;
    scene.fog = null;
    this.renderer.shadowMap.autoUpdate = false;
    this.glowComposer.render();
    this.renderer.shadowMap.autoUpdate = true;
    scene.background = background;
    scene.fog = fog;
    for (const [mesh, material] of this.hidden) mesh.material = material;
    this.hidden.clear();

    this.composer.render();
  }
}
