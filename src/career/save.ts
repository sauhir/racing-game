import { CARS } from '../data/cars';
import { CUPS, MAX_LEVEL, newSave, UPGRADE_KINDS, type Save } from './career';

const KEY = 'pocket-drifters-career-v1';

/** Checks a parsed save thoroughly: anything unexpected and we start afresh rather than crash. */
function valid(s: Save): boolean {
  if (!s || s.version !== 1 || !Number.isFinite(s.money) || s.money < 0) return false;
  if (typeof s.garage !== 'object' || s.garage === null || !s.garage[s.car]) return false;
  for (const [car, ups] of Object.entries(s.garage)) {
    if (!CARS.some((c) => c.id === car) || typeof ups !== 'object' || ups === null) return false;
    for (const kind of UPGRADE_KINDS) {
      if (!Number.isInteger(ups[kind]) || ups[kind] < 0 || ups[kind] > MAX_LEVEL) return false;
    }
  }
  if (typeof s.trophies !== 'object' || s.trophies === null) return false;
  if (s.progress !== null) {
    const cup = CUPS.find((c) => c.id === s.progress?.cup);
    if (!cup || !Number.isInteger(s.progress.next) || s.progress.next < 0 || s.progress.next >= cup.races.length) {
      return false;
    }
    if (typeof s.progress.points !== 'object' || s.progress.points === null) return false;
  }
  return true;
}

export function loadSave(): Save {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Save;
      if (valid(parsed)) return parsed;
    }
  } catch {
    // Unreadable or blocked storage: fall through to a new career.
  }
  return newSave();
}

export function storeSave(save: Save): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(save));
  } catch {
    // Progress will not survive a reload, but the game carries on.
  }
}
