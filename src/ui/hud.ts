import type { Car } from '../sim/car';
import { ITEM_NAMES, type ItemType } from '../sim/items';
import type { Race } from '../sim/race';
import type { Track } from '../sim/track';

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

export function formatTime(t: number): string {
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s < 10 ? '0' : ''}${s.toFixed(1)}`;
}

export function ordinal(n: number): string {
  if (n % 100 >= 11 && n % 100 <= 13) return 'th';
  return ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th';
}

const svg = (body: string): string => `<svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg">${body}</svg>`;

/** Hand-drawn icons for the item slot. */
const ITEM_ICONS: Record<ItemType, string> = {
  missile: svg(
    '<path d="M8 40 14 26 30 10Q38 6 42 6 42 10 38 18L22 34Z" fill="#ff5a4d"/>' +
      '<path d="M8 40 10 30 18 38Z" fill="#ffd23c"/><circle cx="33" cy="15" r="3.5" fill="#fff"/>',
  ),
  mine: svg(
    '<path d="M24 5v8M24 39v5M5 26h7M36 26h7M10 12l6 6M38 12l-6 6M10 40l6-6M38 40l-6-6" stroke="#2c3040" ' +
      'stroke-width="5" stroke-linecap="round"/><circle cx="24" cy="26" r="13" fill="#3f4558"/>' +
      '<circle cx="24" cy="26" r="5" fill="#ff3b30"/>',
  ),
  oil: svg(
    '<path d="M24 4S9 22 9 31a15 15 0 0 0 30 0C39 22 24 4 24 4Z" fill="#1d1b26"/>' +
      '<path d="M16 31a8 8 0 0 0 6 8" stroke="#fff" stroke-width="3" fill="none" stroke-linecap="round"/>',
  ),
  shield: svg(
    '<path d="M24 4 41 10V24C41 34 33 41 24 44 15 41 7 34 7 24V10Z" fill="#35c9ee"/>' +
      '<path d="M24 9 36 13.500V24C36 31 30 36.500 24 39Z" fill="#fff" opacity=".55"/>',
  ),
  shockwave: svg(
    '<g fill="none" stroke="#b78bff" stroke-linecap="round"><circle cx="24" cy="24" r="12" stroke-width="5"/>' +
      '<circle cx="24" cy="24" r="20" stroke-width="3" opacity=".65"/></g><circle cx="24" cy="24" r="5" fill="#fff"/>',
  ),
  nitro: svg('<path d="M28 3 10 27H22L19 45 38 19H26Z" fill="#ffd23c" stroke="#ff8a1f" stroke-width="2"/>'),
};

export interface MenuItem {
  label: string;
  detail?: string;
  /** 'locked' greys a row out; 'plain' and 'me' are for table rows such as standings. */
  style?: 'locked' | 'plain' | 'plain me';
}

export interface MenuView {
  title: string;
  subtitle?: string;
  items: MenuItem[];
  /** Index of the highlighted row, or -1 for none. */
  selected: number;
  hint: string;
  stats?: [string, number][];
  /** Dock the menu on the right so the scene behind stays visible. */
  side?: boolean;
}

/** Labelled 0..1 bars for comparing cars. */
function statBars(stats: [string, number][]): HTMLElement[] {
  return stats.flatMap(([label, value]) => {
    const name = document.createElement('span');
    name.textContent = label;
    const bar = document.createElement('div');
    bar.className = 'bar';
    const fill = document.createElement('i');
    fill.style.width = `${Math.round(Math.max(0.08, Math.min(1, value)) * 100)}%`;
    bar.append(fill);
    return [name, bar];
  });
}

const hex = (c: number): string => '#' + c.toString(16).padStart(6, '0');

/** DOM overlay: race HUD, minimap, big centre messages and the menu screens. */
export class Hud {
  private readonly hud = $('hud');
  private readonly placeNum = $('place-num');
  private readonly placeSuffix = $('place-suffix');
  private readonly placeTotal = $('place-total');
  private readonly lap = $('hud-lap');
  private readonly time = $('hud-time');
  private readonly best = $('hud-best');
  private readonly speed = $('speed-num');
  private readonly boostBar = $('boost-bar');
  private readonly healthBar = $('health-bar');
  private readonly itemSlot = $('item-slot');
  private readonly itemIcon = $('item-icon');
  private readonly itemName = $('item-name');
  private shownItem: ItemType | null = null;
  private readonly message = $('message');
  private readonly title = $('title');
  private readonly pause = $('pause');
  private readonly select = $('select');
  private readonly menu = $('menu');
  private readonly results = $('results');
  private readonly resultsTitle = $('results-title');
  private readonly resultsTable = $<HTMLTableElement>('results-table');
  private readonly map = $<HTMLCanvasElement>('minimap');
  private readonly mapCtx = this.map.getContext('2d')!;
  private mapPath: [number, number][] = [];
  private mapScale = 1;
  private mapOx = 0;
  private mapOy = 0;
  private messageTimer = 0;
  private padHints = false;
  private readonly flashEl = $('flash');
  private readonly itemPop = $('item-pop');
  private readonly boostWrap = $('boost-wrap');
  private readonly placeEl = $('hud-place');
  private lastPlace = 0;
  /** Seconds left of the item-slot roulette, and until its next frame. */
  private roulette = 0;
  private rouletteTick = 0;
  private stickyMessage = false;

