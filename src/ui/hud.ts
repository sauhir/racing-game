import type { Car } from '../sim/car';
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
  private readonly message = $('message');
  private readonly title = $('title');
  private readonly pause = $('pause');
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

  show(screen: 'title' | 'race' | 'pause' | 'results'): void {
    this.title.classList.toggle('hidden', screen !== 'title');
    this.pause.classList.toggle('hidden', screen !== 'pause');
    this.results.classList.toggle('hidden', screen !== 'results');
    this.hud.classList.toggle('hidden', screen === 'title');
  }

  /** Flash a centre-screen message. seconds = 0 keeps it until cleared. */
  say(text: string, seconds: number, style: '' | 'small' | 'small warn' = ''): void {
    this.message.textContent = text;
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

  showResults(race: Race): void {
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
