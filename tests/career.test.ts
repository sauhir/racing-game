import { describe, expect, it } from 'vitest';
import {
  buyCar, buyUpgrade, CAR_PRICE, CUPS, cupUnlocked, newSave, POINTS, recordRace, selectCar, startCup, statsFor,
  tierPace, tierRivals, trackForRace, UPGRADE_COST, upgradeCost, upgradedStats,
} from '../src/career/career';
import { carById } from '../src/data/cars';
import { RIVALS } from '../src/data/rivals';
import { TRACKS } from '../src/data/tracks';
import { BASE_STATS, Car, NO_INPUT, TUNING } from '../src/sim/car';
import { Race } from '../src/sim/race';
import { reverseTrack, Track, trackProblems } from '../src/sim/track';

const DT = 1 / 60;
const NAMES = ['Dot', 'Blaze', 'Zippy', 'Tank', 'Rusty'];

describe('garage', () => {
  it('starts with the standard car and a little money', () => {
    const save = newSave();
    expect(save.car).toBe('bubble');
    expect(Object.keys(save.garage)).toEqual(['bubble']);
    expect(statsFor(save, 'bubble')).toEqual(BASE_STATS);
  });

  it('buys cars and upgrades only when affordable', () => {
    const save = newSave();
    save.money = 100;
    expect(buyCar(save, 'roadster')).toBe(false);
    expect(buyUpgrade(save, 'bubble', 'engine')).toBe(false);
    expect(selectCar(save, 'roadster')).toBe(false);

    save.money = CAR_PRICE.roadster + UPGRADE_COST[0] + UPGRADE_COST[1] + 10;
    expect(buyCar(save, 'roadster')).toBe(true);
    expect(save.car).toBe('roadster');
    expect(buyCar(save, 'roadster')).toBe(false);
    expect(buyUpgrade(save, 'roadster', 'engine')).toBe(true);
    expect(buyUpgrade(save, 'roadster', 'engine')).toBe(true);
    expect(save.money).toBe(10);
    expect(save.garage.roadster.engine).toBe(2);
    expect(save.garage.bubble.engine).toBe(0);
    expect(upgradeCost(save, 'roadster', 'engine')).toBe(UPGRADE_COST[2]);
    expect(buyUpgrade(save, 'roadster', 'engine')).toBe(false);
    expect(buyUpgrade(save, 'van', 'engine')).toBe(false);
    expect(selectCar(save, 'bubble')).toBe(true);
  });

  it('stops upgrades at the top level', () => {
    const save = newSave();
    save.money = 1e6;
    for (let i = 0; i < 3; i++) expect(buyUpgrade(save, 'bubble', 'nitro')).toBe(true);
    expect(upgradeCost(save, 'bubble', 'nitro')).toBeNull();
    expect(buyUpgrade(save, 'bubble', 'nitro')).toBe(false);
  });

  it('keeps upgrades mild and leaves grip (the drift feel) alone', () => {
    const max = upgradedStats(BASE_STATS, { engine: 3, tyres: 3, armour: 3, nitro: 3 });
    expect(max.grip).toBe(BASE_STATS.grip);
    expect(max.maxSpeed / BASE_STATS.maxSpeed).toBeCloseTo(1.06, 6);
    expect(max.accel / BASE_STATS.accel).toBeCloseTo(1.15, 6);
    expect(max.turnRate / BASE_STATS.turnRate).toBeLessThan(1.08);
    expect(max.armour).toBeCloseTo(0.7, 6);

    const top = (stats = BASE_STATS): number => {
      const car = new Car(0, 'A', 0, true, stats);
      for (let i = 0; i < 900; i++) car.step({ ...NO_INPUT, throttle: 1 }, DT);
      return car.speed;
    };
    expect(top(max)).toBeGreaterThan(top() * 1.05);
    expect(top(max)).toBeLessThan(top() * 1.07);

    // Nitro upgrades stretch a full meter.
    const burn = (stats = BASE_STATS): number => {
      const car = new Car(0, 'A', 0, true, stats);
      car.boost = 1;
      let t = 0;
      while (car.boost > 0 && t < 20) {
        car.step({ ...NO_INPUT, throttle: 1, boost: true }, DT);
        t += DT;
      }
      return t;
    };
    expect(burn()).toBeCloseTo(1 / TUNING.boostDrain, 1);
    expect(burn(max)).toBeGreaterThan(burn() * 1.25);
  });
});

