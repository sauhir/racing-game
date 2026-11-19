import { describe, expect, it } from 'vitest';
import { CARS, carById } from '../src/data/cars';
import { PLAYER_COLOR, RIVALS } from '../src/data/rivals';
import { TRACKS } from '../src/data/tracks';
import { Car, NO_INPUT, PAD_TIME, TUNING } from '../src/sim/car';
import { applyHit } from '../src/sim/damage';
import { Race, type RaceConfig } from '../src/sim/race';
import { RAMP_HEIGHT, Track, trackProblems } from '../src/sim/track';
import { generateTrack } from '../src/sim/trackGen';

const DT = 1 / 60;
const config = (over: Partial<RaceConfig> = {}): RaceConfig => ({
  laps: 3, playerName: 'You', playerColor: PLAYER_COLOR, rivals: RIVALS, seed: 1, combat: false,
  carFor: (id) => carById(id).stats, ...over,
});

/** Runs a CPU-only race and reports what happened. */
function cpuRace(track: Track) {
  const race = new Race(track, config({ autopilot: true }));
  race.start();
  let steps = 0;
  let offroad = 0;
  const count: Record<string, number> = {};
  while (!race.cars.every((c) => c.finished) && steps++ < 300 * 60) {
    for (const e of race.step(DT, NO_INPUT)) count[e.type] = (count[e.type] ?? 0) + 1;
    for (const c of race.cars) if (c.offroad) offroad++;
  }
  return { race, count, offroad: offroad / (steps * race.cars.length) };
}

describe('tracks', () => {
  it('has one circuit per theme', () => {
    expect(TRACKS.map((t) => t.theme).sort()).toEqual(['beach', 'desert', 'meadow', 'snow']);
  });

  it.each(TRACKS.map((t) => [t.name, t] as const))('%s is drivable and raceable', (_name, def) => {
    const track = new Track(def);
    expect(trackProblems(track)).toEqual([]);
    expect(track.length).toBeGreaterThan(1600);
    expect(track.length).toBeLessThan(2300);
    expect(track.jumps.length).toBeGreaterThan(0);
    expect(track.pads.length).toBeGreaterThan(0);

    const { race, count, offroad } = cpuRace(track);
    expect(race.cars.every((c) => c.finished)).toBe(true);
    expect(count.respawn ?? 0).toBe(0);
    expect(offroad).toBeLessThan(0.05);
    expect(count.jump).toBeGreaterThanOrEqual(18 * track.jumps.length);
    // A car can still be in the air when the last one finishes.
    expect(count.land).toBeGreaterThanOrEqual(count.jump - 6);
    expect(count.land).toBeLessThanOrEqual(count.jump);
    expect(count.pad).toBeGreaterThan(5);
    const times = race.standings().map((c) => c.finishTime);
    expect(times[0]).toBeGreaterThan(95);
    expect(times[5]).toBeLessThan(160);
  });

  it('varies the road width where a track asks for it', () => {
    const desert = new Track(TRACKS.find((t) => t.id === 'desert')!);
    const widths = desert.samples.map((s) => s.hw);
    expect(Math.min(...widths)).toBeLessThan(7.2);
    expect(Math.max(...widths)).toBeGreaterThan(9.8);
    for (const s of desert.samples) {
      expect(s.wall).toBeCloseTo(s.hw + desert.def.verge, 6);
      expect(Math.abs(s.line)).toBeLessThan(s.hw - 2);
    }
  });

  it('reports a track that is too tight or doubles back on itself', () => {
    const tight = new Track({
      id: 't', name: 't', theme: 'meadow', halfWidth: 8, verge: 5, boxRows: [],
      points: [[0, 0], [60, 0], [70, 12], [60, 24], [0, 24], [-10, 12]],
    });
    expect(trackProblems(tight).length).toBeGreaterThan(0);
  });
});

describe('random tracks', () => {
  it('gives the same circuit for the same seed', () => {
    expect(generateTrack(42)).toEqual(generateTrack(42));
    expect(generateTrack(42).points).not.toEqual(generateTrack(43).points);
  });

  it.each([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])('seed %i is a valid circuit', (seed) => {
    const track = new Track(generateTrack(seed));
    expect(trackProblems(track)).toEqual([]);
    expect(track.length).toBeGreaterThan(1600);
    expect(track.length).toBeLessThan(2300);
    // The grid sits on a straight.
    for (let k = -20; k <= 5; k++) expect(Math.abs(track.sample(k).curv)).toBeLessThan(0.012);
  });

  it.each([3, 8])('CPU cars can race seed %i', (seed) => {
    const { race, count, offroad } = cpuRace(new Track(generateTrack(seed)));
    expect(race.cars.every((c) => c.finished)).toBe(true);
    expect(count.respawn ?? 0).toBe(0);
    expect(offroad).toBeLessThan(0.05);
  });
});

