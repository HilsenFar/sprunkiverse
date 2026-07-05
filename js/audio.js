// ============================================================
//  SPRUNKI 3D — Audio Engine
//  Every loop is synthesized in-browser with an OfflineAudioContext.
//  All loops share one tempo / key / progression so any mix works.
//  Loops are rendered twice and the 2nd pass is extracted, so
//  reverb & delay tails wrap around seamlessly.
// ============================================================

export const BPM = 112;
export const BEATS_PER_BAR = 4;
export const BARS = 4;
export const BEAT = 60 / BPM;                       // 0.5357 s
export const BAR = BEAT * BEATS_PER_BAR;            // 2.1428 s
export const LOOP_LEN = BAR * BARS;                 // 8.5714 s
const SR = 44100;

const midiHz = (n) => 440 * Math.pow(2, (n - 69) / 12);

// Chord progression: Am | F | C | G  (one chord per bar)
const PROG = {
  roots: [45, 41, 36, 43],                          // A2 F2 C2 G2
  chords: [
    [57, 60, 64],                                   // A3 C4 E4
    [53, 57, 60],                                   // F3 A3 C4
    [48, 52, 55],                                   // C3 E3 G3
    [55, 59, 62],                                   // G3 B3 D4
  ],
};
const PENTA = [57, 60, 62, 64, 67, 69, 72, 74, 76]; // A minor pentatonic

// ------------------------------------------------------------
//  Musical material per phase — every phase re-composes the
//  classic loops darker: bright pentatonic → wistful minor →
//  phrygian menace → dissonant clusters over a deep pedal.
//  `dark` (0..1) also drives timbre: closing filters, wider
//  detune, slower vibrato, sparser patterns.
// ------------------------------------------------------------
const PHASE_MUSIC = [
  { // Ⅰ — bright: Am F C G
    dark: 0,
    roots: PROG.roots,
    chords: PROG.chords,
    penta: PENTA,
    lead: [
      [0.0, 69, 0.75], [1.0, 72, 0.45], [1.5, 74, 0.45], [2.0, 76, 1.2], [3.25, 74, 0.6],
      [4.0, 72, 0.75], [5.0, 69, 0.45], [5.5, 67, 0.45], [6.0, 69, 1.6],
    ],
    vowels: [['ah', 'oh'], ['oo', 'ah'], ['eh', 'ah'], ['oh', 'oo']],
    echoNotes: [81, 84, 88, 79],
  },
  { // Ⅱ — dusk: Am Em F E — the joy drains out
    dark: 0.35,
    roots: [45, 40, 41, 40],
    chords: [[57, 60, 64], [52, 55, 59], [53, 57, 60], [52, 56, 59]],
    penta: [57, 59, 60, 62, 64, 65, 67, 69, 71],
    lead: [
      [0.0, 69, 1.2], [1.5, 67, 0.45], [2.0, 64, 1.2], [3.25, 65, 0.6],
      [4.0, 64, 0.75], [5.0, 62, 0.45], [5.5, 60, 0.45], [6.0, 59, 1.6],
    ],
    vowels: [['oh', 'oo'], ['oo', 'oh'], ['ah', 'oo'], ['oo', 'oh']],
    echoNotes: [76, 79, 83, 74],
  },
  { // Ⅲ — corrupt: Am B♭ F E(♭9) — phrygian menace, tritone bite
    dark: 0.7,
    roots: [45, 46, 41, 40],
    chords: [[57, 60, 64], [58, 62, 65], [53, 57, 60], [52, 56, 58]],
    penta: [57, 58, 60, 63, 64, 66, 69, 70],
    lead: [
      [0.0, 69, 0.9], [1.0, 70, 0.9], [2.0, 69, 0.6], [2.5, 66, 0.6], [3.0, 63, 1.0],
      [4.0, 64, 1.4], [5.5, 58, 0.5], [6.0, 57, 1.8],
    ],
    vowels: [['oo', 'oh'], ['oh', 'oo'], ['oo', 'ah'], ['oo', 'oo']],
    echoNotes: [70, 75, 78, 69],
  },
  { // Ⅳ — void: minor-second clusters over an A/B♭ pedal — pure dread
    dark: 1,
    roots: [33, 34, 33, 32],
    chords: [[57, 58, 64], [56, 57, 63], [57, 58, 64], [55, 56, 62]],
    penta: [57, 58, 63, 66, 69, 70],
    lead: [[0.0, 69, 3.4], [4.0, 70, 3.4]],
    vowels: [['oo', 'oo'], ['oo', 'oo'], ['oo', 'oo'], ['oo', 'oo']],
    echoNotes: [69, 70, 69, 68],
  },
];

// ------------------------------------------------------------
//  Offline-render helpers
// ------------------------------------------------------------

