import { clamp } from '../core/math';
import { makeRng, type Rng } from '../core/rng';
import type { Personality } from '../data/rivals';
import { AIDriver } from './ai/driver';
import { BASE_STATS, Car, NO_INPUT, PAD_TIME, type CarInput, type CarStats } from './car';
import { collideCars, collideWall } from './collision';
import { applyImpact, repair, RESPAWN_IMMUNITY } from './damage';
import { BOX_RADIUS, BOX_RESPAWN, makeBoxes, rollPrize, type BoxPrize, type ItemType, type PickupBox } from './items';
import { PAD_HALF_LENGTH, PAD_HALF_WIDTH, RAMP_HEIGHT, type Track } from './track';
import { Weapons, type WeaponEvent } from './weapons';

export type RaceEvent =
  | { type: 'count'; n: number }
  | { type: 'go' }
  | { type: 'hit'; x: number; y: number; strength: number; player: boolean; wall: boolean }
  | { type: 'lap'; car: Car }
  | { type: 'finish'; car: Car }
  | { type: 'respawn'; car: Car }
  | { type: 'pickup'; car: Car; prize: BoxPrize }
  | { type: 'item'; car: Car; item: ItemType }
  | { type: 'wreck'; car: Car }
  | { type: 'jump'; car: Car }
  | { type: 'land'; car: Car }
  | { type: 'pad'; car: Car }
  | WeaponEvent;

export type RacePhase = 'grid' | 'countdown' | 'racing';

export interface RaceConfig {
  laps: number;
  playerName: string;
  playerColor: number;
  /** The player's car: body style id and its stats. Defaults to the standard car. */
  playerCar?: { id: string; stats: CarStats };
  /** Looks up a rival's car by the id on their personality. */
  carFor?: (id: string) => CarStats;
  rivals: Personality[];
  seed: number;
  /** Maximum CPU top-speed change from rubber-banding (0.06 = 6%). */
  rubberBand?: number;
  /** Multiplier on every rival's pace (career tiers); 1 is the standard field. */
  pace?: number;
  /** No human: the player's car gets a CPU driver too (demo and tests). */
  autopilot?: boolean;
  /** Mystery boxes, weapons and damage. On unless set to false. */
  combat?: boolean;
}

const GRID_GAP = 7;
const GRID_LATERAL = 3.2;
const COUNTDOWN = 3;
const AUTOPILOT: Personality = {
  name: 'Autopilot', color: 0, skill: 0.8, aggression: 0.5, errorRate: 0.02, drift: 0.6, boostAt: 0.5, itemUse: 0.6, car: 'bubble',
};

export class Race {
  readonly cars: Car[] = [];
  readonly player: Car;
  readonly laps: number;
  phase: RacePhase = 'grid';
  /** Seconds since the green light. */
  time = 0;
  countdown = COUNTDOWN;
  /** Seconds the player has been driving against the flow. */
  wrongWay = 0;

  private readonly drivers = new Map<Car, AIDriver>();
  private readonly baseScale = new Map<Car, number>();
  private readonly rubberBand: number;
  private finishers = 0;
  readonly combat: boolean;
  readonly boxes: PickupBox[];
  readonly weapons = new Weapons();
  private readonly prizeRng: Rng;

  constructor(
    readonly track: Track,
    config: RaceConfig,
  ) {
    this.laps = config.laps;
    this.rubberBand = config.rubberBand ?? 0.06;
    const rng = makeRng(config.seed);
    this.combat = config.combat ?? true;
    this.boxes = this.combat ? makeBoxes(track) : [];
    this.prizeRng = makeRng(config.seed * 7919 + 13);

    config.rivals.forEach((p, i) => {
      const car = new Car(i, p.name, p.color, false, config.carFor?.(p.car) ?? BASE_STATS);
      car.model = p.car;
      this.cars.push(car);
      this.drivers.set(car, new AIDriver(p, makeRng(Math.floor(rng() * 1e9))));
      this.baseScale.set(car, (0.9 + 0.1 * p.skill) * (config.pace ?? 1));
    });
    // The player starts at the back of the grid and has to earn it.
    this.player = new Car(
      this.cars.length, config.playerName, config.playerColor, true, config.playerCar?.stats ?? BASE_STATS,
    );
    this.player.model = config.playerCar?.id ?? 'bubble';
    this.cars.push(this.player);
    this.baseScale.set(this.player, 1);
    if (config.autopilot) this.drivers.set(this.player, new AIDriver(AUTOPILOT, makeRng(Math.floor(rng() * 1e9))));

    this.cars.forEach((car, slot) => {
      car.gripScale = track.def.grip ?? 1;
      if (track.def.offroadSpeed) car.offroadSpeed = track.def.offroadSpeed;
      const lateral = slot % 2 === 0 ? GRID_LATERAL : -GRID_LATERAL;
      const p = track.pointAt(track.length - 10 - slot * GRID_GAP, lateral);
      car.place(p.x, p.y, p.heading);
      car.sampleIdx = p.index;
      car.lap = 0;
      this.updateProgress(car);
    });
  }

