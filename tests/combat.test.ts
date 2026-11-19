import { describe, expect, it } from 'vitest';
import { makeRng } from '../src/core/rng';
import { PLAYER_COLOR, RIVALS } from '../src/data/rivals';
import { MEADOW } from '../src/data/tracks/meadow';
import { Car, NO_INPUT, TUNING, type CarInput } from '../src/sim/car';
import { applyHit, applyImpact, repair, RESPAWN_IMMUNITY, WRECK_TIME } from '../src/sim/damage';
import { BOX_RESPAWN, makeBoxes, rollPrize, type BoxPrize } from '../src/sim/items';
import { Race, type RaceEvent } from '../src/sim/race';
import { Track } from '../src/sim/track';
import { WEAPON, Weapons } from '../src/sim/weapons';

const DT = 1 / 60;
const track = new Track(MEADOW);

/** Cars lined up along the first straight, `gap` metres apart, the first one leading. */
function convoy(count: number, gap: number, speed = 0): Car[] {
  return Array.from({ length: count }, (_, i) => {
    const car = new Car(i, `C${i}`, 0, i === 0);
    const p = track.pointAt(100 - i * gap, 0);
    car.place(p.x, p.y, p.heading);
    car.sampleIdx = p.index;
    car.lap = 1;
    car.progress = 100 - i * gap;
    car.vx = Math.cos(p.heading) * speed;
    car.vy = Math.sin(p.heading) * speed;
    return car;
  });
}

function run(weapons: Weapons, cars: Car[], seconds: number, input: CarInput = NO_INPUT) {
  const events = [];
  for (let i = 0; i < seconds * 60; i++) {
    for (const c of cars) {
      c.step(input, DT);
      c.sampleIdx = track.nearest(c.x, c.y, c.sampleIdx);
      c.lat = track.lateral(c.sampleIdx, c.x, c.y);
    }
    events.push(...weapons.step(DT, cars, track));
  }
  return events;
}

describe('mystery boxes', () => {
  it('lays rows of boxes across the road', () => {
    const boxes = makeBoxes(track);
    expect(boxes).toHaveLength(MEADOW.boxRows.length * 5);
    for (const b of boxes) {
      const i = track.nearestGlobal(b.x, b.y);
      expect(Math.abs(track.lateral(i, b.x, b.y))).toBeLessThan(track.halfWidth - 1.5);
    }
  });

  it('favours attack items at the back and defensive ones in the lead', () => {
    const tally = (place: number, health = 1): Record<string, number> => {
      const rng = makeRng(3);
      const n: Record<string, number> = {};
      for (let i = 0; i < 4000; i++) {
        const p: BoxPrize = rollPrize(place, 6, health, rng);
        n[p] = (n[p] ?? 0) + 1;
      }
      return n;
    };
    const first = tally(1);
    const last = tally(6);
    expect(last.missile).toBeGreaterThan(first.missile * 3);
    expect(last.nitro).toBeGreaterThan(first.nitro * 2);
    expect(first.mine).toBeGreaterThan(last.mine * 3);
    expect(first.repair).toBeUndefined();
    expect(tally(3, 0.3).repair).toBeGreaterThan(600);
  });

  it('gives one item per car, then respawns the box', () => {
    const race = new Race(track, {
      laps: 3, playerName: 'You', playerColor: PLAYER_COLOR, rivals: RIVALS.slice(0, 1), seed: 2,
    });
    race.start();
    for (let i = 0; i < 3.2 * 60; i++) race.step(DT, NO_INPUT);
    const p = race.player;
    const box = race.boxes[2];
    p.place(box.x, box.y, 0);
    p.sampleIdx = track.nearestGlobal(box.x, box.y);
    const pickups = race.step(DT, NO_INPUT).filter((e) => e.type === 'pickup');
    expect(pickups).toHaveLength(1);
    expect(p.item).not.toBeNull();
    expect(box.respawn).toBe(BOX_RESPAWN);

    // Holding an item, the car leaves other boxes alone.
    const held = p.item;
    const other = race.boxes[3];
    p.place(other.x, other.y, 0);
    race.step(DT, NO_INPUT);
    expect(p.item).toBe(held);
    expect(other.respawn).toBe(0);

    p.place(0, 0, 0);
    p.sampleIdx = 0;
    for (let i = 0; i < (BOX_RESPAWN + 0.1) * 60; i++) race.step(DT, NO_INPUT);
    expect(box.respawn).toBe(0);
  });
});

