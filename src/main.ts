import { GameAudio } from './audio/audio';
import { Input } from './core/input';
import { clamp, lerpAngle } from './core/math';
import { CARS, carById } from './data/cars';
import { PLAYER_COLOR, RIVALS } from './data/rivals';
import { TRACKS } from './data/tracks';
import { ChaseCamera } from './render/camera';
import { CarMesh } from './render/carMesh';
import { Effects } from './render/effects';
import { WorldItems } from './render/pickups';
import { View } from './render/scene';
import { THEMES } from './render/themes';
import { buildTrackScene, type TrackScene } from './render/trackMesh';
import { NO_INPUT } from './sim/car';
import { Race, type RaceEvent } from './sim/race';
import { Track, type TrackDef } from './sim/track';
import { generateTrack } from './sim/trackGen';
import { Hud, formatTime } from './ui/hud';

const STEP = 1 / 60;
const LAPS = 3;
const SAVE_KEY = 'pocket-drifters-selection';
const THEME_NAMES = { meadow: 'Meadow', beach: 'Beach', snow: 'Snow', desert: 'Desert' };

type Screen = 'title' | 'select' | 'race' | 'pause' | 'results';

class Game {
  private readonly view = new View(document.getElementById('game') as HTMLCanvasElement);
  private readonly input = new Input();
  private readonly audio = new GameAudio();
  private readonly hud = new Hud();
  private readonly chase = new ChaseCamera(this.view.camera);
  private readonly effects = new Effects();
  private track!: Track;
  private trackScene: TrackScene | null = null;
  private worldItems: WorldItems | null = null;
  private carMeshes: CarMesh[] = [];
  private race!: Race;
  private screen: Screen = 'title';
  private accumulator = 0;
  private lastTime = performance.now();
  private clock = 0;
  private seed = 1;
  private lapStart = 0;
  private bestLap = 0;
  private resultsDelay = 0;

  // Selection screen state. Track index TRACKS.length means "random circuit".
  private row = 0;
  private trackIndex = 0;
  private carIndex = 0;
  private randomSeed = 1 + Math.floor(Math.random() * 9999);

  constructor() {
    this.view.scene.add(this.effects.group);
    try {
      const saved = JSON.parse(localStorage.getItem(SAVE_KEY) ?? '{}') as { track?: number; car?: number };
      this.trackIndex = clamp(Math.floor(saved.track ?? 0), 0, TRACKS.length);
      this.carIndex = clamp(Math.floor(saved.car ?? 0), 0, CARS.length - 1);
    } catch {
      // No saved selection (or storage is unavailable): start with the defaults.
    }
    this.loadTrack();
    this.hud.show('title');
    requestAnimationFrame(this.frame);
  }

  private trackDef(): TrackDef {
    return this.trackIndex < TRACKS.length ? TRACKS[this.trackIndex] : generateTrack(this.randomSeed);
  }

  /** Builds the selected track's world, replacing any previous one, and a fresh race on it. */
  private loadTrack(): void {
    if (this.trackScene) {
      this.view.scene.remove(this.trackScene.group);
      this.trackScene.dispose();
    }
    if (this.worldItems) this.view.scene.remove(this.worldItems.group);
    this.worldItems = null;

    this.track = new Track(this.trackDef());
    const theme = THEMES[this.track.def.theme];
    this.trackScene = buildTrackScene(this.track);
    this.view.scene.add(this.trackScene.group);
    this.view.setTheme(theme);
    this.effects.dirt = theme.dirt;
    this.hud.setTrack(this.track);
    this.newRace();
  }

  private newRace(): void {
    for (const m of this.carMeshes) this.view.scene.remove(m.root);
    this.race = new Race(this.track, {
      laps: LAPS, playerName: 'You', playerColor: PLAYER_COLOR, rivals: RIVALS, seed: this.seed++,
      playerCar: CARS[this.carIndex], carFor: (id) => carById(id).stats,
    });
    if (!this.worldItems) {
      this.worldItems = new WorldItems(this.race.boxes.length);
      this.view.scene.add(this.worldItems.group);
    }
    this.carMeshes = this.race.cars.map((car) => new CarMesh(car));
    for (const m of this.carMeshes) this.view.scene.add(m.root);
    this.effects.clear();
    this.chase.snap();
    this.lapStart = 0;
    this.bestLap = 0;
    this.resultsDelay = 0;
    this.hud.clearSticky();
    // Debug/test hook.
    (window as unknown as { __game: unknown }).__game = { race: this.race, game: this };
  }

  private startRace(): void {
    this.audio.init();
    this.audio.setPaused(false);
    this.audio.startMusic();
    this.race.start();
    this.screen = 'race';
    this.hud.show('race');
  }

