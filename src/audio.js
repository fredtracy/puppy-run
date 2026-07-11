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

// A short, silly, looping melody for daytime
const DAY_MELODY = [
  [523.25, 0.5], [587.33, 0.5], [659.25, 0.5], [523.25, 0.5],
  [659.25, 0.5], [698.46, 0.5], [783.99, 1],
  [659.25, 0.5], [587.33, 0.5], [523.25, 0.5], [493.88, 0.5],
  [523.25, 1.5],
];
const DAY_BEAT_SECONDS = 0.28;

// A slower, floatier, minor-pentatonic loop for night — sine tones instead
// of triangle for a softer timbre, rests (freq 0) for breathing room
// between phrases, and a sustained low drone underneath for an ambient,
// music-box-under-moonlight feel rather than the daytime melody's chipper
// bounce.
const NIGHT_MELODY = [
  [440.0, 1.5], [523.25, 1], [0, 0.5],
  [392.0, 1.5], [440.0, 1], [0, 0.5],
  [329.63, 1.5], [392.0, 1], [440.0, 2], [0, 1],
];
const NIGHT_BEAT_SECONDS = 0.4;
const NIGHT_DRONE_FREQ = 110;

let musicMode = 'day'; // 'day' | 'night'

// Read once per loop start rather than mixed mid-phrase, so a mode switch
// takes effect at the next natural loop boundary instead of cutting off
// whatever's currently playing.
function scheduleLoop() {
  if (!musicPlaying) return;
  const isNight = musicMode === 'night';
  const melody = isNight ? NIGHT_MELODY : DAY_MELODY;
  const beatSeconds = isNight ? NIGHT_BEAT_SECONDS : DAY_BEAT_SECONDS;

  let t = audioCtx.currentTime + 0.05;
  const loopStart = t;
  melody.forEach(([freq, beats]) => {
    const duration = beats * beatSeconds;
    if (freq > 0) {
      tone(freq, t, duration * 0.85, isNight ? 'sine' : 'triangle', isNight ? 0.06 : 0.08, musicGain);
    }
    t += duration;
  });
  if (isNight) {
    tone(NIGHT_DRONE_FREQ, loopStart, t - loopStart, 'sine', 0.025, musicGain);
  }
  const totalDuration = (t - audioCtx.currentTime) * 1000;
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
