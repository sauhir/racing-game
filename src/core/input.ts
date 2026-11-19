import type { CarInput } from '../sim/car';

const GAME_KEYS = new Set([
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'KeyW', 'KeyA', 'KeyS', 'KeyD',
  'ShiftLeft', 'ShiftRight', 'KeyE', 'KeyX', 'ControlLeft', 'ControlRight', 'Enter', 'Escape', 'Backspace',
  'KeyR', 'KeyM', 'KeyP',
]);

const ITEM_KEYS = ['KeyE', 'KeyX', 'ControlLeft', 'ControlRight'];

/** What the gamepad's buttons should mean right now. */
export type PadMode = 'race' | 'pause' | 'menu';

/** The parts of a Gamepad this module reads (standard mapping). */
export interface PadLike {
  buttons: readonly { pressed: boolean; value: number }[];
  axes: readonly number[];
}

type KeyTarget = Pick<Window, 'addEventListener'>;

const DEAD_ZONE = 0.15;
const STICK_AS_DPAD = 0.6;

/**
 * Standard-mapping gamepad buttons as the key codes the game already uses,
 * so menus and driving work the same from either device.
 *   0 A, 1 B, 2 X, 3 Y, 4 LB, 5 RB, 6 LT, 7 RT, 9 Start, 12-15 d-pad.
 * Indices 100-103 are the left stick pushed up/down/left/right (menus only).
 */
const PAD_MAP: Record<PadMode, Record<number, string>> = {
  race: {
    0: 'Space', 1: 'KeyE', 4: 'KeyE', 2: 'ShiftLeft', 5: 'ShiftLeft', 3: 'KeyR', 9: 'Escape',
    14: 'ArrowLeft', 15: 'ArrowRight',
  },
  pause: { 0: 'Enter', 1: 'Backspace', 9: 'Escape' },
  menu: {
    0: 'Enter', 9: 'Enter', 1: 'Escape', 3: 'KeyR',
    12: 'ArrowUp', 13: 'ArrowDown', 14: 'ArrowLeft', 15: 'ArrowRight',
    100: 'ArrowUp', 101: 'ArrowDown', 102: 'ArrowLeft', 103: 'ArrowRight',
  },
};

/** Keyboard and gamepad state: held controls for driving, one-shot presses for menus. */
export class Input {
  private readonly down = new Set<string>();
  private readonly pressed = new Set<string>();
  /** A quick tap of the item key is remembered until the simulation reads it. */
  private itemTap = false;

  private readonly padDown = new Set<string>();
  private padButtons: boolean[] = [];
  private padSteer = 0;
  private padThrottle = 0;
  private padBrake = 0;
  /** True once any gamepad has been connected. */
  gamepadSeen = false;

  constructor(
    target: KeyTarget = window,
    private readonly getPads: () => readonly (PadLike | null)[] = () =>
      typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : [],
  ) {
    target.addEventListener('keydown', (e) => {
      if (GAME_KEYS.has(e.code)) e.preventDefault();
      if (!e.repeat) {
        this.pressed.add(e.code);
        if (ITEM_KEYS.includes(e.code)) this.itemTap = true;
      }
      this.down.add(e.code);
    });
    target.addEventListener('keyup', (e) => this.down.delete(e.code));
    target.addEventListener('blur', () => this.down.clear());
  }

  /** Reads the gamepad. Call once at the start of every frame. */
  poll(mode: PadMode): void {
    this.padDown.clear();
    this.padSteer = this.padThrottle = this.padBrake = 0;
    const pad = this.getPads().find((p) => p);
    if (!pad) {
      this.padButtons = [];
      return;
    }
    this.gamepadSeen = true;

    const x = pad.axes[0] ?? 0;
    const y = pad.axes[1] ?? 0;
    const now: boolean[] = [];
    pad.buttons.forEach((b, i) => (now[i] = b.pressed || b.value > 0.5));
    now[100] = y < -STICK_AS_DPAD;
    now[101] = y > STICK_AS_DPAD;
    now[102] = x < -STICK_AS_DPAD;
    now[103] = x > STICK_AS_DPAD;

    const map = PAD_MAP[mode];
    for (const [index, code] of Object.entries(map)) {
      const i = Number(index);
      if (!now[i]) continue;
      this.padDown.add(code);
      // Presses fire once, when the button goes down.
      if (!this.padButtons[i]) {
        this.pressed.add(code);
        if (ITEM_KEYS.includes(code)) this.itemTap = true;
      }
    }
    this.padButtons = now;

    if (mode === 'race') {
      const mag = Math.abs(x);
      this.padSteer = mag < DEAD_ZONE ? 0 : (Math.sign(x) * (mag - DEAD_ZONE)) / (1 - DEAD_ZONE);
      this.padThrottle = pad.buttons[7]?.value ?? 0;
      this.padBrake = pad.buttons[6]?.value ?? 0;
    }
  }

  private held(...codes: string[]): boolean {
    return codes.some((c) => this.down.has(c) || this.padDown.has(c));
  }

  /** True once per press; clears the press. */
  take(...codes: string[]): boolean {
    let hit = false;
    for (const c of codes) if (this.pressed.delete(c)) hit = true;
    return hit;
  }

  endFrame(): void {
    this.pressed.clear();
  }

  car(): CarInput {
    const useItem = this.itemTap || this.held(...ITEM_KEYS);
    this.itemTap = false;
    const keySteer = (this.held('ArrowRight', 'KeyD') ? 1 : 0) - (this.held('ArrowLeft', 'KeyA') ? 1 : 0);
    return {
      throttle: Math.max(this.held('ArrowUp', 'KeyW') ? 1 : 0, this.padThrottle),
      brake: Math.max(this.held('ArrowDown', 'KeyS') ? 1 : 0, this.padBrake),
      // The stick gives proportional steering; keys and d-pad are all-or-nothing.
      steer: keySteer !== 0 ? keySteer : this.padSteer,
      handbrake: this.held('Space'),
      boost: this.held('ShiftLeft', 'ShiftRight'),
      useItem,
    };
  }
}
