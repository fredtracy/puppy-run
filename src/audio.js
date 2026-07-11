let audioCtx = null;
let musicGain = null;
let musicPlaying = false;
let musicTimer = null;

// Browsers block audio until a user gesture, so this is called from the
// first keydown/pointerdown rather than at module load.
export function initAudio() {
  if (audioCtx) return;
  audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  musicGain = audioCtx.createGain();
  musicGain.gain.value = 0.1;
  musicGain.connect(audioCtx.destination);
  loadMooBuffer();
  loadBarkBuffer();
  loadCallDarlaBuffer();
}

// Real recorded animal sounds (see ATTRIBUTIONS.md), converted to WAV for
// universal browser support — Safari doesn't play Ogg Vorbis.
function loadSampleBuffer(state, filename) {
  if (state.buffer) return Promise.resolve(state.buffer);
  if (state.promise) return state.promise;
  state.promise = fetch(`${import.meta.env.BASE_URL}audio/${filename}`)
    .then((res) => res.arrayBuffer())
    .then((data) => audioCtx.decodeAudioData(data))
    .then((buffer) => {
      state.buffer = buffer;
      return buffer;
    });
  return state.promise;
}

const mooState = { buffer: null, promise: null };
const loadMooBuffer = () => loadSampleBuffer(mooState, 'moo.wav');

const barkState = { buffer: null, promise: null };
const loadBarkBuffer = () => loadSampleBuffer(barkState, 'bark.wav');

// Miranda's own voice calling Darla — a real recorded clip like the bark/
// moo samples, not synthesized, since a called name needs to actually
// sound like her.
const callDarlaState = { buffer: null, promise: null };
const loadCallDarlaBuffer = () => loadSampleBuffer(callDarlaState, 'call-darla.wav');

function tone(freq, startTime, duration, type, gainValue, destination) {
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0.0001, startTime);
  gain.gain.linearRampToValueAtTime(gainValue, startTime + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.001, startTime + duration);
  osc.connect(gain);
  gain.connect(destination || audioCtx.destination);
  osc.start(startTime);
  osc.stop(startTime + duration + 0.02);
}

// Sustained "strings" underneath a melody — a few sine oscillators per
// chord tone, each slightly detuned from the others (a cheap chorus trick
// that reads as a section of strings rather than one flat tone), with a
// slow swell in and out instead of tone()'s quick pluck envelope.
function stringPad(freqs, startTime, duration, peakGain, destination) {
  freqs.forEach((freq) => {
    [-4, 0, 4].forEach((detuneCents) => {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      osc.detune.value = detuneCents;
      gain.gain.setValueAtTime(0.0001, startTime);
      gain.gain.linearRampToValueAtTime(peakGain, startTime + duration * 0.35);
      gain.gain.setValueAtTime(peakGain, startTime + duration * 0.75);
      gain.gain.linearRampToValueAtTime(0.0001, startTime + duration);
      osc.connect(gain);
      gain.connect(destination || audioCtx.destination);
      osc.start(startTime);
      osc.stop(startTime + duration + 0.05);
    });
  });
}

export function playJumpSound() {
  if (!audioCtx) return;
  const t = audioCtx.currentTime;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = 'triangle';
  osc.frequency.setValueAtTime(320, t);
  osc.frequency.exponentialRampToValueAtTime(900, t + 0.15);
  gain.gain.setValueAtTime(0.25, t);
  gain.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
  osc.connect(gain);
  gain.connect(audioCtx.destination);
  osc.start(t);
  osc.stop(t + 0.2);
}

// A quick, sharp double-snap — a "chomp" rather than a tone, so it reads
// distinctly from the other short SFX (jump's rising sweep, poop's falling
// sine, the bark/moo samples).
export function playBiteSound() {
  if (!audioCtx) return;
  const t = audioCtx.currentTime;
  [0, 0.07].forEach((delay, i) => {
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(i === 0 ? 180 : 140, t + delay);
    osc.frequency.exponentialRampToValueAtTime(50, t + delay + 0.06);
    gain.gain.setValueAtTime(0.2, t + delay);
    gain.gain.exponentialRampToValueAtTime(0.001, t + delay + 0.07);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start(t + delay);
    osc.stop(t + delay + 0.09);
  });
}

