import * as THREE from 'three';
import type { Quality } from '../core/settings';
import type { Theme } from './themes';

const SKY = 0x8fd3ff;
const SUN_OFFSET = new THREE.Vector3(45, 90, 30);

/** Renderer, scene and lighting. The sun's shadow box follows a focus point. */
export class View {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(48, 1, 1, 900);
  private readonly sun: THREE.DirectionalLight;
  private readonly hemi: THREE.HemisphereLight;
  private quality: Quality = 'high';

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
    this.renderer.setPixelRatio(this.quality === 'high' ? Math.min(window.devicePixelRatio, 2) : 1);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    // Keep a useful view ahead on tall, narrow windows.
    this.camera.fov = w / h < 1 ? 62 : 48;
    this.camera.updateProjectionMatrix();
  }

  focus(x: number, z: number): void {
    this.sun.target.position.set(x, 0, z);
    this.sun.position.set(x + SUN_OFFSET.x, SUN_OFFSET.y, z + SUN_OFFSET.z);
  }

  render(): void {
    this.renderer.render(this.scene, this.camera);
  }
}
