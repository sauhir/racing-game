export type Quality = 'low' | 'medium' | 'high';
export const QUALITIES: Quality[] = ['low', 'medium', 'high'];

export interface Settings {
  /** 0..1 */
  music: number;
  /** 0..1 */
  sfx: number;
  quality: Quality;
}

export const DEFAULT_SETTINGS: Settings = { music: 0.7, sfx: 0.8, quality: 'high' };
const KEY = 'pocket-drifters-settings-v1';

type Store = Pick<Storage, 'getItem' | 'setItem'>;
const browserStore = (): Store | undefined => (typeof localStorage === 'undefined' ? undefined : localStorage);

const volume = (v: unknown, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1 ? v : fallback;

/** Reads saved settings; anything missing or malformed falls back to its default. */
export function loadSettings(store: Store | undefined = browserStore()): Settings {
  try {
    const raw = store?.getItem(KEY);
    if (raw) {
      const p = JSON.parse(raw) as Partial<Record<keyof Settings, unknown>> | null;
      if (p && typeof p === 'object') {
        return {
          music: volume(p.music, DEFAULT_SETTINGS.music),
          sfx: volume(p.sfx, DEFAULT_SETTINGS.sfx),
          quality: QUALITIES.includes(p.quality as Quality) ? (p.quality as Quality) : DEFAULT_SETTINGS.quality,
        };
      }
    }
  } catch {
    // Unreadable or blocked storage: use the defaults.
  }
  return { ...DEFAULT_SETTINGS };
}

export function storeSettings(settings: Settings, store: Store | undefined = browserStore()): void {
  try {
    store?.setItem(KEY, JSON.stringify(settings));
  } catch {
    // Settings will not survive a reload, but the game carries on.
  }
}