describe('damage', () => {
  it('slows a damaged car and repairs it', () => {
    const top = (health: number): number => {
      const car = new Car(0, 'A', 0, true);
      car.health = health;
      for (let i = 0; i < 600; i++) car.step({ ...NO_INPUT, throttle: 1 }, DT);
      return car.speed;
    };
    expect(top(1)).toBeGreaterThan(TUNING.maxSpeed * 0.97);
    expect(top(0.1)).toBeLessThan(TUNING.maxSpeed * 0.92);
    expect(top(0.1)).toBeGreaterThan(TUNING.maxSpeed * 0.85);

    const car = new Car(0, 'A', 0, true);
    car.health = 0.3;
    repair(car);
    expect(car.health).toBeCloseTo(0.8, 6);
    repair(car);
    expect(car.health).toBe(1);
  });

  it('only hurts in hard crashes', () => {
    const car = new Car(0, 'A', 0, true);
    expect(applyImpact(car, 12)).toBe('none');
    expect(car.health).toBe(1);
    expect(applyImpact(car, 40)).toBe('hit');
    expect(car.health).toBeLessThan(1);
    expect(car.health).toBeGreaterThan(0.8);
  });

  it('spins a hit car through whole turns, back to its original heading', () => {
    const [car] = convoy(1, 0, 30);
    const heading = car.heading;
    expect(applyHit(car, 0.2, 1.1)).toBe('hit');
    let turned = 0;
    while (car.spin > 0) {
      const before = car.heading;
      car.step({ ...NO_INPUT, throttle: 1, steer: 1 }, DT);
      turned += Math.abs(car.heading - before);
    }
    expect(turned).toBeGreaterThan(Math.PI * 2 - 0.01);
    expect(Math.cos(car.heading - heading)).toBeGreaterThan(0.999);
    expect(car.speed).toBeLessThan(30);
  });

  it('a shield absorbs exactly one hit', () => {
    const car = new Car(0, 'A', 0, true);
    car.shield = 5;
    expect(applyHit(car, 0.4, 1)).toBe('blocked');
    expect(car.health).toBe(1);
    expect(car.spin).toBe(0);
    expect(car.shield).toBe(0);
    expect(applyHit(car, 0.4, 1)).toBe('hit');
    expect(car.health).toBeCloseTo(0.6, 6);
  });

  it('wrecks at zero health, then respawns whole and briefly immune', () => {
    const race = new Race(track, {
      laps: 3, playerName: 'You', playerColor: PLAYER_COLOR, rivals: RIVALS.slice(0, 2), seed: 2,
    });
    race.start();
    for (let i = 0; i < 4 * 60; i++) race.step(DT, { ...NO_INPUT, throttle: 1 });
    const p = race.player;
    p.item = 'mine';
    expect(applyHit(p, 2, 1)).toBe('wreck');
    expect(p.wrecked).toBe(WRECK_TIME);
    expect(p.item).toBeNull();
    expect(applyHit(p, 1, 1)).toBe('none');

    const events: RaceEvent[] = [];
    for (let i = 0; i < 1.9 * 60; i++) events.push(...race.step(DT, { ...NO_INPUT, throttle: 1 }));
    expect(p.wrecked).toBeGreaterThan(0);
    expect(p.speed).toBe(0);
    for (let i = 0; i < 0.2 * 60; i++) events.push(...race.step(DT, NO_INPUT));
    expect(events.some((e) => e.type === 'respawn' && e.car === p)).toBe(true);
    expect(p.wrecked).toBe(0);
    expect(p.health).toBe(1);
    expect(p.invulnerable).toBeGreaterThan(RESPAWN_IMMUNITY - 0.3);
    expect(Math.abs(p.lat)).toBeLessThan(0.1);
    expect(applyHit(p, 1, 1)).toBe('none');
  });
});