export function playPoopSound(pitchScale = 1) {
  if (!audioCtx) return;
  const t = audioCtx.currentTime;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(220 * pitchScale, t);
  osc.frequency.exponentialRampToValueAtTime(75 * pitchScale, t + 0.16);
  gain.gain.setValueAtTime(0.22, t);
  gain.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
  osc.connect(gain);
  gain.connect(audioCtx.destination);
  osc.start(t);
  osc.stop(t + 0.22);
}

export function playMooSound() {
  if (!audioCtx) return;
  loadMooBuffer().then((buffer) => {
    const source = audioCtx.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = 2;
    const gain = audioCtx.createGain();
    gain.gain.value = 0.39;
    source.connect(gain);
    gain.connect(audioCtx.destination);
    source.start();
  });
}

export function playBarkSound() {
  if (!audioCtx) return;
  loadBarkBuffer().then((buffer) => {
    const source = audioCtx.createBufferSource();
    source.buffer = buffer;
    const gain = audioCtx.createGain();
    gain.gain.value = 0.6;
    source.connect(gain);
    gain.connect(audioCtx.destination);
    source.start();
  });
}

export function playCallDarlaSound() {
  if (!audioCtx) return;
  loadCallDarlaBuffer().then((buffer) => {
    const source = audioCtx.createBufferSource();
    source.buffer = buffer;
    const gain = audioCtx.createGain();
    gain.gain.value = 0.7;
    source.connect(gain);
    gain.connect(audioCtx.destination);
    source.start();
  });
}

// A short, silly, plucking melody for daytime — this is just the intro of
// a longer piece now (see DAY_VARIANT_LIGHT/FULL below), so it stays
// exactly as it was rather than getting reworked into something bigger.
const DAY_MELODY = [
  [523.25, 0.5], [587.33, 0.5], [659.25, 0.5], [523.25, 0.5],
  [659.25, 0.5], [698.46, 0.5], [783.99, 1],
  [659.25, 0.5], [587.33, 0.5], [523.25, 0.5], [493.88, 0.5],
  [523.25, 1.5],
];
const DAY_BEAT_SECONDS = 0.28;

// After the intro repeats a few times, a "light strings" variant takes the
// same melodic shape (steps up through the scale, back down, a held high
// note) up a fourth with a bit more reach, backed by a soft string pad.
// Slower/more spacious than the intro's beat, since this section is meant
// to breathe rather than bounce.
const DAY_VARIANT_BEAT_SECONDS = 0.3;
const DAY_VARIANT_LIGHT = [
  [392.0, 0.5], [523.25, 0.5], [659.25, 0.5], [783.99, 0.5],
  [698.46, 0.5], [659.25, 0.5], [587.33, 0.5], [523.25, 0.5],
  [440.0, 0.5], [523.25, 0.5], [659.25, 0.5], [880.0, 1],
  [783.99, 0.5], [698.46, 0.5], [659.25, 0.5], [587.33, 1.5],
];
// Each chord's own root/third/fifth, plus the beat it starts on — I major
// under the first half of the phrase, V under the second, a simple lift
// rather than anything harmonically busy.
const DAY_VARIANT_LIGHT_CHORDS = [
  { freqs: [261.63, 329.63, 392.0], atBeat: 0 },
  { freqs: [392.0, 493.88, 587.33], atBeat: 4.75 },
];

// Then a fuller, more rapturous continuation — the same climbing idea
// pushed up another octave-ish, reaching higher and resolving on a long
// held top note, with a bigger string pad underneath.
const DAY_VARIANT_FULL = [
  [659.25, 0.5], [783.99, 0.5], [1046.5, 0.5], [783.99, 0.5],
  [880.0, 0.5], [783.99, 0.5], [698.46, 0.5], [659.25, 0.5],
  [587.33, 0.5], [698.46, 0.5], [880.0, 0.5], [1046.5, 1],
  [987.77, 0.5], [880.0, 0.5], [783.99, 0.5], [659.25, 1.5],
  [1046.5, 2],
];
const DAY_VARIANT_FULL_CHORDS = [
  { freqs: [349.23, 440.0, 523.25], atBeat: 0 },
  { freqs: [261.63, 329.63, 392.0], atBeat: 5.75 },
];