function makeNoiseBuffer(ctx, seconds = 2) {
  const buf = ctx.createBuffer(1, Math.ceil(seconds * ctx.sampleRate), ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}

function env(param, t, attack, peak, decay, floor = 0.0001) {
  param.setValueAtTime(floor, t);
  param.linearRampToValueAtTime(peak, t + attack);
  param.exponentialRampToValueAtTime(floor, t + attack + decay);
}

function kick(ctx, dest, t, gain = 1, fStart = 160) {
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.frequency.setValueAtTime(fStart, t);
  osc.frequency.exponentialRampToValueAtTime(42, t + 0.11);
  env(g.gain, t, 0.002, gain, 0.42);
  osc.connect(g); g.connect(dest);
  osc.start(t); osc.stop(t + 0.5);
  // beater click
  const c = ctx.createBufferSource(); c.buffer = ctx._noise;
  const cf = ctx.createBiquadFilter(); cf.type = 'highpass'; cf.frequency.value = 3000;
  const cg = ctx.createGain();
  env(cg.gain, t, 0.001, gain * 0.35, 0.02);
  c.connect(cf); cf.connect(cg); cg.connect(dest);
  c.start(t); c.stop(t + 0.05);
}

function hat(ctx, dest, t, gain = 0.5, open = false) {
  const s = ctx.createBufferSource(); s.buffer = ctx._noise;
  const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 8200;
  const g = ctx.createGain();
  env(g.gain, t, 0.001, gain, open ? 0.22 : 0.035);
  s.connect(f); f.connect(g); g.connect(dest);
  s.start(t, Math.random()); s.stop(t + (open ? 0.3 : 0.08));
}

function snare(ctx, dest, t, gain = 0.8) {
  const s = ctx.createBufferSource(); s.buffer = ctx._noise;
  const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1900; f.Q.value = 0.7;
  const g = ctx.createGain();
  env(g.gain, t, 0.001, gain, 0.16);
  s.connect(f); f.connect(g); g.connect(dest);
  s.start(t, Math.random()); s.stop(t + 0.25);
  const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.setValueAtTime(190, t);
  const og = ctx.createGain();
  env(og.gain, t, 0.001, gain * 0.5, 0.09);
  o.connect(og); og.connect(dest);
  o.start(t); o.stop(t + 0.15);
}

function clap(ctx, dest, t, gain = 0.7) {
  for (const dt of [0, 0.011, 0.023, 0.038]) {
    const s = ctx.createBufferSource(); s.buffer = ctx._noise;
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1500; f.Q.value = 1.4;
    const g = ctx.createGain();
    env(g.gain, t + dt, 0.001, gain * (dt === 0.038 ? 0.9 : 0.45), dt === 0.038 ? 0.24 : 0.02);
    s.connect(f); f.connect(g); g.connect(dest);
    s.start(t + dt, Math.random()); s.stop(t + dt + 0.3);
  }
}

function pluck(ctx, dest, t, freq, gain = 0.5, decay = 0.3, bright = 9) {
  const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = freq;
  const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.Q.value = 3;
  f.frequency.setValueAtTime(freq * bright, t);
  f.frequency.exponentialRampToValueAtTime(freq * 1.4, t + decay);
  const g = ctx.createGain();
  env(g.gain, t, 0.002, gain, decay);
  o.connect(f); f.connect(g); g.connect(dest);
  o.start(t); o.stop(t + decay + 0.1);
}

function subBass(ctx, dest, t, freq, dur, gain = 0.8) {
  const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = freq;
  const o2 = ctx.createOscillator(); o2.type = 'triangle'; o2.frequency.value = freq * 2.001;
  const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 320;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(gain, t + 0.015);
  g.gain.setValueAtTime(gain, t + dur - 0.06);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  const g2 = ctx.createGain(); g2.gain.value = 0.25;
  o.connect(g); o2.connect(g2); g2.connect(g); g.connect(f); f.connect(dest);
  o.start(t); o.stop(t + dur + 0.05);
  o2.start(t); o2.stop(t + dur + 0.05);
}

function saws(ctx, dest, t, freq, dur, gain, { voices = 3, detune = 12, cutoff = 2200, attack = 0.02, release = 0.15, type = 'sawtooth' } = {}) {
  const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = cutoff; f.Q.value = 0.8;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(gain, t + attack);
  g.gain.setValueAtTime(gain, Math.max(t + attack, t + dur - release));
  g.gain.linearRampToValueAtTime(0.0001, t + dur);
  f.connect(g); g.connect(dest);
  for (let v = 0; v < voices; v++) {
    const o = ctx.createOscillator(); o.type = type; o.frequency.value = freq;
    o.detune.value = (v - (voices - 1) / 2) * detune;
    const og = ctx.createGain(); og.gain.value = 1 / voices;
    o.connect(og); og.connect(f);
    o.start(t); o.stop(t + dur + 0.05);
  }
}

// Formant "voice" — saw through 3 parallel bandpass filters shaped as vowels
const VOWELS = {
  ah: [[730, 1090, 2440], [1.0, 0.5, 0.18]],
  oh: [[500, 850, 2500],  [1.0, 0.45, 0.12]],
  eh: [[530, 1840, 2480], [1.0, 0.4, 0.22]],
  oo: [[300, 870, 2240],  [1.0, 0.35, 0.1]],
};

function voice(ctx, dest, t, freq, dur, vowelSeq, gain = 0.5, vibHz = 5.2) {
  const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = freq;
  const vib = ctx.createOscillator(); vib.frequency.value = vibHz;
  const vibG = ctx.createGain(); vibG.gain.value = freq * 0.011;
  vib.connect(vibG); vibG.connect(o.frequency);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(gain, t + 0.07);
  g.gain.setValueAtTime(gain, t + dur - 0.12);
  g.gain.linearRampToValueAtTime(0.0001, t + dur);
  const filters = [];
  for (let i = 0; i < 3; i++) {
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 9;
    const fg = ctx.createGain();
    o.connect(f); f.connect(fg); fg.connect(g);
    filters.push({ f, fg });
  }
  g.connect(dest);
  const step = dur / vowelSeq.length;
  vowelSeq.forEach((vw, i) => {
    const [freqs, gains] = VOWELS[vw];
    const tt = t + i * step;
    filters.forEach(({ f, fg }, k) => {
      f.frequency.setTargetAtTime(freqs[k], tt, 0.06);
      fg.gain.setTargetAtTime(gains[k] * 0.5, tt, 0.06);
    });
  });
  o.start(t); vib.start(t);
  o.stop(t + dur + 0.05); vib.stop(t + dur + 0.05);
}

// ------------------------------------------------------------
//  Loop builders — each writes TWO passes of the pattern; the
//  renderer extracts the second pass so tails wrap seamlessly.
// ------------------------------------------------------------

const LOOPS = {
  // BEATS ----------------------------------------------------
  thump(ctx, out, t0, M = PHASE_MUSIC[0]) {
    const fStart = 160 - M.dark * 45;
    for (let b = 0; b < BARS * BEATS_PER_BAR; b++) {
      const heavy = M.dark >= 1 && b % 2 === 1;
      kick(ctx, out, t0 + b * BEAT, heavy ? 0.5 : 0.95, fStart);
      if (b % 4 === 3 && M.dark < 0.7) kick(ctx, out, t0 + b * BEAT + BEAT * 0.5, 0.4, fStart);
    }
  },
  snapp(ctx, out, t0, M = PHASE_MUSIC[0]) {
    const d = M.dark;
    for (let bar = 0; bar < BARS; bar++) {
      const bt = t0 + bar * BAR;
      if (d < 1) {
        clap(ctx, out, bt + BEAT, 0.62 * (1 - d * 0.3));
        clap(ctx, out, bt + BEAT * 3, 0.62 * (1 - d * 0.3));
        snare(ctx, out, bt + BEAT * 3, 0.3);
      } else {
        snare(ctx, out, bt + BEAT * 3, 0.5);   // one lonely hit in the void
      }
      for (let e = 0; e < 8; e++) {
        if (d >= 1 && e % 2 === 1) continue;
        hat(ctx, out, bt + e * BEAT * 0.5, (e % 2 ? 0.16 : 0.24) * (1 - d * 0.45));
      }
      if (d < 0.7) hat(ctx, out, bt + BEAT * 3.5, 0.2, true);
    }
  },
  tika(ctx, out, t0, M = PHASE_MUSIC[0]) {
    const d = M.dark;
    const vel = [0.3, 0.08, 0.16, 0.1, 0.26, 0.08, 0.18, 0.12, 0.3, 0.08, 0.16, 0.22, 0.26, 0.1, 0.2, 0.14];
    for (let bar = 0; bar < BARS; bar++) {
      const bt = t0 + bar * BAR;
      for (let s = 0; s < 16; s++) {
        if (d >= 1 && s % 2 === 1) continue;           // the shuffle stiffens
        const sw = s % 2 === 1 ? BEAT * 0.03 * (1 - d) : 0;
        hat(ctx, out, bt + s * BEAT * 0.25 + sw, vel[s] * (1 - d * 0.5));
      }
      snare(ctx, out, bt + BEAT * 2.75, 0.18 * (1 - d * 0.4));
      if (bar % 2 === 1 && d < 0.7) snare(ctx, out, bt + BEAT * 1.25, 0.14);
    }
  },

  // BASS -----------------------------------------------------
  boom(ctx, out, t0, M = PHASE_MUSIC[0]) {
    // beats-in-bar / length pairs — the void slows to long dooms
    const pat = M.dark >= 1
      ? [[0, 1.6], [2, 1.6]]
      : [[0, 0.7], [0.75, 0.2], [1.5, 0.45], [2.5, 0.45], [3, 0.45], [3.5, 0.45]];
    for (let bar = 0; bar < BARS; bar++) {
      const rm = M.roots[bar];
      const root = midiHz(rm > 40 ? rm - 12 : rm);  // stay in the sub register
      const bt = t0 + bar * BAR;
      for (const [pos, len] of pat) {
        const f = pos === 2.5 ? root * 1.5 : root;  // fifth for movement
        subBass(ctx, out, bt + pos * BEAT, f, len * BEAT, 0.85);
      }
    }
  },
  wobb(ctx, out, t0, M = PHASE_MUSIC[0]) {
    const d = M.dark;
    for (let bar = 0; bar < BARS; bar++) {
      const bt = t0 + bar * BAR;
      const root = midiHz(M.roots[bar]);
      const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = root;
      const o2 = ctx.createOscillator(); o2.type = 'square'; o2.frequency.value = root * 0.5;
      const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.Q.value = 7;
      const lfo = ctx.createOscillator(); lfo.frequency.value = (1 / (BEAT * 0.5)) * (1 - d * 0.5);
      const lfoG = ctx.createGain(); lfoG.gain.value = 520 * (1 - d * 0.3);
      f.frequency.value = 680 * (1 - d * 0.45);
      lfo.connect(lfoG); lfoG.connect(f.frequency);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, bt);
      g.gain.linearRampToValueAtTime(0.34, bt + 0.03);
      g.gain.setValueAtTime(0.34, bt + BAR - 0.1);
      g.gain.linearRampToValueAtTime(0.0001, bt + BAR);
      const g2 = ctx.createGain(); g2.gain.value = 0.5;
      o.connect(f); o2.connect(g2); g2.connect(f); f.connect(g); g.connect(out);
      o.start(bt); o2.start(bt); lfo.start(bt);
      o.stop(bt + BAR + 0.05); o2.stop(bt + BAR + 0.05); lfo.stop(bt + BAR + 0.05);
    }
  },

  // MELODY ---------------------------------------------------
  chime(ctx, out, t0, M = PHASE_MUSIC[0]) {
    const d = M.dark;
    // delay send for sparkle — the echoes grow longer as it darkens
    const dly = ctx.createDelay(1); dly.delayTime.value = BEAT * 0.75;
    const fb = ctx.createGain(); fb.gain.value = 0.34 + d * 0.25;
    const wet = ctx.createGain(); wet.gain.value = 0.3 + d * 0.2;
    dly.connect(fb); fb.connect(dly); dly.connect(wet); wet.connect(out);
    const bus = ctx.createGain(); bus.connect(out); bus.connect(dly);
    const steps = [0, 2, 4, 7, 4, 2, 5, 4]; // indices into chord-anchored scale walk
    for (let bar = 0; bar < BARS; bar++) {
      const chord = M.chords[bar];
      const bt = t0 + bar * BAR;
      for (let s = 0; s < 8; s++) {
        if (d >= 1 && s !== 0 && s !== 4) continue;   // broken music box
        if (s === 3 && bar % 2 === 0) continue;       // breathe
        const base = chord[s % 3] + 12;
        const n = s % 2 === 0 ? base : M.penta[(steps[s] + bar) % M.penta.length] + 12;
        pluck(ctx, bus, bt + s * BEAT * 0.5, midiHz(n), 0.3, d >= 1 ? 0.55 : 0.24, 9 - d * 5);
      }
    }
  },
  nova(ctx, out, t0, M = PHASE_MUSIC[0]) {
    const d = M.dark;
    // 2-bar phrase played twice — the phrase itself is re-composed per phase
    for (let rep = 0; rep < 2; rep++) {
      const rt = t0 + rep * BAR * 2;
      for (const [pos, note, len] of M.lead) {
        saws(ctx, out, rt + pos * BEAT, midiHz(note), len * BEAT, 0.16 * (1 - d * 0.2), {
          voices: 5, detune: 14 + d * 12, cutoff: 3400 * (1 - d * 0.55),
          attack: 0.03 + d * 0.1, release: 0.12 + d * 0.3,
        });
      }
    }
  },
  drift(ctx, out, t0, M = PHASE_MUSIC[0]) {
    const d = M.dark;
    for (let bar = 0; bar < BARS; bar++) {
      const bt = t0 + bar * BAR;
      for (const n of M.chords[bar]) {
        saws(ctx, out, bt, midiHz(n), BAR, 0.075,
          { voices: 3, detune: 9 + d * 8, cutoff: 950 * (1 - d * 0.45), attack: 0.5, release: 0.6 });
        saws(ctx, out, bt, midiHz(n - 12), BAR, 0.05,
          { voices: 2, detune: 6 + d * 5, cutoff: 700 * (1 - d * 0.4), attack: 0.6, release: 0.6 });
      }
    }
  },

  // VOICE / FX -----------------------------------------------
  voxo(ctx, out, t0, M = PHASE_MUSIC[0]) {
    const d = M.dark;
    const vib = 5.2 - d * 2.2;
    for (let bar = 0; bar < BARS; bar++) {
      const bt = t0 + bar * BAR;
      const chord = M.chords[bar];
      const drop = d >= 0.7 ? 12 : 0;   // the choir sinks an octave
      voice(ctx, out, bt, midiHz(chord[0] - drop), BAR * 0.96, M.vowels[bar], 0.34 * (1 - d * 0.2), vib);
      voice(ctx, out, bt + 0.01, midiHz(chord[2] - drop) * 1.003, BAR * 0.96, M.vowels[bar], 0.2 * (1 - d * 0.25), vib);
      if (bar % 2 === 1 && d < 0.7) {
        voice(ctx, out, bt + BAR * 0.5, midiHz(chord[1] + 12), BAR * 0.46, ['ah'], 0.12, vib);
      }
    }
  },
  echo(ctx, out, t0, M = PHASE_MUSIC[0]) {
    const d = M.dark;
    // rising sweep over bars 1-2, falling 3-4 — flatter and lower as it darkens
    const s = ctx.createBufferSource(); s.buffer = ctx._noise; s.loop = true;
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 2.2;
    f.frequency.setValueAtTime(220, t0);
    f.frequency.exponentialRampToValueAtTime(5200 * (1 - d * 0.6), t0 + BAR * 2);
    f.frequency.exponentialRampToValueAtTime(300 * (1 - d * 0.4), t0 + BAR * 4);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(0.13, t0 + BAR * 2);
    g.gain.linearRampToValueAtTime(0.02, t0 + BAR * 4);
    s.connect(f); f.connect(g); g.connect(out);
    s.start(t0); s.stop(t0 + BAR * 4 + 0.02);
    // pingy blips through delay
    const dly = ctx.createDelay(1); dly.delayTime.value = BEAT * 0.75;
    const fb = ctx.createGain(); fb.gain.value = 0.45 + d * 0.2;
    const wet = ctx.createGain(); wet.gain.value = 0.5;
    dly.connect(fb); fb.connect(dly); dly.connect(wet); wet.connect(out);
    for (let bar = 0; bar < BARS; bar++) {
      const o = ctx.createOscillator(); o.type = 'sine';
      o.frequency.value = midiHz(M.echoNotes[bar]);
      const og = ctx.createGain();
      env(og.gain, t0 + bar * BAR + BEAT * 1.5, 0.004, 0.2, 0.3);
      o.connect(og); og.connect(out); og.connect(dly);
      o.start(t0 + bar * BAR + BEAT * 1.5); o.stop(t0 + bar * BAR + BEAT * 1.5 + 0.5);
    }
  },

  // ---- the rest of the Sprunki lineup ----------------------
  funbot(ctx, out, t0, M = PHASE_MUSIC[0]) {
    const d = M.dark;
    // robo blips on a 16th grid + a servo slide at each bar end
    const grid = [1, 0, 0, 1, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1, 0, 1];
    for (let bar = 0; bar < BARS; bar++) {
      const bt = t0 + bar * BAR;
      for (let s = 0; s < 16; s++) {
        if (!grid[s]) continue;
        if (d >= 1 && s % 4 !== 0) continue;
        const o = ctx.createOscillator(); o.type = 'square';
        o.frequency.value = midiHz(M.penta[(s + bar) % M.penta.length] - 12);
        const g = ctx.createGain();
        env(g.gain, bt + s * BEAT * 0.25, 0.002, 0.13 * (1 - d * 0.3), 0.05);
        o.connect(g); g.connect(out);
        o.start(bt + s * BEAT * 0.25); o.stop(bt + s * BEAT * 0.25 + 0.09);
      }
      const o = ctx.createOscillator(); o.type = 'square';
      o.frequency.setValueAtTime(midiHz(M.penta[0]), bt + BEAT * 3.5);
      o.frequency.exponentialRampToValueAtTime(midiHz(M.penta[0]) * (d >= 0.7 ? 0.5 : 2), bt + BEAT * 3.95);
      const g = ctx.createGain();
      env(g.gain, bt + BEAT * 3.5, 0.01, 0.09, 0.4);
      o.connect(g); g.connect(out);
      o.start(bt + BEAT * 3.5); o.stop(bt + BEAT * 4);
    }
  },
  tunner(ctx, out, t0, M = PHASE_MUSIC[0]) {
    const d = M.dark;
    const pat = d >= 1
      ? [[0, 200], [2, 150]]
      : [[0, 220], [0.75, 170], [1.5, 200], [2.25, 150], [3, 200], [3.75, 170]];
    for (let bar = 0; bar < BARS; bar++) {
      const bt = t0 + bar * BAR;
      for (const [pos, f] of pat) kick(ctx, out, bt + pos * BEAT, 0.5, f - d * 30);
    }
  },
  owakcx(ctx, out, t0, M = PHASE_MUSIC[0]) {
    const d = M.dark;
    // scratchy stutters: bandpass noise chirps with pitch bends
    for (let bar = 0; bar < BARS; bar++) {
      const bt = t0 + bar * BAR;
      const hits = d >= 0.7 ? [0.5, 2.5] : [0.5, 1.25, 2.5, 3.25, 3.75];
      hits.forEach((pos, i) => {
        const s = ctx.createBufferSource(); s.buffer = ctx._noise;
        const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 6;
        const tt = bt + pos * BEAT;
        const top = 2400 * (1 - d * 0.5);
        f.frequency.setValueAtTime(i % 2 ? 500 : top, tt);
        f.frequency.exponentialRampToValueAtTime(i % 2 ? top : 420, tt + 0.16);
        const g = ctx.createGain();
        env(g.gain, tt, 0.004, 0.28 * (1 - d * 0.25), 0.15);
        s.connect(f); f.connect(g); g.connect(out);
        s.start(tt, Math.random()); s.stop(tt + 0.25);
      });
    }
  },
  jevin(ctx, out, t0, M = PHASE_MUSIC[0]) {
    const d = M.dark;
    // dark whoosh swells that cut on the downbeat
    for (let bar = 0; bar < BARS; bar++) {
      const bt = t0 + bar * BAR;
      const s = ctx.createBufferSource(); s.buffer = ctx._noise; s.loop = true;
      const f = ctx.createBiquadFilter(); f.type = 'highpass';
      f.frequency.setValueAtTime(4000, bt + BEAT * 2);
      f.frequency.exponentialRampToValueAtTime(700 * (1 - d * 0.5), bt + BEAT * 4);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, bt + BEAT * 2);
      g.gain.linearRampToValueAtTime(0.15, bt + BEAT * 3.9);
      g.gain.linearRampToValueAtTime(0.0001, bt + BEAT * 4);
      s.connect(f); f.connect(g); g.connect(out);
      s.start(bt + BEAT * 2, Math.random()); s.stop(bt + BEAT * 4 + 0.05);
    }
  },
  sun(ctx, out, t0, M = PHASE_MUSIC[0]) {
    const d = M.dark;
    // shimmer: sparse high sparkles + a soft off-beat shaker
    for (let bar = 0; bar < BARS; bar++) {
      const bt = t0 + bar * BAR;
      for (const pos of [0, 1.5, 2.75]) {
        const n = M.penta[(bar * 2 + Math.round(pos)) % M.penta.length] + 24;
        pluck(ctx, out, bt + pos * BEAT, midiHz(n), 0.13 * (1 - d * 0.3), 0.4, 7 - d * 3);
      }
      for (let e = 0; e < 8; e++) hat(ctx, out, bt + e * BEAT * 0.5 + BEAT * 0.25, 0.06 * (1 - d * 0.5));
    }
  },
  simon(ctx, out, t0, M = PHASE_MUSIC[0]) {
    const d = M.dark;
    // kalimba bells, dotted pattern — a broken chime in the void
    const pos = d >= 1 ? [0, 2] : [0, 0.75, 1.5, 2, 3, 3.5];
    for (let bar = 0; bar < BARS; bar++) {
      const bt = t0 + bar * BAR;
      const chord = M.chords[bar];
      pos.forEach((p, i) => {
        const n = chord[i % 3] + 12;
        for (const oct of [0, 12]) {
          const o = ctx.createOscillator(); o.type = 'sine';
          o.frequency.value = midiHz(n + oct);
          const g = ctx.createGain();
          env(g.gain, bt + p * BEAT, 0.003, oct ? 0.05 : 0.15, 0.5);
          o.connect(g); g.connect(out);
          o.start(bt + p * BEAT); o.stop(bt + p * BEAT + 0.6);
        }
      });
    }
  },
  vineria(ctx, out, t0, M = PHASE_MUSIC[0]) {
    const d = M.dark;
    // soprano legato above the chords
    const vib = 5.6 - d * 2.4;
    for (let bar = 0; bar < BARS; bar++) {
      const bt = t0 + bar * BAR;
      const chord = M.chords[bar];
      voice(ctx, out, bt, midiHz(chord[2] + (d >= 0.7 ? 0 : 12)), BAR * 0.94, M.vowels[bar], 0.2 * (1 - d * 0.2), vib);
    }
  },
  gray(ctx, out, t0, M = PHASE_MUSIC[0]) {
    const d = M.dark;
    // low solemn chant, two notes per bar
    for (let bar = 0; bar < BARS; bar++) {
      const bt = t0 + bar * BAR;
      const root = M.roots[bar] + (M.roots[bar] < 40 ? 24 : 12);
      voice(ctx, out, bt, midiHz(root), BAR * 0.48, ['oo'], 0.3 * (1 - d * 0.15), 3.4 - d);
      voice(ctx, out, bt + BAR * 0.5, midiHz(root - (d >= 0.7 ? 1 : 2)), BAR * 0.46, ['oh'], 0.26 * (1 - d * 0.15), 3.4 - d);
    }
  },
  mara(ctx, out, t0, M = PHASE_MUSIC[0]) {
    const d = M.dark;
    // rhythmic vocal chops
    const grid = d >= 0.7 ? [0, 2] : [0, 0.75, 1, 2, 2.75, 3.5];
    for (let bar = 0; bar < BARS; bar++) {
      const bt = t0 + bar * BAR;
      const chord = M.chords[bar];
      grid.forEach((p, i) => {
        voice(ctx, out, bt + p * BEAT, midiHz(chord[i % 3] + 12), 0.22, [i % 2 ? 'eh' : 'ah'], 0.3 * (1 - d * 0.2), 0.1);
      });
    }
  },
  lime(ctx, out, t0, M = PHASE_MUSIC[0]) {
    const d = M.dark;
    // whistle riff
    const steps = d >= 1 ? [[0, 0, 1.6]] : [[0, 0, 0.7], [1, 2, 0.4], [1.5, 4, 0.4], [2.5, 2, 0.7], [3.25, 1, 0.5]];
    for (let bar = 0; bar < BARS; bar++) {
      const bt = t0 + bar * BAR;
      for (const [p, si, len] of steps) {
        const n = M.penta[(si + bar) % M.penta.length] + 24;
        saws(ctx, out, bt + p * BEAT, midiHz(n), len * BEAT, 0.1 * (1 - d * 0.25),
          { voices: 2, detune: 6, cutoff: 6000 * (1 - d * 0.5), attack: 0.05, release: 0.1, type: 'sine' });
      }
    }
  },

  // BONUS — soaring octave lead for SPRUNK MODE (re-composed per phase)
  bonus(ctx, out, t0, M = PHASE_MUSIC[0]) {
    const d = M.dark;
    for (let rep = 0; rep < 2; rep++) {
      const rt = t0 + rep * BAR * 2;
      for (const [pos, note, len] of M.lead) {
        saws(ctx, out, rt + pos * BEAT, midiHz(note + 12), len * BEAT, 0.14 * (1 - d * 0.15),
          { voices: 7, detune: 18 + d * 10, cutoff: 4200 * (1 - d * 0.5), attack: 0.04, release: 0.2 });
        saws(ctx, out, rt + pos * BEAT, midiHz(note), len * BEAT, 0.07,
          { voices: 3, detune: 10 + d * 6, cutoff: 2400 * (1 - d * 0.5), attack: 0.04, release: 0.2 });
      }
    }
  },
};

