import { clamp } from '../core/math';
import { makeRng } from '../core/rng';
import type { Personality } from '../data/rivals';
import { AIDriver } from './ai/driver';
import { Car, NO_INPUT, type CarInput } from './car';
import { collideCars, collideWall } from './collision';
import type { Track } from './track';

export type RaceEvent =
  | { type: 'count'; n: number }
  | { type: 'go' }
  | { type: 'hit'; x: number; y: number; strength: number; player: boolean; wall: boolean }
  | { type: 'lap'; car: Car }
  | { type: 'finish'; car: Car }
  | { type: 'respawn'; car: Car };

export type RacePhase = 'grid' | 'countdown' | 'racing';

export interface RaceConfig {
  laps: number;
  playerName: string;
  playerColor: number;
  rivals: Personality[];
  seed: number;
  /** Maximum CPU top-speed change from rubber-banding (0.06 = 6%). */
  rubberBand?: number;
  /** No human: the player's car gets a CPU driver too (demo and tests). */
  autopilot?: boolean;
}

const GRID_GAP = 7;
const GRID_LATERAL = 3.2;
const COUNTDOWN = 3;
const AUTOPILOT: Personality = {
  name: 'Autopilot', color: 0, skill: 0.8, aggression: 0.5, errorRate: 0.02, drift: 0.6, boostAt: 0.5,
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

  constructor(
    readonly track: Track,
    config: RaceConfig,
  ) {
    this.laps = config.laps;
    this.rubberBand = config.rubberBand ?? 0.06;
    const rng = makeRng(config.seed);

    config.rivals.forEach((p, i) => {
      const car = new Car(i, p.name, p.color, false);
      this.cars.push(car);
      this.drivers.set(car, new AIDriver(p, makeRng(Math.floor(rng() * 1e9))));
      this.baseScale.set(car, 0.9 + 0.1 * p.skill);
    });
    // The player starts at the back of the grid and has to earn it.
    this.player = new Car(this.cars.length, config.playerName, config.playerColor, true);
    this.cars.push(this.player);
    this.baseScale.set(this.player, 1);
    if (config.autopilot) this.drivers.set(this.player, new AIDriver(AUTOPILOT, makeRng(Math.floor(rng() * 1e9))));

    this.cars.forEach((car, slot) => {
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

    for (const car of this.cars) {
      const driver = this.drivers.get(car);
      let input = playerInput;
      if (driver) {
        input = driver.update(car, track, this.cars, dt);
        let scale = this.baseScale.get(car) ?? 1;
        if (!car.isPlayer && !car.finished) {
          const gap = car.progress - this.player.progress;
          scale *= 1 - clamp(gap / 150, -1, 1) * this.rubberBand;
        }
        car.speedScale = car.finished ? 0.75 : scale;
      }
      car.step(input, dt);
    }

    for (let i = 0; i < this.cars.length; i++) {
      for (let j = i + 1; j < this.cars.length; j++) {
        const a = this.cars[i];
        const b = this.cars[j];
        const hit = collideCars(a, b);
        if (hit > 2) {
          events.push({
            type: 'hit', x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, strength: hit,
            player: a.isPlayer || b.isPlayer, wall: false,
          });
        }
      }
    }

    for (const car of this.cars) {
      const lapBefore = car.lap;
      this.updateProgress(car);
      const hit = collideWall(car, track);
      if (hit > 3) events.push({ type: 'hit', x: car.x, y: car.y, strength: hit, player: car.isPlayer, wall: true });

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
      if (this.drivers.has(car)) {
        car.stuckTime = car.speed < 3 ? car.stuckTime + dt : 0;
        if (car.stuckTime > 2.5) {
          this.respawn(car);
          events.push({ type: 'respawn', car });
        }
      }
    }

    const p = this.player;
    const s = track.samples[p.sampleIdx];
    const flow = p.vx * s.tx + p.vy * s.ty;
    this.wrongWay = flow < -4 && !p.finished ? this.wrongWay + dt : 0;

    return events;
  }

  private updateProgress(car: Car): void {
    const track = this.track;
    const idx = track.nearest(car.x, car.y, car.sampleIdx);
    const delta = idx - car.sampleIdx;
    if (delta < -track.count / 2) car.lap++;
    else if (delta > track.count / 2) car.lap--;
    car.sampleIdx = idx;
    car.lat = track.lateral(idx, car.x, car.y);
    car.offroad = Math.abs(car.lat) > track.halfWidth + 0.6;
    const along = clamp(track.along(idx, car.x, car.y), -track.spacing, track.spacing);
    car.progress = (car.lap - 1) * track.length + idx * track.spacing + along;
  }
}
