import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * GLSL leaves smoothstep(edge0, edge1, x) with edge0 >= edge1, and pow() of a
 * negative base, undefined. Software renderers shrug it off; real GPUs emit
 * invalid pixels, which the bloom blur spreads over the whole screen. These
 * checks read the shader source in the renderer and reject both patterns.
 */
const dir = join(__dirname, '..', 'src', 'render');
const sources = readdirSync(dir)
  .filter((f) => f.endsWith('.ts'))
  .map((f) => ({ file: f, text: readFileSync(join(dir, f), 'utf8') }));

describe('shader source', () => {
  it('finds the shaders it is meant to check', () => {
    const all = sources.map((s) => s.text).join('\n');
    expect((all.match(/smoothstep\(/g) ?? []).length).toBeGreaterThan(4);
    expect((all.match(/\bpow\(/g) ?? []).length).toBeGreaterThan(2);
  });

  it('never calls smoothstep with its edges reversed or equal', () => {
    for (const { file, text } of sources) {
      for (const m of text.matchAll(/smoothstep\(\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,/g)) {
        expect(Number(m[1]), `${file}: ${m[0]}`).toBeLessThan(Number(m[2]));
      }
      // Every smoothstep here uses literal edges, so the check above sees them all.
      const calls = (text.match(/smoothstep\(/g) ?? []).length;
      const literal = [...text.matchAll(/smoothstep\(\s*-?[\d.]+\s*,\s*-?[\d.]+\s*,/g)].length;
      expect(literal, `${file}: smoothstep with non-literal edges`).toBe(calls);
    }
  });

  it('only raises clamped values to a power', () => {
    for (const { file, text } of sources) {
      for (const m of text.matchAll(/\bpow\(([^;]*);/g)) {
        expect(m[1].trimStart().startsWith('clamp('), `${file}: pow(${m[1]}`).toBe(true);
      }
    }
  });
});
