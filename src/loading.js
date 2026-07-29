// The loading screen. Darla colours in from nose to tail as the world builds;
// when the colour reaches her tail, she's fully loaded.
//
// She's the real 3D model, shot side-on into a texture and then treated as a
// flat image for the rest of the screen's life (see portrait.js). That
// ordering is the whole trick: her model and the renderer both exist long
// before the expensive part of the load (grass is 97% of world generation —
// see notes/load-times.md), so a one-off render costs a few milliseconds and
// is paid well inside the wait it's covering.
//
// The sweep itself is CSS transforms on two stacked canvases, not a canvas
// redraw. World generation blocks the main thread in ~200ms lumps, so anything
// drawn from JS gets about five frames a second and staircases badly; a
// transform transition is interpolated by the compositor and keeps moving at
// full rate while the main thread is stuck. See index.html for how the two
// layers are arranged.
//
// The title and background live in index.html's <style> instead of here, so
// they paint on the browser's first pass — before this module, or Three.js,
// has evaluated at all.

import { captureObject, makeCanvas, measureBounds } from './portrait.js';

// One per third of the load. The first is duplicated as static text in
// index.html so there's a caption before this module has evaluated — change
// one and change the other.
//
// They get a third each because `progress` is calibrated to real elapsed time
// rather than to units of work: the phase weights in main.js come from the
// measurements in notes/load-times.md, so a third of the bar is very roughly a
// third of the wait. If the shape of the load changes a lot, those weights
// need to move with it or these will drift out of step.
const LOADING_STATUS = ['Scooping the poop…', 'Mowing the lawn…', 'Waking up the deer…'];

let statusEl = null;
let screenEl = null;
let inkCanvas = null;
let ghostCanvas = null;
let veilEl = null;
let glowEl = null;
let glowBandEl = null;
let bounds = null;
let progress = 0;
let statusIndex = -1;
let finished = false;
let lastUpdateAt = 0;
let gapAverage = 0;
// Our own record of the sweep's current segment, kept in performance.now()
// time. See sweepPosition for why the browser's own animation clock can't be
// trusted here.
let sweepAnimations = [];
let sweepFrom = 0;
let sweepTo = 0;
let sweepStart = 0;
let sweepDuration = 0;

// ?load=0.6 pins the screen at that progress and stops it ever dismissing, so
// this screen can be looked at at any stage without sitting through a real
// eight-second build to catch it. Same spirit as ?at= / ?cam= / ?debug in
// main.js. ?load on its own means the finished dog.
const LOAD_PIN = (() => {
  const raw = new URLSearchParams(location.search).get('load');
  if (raw === null) return null;
  if (raw === '') return 1;
  const value = Number(raw);
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : null;
})();

// Caught mid-trot rather than standing four-square, using the same diagonal
// leg pairing as the in-game walk cycle (see updateWalkCycle in main.js). A dog
// standing still is a display model; one mid-stride is running, which is both
// livelier and the name on the title above her.
function poseMidTrot(object) {
  const legs = object.userData.legs;
  if (!legs) return null;
  const swing = 0.5;
  const saved = [];
  for (const [name, angle] of [
    ['legFR', swing],
    ['legBL', swing],
    ['legFL', -swing],
    ['legBR', -swing],
  ]) {
    if (!legs[name]) continue;
    saved.push([legs[name], legs[name].rotation.x]);
    legs[name].rotation.x = angle;
  }
  return () => {
    for (const [leg, angle] of saved) leg.rotation.x = angle;
  };
}

// The uncoloured version: her own render, washed out to a pale wisp, like a
// colouring-book page waiting to be filled. Keeping her shading rather than
// flattening to a white silhouette is what stops the un-loaded half reading as
// a featureless blob — you can still see the shape of the dog you're waiting
// for. `source-atop` confines the wash to her own pixels so the background
// stays untouched.
function paintGhost(target, inked, w, h) {
  const g = target.getContext('2d');
  g.clearRect(0, 0, w, h);
  g.drawImage(inked, 0, 0);
  g.globalCompositeOperation = 'source-atop';
  g.fillStyle = 'rgba(255, 252, 244, 0.82)';
  g.fillRect(0, 0, w, h);
  g.globalCompositeOperation = 'source-over';
}

