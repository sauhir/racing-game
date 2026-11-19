import type { Rng } from '../core/rng';
import type { Track } from './track';

export type ItemType = 'missile' | 'mine' | 'oil' | 'shield' | 'shockwave' | 'nitro';
/** What a mystery box can give: an item to hold, or an instant repair. */
export type BoxPrize = ItemType | 'repair';

export const ITEM_NAMES: Record<ItemType, string> = {
  missile: 'Missile',
  mine: 'Mine',
  oil: 'Oil slick',
  shield: 'Shield',
  shockwave: 'Shockwave',
  nitro: 'Nitro',
};

export interface PickupBox {
  x: number;
  y: number;
  /** Seconds until the box reappears; 0 means it is there to be taken. */
  respawn: number;
}

/** Short, so the back of a tight pack still finds boxes waiting. */
export const BOX_RESPAWN = 1.2;
export const BOX_RADIUS = 2.1;
const BOX_LANES = [-0.7, -0.35, 0, 0.35, 0.7];

/** Rows of mystery boxes across the road at the track's chosen spots. */
export function makeBoxes(track: Track): PickupBox[] {
  const boxes: PickupBox[] = [];
  for (const fraction of track.def.boxRows) {
    for (const lane of BOX_LANES) {
      const hw = track.pointAt(fraction * track.length, 0);
      const p = track.pointAt(fraction * track.length, lane * track.samples[hw.index].hw);
      boxes.push({ x: p.x, y: p.y, respawn: 0 });
    }
  }
  return boxes;
}

/**
 * Picks a prize. Cars at the back are favoured with attacking and catch-up
 * items; leaders mostly get things to drop behind or defend with.
 */
export function rollPrize(place: number, total: number, health: number, rng: Rng): BoxPrize {
  const back = total > 1 ? (place - 1) / (total - 1) : 0;
  const weights: [BoxPrize, number][] = [
    ['missile', 0.4 + 2.6 * back],
    ['nitro', 0.5 + 2 * back],
    ['shockwave', 1 + back],
    ['shield', 2 - back],
    ['mine', 2.4 - 2 * back],
    ['oil', 2.4 - 2 * back],
    ['repair', health < 0.5 ? 3.5 : health < 0.8 ? 1.2 : 0],
  ];
  let r = rng() * weights.reduce((sum, [, w]) => sum + w, 0);
  for (const [prize, w] of weights) {
    r -= w;
    if (r < 0) return prize;
  }
  return 'shield';
}
