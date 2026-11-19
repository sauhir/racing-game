import { SONGS, type Song, type SongId } from './songs';

const midi = (n: number): number => 440 * Math.pow(2, (n - 69) / 12);

/** Tiny look-ahead step sequencer playing the generated tunes in songs.ts. */
export class Music {
  private timer: number | null = null;
  private step = 0;
  private nextTime = 0;
  private song: Song = SONGS.menu;
  private queued: SongId | null = null;
  /** The tune now playing (or queued to start on the next bar), null when stopped. */
  current: SongId | null = null;
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

  /** Starts a tune, or switches to it at the next bar line if another is playing. */
  play(id: SongId): void {
    if (this.current === id) return;
    this.current = id;
    if (this.timer !== null) {
      this.queued = id;
      return;
    }
    this.song = SONGS[id];
    this.step = 0;
    this.nextTime = this.ctx.currentTime + 0.05;
    this.timer = window.setInterval(() => this.schedule(), 40);
  }

  stop(): void {
    if (this.timer === null) return;
    window.clearInterval(this.timer);
    this.timer = null;
    this.current = this.queued = null;
  }

  private schedule(): void {
    if (this.ctx.state !== 'running') {
      this.nextTime = this.ctx.currentTime + 0.05;
      return;
    }
    while (this.nextTime < this.ctx.currentTime + 0.15) {
      if (this.queued && this.step % 16 === 0) {
        this.song = SONGS[this.queued];
        this.queued = null;
        this.step = 0;
      }
      const stepTime = 60 / this.song.bpm / 4;
      // Swing delays every second sixteenth.
      const late = this.step % 2 === 1 ? this.song.swing * stepTime : 0;
      this.playStep(this.step, this.nextTime + late, stepTime);
      this.step = (this.step + 1) % (this.song.melody.length * 2);
      this.nextTime += stepTime;
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

  private playStep(step: number, t: number, stepTime: number): void {
    const song = this.song;
    const s = step % 16;
    const chord = song.chords[Math.floor(step / 16) % song.chords.length];

    if (song.kick[s] > 0) {
      const osc = this.ctx.createOscillator();
      osc.frequency.setValueAtTime(150, t);
      osc.frequency.exponentialRampToValueAtTime(45, t + 0.12);
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(song.kick[s], t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.16);
      osc.connect(g).connect(this.out);
      osc.start(t);
      osc.stop(t + 0.2);
    }
    if (song.snare[s] > 0) this.drum(t, 0.12, song.snare[s], 1200);
    if (song.hat[s] > 0) this.drum(t, 0.03, song.hat[s], 7000);
    if (song.bass[s] > 0) this.note(midi(chord[0] - 12), t, stepTime * 1.7, song.bassWave, song.bass[s]);
    if (song.arp[s] >= 0) this.note(midi(chord[song.arp[s]] + 12), t, stepTime * 0.9, 'square', song.arpVolume);

    // The melody joins on the second pass through the loop.
    const m = song.melody[step % song.melody.length];
    if (m >= 0 && step >= song.melody.length) {
      this.note(midi(song.scale[m]), t, stepTime * 1.8, song.lead, song.leadVolume);
    }
  }
}
