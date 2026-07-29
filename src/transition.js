// The day/night swap, played across Miranda's face.
//
// The swap was already hidden behind a five-second fade to black (instant
// relighting reads as a jarring flash-cut), so there was a five-second hole in
// the middle of it with nothing in it. This fills it: her winged eyeliner draws
// itself on for the night, and comes back off on the way to morning.
//
// How it's done, and why it isn't animated 3D: her head is shot twice up front
// (see portrait.js) — once bare, once made up — and the transformation is a
// directional wipe from one still to the other. The two images are identical
// everywhere except the wings, which is exactly what makes the trick
// invisible: a wipe can be as generous as it likes around each eye and still
// only ever reveal the eyeliner. It also means the real geometry does the
// drawing, so what appears on her face here is the same wing the model wears in
// the yard, not a 2D approximation that would have to be kept in sync by hand.

import * as THREE from 'three';
import { captureObject, makeCanvas } from './portrait.js';
import { setMomNight } from './mom.js';

// Beats, in milliseconds from the start of the transition. The caller's total
// is asserted against the last of these, so the two can't drift apart.
const BACKDROP_IN = 1100;
const FACE_IN_START = 700;
const FACE_IN_END = 1700;
const WING_START = 1700;
const WING_END = 3400;
const HOLD_UNTIL = 4300;

let screenEl = null;
let ctx = null;
let bareCanvas = null;
let nightCanvas = null;
let maskCanvas = null;
// The union of the two wing regions, built separately from the mask it's
// applied to. It has to be its own canvas: `destination-in` *intersects*, so
// painting both regions straight onto the mask leaves only what the two have in
// common — which for wings at opposite corners of her face is nothing at all.
// Union them here with source-over first, then apply the result once.
let regionCanvas = null;
// Pixel coordinates, within the captured image, of each eye's centre and the
// tip of its wing. Measured by projecting the real meshes rather than
// hardcoded, so nudging her face in mom.js can't leave the wipes pointing at
// the wrong part of her.
let marks = null;
let playing = null;

// ?face=0.55 freezes the transition at that fraction of its run and holds it
// there, so the wipes can be looked at without chasing a five-second animation
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

const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);
const span = (now, start, end) => Math.max(0, Math.min(1, (now - start) / (end - start)));

// Dimmer and cooler than the loading screen's daytime rig — this face is seen
// against a near-black backdrop, and the warm yard key made her look like she
// was standing in a different scene from the one she's dissolving through.
function transitionLights() {
  const key = new THREE.DirectionalLight(0xffeede, 2.4);
  key.position.set(3, 2.2, 2.4);
  const rim = new THREE.DirectionalLight(0x9fb6ff, 1.5);
  rim.position.set(-1.5, 1.2, -2);
  return [new THREE.AmbientLight(0xdfe4ff, 1.1), key, rim];
}

// Shoot her head both ways. Framed on the head mesh alone — deliberately not
// on everything visible, because the wings are themselves visible geometry, so
// framing to the whole subject would produce a slightly different crop for the
// two shots and the wipe between them would jump.
function captureFace(renderer, mom, width, height, night) {
  setMomNight(mom, night);
  return captureObject(renderer, mom, {
    width,
    height,
    // Three-quarters on, against the fixed +X camera: dead front-on is stiff,
    // and past about this much the far wing disappears behind her nose.
    yaw: Math.PI / 2 - 0.3,
    elevation: 0.05,
    frame: (object) => object.userData.head,
    padX: 0.5,
    padTop: 0.42,
    padBottom: 0.62,
    lights: transitionLights,
    points: (object) => [...object.userData.eyes, ...object.userData.flicks],
  });
}

