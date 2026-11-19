import { GameAudio } from './audio/audio';
import {
  buyCar, buyUpgrade, CAR_PRICE, CUPS, cupStandings, cupUnlocked, MAX_LEVEL, newSave, recordRace, selectCar, startCup,
  statsFor, tierPace, tierRivals, trackForRace, UPGRADE_INFO, UPGRADE_KINDS, upgradeCost,
  type CupDef, type RaceOutcome, type Save,
} from './career/career';
import { loadSave, storeSave } from './career/save';
import { Input, type PadMode } from './core/input';
import { clamp, lerpAngle } from './core/math';
import { loadSettings, QUALITIES, storeSettings } from './core/settings';
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
import { NO_INPUT, type CarStats } from './sim/car';
import { Race, type RaceEvent } from './sim/race';
import { WEAPON } from './sim/weapons';
import { Track, type TrackDef } from './sim/track';
import { generateTrack } from './sim/trackGen';
import { Hud, formatTime, ordinal, type MenuItem } from './ui/hud';

const STEP = 1 / 60;
const LAPS = 3;
const SAVE_KEY = 'pocket-drifters-selection';
const THEME_NAMES = { meadow: 'Meadow', beach: 'Beach', snow: 'Snow', desert: 'Desert' };

type Screen =
  | 'title' | 'mainmenu' | 'settings' | 'career' | 'garage' | 'standings' | 'select' | 'race' | 'pause' | 'results';

