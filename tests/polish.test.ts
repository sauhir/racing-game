import { describe, expect, it } from 'vitest';
import { SONGS } from '../src/audio/songs';
import { Input, type PadLike } from '../src/core/input';
import { DEFAULT_SETTINGS, loadSettings, storeSettings } from '../src/core/settings';
import { TRACKS } from '../src/data/tracks';

function memoryStore(initial?: string) {
  let value: string | null = initial ?? null;
  return {
    getItem: () => value,
    setItem: (_k: string, v: string) => {
      value = v;
    },
  };
}

describe('settings', () => {
  it('defaults when nothing is stored or storage is missing', () => {
    expect(loadSettings(memoryStore())).toEqual(DEFAULT_SETTINGS);
    expect(loadSettings(undefined)).toEqual(DEFAULT_SETTINGS);
  });

  it('round-trips through storage', () => {
    const store = memoryStore();
    storeSettings({ music: 0.2, sfx: 0, quality: 'low' }, store);
    expect(loadSettings(store)).toEqual({ music: 0.2, sfx: 0, quality: 'low' });
  });

  it('replaces malformed values with defaults, field by field', () => {
    expect(loadSettings(memoryStore('not json'))).toEqual(DEFAULT_SETTINGS);
    expect(loadSettings(memoryStore('null'))).toEqual(DEFAULT_SETTINGS);
    expect(loadSettings(memoryStore('{"music":7,"sfx":"loud","quality":"ultra"}'))).toEqual(DEFAULT_SETTINGS);
    expect(loadSettings(memoryStore('{"music":0.3,"sfx":-1,"quality":"medium"}'))).toEqual({
      music: 0.3, sfx: DEFAULT_SETTINGS.sfx, quality: 'medium',
    });
  });

  it('survives storage that throws', () => {
    const broken = {
      getItem: (): string => {
        throw new Error('blocked');
      },
      setItem: (): void => {
        throw new Error('full');
      },
    };
    expect(loadSettings(broken)).toEqual(DEFAULT_SETTINGS);
    expect(() => storeSettings(DEFAULT_SETTINGS, broken)).not.toThrow();
  });
});

/** A fake keyboard target and a fake gamepad that tests can poke. */
function rig() {
  const handlers: Record<string, (e: { code: string; repeat: boolean; preventDefault(): void }) => void> = {};
  const target = {
    addEventListener: (type: string, fn: unknown) => {
      handlers[type] = fn as (typeof handlers)[string];
    },
  } as unknown as Pick<Window, 'addEventListener'>;
  const pad = {
    buttons: Array.from({ length: 16 }, () => ({ pressed: false, value: 0 })),
    axes: [0, 0, 0, 0],
  };
  let connected = true;
  const input = new Input(target, () => (connected ? [null, pad as PadLike] : [null]));
  return {
    input, pad,
    unplug: () => (connected = false),
    press: (i: number, value = 1) => (pad.buttons[i] = { pressed: value > 0.5, value }),
    release: (i: number) => (pad.buttons[i] = { pressed: false, value: 0 }),
    key: (type: 'keydown' | 'keyup', code: string) => handlers[type]({ code, repeat: false, preventDefault() {} }),
  };
}

