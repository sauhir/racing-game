import { GameAudio } from './audio/audio';
import { Input } from './core/input';
import { clamp, lerpAngle } from './core/math';
import { PLAYER_COLOR, RIVALS } from './data/rivals';
import { MEADOW } from './data/tracks/meadow';
import { ChaseCamera } from './render/camera';
import { CarMesh } from './render/carMesh';
import { Effects } from './render/effects';
import { WorldItems } from './render/pickups';
import { View } from './render/scene';
import { buildTrackScene } from './render/trackMesh';
import { NO_INPUT } from './sim/car';
import { Race, type RaceEvent } from './sim/race';
import { Track } from './sim/track';
import { Hud, formatTime } from './ui/hud';

const STEP = 1 / 60;
const LAPS = 3;

type Screen = 'title' | 'race' | 'pause' | 'results';

class Game {
  private readonly view = new View(document.getElementById('game') as HTMLCanvasElement);
  private readonly input = new Input();
  private readonly audio = new GameAudio();
  private readonly hud = new Hud();
  private readonly track = new Track(MEADOW);
  private readonly chase = new ChaseCamera(this.view.camera);
  private readonly effects = new Effects();
  private carMeshes: CarMesh[] = [];
  private worldItems: WorldItems | null = null;
  private race!: Race;
  private screen: Screen = 'title';
  private accumulator = 0;
  private lastTime = performance.now();
  private clock = 0;
  private seed = 1;
  private lapStart = 0;
  private bestLap = 0;
  private resultsDelay = 0;

  constructor() {
    this.view.scene.add(buildTrackScene(this.track), this.effects.group);
    this.hud.setTrack(this.track);
    this.newRace();
    this.hud.show('title');
    requestAnimationFrame(this.frame);
  }

  private newRace(): void {
    for (const m of this.carMeshes) this.view.scene.remove(m.root);
    this.race = new Race(this.track, {
      laps: LAPS, playerName: 'You', playerColor: PLAYER_COLOR, rivals: RIVALS, seed: this.seed++,
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

  private handleMenus(): void {
    const enter = this.input.take('Enter');
    const esc = this.input.take('Escape', 'KeyP');
    if (this.input.take('KeyM')) this.audio.toggleMute();

    switch (this.screen) {
      case 'title':
        if (enter) this.startRace();
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
        }
        break;
      case 'results':
        if (enter) {
          this.newRace();
          this.startRace();
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
            this.hud.say(e.result === 'blocked' ? `${e.car.name} BLOCKED IT` : `GOT ${e.car.name.toUpperCase()}!`, 1.2, 'small');
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

    const p = this.race.player;
    const px = p.prevX + (p.x - p.prevX) * alpha;
    const pz = p.prevY + (p.y - p.prevY) * alpha;
    if (this.screen === 'title') {
      const mid = this.race.cars[2];
      this.chase.orbit(mid.x, mid.y, this.clock);
    } else if (this.screen !== 'pause') {
      this.chase.update(px, pz, lerpAngle(p.prevHeading, p.heading, alpha), p.vx, p.vy, p.boosting, dt);
    }
    this.view.focus(px, pz);
    this.view.render();
  };
}

new Game();