  start(): void {
    if (this.phase === 'grid') this.phase = 'countdown';
  }

  /** Cars ordered from first to last place. */
  standings(): Car[] {
    return [...this.cars].sort((a, b) => {
      if (a.finished && b.finished) return a.finishTime - b.finishTime;
      if (a.finished !== b.finished) return a.finished ? -1 : 1;
      return b.progress - a.progress;
    });
  }

  placeOf(car: Car): number {
    return this.standings().indexOf(car) + 1;
  }

  /** Lap number to display for a car (1-based, capped at the race length). */
  lapOf(car: Car): number {
    return clamp(car.lap, 1, this.laps);
  }

  respawn(car: Car): void {
    const s = this.track.samples[car.sampleIdx];
    car.place(s.x, s.y, Math.atan2(s.ty, s.tx));
    car.stuckTime = 0;
    this.updateProgress(car);
  }

  step(dt: number, playerInput: CarInput): RaceEvent[] {
    const events: RaceEvent[] = [];
    if (this.phase === 'grid') return events;

    if (this.phase === 'countdown') {
      const before = Math.ceil(this.countdown);
      this.countdown -= dt;
      const after = Math.ceil(this.countdown);
      if (this.countdown <= 0) {
        this.phase = 'racing';
        events.push({ type: 'go' });
      } else if (after !== before || before === COUNTDOWN && this.countdown + dt >= COUNTDOWN) {
        events.push({ type: 'count', n: after });
      }
      for (const car of this.cars) car.step(NO_INPUT, dt);
      return events;
    }

    this.time += dt;
    const track = this.track;

    const world = this.combat ? { boxes: this.boxes, missiles: this.weapons.missiles } : undefined;
    for (const car of this.cars) {
      if (car.wrecked > 0) {
        car.step(NO_INPUT, dt);
        car.wrecked -= dt;
        if (car.wrecked <= 0) {
          car.wrecked = 0;
          this.respawn(car);
          car.health = 1;
          car.invulnerable = RESPAWN_IMMUNITY;
          events.push({ type: 'respawn', car });
        }
        continue;
      }
      const driver = this.drivers.get(car);
      let input = playerInput;
      if (driver) {
        input = driver.update(car, track, this.cars, dt, world);
        let scale = this.baseScale.get(car) ?? 1;
        if (!car.isPlayer && !car.finished) {
          const gap = car.progress - this.player.progress;
          scale *= 1 - clamp(gap / 150, -1, 1) * this.rubberBand;
        }
        car.speedScale = car.finished ? 0.75 : scale;
      }
      // Fire on the press. A press made while spinning out is kept until it can fire.
      if (!input.useItem) {
        car.usePrev = false;
      } else if (this.combat && !car.usePrev && car.item && car.spin <= 0 && !car.finished) {
        const item = car.item;
        car.usePrev = true;
        events.push({ type: 'item', car, item }, ...this.weapons.use(car, this.cars, track));
      }
      car.step(input, dt);
    }

    for (let i = 0; i < this.cars.length; i++) {
      for (let j = i + 1; j < this.cars.length; j++) {
        const a = this.cars[i];
        const b = this.cars[j];
        if (a.wrecked > 0 || b.wrecked > 0) continue;
        const hit = collideCars(a, b);
        if (hit > 2) {
          events.push({
            type: 'hit', x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, strength: hit,
            player: a.isPlayer || b.isPlayer, wall: false,
          });
          if (this.combat) {
            for (const car of [a, b]) if (applyImpact(car, hit) === 'wreck') this.wreck(car, events);
          }
        }
      }
    }

    for (const car of this.cars) {
      const lapBefore = car.lap;
      const idxBefore = car.sampleIdx;
      if (car.prevZ > 0 && car.z === 0) events.push({ type: 'land', car });
      this.updateProgress(car);
      if (!car.airborne && car.wrecked <= 0) this.trackFeatures(car, idxBefore, events);
      const hit = collideWall(car, track);
      if (hit > 3) events.push({ type: 'hit', x: car.x, y: car.y, strength: hit, player: car.isPlayer, wall: true });
      if (this.combat && applyImpact(car, hit) === 'wreck') this.wreck(car, events);

      if (car.lap > lapBefore && !car.finished) {
        if (car.lap > this.laps) {
          car.finished = true;
          car.finishTime = this.time;
          this.finishers++;
          if (!this.drivers.has(car)) this.drivers.set(car, new AIDriver(AUTOPILOT, makeRng(this.finishers)));
          events.push({ type: 'finish', car });
        } else if (car.lap > 1) {
          events.push({ type: 'lap', car });
        }
      }

      // CPU cars that get wedged somewhere are put back on the road.
      if (this.drivers.has(car) && car.wrecked <= 0) {
        car.stuckTime = car.speed < 3 ? car.stuckTime + dt : 0;
        if (car.stuckTime > 2.5) {
          this.respawn(car);
          events.push({ type: 'respawn', car });
        }
      }
    }

    if (this.combat) this.stepCombat(dt, events);

    const p = this.player;
    const s = track.samples[p.sampleIdx];
    const flow = p.vx * s.tx + p.vy * s.ty;
    this.wrongWay = flow < -4 && !p.finished ? this.wrongWay + dt : 0;

    return events;
  }

