import type { CarInput } from '../sim/car';

const GAME_KEYS = new Set([
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'KeyW', 'KeyA', 'KeyS', 'KeyD',
  'ShiftLeft', 'ShiftRight', 'Enter', 'Escape', 'KeyR', 'KeyM', 'KeyP',
]);

/** Keyboard state: held keys for driving, plus one-shot presses for menu actions. */
export class Input {
  private readonly down = new Set<string>();
  private readonly pressed = new Set<string>();

  constructor(target: Window = window) {
    target.addEventListener('keydown', (e) => {
      if (GAME_KEYS.has(e.code)) e.preventDefault();
      if (!e.repeat) this.pressed.add(e.code);
      this.down.add(e.code);
    });
    target.addEventListener('keyup', (e) => this.down.delete(e.code));
    target.addEventListener('blur', () => this.down.clear());
  }

  private held(...codes: string[]): boolean {
    return codes.some((c) => this.down.has(c));
  }

  /** True once per key press; clears the press. */
  take(...codes: string[]): boolean {
    let hit = false;
    for (const c of codes) if (this.pressed.delete(c)) hit = true;
    return hit;
  }

  endFrame(): void {
    this.pressed.clear();
  }

  car(): CarInput {
    return {
      throttle: this.held('ArrowUp', 'KeyW') ? 1 : 0,
      brake: this.held('ArrowDown', 'KeyS') ? 1 : 0,
      steer: (this.held('ArrowRight', 'KeyD') ? 1 : 0) - (this.held('ArrowLeft', 'KeyA') ? 1 : 0),
      handbrake: this.held('Space'),
      boost: this.held('ShiftLeft', 'ShiftRight'),
    };
  }
}
