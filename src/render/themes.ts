import type { ThemeId } from '../sim/track';

export interface Theme {
  sky: number;
  fogNear: number;
  fogFar: number;
  ground: number;
  verge: [number, number];
  road: number;
  line: number;
  kerb: [number, number];
  barrier: [number, number];
  sun: number;
  sunIntensity: number;
  hemiSky: number;
  hemiGround: number;
  hemiIntensity: number;
  /** Colours of the dirt thrown up off the road. */
  dirt: [number, number];
}

export const THEMES: Record<ThemeId, Theme> = {
  meadow: {
    sky: 0x8fd3ff, fogNear: 180, fogFar: 620,
    ground: 0x79c257, verge: [0x8ed267, 0x86cc60], road: 0x545a68, line: 0xf4f1e4,
    kerb: [0xe8473d, 0xfafafa], barrier: [0xe8473d, 0xf7f7fa],
    sun: 0xfff2d6, sunIntensity: 2.4, hemiSky: 0xdff3ff, hemiGround: 0x6fae4f, hemiIntensity: 1.5,
    dirt: [0x8a6a42, 0x6fae4f],
  },
  beach: {
    sky: 0x6fd6ff, fogNear: 200, fogFar: 680,
    ground: 0xf3dc9a, verge: [0xf8e6ad, 0xf0dc9c], road: 0x5d6272, line: 0xfff7dc,
    kerb: [0x2fb6e8, 0xfafafa], barrier: [0xff8a3c, 0xfdf6e3],
    sun: 0xfff0c2, sunIntensity: 2.7, hemiSky: 0xe3f6ff, hemiGround: 0xe0c27a, hemiIntensity: 1.5,
    dirt: [0xe8cf8a, 0xd6b96e],
  },
  snow: {
    sky: 0xbfe3f5, fogNear: 140, fogFar: 520,
    ground: 0xf2f7fb, verge: [0xe6f0f7, 0xdde9f2], road: 0x66707f, line: 0xdff1ff,
    kerb: [0x3a7de0, 0xffffff], barrier: [0x3a7de0, 0xffffff],
    sun: 0xfdf6ff, sunIntensity: 2.0, hemiSky: 0xe8f4ff, hemiGround: 0xb8cfe0, hemiIntensity: 1.7,
    dirt: [0xffffff, 0xdcecf7],
  },
  desert: {
    sky: 0xffd9a0, fogNear: 180, fogFar: 600,
    ground: 0xe2a35c, verge: [0xebb06a, 0xe4a760], road: 0x6a6258, line: 0xffe9b8,
    kerb: [0xc9482f, 0xf6e4c3], barrier: [0x8a4a2b, 0xf0d2a0],
    sun: 0xffe2b0, sunIntensity: 2.6, hemiSky: 0xffeccc, hemiGround: 0xc9803f, hemiIntensity: 1.4,
    dirt: [0xd9964e, 0xc98442],
  },
};
