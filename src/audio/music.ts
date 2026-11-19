const BPM = 140;
const STEP = 60 / BPM / 4;

const midi = (n: number): number => 440 * Math.pow(2, (n - 69) / 12);

// Bright four-chord loop: C, G, Am, F. Each chord lasts one bar of 16 steps.
const CHORDS = [
  [48, 52, 55],
  [43, 47, 50],
  [45, 48, 52],
  [41, 45, 48],
];
// Lead melody over two passes of the progression, as semitone offsets into a
// C major pentatonic scale (-1 is a rest).
const SCALE = [72, 74, 76, 79, 81, 84, 86, 88];
const MELODY = [
  4, -1, 3, -1, 2, -1, 3, 4, -1, 4, -1, 5, 4, -1, 3, -1,
  3, -1, 2, -1, 1, -1, 2, 3, -1, 3, -1, 4, 3, -1, 1, -1,
  2, -1, 4, -1, 5, -1, 4, 2, -1, 2, -1, 4, 5, -1, 6, -1,
  5, -1, 4, -1, 2, -1, 1, 2, -1, 4, -1, 3, 2, -1, 0, -1,
];

/** Tiny look-ahead step sequencer playing a generated chiptune-ish loop. */
export class Music {
  private timer: number | null = null;
  private step = 0;
  private nextTime = 0;
  private readonly out: GainNode;
  private readonly noise: AudioBuffer;

  constructor(
    private readonly ctx: AudioContext,
    destination: AudioNode,
  ) {
    this.out = ctx.createGain();
    this.out.gain.value = 0.32;
    this.out.connect(destination);
    this.noise = ctx.createBuffer(1, ctx.sampleRate * 0.3, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }

  start(): void {
    if (this.timer !== null) return;
    this.step = 0;
    this.nextTime = this.ctx.currentTime + 0.05;
    this.timer = window.setInterval(() => this.schedule(), 40);
  }

  stop(): void {
    if (this.timer === null) return;
    window.clearInterval(this.timer);
    this.timer = null;
  }

  private schedule(): void {
    if (this.ctx.state !== 'running') {
      this.nextTime = this.ctx.currentTime + 0.05;
      return;
    }
    while (this.nextTime < this.ctx.currentTime + 0.15) {
      this.playStep(this.step, this.nextTime);
      this.step = (this.step + 1) % 128;
      this.nextTime += STEP;
    }
  }

  private note(freq: number, t: number, dur: number, type: OscillatorType, vol: number): void {
    const osc = this.ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = freq;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(g).connect(this.out);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  private drum(t: number, dur: number, vol: number, highpass: number): void {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    const f = this.ctx.createBiquadFilter();
    f.type = 'highpass';
    f.frequency.value = highpass;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f).connect(g).connect(this.out);
    src.start(t);
    src.stop(t + dur + 0.02);
  }

  private playStep(step: number, t: number): void {
    const s = step % 16;
    const chord = CHORDS[Math.floor(step / 16) % 4];

    if (s % 4 === 0) {
      const osc = this.ctx.createOscillator();
      osc.frequency.setValueAtTime(150, t);
      osc.frequency.exponentialRampToValueAtTime(45, t + 0.12);
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.7, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.16);
      osc.connect(g).connect(this.out);
      osc.start(t);
      osc.stop(t + 0.2);
    }
    if (s === 4 || s === 12) this.drum(t, 0.12, 0.35, 1200);
    if (s % 2 === 0) this.drum(t, 0.03, s % 4 === 2 ? 0.16 : 0.08, 7000);

    if (s % 2 === 0) this.note(midi(chord[0] - 12), t, STEP * 1.7, 'triangle', 0.55);
    this.note(midi(chord[[0, 1, 2, 1][s % 4]] + 12), t, STEP * 0.9, 'square', 0.07);

    const m = MELODY[step % 64];
    if (m >= 0 && step >= 64) this.note(midi(SCALE[m]), t, STEP * 1.8, 'square', 0.1);
  }
}