// How many times each of the three sections repeats before moving to the
// next — tuned so intro + light + full add up to roughly 30 seconds
// before the whole thing loops back to the intro.
const DAY_PHASE_REPEATS = [3, 4, 4];
let dayPhase = 0; // 0 = intro, 1 = light strings, 2 = full strings

// Night's own three-section structure, mirroring the day's: an arpeggiated
// intro, then a light-strings variant, then a fuller one — sine tones
// throughout instead of the day's triangle pluck, for a softer, more
// floating timbre. Built entirely from A minor and E major triads (i and V
// of A harmonic minor — the raised G# in E major is what gives it that
// moody/spooky pull rather than sitting flat in natural minor) arpeggiated
// up and down rather than held long tones, so it still feels like it's
// moving/upbeat despite the minor key.
const NIGHT_BEAT_SECONDS = 0.32;
const NIGHT_MELODY = [
  [220.0, 0.5], [261.63, 0.5], [329.63, 0.5], [440.0, 0.5], // A minor up (A3 C4 E4 A4)
  [329.63, 0.5], [415.3, 0.5], [493.88, 0.5], [659.25, 0.5], // E major up (E4 G#4 B4 E5)
  [440.0, 0.5], [329.63, 0.5], [261.63, 0.5], [220.0, 0.5], // A minor down
  [659.25, 0.5], [493.88, 0.5], [415.3, 0.5], [329.63, 0.5], // E major down
];
// A2 — the root under just the intro, since the light/full sections below
// get their own proper chord pads instead.
const NIGHT_DRONE_FREQ = 110;

const NIGHT_VARIANT_BEAT_SECONDS = 0.3;
const NIGHT_VARIANT_LIGHT = [
  [220.0, 0.5], [329.63, 0.5], [440.0, 0.5], [523.25, 0.5],
  [329.63, 0.5], [415.3, 0.5], [659.25, 0.5], [493.88, 0.5],
  [440.0, 0.5], [523.25, 0.5], [659.25, 0.5], [440.0, 1],
  [415.3, 0.5], [493.88, 0.5], [659.25, 0.5], [329.63, 1.5],
];
const NIGHT_VARIANT_LIGHT_CHORDS = [
  { freqs: [220.0, 261.63, 329.63], atBeat: 0 }, // A minor (A3 C4 E4)
  { freqs: [329.63, 415.3, 493.88], atBeat: 4.75 }, // E major (E4 G#4 B4)
];

const NIGHT_VARIANT_FULL = [
  [329.63, 0.5], [440.0, 0.5], [523.25, 0.5], [659.25, 0.5],
  [415.3, 0.5], [493.88, 0.5], [659.25, 0.5], [830.61, 0.5],
  [440.0, 0.5], [523.25, 0.5], [659.25, 0.5], [880.0, 1],
  [415.3, 0.5], [493.88, 0.5], [659.25, 0.5], [329.63, 1.5],
  [220.0, 2],
];
const NIGHT_VARIANT_FULL_CHORDS = [
  { freqs: [220.0, 261.63, 329.63], atBeat: 0 },
  { freqs: [329.63, 415.3, 493.88], atBeat: 5.75 },
];

const NIGHT_PHASE_REPEATS = [3, 4, 4];
let nightPhase = 0; // 0 = intro, 1 = light strings, 2 = full strings

let musicMode = 'day'; // 'day' | 'night'

// Read once per loop start rather than mixed mid-phrase, so a mode switch
// takes effect at the next natural boundary instead of cutting off
// whatever's currently playing.
function scheduleLoop() {
  if (!musicPlaying) return;
  if (musicMode === 'night') {
    scheduleNightLoop();
  } else {
    scheduleDayLoop();
  }
}

