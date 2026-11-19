export const TAU = Math.PI * 2;

export const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/** Wrap an angle to (-PI, PI]. */
export function wrapAngle(a: number): number {
  a = a % TAU;
  if (a > Math.PI) a -= TAU;
  else if (a <= -Math.PI) a += TAU;
  return a;
}

export const lerpAngle = (a: number, b: number, t: number): number => a + wrapAngle(b - a) * t;

/** Frame-rate independent smoothing factor. */
export const damp = (rate: number, dt: number): number => 1 - Math.exp(-rate * dt);
