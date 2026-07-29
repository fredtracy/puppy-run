// The day/night swap, played across Miranda's face.
//
// The swap was already hidden behind a five-second fade to black (instant
// relighting reads as a jarring flash-cut), so there was a five-second hole in
// the middle of it with nothing in it. This fills it: her portrait sits in the
// dark and transforms — the ground goes from warm cream to violet, a rim light
// comes up on her hair, sparkles arrive, and her winged eyeliner flicks itself
// on. All of it reverses on the way to morning.
//
// It draws the same portrait as her character-select card (portrait-miranda.js)
// rather than a render of her head, so the two can't disagree, and so `night`
// and `wing` can be animated as plain numbers. An earlier version shot her real
// head twice and wiped between the stills; that was honest about the geometry
// but couldn't do this — the eyeliner could only be revealed, never *drawn*, and
// the ground and sparkles couldn't move at all.

import { drawMirandaFace } from './portrait-miranda.js';

// Beats, in milliseconds from the start of the transition. The caller's total is
// only used for the fade out, so these can't drift out of step with it.
const BACKDROP_IN = 1100;
const FACE_IN_START = 700;
const FACE_IN_END = 1700;
const GROUND_START = 1500;
const GROUND_END = 3600;
const WING_START = 1900;
const WING_END = 3200;
const HOLD_UNTIL = 4300;

let screenEl = null;
let ctx = null;
let playing = null;

// ?face=0.55 freezes the transition at that fraction of its run and holds it
// there, so the beats can be looked at without chasing a five-second animation
// with a screenshot. `&faceto=day` plays it as the morning direction (the wings
// coming off) instead of the night one. Same spirit as ?load= and ?at=.
const FACE_PIN = (() => {
  const params = new URLSearchParams(location.search);
  const raw = params.get('face');
  if (raw === null) return null;
  const value = raw === '' ? 1 : Number(raw);
  if (!Number.isFinite(value)) return null;
  return { t: Math.max(0, Math.min(1, value)), toNight: params.get('faceto') !== 'day' };
})();

const clamp01 = (v) => Math.max(0, Math.min(1, v));
const span = (now, start, end) => clamp01((now - start) / (end - start));
const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);

// Overshoots past 1 and settles back. This is the whole difference between the
// eyeliner reading as *flicked* on and reading as slid out — the wing shoots a
// little past its final length and springs back.
function easeOutBack(t) {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2;
}

export function initNightTransition() {
  screenEl = document.getElementById('transition-screen');
  const canvas = document.getElementById('transition-face');
  if (!screenEl || !canvas) return;
  ctx = canvas.getContext('2d');

  if (FACE_PIN) {
    // HOLD_UNTIL rather than the caller's total, so ?face=1 lands on the held
    // frame at the end of the transformation rather than on the fade-out.
    screenEl.classList.toggle('to-day', !FACE_PIN.toNight);
    screenEl.style.opacity = '1';
    draw(HOLD_UNTIL * FACE_PIN.t, FACE_PIN.toNight);
  }
}

function draw(now, toNight) {
  const size = ctx.canvas.width;
  const faceAlpha = easeInOut(span(now, FACE_IN_START, FACE_IN_END));
  const ground = easeInOut(span(now, GROUND_START, GROUND_END));
  const flick = span(now, WING_START, WING_END);

  // Both values run backwards for the morning direction. The wing retracts on a
  // plain ease rather than the springy one — a flick that overshoots on the way
  // *off* looks like a mistake.
  const night = toNight ? ground : 1 - ground;
  const wing = toNight ? easeOutBack(flick) : 1 - easeInOut(flick);

  ctx.clearRect(0, 0, size, size);
  ctx.save();
  ctx.globalAlpha = faceAlpha;
  drawMirandaFace(ctx, size, { night, wing });
  ctx.restore();
}

// Runs the whole transition. `total` comes from the caller's own fade timing so
// the two can't drift; anything left after the last beat is the hold and the
// fade out.
export function playNightTransition(toNight, total) {
  if (!ctx || FACE_PIN) return;
  const startedAt = performance.now();
  const token = {};
  playing = token;

  screenEl.classList.toggle('to-day', !toNight);

  const step = () => {
    // A second toggle can't land mid-transition (the button is disabled for the
    // full round trip), but a remote peer's swap can, so an older run bails
    // rather than fighting the newer one for the canvas.
    if (playing !== token) return;
    const now = performance.now() - startedAt;

    const fadeIn = Math.min(1, now / BACKDROP_IN);
    const fadeOut = 1 - span(now, HOLD_UNTIL, total);
    screenEl.style.opacity = String(Math.min(fadeIn, fadeOut));
    draw(now, toNight);

    if (now < total) {
      requestAnimationFrame(step);
    } else {
      playing = null;
      screenEl.style.opacity = '0';
    }
  };
  step();

  // requestAnimationFrame stops dead in a backgrounded tab, but the swap's own
  // setTimeout chain keeps running — so switching away mid-transition and back
  // would leave her face frozen at whatever frame it reached, opaque, over an
  // already-relit yard. A wall-clock backstop guarantees the screen clears
  // whether or not the loop ever gets another frame.
  setTimeout(() => {
    if (playing !== token) return;
    playing = null;
    screenEl.style.opacity = '0';
  }, total + 150);
}
