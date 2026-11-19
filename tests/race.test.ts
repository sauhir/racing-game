import { describe, expect, it } from 'vitest';
import { PLAYER_COLOR, RIVALS } from '../src/data/rivals';
import { MEADOW } from '../src/data/tracks/meadow';
import { NO_INPUT } from '../src/sim/car';
import { Race, type RaceConfig, type RaceEvent } from '../src/sim/race';
import { Track } from '../src/sim/track';
import { formatTime, ordinal } from '../src/ui/hud';

const DT = 1 / 60;
const track = new Track(MEADOW);
const config = (over: Partial<RaceConfig> = {}): RaceConfig => ({
  laps: 3, playerName: 'You', playerColor: PLAYER_COLOR, rivals: RIVALS, seed: 1, combat: false, ...over,
});

describe('Race', () => {
  it('lines the grid up behind the start line with the player last', () => {
    const race = new Race(track, config());
    expect(race.cars).toHaveLength(6);
    expect(race.placeOf(race.player)).toBe(6);
    for (const car of race.cars) {
      expect(car.progress).toBeLessThan(0);
      expect(Math.abs(car.lat)).toBeLessThan(track.halfWidth);
      expect(race.lapOf(car)).toBe(1);
    }
  });

  it('holds the cars until the countdown ends', () => {
    const race = new Race(track, config({ autopilot: true }));
    expect(race.step(DT, NO_INPUT)).toEqual([]);
    race.start();
    const events: RaceEvent[] = [];
    for (let i = 0; i < 2.9 * 60; i++) events.push(...race.step(DT, NO_INPUT));
    expect(race.phase).toBe('countdown');
    expect(events.map((e) => (e.type === 'count' ? e.n : e.type))).toEqual([3, 2, 1]);
    expect(race.cars.every((c) => c.speed === 0)).toBe(true);
    for (let i = 0; i < 0.2 * 60; i++) events.push(...race.step(DT, NO_INPUT));
    expect(race.phase).toBe('racing');
    expect(events.at(-1)?.type).toBe('go');
  });

  it.each([1, 2, 3, 4])('CPU cars complete a clean three-lap race (seed %i)', (seed) => {
    const race = new Race(track, config({ seed, autopilot: true }));
    race.start();
    let laps = 0;
    let offroad = 0;
    let respawns = 0;
    let steps = 0;
    while (!race.cars.every((c) => c.finished) && steps < 240 * 60) {
      for (const e of race.step(DT, NO_INPUT)) {
        if (e.type === 'lap') laps++;
        if (e.type === 'respawn') respawns++;
      }
      for (const c of race.cars) if (c.offroad) offroad++;
      steps++;
    }
    expect(race.cars.every((c) => c.finished)).toBe(true);
    expect(laps).toBe(6 * 2);
    expect(respawns).toBe(0);
    expect(offroad / (steps * 6)).toBeLessThan(0.05);

    const order = race.standings();
    const times = order.map((c) => c.finishTime);
    expect([...times].sort((a, b) => a - b)).toEqual(times);
    // Roughly two-minute races, with the pack kept close together.
    expect(times[0]).toBeGreaterThan(90);
    expect(times[5]).toBeLessThan(160);
    expect(times[5] - times[0]).toBeLessThan(15);
  });

  it('respawns a stranded player on the road', () => {
    const race = new Race(track, config());
    race.start();
    for (let i = 0; i < 4 * 60; i++) race.step(DT, { ...NO_INPUT, throttle: 1, steer: 1 });
    race.respawn(race.player);
    expect(race.player.speed).toBe(0);
    expect(Math.abs(race.player.lat)).toBeLessThan(0.01);
  });
});

describe('formatting', () => {
  it('formats times and ordinals', () => {
    expect(formatTime(0)).toBe('0:00.0');
    expect(formatTime(83.46)).toBe('1:23.5');
    expect([1, 2, 3, 4, 11, 12, 13, 21].map((n) => n + ordinal(n))).toEqual(
      ['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st'],
    );
  });
});