// A soft contact shadow under her paws, dropped in behind her. Without it she
// hangs in mid-air on a plain gradient — the portrait has no ground of its own
// to catch the real one. Placed off the measured silhouette so it stays under
// her feet whatever the framing.
function addContactShadow(ctx) {
  const span = bounds.maxX - bounds.minX;
  const cx = (bounds.minX + bounds.maxX) / 2;
  const rx = span * 0.44;
  const ry = span * 0.055;
  const shade = ctx.createRadialGradient(cx, bounds.maxY, 0, cx, bounds.maxY, rx);
  shade.addColorStop(0, 'rgba(126, 96, 68, 0.34)');
  shade.addColorStop(0.6, 'rgba(126, 96, 68, 0.16)');
  shade.addColorStop(1, 'rgba(126, 96, 68, 0)');
  ctx.globalCompositeOperation = 'destination-over';
  ctx.save();
  ctx.translate(cx, bounds.maxY);
  ctx.scale(1, ry / rx);
  ctx.translate(-cx, -bounds.maxY);
  ctx.fillStyle = shade;
  ctx.beginPath();
  ctx.arc(cx, bounds.maxY, rx, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  ctx.globalCompositeOperation = 'source-over';
}

// Where the colour edge sits, as a fraction of the picture's width. Anchored
// to her measured silhouette rather than the canvas, so progress 0 is her nose
// and progress 1 is her rightmost pixel — her tail.
function edgeFraction() {
  const span = bounds.maxX - bounds.minX;
  return (bounds.minX + span * progress) / inkCanvas.width;
}

// Where the sweep is right now, worked out from our own bookkeeping in real
// time rather than read back off the element.
//
// This is the whole reason the sweep is driven by the Web Animations API and
// not by CSS transitions. `document.timeline.currentTime` only advances at
// frame boundaries, and every progress update arrives at the end of a ~200ms
// chunk during which no frames ran at all — so at the moment we'd start a new
// transition, the timeline is a fifth of a second in the past. A transition
// begun there starts from where the animation *was* then, while the compositor
// has been drawing on ahead the whole time, and the edge visibly jumps
// backwards. Tracking the interpolation ourselves against performance.now()
// sidesteps the stale clock entirely.
function sweepPosition() {
  if (!sweepDuration) return sweepTo;
  const t = Math.min(1, (performance.now() - sweepStart) / sweepDuration);
  return sweepFrom + (sweepTo - sweepFrom) * t;
}

function applyProgress(overrideDuration) {
  if (!bounds || !veilEl) return;
  const target = edgeFraction() * 100;

  // How long to take getting there. Chunk costs vary a lot — a chunk of open
  // lawn and a chunk of dense woods are not the same work — so timing each
  // move off the *last* gap alone makes the sweep lurch: one long chunk and
  // the next move is set far too slow, one short chunk and it arrives early
  // and sits still. A rolling average smooths that out, and the 1.6 bias
  // makes each move deliberately outlast its gap, so a new target always
  // arrives mid-glide and the edge never visibly stops.
  //
  // The cost is that the colour trails the real progress slightly. That's the
  // right trade here: nobody can see that the edge is a fifth of a chunk
  // behind, and everybody can see it stutter.
  const now = performance.now();
  const gap = lastUpdateAt ? now - lastUpdateAt : 260;
  lastUpdateAt = now;
  gapAverage = gapAverage ? gapAverage * 0.65 + gap * 0.35 : gap;
  let duration = Math.max(140, Math.min(900, gapAverage * 1.6));
  // A caller that already knows how long its step will block says so, rather
  // than being guessed at from a history of much shorter chunks.
  if (overrideDuration) duration = overrideDuration;
  if (LOAD_PIN !== null) duration = 0;

  const from = sweepPosition();
  sweepFrom = from;
  sweepTo = target;
  sweepStart = now;
  sweepDuration = duration;

  if (glowBandEl) {
    glowBandEl.style.visibility = progress > 0.002 && progress < 0.999 ? 'visible' : 'hidden';
  }

  // The inner canvas walks back by exactly as much as the window walks
  // forward, so the image stays registered with the full-colour one beneath
  // while the window's left edge sweeps across it.
  const layers = [
    [veilEl, 1],
    [ghostCanvas, -1],
    [glowBandEl, 1],
  ];

  for (const anim of sweepAnimations) anim.cancel();
  sweepAnimations = [];

  for (const [el, sign] of layers) {
    if (!el) continue;
    if (!duration) {
      el.style.transform = `translateX(${sign * target}%)`;
      continue;
    }
    const anim = el.animate(
      [
        { transform: `translateX(${sign * from}%)` },
        { transform: `translateX(${sign * target}%)` },
      ],
      // `both`, not `forwards`: startTime is set to real now, which is ahead
      // of the timeline, so for the first frame or two the animation hasn't
      // begun yet. Without a backwards fill the element would snap to its base
      // transform for exactly those frames.
      { duration, easing: 'linear', fill: 'both' }
    );
    // The point of the whole exercise. Anchoring to performance.now() rather
    // than letting it default to the timeline's stale frame time is what keeps
    // the new segment starting from where the edge is actually drawn.
    anim.startTime = now;
    sweepAnimations.push(anim);
  }
}

function applyStatus() {
  if (!statusEl || LOAD_PIN !== null) return;
  const index = Math.min(LOADING_STATUS.length - 1, Math.floor(progress * LOADING_STATUS.length));
  if (index === statusIndex) return;
  statusIndex = index;
  statusEl.textContent = LOADING_STATUS[index];
}

export function initLoadingScreen() {
  screenEl = document.getElementById('loading-screen');
  statusEl = document.getElementById('loading-status');
  inkCanvas = document.getElementById('loading-darla-ink');
  ghostCanvas = document.getElementById('loading-darla-ghost');
  veilEl = document.getElementById('loading-darla-veil');
  glowEl = document.getElementById('loading-darla-glow');
  glowBandEl = document.getElementById('loading-darla-glow-band');
  // Tolerate the elements not being there at all, so the game still boots if
  // the overlay is ever stripped out of index.html.
  if (!screenEl || !inkCanvas || !ghostCanvas || !veilEl) {
    inkCanvas = null;
    return;
  }
  if (LOAD_PIN !== null) progress = LOAD_PIN;
}

// Called once Darla's model and the renderer both exist — a few hundred
// milliseconds into the load, and well before the part of it worth watching.
// Everything from here on is CSS.
export function setLoadingModel(renderer, object) {
  if (!inkCanvas || finished) return;
  const w = inkCanvas.width;
  const h = inkCanvas.height;

  // Turned a little toward the camera rather than dead side-on. Flat profile
  // is the honest way to show a nose-to-tail sweep, but on an actual 3D model
  // it reads as a cardboard cutout and hides one whole side of her face; a few
  // degrees of yaw gets both eyes and some depth back while keeping her nose
  // the leftmost thing in frame and her tail the rightmost, which is all the
  // reveal actually depends on.
  const { image } = captureObject(renderer, object, {
    width: w,
    height: h,
    yaw: 0.34,
    elevation: 0.2,
    // More room under her paws than over her head, for the contact shadow.
    padBottom: 0.14,
    pose: poseMidTrot,
  });
  bounds = measureBounds(image, w, h);

  const ink = inkCanvas.getContext('2d');
  ink.putImageData(image, 0, 0);
  addContactShadow(ink);
  paintGhost(ghostCanvas, inkCanvas, w, h);

  // Confine the edge light to her outline. The ghost layer's alpha is exactly
  // her silhouette, so it doubles as the mask with no extra drawing. Static —
  // only the band inside it moves, which is what keeps this composited.
  if (glowEl) {
    const mask = `url(${ghostCanvas.toDataURL('image/png')})`;
    glowEl.style.webkitMaskImage = mask;
    glowEl.style.maskImage = mask;
    glowEl.style.webkitMaskSize = '100% 100%';
    glowEl.style.maskSize = '100% 100%';
  }

  applyStatus();
  applyProgress();
}

export function setLoadingStatus(text) {
  // Frozen under ?load= so the pinned screen is a coherent moment, and
  // otherwise only used for the final "Ready!" — the three real messages are
  // driven off progress by applyStatus so they get a third of the wait each.
  if (statusEl && LOAD_PIN === null) statusEl.textContent = text;
}

// `durationMs` is for steps whose cost is known in advance and is nothing like
// the recent chunk gaps — currently just the shader compile, which is one
// ~1.9s block with no updates inside it. Left to the rolling average, the edge
// would glide for half a second and then sit dead still for the rest of it,
// which is the most visible stall in the whole load.
export function setLoadingProgress(value, durationMs) {
  if (LOAD_PIN !== null) return;
  progress = Math.max(0, Math.min(1, value));
  // Text before transform, deliberately. Whatever style work a message change
  // costs then happens *before* the new transition is started, so the
  // transition begins from a value computed against a settled layout instead
  // of being disturbed immediately after it starts. Paired with the reserved
  // slot in index.html that stops the text reflowing anything in the first
  // place.
  applyStatus();
  applyProgress(durationMs);
}

// Hand the main thread back long enough for the browser to actually paint.
//
// A bare `await` isn't enough — that's a microtask, and the browser won't get
// a paint in before the next chunk starts. rAF then a task gets us past the
// paint; the timeout is the fallback for a hidden tab, where rAF never fires
// at all and the load would otherwise stall forever.
export function nextFrame() {
  // Nobody's watching a hidden tab, so don't pay for frames there — build
  // straight through instead. Also sidesteps background timer throttling,
  // which would stretch a 32-yield load out over half a minute.
  if (document.hidden) return Promise.resolve();
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      resolve();
    };
    requestAnimationFrame(() => setTimeout(finish, 0));
    setTimeout(finish, 250);
  });
}

export function finishLoading() {
  if (finished || LOAD_PIN !== null) return;
  finished = true;
  setLoadingProgress(1);
  if (!screenEl) return;
  screenEl.classList.add('done');
  // Kept in the DOM for the fade, then taken out of the layout entirely so it
  // can't intercept clicks meant for the character-select cards behind it.
  const el = screenEl;
  setTimeout(() => {
    el.classList.add('gone');
    inkCanvas = null;
    ghostCanvas = null;
  }, 700);
}
