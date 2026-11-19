export type SongId = 'meadow' | 'beach' | 'snow' | 'desert' | 'menu';
type Wave = 'sine' | 'square' | 'sawtooth' | 'triangle';

/**
 * A looping tune for the step sequencer. Time is in sixteenth-note steps, 16
 * to a bar. The loop is played twice over: first as backing only, then with
 * the lead melody on top.
 */
export interface Song {
  bpm: number;
  /** 0..0.4: how late every second sixteenth lands (0 = straight). */
  swing: number;
  /** One chord (three MIDI notes) per bar; repeats under the melody. */
  chords: number[][];
  /** Notes the melody indexes into. */
  scale: number[];
  /** Scale index per step, -1 for a rest. Length is a whole number of bars. */
  melody: number[];
  lead: Wave;
  leadVolume: number;
  /** Per-step patterns, 16 long. Values are volumes (0 = silent). */
  kick: number[];
  snare: number[];
  hat: number[];
  bass: number[];
  bassWave: Wave;
  /** Which chord note the arpeggio plays on each step (-1 = rest), and how loud. */
  arp: number[];
  arpVolume: number;
}

const R = -1;

export const SONGS: Record<SongId, Song> = {
  // Bright and bouncy: C, G, Am, F.
  meadow: {
    bpm: 140, swing: 0,
    chords: [[48, 52, 55], [43, 47, 50], [45, 48, 52], [41, 45, 48]],
    scale: [72, 74, 76, 79, 81, 84, 86, 88],
    melody: [
      4, R, 3, R, 2, R, 3, 4, R, 4, R, 5, 4, R, 3, R,
      3, R, 2, R, 1, R, 2, 3, R, 3, R, 4, 3, R, 1, R,
      2, R, 4, R, 5, R, 4, 2, R, 2, R, 4, 5, R, 6, R,
      5, R, 4, R, 2, R, 1, 2, R, 4, R, 3, 2, R, 0, R,
    ],
    lead: 'square', leadVolume: 0.1,
    kick: [0.7, 0, 0, 0, 0.7, 0, 0, 0, 0.7, 0, 0, 0, 0.7, 0, 0, 0],
    snare: [0, 0, 0, 0, 0.35, 0, 0, 0, 0, 0, 0, 0, 0.35, 0, 0, 0],
    hat: [0.08, 0, 0.16, 0, 0.08, 0, 0.16, 0, 0.08, 0, 0.16, 0, 0.08, 0, 0.16, 0],
    bass: [0.55, 0, 0.55, 0, 0.55, 0, 0.55, 0, 0.55, 0, 0.55, 0, 0.55, 0, 0.55, 0],
    bassWave: 'triangle',
    arp: [0, 1, 2, 1, 0, 1, 2, 1, 0, 1, 2, 1, 0, 1, 2, 1], arpVolume: 0.07,
  },
  // Sunny and swung, with an off-beat island bass: F, C, Dm, Bb.
  beach: {
    bpm: 124, swing: 0.2,
    chords: [[53, 57, 60], [48, 52, 55], [50, 53, 57], [46, 50, 53]],
    scale: [77, 79, 81, 84, 86, 89, 91, 93],
    melody: [
      2, R, R, 3, R, 2, R, 0, R, R, 2, R, 3, R, 4, R,
      3, R, R, 2, R, 1, R, 0, R, R, R, R, 1, R, 2, R,
      4, R, R, 5, R, 4, R, 2, R, R, 4, R, 5, R, 6, R,
      5, R, 4, R, R, 2, R, 3, R, R, 2, R, 1, R, R, R,
    ],
    lead: 'triangle', leadVolume: 0.2,
    kick: [0.6, 0, 0, 0, 0, 0, 0.5, 0, 0.6, 0, 0, 0, 0, 0, 0.5, 0],
    snare: [0, 0, 0, 0.12, 0.25, 0, 0, 0.12, 0, 0, 0.12, 0, 0.25, 0, 0, 0],
    hat: [0, 0, 0.14, 0, 0, 0, 0.14, 0, 0, 0, 0.14, 0, 0, 0, 0.14, 0.08],
    bass: [0.55, 0, 0, 0.45, 0, 0, 0.5, 0, 0.55, 0, 0, 0.45, 0, 0, 0.5, 0],
    bassWave: 'sine',
    arp: [R, R, 1, R, 2, R, 1, R, R, R, 1, R, 2, R, 1, 2], arpVolume: 0.09,
  },
  // Slower and sparkly, bell-like arpeggios: Am, F, C, G.
  snow: {
    bpm: 112, swing: 0,
    chords: [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]],
    scale: [81, 84, 86, 88, 91, 93, 96, 98],
    melody: [
      3, R, R, R, 2, R, R, R, 1, R, R, 2, R, R, 3, R,
      4, R, R, R, 2, R, R, R, 1, R, R, R, R, R, R, R,
      3, R, R, R, 4, R, R, R, 5, R, R, 4, R, R, 3, R,
      2, R, R, R, 3, R, R, R, 1, R, R, R, 0, R, R, R,
    ],
    lead: 'sine', leadVolume: 0.2,
    kick: [0.6, 0, 0, 0, 0, 0, 0, 0, 0.6, 0, 0, 0, 0, 0, 0, 0],
    snare: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.2, 0, 0, 0],
    hat: [0.06, 0.03, 0.06, 0.03, 0.1, 0.03, 0.06, 0.03, 0.06, 0.03, 0.06, 0.03, 0.1, 0.03, 0.06, 0.03],
    bass: [0.5, 0, 0, 0, 0, 0, 0.35, 0, 0.5, 0, 0, 0, 0, 0, 0.35, 0],
    bassWave: 'triangle',
    arp: [0, 1, 2, 1, 2, 1, 0, 1, 0, 1, 2, 1, 2, 1, 0, 1], arpVolume: 0.1,
  },
  // Fast and dusty with a flattened second: Em, F, Em, Dm.
  desert: {
    bpm: 150, swing: 0,
    chords: [[52, 55, 59], [53, 57, 60], [52, 55, 59], [50, 53, 57]],
    scale: [76, 77, 80, 81, 83, 84, 86, 88],
    melody: [
      0, R, 1, 2, R, 1, 0, R, 3, R, 2, 1, R, 0, R, R,
      1, R, 2, 3, R, 2, 1, R, 5, R, 3, 2, R, 1, R, R,
      4, R, 3, 2, R, 3, 4, R, 5, R, 4, 3, R, 2, R, R,
      3, R, 2, 1, R, 0, 1, R, 2, R, 1, 0, R, 0, R, R,
    ],
    lead: 'sawtooth', leadVolume: 0.07,
    kick: [0.7, 0, 0, 0.4, 0.7, 0, 0, 0, 0.7, 0, 0, 0.4, 0.7, 0, 0, 0],
    snare: [0, 0, 0, 0, 0.35, 0, 0, 0, 0, 0, 0, 0, 0.35, 0, 0.2, 0],
    hat: [0.1, 0.05, 0.1, 0.05, 0.1, 0.05, 0.1, 0.05, 0.1, 0.05, 0.1, 0.05, 0.1, 0.05, 0.1, 0.05],
    bass: [0.5, 0.35, 0.5, 0.35, 0.5, 0.35, 0.5, 0.35, 0.5, 0.35, 0.5, 0.35, 0.5, 0.35, 0.5, 0.35],
    bassWave: 'triangle',
    arp: [R, R, 2, R, R, 1, R, R, R, R, 2, R, R, 1, R, 2], arpVolume: 0.06,
  },
  // Calm, unhurried menu loop with no snare: C, Am, F, G.
  menu: {
    bpm: 92, swing: 0,
    chords: [[48, 52, 55], [45, 48, 52], [41, 45, 48], [43, 47, 50]],
    scale: [72, 74, 76, 79, 81, 84, 86, 88],
    melody: [
      2, R, R, R, R, R, 3, R, 4, R, R, R, R, R, R, R,
      3, R, R, R, R, R, 2, R, 1, R, R, R, R, R, R, R,
      2, R, R, R, R, R, 4, R, 5, R, R, R, 4, R, R, R,
      3, R, R, R, 2, R, R, R, 1, R, R, R, R, R, R, R,
    ],
    lead: 'triangle', leadVolume: 0.16,
    kick: [0.35, 0, 0, 0, 0, 0, 0, 0, 0.3, 0, 0, 0, 0, 0, 0, 0],
    snare: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    hat: [0, 0, 0, 0, 0.06, 0, 0, 0, 0, 0, 0, 0, 0.06, 0, 0, 0],
    bass: [0.45, 0, 0, 0, 0, 0, 0, 0, 0.35, 0, 0, 0, 0, 0, 0, 0],
    bassWave: 'sine',
    arp: [0, R, 1, R, 2, R, 1, R, 0, R, 1, R, 2, R, 1, R], arpVolume: 0.08,
  },
};