  setTrack(track: Track): void {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const s of track.samples) {
      minX = Math.min(minX, s.x);
      maxX = Math.max(maxX, s.x);
      minY = Math.min(minY, s.y);
      maxY = Math.max(maxY, s.y);
    }
    const size = this.map.width;
    const pad = 16;
    this.mapScale = (size - pad * 2) / Math.max(maxX - minX, maxY - minY);
    this.mapOx = size / 2 - ((minX + maxX) / 2) * this.mapScale;
    this.mapOy = size / 2 - ((minY + maxY) / 2) * this.mapScale;
    this.mapPath = [];
    for (let i = 0; i < track.count; i += 3) {
      const s = track.samples[i];
      this.mapPath.push([s.x * this.mapScale + this.mapOx, s.y * this.mapScale + this.mapOy]);
    }
  }

  show(screen: 'title' | 'menu' | 'select' | 'race' | 'pause' | 'results'): void {
    this.menu.classList.toggle('hidden', screen !== 'menu');
    this.title.classList.toggle('hidden', screen !== 'title');
    this.select.classList.toggle('hidden', screen !== 'select');
    this.pause.classList.toggle('hidden', screen !== 'pause');
    this.results.classList.toggle('hidden', screen !== 'results');
    this.hud.classList.toggle('hidden', screen === 'title' || screen === 'select' || screen === 'menu');
  }

  /** Reveals the controller instructions once a gamepad has been plugged in. */
  showGamepadHints(seen: boolean): void {
    if (seen === this.padHints) return;
    this.padHints = seen;
    for (const el of document.querySelectorAll('.pad-hint')) el.classList.toggle('hidden', !seen);
  }

  /** A generic list screen: main menu, career hub, garage and cup standings. */
  showMenu(m: MenuView): void {
    this.menu.classList.toggle('side', m.side === true);
    $('menu-title').textContent = m.title;
    $('menu-sub').textContent = m.subtitle ?? '';
    $('menu-hint').textContent = m.hint;
    $('menu-items').replaceChildren(
      ...m.items.map((item, i) => {
        const row = document.createElement('div');
        row.className = ['menu-row', i === m.selected ? 'sel' : '', item.style ?? ''].join(' ');
        const label = document.createElement('span');
        label.textContent = item.label;
        const detail = document.createElement('span');
        detail.className = 'detail';
        detail.textContent = item.detail ?? '';
        row.append(label, detail);
        return row;
      }),
    );
    $('menu-stats').replaceChildren(...statBars(m.stats ?? []));
  }

  /** Fills in the track and car pickers on the selection screen. */
  showSelection(
    row: number, trackName: string, trackInfo: string, carName: string, carInfo: string,
    stats: [string, number][],
  ): void {
    $('pick-track').classList.toggle('active', row === 0);
    $('pick-car').classList.toggle('active', row === 1);
    $('track-name').textContent = trackName;
    $('track-sub').textContent = trackInfo;
    $('car-name').textContent = carName;
    $('car-sub').textContent = carInfo;
    $('car-stats').replaceChildren(...statBars(stats));
  }

  /** A burst of colour over the whole screen. */
  flash(kind: 'pickup' | 'boom' | 'hit' | 'shield' | 'gold', strength = 1, seconds = 0.45): void {
    const el = this.flashEl;
    el.className = '';
    el.style.setProperty('--flash', String(Math.min(1, strength)));
    el.style.setProperty('--flash-time', `${seconds}s`);
    void el.offsetWidth;
    el.className = `go ${kind}`;
  }

  /** Flash a centre-screen message. seconds = 0 keeps it until cleared. */
  say(text: string, seconds: number, style: '' | 'warn' | 'small' | 'small warn' = ''): void {
    this.message.textContent = text;
    this.message.className = '';
    // Reading the size forces a reflow so the entrance animation restarts.
    void this.message.offsetWidth;
    this.message.className = `show ${style}`;
    this.messageTimer = seconds;
    this.stickyMessage = seconds === 0;
  }

  clearSticky(): void {
    if (this.stickyMessage) {
      this.stickyMessage = false;
      this.message.className = '';
    }
  }

  get hasSticky(): boolean {
    return this.stickyMessage;
  }

  update(race: Race, bestLap: number, dt: number): void {
    const p = race.player;
    const place = race.placeOf(p);
    this.placeNum.textContent = String(place);
    this.placeSuffix.textContent = ordinal(place);
    this.placeTotal.textContent = `/${race.cars.length}`;
    this.lap.textContent = `LAP ${race.lapOf(p)}/${race.laps}`;
    this.time.textContent = formatTime(p.finished ? p.finishTime : race.time);
    this.best.textContent = bestLap > 0 ? `BEST LAP ${formatTime(bestLap)}` : '';
    this.speed.textContent = String(Math.round(p.speed * 3.6));
    this.boostBar.style.width = `${Math.round(p.boost * 100)}%`;
    this.boostBar.className = p.boosting ? 'firing' : p.boost >= 0.15 ? 'ready' : '';
    this.boostWrap.classList.toggle('full', p.boost >= 0.99 && !p.boosting);
    if (place !== this.lastPlace) {
      if (this.lastPlace !== 0 && race.phase === 'racing') {
        this.placeEl.className = '';
        void this.placeEl.offsetWidth;
        this.placeEl.className = place < this.lastPlace ? 'up' : 'down';
      }
      this.lastPlace = place;
    }

    this.healthBar.style.width = `${Math.round(p.health * 100)}%`;
    this.healthBar.className = p.health < 0.3 ? 'low' : p.health < 0.6 ? 'mid' : '';
    // Icons are fixed strings defined above, never user input.
    if (p.item !== this.shownItem) {
      this.shownItem = p.item;
      this.itemSlot.classList.remove('has', 'spin');
      this.itemPop.className = '';
      if (p.item) {
        // A new prize: spin the slot through the items before revealing it.
        this.roulette = 0.55;
        this.rouletteTick = 0;
        this.itemSlot.classList.add('spin');
        this.itemName.textContent = '???';
      } else {
        this.roulette = 0;
        this.itemIcon.innerHTML = '';
        this.itemName.textContent = '';
      }
    }
    if (this.roulette > 0 && p.item) {
      this.roulette -= dt;
      this.rouletteTick -= dt;
      if (this.roulette <= 0) {
        this.itemIcon.innerHTML = ITEM_ICONS[p.item];
        this.itemName.textContent = ITEM_NAMES[p.item];
        this.itemSlot.classList.remove('spin');
        void this.itemSlot.offsetWidth;
        this.itemSlot.classList.add('has');
        $('item-pop-icon').innerHTML = ITEM_ICONS[p.item];
        $('item-pop-name').textContent = `${ITEM_NAMES[p.item]}!`;
        void this.itemPop.offsetWidth;
        this.itemPop.className = 'go';
      } else if (this.rouletteTick <= 0) {
        this.rouletteTick = 0.06;
        const all = Object.keys(ITEM_ICONS) as ItemType[];
        this.itemIcon.innerHTML = ITEM_ICONS[all[Math.floor(Math.random() * all.length)]];
      }
    }

    if (!this.stickyMessage && this.messageTimer > 0) {
      this.messageTimer -= dt;
      if (this.messageTimer <= 0) this.message.className = '';
    }
    this.drawMap(race.cars, p);
  }

  private drawMap(cars: readonly Car[], player: Car): void {
    const ctx = this.mapCtx;
    ctx.clearRect(0, 0, this.map.width, this.map.height);
    ctx.lineJoin = ctx.lineCap = 'round';
    const trace = () => {
      ctx.beginPath();
      this.mapPath.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.closePath();
    };
    trace();
    ctx.strokeStyle = 'rgba(29,42,85,0.75)';
    ctx.lineWidth = 9;
    ctx.stroke();
    trace();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 4;
    ctx.stroke();

    const dot = (car: Car, r: number) => {
      ctx.beginPath();
      ctx.arc(car.x * this.mapScale + this.mapOx, car.y * this.mapScale + this.mapOy, r, 0, Math.PI * 2);
      ctx.fillStyle = hex(car.color);
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = car === player ? '#ffffff' : '#1d2a55';
      ctx.stroke();
    };
    for (const car of cars) if (car !== player) dot(car, 4.5);
    dot(player, 6.5);
  }

  showResults(race: Race, extra: string, prompt: string, hint: string): void {
    $('results-extra').textContent = extra;
    $('results-prompt').textContent = prompt;
    $('results-hint').textContent = hint;
    const order = race.standings();
    const place = order.indexOf(race.player) + 1;
    this.resultsTitle.textContent =
      place === 1 ? 'You win!' : place <= 3 ? `${place}${ordinal(place)} place!` : `${place}${ordinal(place)} place`;
    this.resultsTable.replaceChildren(
      ...order.map((car, i) => {
        const tr = document.createElement('tr');
        if (car === race.player) tr.className = 'me';
        const pos = document.createElement('td');
        pos.textContent = `${i + 1}${ordinal(i + 1)}`;
        const name = document.createElement('td');
        const swatch = document.createElement('span');
        swatch.className = 'swatch';
        swatch.style.background = hex(car.color);
        name.append(swatch, car.name);
        const time = document.createElement('td');
        time.textContent = car.finished ? formatTime(car.finishTime) : '…';
        tr.append(pos, name, time);
        return tr;
      }),
    );
  }
}