  /** Ramps and boost pads under a car that is on the ground. */
  private trackFeatures(car: Car, idxBefore: number, events: RaceEvent[]): void {
    const track = this.track;
    const s = track.samples[car.sampleIdx];
    const onRoad = Math.abs(car.lat) < s.hw;
    car.lift = onRoad ? track.rampHeight(car.sampleIdx, car.x, car.y) : 0;
    for (const j of track.jumps) {
      // Take off when the car crosses the lip going forwards at a decent speed.
      const before = track.wrap(j - idxBefore);
      const after = track.wrap(car.sampleIdx - j);
      if (before === 0 || before > 6 || after > 6 || !onRoad) continue;
      const v = car.forwardSpeed;
      if (v < 14) continue;
      car.vz = clamp(v * 0.23, 5, 10.5);
      car.z = RAMP_HEIGHT;
      car.lift = 0;
      events.push({ type: 'jump', car });
    }
    for (const pad of track.pads) {
      const d = track.wrap(car.sampleIdx - pad.index + PAD_HALF_LENGTH);
      if (d > PAD_HALF_LENGTH * 2 || Math.abs(car.lat - pad.lat) > PAD_HALF_WIDTH) continue;
      if (car.pad < PAD_TIME - 0.3) events.push({ type: 'pad', car });
      car.pad = PAD_TIME;
    }
  }

  private wreck(car: Car, events: RaceEvent[]): void {
    events.push({ type: 'explosion', x: car.x, y: car.y }, { type: 'wreck', car });
  }

  private stepCombat(dt: number, events: RaceEvent[]): void {
    for (const e of this.weapons.step(dt, this.cars, this.track)) {
      events.push(e);
      if (e.type === 'struck' && e.result === 'wreck') this.wreck(e.car, events);
    }
    for (const box of this.boxes) {
      if (box.respawn > 0) {
        box.respawn = Math.max(0, box.respawn - dt);
        continue;
      }
      for (const car of this.cars) {
        if (car.item || car.wrecked > 0 || car.finished) continue;
        if ((car.x - box.x) ** 2 + (car.y - box.y) ** 2 > BOX_RADIUS * BOX_RADIUS) continue;
        const prize = rollPrize(this.placeOf(car), this.cars.length, car.health, this.prizeRng);
        if (prize === 'repair') repair(car);
        else car.item = prize;
        box.respawn = BOX_RESPAWN;
        events.push({ type: 'pickup', car, prize });
        break;
      }
    }
  }

  private updateProgress(car: Car): void {
    const track = this.track;
    const idx = track.nearest(car.x, car.y, car.sampleIdx);
    const delta = idx - car.sampleIdx;
    if (delta < -track.count / 2) car.lap++;
    else if (delta > track.count / 2) car.lap--;
    car.sampleIdx = idx;
    car.lat = track.lateral(idx, car.x, car.y);
    car.offroad = Math.abs(car.lat) > track.samples[idx].hw + 0.6;
    const along = clamp(track.along(idx, car.x, car.y), -track.spacing, track.spacing);
    car.progress = (car.lap - 1) * track.length + idx * track.spacing + along;
  }
}
