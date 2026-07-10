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
}

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
