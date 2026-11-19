import type { Car } from '../sim/car';
import { Music } from './music';

/** All sound is synthesised with WebAudio; there are no audio files. */
export class GameAudio {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private engineOsc!: OscillatorNode;
  private engineSub!: OscillatorNode;
  private engineFilter!: BiquadFilterNode;
  private engineGain!: GainNode;
  private skidGain!: GainNode;
  private boostGain!: GainNode;
  private noise!: AudioBuffer;
  private music: Music | null = null;
  muted = false;

  /** Must be called from a user gesture (browsers block audio before one). */
  init(): void {
    if (this.ctx) {
      void this.ctx.resume();
      return;
    }
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    const ctx = (this.ctx = new Ctor());
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.7;
    this.master.connect(ctx.destination);

    this.noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;

    this.engineOsc = ctx.createOscillator();
    this.engineOsc.type = 'sawtooth';
    this.engineSub = ctx.createOscillator();
    this.engineSub.type = 'square';
    this.engineFilter = ctx.createBiquadFilter();
    this.engineFilter.type = 'lowpass';
    this.engineFilter.Q.value = 2;
    this.engineGain = ctx.createGain();
    this.engineGain.gain.value = 0;
    this.engineOsc.connect(this.engineFilter);
    this.engineSub.connect(this.engineFilter);
    this.engineFilter.connect(this.engineGain).connect(this.master);
    this.engineOsc.start();
    this.engineSub.start();

    this.skidGain = this.noiseLoop('bandpass', 1500, 4);
    this.boostGain = this.noiseLoop('highpass', 2200, 0.7);
    this.music = new Music(ctx, this.master);
  }

  private noiseLoop(type: BiquadFilterType, freq: number, q: number): GainNode {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = freq;
    filter.Q.value = q;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    src.connect(filter).connect(gain).connect(this.master);
    src.start();
    return gain;
  }

  toggleMute(): void {
    this.muted = !this.muted;
    if (this.ctx) this.master.gain.setTargetAtTime(this.muted ? 0 : 0.7, this.ctx.currentTime, 0.03);
  }

  setPaused(paused: boolean): void {
    if (!this.ctx) return;
    if (paused) void this.ctx.suspend();
    else void this.ctx.resume();
  }

  startMusic(): void {
    this.music?.start();
  }

  stopMusic(): void {
    this.music?.stop();
  }

  /** Continuous sounds driven by the player's car. Pass null to silence them. */
  update(car: Car | null): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    if (!car) {
      for (const g of [this.engineGain, this.skidGain, this.boostGain]) g.gain.setTargetAtTime(0, t, 0.1);
      return;
    }
    // Fake a gearbox so the pitch rises and drops as the car accelerates.
    const ratio = Math.min(1.35, Math.abs(car.forwardSpeed) / car.stats.maxSpeed);
    const gears = 4;
    const g = Math.min(gears - 1, Math.floor(ratio * gears));
    const inGear = ratio * gears - g;
    const rpm = 0.25 + 0.75 * Math.min(1.3, inGear) * (0.75 + 0.25 * (g / gears)) + (car.drifting ? 0.12 : 0);
    const freq = 55 + rpm * 150;
    this.engineOsc.frequency.setTargetAtTime(freq, t, 0.04);
    this.engineSub.frequency.setTargetAtTime(freq / 2, t, 0.04);
    this.engineFilter.frequency.setTargetAtTime(300 + rpm * 1400 + car.throttle * 600, t, 0.05);
    this.engineGain.gain.setTargetAtTime(0.05 + car.throttle * 0.05, t, 0.06);
    this.skidGain.gain.setTargetAtTime(car.offroad ? 0 : car.slide * 0.13, t, 0.05);
    this.boostGain.gain.setTargetAtTime(car.boosting ? 0.12 : 0, t, 0.05);
  }

  private tone(freq: number, dur: number, type: OscillatorType, vol: number, delay = 0, slideTo?: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(vol, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(gain).connect(this.master);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  beep(go: boolean): void {
    this.tone(go ? 880 : 440, go ? 0.6 : 0.18, 'square', 0.12);
  }

  hit(strength: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const vol = Math.min(0.5, 0.08 + strength / 60);
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 700;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(vol, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
    src.connect(filter).connect(gain).connect(this.master);
    src.start(t, Math.random());
    src.stop(t + 0.25);
    this.tone(110, 0.18, 'sine', vol, 0, 40);
  }

  lap(): void {
    this.tone(660, 0.12, 'triangle', 0.18);
    this.tone(990, 0.2, 'triangle', 0.18, 0.11);
  }

  finish(won: boolean): void {
    const notes = won ? [523, 659, 784, 1047, 784, 1047] : [523, 494, 440, 392];
    notes.forEach((n, i) => this.tone(n, 0.22, 'square', 0.1, i * 0.13));
  }
}