describe('jumps and boost pads', () => {
  const track = new Track(TRACKS[0]);

  function approach(index: number, lat: number, speed: number): { race: Race; car: Car } {
    const race = new Race(track, config({ rivals: [] }));
    race.start();
    for (let i = 0; i < 3.1 * 60; i++) race.step(DT, NO_INPUT);
    const car = race.player;
    const s = track.sample(index);
    car.place(s.x + s.nx * lat, s.y + s.ny * lat, Math.atan2(s.ty, s.tx));
    car.sampleIdx = track.wrap(index);
    car.vx = s.tx * speed;
    car.vy = s.ty * speed;
    return { race, car };
  }

  it('launches a fast car off the ramp and lands it further down the road', () => {
    const lip = track.jumps[0];
    const { race, car } = approach(lip - 8, 0, 40);
    const types: string[] = [];
    let maxZ = 0;
    let lifted = 0;
    let airSteps = 0;
    for (let i = 0; i < 3 * 60; i++) {
      for (const e of race.step(DT, { ...NO_INPUT, throttle: 1, steer: car.airborne ? 1 : 0 })) types.push(e.type);
      maxZ = Math.max(maxZ, car.z);
      lifted = Math.max(lifted, car.lift);
      if (car.airborne) airSteps++;
      if (types.includes('land')) break;
    }
    expect(types.filter((t) => t === 'jump')).toHaveLength(1);
    expect(types.at(-1)).toBe('land');
    expect(lifted).toBeGreaterThan(RAMP_HEIGHT * 0.5);
    expect(maxZ).toBeGreaterThan(RAMP_HEIGHT + 1);
    expect(airSteps * DT).toBeGreaterThan(0.6);
    expect(car.z).toBe(0);
    // Steering does nothing in the air, so it lands still pointing down the straight.
    expect(Math.abs(car.lat)).toBeLessThan(3);
    expect(track.wrap(car.sampleIdx - lip) * track.spacing).toBeGreaterThan(20);
  });

  it('does not launch a car crawling over the ramp', () => {
    const { race, car } = approach(track.jumps[0] - 3, 0, 8);
    let jumped = false;
    for (let i = 0; i < 90; i++) {
      if (race.step(DT, NO_INPUT).some((e) => e.type === 'jump')) jumped = true;
    }
    expect(jumped).toBe(false);
    expect(car.z).toBe(0);
  });

  it('boost pads push a car past its normal top speed', () => {
    const pad = track.pads[0];
    const { race, car } = approach(pad.index - 3, pad.lat, TUNING.maxSpeed);
    const events = [];
    for (let i = 0; i < 40; i++) events.push(...race.step(DT, { ...NO_INPUT, throttle: 1 }));
    expect(events.filter((e) => e.type === 'pad')).toHaveLength(1);
    expect(car.pad).toBeGreaterThan(0);
    expect(car.pad).toBeLessThanOrEqual(PAD_TIME);
    expect(car.speed).toBeGreaterThan(TUNING.maxSpeed * 1.05);
  });
});

describe('surfaces and cars', () => {
  it('applies each track surface to the cars', () => {
    const byId = (id: string) => new Race(new Track(TRACKS.find((t) => t.id === id)!), config()).player;
    expect(byId('meadow').gripScale).toBe(1);
    expect(byId('meadow').offroadSpeed).toBe(TUNING.offroadSpeed);
    expect(byId('snow').gripScale).toBeLessThan(1);
    expect(byId('desert').offroadSpeed).toBeLessThan(TUNING.offroadSpeed);
    expect(byId('beach').offroadSpeed).toBeLessThan(TUNING.offroadSpeed);
  });

  it('leaves the standard car exactly as tuned', () => {
    expect(carById('bubble').stats).toMatchObject({
      maxSpeed: TUNING.maxSpeed, accel: TUNING.accel, turnRate: TUNING.turnRate, grip: TUNING.grip, armour: 1,
    });
  });

  it('gives the four cars distinct strengths', () => {
    expect(CARS.map((c) => c.id).sort()).toEqual(['bubble', 'buggy', 'roadster', 'van']);
    const after = (id: string, seconds: number): number => {
      const car = new Car(0, id, 0, true, carById(id).stats);
      for (let i = 0; i < seconds * 60; i++) car.step({ ...NO_INPUT, throttle: 1 }, DT);
      return car.speed;
    };
    expect(after('roadster', 12)).toBeGreaterThan(after('bubble', 12));
    expect(after('bubble', 12)).toBeGreaterThan(after('van', 12));
    expect(after('buggy', 1)).toBeGreaterThan(after('bubble', 1));

    const hurt = (id: string): number => {
      const car = new Car(0, id, 0, true, carById(id).stats);
      applyHit(car, 0.4, 0);
      return 1 - car.health;
    };
    expect(hurt('van')).toBeLessThan(hurt('bubble'));
    expect(hurt('roadster')).toBeGreaterThan(hurt('bubble'));
  });

  it('puts the player and rivals in their own cars', () => {
    const race = new Race(new Track(TRACKS[0]), config({ playerCar: carById('van') }));
    expect(race.player.model).toBe('van');
    expect(race.player.stats).toBe(carById('van').stats);
    expect(race.cars.map((c) => c.model)).toEqual(['roadster', 'bubble', 'buggy', 'van', 'bubble', 'van']);
  });
});