describe('cups', () => {
  it('has three tiers of four races on real tracks', () => {
    expect(CUPS.map((c) => c.tier)).toEqual([0, 1, 2]);
    for (const cup of CUPS) {
      expect(cup.races).toHaveLength(4);
      for (const spec of cup.races) expect(trackProblems(new Track(trackForRace(spec)))).toEqual([]);
    }
  });

  it('awards points and prize money, and keeps a running table', () => {
    const save = newSave();
    const money = save.money;
    startCup(save, CUPS[0]);
    const first = recordRace(save, ['You', ...NAMES], 'You');
    expect(first).toMatchObject({ place: 1, points: 10, prize: 500, cupDone: false });
    expect(save.money).toBe(money + 500);
    expect(save.progress).toMatchObject({ cup: 'rookie', next: 1 });

    const second = recordRace(save, [...NAMES, 'You'], 'You');
    expect(second).toMatchObject({ place: 6, points: 1, prize: 50 });
    expect(second.standings[0]).toEqual({ name: 'Dot', points: POINTS[1] + POINTS[0] });
    expect(second.standings.find((s) => s.name === 'You')?.points).toBe(11);
    expect(second.standings.reduce((sum, s) => sum + s.points, 0)).toBe(2 * POINTS.reduce((a, b) => a + b));
  });

  it('carries on with a cup in progress rather than restarting it', () => {
    const save = newSave();
    startCup(save, CUPS[0]);
    recordRace(save, ['You', ...NAMES], 'You');
    expect(startCup(save, CUPS[0]).next).toBe(1);
    expect(startCup(save, CUPS[0]).points.You).toBe(10);
  });

  it('a podium finishes the cup with a trophy, a bonus and the next tier unlocked', () => {
    const save = newSave();
    expect(cupUnlocked(save, CUPS[0])).toBe(true);
    expect(cupUnlocked(save, CUPS[1])).toBe(false);
    startCup(save, CUPS[0]);
    let outcome = recordRace(save, ['You', ...NAMES], 'You');
    for (let i = 0; i < 3; i++) outcome = recordRace(save, ['You', ...NAMES], 'You');
    expect(outcome).toMatchObject({ cupDone: true, cupPlace: 1, bonus: 1500, unlocked: 'Pro Cup' });
    expect(save.trophies.rookie).toBe(1);
    expect(save.progress).toBeNull();
    expect(save.money).toBe(300 + 4 * 500 + 1500);
    expect(cupUnlocked(save, CUPS[1])).toBe(true);
    expect(cupUnlocked(save, CUPS[2])).toBe(false);

    // A worse replay keeps the best trophy and announces nothing new.
    startCup(save, CUPS[0]);
    for (let i = 0; i < 4; i++) outcome = recordRace(save, [...NAMES, 'You'], 'You');
    expect(outcome).toMatchObject({ cupDone: true, cupPlace: 6, bonus: 0 });
    expect(outcome.unlocked).toBeUndefined();
    expect(save.trophies.rookie).toBe(1);
  });

  it('missing the podium does not unlock the next cup', () => {
    const save = newSave();
    startCup(save, CUPS[0]);
    let outcome = recordRace(save, [...NAMES.slice(0, 3), 'You', ...NAMES.slice(3)], 'You');
    for (let i = 0; i < 3; i++) outcome = recordRace(save, [...NAMES.slice(0, 3), 'You', ...NAMES.slice(3)], 'You');
    expect(outcome.cupPlace).toBe(4);
    expect(cupUnlocked(save, CUPS[1])).toBe(false);
  });

  it('pays more in higher tiers', () => {
    const save = newSave();
    save.trophies = { rookie: 1, pro: 1 };
    startCup(save, CUPS[2]);
    expect(recordRace(save, ['You', ...NAMES], 'You').prize).toBe(1000);
  });

  it('makes rivals tougher tier by tier, with the middle tier as the standard field', () => {
    expect(tierRivals(1)).toEqual(RIVALS);
    expect(tierPace(0)).toBeLessThan(tierPace(1));
    expect(tierPace(2)).toBeGreaterThan(tierPace(1));
    tierRivals(0).forEach((p, i) => {
      expect(p.skill).toBeLessThan(RIVALS[i].skill);
      expect(p.errorRate).toBeGreaterThan(RIVALS[i].errorRate);
    });
    tierRivals(2).forEach((p, i) => {
      expect(p.skill).toBeGreaterThanOrEqual(RIVALS[i].skill);
      expect(p.errorRate).toBeLessThan(RIVALS[i].errorRate);
      expect(p.skill).toBeLessThanOrEqual(1);
    });
  });
});

describe('reversed tracks', () => {
  it.each(TRACKS.map((t) => [t.name, t] as const))('%s can be raced the other way', (_n, def) => {
    const rev = reverseTrack(def);
    const fwd = new Track(def);
    const track = new Track(rev);
    expect(trackProblems(track)).toEqual([]);
    expect(track.length).toBeCloseTo(fwd.length, 0);
    expect(track.jumps).toHaveLength(fwd.jumps.length);
    // Same start line, opposite direction.
    expect(track.samples[0].x).toBeCloseTo(fwd.samples[0].x, 6);
    expect(track.samples[0].tx).toBeCloseTo(-fwd.samples[0].tx, 1);

    const race = new Race(track, {
      laps: 3, playerName: 'You', playerColor: 0, rivals: tierRivals(2), pace: tierPace(2), seed: 4,
      combat: false, autopilot: true, carFor: (id) => carById(id).stats,
    });
    race.start();
    let steps = 0;
    let respawns = 0;
    let jumps = 0;
    while (!race.cars.every((c) => c.finished) && steps++ < 300 * 60) {
      for (const e of race.step(DT, NO_INPUT)) {
        if (e.type === 'respawn') respawns++;
        if (e.type === 'jump') jumps++;
      }
    }
    expect(race.cars.every((c) => c.finished)).toBe(true);
    expect(respawns).toBe(0);
    expect(jumps).toBeGreaterThanOrEqual(18 * track.jumps.length);
  });
});
