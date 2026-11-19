export interface Personality {
  name: string;
  color: number;
  /** 0..1: line accuracy, cornering commitment and outright pace. */
  skill: number;
  /** 0..1: how little room they leave when passing. */
  aggression: number;
  /** Mistakes per second (overcooked corners). */
  errorRate: number;
  /** 0..1: fondness for handbrake slides. */
  drift: number;
  /** Boost meter level at which they fire it. */
  boostAt: number;
  /** 0..1: how quickly and eagerly they use items. */
  itemUse: number;
}

export const PLAYER_COLOR = 0x2f7df6;

export const RIVALS: Personality[] = [
  { name: 'Dot', color: 0xf2c230, skill: 0.95, aggression: 0.2, errorRate: 0.01, drift: 0.5, boostAt: 0.6, itemUse: 0.5 },
  { name: 'Blaze', color: 0xe8413a, skill: 0.85, aggression: 0.95, errorRate: 0.03, drift: 0.8, boostAt: 0.35, itemUse: 1 },
  { name: 'Zippy', color: 0x35c46a, skill: 0.75, aggression: 0.5, errorRate: 0.04, drift: 1, boostAt: 0.2, itemUse: 0.8 },
  { name: 'Tank', color: 0x8a56d8, skill: 0.65, aggression: 0.8, errorRate: 0.02, drift: 0.3, boostAt: 0.8, itemUse: 0.9 },
  { name: 'Rusty', color: 0xf08a2c, skill: 0.5, aggression: 0.4, errorRate: 0.09, drift: 0.7, boostAt: 0.5, itemUse: 0.3 },
];