function scheduleNightLoop() {
  const phase = nightPhase;
  const repeats = NIGHT_PHASE_REPEATS[phase];
  let t = audioCtx.currentTime + 0.05;

  for (let r = 0; r < repeats; r++) {
    const repeatStart = t;
    if (phase === 0) {
      const loopStart = t;
      NIGHT_MELODY.forEach(([freq, beats]) => {
        const duration = beats * NIGHT_BEAT_SECONDS;
        tone(freq, t, duration * 0.85, 'sine', 0.06, musicGain);
        t += duration;
      });
      tone(NIGHT_DRONE_FREQ, loopStart, t - loopStart, 'sine', 0.02, musicGain);
    } else {
      const melody = phase === 1 ? NIGHT_VARIANT_LIGHT : NIGHT_VARIANT_FULL;
      const chords = phase === 1 ? NIGHT_VARIANT_LIGHT_CHORDS : NIGHT_VARIANT_FULL_CHORDS;
      const padGain = phase === 1 ? 0.03 : 0.055;
      let phraseBeats = 0;
      melody.forEach(([freq, beats]) => {
        const duration = beats * NIGHT_VARIANT_BEAT_SECONDS;
        tone(freq, t, duration * 0.85, 'sine', 0.06, musicGain);
        t += duration;
        phraseBeats += beats;
      });
      chords.forEach((chord, i) => {
        const chordStart = repeatStart + chord.atBeat * NIGHT_VARIANT_BEAT_SECONDS;
        const nextAtBeat = chords[i + 1] ? chords[i + 1].atBeat : phraseBeats;
        const chordDuration = (nextAtBeat - chord.atBeat) * NIGHT_VARIANT_BEAT_SECONDS;
        stringPad(chord.freqs, chordStart, chordDuration, padGain, musicGain);
      });
    }
  }

  const totalDuration = (t - audioCtx.currentTime) * 1000;
  nightPhase = (nightPhase + 1) % 3;
  musicTimer = setTimeout(scheduleLoop, totalDuration);
}

// Three sections in sequence — plucking intro, then a light-strings
// variant, then a fuller/rapturous one — each repeating a few times
// (DAY_PHASE_REPEATS) before handing off to the next, cycling back to the
// intro once all three have played. dayPhase carries over between calls
// so the sequence keeps advancing rather than restarting at the intro
// every time.
function scheduleDayLoop() {
  const phase = dayPhase;
  const repeats = DAY_PHASE_REPEATS[phase];
  let t = audioCtx.currentTime + 0.05;

  for (let r = 0; r < repeats; r++) {
    const repeatStart = t;
    if (phase === 0) {
      DAY_MELODY.forEach(([freq, beats]) => {
        const duration = beats * DAY_BEAT_SECONDS;
        tone(freq, t, duration * 0.85, 'triangle', 0.08, musicGain);
        t += duration;
      });
    } else {
      const melody = phase === 1 ? DAY_VARIANT_LIGHT : DAY_VARIANT_FULL;
      const chords = phase === 1 ? DAY_VARIANT_LIGHT_CHORDS : DAY_VARIANT_FULL_CHORDS;
      const padGain = phase === 1 ? 0.035 : 0.07;
      let phraseBeats = 0;
      melody.forEach(([freq, beats]) => {
        const duration = beats * DAY_VARIANT_BEAT_SECONDS;
        tone(freq, t, duration * 0.85, 'triangle', 0.08, musicGain);
        t += duration;
        phraseBeats += beats;
      });
      chords.forEach((chord, i) => {
        const chordStart = repeatStart + chord.atBeat * DAY_VARIANT_BEAT_SECONDS;
        const nextAtBeat = chords[i + 1] ? chords[i + 1].atBeat : phraseBeats;
        const chordDuration = (nextAtBeat - chord.atBeat) * DAY_VARIANT_BEAT_SECONDS;
        stringPad(chord.freqs, chordStart, chordDuration, padGain, musicGain);
      });
    }
  }

  const totalDuration = (t - audioCtx.currentTime) * 1000;
  dayPhase = (dayPhase + 1) % 3;
  musicTimer = setTimeout(scheduleLoop, totalDuration);
}

// Switches which melody the loop picks up next time scheduleLoop runs,
// rather than restarting immediately — see the comment above scheduleLoop.
export function setMusicMode(mode) {
  musicMode = mode;
}

export function startMusic() {
  if (!audioCtx || musicPlaying) return;
  musicPlaying = true;
  scheduleLoop();
}

export function stopMusic() {
  musicPlaying = false;
  if (musicTimer) clearTimeout(musicTimer);
}