describe('gamepad input', () => {
  it('steers with the stick (dead zone, proportional) and drives with the triggers', () => {
    const r = rig();
    r.pad.axes[0] = 0.1;
    r.input.poll('race');
    expect(r.input.car().steer).toBe(0);
    expect(r.input.gamepadSeen).toBe(true);

    r.pad.axes[0] = -0.575;
    r.press(7, 0.6);
    r.press(6, 0.25);
    r.input.poll('race');
    const c = r.input.car();
    expect(c.steer).toBeCloseTo(-0.5, 6);
    expect(c.throttle).toBeCloseTo(0.6, 6);
    expect(c.brake).toBeCloseTo(0.25, 6);

    r.pad.axes[0] = 1;
    r.input.poll('race');
    expect(r.input.car().steer).toBeCloseTo(1, 6);
  });

  it('maps face buttons to handbrake, boost and reset while racing', () => {
    const r = rig();
    r.press(0);
    r.press(2);
    r.press(3);
    r.input.poll('race');
    expect(r.input.car()).toMatchObject({ handbrake: true, boost: true, useItem: false });
    expect(r.input.take('KeyR')).toBe(true);
    expect(r.input.take('Enter')).toBe(false);
    r.release(0);
    r.release(2);
    r.input.poll('race');
    expect(r.input.car()).toMatchObject({ handbrake: false, boost: false });
  });

  it('fires the item once per press of B, and pauses with Start', () => {
    const r = rig();
    r.press(1);
    r.input.poll('race');
    expect(r.input.car().useItem).toBe(true);
    expect(r.input.take('Escape')).toBe(false);
    r.release(1);
    r.input.poll('race');
    expect(r.input.car().useItem).toBe(false);

    r.press(9);
    r.input.poll('race');
    expect(r.input.take('Escape')).toBe(true);
  });

  it('gives one menu press per push, from the d-pad or the stick', () => {
    const r = rig();
    r.press(13);
    r.input.poll('menu');
    expect(r.input.take('ArrowDown')).toBe(true);
    r.input.endFrame();
    r.input.poll('menu');
    expect(r.input.take('ArrowDown')).toBe(false);
    r.release(13);
    r.input.poll('menu');

    r.pad.axes[1] = -0.9;
    r.input.poll('menu');
    expect(r.input.take('ArrowUp')).toBe(true);
    r.input.endFrame();
    r.input.poll('menu');
    expect(r.input.take('ArrowUp')).toBe(false);
    r.pad.axes[1] = 0;
    r.input.poll('menu');
    r.pad.axes[0] = 0.9;
    r.input.poll('menu');
    expect(r.input.take('ArrowRight')).toBe(true);
  });

  it('uses A to confirm and B to go back in menus, without leaking into the race', () => {
    const r = rig();
    r.press(0);
    r.input.poll('menu');
    expect(r.input.take('Enter')).toBe(true);
    r.input.endFrame();
    // Still holding A as the race begins: no fresh press, but it is the handbrake now.
    r.input.poll('race');
    expect(r.input.take('Enter')).toBe(false);
    expect(r.input.car().handbrake).toBe(true);
    r.release(0);

    r.press(1);
    r.input.poll('menu');
    expect(r.input.take('Escape')).toBe(true);
    expect(r.input.car().useItem).toBe(false);
  });

  it('resumes with Start and quits with B when paused', () => {
    const r = rig();
    r.press(9);
    r.input.poll('pause');
    expect(r.input.take('Escape')).toBe(true);
    r.release(9);
    r.press(1);
    r.input.poll('pause');
    expect(r.input.take('Backspace')).toBe(true);
  });

  it('keeps the keyboard working alongside, and copes with the pad vanishing', () => {
    const r = rig();
    r.key('keydown', 'ArrowUp');
    r.key('keydown', 'ArrowLeft');
    r.pad.axes[0] = 0.8;
    r.input.poll('race');
    expect(r.input.car()).toMatchObject({ throttle: 1, steer: -1 });
    r.key('keyup', 'ArrowLeft');
    r.input.poll('race');
    expect(r.input.car().steer).toBeGreaterThan(0.5);

    r.key('keydown', 'KeyE');
    r.key('keyup', 'KeyE');
    expect(r.input.car().useItem).toBe(true);
    expect(r.input.car().useItem).toBe(false);

    r.unplug();
    r.input.poll('race');
    expect(r.input.car()).toMatchObject({ throttle: 1, steer: 0, brake: 0 });
  });
});

describe('songs', () => {
  it('has a tune for every track theme and for the menus', () => {
    for (const t of TRACKS) expect(SONGS[t.theme]).toBeDefined();
    expect(SONGS.menu).toBeDefined();
    expect(new Set(Object.values(SONGS).map((s) => s.bpm)).size).toBeGreaterThan(3);
  });

  it.each(Object.entries(SONGS))('%s is well formed', (_id, song) => {
    expect(song.bpm).toBeGreaterThan(60);
    expect(song.bpm).toBeLessThan(200);
    expect(song.melody.length % 16).toBe(0);
    expect(song.melody.length).toBe(song.chords.length * 16);
    for (const pattern of [song.kick, song.snare, song.hat, song.bass, song.arp]) expect(pattern).toHaveLength(16);
    for (const chord of song.chords) expect(chord).toHaveLength(3);
    for (const m of song.melody) {
      expect(m).toBeGreaterThanOrEqual(-1);
      expect(m).toBeLessThan(song.scale.length);
    }
    for (const a of song.arp) {
      expect(a).toBeGreaterThanOrEqual(-1);
      expect(a).toBeLessThan(3);
    }
    for (const note of [...song.scale, ...song.chords.flat()]) {
      expect(note).toBeGreaterThan(30);
      expect(note).toBeLessThan(100);
    }
    expect(song.melody.some((m) => m >= 0)).toBe(true);
  });

  it('keeps the menu tune calmer than the race tunes', () => {
    expect(SONGS.menu.bpm).toBeLessThan(Math.min(SONGS.meadow.bpm, SONGS.beach.bpm, SONGS.snow.bpm, SONGS.desert.bpm));
    expect(SONGS.menu.snare.every((v) => v === 0)).toBe(true);
  });
});
