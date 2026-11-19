import * as THREE from 'three';

const SKY = 0x8fd3ff;
const SUN_OFFSET = new THREE.Vector3(45, 90, 30);

/** Renderer, scene and lighting. The sun's shadow box follows a focus point. */
export class View {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(48, 1, 1, 900);
  private readonly sun: THREE.DirectionalLight;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;

    this.scene.background = new THREE.Color(SKY);
    this.scene.fog = new THREE.Fog(SKY, 180, 620);

    this.scene.add(new THREE.HemisphereLight(0xdff3ff, 0x6fae4f, 1.5));
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

  resize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
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