// ------------------------------------------------------------
//  Engine
// ------------------------------------------------------------

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.buffers = new Map();      // id -> AudioBuffer (classic synth kit)
    this.channels = new Map();     // id -> { source, gain, muted }
    this.epoch = null;             // ctx time of "bar 1 beat 1"
    this.analyser = null;
    this._freq = null;
    this.master = null;
    // active session tempo — classic by default, overridden by custom kits
    this.bpm = BPM;
    this.beatDur = BEAT;
    this.kit = null;               // { id, loops: Map(id -> buffer) }
    this._kitCache = new Map();    // kitId -> { loops, entries }
    // phase system — each phase drags the whole mix darker
    this.phase = 1;
    this.rate = 1;                 // global playback rate (phase-driven)
    this._musicalSources = new Set();
    this._drone = null;
    this._droneBufs = new Map();
    // re-composed classic loops per phase (lazy-rendered)
    this.phaseBuffers = [null, null, null, null];
    this._phaseRenders = [null, null, null, null];
    // the original mod recordings (normal + horror sets)
    this.original = null;
    this._origCache = null;
    this._origLoading = null;
  }

  async init(onProgress = () => {}) {
    this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    await this.ctx.resume();

    // master chain: sum -> [dry + reverb] -> compressor -> analyser -> out
    const ctx = this.ctx;
    this.sum = ctx.createGain();
    this.master = ctx.createGain(); this.master.gain.value = 0.9;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.knee.value = 8;
    comp.ratio.value = 3.5; comp.attack.value = 0.004; comp.release.value = 0.22;
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 1024;
    this.analyser.smoothingTimeConstant = 0.78;
    this._freq = new Uint8Array(this.analyser.frequencyBinCount);

    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this._makeImpulse(2.4, 2.6);
    const wet = ctx.createGain(); wet.gain.value = 0.22;
    this.wetGain = wet;

    // phase lowpass — wide open in phase 1, chokes the mix in darker phases
    this.phaseLP = ctx.createBiquadFilter();
    this.phaseLP.type = 'lowpass';
    this.phaseLP.frequency.value = 18000;
    this.phaseLP.Q.value = 0.4;

    this.sum.connect(this.phaseLP);
    this.phaseLP.connect(this.master);
    this.phaseLP.connect(this.reverb); this.reverb.connect(wet); wet.connect(this.master);
    this.master.connect(comp); comp.connect(this.analyser); this.analyser.connect(ctx.destination);

    // Render every loop offline
    const ids = Object.keys(LOOPS);
    for (let i = 0; i < ids.length; i++) {
      this.buffers.set(ids[i], await this._renderLoop(LOOPS[ids[i]], PHASE_MUSIC[0]));
      onProgress((i + 1) / ids.length, ids[i]);
    }
    this.phaseBuffers[0] = this.buffers;
  }

  _makeImpulse(seconds, decay) {
    const len = Math.ceil(seconds * this.ctx.sampleRate);
    const buf = this.ctx.createBuffer(2, len, this.ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) {
        d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
      }
    }
    return buf;
  }

  async _renderLoop(builder, M = PHASE_MUSIC[0]) {
    // render 2 passes, keep the 2nd → seamless tails
    const total = LOOP_LEN * 2;
    const off = new OfflineAudioContext(2, Math.ceil(total * SR), SR);
    off._noise = makeNoiseBuffer(off, 2);
    const out = off.createGain();
    out.connect(off.destination);
    builder(off, out, 0, M);
    builder(off, out, LOOP_LEN, M);
    const full = await off.startRendering();
    const loopSamples = Math.round(LOOP_LEN * SR);
    const cut = this.ctx.createBuffer(2, loopSamples, SR);
    const srcOffset = loopSamples; // start of pass 2
    for (let ch = 0; ch < 2; ch++) {
      const src = full.getChannelData(ch);
      cut.copyToChannel(src.subarray(srcOffset, srcOffset + loopSamples), ch);
    }
    return cut;
  }

  get now() { return this.ctx.currentTime; }

  /** Continuous musical position (in beats) since the mix started. */
  get beatPos() {
    if (this.epoch === null) return 0;
    return Math.max(0, ((this.now - this.epoch) * this.rate) / this.beatDur);
  }

  _getBuffer(id) {
    if (this.kit?.loops.has(id)) return this.kit.loops.get(id);
    if (this.original) {
      // original recordings: the horror set takes over at phase Ⅲ+
      const map = this.phase >= 3 ? this.original.horror : this.original.normal;
      const b = map.get(id) ?? this.original.normal.get(id);
      if (b) return b;
    }
    // classic ids resolve to the current phase's re-composed variant when available
    return this.phaseBuffers[this.phase - 1]?.get(id) ?? this.buffers.get(id);
  }

  get playing() { return this.channels.size > 0; }

  isActive(id) { return this.channels.has(id); }
  isMuted(id) { return this.channels.get(id)?.muted ?? false; }

  /**
   * Add a character's loop. Incredibox-style entry: the first sound
   * starts instantly and anchors the epoch; everyone after waits for
   * their loop's next cycle boundary and enters FROM THE TOP — never
   * mid-phrase.
   */
  play(id) {
    if (this.channels.has(id)) return;
    const buf = this._getBuffer(id);
    if (!buf) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const dur = buf.duration;
    let startAt;
    if (this.epoch === null || this.channels.size === 0) {
      startAt = now + 0.03;
      this.epoch = startAt;
    } else {
      const M = Math.max(0, (now + 0.05 - this.epoch) * this.rate);   // musical pos (buffer-seconds)
      startAt = this.epoch + (Math.ceil(M / dur) * dur) / this.rate;
    }
    const source = ctx.createBufferSource();
    source.buffer = buf; source.loop = true;
    source.playbackRate.value = this.rate;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);          // baseline so .value never reads the default 1.0
    gain.gain.setValueAtTime(0.0001, startAt);
    gain.gain.linearRampToValueAtTime(1, startAt + 0.04);
    // per-character analyser (post-gain) — drives face/mouth animation
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.35;
    source.connect(gain); gain.connect(analyser); analyser.connect(this.sum);
    source.start(startAt, 0);
    this._musicalSources.add(source);
    source.onended = () => this._musicalSources.delete(source);
    this.channels.set(id, { source, gain, analyser, levelBuf: new Uint8Array(analyser.fftSize), muted: false, startAt });
  }

  /** The SYNC button: restart every active loop from the top, together, now. */
  resync() {
    if (!this.ctx || this.channels.size === 0) return false;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const t = now + 0.08;
    this.epoch = t;
    for (const ch of this.channels.values()) {
      const src = ctx.createBufferSource();
      src.buffer = ch.source.buffer;
      src.loop = true;
      src.playbackRate.value = this.rate;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, now);
      g.gain.linearRampToValueAtTime(ch.muted ? 0.0001 : 1, t + 0.06);
      src.connect(g); g.connect(ch.analyser ?? this.sum);
      src.start(t, 0);
      this._musicalSources.add(src);
      src.onended = () => this._musicalSources.delete(src);
      const og = ch.gain, os = ch.source;
      const v = Math.max(0.0001, og.gain.value);
      og.gain.cancelScheduledValues(now);
      og.gain.setValueAtTime(v, now);
      og.gain.linearRampToValueAtTime(0.0001, t);
      try { os.stop(t + 0.1); } catch { /* already stopped */ }
      os.onended = () => {
        this._musicalSources.delete(os);
        try { og.disconnect(); } catch { /* */ }
      };
      ch.source = src;
      ch.gain = g;
      ch.startAt = t;
    }
    // raw texture loops (ambience, bonus) re-anchor to the new grid too
    for (const raw of this._raws ?? []) {
      const src = ctx.createBufferSource();
      src.buffer = raw.source.buffer;
      src.loop = true;
      src.playbackRate.value = this.rate;
      src.connect(raw.gain);
      src.start(t, 0);
      this._musicalSources.add(src);
      src.onended = () => this._musicalSources.delete(src);
      const os = raw.source;
      try { os.stop(t + 0.1); } catch { /* */ }
      os.onended = () => this._musicalSources.delete(os);
      raw.source = src;
    }
    return true;
  }

  stop(id) {
    const ch = this.channels.get(id);
    if (!ch) return;
    const t = this.ctx.currentTime;
    const v = Math.max(0.0001, ch.gain.gain.value);   // read before cancel — avoids full-volume blips
    ch.gain.gain.cancelScheduledValues(t);
    ch.gain.gain.setValueAtTime(v, t);
    ch.gain.gain.linearRampToValueAtTime(0.0001, t + 0.12);
    ch.source.stop(t + 0.15);
    // fully detach the channel's node chain so it can be GC'd
    const { source, gain, analyser } = ch;
    source.onended = () => {
      this._musicalSources.delete(source);
      try { gain.disconnect(); analyser?.disconnect(); } catch { /* already gone */ }
    };
    this.channels.delete(id);
    if (this.channels.size === 0) this.epoch = null;
  }

  setMuted(id, muted) {
    const ch = this.channels.get(id);
    if (!ch) return;
    ch.muted = muted;
    const t = this.ctx.currentTime;
    const v = Math.max(0.0001, ch.gain.gain.value);
    ch.gain.gain.cancelScheduledValues(t);
    ch.gain.gain.setValueAtTime(v, t);
    ch.gain.gain.linearRampToValueAtTime(muted ? 0.0001 : 1, t + 0.09);
  }

  toggleMute(id) {
    const ch = this.channels.get(id);
    if (!ch) return false;
    this.setMuted(id, !ch.muted);
    return ch.muted;
  }

  stopAll() {
    for (const id of [...this.channels.keys()]) this.stop(id);
  }

  // ----------------------------------------------------------
  //  Raw loop playback — ambience / battles / god-mode music.
  //  Shares the same epoch so everything stays phase-locked,
  //  but lives outside the character channel map.
  // ----------------------------------------------------------

  playLoopRaw(id, gain = 0.5) {
    const buf = this._getBuffer(id);
    if (!buf) return null;
    const ctx = this.ctx;
    const t = ctx.currentTime + 0.03;
    if (this.epoch === null) this.epoch = t;
    const dur = buf.duration;
    const offset = (((t - this.epoch) * this.rate) % dur + dur) % dur;
    const source = ctx.createBufferSource();
    source.buffer = buf; source.loop = true;
    source.playbackRate.value = this.rate;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.4);
    source.connect(g); g.connect(this.sum);
    source.start(t, offset);
    this._musicalSources.add(source);
    source.onended = () => this._musicalSources.delete(source);
    const raw = { source, gain: g };
    (this._raws ??= new Set()).add(raw);
    let alive = true;
    return {
      setGain: (v, ramp = 0.15) => {
        if (!alive) return;
        const n = ctx.currentTime;
        const cur = Math.max(0.0001, g.gain.value);
        g.gain.cancelScheduledValues(n);
        g.gain.setValueAtTime(cur, n);
        g.gain.linearRampToValueAtTime(Math.max(0.0001, v), n + ramp);
      },
      stop: (fade = 0.4) => {
        if (!alive) return;
        alive = false;
        this._raws.delete(raw);
        const n = ctx.currentTime;
        const cur = Math.max(0.0001, g.gain.value);
        g.gain.cancelScheduledValues(n);
        g.gain.setValueAtTime(cur, n);
        g.gain.linearRampToValueAtTime(0.0001, n + fade);
        const os = raw.source;
        os.stop(n + fade + 0.05);
        os.onended = () => {
          this._musicalSources.delete(os);
          try { g.disconnect(); } catch { /* */ }
        };
      },
    };
  }

  // ----------------------------------------------------------
  //  Phases — each one drags the whole mix darker: global
  //  pitch/tempo drop, closing lowpass, swelling reverb and an
  //  atmosphere drone underneath. All live loops stay in sync
  //  because the epoch is rebased for the new rate.
  // ----------------------------------------------------------

  setPhase(p) {
    p = Math.max(1, Math.min(4, p));
    if (!this.ctx || p === this.phase) return;
    const RATES = [1, 0.97, 0.92, 0.85];
    const CUTS = [18000, 7500, 3200, 1300];
    const WETS = [0.22, 0.28, 0.38, 0.5];
    const newRate = RATES[p - 1];
    const now = this.ctx.currentTime;
    const t = now + 0.06;
    const oldEpoch = this.epoch, oldRate = this.rate;
    // keep musical position continuous: (t-epochOld)*rateOld == (t-epochNew)*rateNew
    if (this.epoch !== null) {
      this.epoch = t - ((t - this.epoch) * this.rate) / newRate;
    }
    // pending quantized entries get rescheduled below — skip their ramp
    const pendingSrcs = new Set(
      [...this.channels.values()].filter((c) => c.startAt && c.startAt > t).map((c) => c.source));
    for (const src of this._musicalSources) {
      if (pendingSrcs.has(src)) continue;
      src.playbackRate.cancelScheduledValues(now);
      src.playbackRate.setValueAtTime(src.playbackRate.value, now);
      src.playbackRate.linearRampToValueAtTime(newRate, t);
    }
    this.rate = newRate;
    this.phase = p;
    // reschedule pending entries onto the NEW grid so they don't land off-beat
    if (oldEpoch !== null) {
      for (const ch of this.channels.values()) {
        if (!ch.startAt || ch.startAt <= t) continue;
        const buf = ch.source.buffer;
        const M = (ch.startAt - oldEpoch) * oldRate;      // intended musical position
        let newStart = this.epoch + M / newRate;
        const cycle = buf.duration / newRate;
        while (newStart < now + 0.05) newStart += cycle;
        try { ch.source.stop(); } catch { /* not started yet */ }
        this._musicalSources.delete(ch.source);
        const src = this.ctx.createBufferSource();
        src.buffer = buf; src.loop = true;
        src.playbackRate.value = newRate;
        src.connect(ch.gain);
        src.start(newStart, 0);
        this._musicalSources.add(src);
        src.onended = () => this._musicalSources.delete(src);
        ch.gain.gain.cancelScheduledValues(now);
        ch.gain.gain.setValueAtTime(0.0001, now);
        ch.gain.gain.setValueAtTime(0.0001, newStart);
        ch.gain.gain.linearRampToValueAtTime(ch.muted ? 0.0001 : 1, newStart + 0.04);
        ch.source = src;
        ch.startAt = newStart;
      }
    }
    this.phaseLP.frequency.setTargetAtTime(CUTS[p - 1], now, 0.35);
    this.wetGain.gain.setTargetAtTime(WETS[p - 1], now, 0.35);
    this._setDrone(p);
    if (this.original) {
      // authentic mode: swap to the mod's own horror recordings (and back)
      const merged = new Map(this.original.normal);
      if (p >= 3) for (const [k, v] of this.original.horror) merged.set(k, v);
      this._swapClassicChannels(merged);
    } else if (!this.kit) {
      // synth mode: swap to the phase's re-composed variants — but only if the
      // synth session is STILL active when the (slow) render resolves
      this._ensurePhaseBuffers(p).then((set) => {
        if (this.phase === p && set && !this.original && !this.kit) {
          this._swapClassicChannels(set);
        }
      });
    }
  }

  // ----------------------------------------------------------
  //  The original mod recordings — straight out of the .sb3.
  //  Loops get a tiny tempo-stretch onto the 100 BPM grid, or a
  //  silence-pad up to the next whole bar (like the mod itself).
  // ----------------------------------------------------------

  async _ensureOriginal(onProgress = () => {}) {
    if (this._origCache) return this._origCache;
    if (!this._origLoading) {
      this._origLoading = (async () => {
        const resp = await fetch('assets/sprunki/sounds/sounds.json');
        if (!resp.ok) throw new Error('sounds.json missing');
        const man = await resp.json();
        const bpm = man.bpm ?? 100;
        const normal = new Map(), horror = new Map();
        const ids = Object.keys(man.sounds);
        for (let i = 0; i < ids.length; i++) {
          const id = ids[i], e = man.sounds[id];
          try {
            if (e.normal) normal.set(id, await this._conformPad(await this._decode(e.normal), bpm));
            if (e.horror) horror.set(id, await this._conformPad(await this._decode(e.horror), bpm));
          } catch (err) {
            console.warn('original sound failed:', id, err);
          }
          onProgress((i + 1) / ids.length, id);
        }
        this._origCache = { normal, horror, bpm };
        return this._origCache;
      })();
    }
    return this._origLoading;
  }

  /** Switch the classic cast onto the original mod recordings. */
  async setOriginalKit(onProgress = () => {}) {
    let cache = null;
    try { cache = await this._ensureOriginal(onProgress); } catch (e) { console.warn(e); }
    if (!cache || !cache.normal.size) return false;
    this.stopAll();
    this.epoch = null;
    this.kit = null;
    this.original = cache;
    this.bpm = cache.bpm;
    this.beatDur = 60 / cache.bpm;
    return true;
  }

  async _decode(url) {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await this.ctx.decodeAudioData(await r.arrayBuffer());
  }

  async _conformPad(raw, bpm) {
    const barLen = (60 / bpm) * 4;
    const ch0 = raw.getChannelData(0);
    let s = 0;
    const win = Math.min(ch0.length, Math.floor(raw.sampleRate * 0.2));
    while (s < win && Math.abs(ch0[s]) < 0.01) s++;
    const startT = s / raw.sampleRate;
    const D = raw.duration - startT;
    const bars = D / barLen;
    const near = Math.max(1, Math.round(bars));
    const rate = D / (near * barLen);
    let N, useRate;
    if (rate >= 0.93 && rate <= 1.09) { N = near; useRate = rate; }       // gentle stretch
    else { N = Math.max(1, Math.ceil(bars - 0.02)); useRate = 1; }        // musical rest at the end
    const SRO = 44100;
    const off = new OfflineAudioContext(Math.min(2, raw.numberOfChannels), Math.round(N * barLen * SRO), SRO);
    const src = off.createBufferSource();
    src.buffer = raw;
    src.playbackRate.value = useRate;
    src.connect(off.destination);
    src.start(0, startT);
    return await off.startRendering();
  }

  /** Lazily render the re-composed classic loops for a phase. */
  _ensurePhaseBuffers(p) {
    if (this.phaseBuffers[p - 1]) return Promise.resolve(this.phaseBuffers[p - 1]);
    if (this._phaseRenders[p - 1]) return this._phaseRenders[p - 1];
    const M = PHASE_MUSIC[p - 1];
    this._phaseRenders[p - 1] = (async () => {
      const set = new Map();
      for (const id of Object.keys(LOOPS)) {
        set.set(id, await this._renderLoop(LOOPS[id], M));
      }
      this.phaseBuffers[p - 1] = set;
      this._phaseRenders[p - 1] = null;
      return set;
    })();
    return this._phaseRenders[p - 1];
  }

  /** Crossfade every playing classic channel onto a new buffer set, keeping sync & mute state. */
  _swapClassicChannels(set) {
    const ctx = this.ctx;
    for (const [id, ch] of this.channels) {
      const buf = set.get(id);
      if (!buf) continue;                       // kit loops etc. keep playing untouched
      if (ch.source.buffer === buf) continue;   // already on this variant
      const t = ctx.currentTime + 0.03;
      const dur = buf.duration;
      const src = ctx.createBufferSource();
      src.buffer = buf; src.loop = true;
      src.playbackRate.value = this.rate;
      const g = ctx.createGain();
      const pending = ch.startAt && ch.startAt > t;   // hasn't entered yet — keep its clean entry
      if (pending) {
        g.gain.setValueAtTime(0.0001, ch.startAt);
        g.gain.linearRampToValueAtTime(ch.muted ? 0.0001 : 1, ch.startAt + 0.04);
        src.connect(g); g.connect(ch.analyser ?? this.sum);
        src.start(ch.startAt, 0);
      } else {
        const offset = (((t - this.epoch) * this.rate) % dur + dur) % dur;
        g.gain.setValueAtTime(0.0001, t);
        g.gain.linearRampToValueAtTime(ch.muted ? 0.0001 : 1, t + 0.2);
        src.connect(g); g.connect(ch.analyser ?? this.sum);
        src.start(t, offset);
      }
      this._musicalSources.add(src);
      src.onended = () => this._musicalSources.delete(src);
      // fade the old voice out and detach its gain
      const oldGain = ch.gain, oldSrc = ch.source;
      const v = Math.max(0.0001, oldGain.gain.value);
      oldGain.gain.cancelScheduledValues(t);
      oldGain.gain.setValueAtTime(v, t);
      oldGain.gain.linearRampToValueAtTime(0.0001, t + 0.2);
      oldSrc.stop(t + 0.3);
      oldSrc.onended = () => {
        this._musicalSources.delete(oldSrc);
        try { oldGain.disconnect(); } catch { /* */ }
      };
      ch.source = src;
      ch.gain = g;
    }
  }

  _setDrone(p) {
    if (this._drone) { this._drone.stop(); this._drone = null; }
    this._droneToken = (this._droneToken ?? 0) + 1;
    const token = this._droneToken;
    if (p <= 1) return;
    const levels = [0, 0.05, 0.085, 0.11];
    (async () => {
      let buf = this._droneBufs.get(p);
      if (!buf) {
        buf = await this._makeDrone(p);
        this._droneBufs.set(p, buf);
      }
      if (this.phase !== p || token !== this._droneToken) return;   // superseded while rendering
      const ctx = this.ctx;
      const source = ctx.createBufferSource();
      source.buffer = buf; source.loop = true;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, ctx.currentTime);
      g.gain.linearRampToValueAtTime(levels[p - 1], ctx.currentTime + 1.2);
      source.connect(g); g.connect(this.sum);
      source.start();
      this._drone = {
        stop: () => {
          const n = ctx.currentTime;
          g.gain.cancelScheduledValues(n);
          g.gain.setValueAtTime(Math.max(0.0001, g.gain.value), n);
          g.gain.linearRampToValueAtTime(0.0001, n + 0.6);
          source.stop(n + 0.7);
          source.onended = () => { try { g.disconnect(); } catch { /* */ } };
        },
      };
    })();
  }

  async _makeDrone(p) {
    const SRO = 44100, DUR = 8;
    const off = new OfflineAudioContext(2, DUR * SRO, SRO);
    off._noise = makeNoiseBuffer(off, 2);
    const out = off.createGain(); out.gain.value = 1; out.connect(off.destination);
    if (p === 2) {
      // cold wind
      const s = off.createBufferSource(); s.buffer = off._noise; s.loop = true;
      const f = off.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 380; f.Q.value = 0.8;
      const g = off.createGain(); g.gain.value = 0.6;
      const lfo = off.createOscillator(); lfo.frequency.value = 0.21;
      const lfoG = off.createGain(); lfoG.gain.value = 0.28;
      lfo.connect(lfoG); lfoG.connect(g.gain);
      s.connect(f); f.connect(g); g.connect(out);
      s.start(0); lfo.start(0);
    } else if (p === 3) {
      // beating low drone
      for (const [fq, gv] of [[55, 0.3], [55.8, 0.3], [82.41, 0.16]]) {
        const o = off.createOscillator(); o.type = 'sawtooth'; o.frequency.value = fq;
        const f = off.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 240;
        const g = off.createGain(); g.gain.value = gv;
        o.connect(f); f.connect(g); g.connect(out);
        o.start(0);
      }
      const s = off.createBufferSource(); s.buffer = off._noise; s.loop = true;
      const f = off.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 110;
      const g = off.createGain(); g.gain.value = 0.5;
      s.connect(f); f.connect(g); g.connect(out);
      s.start(0);
    } else {
      // the void: sub drone + whispers + a slow heartbeat
      const o = off.createOscillator(); o.type = 'sawtooth'; o.frequency.value = 41.2;
      const of2 = off.createBiquadFilter(); of2.type = 'lowpass'; of2.frequency.value = 160;
      const og = off.createGain(); og.gain.value = 0.4;
      o.connect(of2); of2.connect(og); og.connect(out);
      o.start(0);
      const s = off.createBufferSource(); s.buffer = off._noise; s.loop = true;
      const bp = off.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 7; bp.frequency.value = 1200;
      const lfo = off.createOscillator(); lfo.frequency.value = 0.17;
      const lfoG = off.createGain(); lfoG.gain.value = 700;
      lfo.connect(lfoG); lfoG.connect(bp.frequency);
      const wg = off.createGain(); wg.gain.value = 0.16;
      s.connect(bp); bp.connect(wg); wg.connect(out);
      s.start(0); lfo.start(0);
      for (let i = 0; i < DUR; i++) {            // heartbeat every second → loops cleanly
        for (const dt of [0, 0.18]) {
          const hb = off.createOscillator(); hb.type = 'sine'; hb.frequency.value = 48;
          const hg = off.createGain();
          env(hg.gain, i + dt, 0.005, dt === 0 ? 0.5 : 0.3, 0.14);
          hb.connect(hg); hg.connect(out);
          hb.start(i + dt); hb.stop(i + dt + 0.25);
        }
      }
    }
    return await off.startRendering();
  }

  // ----------------------------------------------------------
  //  Custom loop kits — user audio files conformed to the grid.
  //  Each file is silence-trimmed, snapped to the nearest whole
  //  number of bars at the kit BPM (micro tempo-stretch), and
  //  resampled offline into a perfectly loopable buffer.
  // ----------------------------------------------------------

  /**
   * Activate a kit (or null → back to the classic synth kit).
   * @returns entries [{ id, name, cat }] that survived conforming.
   */
  async setKit(def, onProgress = () => {}) {
    this.stopAll();
    this.epoch = null;
    this.original = null;
    if (!def) {
      this.kit = null;
      this.bpm = BPM;
      this.beatDur = BEAT;
      return [];
    }
    let cached = this._kitCache.get(def.id);
    if (!cached) {
      const loops = new Map();
      const entries = [];
      for (let i = 0; i < def.loops.length; i++) {
        const L = def.loops[i];
        const id = `kit:${def.id}:${i}`;
        try {
          const resp = await fetch(L.file);
          if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
          const raw = await this.ctx.decodeAudioData(await resp.arrayBuffer());
          const buf = await this._conform(raw, def.bpm, L.cat);
          if (buf) {
            loops.set(id, buf);
            entries.push({ id, name: L.name, cat: L.cat });
          } else {
            console.warn(`kit loop skipped (no bar fit): ${L.file}`);
          }
        } catch (e) {
          console.warn(`kit loop failed: ${L.file}`, e);
        }
        onProgress((i + 1) / def.loops.length, L.name);
      }
      cached = { loops, entries };
      this._kitCache.set(def.id, cached);
    }
    this.kit = { id: def.id, loops: cached.loops };
    this.bpm = def.bpm;
    this.beatDur = 60 / def.bpm;
    return cached.entries;
  }

  async _conform(raw, bpm, cat = 'beat') {
    const barLen = (60 / bpm) * 4;
    // skip leading silence (mp3 encoder padding etc.)
    const ch0 = raw.getChannelData(0);
    let s = 0;
    const win = Math.min(ch0.length, Math.floor(raw.sampleRate * 0.25));
    while (s < win && Math.abs(ch0[s]) < 0.02) s++;
    const startT = s / raw.sampleRate;
    const D = raw.duration - startT;
    if (D < 0.4) return null;
    // find the whole-bar interpretation needing the least tempo-stretch
    const relaxed = cat === 'voice' || cat === 'fx';
    const lo = relaxed ? 0.75 : 0.9;
    const hi = relaxed ? 1.3 : 1.12;
    let best = null;
    for (let N = 1; N <= 16; N++) {
      const rate = D / (N * barLen);
      if (rate >= lo && rate <= hi) {
        const dev = Math.abs(1 - rate);
        if (!best || dev < best.dev) best = { N, rate, dev };
      }
    }
    if (!best) return null;
    const SRO = 44100;
    const off = new OfflineAudioContext(
      Math.min(2, raw.numberOfChannels), Math.round(best.N * barLen * SRO), SRO);
    const src = off.createBufferSource();
    src.buffer = raw;
    src.playbackRate.value = best.rate;
    src.loop = true;
    src.loopStart = startT;
    src.loopEnd = raw.duration;
    src.connect(off.destination);
    src.start(0, startT);
    return await off.startRendering();
  }

  // ----------------------------------------------------------
  //  One-shot sound effects (realtime synthesis)
  // ----------------------------------------------------------

  sfx(name, { gain = 1 } = {}) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime + 0.01;
    const out = this.sum;
    if (!this._noiseRT) this._noiseRT = makeNoiseBuffer(ctx, 2);
    const noise = (dur, filterType, freq, q, peak, decay, freqEnd) => {
      const s = ctx.createBufferSource(); s.buffer = this._noiseRT; s.loop = true;
      const f = ctx.createBiquadFilter(); f.type = filterType; f.frequency.setValueAtTime(freq, t); f.Q.value = q;
      if (freqEnd) f.frequency.exponentialRampToValueAtTime(freqEnd, t + dur);
      const g = ctx.createGain();
      env(g.gain, t, 0.004, peak * gain, decay);
      s.connect(f); f.connect(g); g.connect(out);
      s.start(t, Math.random()); s.stop(t + dur + 0.1);
      s.onended = () => { try { g.disconnect(); f.disconnect(); } catch { /* */ } };
    };
    const tone = (type, f0, f1, dur, peak, delay = 0) => {
      const o = ctx.createOscillator(); o.type = type;
      o.frequency.setValueAtTime(f0, t + delay);
      if (f1 && f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + delay + dur);
      const g = ctx.createGain();
      env(g.gain, t + delay, 0.005, peak * gain, dur);
      o.connect(g); g.connect(out);
      o.start(t + delay); o.stop(t + delay + dur + 0.1);
      o.onended = () => { try { g.disconnect(); } catch { /* */ } };
    };

    switch (name) {
      case 'zap':       // lightning strike
        noise(0.4, 'highpass', 2000, 1, 0.7, 0.3);
        tone('sawtooth', 3200, 90, 0.35, 0.5);
        noise(1.6, 'lowpass', 300, 1, 0.6, 1.4, 60);
        break;
      case 'meteor':    // whistle + slam
        tone('sine', 1800, 220, 1.1, 0.25);
        noise(1.1, 'bandpass', 2600, 2, 0.2, 1.0, 500);
        break;
      case 'boomhit':   // explosion
        tone('sine', 160, 32, 0.8, 0.9);
        noise(1.8, 'lowpass', 900, 0.8, 0.8, 1.6, 80);
        break;
      case 'plague':
        tone('sawtooth', 110, 55, 2.2, 0.22);
        tone('sawtooth', 116.3, 58, 2.2, 0.22);   // beating dissonance
        noise(2.2, 'bandpass', 400, 4, 0.15, 2.0, 150);
        break;
      case 'bless': {   // rising sparkle arpeggio
        const notes = [880, 1108.7, 1318.5, 1760, 2217.5];
        notes.forEach((f, i) => tone('sine', f, f, 0.5, 0.22, i * 0.07));
        noise(0.9, 'highpass', 6000, 1, 0.12, 0.8);
        break;
      }
      case 'pickup':
        tone('square', 660, 1320, 0.12, 0.18);
        tone('square', 990, 1980, 0.12, 0.12, 0.07);
        break;
      case 'talk':
        tone('triangle', 340, 420, 0.06, 0.16);
        break;
      case 'win': {
        const seq = [523.25, 659.25, 783.99, 1046.5];
        seq.forEach((f, i) => tone('triangle', f, f, 0.3, 0.28, i * 0.12));
        break;
      }
      case 'lose':
        tone('sawtooth', 300, 150, 0.7, 0.2);
        tone('sawtooth', 302, 148, 0.7, 0.2, 0.02);
        break;
      case 'pop':       // spawn
        tone('sine', 300, 720, 0.14, 0.3);
        break;
      case 'bubble':
        tone('sine', 300 + Math.random() * 500, 900 + Math.random() * 600, 0.15, 0.08);
        break;
      case 'click':
        tone('triangle', 900, 700, 0.05, 0.12);
        break;
      case 'thunder':
        noise(2.6, 'lowpass', 260, 1, 0.5, 2.4, 50);
        break;
      case 'phasedown':  // descent into a darker phase
        tone('sawtooth', 340, 46, 1.1, 0.28);
        tone('sawtooth', 344, 48, 1.1, 0.28, 0.02);
        noise(1.8, 'lowpass', 700, 1, 0.4, 1.6, 70);
        break;
      case 'phaseup': {  // climbing back toward the light
        [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => tone('triangle', f, f, 0.35, 0.2, i * 0.06));
        noise(0.8, 'highpass', 5200, 1, 0.1, 0.7);
        break;
      }
    }
  }

  /** Spectrum energy for visuals: { bass, mid, high, level } in 0..1 */
  getEnergy() {
    if (!this.analyser) return { bass: 0, mid: 0, high: 0, level: 0 };
    this.analyser.getByteFrequencyData(this._freq);
    const f = this._freq;
    const avg = (a, b) => {
      let s = 0;
      for (let i = a; i < b; i++) s += f[i];
      return s / ((b - a) * 255);
    };
    const bass = avg(1, 9);       // ~43–390 Hz
    const mid = avg(10, 48);      // ~430–2070 Hz
    const high = avg(60, 220);    // ~2.6–9.5 kHz
    return { bass, mid, high, level: bass * 0.5 + mid * 0.35 + high * 0.15 };
  }

  /** Raw spectrum bins (Uint8Array) — for the EQ wall. */
  getSpectrum() {
    if (!this.analyser) return null;
    this.analyser.getByteFrequencyData(this._freq);
    return this._freq;
  }

  /** Instantaneous level (0..1) of one character's own loop — for face sync. */
  getChannelLevel(id) {
    const ch = this.channels.get(id);
    if (!ch?.analyser) return 0;
    ch.analyser.getByteTimeDomainData(ch.levelBuf);
    let peak = 0;
    for (let i = 0; i < ch.levelBuf.length; i += 2) {
      const v = Math.abs(ch.levelBuf[i] - 128);
      if (v > peak) peak = v;
    }
    return Math.min(1, peak / 48);   // generous norm so quiet sustained voices still sing
  }
}