  private openSelection(): void {
    this.audio.init();
    this.audio.setPaused(false);
    this.audio.stopMusic();
    this.audio.update(null);
    if (this.race.phase !== 'grid') this.newRace();
    this.screen = 'select';
    this.hud.show('select');
    this.refreshSelection();
  }

  private refreshSelection(): void {
    const def = this.track.def;
    const random = this.trackIndex === TRACKS.length;
    const features = [
      `${THEME_NAMES[def.theme]}`,
      `${(this.track.length / 1000).toFixed(1)} km`,
      this.track.jumps.length ? `${this.track.jumps.length} jump${this.track.jumps.length > 1 ? 's' : ''}` : '',
      def.grip && def.grip < 1 ? 'slippery' : '',
      random ? 'press R for another' : '',
    ].filter(Boolean);
    const car = CARS[this.carIndex];
    const st = car.stats;
    this.hud.showSelection(
      this.row, random ? 'Random circuit' : def.name, features.join(' · '), car.name, car.blurb,
      [
        ['Speed', (st.maxSpeed - 42.5) / 6],
        ['Acceleration', (st.accel - 17) / 13],
        ['Handling', (st.turnRate - 2.2) / 0.8],
        ['Armour', (1 / st.armour - 0.45) / 1.25],
      ],
    );
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify({ track: this.trackIndex, car: this.carIndex }));
    } catch {
      // Selection just will not be remembered.
    }
  }

  private handleSelection(enter: boolean, esc: boolean): void {
    if (enter) return this.startRace();
    if (esc) {
      this.screen = 'title';
      this.hud.show('title');
      return;
    }
    if (this.input.take('ArrowUp', 'KeyW', 'ArrowDown', 'KeyS')) {
      this.row = 1 - this.row;
      this.refreshSelection();
    }
    const dir = (this.input.take('ArrowRight', 'KeyD') ? 1 : 0) - (this.input.take('ArrowLeft', 'KeyA') ? 1 : 0);
    const reroll = this.input.take('KeyR') && this.trackIndex === TRACKS.length;
    if (reroll) this.randomSeed = 1 + Math.floor(Math.random() * 9999);
    if (dir !== 0 && this.row === 0) {
      const n = TRACKS.length + 1;
      this.trackIndex = (this.trackIndex + dir + n) % n;
    }
    if ((dir !== 0 && this.row === 0) || reroll) {
      this.loadTrack();
      this.refreshSelection();
    } else if (dir !== 0) {
      this.carIndex = (this.carIndex + dir + CARS.length) % CARS.length;
      this.newRace();
      this.refreshSelection();
    }
  }

  private handleMenus(): void {
    const enter = this.input.take('Enter');
    const esc = this.input.take('Escape', 'KeyP');
    const back = this.input.take('Backspace');
    if (this.input.take('KeyM')) this.audio.toggleMute();

    switch (this.screen) {
      case 'title':
        if (enter) this.openSelection();
        break;
      case 'select':
        this.handleSelection(enter, esc || back);
        break;
      case 'race':
        if (esc) {
          this.screen = 'pause';
          this.hud.show('pause');
          this.audio.setPaused(true);
        } else if (this.input.take('KeyR') && this.race.phase === 'racing' && !this.race.player.finished) {
          this.race.respawn(this.race.player);
        }
        break;
      case 'pause':
        if (esc) {
          this.screen = 'race';
          this.hud.show('race');
          this.audio.setPaused(false);
        } else if (enter) {
          this.newRace();
          this.startRace();
        } else if (back) {
          this.openSelection();
        }
        break;
      case 'results':
        if (enter) {
          this.newRace();
          this.startRace();
        } else if (esc || back) {
          this.openSelection();
        }
        break;
    }
  }

  private handleEvents(events: RaceEvent[]): void {
    const player = this.race.player;
    // How loud something at (x, y) is from the player's seat.
    const near = (x: number, y: number): number => clamp(1 - Math.hypot(x - player.x, y - player.y) / 110, 0, 1);
    for (const e of events) {
      switch (e.type) {
        case 'jump':
          if (e.car === player) this.audio.jump();
          break;
        case 'land':
          this.effects.landing(e.car);
          if (e.car === player) {
            this.audio.land();
            this.chase.addShake(0.35);
          }
          break;
        case 'pad':
          if (e.car === player) this.audio.nitro();
          break;
        case 'pickup':
          if (e.car !== player) break;
          if (e.prize === 'repair') {
            this.audio.repair();
            this.hud.say('REPAIRED', 1.2, 'small');
          } else {
            this.audio.pickup();
          }
          break;
        case 'item':
          if (e.item === 'missile') this.audio.launch(e.car === player ? 1 : near(e.car.x, e.car.y) * 0.7);
          else if (e.car !== player) break;
          else if (e.item === 'shield') this.audio.shieldUp();
          else if (e.item === 'nitro') this.audio.nitro();
          else if (e.item !== 'shockwave') this.audio.drop();
          break;
        case 'explosion': {
          const n = near(e.x, e.y);
          this.effects.explosion(e.x, e.y);
          this.audio.explosion(n);
          this.chase.addShake(n * n * 1.2);
          break;
        }
        case 'shockwave':
          this.worldItems?.shockwave(e.x, e.y);
          this.audio.shockwave(near(e.x, e.y));
          break;
        case 'oiled':
          if (e.car === player) {
            this.audio.oil();
            this.hud.say('OIL!', 1, 'small warn');
          }
          break;
        case 'struck':
          if (e.car === player) {
            if (e.result === 'blocked') {
              this.audio.shieldPop();
              this.hud.say('BLOCKED!', 1, 'small');
            } else {
              this.chase.addShake(0.6);
            }
          } else if (e.by === player && e.result !== 'none') {
            this.hud.say(
              e.result === 'blocked' ? `${e.car.name} BLOCKED IT` : `GOT ${e.car.name.toUpperCase()}!`, 1.2, 'small',
            );
          }
          break;
        case 'wreck':
          if (e.car === player) this.hud.say('WRECKED!', 1.8, 'warn');
          break;
        case 'count':
          this.hud.say(String(e.n), 0.9);
          this.audio.beep(false);
          break;
        case 'go':
          this.hud.say('GO!', 1);
          this.audio.beep(true);
          break;
        case 'hit':
          this.effects.burst(e.x, e.y, e.strength);
          if (e.player) {
            this.audio.hit(e.strength);
            this.chase.addShake(e.strength / 25);
          }
          break;
        case 'lap':
          if (e.car === player) {
            const lapTime = this.race.time - this.lapStart;
            this.lapStart = this.race.time;
            if (this.bestLap === 0 || lapTime < this.bestLap) this.bestLap = lapTime;
            this.audio.lap();
            this.hud.say(
              player.lap === this.race.laps ? 'FINAL LAP!' : `LAP ${player.lap}  ·  ${formatTime(lapTime)}`,
              2, 'small',
            );
          }
          break;
        case 'finish':
          if (e.car === player) {
            const lapTime = this.race.time - this.lapStart;
            if (this.bestLap === 0 || lapTime < this.bestLap) this.bestLap = lapTime;
            const place = this.race.placeOf(player);
            this.audio.finish(place <= 3);
            this.hud.say(place === 1 ? 'WINNER!' : 'FINISH!', 2.5);
            this.resultsDelay = 2.5;
          }
          break;
        case 'respawn':
          break;
      }
    }
  }

  private readonly frame = (now: number): void => {
    requestAnimationFrame(this.frame);
    const dt = Math.min(0.1, (now - this.lastTime) / 1000);
    this.lastTime = now;
    this.clock += dt;

    this.handleMenus();
    const running = this.screen === 'race' || this.screen === 'results';

    if (running) {
      this.accumulator += dt;
      while (this.accumulator >= STEP) {
        this.accumulator -= STEP;
        const player = this.race.player;
        this.handleEvents(this.race.step(STEP, player.finished ? NO_INPUT : this.input.car()));
        this.effects.update(this.race.cars, this.race.weapons.missiles, STEP);
      }

      if (this.screen === 'race') {
        if (this.race.wrongWay > 1.2) this.hud.say('WRONG WAY', 0, 'small warn');
        else this.hud.clearSticky();
        if (this.resultsDelay > 0) {
          this.resultsDelay -= dt;
          if (this.resultsDelay <= 0) {
            this.screen = 'results';
            this.hud.show('results');
          }
        }
      }
      if (this.screen === 'results') this.hud.showResults(this.race);
      this.hud.update(this.race, this.bestLap, dt);
      this.audio.update(this.race.phase === 'racing' ? this.race.player : null);
    }
    this.input.endFrame();

    const alpha = running ? this.accumulator / STEP : 1;
    for (const m of this.carMeshes) m.update(alpha, running ? dt : 0, this.clock);
    this.worldItems?.update(this.race, this.clock, alpha, running ? dt : 0);
    this.trackScene?.update(this.clock);

    const p = this.race.player;
    const px = p.prevX + (p.x - p.prevX) * alpha;
    const pz = p.prevY + (p.y - p.prevY) * alpha;
    if (this.screen === 'title') {
      const mid = this.race.cars[2];
      this.chase.orbit(mid.x, mid.y, this.clock);
    } else if (this.screen === 'select') {
      // Close circling shot of the chosen car on the grid.
      this.chase.orbit(p.x, p.y, this.clock * 1.6, 12, 5.5, -3.2);
    } else if (this.screen !== 'pause') {
      this.chase.update(px, pz, lerpAngle(p.prevHeading, p.heading, alpha), p.vx, p.vy, p.boosting, dt);
    }
    this.view.focus(px, pz);
    this.view.render();
  };
}

new Game();