export function initNightTransition(renderer, mom) {
  screenEl = document.getElementById('transition-screen');
  const canvas = document.getElementById('transition-face');
  if (!screenEl || !canvas || !mom.userData.head) return;

  const w = canvas.width;
  const h = canvas.height;
  ctx = canvas.getContext('2d');

  const bare = captureFace(renderer, mom, w, h, false);
  const night = captureFace(renderer, mom, w, h, true);
  setMomNight(mom, false);

  bareCanvas = makeCanvas(w, h);
  bareCanvas.getContext('2d').putImageData(bare.image, 0, 0);
  nightCanvas = makeCanvas(w, h);
  nightCanvas.getContext('2d').putImageData(night.image, 0, 0);
  maskCanvas = makeCanvas(w, h);
  regionCanvas = makeCanvas(w, h);

  // Same order as the `points` list above: two eyes, then two wing tips. Taken
  // from the night shot, which is the one that actually has wings in it.
  const p = night.points;
  marks = { eyes: [p[0], p[1]], flicks: [p[2], p[3]] };

  if (FACE_PIN) {
    // The two stills and the projected marks, for poking at from the console
    // when a wipe lands in the wrong place. Only under ?face=.
    globalThis.faceDebug = { bare: bareCanvas, night: nightCanvas, marks };
    // HOLD_UNTIL rather than the caller's total, so ?face=1 lands on the held
    // frame at the end of the transformation rather than on the fade-out.
    screenEl.classList.toggle('to-day', !FACE_PIN.toNight);
    screenEl.style.opacity = '1';
    draw(HOLD_UNTIL * FACE_PIN.t, FACE_PIN.toNight);
  }
}

// Keep the wing region for eye `i` up to `t` of the way along its sweep.
// Painted into the region canvas as "what to keep of the revealed image".
function paintWingRegion(m, i, t, outward) {
  const eye = marks.eyes[i];
  const tip = marks.flicks[i];
  // How far past the tip to carry the wipe, so the very point of the wing is
  // fully in or fully out at the ends of the sweep rather than half-faded.
  const reach = tip.x - eye.x;
  const overshoot = reach * 0.9;
  const from = eye.x - reach * 0.5;
  const to = tip.x + overshoot;
  const band = Math.abs(reach) * 2.4;
  const top = Math.min(eye.y, tip.y) - band;
  const bottom = Math.max(eye.y, tip.y) + band;
  const soft = Math.abs(to - from) * 0.14;

  // `outward` runs the edge from the inner corner out to the tip (putting the
  // wing on); the other direction retracts it tip-first.
  const edge = outward ? from + (to - from) * t : to + (from - to) * t;
  const ahead = outward ? Math.sign(to - from) : Math.sign(from - to);

  const g = m.createLinearGradient(edge, 0, edge + ahead * soft, 0);
  g.addColorStop(0, 'rgba(0, 0, 0, 1)');
  g.addColorStop(1, 'rgba(0, 0, 0, 0)');
  m.fillStyle = g;
  const x0 = Math.min(from, to) - soft;
  const x1 = Math.max(from, to) + soft;
  m.fillRect(x0, top, x1 - x0, bottom - top);
}

function draw(now, toNight) {
  const w = ctx.canvas.width;
  const h = ctx.canvas.height;

  const faceAlpha = easeInOut(span(now, FACE_IN_START, FACE_IN_END));
  const wing = easeInOut(span(now, WING_START, WING_END));

  // Base is where she's coming *from*; the wipe reveals where she's going.
  const base = toNight ? bareCanvas : nightCanvas;
  const reveal = toNight ? nightCanvas : bareCanvas;

  ctx.clearRect(0, 0, w, h);
  ctx.globalAlpha = faceAlpha;
  ctx.drawImage(base, 0, 0);

  if (wing > 0) {
    // Unioned onto their own canvas first: `destination-in` intersects rather
    // than accumulates, so painting both eyes straight onto the mask would
    // leave only what the two have in common, which is nothing.
    const r = regionCanvas.getContext('2d');
    r.globalCompositeOperation = 'source-over';
    r.clearRect(0, 0, w, h);
    paintWingRegion(r, 0, wing, toNight);
    paintWingRegion(r, 1, wing, toNight);

    const m = maskCanvas.getContext('2d');
    m.globalCompositeOperation = 'source-over';
    m.clearRect(0, 0, w, h);
    m.drawImage(reveal, 0, 0);
    m.globalCompositeOperation = 'destination-in';
    m.drawImage(regionCanvas, 0, 0);
    m.globalCompositeOperation = 'source-over';
    ctx.drawImage(maskCanvas, 0, 0);
  }
  ctx.globalAlpha = 1;
}

// Runs the whole transition. `total` comes from the caller's own fade timing
// so the two can't drift; anything left after the last beat is the hold and
// the fade out.
export function playNightTransition(toNight, total) {
  if (!ctx || !marks || FACE_PIN) return;
  const startedAt = performance.now();
  const token = {};
  playing = token;

  screenEl.classList.toggle('to-day', !toNight);

  const step = () => {
    // A second toggle can't land mid-transition (the button is disabled for
    // the full round trip), but a remote peer's swap can, so an older run
    // bails rather than fighting the newer one for the canvas.
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
