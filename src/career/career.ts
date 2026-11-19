import { carById } from '../data/cars';
import { RIVALS, type Personality } from '../data/rivals';
import { TRACKS } from '../data/tracks';
import type { CarStats } from '../sim/car';
import { reverseTrack, type TrackDef } from '../sim/track';
import { generateTrack } from '../sim/trackGen';

export type UpgradeKind = 'engine' | 'tyres' | 'armour' | 'nitro';
export const UPGRADE_KINDS: UpgradeKind[] = ['engine', 'tyres', 'armour', 'nitro'];
export const UPGRADE_INFO: Record<UpgradeKind, { name: string; effect: string }> = {
  engine: { name: 'Engine', effect: 'top speed and acceleration' },
  tyres: { name: 'Tyres', effect: 'turn-in and off-road speed' },
  armour: { name: 'Armour', effect: 'less damage taken' },
  nitro: { name: 'Nitro', effect: 'boost charges faster, burns longer' },
};
export const MAX_LEVEL = 3;
/** Price of the next level, indexed by the current level. */
export const UPGRADE_COST = [400, 900, 1600];
export const CAR_PRICE: Record<string, number> = { bubble: 0, buggy: 2500, van: 2500, roadster: 3500 };
export const STARTING_MONEY = 300;

export type Upgrades = Record<UpgradeKind, number>;

export interface RaceSpec {
  track: string;
  reverse?: boolean;
  /** Seed for a generated circuit (track is then 'random'). */
  seed?: number;
}

export interface CupDef {
  id: string;
  name: string;
  /** 0 = easiest. A podium in one tier's cup unlocks the next. */
  tier: number;
  races: RaceSpec[];
}

export const CUPS: CupDef[] = [
  {
    id: 'rookie', name: 'Rookie Cup', tier: 0,
    races: [{ track: 'meadow' }, { track: 'beach' }, { track: 'snow' }, { track: 'desert' }],
  },
  {
    id: 'pro', name: 'Pro Cup', tier: 1,
    races: [
      { track: 'desert' }, { track: 'snow', reverse: true }, { track: 'beach' },
      { track: 'meadow', reverse: true },
    ],
  },
  {
    id: 'champion', name: 'Champion Cup', tier: 2,
    races: [
      { track: 'beach', reverse: true }, { track: 'desert', reverse: true }, { track: 'snow' },
      { track: 'random', seed: 77 },
    ],
  },
];

export const POINTS = [10, 7, 5, 3, 2, 1];
const RACE_PRIZE = [500, 350, 250, 150, 100, 50];
const CUP_BONUS = [1500, 900, 500];
const tierMoney = (tier: number): number => 1 + tier * 0.5;

export interface CupProgress {
  cup: string;
  /** Index of the next race to run. */
  next: number;
  /** Championship points by driver name. */
  points: Record<string, number>;
}

export interface Save {
  version: 1;
  money: number;
  /** The car the player is driving. */
  car: string;
  /** Owned cars and their upgrade levels. */
  garage: Record<string, Upgrades>;
  /** Best finishing place in each completed cup. */
  trophies: Record<string, number>;
  progress: CupProgress | null;
}

const noUpgrades = (): Upgrades => ({ engine: 0, tyres: 0, armour: 0, nitro: 0 });

export function newSave(): Save {
  return {
    version: 1, money: STARTING_MONEY, car: 'bubble', garage: { bubble: noUpgrades() }, trophies: {},
    progress: null,
  };
}

/**
 * Mild upgrades: a fully upgraded car is a little quicker everywhere, but the
 * grip and drift behaviour that define the handling are never changed.
 */
export function upgradedStats(base: CarStats, u: Upgrades): CarStats {
  return {
    ...base,
    maxSpeed: base.maxSpeed * (1 + 0.02 * u.engine),
    accel: base.accel * (1 + 0.05 * u.engine),
    turnRate: base.turnRate * (1 + 0.025 * u.tyres),
    offroad: base.offroad * (1 + 0.07 * u.tyres),
    armour: base.armour * (1 - 0.1 * u.armour),
    boostCharge: base.boostCharge * (1 + 0.12 * u.nitro),
    boostDrain: base.boostDrain * (1 - 0.08 * u.nitro),
  };
}

export function statsFor(save: Save, car: string): CarStats {
  return upgradedStats(carById(car).stats, save.garage[car] ?? noUpgrades());
}

export function buyCar(save: Save, car: string): boolean {
  const price = CAR_PRICE[car];
  if (price === undefined || save.garage[car] || save.money < price) return false;
  save.money -= price;
  save.garage[car] = noUpgrades();
  save.car = car;
  return true;
}