describe('weapons', () => {
  it('missile homes in on the car ahead and never hurts its owner', () => {
    const [target, shooter] = convoy(2, 60, 30);
    target.lat = 4;
    const s = track.samples[target.sampleIdx];
    target.x += s.nx * 4;
    target.y += s.ny * 4;
    const weapons = new Weapons();
    shooter.item = 'missile';
    weapons.use(shooter, [target, shooter], track);
    expect(shooter.item).toBeNull();
    expect(weapons.missiles).toHaveLength(1);
    expect(weapons.missiles[0].target).toBe(target);

    const events = run(weapons, [target, shooter], 3, { ...NO_INPUT, throttle: 1 });
    expect(weapons.missiles).toHaveLength(0);
    const struck = events.filter((e) => e.type === 'struck');
    expect(struck).toHaveLength(1);
    expect(struck[0]).toMatchObject({ car: target, by: shooter, weapon: 'missile', result: 'hit' });
    expect(target.health).toBeLessThan(0.8);
    expect(shooter.health).toBe(1);
  });

  it('missile with nobody ahead flies down the road and expires', () => {
    const [leader] = convoy(1, 0);
    const weapons = new Weapons();
    leader.item = 'missile';
    weapons.use(leader, [leader], track);
    expect(weapons.missiles[0].target).toBeNull();
    const events = run(weapons, [leader], WEAPON.missileLife + 0.2);
    expect(weapons.missiles).toHaveLength(0);
    expect(events.filter((e) => e.type === 'explosion')).toHaveLength(1);
    expect(events.some((e) => e.type === 'struck')).toBe(false);
  });

  it('mine arms after the dropper leaves and blasts the next car through', () => {
    const [dropper, chaser] = convoy(2, 40, 30);
    const weapons = new Weapons();
    dropper.item = 'mine';
    weapons.use(dropper, [dropper, chaser], track);
    expect(weapons.hazards).toHaveLength(1);
    const events = run(weapons, [dropper, chaser], 2.5, { ...NO_INPUT, throttle: 1 });
    expect(weapons.hazards).toHaveLength(0);
    expect(dropper.health).toBe(1);
    expect(chaser.health).toBeLessThan(0.8);
    expect(events.filter((e) => e.type === 'explosion')).toHaveLength(1);
  });

  it('oil sends cars sliding but does no damage and stays for the next one', () => {
    const [dropper, a, b] = convoy(3, 30, 30);
    const weapons = new Weapons();
    dropper.item = 'oil';
    weapons.use(dropper, [dropper, a, b], track);
    const events = run(weapons, [dropper, a, b], 3, { ...NO_INPUT, throttle: 1 });
    const oiled = events.filter((e) => e.type === 'oiled').map((e) => (e.type === 'oiled' ? e.car : null));
    expect(oiled).toEqual([a, b]);
    expect(a.health).toBe(1);
    expect(dropper.oiled).toBe(0);
    expect(weapons.hazards).toHaveLength(1);

    const [c] = convoy(1, 0, 30);
    c.oiled = WEAPON.oilTime;
    c.step({ ...NO_INPUT, throttle: 1 }, DT);
    expect(c.drifting).toBe(true);
  });

  it('shockwave shoves and hurts nearby cars only', () => {
    const [far, user, near] = convoy(3, 9);
    far.x += 100;
    const weapons = new Weapons();
    user.item = 'shockwave';
    const events = weapons.use(user, [far, user, near], track);
    expect(events.filter((e) => e.type === 'struck')).toHaveLength(1);
    expect(near.health).toBeCloseTo(1 - WEAPON.shockDamage, 6);
    expect(near.speed).toBeGreaterThan(5);
    expect(far.health).toBe(1);
    expect(far.speed).toBe(0);
    expect(user.health).toBe(1);
  });

  it('shield and nitro apply to the user', () => {
    const [car] = convoy(1, 0);
    const weapons = new Weapons();
    car.item = 'shield';
    weapons.use(car, [car], track);
    expect(car.shield).toBe(WEAPON.shieldTime);
    car.item = 'nitro';
    weapons.use(car, [car], track);
    expect(car.boost).toBe(1);
  });
});

describe('combat races', () => {
  it.each([1, 2, 3])('CPU cars fight their way through a full race (seed %i)', (seed) => {
    const race = new Race(track, {
      laps: 3, playerName: 'You', playerColor: PLAYER_COLOR, rivals: RIVALS, seed, autopilot: true,
    });
    race.start();
    const count: Record<string, number> = {};
    let steps = 0;
    while (!race.cars.every((c) => c.finished) && steps++ < 300 * 60) {
      for (const e of race.step(DT, NO_INPUT)) count[e.type] = (count[e.type] ?? 0) + 1;
      for (const c of race.cars) {
        expect(c.health).toBeGreaterThanOrEqual(0);
        expect(c.health).toBeLessThanOrEqual(1);
      }
    }
    expect(race.cars.every((c) => c.finished)).toBe(true);
    expect(count.pickup).toBeGreaterThan(20);
    expect(count.item).toBeGreaterThan(15);
    expect(count.struck).toBeGreaterThan(5);
    expect(count.explosion).toBeGreaterThan(3);
    const times = race.standings().map((c) => c.finishTime);
    expect(times[0]).toBeGreaterThan(100);
    expect(times[5]).toBeLessThan(200);
  });

  it('fires the held item once per key press', () => {
    const race = new Race(track, {
      laps: 3, playerName: 'You', playerColor: PLAYER_COLOR, rivals: RIVALS.slice(0, 1), seed: 1,
    });
    race.start();
    for (let i = 0; i < 3.2 * 60; i++) race.step(DT, NO_INPUT);
    const p = race.player;
    p.item = 'mine';
    const used = (events: RaceEvent[]) => events.filter((e) => e.type === 'item').length;
    expect(used(race.step(DT, { ...NO_INPUT, useItem: true }))).toBe(1);
    p.item = 'mine';
    expect(used(race.step(DT, { ...NO_INPUT, useItem: true }))).toBe(0);
    race.step(DT, NO_INPUT);
    expect(used(race.step(DT, { ...NO_INPUT, useItem: true }))).toBe(1);
    expect(race.weapons.hazards).toHaveLength(2);
  });
});
