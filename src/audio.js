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

export function playPoopSound() {
  if (!audioCtx) return;
  const t = audioCtx.currentTime;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(220, t);
  osc.frequency.exponentialRampToValueAtTime(75, t + 0.16);
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

// A short, silly, looping melody
const MELODY = [
  [523.25, 0.5], [587.33, 0.5], [659.25, 0.5], [523.25, 0.5],
  [659.25, 0.5], [698.46, 0.5], [783.99, 1],
  [659.25, 0.5], [587.33, 0.5], [523.25, 0.5], [493.88, 0.5],
  [523.25, 1.5],
];
const BEAT_SECONDS = 0.28;

function scheduleLoop() {
  if (!musicPlaying) return;
  let t = audioCtx.currentTime + 0.05;
  MELODY.forEach(([freq, beats]) => {
    const duration = beats * BEAT_SECONDS;
    tone(freq, t, duration * 0.85, 'triangle', 0.08, musicGain);
    t += duration;
  });
  const totalDuration = (t - audioCtx.currentTime) * 1000;
  musicTimer = setTimeout(scheduleLoop, totalDuration);
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