const money = (n: number): string => `$${n.toLocaleString('en-US')}`;
const statBars = (st: CarStats): [string, number][] => [
  ['Speed', (st.maxSpeed - 42.5) / 9],
  ['Acceleration', (st.accel - 17) / 18],
  ['Handling', (st.turnRate - 2.2) / 1.1],
  ['Armour', (1 / st.armour - 0.45) / 2],
];

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

  // Career state.
  private mode: 'quick' | 'career' = 'quick';
  private save: Save = loadSave();
  private readonly settings = loadSettings();
  /** Reset career needs a second Enter to confirm. */
  private resetArmed = false;
  private menuRow = 0;
  private garageCar = 0;
  /** Result of the cup race just finished, until the standings have been shown. */
  private outcome: RaceOutcome | null = null;

  // Selection screen state. Track index TRACKS.length means "random circuit".
  private row = 0;
  private trackIndex = 0;
  private carIndex = 0;
  private randomSeed = 1 + Math.floor(Math.random() * 9999);

  constructor() {
    this.view.scene.add(this.effects.group);
    this.view.setQuality(this.settings.quality);
    this.audio.setVolumes(this.settings.music, this.settings.sfx);
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
  private loadTrack(def: TrackDef = this.trackDef()): void {
    if (this.trackScene) {
      this.view.scene.remove(this.trackScene.group);
      this.trackScene.dispose();
    }
    if (this.worldItems) this.view.scene.remove(this.worldItems.group);
    this.worldItems = null;

    this.track = new Track(def);
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
    // Quick races use stock cars and the standard field; the career uses the
    // player's own (upgraded) car and rivals matched to the cup's tier.
    const cup = this.currentCup();
    const career = this.mode === 'career';
    const carId = this.screen === 'garage' ? CARS[this.garageCar].id : this.save.car;
    this.race = new Race(this.track, {
      laps: LAPS, playerName: 'You', playerColor: PLAYER_COLOR, seed: this.seed++,
      rivals: career && cup ? tierRivals(cup.tier) : RIVALS,
      pace: career && cup ? tierPace(cup.tier) : 1,
      playerCar: career ? { id: carId, stats: statsFor(this.save, carId) } : CARS[this.carIndex],
      carFor: (id) => carById(id).stats,
    });
    this.outcome = null;
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
    this.audio.playMusic(this.track.def.theme);
    this.race.start();
    this.screen = 'race';
    this.hud.show('race');
  }

  private currentCup(): CupDef | undefined {
    return CUPS.find((c) => c.id === this.save.progress?.cup);
  }

  /** Leaves a race (or the title) for a menu: quiet the car, keep the scene. */
  private toMenu(screen: Screen): void {
    this.audio.init();
    this.audio.setPaused(false);
    this.audio.playMusic('menu');
    this.audio.update(null);
    this.screen = screen;
    this.menuRow = 0;
  }

  private openMainMenu(): void {
    this.toMenu('mainmenu');
    this.hud.show('menu');
    this.renderMenu();
  }

  private openSettings(): void {
    this.toMenu('settings');
    this.resetArmed = false;
    this.hud.show('menu');
    this.renderMenu();
  }

  private openCareer(): void {
    this.mode = 'career';
    this.toMenu('career');
    this.newRace();
    this.hud.show('menu');
    this.renderMenu();
  }

  private openGarage(): void {
    this.toMenu('garage');
    this.garageCar = Math.max(0, CARS.findIndex((c) => c.id === this.save.car));
    this.newRace();
    this.hud.show('menu');
    this.renderMenu();
  }

  /** Cup table before each race, and the final result after the last one. */
  private openStandings(): void {
    this.toMenu('standings');
    const cup = this.currentCup();
    if (cup && this.save.progress) this.loadTrack(trackForRace(cup.races[this.save.progress.next]));
    this.hud.show('menu');
    this.renderMenu();
  }

  private renderMenu(): void {
    const save = this.save;
    const hint = '↑ ↓ choose  ·  Enter select  ·  Esc back';
    if (this.screen === 'mainmenu') {
      this.hud.showMenu({
        title: 'Pocket Drifters', selected: this.menuRow, hint,
        items: [
          { label: 'Career', detail: 'Cups, prize money and your garage' },
          { label: 'Quick Race', detail: 'Any track, any car' },
          { label: 'Settings', detail: 'Sound and graphics' },
        ],
      });
    } else if (this.screen === 'settings') {
      const st = this.settings;
      const percent = (v: number): string => `◀  ${Math.round(v * 100)}%  ▶`;
      this.hud.showMenu({
        title: 'Settings', selected: this.menuRow,
        hint: '↑ ↓ choose  ·  ← → change  ·  Esc back',
        items: [
          { label: 'Music volume', detail: percent(st.music) },
          { label: 'Effects volume', detail: percent(st.sfx) },
          { label: 'Graphics quality', detail: `◀  ${st.quality[0].toUpperCase()}${st.quality.slice(1)}  ▶` },
          {
            label: 'Reset career',
            detail: this.resetArmed ? 'Press Enter again to erase all progress' : 'Erases money, cars and trophies',
          },
        ],
      });
    } else if (this.screen === 'career') {
      const items: MenuItem[] = CUPS.map((cup) => {
        const best = save.trophies[cup.id];
        const previous = CUPS.find((c) => c.tier === cup.tier - 1);
        if (!cupUnlocked(save, cup)) {
          return { label: cup.name, detail: `Locked: finish top 3 in the ${previous?.name}`, style: 'locked' };
        }
        if (save.progress?.cup === cup.id) {
          return { label: cup.name, detail: `Race ${save.progress.next + 1} of ${cup.races.length}: continue` };
        }
        return { label: cup.name, detail: best ? `Best finish: ${best}${ordinal(best)}` : 'Not raced yet' };
      });
      items.push({ label: 'Garage', detail: `Driving the ${carById(save.car).name}` });
      this.hud.showMenu({ title: 'Career', subtitle: `Money: ${money(save.money)}`, items, selected: this.menuRow, hint });
    } else if (this.screen === 'garage') {
      const car = CARS[this.garageCar];
      const owned = save.garage[car.id];
      const items: MenuItem[] = [{
        label: `◀  ${car.name}  ▶`,
        detail: owned ? `${car.blurb} · driving` : `${car.blurb} · ${money(CAR_PRICE[car.id])}: Enter to buy`,
      }];
      for (const kind of UPGRADE_KINDS) {
        const level = owned?.[kind] ?? 0;
        const cost = upgradeCost(save, car.id, kind);
        items.push({
          label: `${UPGRADE_INFO[kind].name}  ${'●'.repeat(level)}${'○'.repeat(MAX_LEVEL - level)}`,
          detail: !owned ? 'Buy the car first' : cost === null ? 'Fully upgraded' : `${money(cost)} · ${UPGRADE_INFO[kind].effect}`,
          style: owned ? undefined : 'locked',
        });
      }
      this.hud.showMenu({
        title: 'Garage', subtitle: `Money: ${money(save.money)}`, items, selected: this.menuRow, side: true,
        hint: '← → change car  ·  ↑ ↓ choose  ·  Enter buy  ·  Esc back',
        stats: statBars(statsFor(save, car.id)),
      });
    } else if (this.screen === 'standings') {
      const cup = this.currentCup();
      const o = this.outcome;
      const names = [...RIVALS.map((r) => r.name), 'You'];
      const table = o?.standings ?? (save.progress ? cupStandings(save.progress, names) : []);
      const items: MenuItem[] = table.map((s, i) => ({
        label: `${i + 1}${ordinal(i + 1)}   ${s.name}`, detail: `${s.points} ${s.points === 1 ? 'pt' : 'pts'}`,
        style: s.name === 'You' ? 'plain me' : 'plain',
      }));
      if (o?.cupDone) {
        const place = o.cupPlace ?? 0;
        this.hud.showMenu({
          title: place === 1 ? 'Cup won!' : `Cup finished: ${place}${ordinal(place)}`,
          subtitle: [o.bonus ? `Bonus ${money(o.bonus)}` : 'No bonus this time', o.unlocked ? `${o.unlocked} unlocked!` : '']
            .filter(Boolean).join('  ·  '),
          items, selected: -1, hint: 'Enter continue',
        });
      } else if (cup && save.progress) {
        this.hud.showMenu({
          title: `${cup.name}: race ${save.progress.next + 1} of ${cup.races.length}`,
          subtitle: this.track.def.name, items, selected: -1, hint: 'Enter race  ·  Esc back to career',
        });
      }
    }
  }

  private handleMenuScreen(enter: boolean, esc: boolean): void {
    const save = this.save;
    const rows = { mainmenu: 3, settings: 4, career: CUPS.length + 1, garage: UPGRADE_KINDS.length + 1, standings: 0 }[
      this.screen as 'mainmenu' | 'settings' | 'career' | 'garage' | 'standings'
    ];
    const move = (this.input.take('ArrowDown', 'KeyS') ? 1 : 0) - (this.input.take('ArrowUp', 'KeyW') ? 1 : 0);
    const side = (this.input.take('ArrowRight', 'KeyD') ? 1 : 0) - (this.input.take('ArrowLeft', 'KeyA') ? 1 : 0);
    if (move !== 0 && rows > 0) this.menuRow = (this.menuRow + move + rows) % rows;

    if (this.screen === 'mainmenu') {
      if (esc) {
        this.screen = 'title';
        return this.hud.show('title');
      }
      if (enter) return [() => this.openCareer(), () => this.openSelection(), () => this.openSettings()][this.menuRow]();
    } else if (this.screen === 'settings') {
      if (esc) return this.openMainMenu();
      const st = this.settings;
      if (move !== 0) this.resetArmed = false;
      if (side !== 0 && this.menuRow < 2) {
        const key = this.menuRow === 0 ? 'music' : 'sfx';
        st[key] = clamp(Math.round((st[key] + side * 0.1) * 10) / 10, 0, 1);
        this.audio.setVolumes(st.music, st.sfx);
        // A blip to judge the effects level by.
        if (key === 'sfx') this.audio.pickup();
      } else if (side !== 0 && this.menuRow === 2) {
        const n = QUALITIES.length;
        st.quality = QUALITIES[(QUALITIES.indexOf(st.quality) + side + n) % n];
        this.view.setQuality(st.quality);
      } else if (enter && this.menuRow === 3) {
        if (this.resetArmed) {
          this.save = newSave();
          storeSave(this.save);
          this.audio.drop();
        }
        this.resetArmed = !this.resetArmed;
      }
      if (side !== 0) storeSettings(st);
    } else if (this.screen === 'career') {
      if (esc) return this.openMainMenu();
      if (enter && this.menuRow === CUPS.length) return this.openGarage();
      if (enter) {
        const cup = CUPS[this.menuRow];
        if (!cupUnlocked(save, cup)) return this.audio.drop();
        startCup(save, cup);
        storeSave(save);
        return this.openStandings();
      }
    } else if (this.screen === 'garage') {
      if (esc) return this.openCareer();
      const car = CARS[this.garageCar];
      if (side !== 0) {
        this.garageCar = (this.garageCar + side + CARS.length) % CARS.length;
        // Looking at a car you own puts you in it.
        selectCar(save, CARS[this.garageCar].id);
        storeSave(save);
        this.newRace();
      } else if (enter) {
        const bought = this.menuRow === 0 ? buyCar(save, car.id) : buyUpgrade(save, car.id, UPGRADE_KINDS[this.menuRow - 1]);
        if (bought) {
          this.audio.pickup();
          storeSave(save);
          this.newRace();
        } else {
          this.audio.drop();
        }
      }
    } else if (this.screen === 'standings') {
      if (this.outcome?.cupDone) {
        if (enter || esc) return this.openCareer();
      } else if (enter) {
        this.newRace();
        return this.startRace();
      } else if (esc) {
        return this.openCareer();
      }
    }
    if (move !== 0 || side !== 0 || enter) this.renderMenu();
  }

  private openSelection(): void {
    this.mode = 'quick';
    this.audio.init();
    this.audio.setPaused(false);
    this.audio.playMusic('menu');
    this.audio.update(null);
    if (this.race.phase !== 'grid' || this.track.def !== this.trackDef()) this.loadTrack();
    else this.newRace();
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
        if (enter) this.openMainMenu();
        break;
      case 'mainmenu':
      case 'settings':
      case 'career':
      case 'garage':
      case 'standings':
        this.handleMenuScreen(enter, esc || back);
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
        } else if (this.outcome) {
          // The cup race is already in the books: no restarting or quitting it now.
        } else if (enter) {
          this.newRace();
          this.startRace();
        } else if (back) {
          if (this.mode === 'career') this.openCareer();
          else this.openSelection();
        }
        break;
      case 'results':
        if (this.mode === 'career') {
          if (enter || esc) this.openStandings();
        } else if (enter) {
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
          this.worldItems?.pulse(e.car.x, e.car.y, 0xffffff, 5, 0.3);
          if (e.car === player) {
            this.audio.land();
            this.chase.addShake(0.35);
          }
          break;
        case 'pad':
          this.effects.ringBurst(e.car.x, e.car.y, 0x4fd8ff, 14, 20);
          this.worldItems?.pulse(e.car.x, e.car.y, 0x4fd8ff, 6, 0.35);
          if (e.car === player) {
            this.audio.nitro();
          }
          break;
        case 'pickup':
          this.effects.pickup(e.x, e.y);
          this.worldItems?.pulse(e.x, e.y, 0xffe14a, 8, 0.45, 0.5);
          if (e.car !== player) break;
          this.hud.flash('pickup', 0.8);
          this.chase.addShake(0.25);
          if (e.prize === 'repair') {
            this.audio.repair();
            this.hud.say('REPAIRED', 1.2, 'small');
          } else {
            this.audio.pickup();
          }
          break;
        case 'item':
          if (e.item === 'shield') {
            this.worldItems?.pulse(e.car.x, e.car.y, 0x6ff0ff, 6, 0.4, 0.5);
            this.effects.ringBurst(e.car.x, e.car.y, 0x6ff0ff, 9, 24);
          } else if (e.item === 'nitro') {
            this.effects.ringBurst(e.car.x, e.car.y, 0xffc23c, 12, 24);
          } else if (e.item === 'missile') {
            this.worldItems?.pulse(e.car.x, e.car.y, 0xff8a2e, 5, 0.3, 0.8);
          }
          if (e.item === 'missile') this.audio.launch(e.car === player ? 1 : near(e.car.x, e.car.y) * 0.7);
          else if (e.car !== player) break;
          else if (e.item === 'shield') this.audio.shieldUp();
          else if (e.item === 'nitro') this.audio.nitro();
          else if (e.item !== 'shockwave') this.audio.drop();
          break;
        case 'explosion': {
          const n = near(e.x, e.y);
          this.effects.explosion(e.x, e.y);
          this.worldItems?.pulse(e.x, e.y, 0xffa02e, 13, 0.55, 0.8);
          this.worldItems?.pulse(e.x, e.y, 0xffffff, 7, 0.25, 0.8);
          if (n > 0.35) this.hud.flash('boom', n * n, 0.5);
          this.audio.explosion(n);
          this.chase.addShake(n * n * 1.2);
          break;
        }
        case 'shockwave':
          this.worldItems?.pulse(e.x, e.y, 0xb78bff, WEAPON.shockRadius, 0.5, 0.35);
          this.worldItems?.pulse(e.x, e.y, 0xffffff, WEAPON.shockRadius * 0.7, 0.35);
          this.effects.ringBurst(e.x, e.y, 0xc9a2ff, 26, 48);
          this.audio.shockwave(near(e.x, e.y));
          break;
        case 'oiled':
          if (e.car === player) {
            this.audio.oil();
            this.hud.say('OIL!', 1, 'small warn');
          }
          break;
        case 'struck':
          if (e.result === 'blocked') {
            this.worldItems?.pulse(e.car.x, e.car.y, 0x6ff0ff, 10, 0.4, 0.7);
            this.effects.ringBurst(e.car.x, e.car.y, 0x9ff6ff, 18, 40);
          }
          if (e.car === player) {
            if (e.result === 'blocked') {
              this.audio.shieldPop();
              this.hud.say('BLOCKED!', 1, 'small');
              this.hud.flash('shield', 0.45, 0.3);
            } else {
              this.chase.addShake(0.6);
              this.hud.flash('hit', 0.9, 0.6);
            }
          } else if (e.by === player && e.result !== 'none') {
            this.hud.say(
              e.result === 'blocked' ? `${e.car.name} BLOCKED IT` : `GOT ${e.car.name.toUpperCase()}!`, 1.2, 'small',
            );
          }
          break;
        case 'wreck':
          this.worldItems?.pulse(e.car.x, e.car.y, 0xff5a1a, 18, 0.7, 1);
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
            this.hud.flash('gold', 0.7, 0.7);
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
            this.hud.flash('pickup', 1, 0.9);
            for (let k = 0; k < 4; k++) this.effects.pickup(player.x + (k % 2 ? 4 : -4), player.y + (k < 2 ? 4 : -4));
            this.hud.say(place === 1 ? 'WINNER!' : 'FINISH!', 2.5);
            this.resultsDelay = 2.5;
            if (this.mode === 'career' && this.save.progress) {
              this.outcome = recordRace(this.save, this.race.standings().map((c) => c.name), player.name);
              storeSave(this.save);
            }
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

    const padMode: PadMode = this.screen === 'race' ? 'race' : this.screen === 'pause' ? 'pause' : 'menu';
    this.input.poll(padMode);
    this.hud.showGamepadHints(this.input.gamepadSeen);
    this.handleMenus();
    const running = this.screen === 'race' || this.screen === 'results';

    if (running) {
      this.accumulator += dt;
      while (this.accumulator >= STEP) {
        this.accumulator -= STEP;
        const player = this.race.player;
        this.handleEvents(this.race.step(STEP, player.finished ? NO_INPUT : this.input.car()));
        // Waiting boxes twinkle.
        this.race.boxes.forEach((box, i) => {
          if (box.respawn === 0 && Math.random() < 0.12) this.effects.sparkle(box.x, box.y, i + Math.floor(this.clock * 3));
        });
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
      if (this.screen === 'results') {
        const o = this.outcome;
        if (this.mode === 'career' && o) {
          this.hud.showResults(this.race, `Prize ${money(o.prize)}  ·  +${o.points} ${o.points === 1 ? 'point' : 'points'}`, 'Press Enter to continue', '');
        } else {
          this.hud.showResults(this.race, '', 'Press Enter to race again', 'Esc: choose another track or car');
        }
      }
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
    if (['title', 'mainmenu', 'settings', 'career', 'standings'].includes(this.screen)) {
      const mid = this.race.cars[2];
      this.chase.orbit(mid.x, mid.y, this.clock);
    } else if (this.screen === 'garage') {
      this.chase.orbit(p.x, p.y, this.clock * 1.6, 12, 5.5, -1, 4);
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