export function selectCar(save: Save, car: string): boolean {
  if (!save.garage[car]) return false;
  save.car = car;
  return true;
}

/** Cost of a car's next level of an upgrade, or null when it is maxed out. */
export function upgradeCost(save: Save, car: string, kind: UpgradeKind): number | null {
  const level = save.garage[car]?.[kind];
  return level === undefined || level >= MAX_LEVEL ? null : UPGRADE_COST[level];
}

export function buyUpgrade(save: Save, car: string, kind: UpgradeKind): boolean {
  const cost = upgradeCost(save, car, kind);
  if (cost === null || save.money < cost) return false;
  save.money -= cost;
  save.garage[car][kind]++;
  return true;
}

export function cupUnlocked(save: Save, cup: CupDef): boolean {
  if (cup.tier === 0) return true;
  const previous = CUPS.find((c) => c.tier === cup.tier - 1);
  const best = previous ? save.trophies[previous.id] : undefined;
  return best !== undefined && best <= 3;
}

/** Starts a cup, or carries on with it if it is already under way. */
export function startCup(save: Save, cup: CupDef): CupProgress {
  if (save.progress?.cup !== cup.id) save.progress = { cup: cup.id, next: 0, points: {} };
  return save.progress;
}

export function trackForRace(spec: RaceSpec): TrackDef {
  if (spec.track === 'random') return generateTrack(spec.seed ?? 1);
  const def = TRACKS.find((t) => t.id === spec.track);
  if (!def) throw new Error(`unknown track ${spec.track}`);
  return spec.reverse ? reverseTrack(def) : def;
}

/** Rivals sharpen up tier by tier: better lines, fewer mistakes, quicker with items. */
export function tierRivals(tier: number): Personality[] {
  return RIVALS.map((p) => ({
    ...p,
    skill: Math.min(1, p.skill + 0.06 * (tier - 1)),
    errorRate: p.errorRate * [1.6, 1, 0.5][tier],
    itemUse: Math.min(1, p.itemUse + 0.15 * (tier - 1)),
  }));
}

/** Overall rival pace per tier. The middle tier matches a quick race. */
export const tierPace = (tier: number): number => [0.965, 1, 1.03][tier] ?? 1;

export interface Standing {
  name: string;
  points: number;
}

export interface RaceOutcome {
  place: number;
  points: number;
  prize: number;
  standings: Standing[];
  cupDone: boolean;
  /** Set when the cup is complete. */
  cupPlace?: number;
  bonus?: number;
  /** Name of a cup this result has just unlocked. */
  unlocked?: string;
}

export function cupStandings(progress: CupProgress, names: string[]): Standing[] {
  return names
    .map((name, order) => ({ name, points: progress.points[name] ?? 0, order }))
    .sort((a, b) => b.points - a.points || a.order - b.order)
    .map(({ name, points }) => ({ name, points }));
}

/**
 * Books a finished cup race: points for everyone, prize money for the player,
 * and, after the last race, the trophy, bonus and any newly unlocked cup.
 * `order` lists driver names from first to last.
 */
export function recordRace(save: Save, order: string[], player: string): RaceOutcome {
  const progress = save.progress;
  const cup = CUPS.find((c) => c.id === progress?.cup);
  if (!progress || !cup) throw new Error('no cup in progress');

  order.forEach((name, i) => {
    progress.points[name] = (progress.points[name] ?? 0) + (POINTS[i] ?? 0);
  });
  const place = order.indexOf(player) + 1;
  const prize = Math.round((RACE_PRIZE[place - 1] ?? 0) * tierMoney(cup.tier));
  save.money += prize;
  progress.next++;

  // Ties in the table go to whoever finished ahead in the latest race.
  const standings = cupStandings(progress, order);
  const outcome: RaceOutcome = {
    place, points: POINTS[place - 1] ?? 0, prize, standings, cupDone: progress.next >= cup.races.length,
  };
  if (outcome.cupDone) {
    const cupPlace = standings.findIndex((s) => s.name === player) + 1;
    const next = CUPS.find((c) => c.tier === cup.tier + 1);
    const wasUnlocked = next ? cupUnlocked(save, next) : true;
    outcome.cupPlace = cupPlace;
    outcome.bonus = Math.round((CUP_BONUS[cupPlace - 1] ?? 0) * (1 + cup.tier));
    save.money += outcome.bonus;
    save.trophies[cup.id] = Math.min(save.trophies[cup.id] ?? Infinity, cupPlace);
    save.progress = null;
    if (next && !wasUnlocked && cupUnlocked(save, next)) outcome.unlocked = next.name;
  }
  return outcome;
}
