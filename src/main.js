import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { createDarla, createPoop } from './darla.js';
import { createMom, setHairTime, setMomNight } from './mom.js';
import { initNightTransition, playNightTransition } from './transition.js';
import { drawMirandaFace } from './portrait-miranda.js';
import {
  createYard,
  createTreeChunk,
  QUALITY_TIER,
  GRASS_SPACING,
  GRASS_SPACING_BY_TIER,
  setGrassDensity,
  CHUNK_SIZE,
  FIRE_PIT,
  HAMMOCK,
  terrainHeight,
  pushOutOfTrees,
  treeColliderCount,
  updateGrassAngularSize,
  setGrassFog,
  setGrassLight,
  setGrassMoonGlow,
  setGrassShadow,
  setGrassTime,
  setWaterTime,
  setWaterLight,
  setFirePitLit,
  updateFirePit,
  updateDragonflies,
} from './yard.js';
import {
  HOUSE_SOLIDS,
  HOUSE_BACK_WALK_Z,
  HOUSE_LADDER,
  HOUSE_CHIMNEY,
  HOUSE_EAVE_Y,
  HOUSE_Z as HOUSE_ORIGIN_Z,
  houseRoofHeight,
  setHouseWindowsLit,
  setHouseLampsLit,
} from './house.js';
import { createSky } from './sky.js';
import {
  initAudio,
  startMusic,
  setMusicMode,
  playJumpSound,
  playMooSound,
  playPoopSound,
  playBarkSound,
  playBiteSound,
  playCallDarlaSound,
  setMusicPsychedelic,
} from './audio.js';
import * as net from './net.js';
import {
  initLoadingScreen,
  setLoadingModel,
  setLoadingProgress,
  setLoadingStatus,
  nextFrame,
  finishLoading,
} from './loading.js';

// Everything below here runs top-level and synchronously, which is why the
// page used to sit frozen on a blank character-select for the whole ~9s build
// (see notes/load-times.md) — the browser never got a paint in edgeways. The
// three `await`s further down are the fix: they're the only points where the
// main thread is handed back, and each one is what makes the loading screen
// able to redraw. Top-level await keeps the module's execution order exactly
// as it was, so nothing below has to care that it now happens across several
// frames instead of one. It does require build.target 'esnext' in
// vite.config.js — plain es2020 can't express it.
//
// The split of the bar between phases, taken from the measurements in
// notes/load-times.md: construction before the world is ~10% of the wait,
// world generation ~80%, and the first frame's shader compile the last ~10%.
//
// These are shares of *elapsed time*, not of work done, and that distinction
// matters now — loading.js gives each of its three status messages a third of
// the bar, so the bar has to track the clock for them to get a third of the
// wait each. An earlier split weighted the pre-world phase at 0.05 and the
// shader compile at 0.17, which was fine as a progress bar but left the first
// message up for 41% of the load and the last for 23%.
const LOAD_WORLD_FROM = 0.1;
const LOAD_WORLD_TO = 0.9;
const LOAD_SHADERS_TO = 0.99;

initLoadingScreen();
// Paints the title and her uncoloured outline before the house, lawn and
// characters get built below.
await nextFrame();

// Debug mode: add ?debug to the URL. Skips straight past the mode-select
// and character-select screens and parks the camera in a fixed bird's-eye
// view over DEBUG_FOCUS instead of chasing the player around — meant for
// quickly eyeballing a placement/geometry change on reload (chimney
// position, driveway alignment, whatever's being worked on) without
// walking there every time. Reusable for whatever's next: just move
// DEBUG_FOCUS. Grass is also skipped while this is on (see yard.js's own
// GRASS_ENABLED, which checks the same query param) purely for faster
// reloads while iterating — normal loads still get grass as usual.
const DEBUG_MODE = new URLSearchParams(window.location.search).has('debug');

// Which camera debug is using. Free-fly is the default, because that's what
// ?debug has always meant and every `?eye=&look=` URL ever copied out of it
// assumes so.
//
// Fixed puts the ordinary third-person camera back while keeping the panel,
// which is what you want when the thing being judged is how the game
// actually plays or reads — the FPS counter especially, since a free camera
// parked in the woods is measuring a view nobody ever has.
//
// `?fly=0` starts in fixed; the panel toggles it live (setDebugCamera).
// It's live rather than a reload because rebuilding the world to change
// camera would cost several seconds and lose wherever you'd flown to.
let debugFreeFly =
  DEBUG_MODE && new URLSearchParams(window.location.search).get('fly') !== '0';

// `?at=x,z` — start the game already standing at a world position, instead
// of at the fire pit. Optionally `&as=miranda` to pick the character, which
// also skips the character-select screen.
//
// Deliberately independent of DEBUG_MODE, and that's the entire point of it
// being a separate flag: ?debug turns the grass *off* (see GRASS_ENABLED in
// yard.js) so it's useless for the one thing this gets used for most, which
// is walking out to some corner of the lawn to look at the ground. Every
// edit triggers an HMR reload and drops you back at the fire pit, so
// checking anything at the road meant a 15-second walk after every single
// change.
//
//   ?at=-3.4,-32          the left road pine and its needle bed
//   ?at=9.6,-32           the right road pine
//   ?at=-1,5&as=miranda   the fire pit, as Miranda
const SPAWN_AT = (() => {
  const raw = new URLSearchParams(window.location.search).get('at');
  if (!raw) return null;
  const [x, z] = raw.split(',').map(Number);
  return Number.isFinite(x) && Number.isFinite(z) ? { x, z } : null;
})();
const SPAWN_AS = new URLSearchParams(window.location.search).get('as');

// `?cam=radius,phi,theta` — the camera's orbit around the player, in metres
// and degrees. Pairs with ?at= to make a view exactly repeatable, which
// ?at= alone is not: it puts the character in the right place but leaves the
// camera wherever it happened to be, so the same URL can land you looking at
// the subject, at the sky, or at the inside of a wall.
//
// phi is measured from straight up (so 90 is horizontal, smaller looks down
// from above) and theta is the compass angle around the player. Both come
// straight from THREE.Spherical, so window.camView() below can hand back
// numbers that round-trip exactly.
const SPAWN_CAM = (() => {
  const raw = new URLSearchParams(window.location.search).get('cam');
  if (!raw) return null;
  const [radius, phi, theta] = raw.split(',').map(Number);
  return [radius, phi, theta].every(Number.isFinite) ? { radius, phi, theta } : null;
})();

// `?eye=x,y,z&look=yaw,pitch` — debug's equivalent of ?cam=, and only used
// there. The free-fly camera isn't tied to the player at all, so an orbit
// around them can't describe where it is; this is the camera's own world
// position and heading, in metres and degrees. camView() emits this form
// instead of ?cam= whenever debug is on.
const SPAWN_EYE = (() => {
  const raw = new URLSearchParams(window.location.search).get('eye');
  if (!raw) return null;
  const [x, y, z] = raw.split(',').map(Number);
  return [x, y, z].every(Number.isFinite) ? { x, y, z } : null;
})();
const SPAWN_LOOK = (() => {
  const raw = new URLSearchParams(window.location.search).get('look');
  if (!raw) return null;
  const [yaw, pitch] = raw.split(',').map(Number);
  return [yaw, pitch].every(Number.isFinite) ? { yaw, pitch } : null;
})();
// Currently the middle of the driveway — x on the garage centreline, z
// halfway between where the house's own slab ends (world -28.2) and the
// road's near edge (world -38.3, see ROAD_Z in yard.js). Orbiting this
// frames the whole run from garage door to curb, which is what the front
// of the property is being judged on right now. Was (0, 1.5, -12.2), the
// middle of the house, while the elevations were being matched to the
// reference photos.
const DEBUG_FOCUS = new THREE.Vector3(-1.9, 3.93, 4.4);
// Where the debug camera starts relative to DEBUG_FOCUS, rather than the old
// fixed bird's-eye offset — being able to park it at eye level in front of
// whatever's being worked on is most of what makes debug mode useful.
const DEBUG_EYE = new THREE.Vector3(0.5, 0.05, 0.6);

// Browsers block audio until a user gesture — kick it off on the first
// keypress or tap/click, whichever comes first.
//
// Silent in debug mode. Debug is for staring at geometry and reloading every
// few seconds, and the music restarting from the top on every reload gets
// old fast. Same reasoning as skipping grass there.
function beginAudioOnFirstInput() {
  if (DEBUG_MODE) return;
  initAudio();
  startMusic();
}
if (!DEBUG_MODE) {
  window.addEventListener('keydown', beginAudioOnFirstInput, { once: true });
  window.addEventListener('pointerdown', beginAudioOnFirstInput, { once: true });
}

const scene = new THREE.Scene();
// Actual values come from applyDayNight() once the scene is fully built.
scene.background = new THREE.Color();
scene.fog = new THREE.Fog(0x000000, 14, 46);

const camera = new THREE.PerspectiveCamera(
  45,
  window.innerWidth / window.innerHeight,
  0.1,
  1000
);
// Both the character-select backdrop and, since nothing moves it unless
// ?cam= was given, where the camera is standing the moment the game starts.
//
// Moved off (7, 4.5, 11), which sat about two metres from the hammock tree
// at (6, ., 9). That was fine while the hammock trees were a cylinder
// wearing four spheres and only 2.5 m tall — the camera cleared them. They
// are real trees now, 4.4 m with a 4.6 m crown, and the opening shot of the
// game was the inside of one, looking at bark.
// Kept beside Darla looking at the house, exactly as it was, but moved to
// the west side of her instead of the east. The east is where the hammock
// trees stand, at (6, ., 9), and the old (7, 4.5, 11) put the camera about
// two metres from one. That was fine while they were a cylinder wearing
// four spheres; they're real trees now, and the opening shot of the game
// was the inside of one.
//
// Backing straight off her doesn't work either — she spawns at z = 10.95
// and the brush band's inner edge wanders to within about 5 m of that, so
// anything further along +z ends up inside a thicket. West is the open
// side.
camera.position.set(-4, 4.6, 6);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.85;
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.body.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 0.5, 0);
// Damping off, deliberately.
//
// It was on with three's default dampingFactor of 0.05, which eases the
// camera toward the mouse at 5% per frame. That single setting produces both
// halves of how wrong the camera felt: the ease-in means the view lags behind
// the pointer when you start dragging, and the ease-out means it carries on
// drifting for the better part of a second after you let go. Neither is
// inertia you can aim with — it's the same lag at both ends of the gesture.
//
// Off gives exact 1:1 tracking: the view stops when the mouse stops. If some
// smoothing is ever wanted back, raise dampingFactor toward 0.25 rather than
// re-enabling it at the default, which is far too slow for a camera you aim
// with rather than one that drifts around a product shot.
controls.enableDamping = false;
// Small enough that the camera can pull right in to the character's own
// position when you tilt all the way up — see clampOrbitToGround.
controls.minDistance = 0.12;
// The zoom-out limit you actually control with the scroll wheel.
// controls.maxDistance is driven per-frame off this, so it can be
// temporarily tightened without losing what it's meant to be.
//
// Doubled, on request, from the 13 it sat at.
//
// The old note said 13 was as far as it could go before the camera cleared
// the treeline and you started looking out over the edge of a 55 m world —
// yard as floating island, sky dome's lower half in view. That was written
// when the tree line was a thin band of see-through trees. It's a tall
// opaque wall now, which is most of what was holding the limit down.
// If the horizon does show at full zoom, this is the number to pull back.
let orbitMaxDistance = 26;
controls.maxDistance = orbitMaxDistance;
// Right-drag rotates, the way it does in most third-person RPGs. Left keeps
// rotating too, so nothing that already worked stops working — the only
// thing given up is panning, which was on the right button by default and
// was never useful here anyway: it drags controls.target off the character,
// and the follow-cam immediately hauls it back.
controls.mouseButtons = {
  LEFT: THREE.MOUSE.ROTATE,
  MIDDLE: THREE.MOUSE.DOLLY,
  RIGHT: THREE.MOUSE.ROTATE,
};

// The FPS readout's element and its rolling sample, filled in by
// buildDebugPanel and updated from the frame loop. Null when debug is off,
// which is what updateDebugFps checks rather than DEBUG_MODE — one less
// thing to keep in sync if the panel ever appears somewhere else.
//
// Declared *above* the DEBUG_MODE block below, not next to the function
// that fills it in. `buildDebugPanel` is a hoisted function declaration and
// gets called from there; these are `let` and are not hoisted, so keeping
// them beside it puts them in the temporal dead zone at the moment the
// panel is built — a ReferenceError that kills the module mid-load and
// shows up only as a loading screen that never finishes.
let debugFpsEl = null;
let fpsFrames = 0;
let fpsElapsed = 0;
let fpsWorstDelta = 0;
let lastFrameCalls = 0;
let lastFrameTriangles = 0;

if (DEBUG_MODE) {
  // Only the starting shot — from here it's a free-fly (see updateDebugFly),
  // so there's no orbit radius to cap and nothing stopping the camera going
  // wherever it likes.
  orbitMaxDistance = 60;
  controls.target.copy(DEBUG_FOCUS);
  camera.position.copy(DEBUG_FOCUS).add(DEBUG_EYE);
  camera.lookAt(DEBUG_FOCUS);
  buildDebugPanel();
  // See updateDebugFps: with autoReset on, the panel's draw-call and
  // triangle counts only ever describe the composer's last pass.
  renderer.info.autoReset = false;

  // Handles for poking at the running scene from the console. Debug only.
  //
  // Worth having as a permanent fixture rather than something pasted in
  // each time: performance work is mostly "turn one thing off and see", and
  // without this every such test costs a source edit plus a six-second
  // reload — which is slow enough that you stop running the cheap
  // experiments and start guessing instead.
  globalThis.gameDebug = {
    renderer,
    scene,
    camera,
    // Tree collision, for measuring it. Has to come from the live module —
    // a fresh `await import('./yard.js')` in devtools builds a *second*
    // module instance whose collider grid was never populated by world
    // generation, so it would answer instantly and mean nothing.
    pushOutOfTrees,
    treeColliderCount,
    // No `composer` property here, deliberately. It's a `const` declared
    // about 1,300 lines further down, so naming it in this object literal
    // reads it at construction time and throws a temporal-dead-zone
    // ReferenceError — which kills the module mid-load and shows up only
    // as a loading screen that never finishes with the debug panel
    // already drawn on top of it. Third time today. benchRender below
    // refers to `composer` inside a function body, which is fine: that
    // isn't evaluated until it's called.
    //
    // Re-exported rather than left to be imported from the console.
    //
    // `await import('/puppy-run/src/yard.js')` in devtools can hand back a
    // *different module instance* from the one the game is running —
    // different Vite query string, separate module registry entry — and
    // that copy has never built a world, so its grassFields array is
    // empty and setGrassDensity silently does nothing. It looks exactly
    // like a working call: no error, and a measurement that says grass
    // density has no effect on frame time. It cost a wrong conclusion
    // once already.
    setGrassDensity,
    // Render cost, measured by driving the composer directly rather than
    // by watching frames go by.
    //
    // Two reasons this is the better instrument. It doesn't need
    // requestAnimationFrame, so it still works when the page is
    // backgrounded and rAF is paused — which is most of the time when
    // something else is driving the browser. And it isn't clamped by
    // vsync: a frame that could render in 4 ms and one that takes 15 both
    // read as 60 fps in a rAF sample, so the counter goes flat exactly
    // where you most want resolution.
    //
    // The number is therefore *render time*, not frame time. Everything
    // else in a frame — movement, AI, the walk cycles — is excluded, which
    // is the point when the question is what the renderer is doing.
    benchRender(n = 60) {
      // Warm up: the first render after a state change recompiles shaders
      // and re-uploads buffers, and that cost lands on whichever sample
      // catches it.
      for (let i = 0; i < 5; i++) composer.render();

      // renderer.info resets itself at the start of every renderer.render(),
      // and the composer makes several of those per frame — so reading it
      // afterwards reports the *last* pass only, which is the fullscreen
      // blit: one draw call and one triangle, every time, no matter what
      // the scene contains. Turning autoReset off and resetting by hand is
      // what makes the totals mean the whole frame.
      renderer.info.autoReset = false;
      // WebGL calls queue rather than execute, so timing around
      // composer.render() alone measures how long it took to *submit* the
      // frame, not to draw it — which is why an untimed first pass showed a
      // 3 ms median on a scene doing ten million triangles. gl.finish()
      // blocks until the GPU has actually finished, which is the number
      // that matters. It is a terrible thing to do in a real frame loop and
      // exactly the right thing in a benchmark.
      const gl = renderer.getContext();
      const samples = [];
      let calls = 0;
      let triangles = 0;
      for (let i = 0; i < n; i++) {
        renderer.info.reset();
        const t = performance.now();
        composer.render();
        gl.finish();
        samples.push(performance.now() - t);
        calls = renderer.info.render.calls;
        triangles = renderer.info.render.triangles;
      }
      renderer.info.autoReset = true;
      samples.sort((a, b) => a - b);
      return {
        medianMs: +samples[Math.floor(n / 2)].toFixed(2),
        p95Ms: +samples[Math.floor(n * 0.95)].toFixed(2),
        calls,
        triangles,
      };
    },
    // Frame times over a window, as percentiles. Needs the page to be
    // visible — rAF is paused when it isn't, and this will simply hang.
    // benchRender above is the one to reach for otherwise.
    async profile(seconds = 4) {
      const samples = [];
      let last = performance.now();
      const until = last + seconds * 1000;
      await new Promise((resolve) => {
        const tick = () => {
          const now = performance.now();
          samples.push(now - last);
          last = now;
          if (now < until) requestAnimationFrame(tick);
          else resolve();
        };
        requestAnimationFrame(tick);
      });
      // The first frame's delta includes however long the caller took to
      // get here, so it's meaningless.
      samples.shift();
      samples.sort((a, b) => a - b);
      const at = (p) => samples[Math.floor(samples.length * p)];
      const info = renderer.info.render;
      return {
        frames: samples.length,
        median: +at(0.5).toFixed(2),
        p95: +at(0.95).toFixed(2),
        worst: +samples[samples.length - 1].toFixed(2),
        fps: Math.round(1000 / at(0.5)),
        calls: info.calls,
        triangles: info.triangles,
      };
    },
  };
}

// A small panel of the switches worth flipping while looking at something,
// debug only. Built here rather than in index.html so it costs nothing —
// and isn't in the DOM at all — for real players.
//
// Every option reloads, because all of them change how the world is *built*
// rather than how it's drawn: grass density is baked into the instance
// buffers at startup. The reload preserves at/cam/as so you keep the shot
// you were looking at, which is the whole reason this beats editing the URL
// by hand.
function updateDebugFps(delta) {
  if (!debugFpsEl) return;

  // Snapshot and reset *every* frame, before the once-a-second early
  // return below. Resetting down there instead let the counters run for a
  // full second, so the panel reported sixty frames' work as one — 9,180
  // calls and 181M triangles, which looks like a catastrophe rather than
  // an accounting error. Second time this counter has lied to me today.
  lastFrameCalls = renderer.info.render.calls;
  lastFrameTriangles = renderer.info.render.triangles;
  renderer.info.reset();

  fpsFrames++;
  fpsElapsed += delta;
  if (delta > fpsWorstDelta) fpsWorstDelta = delta;
  if (fpsElapsed < 1) return;
  const avg = Math.round(fpsFrames / fpsElapsed);
  // The worst *frame* expressed as the rate it would sustain, which is the
  // number that matches what a stutter feels like.
  const low = Math.round(1 / Math.max(fpsWorstDelta, 1e-4));
  // Draw calls and triangles for the frame just rendered. A frame rate on
  // its own says something is wrong; these two say *what* — a bad call
  // count is a batching problem, a bad triangle count is a geometry
  // problem, and they want completely different fixes.
  //
  // Reading these needs renderer.info.autoReset off (set in the DEBUG_MODE
  // block), because the composer calls renderer.render several times per
  // frame and each one resets the counters — so the reading is otherwise
  // whatever the *last* pass did, which is the fullscreen output blit:
  // "1 calls, 0k tris", forever, whatever is on screen. The same trap
  // benchRender documents, and I walked into it twice.
  //
  const tris = lastFrameTriangles >= 1e6
    ? `${(lastFrameTriangles / 1e6).toFixed(2)}M`
    : `${Math.round(lastFrameTriangles / 1000)}k`;
  debugFpsEl.textContent =
    `fps — ${avg} avg, ${low} low\n${lastFrameCalls} calls, ${tris} tris`;
  // Amber under 50, red under 30. A bare number invites squinting at it;
  // colour makes a bad frame rate obvious from across the room, which is
  // the point of putting it on screen at all.
  debugFpsEl.style.color = avg < 30 ? '#ff7a7a' : avg < 50 ? '#ffc46b' : '#9fe08f';
  fpsFrames = 0;
  fpsElapsed = 0;
  fpsWorstDelta = 0;
}

function buildDebugPanel() {
  const params = new URLSearchParams(window.location.search);
  const go = (changes) => {
    const next = new URLSearchParams(window.location.search);
    for (const [k, v] of Object.entries(changes)) {
      if (v === null) next.delete(k);
      else next.set(k, v);
    }
    window.location.search = next.toString();
  };

  const panel = document.createElement('div');
  panel.style.cssText =
    'position:fixed;top:8px;right:8px;z-index:9999;font:11px/1.5 ui-monospace,monospace;' +
    'background:rgba(16,18,22,0.86);color:#dfe4ea;padding:8px 10px;border-radius:8px;' +
    'max-width:230px;pointer-events:auto;user-select:none';

  const row = (label) => {
    const d = document.createElement('div');
    d.style.cssText = 'margin:6px 0 3px;opacity:0.55;letter-spacing:0.04em';
    d.textContent = label;
    panel.appendChild(d);
    const holder = document.createElement('div');
    holder.style.cssText = 'display:flex;gap:4px;flex-wrap:wrap';
    panel.appendChild(holder);
    return holder;
  };

  const style = (b, active) => {
    b.style.cssText =
      'font:inherit;padding:3px 7px;border-radius:5px;cursor:pointer;border:1px solid ' +
      (active ? '#7ec96f' : 'rgba(255,255,255,0.18)') +
      ';background:' +
      (active ? 'rgba(126,201,111,0.22)' : 'rgba(255,255,255,0.06)') +
      ';color:inherit';
  };

  // Returns the element, because the camera row below toggles live and has
  // to restyle its own buttons — every other row reloads the page, so their
  // active state is decided once at build time and never changes.
  const button = (holder, label, active, onClick) => {
    const b = document.createElement('button');
    b.textContent = label;
    style(b, active);
    b.addEventListener('click', onClick);
    holder.appendChild(b);
    return b;
  };

  const grassOn = params.has('grass');

  const head = document.createElement('div');
  head.style.cssText = 'font-weight:700;letter-spacing:0.06em;opacity:0.9';
  head.textContent = 'DEBUG';
  panel.appendChild(head);

  // Frame rate, plus the worst frame in the last second.
  //
  // The average alone is close to useless for the thing this is actually
  // for — a lawn that mostly runs at 60 and drops to 20 whenever a chunk of
  // woods comes into frame averages out to something that looks fine. The
  // spike is the complaint; the mean is what hides it.
  //
  // Sampled over a rolling second rather than per frame, because a readout
  // that updates every frame is unreadable and its own small cost.
  debugFpsEl = document.createElement('div');
  debugFpsEl.style.cssText =
    'margin-top:4px;font-variant-numeric:tabular-nums;white-space:pre-line';
  debugFpsEl.textContent = 'fps — measuring…';
  panel.appendChild(debugFpsEl);

  // Quality switches live where it can, by thinning the grass rather than
  // rebuilding it — see setGrassDensity. Blade *spacing* is baked into the
  // instance buffers at generation time, so this can only ever go coarser
  // than whatever the world was built at; asking for finer needs the reload
  // it always used to do.
  //
  // Worth being clear about what it therefore is and isn't: at a tier below
  // the built one this draws the same number of blades as a real load at
  // that tier, so it's an honest read on cost. What it can't reproduce is
  // the *arrangement* — a random subset of a fine grid, rather than a
  // coarser grid — so judge frame rate on it, not looks.
  const tierRow = row(
    `quality — detected "${QUALITY_TIER}", built at ${GRASS_SPACING}`
  );
  // row() appends its label and then its button holder, and hands back the
  // holder — so the label is the sibling just before it. Grabbed because
  // this row's caption changes as the density does.
  const tierLabel = tierRow.previousSibling;
  const tierButtons = {};
  const applyTier = (tier) => {
    const target = GRASS_SPACING_BY_TIER[tier] ?? GRASS_SPACING_BY_TIER[QUALITY_TIER];
    // Blade count goes as the inverse square of spacing.
    const fraction = (GRASS_SPACING / target) ** 2;
    if (fraction > 1.001) {
      // More blades than were ever generated. Only reachable by loading at a
      // low tier and asking for a higher one.
      go({ quality: tier === 'auto' ? null : tier });
      return;
    }
    setGrassDensity(fraction);
    for (const [name, b] of Object.entries(tierButtons)) style(b, name === tier);
    tierLabel.textContent =
      `quality — built at ${GRASS_SPACING}, drawing ${Math.round(fraction * 100)}%`;
  };
  for (const t of ['low', 'medium', 'high']) {
    tierButtons[t] = button(tierRow, t, params.get('quality') === t, () => applyTier(t));
  }
  // Clearing the override is worth its own button: it's the only way to see
  // what the detection actually picks on this machine, which is the thing
  // most likely to be wrong.
  tierButtons.auto = button(tierRow, 'auto', !params.has('quality'), () =>
    applyTier('auto')
  );

  const grassRow = row(
    grassOn ? 'grass — on (slow reloads)' : 'grass — off (fast reloads)'
  );
  button(grassRow, 'off', !grassOn, () => go({ grass: null }));
  button(grassRow, 'on', grassOn, () => go({ grass: '' }));

  // The one row that acts immediately instead of reloading — rebuilding the
  // world to change camera would cost seconds and lose wherever you'd flown.
  const camRow = row('camera');
  let freeBtn;
  let fixedBtn;
  const setCam = (free) => {
    setDebugCamera(free);
    style(freeBtn, debugFreeFly);
    style(fixedBtn, !debugFreeFly);
  };
  freeBtn = button(camRow, 'free-fly', debugFreeFly, () => setCam(true));
  fixedBtn = button(camRow, 'fixed', !debugFreeFly, () => setCam(false));

  const whoRow = row('play as');
  button(whoRow, 'miranda', SPAWN_AS !== 'darla', () => go({ as: 'miranda' }));
  button(whoRow, 'darla', SPAWN_AS === 'darla', () => go({ as: 'darla' }));

  const shotRow = row('shot');
  button(shotRow, 'copy view url', false, () => {
    const url = globalThis.camView();
    navigator.clipboard?.writeText(url);
  });
  button(shotRow, 'leave debug', false, () => go({ debug: null, grass: null }));

  document.body.appendChild(panel);
}

// Image-based lighting from a real photographed sky (CC0, polyhaven.com) —
// gives every reflective/PBR material realistic ambient light and
// reflections instead of a synthetic room-interior approximation. Only used
// for scene.environment (reflections/ambient), not scene.background — the
// visible sky stays the flat fog color plus the hand-drawn sun sprite, so
// there isn't a second, photographic sun competing with the cartoon one.
const pmrem = new THREE.PMREMGenerator(renderer);
new RGBELoader().load(
  `${import.meta.env.BASE_URL}hdri/autumn_field_puresky_1k.hdr`,
  (hdrTexture) => {
    scene.environment = pmrem.fromEquirectangular(hdrTexture).texture;
    hdrTexture.dispose();
  }
);
// The HDRI itself is a bright midday sky, which is exactly right for
// daytime reflections but far too bright to contribute at full strength to
// a moonlit night — its contribution gets dialed down per mode below
// rather than swapping in a second (night) HDRI, since there isn't a good
// CC0 one on hand and reflections barely register at low weight anyway.
const MOON_DIRECTION = new THREE.Vector3(-65, 40, 100).normalize();
// Lower y here means a lower elevation in the sky (closer to the old,
// pre-fix look) — x/z stay the same so the azimuth (and the environment
// rotation computed from it below) doesn't shift.
// Daytime is a sunrise now, so this is a low sun in the northeast rather
// than the high west-northwest one it was.
//
// Compass, from terrainHeight's note in yard.js: +x is west and +z is
// north, so east is -x. A northeasterly sunrise is a summer one at this
// latitude, and it's where the owner pointed on a screenshot.
//
// Elevation is about 23 degrees. It was 12, which was a prettier light but
// put the disc down among the trunks — from anywhere in the yard the tree
// line subtends 11 to 29 degrees, so the sun spent most of the morning
// behind it. This clears the shorter two thirds of the tree line while
// staying low enough to keep the long shade and the warm colour.
//
// The constraint runs the other way, and only downward: shadow length goes
// as cot(elevation), so at 23 degrees a 10 m tree lays a 24 m shadow, well
// inside the 68 m shadow box (see SHADOW_HALF_EXTENT). It was 47 m at 12
// degrees and would be 71 m at 8 — past the box, with the far end of every
// shadow clipped off square. Raising is free; lowering is not.
const SUN_DIRECTION = new THREE.Vector3(-0.45, 0.47, 1.0).normalize();
// How far out in the sky the sun/moon sprites sit — reused for both so
// they read as the same "distant object in the sky", just in different
// directions. Matches the moon sprite's original fixed position.
const SKY_DISTANCE = 125.8;

// The HDRI's own baked-in sun sits at azimuth ~36.0°, elevation ~29.0°
// (found by scanning the actual .hdr pixel data for its brightest point).
// SUN_DIRECTION's azimuth is ~33.7° — already close — so this rotates the
// environment by the small remaining difference to line the photo's sun up
// with our cartoon one exactly. Elevation (~29° in the photo vs ~48° for
// SUN_DIRECTION) can't be corrected this way: environmentRotation only
// really works around Y for an equirect map, since rotating around X/Z
// would tip "up" away from up and break every reflection in the scene.
const HDRI_SUN_AZIMUTH = THREE.MathUtils.degToRad(36.0);
const sunAzimuth = Math.atan2(SUN_DIRECTION.z, SUN_DIRECTION.x);
const ENV_ROTATION_Y = sunAzimuth - HDRI_SUN_AZIMUTH;

// Day and night are just two sets of values for the same handful of
// lights/fog/exposure/sprite knobs — see applyDayNight below, which
// re-tunes them in place rather than destroying/recreating anything.
// Daytime is early morning: the sun is barely up, everything it touches is
// gold, and everything it doesn't is lit by a big cold sky instead. That
// split — warm key, cool fill — is most of what makes a sunrise read as one
// rather than as a scene with an orange filter over it, and it's why the
// fill light below got *stronger* as well as bluer.
const DAY_LIGHTING = {
  background: 0xf0c49c,
  // Haze, not distance. A low sun shines through a lot more atmosphere than
  // a high one, so morning air glows instead of just fading things out —
  // hence a warm fog colour rather than the sky's own blue, and a nearer
  // start than the old 18.
  fogColor: 0xe7bb95,
  // Well back from the 15/58 this started at. Warm haze is the right idea
  // and at that distance it was eating the subject: the tree line sits
  // 20-25 m from anywhere in the yard, so it was already half-dissolved
  // into a pale band, and the woods went from the best thing in the frame
  // to a white smear. Distant softening should start past the tree line,
  // not on it. (There's a standing queue item about fog washing out the
  // frontage — this is the same complaint, and these numbers help it.)
  fogNear: 30,
  fogFar: 92,
  exposure: 1.05,
  // The HDRI is a bright midday sky. At full strength its cool white
  // ambient sits on top of everything and argues with the warm key — the
  // yard came out looking like noon with an orange light pointed at it.
  envIntensity: 0.5,
  envRotationY: ENV_ROTATION_Y,
  sun: { color: 0xffb673, intensity: 2.6, direction: SUN_DIRECTION },
  // The cold half of the pair. Strong, because at sunrise the whole sky is
  // the fill light and shadows go blue rather than black.
  fill: { color: 0x93b9ec, intensity: 0.62 },
  // Ground colour is the light bouncing up off the lawn onto everything's
  // undersides. It was 0x6b8e4e — near the lawn's own green, and saturated
  // enough that on pale skin it landed squarely on olive: Miranda's underjaw
  // and collarbone came out looking bruised. Bounce light is always far less
  // saturated than the surface it bounced off, so this is both the fix and
  // the more correct value.
  hemi: { sky: 0x9dc0e8, ground: 0x9a8464, intensity: 0.55 },
  // The grass shader is hand-written and reads none of the lights above, so
  // it takes its own copy.
  grassLight: 0xffd9b0,
  // Over 1, and this is the single most sunrise-specific number in here.
  // Back-scatter is light coming *through* a blade rather than off it, and
  // it only happens when the sun is low enough to be behind the grass
  // instead of above it — which at 12 degrees it now always is. It's what
  // makes a lawn glow at dawn instead of just being lit.
  grassBackScatter: 1.45,
  // Cast shade on the grass. Deep, because a sunlit lawn next to real tree
  // shade is most of what makes a yard look like it's outdoors — and deeper
  // still at sunrise, where the shadows are enormous and are half the
  // composition.
  grassShadow: 0.6,
  // No moon rim by day — see the note on grassMoonGlow in NIGHT_LIGHTING.
  grassMoonGlow: 0,
  grassMoonColor: 0xb9cee2,
  // What the pond reflects by day. Cool and pale — a bright overcast
  // sky rather than the sunrise it's actually under. See setWaterLight.
  waterSky: 0x9ec6cf,
  // Lens glare when the camera looks toward the sun. See glarePass.
  glare: 1,
  glareColor: 0xffb066,
  sky: {
    // A sunrise sky is two skies. Near the sun it's molten; a quarter turn
    // away it's still the cold blue of before dawn, and overhead it's
    // deeper than either. `horizonSun` and `horizonAway` are those first
    // two, blended by how close a view ray is to the sun's compass bearing
    // (see sky.js) — a single horizon colour, which is what this had, can
    // only ever give a uniform band and reads as an orange filter.
    // Saturated well past what looks right as a swatch. Everything
    // downstream desaturates it: ACES tone mapping compresses the top end
    // toward white, bloom spreads the bright parts into the dark ones, and
    // the painterly grade adds its own warm lift. A horizon picked to look
    // correct in isolation arrives on screen as pale pink.
    horizon: 0xff8f3a,
    horizonAway: 0x4d6fae,
    zenith: 0x123c86,
    // Cloud tops catch the sun; everything else is in the earth's shadow
    // still. The gap between these two is what gives a dawn sky its drama.
    cloudLit: 0xffc38a,
    // Properly dark, and violet rather than grey. This is the earth's own
    // shadow on the underside of a cloud before the sun has cleared the
    // horizon, and it's the value everything bright is measured against —
    // a light shade colour costs more drama than a dim lit one does.
    cloudShade: 0x3f3f66,
    // Near the sun, thin cloud stops being lit and starts being
    // transparent — it goes hotter than white and blows out. This is that
    // colour, and it only applies within a few degrees of the sun.
    cloudHot: 0xffd08a,
    glow: 0xffb265,
    // Lower threshold = more cloud. Dropped from 0.52: a dawn sky with
    // scattered fair-weather cumulus wastes the light, and the interesting
    // thing about the reference shots is how much sky is cloud.
    coverage: 0.43,
    opacity: 0.97,
  },
};
const NIGHT_LIGHTING = {
  background: 0x060a18,
  fogColor: 0x0a1228,
  fogNear: 14,
  fogFar: 46,
  exposure: 0.85,
  envIntensity: 0.15,
  envRotationY: 0,
  sun: { color: 0xcdd8ff, intensity: 0.55, direction: MOON_DIRECTION },
  fill: { color: 0x4a5f8a, intensity: 0.15 },
  hemi: { sky: 0x1a2340, ground: 0x0d1a12, intensity: 0.25 },
  // Dim and cool. This is the fix for the lawn glowing at night: the shader
  // bakes daylight into every one of its colour terms, so without a tint to
  // multiply through it the grass simply stayed at noon while everything
  // else went dark.
  grassLight: 0x3d5178,
  // Back-scatter stays near nothing. Light coming *through* a blade is a sun
  // effect and at any real strength it lit the turf from the inside — the
  // moon's version of that is the rim term below, which is a different
  // thing and behaves itself.
  grassBackScatter: 0.1,
  // Raised from 0.28. Moonlight does cast real shadows and the tree line
  // throws good ones; at 0.28 they were barely present. Still well under
  // the day's 0.6, because past about 0.45 they stop reading as shade and
  // start reading as holes cut in the lawn.
  grassShadow: 0.4,
  // The ethereal bit: a cool rim on the blade tips, strongest where a blade
  // is edge-on to the moon. Nights in this game are the goth half of the
  // art direction and the lawn was simply going dark and staying there —
  // this is what makes it read as *moonlit* rather than as unlit.
  //
  // Zero by day, and not because it wouldn't show. It's the same silver
  // catchlight either way, but at noon it competes with real sunlight and
  // just looks like a shader artefact; it only reads as magic when it's
  // the brightest thing on the blade.
  // Both of these went down after a look. At 0.5 and a saturated cyan the
  // lawn read as radioactive rather than moonlit — the give-away being that
  // it was the most colourful thing in a night scene. Moonlight is
  // desaturated almost to grey; the tiny amount of blue left in it is the
  // whole effect, and any more turns it into a light source of its own.
  grassMoonGlow: 0.3,
  grassMoonColor: 0xb9cee2,
  // Dim and silver after dark, so the pond reads as water catching a
  // moon rather than a hole in the ground.
  waterSky: 0x44607e,
  sky: {
    // Night gets the same directional split the sunrise does. The earlier
    // note here said a moon isn't bright enough to colour a quadrant of sky
    // and set both horizons the same — which is true of the *ground* and
    // wrong about the sky. A moon absolutely lights the air around itself:
    // that's what a moon-dog is. It's just silver instead of gold, and the
    // effect lives or dies on being subtle.
    // Pulled down from a first pass that came out reading as dusk rather
    // than night — the moonward side was bright enough to be blue hour, and
    // the night here is meant to be the goth half of the art direction.
    // The *split* is what does the work, not the overall level.
    horizon: 0x2a4268,
    horizonAway: 0x0c1428,
    zenith: 0x04070e,
    // Moonlit cloud, not white — and dim enough that the starfield behind
    // still carries the night sky rather than being washed out by it.
    cloudLit: 0x4a5a88,
    // Properly dark, so the lit tops and rims have something to be lit
    // *against*. Cloud that's uniformly dim reads as fog.
    cloudShade: 0x0d1324,
    // Where thin cloud passing in front of the moon goes translucent. Much
    // closer to white than cloudLit, because that's genuinely what happens
    // — it's the one place at night anything gets bright.
    cloudHot: 0xa8bce4,
    glow: 0x7a9ace,
    // Thinner cover at night, so there's more open sky for the stars.
    coverage: 0.6,
    opacity: 0.8,
  },
  // A moon flare, at a third of the sun's weight and cool rather than warm.
  // Deliberately not "the same effect turned down": at full strength the
  // veil alone lifts the whole frame and undoes the darkness the rest of
  // this block is for. What survives at 0.34 is the halo and a hint of
  // streak, which is about what a real moon does to a lens.
  glare: 0.34,
  glareColor: 0x9fbdf2,
};

// One directional light doubles as both sun and moon — only its color,
// intensity, and direction change between modes — so shadows always fall
// as if actually cast by whichever one is currently in the sky, instead of
// from an unrelated fixed angle.
const sunMoonLight = new THREE.DirectionalLight();
sunMoonLight.castShadow = true;
sunMoonLight.shadow.mapSize.set(2048, 2048);

// How much ground the shadow map covers, as a half-width in metres, and how
// far back the light sits from the middle of it.
//
// Both of these were much smaller (a 28 m box, light 6 units out) and both
// were wrong in ways that only showed up once the woods had real trees in
// them:
//
//   * The light sitting 6 units from its target put the shadow camera's
//     near plane *inside the scene*. Anything more than about 4 m tall
//     directly beneath it was in front of the near plane and simply stopped
//     casting — which is every tree in the new forest. Pulling the light
//     well back and pushing `far` out costs nothing (an orthographic
//     frustum has no perspective to lose) and fixes it outright.
//   * A 28 m box is barely wider than the yard, and it was centred on the
//     world origin rather than on the player, so the tree line's shadow
//     could never reach the lawn.
//
// 26 m half-width is a 52 m box: the whole clearing plus the tree line on
// every side, so the woods throw shade onto the grass from wherever the sun
// happens to be. Bigger than the old 28 m box on the same 2048 map, i.e.
// less resolution per metre — see the texel snapping below, which matters
// more than the raw number does.
//
// Down from 34, on measurement. The shadow pass is 320 of the frame's 474
// draw calls and re-renders the whole woods; at ±34 it was pulling in trees
// far enough away that fog has started eating them. Each step down is worth
// roughly 25 draw calls, and ±26 is the point where it stops without
// leaving visibly unshadowed trees in the middle distance — the sun sits at
// 23°, so a 10 m tree lays a 24 m shadow, and the box has to hold both the
// tree and the shadow to show it at all.
const SHADOW_HALF_EXTENT = 26;
const SHADOW_LIGHT_DISTANCE = 90;
sunMoonLight.shadow.camera.left = -SHADOW_HALF_EXTENT;
sunMoonLight.shadow.camera.right = SHADOW_HALF_EXTENT;
sunMoonLight.shadow.camera.top = SHADOW_HALF_EXTENT;
sunMoonLight.shadow.camera.bottom = -SHADOW_HALF_EXTENT;
sunMoonLight.shadow.camera.near = 1;
sunMoonLight.shadow.camera.far = SHADOW_LIGHT_DISTANCE * 2;
// Normal bias does the work that a flat depth bias can't: it offsets along
// the surface normal, so a steeply lit slope stops shadow-acneing without
// needing a constant bias big enough to detach every shadow from its
// caster. Branch geometry is the worst case for this — thin tubes at every
// angle at once — and it's why the flat bias could come *down* from 0.0015.
sunMoonLight.shadow.bias = -0.0004;
sunMoonLight.shadow.normalBias = 0.035;
scene.add(sunMoonLight);
scene.add(sunMoonLight.target);

// Keeps the shadow box centred on whoever's being played, so shade exists
// wherever she is rather than only near the origin.
//
// The snapping is not optional. A shadow map that slides continuously with
// the player makes every shadow edge crawl and shimmer as she walks, because
// each frame lands the same edge on a different part of the texel grid.
// Quantising the box's centre to whole texels means the map moves in exact
// texel steps and the shadows sit still.
const SHADOW_TEXEL = (SHADOW_HALF_EXTENT * 2) / 2048;
const _shadowCenter = new THREE.Vector3();
const _shadowDir = new THREE.Vector3();
const _shadowRight = new THREE.Vector3();
const _shadowUp = new THREE.Vector3();
const WORLD_UP = new THREE.Vector3(0, 1, 0);
// applyDayNight runs once before `player` is assigned, so it needs
// something to centre on that isn't her.
const ORIGIN = new THREE.Vector3();
function updateShadowCamera(target) {
  _shadowDir.copy(sunMoonLight.userData.direction ?? SUN_DIRECTION).normalize();
  // The shadow map's own axes, which are the ones the quantising has to
  // happen in. Snapping the centre to whole metres of *world* x and z looks
  // like it should work and doesn't: the map is laid out along the light's
  // right and up, so a step that's a whole texel in world space lands
  // part-way across a texel in the map, and the edges crawl exactly as if
  // nothing had been snapped at all.
  _shadowRight.crossVectors(WORLD_UP, _shadowDir).normalize();
  _shadowUp.crossVectors(_shadowDir, _shadowRight).normalize();

  _shadowCenter.set(target.x, 0, target.z);
  // Decompose onto that basis, round the two lateral components to whole
  // texels, and rebuild. The along-light component is carried through
  // untouched — it doesn't move anything across the map.
  const snap = (v) => Math.round(v / SHADOW_TEXEL) * SHADOW_TEXEL;
  const alongRight = snap(_shadowCenter.dot(_shadowRight));
  const alongUp = snap(_shadowCenter.dot(_shadowUp));
  const alongDir = _shadowCenter.dot(_shadowDir);
  _shadowCenter
    .copy(_shadowRight)
    .multiplyScalar(alongRight)
    .addScaledVector(_shadowUp, alongUp)
    .addScaledVector(_shadowDir, alongDir);

  sunMoonLight.target.position.copy(_shadowCenter);
  sunMoonLight.target.updateMatrixWorld();
  sunMoonLight.position
    .copy(_shadowDir)
    .multiplyScalar(SHADOW_LIGHT_DISTANCE)
    .add(_shadowCenter);
  sunMoonLight.updateMatrixWorld();
  // Derive the shadow matrix now rather than letting the renderer do it
  // during its shadow pass. The grass samples that matrix by hand (it's a
  // raw ShaderMaterial — see setGrassShadow), and taking whatever the
  // renderer left behind last frame would hand it a matrix one frame stale:
  // every shadow would lag the light by a frame and swim as the box moves.
  sunMoonLight.shadow.updateMatrices(sunMoonLight);
  setGrassShadow(
    sunMoonLight.shadow.map ? sunMoonLight.shadow.map.texture : null,
    sunMoonLight.shadow.matrix,
    shadowStrength
  );
}

// How dark cast shade goes on the grass, per mode. Hard tree shadows carry
// the sunlit yard; under a moon the same weight reads as holes in the lawn.
let shadowStrength = 0.55;

// Set by applyDayNight, consumed by updateSunGlare — see the note there for
// why these can't be written into the pass directly.
let glareStrength = 0;
let glareColor = null;

const fillLight = new THREE.DirectionalLight();
fillLight.position.set(-4, 2, -3);
scene.add(fillLight);

// Sky-to-ground ambient light, so shaded surfaces (the underside of the
// roof overhang, walls facing away from the sun/moon) don't just go flat
// and grey.
const hemiLight = new THREE.HemisphereLight();
scene.add(hemiLight);

// Yard: lawn, house, tree line, and fire pit
const yard = createYard();
scene.add(yard);

// Darla — parked on the opposite side of the fire pit from Mom (mirrored
// across its center) so when she's the idle NPC she reads as part of the
// same fireside scene instead of standing alone off at the origin.
//
// Both of them sit 1.35 out from the pit's centre, which is 0.35 clear of the
// radius it blocks at. They originally started at 1.08 — only 8cm clear, close
// enough that the first step in any direction shoved them. The offsets are
// kept by hand rather than derived from FIRE_PIT so their facings stay
// readable next to the numbers; if the pit moves again, move these with it.
const darla = createDarla();
darla.position.set(0.42, 0, 10.95);
darla.rotation.y = 0.7 + Math.PI;
scene.add(darla);

// The loading screen's dog is this exact model, shot side-on right here. Has
// to be after she's built and after the renderer exists, and it wants to be
// before generateWorld — which it is by a wide margin, since the whole tail of
// construction below still costs less than one grass chunk.
setLoadingModel(renderer, darla);

// A soft glow that follows her everywhere — now that it's actually dark,
// this is what lets you see her and the ground immediately around her.
// Added as a child of Darla so it tracks her position/rotation for free,
// with no shadow casting (a shadow-casting point light renders 6 shadow
// faces instead of 1 — not worth it for a small ambient glow, and keeps
// this cheap enough for phones).
const darlaGlow = new THREE.PointLight(0xbfd4ff, 2.2, 6, 2);
darlaGlow.position.set(0, 1, 0);
darla.add(darlaGlow);

// Darla's mom, hanging out by the fire pit
const mom = createMom();
// y from the terrain, not 0. Her height is only ever recomputed while she's
// walking to a poop (see updateMomWalk) or landing out of flight, so a
// literal 0 left her standing 2.4 m under the graded pad — buried, and
// completely invisible for the whole game unless something made her move.
// Playing *as* her hid the bug, because the player movement path re-grounds
// her every frame; it only showed up when Darla was the one being driven.
// Mirrored across the pit from Darla, and moved back with her — see the note
// on darla.position above. MOM_HOME is taken from this, so the spot she walks
// back to after collecting a poop moves with it.
mom.position.set(-1.82, terrainHeight(-1.82, 9.45), 9.45);
mom.rotation.y = 0.7;
scene.add(mom);

// The day/night fade draws her portrait rather than her model, so this only
// needs the canvas to exist — no capture, and nothing here depends on `mom`.
initNightTransition();

// Hover highlight for click-to-interact targets (Darla/Miranda/hammock): a
// soft yellow glow sprite floating around them, rather than tinting their
// own materials (reads as the whole body changing color, not a highlight
// around it) or a true silhouette outline (which would need to track every
// animated limb's rotation each frame to stay in sync as they walk/idle).
// One shared radial-gradient texture, additive-blended so it reads as a
// glow rather than a flat colored card, and reused across every target.
function createGlowTexture() {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, 'rgba(255, 221, 51, 0.9)');
  gradient.addColorStop(0.5, 'rgba(255, 221, 51, 0.35)');
  gradient.addColorStop(1, 'rgba(255, 221, 51, 0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(canvas);
}
const glowTexture = createGlowTexture();

// width/height size the billboard to roughly envelop the target's
// silhouette; yOffset centers it vertically since each parent's own local
// origin sits at their feet/base, not their middle.
function createHoverGlow(width, height, yOffset) {
  const material = new THREE.SpriteMaterial({
    map: glowTexture,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
  });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(width, height, 1);
  sprite.position.y = yOffset;
  sprite.visible = false;
  return sprite;
}

// Some things are only obviously interactive once you've already tried
// clicking them. The hammock and the roof ladder both look like scenery, so
// they get the same glow the hover targets use, except permanently on and
// breathing gently — a static one stops registering as a signal after about
// a minute and just becomes part of the object.
//
// They're driven together in the frame loop rather than each animating
// itself, so the pulse stays in phase across the yard instead of two
// objects throbbing against each other.
const idleGlows = [];
function addIdleGlow(target, width, height, yOffset) {
  const glow = createHoverGlow(width, height, yOffset);
  glow.visible = true;
  target.add(glow);
  idleGlows.push(glow);
  return glow;
}
function updateIdleGlows(elapsed) {
  const pulse = 0.52 + 0.28 * Math.sin(elapsed * 1.7);
  for (const glow of idleGlows) {
    // The glow's whole job is "you can interact with this". Once you're
    // already in the hammock it has nothing left to say, and it sits right
    // in front of a first-person camera pointed at the sky.
    glow.visible = !(glow.userData.hideWhenLounging && mirandaLounging);
    glow.material.opacity = glow.userData.hovered ? 1 : pulse;
  }
}

// ── the cursor ─────────────────────────────────────────────────────────
//
// A paw print, because it's a game about a dog.
//
// Two states, not one. The pointer already changes over anything you can
// click (Miranda, Darla, the hammock, a poop), and that hover feedback is
// worth more than the novelty — so rather than replace it with a single
// paw that ignores it, there's a resting paw and a lit one. Losing the
// hover cue to gain a cute cursor would be a bad trade.
//
// Drawn to a canvas and handed over as a data URI, the same way the
// favicon and every texture in this project are made. 32 px because
// browsers quietly refuse cursors much above that on some platforms, and a
// refused cursor falls back to the system arrow with no warning.
function makePawCursor(active) {
  const S = 32;
  const c = document.createElement('canvas');
  c.width = S;
  c.height = S;
  const ctx = c.getContext('2d');

  // A dark outline under everything, so the paw stays visible against both
  // the lawn and the night sky. A cursor that vanishes over half the scene
  // is worse than no cursor.
  const draw = (fill, stroke, grow) => {
    ctx.fillStyle = fill;
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 2;
    // Main pad — a rounded triangle-ish blob, widest at the bottom.
    ctx.beginPath();
    ctx.ellipse(16, 21.5, 6.6 + grow, 5.7 + grow, 0, 0, Math.PI * 2);
    ctx.fill();
    if (stroke) ctx.stroke();
    // Four toes, fanned. The outer two are smaller and set lower, which is
    // what makes it read as a paw rather than a flower.
    // Spacing matters more than size here. The first pass had the inner two
    // toes at x=13 and x=19 with rx=3.1, which overlap outright — before the
    // outline pass grows them further — so the four toes fused into one bar
    // and the whole thing read as a bear head. These are spread until the
    // *fills* clear each other; the dark pass underneath still merges, which
    // is what a real print's shadow does anyway.
    [
      [6.4, 13.2, 2.6, 3.1, -0.4],
      [12.6, 8.6, 2.7, 3.3, -0.14],
      [19.4, 8.6, 2.7, 3.3, 0.14],
      [25.6, 13.2, 2.6, 3.1, 0.4],
    ].forEach(([x, y, rx, ry, rot]) => {
      ctx.beginPath();
      ctx.ellipse(x, y, rx + grow, ry + grow, rot, 0, Math.PI * 2);
      ctx.fill();
      if (stroke) ctx.stroke();
    });
  };

  // Outline pass first, then the fill on top of it.
  draw('rgba(30,22,18,0.9)', null, 1.3);
  draw(active ? '#ffd24a' : '#fdf3ea', null, 0);

  // Hotspot in the middle of the main pad — that's where the paw looks like
  // it is touching, and a hotspot anywhere else makes clicking feel offset.
  return `url(${c.toDataURL('image/png')}) 16 21, auto`;
}

// Off for now, at the owner's request — back to the system cursor.
//
// Left as a switch rather than deleted, because "for now" is what was asked.
// Flip this to true and the paw comes back everywhere it was: the two states
// below become the paw pair instead of the system's, so every call site
// downstream works either way without knowing which is in play.
const PAW_CURSOR = false;

const CURSOR_PAW = PAW_CURSOR ? makePawCursor(false) : '';
const CURSOR_PAW_ACTIVE = PAW_CURSOR ? makePawCursor(true) : 'pointer';
renderer.domElement.style.cursor = CURSOR_PAW;

if (PAW_CURSOR) {
  // The paw covers the HUD too, not just the canvas. Leaving the buttons on
  // the system hand would mean the cursor changed species halfway up the
  // screen — so the same two states apply there: lit paw over anything
  // clickable, resting paw everywhere else. Done as an injected rule rather
  // than by editing each button's CSS, since the data URI only exists at
  // runtime and this way it also covers buttons added later.
  //
  // !important, and not out of laziness: the existing rules in index.html
  // are hung off ids and classes (#mp-corner-button, #mp-menu button,
  // .character-card), so a plain `button` selector loses the specificity
  // contest against every one of them and the paw would silently not apply.
  const cursorStyle = document.createElement('style');
  cursorStyle.textContent =
    `body { cursor: ${CURSOR_PAW}; }\n` +
    `button, [role="button"], .character-card { cursor: ${CURSOR_PAW_ACTIVE} !important; }`;
  document.head.appendChild(cursorStyle);
}

const momGlow = createHoverGlow(1.1, 1.9, 0.75);
mom.add(momGlow);
let momHovered = false;
function setMomHover(hovered) {
  if (hovered === momHovered) return;
  momHovered = hovered;
  momGlow.visible = hovered;
  renderer.domElement.style.cursor = hovered ? CURSOR_PAW_ACTIVE : CURSOR_PAW;
}

// Same hover-highlight idiom, mirrored for Darla so Miranda can click on
// her to talk too.
const darlaHoverGlow = createHoverGlow(1.0, 0.85, 0.42);
darla.add(darlaHoverGlow);
let darlaHovered = false;
function setDarlaHover(hovered) {
  if (hovered === darlaHovered) return;
  darlaHovered = hovered;
  darlaHoverGlow.visible = hovered;
  renderer.domElement.style.cursor = hovered ? CURSOR_PAW_ACTIVE : CURSOR_PAW;
}

// Character-select portraits — simple hand-drawn 2D faces using each
// character's own palette (copied from darla.js/mom.js), rather than
// rendering an actual 3D snapshot, since a plain canvas face reads more
// clearly at icon size and doesn't need a second render pass at startup.
function drawDarlaPortrait(ctx, size) {
  const c = size / 2;
  ctx.clearRect(0, 0, size, size);
  ctx.save();
  ctx.translate(c, c);

  // Floppy ears
  ctx.fillStyle = '#a9855c';
  [-1, 1].forEach((side) => {
    ctx.beginPath();
    ctx.ellipse(side * c * 0.62, -c * 0.1, c * 0.22, c * 0.42, side * 0.35, 0, Math.PI * 2);
    ctx.fill();
  });

  // Head
  ctx.fillStyle = '#c4a074';
  ctx.beginPath();
  ctx.arc(0, 0, c * 0.72, 0, Math.PI * 2);
  ctx.fill();

  // Muzzle
  ctx.fillStyle = '#f1e8d9';
  ctx.beginPath();
  ctx.ellipse(0, c * 0.32, c * 0.36, c * 0.26, 0, 0, Math.PI * 2);
  ctx.fill();

  // Nose
  ctx.fillStyle = '#1c1712';
  ctx.beginPath();
  ctx.ellipse(0, c * 0.22, c * 0.09, c * 0.06, 0, 0, Math.PI * 2);
  ctx.fill();

  // Eyes
  [-1, 1].forEach((side) => {
    ctx.beginPath();
    ctx.arc(side * c * 0.26, -c * 0.06, c * 0.07, 0, Math.PI * 2);
    ctx.fill();
  });

  ctx.restore();
}

drawDarlaPortrait(document.getElementById('portrait-darla').getContext('2d'), 128);
// Her daytime face — bare-eyed, warm ground, no sparkles. The night version of
// the same drawing is what the day/night fade transforms into; see
// portrait-miranda.js and transition.js.
drawMirandaFace(document.getElementById('portrait-miranda').getContext('2d'), 128, { night: 0 });

// Same two portraits, small and overlapping, standing in for a generic
// "two players" icon on the multiplayer button — reuses the exact same
// drawing functions rather than a separate composited image.
drawMirandaFace(document.getElementById('mp-icon-miranda').getContext('2d'), 32, { night: 0 });
drawDarlaPortrait(document.getElementById('mp-icon-darla').getContext('2d'), 32);

// Favicon: Darla's same hand-drawn portrait, just rendered small — reuses
// the character-select artwork instead of needing a separate image asset.
const faviconCanvas = document.createElement('canvas');
faviconCanvas.width = 64;
faviconCanvas.height = 64;
drawDarlaPortrait(faviconCanvas.getContext('2d'), 64);
document.getElementById('favicon').href = faviconCanvas.toDataURL('image/png');

// Which character is currently being controlled — chosen on the select
// screen below. Everything player-movement-related (WASD/click-to-move,
// jump, camera follow, walk-cycle animation) reads from `player` rather
// than hardcoding Darla, so either character can actually be driven by
// input. Darla-only mechanics (moo/poop/dress/fetch) stay hardcoded to
// `darla` — they're simply never reachable in Miranda mode, since her
// action buttons are hidden by the .miranda-mode CSS class.
let player = darla;
let playerKind = 'darla'; // 'darla' | 'miranda'
let gameStarted = false;

// Two-player mode: each browser fully simulates only the character it's
// been assigned (100% the same single-player code as below — no separate
// networked movement path), and mirrors whatever the peer sends for the
// *other* character instead of running her AI. See applyRemoteState /
// sendNetworkState further down for the actual sync.
let isMultiplayer = false;
let isHost = false;

function startGame(kind) {
  playerKind = kind;
  player = kind === 'darla' ? darla : mom;
  gameStarted = true;
  document.body.classList.add('game-started');
  document.body.classList.toggle('miranda-mode', kind === 'miranda');
  document.body.classList.toggle('multiplayer-mode', isMultiplayer);
  document.getElementById('mp-menu').classList.add('hidden');
  document.getElementById('character-select').classList.add('hidden');

  // Drop the player straight onto ?at= if it was given. Done here rather
  // than at construction so it applies to whichever character was actually
  // chosen, and after gameStarted so nothing resets it back.
  if (SPAWN_AT) {
    player.position.set(SPAWN_AT.x, terrainHeight(SPAWN_AT.x, SPAWN_AT.z), SPAWN_AT.z);
  }

  if (SPAWN_CAM) {
    // Target first: OrbitControls derives its own spherical state from
    // wherever camera.position and target actually are, so setting the
    // target after the position would leave the angles pointing at the old
    // one until something else moved the camera.
    controls.target.set(player.position.x, 0.5, player.position.z);
    const offset = new THREE.Vector3().setFromSpherical(
      new THREE.Spherical(
        SPAWN_CAM.radius,
        THREE.MathUtils.degToRad(SPAWN_CAM.phi),
        THREE.MathUtils.degToRad(SPAWN_CAM.theta)
      )
    );
    camera.position.copy(controls.target).add(offset);
    controls.update();
  }
}

// Hand back the URL that reproduces whatever is on screen right now. Position
// the view by hand, run this in the console, and the link is exact — which is
// the half that made ?at= awkward on its own.
globalThis.camView = () => {
  const n = (v, d = 2) => Number(v.toFixed(d));
  const base = `${location.origin}${location.pathname}`;
  const at = `?at=${n(player?.position.x ?? 0)},${n(player?.position.z ?? 0)}`;
  const as = playerKind === 'miranda' ? '&as=miranda' : '';

  // Debug's camera flies free of the player, so an orbit around them can't
  // describe it — the orbit target is parked a fixed few metres ahead of the
  // lens and ?cam= would always come back as that same short radius. Its own
  // position and heading are the only thing that round-trips.
  if (debugFreeFly) {
    const url =
      `${base}?debug${at.replace('?', '&')}${as}` +
      `&eye=${n(camera.position.x)},${n(camera.position.y)},${n(camera.position.z)}` +
      `&look=${n(THREE.MathUtils.radToDeg(debugYaw), 1)},` +
      `${n(THREE.MathUtils.radToDeg(debugPitch), 1)}`;
    console.log(url);
    return url;
  }

  const sph = new THREE.Spherical().setFromVector3(
    camera.position.clone().sub(controls.target)
  );
  const url =
    `${base}${at}&cam=${n(sph.radius)},` +
    `${n(THREE.MathUtils.radToDeg(sph.phi), 1)},` +
    `${n(THREE.MathUtils.radToDeg(sph.theta), 1)}${as}`;
  console.log(url);
  return url;
};

document.getElementById('pick-darla').addEventListener('click', () => {
  startGame('darla');
  if (isHost) net.send({ t: 'assign', hostKind: 'darla' });
});
document.getElementById('pick-miranda').addEventListener('click', () => {
  startGame('miranda');
  if (isHost) net.send({ t: 'assign', hostKind: 'miranda' });
});

// Debug mode and ?at= both skip the menus entirely — see DEBUG_MODE above.
// Both honour ?as=, which matters more than it looks: debug used to force
// Darla, so anything Miranda-only (the hammock, the shovel, her skills) had
// to be tested in normal mode, which loads the full grass field and turns
// every reload into a ~6 second wait.
//
// Miranda is the default because she's who most of the interactive work is
// on — the hammock, the shovel, the skill buttons. `&as=darla` for the dog.
if (DEBUG_MODE || SPAWN_AT) startGame(SPAWN_AS === 'darla' ? 'darla' : 'miranda');

// --- Multiplayer lobby (mode-select screen, before character-select) ----
const mpMenuEl = document.getElementById('mp-menu');
const mpHostPanelEl = document.getElementById('mp-host-panel');
const mpJoinPanelEl = document.getElementById('mp-join-panel');
const mpHostCodeEl = document.getElementById('mp-host-code');
const mpHostShareBtn = document.getElementById('mp-host-share');
const mpHostStatusEl = document.getElementById('mp-host-status');
const mpJoinStatusEl = document.getElementById('mp-join-status');
const mpJoinCodeInput = document.getElementById('mp-join-code');
const characterSelectTitleEl = document.getElementById('character-select-title');

// Native OS share sheet (texting/AirDrop/Messenger/etc. right over the
// game) instead of "copy the code, switch apps, paste it" — much less time
// with the tab backgrounded, so much less chance of the signaling
// connection getting suspended before your friend connects. Falls back to
// the code just being plain selectable text (see #mp-host-code's
// user-select: all) on browsers without the Web Share API, mainly desktop.
if (navigator.share) {
  mpHostShareBtn.addEventListener('click', () => {
    navigator
      .share({ title: 'Puppy Run', text: `Join my Puppy Run game! Code: ${mpHostCodeEl.textContent}` })
      .catch(() => {}); // cancelling the share sheet isn't an error worth surfacing
  });
}

function showLobbyChoices() {
  net.disconnect();
  isMultiplayer = false;
  isHost = false;
  mpHostPanelEl.classList.add('hidden');
  mpJoinPanelEl.classList.add('hidden');
  mpHostShareBtn.style.display = 'none';
  mpHostStatusEl.textContent = 'Generating code…';
  mpJoinStatusEl.textContent = '';
  mpJoinCodeInput.value = '';
}

function goToCharacterSelect(title) {
  characterSelectTitleEl.textContent = title;
  mpMenuEl.classList.add('hidden');
  document.getElementById('character-select').classList.remove('hidden');
}

// Character-select is the default first screen now (solo is the common
// case); this corner button is the door into the host/join lobby instead
// of multiplayer being the very first choice you have to get past.
document.getElementById('mp-corner-button').addEventListener('click', () => {
  document.getElementById('character-select').classList.add('hidden');
  mpMenuEl.classList.remove('hidden');
});

document.getElementById('mp-choices-back').addEventListener('click', () => {
  goToCharacterSelect('Who do you want to play as?');
});

document.getElementById('mp-host').addEventListener('click', () => {
  mpHostPanelEl.classList.remove('hidden');
  isHost = true;
  net.hostGame();
});

document.getElementById('mp-host-cancel').addEventListener('click', showLobbyChoices);

document.getElementById('mp-join').addEventListener('click', () => {
  mpJoinPanelEl.classList.remove('hidden');
});

document.getElementById('mp-join-cancel').addEventListener('click', showLobbyChoices);

document.getElementById('mp-join-connect').addEventListener('click', () => {
  const code = mpJoinCodeInput.value.trim();
  if (!code) return;
  isHost = false;
  mpJoinStatusEl.textContent = 'Connecting…';
  net.joinGame(code);
});

net.onHostReady((id) => {
  mpHostCodeEl.textContent = id;
  if (navigator.share) mpHostShareBtn.style.display = '';
  mpHostStatusEl.textContent = 'Waiting for a friend to connect…';
});

// The signaling link (not the eventual game connection itself) dropped —
// almost always a backgrounded phone tab getting suspended while its code
// was being shared elsewhere. net.js retries automatically the moment the
// tab's visible again; this is purely the "hang on…" message while that
// happens rather than a hard failure.
net.onSignalingLost(() => {
  if (!mpHostPanelEl.classList.contains('hidden')) {
    mpHostStatusEl.textContent = 'Connection interrupted — reconnecting…';
  }
  if (!mpJoinPanelEl.classList.contains('hidden')) {
    mpJoinStatusEl.textContent = 'Connection interrupted — reconnecting…';
  }
});

net.onPeerConnected(() => {
  isMultiplayer = true;
  if (isHost) {
    goToCharacterSelect("You're hosting! Pick your character — your friend gets the other one.");
  } else {
    mpJoinStatusEl.textContent = "Connected! Waiting for the host to pick a character…";
  }
});

net.onPeerDisconnected(() => {
  if (gameStarted) {
    // Mid-game disconnect: simplest recovery is a reload back to the lobby
    // rather than trying to gracefully hand the remote character back to
    // AI control (which doesn't exist for a mid-match handoff).
    window.location.reload();
    return;
  }
  isMultiplayer = false;
  mpJoinStatusEl.textContent = 'Connection lost.';
  mpHostStatusEl.textContent = 'Connection lost.';
});

net.onPeerError((err) => {
  console.error('Peer error:', err);
  mpJoinStatusEl.textContent = "Couldn't connect — check the code and try again.";
  mpHostStatusEl.textContent = 'Something went wrong — try again.';
});

net.onMessage((msg) => {
  if (msg.t === 'assign') {
    // Only the joiner ever receives this — the host is the one who sent
    // it, right after picking their own character above.
    const myKind = msg.hostKind === 'darla' ? 'miranda' : 'darla';
    startGame(myKind);
    return;
  }
  if (msg.t === 'state') {
    applyRemoteState(msg);
    return;
  }
  if (msg.t === 'daynight') {
    applyRemoteDayNight(msg.isDay);
    return;
  }
  if (msg.t === 'fx') {
    applyRemoteFx(msg);
    return;
  }
  if (msg.t === 'command') {
    applyRemoteCommand(msg.name, msg.poopId);
  }
});

// Small one-shot cosmetic events (sounds, speech bubbles) — either side can
// fire these when its own local player triggers something, so the peer's
// screen plays/shows the same thing instead of going silent for the other
// character's actions.
function sendFx(name, extra) {
  if (isMultiplayer) net.send({ t: 'fx', name, ...extra });
}

// Unlike fx (pure cosmetic replay), commands actually drive state
// transitions on whichever client receives them — see applyRemoteCommand.
// Flows both ways: Miranda's client sends the "start" commands (fetch,
// cheese, call, leash), Darla's client sends the matching "done" commands
// back once her own local errand actually finishes, since only she knows
// that (see updateDarlaFetch/updateDarlaCheese).
function sendCommand(name, extra) {
  if (isMultiplayer) net.send({ t: 'command', name, ...extra });
}

// Skills that used to just directly move `darla` (fetch, cheese, call,
// leash) are built on "the other character is an AI companion" — with a
// real second player driving Darla instead, only *her own* client can be
// the one to actually move her (see the darlaCommandable gate in animate),
// so these commands are what tells her client to start, using whatever
// state (ball/cheese position, mom's position) is already kept in sync the
// normal way. The "done" commands flow the opposite direction, so
// Miranda's client knows to release its own button/guard state again —
// it can't derive that on its own since it doesn't simulate Darla locally.
function applyRemoteCommand(name, poopId) {
  if (name === 'fetchStart') {
    darlaFetchState = 'fetching';
  } else if (name === 'cheeseStart') {
    darlaCheeseState = 'going';
  } else if (name === 'callDarla') {
    darlaFetchState = 'returning';
  } else if (name === 'leashOn') {
    setDarlaLeashed(true);
  } else if (name === 'leashOff') {
    setDarlaLeashed(false);
  } else if (name === 'ballGrabbed') {
    // Fires the moment Darla's client reaches the ball (fetching ->
    // returning), well before fetchDone — resetting Miranda's own local
    // ball.visible here too so it actually stays hidden for the whole
    // walk back, not just flash away and reappear on her next sync.
    ball.visible = false;
  } else if (name === 'fetchDone') {
    darlaFetchState = 'idle';
    ballState = 'idle';
    // Miranda's client is what actually broadcasts ball.visible each tick
    // (see sendNetworkState) — without resetting her own local copy here
    // too, she'd keep insisting it's still visible on every subsequent
    // sync, overwriting the false Darla's client already set the moment
    // she grabbed it (see updateDarlaFetch) right back to true.
    ball.visible = false;
    ballButton.disabled = false;
    ballButton.classList.remove('disabled');
  } else if (name === 'cheeseDone') {
    cheeseState = 'idle';
    // Miranda's own local darlaCheeseState never got reset here before —
    // it's what every skill's guard (throwBallTo, throwCheeseTo, call,
    // leash) checks is 'idle' before allowing anything, so leaving it
    // stuck at 'going' silently blocked all of them after just one throw.
    // fetchDone (above) already did this correctly for darlaFetchState;
    // this one was just missed.
    darlaCheeseState = 'idle';
    // Same reasoning as ball.visible above — this is what was making the
    // cheese never actually disappear once Darla finished eating it.
    cheese.visible = false;
    cheeseButton.disabled = false;
    cheeseButton.classList.remove('disabled');
  } else if (name === 'poopPicked') {
    // Only Darla's client holds the real `poops` array — Miranda clicking
    // a poop she only has a remote-rendered copy of (see reconcileRemote
    // Poops) already shrinks/removes *that* copy locally on her own
    // client the instant she picks it up (updateMomPickup doesn't care
    // which array a poop came from); this is what makes the *authoritative*
    // copy actually shrink/disappear too, so it doesn't just reappear on
    // the next sync.
    const poop = poops.find((p) => p.userData.id === poopId);
    if (poop) removeOrShrinkPoop(poop);
  }
}

// A finite world: the yard, then a bounded ring of woods reaching out to
// roughly where the fog already hides everything (see scene.fog/DAY_FOG/
// NIGHT_FOG's far values below — 55 is comfortably past the longer of the
// two, so the tree line never visibly stops short in either lighting
// state) — walking to the edge reads as wandering into the fog, not
// hitting an arbitrary wall. Generated once, here, rather than streamed in
// and disposed as she moves, which is what actually frees up the budget
// spent on denser grass below (see createGrassField/createChunkGrass) —
// a fixed, known total tree/grass count instead of an ever-growing one.
const WORLD_RADIUS = 55;
// Chunks are generated on the same CHUNK_SIZE grid either way; this just
// picks how far out on that grid to even consider before filtering by the
// actual circular WORLD_RADIUS below — corner chunks of the square grid
// that fall outside that circle are skipped entirely, since nothing can
// ever walk out to them anyway (see the movement clamp near
// clampToWalkable).
const CHUNK_GRID_RADIUS = Math.ceil(WORLD_RADIUS / CHUNK_SIZE) + 1;

// Async purely so the loading screen can breathe between chunks — the work
// itself is the same synchronous per-chunk build it always was. The chunk list
// is collected up front rather than built inside the loops so the progress
// fraction has a real denominator instead of a guess.
async function generateWorld() {
  const pending = [];
  for (let cx = -CHUNK_GRID_RADIUS; cx <= CHUNK_GRID_RADIUS; cx++) {
    for (let cz = -CHUNK_GRID_RADIUS; cz <= CHUNK_GRID_RADIUS; cz++) {
      const centerX = cx * CHUNK_SIZE + CHUNK_SIZE / 2;
      const centerZ = cz * CHUNK_SIZE + CHUNK_SIZE / 2;
      if (Math.hypot(centerX, centerZ) > WORLD_RADIUS) continue;
      pending.push([cx, cz]);
    }
  }

  for (let i = 0; i < pending.length; i++) {
    scene.add(createTreeChunk(pending[i][0], pending[i][1]));
    setLoadingProgress(
      LOAD_WORLD_FROM + (LOAD_WORLD_TO - LOAD_WORLD_FROM) * ((i + 1) / pending.length)
    );
    // One frame per chunk. At ~30 chunks that's roughly half a second added to
    // a ~9s load, which buys the only visible progress there is — each chunk
    // is a couple of hundred milliseconds of solidly blocked main thread, so
    // yielding any less often means a screen that just sits there.
    await nextFrame();
  }
}

setLoadingProgress(LOAD_WORLD_FROM);
await generateWorld();

// A surprised little moon, hand-drawn onto a canvas texture and billboarded
// so it always faces the camera. Pale and soft-edged with a gentle glow
// halo rather than rayed like the old sun — moonlight glows, it doesn't beam.
function makeMoonTexture() {
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const c = size / 2;
  ctx.translate(c, c);

  // The aureole, same construction as the sun's and for the same reason: a
  // moon is a small hard disc, and everything that makes it *feel* like a
  // moon is the halo of scattered light around it. Stops close together
  // near the middle and far apart toward the edge, because the falloff is
  // roughly inverse-square and a linear ramp reads as a flat grey plate.
  //
  // Cool, and only slightly so — moonlight is sunlight, and painting it
  // properly blue is the mistake that makes a night scene look like a
  // daylight one with a filter on. The blue belongs in what it *lights*
  // (see NIGHT_LIGHTING), not in the source.
  const haloR = size * 0.5;
  const halo = ctx.createRadialGradient(0, 0, 0, 0, 0, haloR);
  halo.addColorStop(0.0, 'rgba(226, 236, 255, 0.85)');
  halo.addColorStop(0.08, 'rgba(198, 216, 255, 0.5)');
  halo.addColorStop(0.18, 'rgba(168, 194, 246, 0.26)');
  halo.addColorStop(0.36, 'rgba(132, 162, 224, 0.11)');
  halo.addColorStop(0.62, 'rgba(104, 132, 196, 0.04)');
  halo.addColorStop(1.0, 'rgba(90, 116, 178, 0)');
  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.arc(0, 0, haloR, 0, Math.PI * 2);
  ctx.fill();

  // The disc. Bigger relative to its halo than the sun's is — the moon
  // genuinely is a face you can read features on, and hiding that behind a
  // blaze would waste the one celestial object you can actually look at.
  const faceR = size * 0.13;
  const face = ctx.createRadialGradient(
    -faceR * 0.25,
    -faceR * 0.3,
    faceR * 0.15,
    0,
    0,
    faceR
  );
  face.addColorStop(0.0, '#ffffff');
  face.addColorStop(0.62, '#f2f5ff');
  face.addColorStop(1.0, '#d5dcf2');
  ctx.fillStyle = face;
  ctx.beginPath();
  ctx.arc(0, 0, faceR, 0, Math.PI * 2);
  ctx.fill();

  // Maria — the dark seas, which are what the eye actually recognises as
  // "the moon" rather than "a white circle". Soft-edged and irregular, laid
  // out roughly like the real near side: a big mass upper-left, a chain
  // down the middle, a couple of smaller ones lower right.
  //
  // Clipped to the disc, so a blot that overruns its edge is cut off
  // cleanly instead of bulging the silhouette — the moon's outline is
  // perfectly circular and a lumpy one reads as wrong immediately.
  ctx.save();
  ctx.beginPath();
  ctx.arc(0, 0, faceR, 0, Math.PI * 2);
  ctx.clip();
  const maria = [
    [-0.34, -0.38, 0.36, 0.2],
    [-0.12, -0.15, 0.3, 0.16],
    [0.1, -0.42, 0.2, 0.13],
    [-0.05, 0.26, 0.26, 0.14],
    [0.34, 0.2, 0.19, 0.1],
    [0.3, -0.05, 0.13, 0.08],
  ];
  maria.forEach(([mx, my, mr, alpha]) => {
    const blot = ctx.createRadialGradient(
      mx * faceR,
      my * faceR,
      0,
      mx * faceR,
      my * faceR,
      mr * faceR
    );
    blot.addColorStop(0, `rgba(150, 164, 196, ${alpha})`);
    blot.addColorStop(0.7, `rgba(158, 172, 202, ${alpha * 0.55})`);
    blot.addColorStop(1, 'rgba(160, 174, 204, 0)');
    ctx.fillStyle = blot;
    ctx.beginPath();
    ctx.arc(mx * faceR, my * faceR, mr * faceR, 0, Math.PI * 2);
    ctx.fill();
  });

  // A faint darkening round the rim. The real moon limb-darkens, and
  // without it a flat disc sits on the sky like a sticker.
  const limb = ctx.createRadialGradient(0, 0, faceR * 0.6, 0, 0, faceR);
  limb.addColorStop(0, 'rgba(120, 136, 172, 0)');
  limb.addColorStop(1, 'rgba(120, 136, 172, 0.3)');
  ctx.fillStyle = limb;
  ctx.beginPath();
  ctx.arc(0, 0, faceR, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

// A real place in the sky, genuinely far away rather than just "high up" —
// at this distance, normal depth testing keeps it correctly behind Darla,
// the roof, and trees whenever they're actually in the way (as they should
// be), while it still reads as impossibly distant everywhere else. Disabling
// depth testing (an earlier attempt at fixing occlusion) was the wrong fix —
// it made the moon draw on top of literally everything, including Darla.
// Still exempt from fog so it doesn't fade to the fog color at this range.
const moonMaterial = new THREE.SpriteMaterial({
  map: makeMoonTexture(),
  transparent: true,
  toneMapped: false,
  fog: false,
});
const moonSprite = new THREE.Sprite(moonMaterial);
moonSprite.scale.set(28, 28, 1);
moonSprite.position.copy(MOON_DIRECTION).multiplyScalar(SKY_DISTANCE);
scene.add(moonSprite);

// The rising sun.
//
// This replaced a hand-drawn smiling sun with rays and a face, on the
// owner's call — the daytime look is a sunrise now and wanted something
// beautiful rather than something cheerful. Everything charming about the
// old one is in the history if it is ever missed.
//
// What makes a low sun read as a low sun, and none of it is the disc:
//
//   * the disc itself is *small* and almost white. A big yellow ball is a
//     child's drawing of the sun; the real thing subtends half a degree and
//     is blown out well past any colour a screen can show.
//   * everything around it is the effect. A wide, faint aureole out to many
//     times the disc's radius is what atmosphere near the horizon does to
//     sunlight, and it is the part the eye actually reads.
//   * it is warmer at its edge than at its centre, because the light at the
//     rim has travelled through more air. Centre near-white, rim gold,
//     aureole amber.
//
// Drawn with premultiplied-looking additive falloff and rendered additively,
// so it sits *on top of* whatever sky is behind it rather than punching a
// square of its own background through the clouds.
function makeSunTexture() {
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const c = size / 2;

  // The aureole: a wide, smooth, rapidly-falling glow filling most of the
  // texture. The stops are close together near the middle and far apart
  // toward the edge because the falloff is roughly inverse-square and a
  // linear ramp reads as a flat disc with a hard edge.
  const halo = ctx.createRadialGradient(c, c, 0, c, c, c);
  halo.addColorStop(0.0, 'rgba(255, 246, 224, 1)');
  halo.addColorStop(0.06, 'rgba(255, 226, 170, 0.92)');
  halo.addColorStop(0.13, 'rgba(255, 186, 116, 0.55)');
  halo.addColorStop(0.26, 'rgba(255, 148, 78, 0.24)');
  halo.addColorStop(0.45, 'rgba(240, 116, 60, 0.09)');
  halo.addColorStop(0.70, 'rgba(210, 96, 60, 0.03)');
  halo.addColorStop(1.0, 'rgba(190, 90, 60, 0)');
  ctx.fillStyle = halo;
  ctx.fillRect(0, 0, size, size);

  // The disc. Small — a tenth of the texture — and near-white, with just
  // enough warmth at its own edge to keep it from reading as a hole.
  const discR = size * 0.052;
  const disc = ctx.createRadialGradient(c, c, 0, c, c, discR);
  disc.addColorStop(0.0, 'rgba(255, 255, 252, 1)');
  disc.addColorStop(0.72, 'rgba(255, 250, 232, 1)');
  disc.addColorStop(0.93, 'rgba(255, 226, 168, 0.85)');
  disc.addColorStop(1.0, 'rgba(255, 210, 140, 0)');
  ctx.fillStyle = disc;
  ctx.beginPath();
  ctx.arc(c, c, discR, 0, Math.PI * 2);
  ctx.fill();

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

const sunMaterial = new THREE.SpriteMaterial({
  map: makeSunTexture(),
  transparent: true,
  // Additive, which is the whole reason the aureole works. Under normal
  // alpha blending the glow's faint outer stops *replace* the sky behind
  // them in proportion to their alpha, so a cloud passing behind the sun is
  // partly wiped out by a wash of orange. Adding instead means the sun
  // lights the cloud rather than covering it, which is what light does.
  blending: THREE.AdditiveBlending,
  depthWrite: false,
  toneMapped: false,
  fog: false,
});
const sunSprite = new THREE.Sprite(sunMaterial);
// Much larger than the old 28, because most of this sprite is now empty
// falloff rather than drawing — the visible disc inside it is about a tenth
// of its width, so at 28 the sun itself would be a couple of pixels.
sunSprite.scale.set(78, 78, 1);
sunSprite.position.copy(SUN_DIRECTION).multiplyScalar(SKY_DISTANCE);
scene.add(sunSprite);

// A starfield — soft, gently twinkling points across the upper sky, at a
// large fixed radius from Darla (recentered on her every frame, the same
// trick the endless lawn uses) so it always surrounds her no matter how
// far she wanders into the woods, rather than being left behind at one
// fixed spot in the world the way the moon currently is.
function createStarfield() {
  const starCount = 1200;
  const radius = 150;
  const positions = new Float32Array(starCount * 3);
  const phases = new Float32Array(starCount);
  const sizes = new Float32Array(starCount);

  for (let i = 0; i < starCount; i++) {
    let x, y, z, lenSq;
    do {
      x = Math.random() * 2 - 1;
      y = Math.random() * 2 - 1;
      z = Math.random() * 2 - 1;
      lenSq = x * x + y * y + z * z;
    } while (lenSq > 1 || y < 0.15);
    const len = Math.sqrt(lenSq);
    positions[i * 3] = (x / len) * radius;
    positions[i * 3 + 1] = (y / len) * radius;
    positions[i * 3 + 2] = (z / len) * radius;
    phases[i] = Math.random() * Math.PI * 2;
    sizes[i] = 1.5 + Math.random() * 2.5;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('phase', new THREE.BufferAttribute(phases, 1));
  geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));

  const material = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 } },
    vertexShader: `
      attribute float phase;
      attribute float size;
      uniform float uTime;
      varying float vTwinkle;

      void main() {
        vTwinkle = 0.55 + 0.45 * sin(uTime * 2.0 + phase * 6.2831);
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = size * vTwinkle;
        gl_Position = projectionMatrix * mvPosition;
      }
    `,
    fragmentShader: `
      precision mediump float;
      varying float vTwinkle;

      void main() {
        vec2 uv = gl_PointCoord - vec2(0.5);
        float alpha = smoothstep(0.5, 0.0, length(uv)) * vTwinkle;
        gl_FragColor = vec4(1.0, 1.0, 1.0, alpha);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });

  const points = new THREE.Points(geometry, material);
  points.userData.material = material;
  return points;
}

const starfield = createStarfield();
scene.add(starfield);

// Must exist before the first applyDayNight() below, which drives its
// colours. Recentred on the camera every frame in animate().
const sky = createSky();
scene.add(sky.mesh);

// Day/night toggle: re-tunes the shared lights/fog/exposure/sprites in
// place rather than rebuilding the scene — see DAY_LIGHTING/NIGHT_LIGHTING
// above for the actual values.
let isDay = false;
function applyDayNight(day) {
  isDay = day;
  const cfg = day ? DAY_LIGHTING : NIGHT_LIGHTING;
  setMusicMode(day ? 'day' : 'night');

  // Still set, though the sky dome covers it — it's what shows for the one
  // frame before the dome draws, and what any future no-dome path falls to.
  scene.background.set(cfg.background);
  sky.apply(cfg.sky, cfg.sun.direction);
  // Debug pushes the fog far enough away to be gone. It's an edge-of-world
  // device for normal play, but debug exists to fly out and look at things
  // whole, and at any useful distance the fog was washing out the very thing
  // being inspected. Pushed rather than removed outright (scene.fog = null)
  // so nothing downstream has to cope with it being absent — the grass shader
  // in particular takes its fog as plain uniforms.
  const fogNear = debugFreeFly ? 4000 : cfg.fogNear;
  const fogFar = debugFreeFly ? 5000 : cfg.fogFar;
  scene.fog.color.set(cfg.fogColor);
  scene.fog.near = fogNear;
  scene.fog.far = fogFar;
  renderer.toneMappingExposure = cfg.exposure;
  scene.environmentIntensity = cfg.envIntensity;
  scene.environmentRotation.y = cfg.envRotationY;

  // The grass shader fogs itself out with its own fogColor/fogNear/fogFar
  // uniforms (it can't read scene.fog directly), so those need to be kept
  // in sync by hand or distant grass would stay fogged to whichever mode
  // was active when the material was first created.
  setGrassFog(cfg.fogColor, fogNear, fogFar);
  // And the same for its lighting, which it also can't read from the scene.
  setGrassLight(cfg.sun.direction, cfg.grassLight, cfg.grassBackScatter);
  setGrassMoonGlow(cfg.grassMoonGlow ?? 0, cfg.grassMoonColor ?? 0xffffff);
  // What the pond reflects — its own colour per mode, deliberately NOT
  // derived from the sky.
  //
  // Three physically-motivated versions were tried and all three looked
  // like mud: the horizon colour alone went salmon, horizon lerped toward
  // zenith went mauve (those two are near-complementary at sunrise, and
  // RGB interpolation between complementaries passes through grey), and
  // the fog colour went sandy brown. None of them were *wrong* — at a
  // grazing angle water really does mirror a sunrise, and a real pond at
  // dawn really can look like liquid bronze. It just reads as dirt when
  // it's sitting in a green glade in a game about a dog.
  //
  // So this is a deliberate cheat, chosen over accuracy on the owner's
  // call: the water stays cool and green-blue whatever the sky is doing,
  // and only shifts between day and night. The warm sun colour still
  // drives the specular, so sunrise puts gold glints on cool water —
  // which keeps the time of day legible without staining the whole
  // surface with it.
  setWaterLight(cfg.waterSky, cfg.sun.direction, cfg.sun.color);

  sunMoonLight.color.set(cfg.sun.color);
  sunMoonLight.intensity = cfg.sun.intensity;
  // Only the direction is stored here; where the light actually sits is
  // recomputed every frame around the shadow box's centre (see
  // updateShadowCamera), so setting position here would just be overwritten.
  sunMoonLight.userData.direction = cfg.sun.direction;
  shadowStrength = cfg.grassShadow;
  // Rooms with the light on. Purely emissive — no extra point lights, since
  // the exterior lamps below already carry the real lighting and a lit
  // window's job here is to be seen, not to illuminate the lawn.
  setHouseWindowsLit(!day);
  // The fixtures themselves. Their point lights already went dark by day;
  // the glass and bulbs didn't, so the house read as lit at noon.
  setHouseLampsLit(!day);
  // No lens flare off a moon. The effect is sized for a sun a hundred
  // thousand times brighter than the scene, and at night it just fogs the
  // screen whenever you happen to face the right way.
  //
  // Parked in variables rather than written straight into glarePass's
  // uniforms, because applyDayNight runs once during setup — well before
  // the composer and its passes exist further down the file. Touching the
  // pass here is a temporal-dead-zone ReferenceError that kills the whole
  // module mid-load, and the only symptom is the loading screen sitting at
  // its first message forever.
  glareStrength = cfg.glare ?? 0;
  glareColor = cfg.glareColor ?? null;
  updateShadowCamera(player ? player.position : ORIGIN);

  fillLight.color.set(cfg.fill.color);
  fillLight.intensity = cfg.fill.intensity;

  hemiLight.color.set(cfg.hemi.sky);
  hemiLight.groundColor.set(cfg.hemi.ground);
  hemiLight.intensity = cfg.hemi.intensity;

  // The house's exterior lamps only throw real light after dark. By day the
  // sun overwhelms them anyway, and leaving five point lights burning would
  // be pure cost for something nobody can see.
  yard.userData.nightLights.forEach((light) => {
    light.intensity = day ? 0 : 4.5;
  });

  // The wood sits in the pit all day and only burns after dark.
  setFirePitLit(yard.userData.firePit, !day);
  yard.userData.dragonflies.visible = !day;

  sunSprite.visible = day;
  moonSprite.visible = !day;
  starfield.visible = !day;
  // Darla's glow is what lets you see her against a dark night yard; in
  // daylight the sun already does that job, so it'd just look like a
  // strange halo stuck to her.
  darlaGlow.visible = !day;

  // Her winged eyeliner is night-only. Applied here rather than by the
  // transition so the state is right even when the transition never runs —
  // the very first applyDayNight below, ?debug reloads, a peer's swap arriving
  // before her face has been captured.
  setMomNight(mom, !day);

  // Shows the icon for the mode a click will switch *to*.
  dayNightButton.textContent = day ? '🌙' : '☀️';
}

const dayNightButton = document.getElementById('daynight-button');
const dayNightFade = document.getElementById('daynight-fade');
const DAY_NIGHT_FADE_MS = 2500; // half of the 5s round trip: fade out, swap, fade back in

// Swapping the lighting instantly reads as a jarring flash-cut, so it
// happens hidden behind a full-screen fade instead — fade to black, swap
// while the screen is opaque, fade back in. The button is disabled for the
// full 5s round trip so a second click can't land mid-transition.
function toggleDayNight() {
  dayNightButton.disabled = true;
  dayNightFade.style.opacity = '1';
  // Her face, transforming, played across the whole round trip — the fade is
  // otherwise five seconds of nothing. See transition.js.
  playNightTransition(isDay, DAY_NIGHT_FADE_MS * 2);
  if (isMultiplayer) net.send({ t: 'daynight', isDay: !isDay });
  setTimeout(() => {
    applyDayNight(!isDay);
    dayNightFade.style.opacity = '0';
    setTimeout(() => {
      dayNightButton.disabled = false;
    }, DAY_NIGHT_FADE_MS);
  }, DAY_NIGHT_FADE_MS);
}

dayNightButton.addEventListener('click', toggleDayNight);

// `?night` — start after dark.
//
// Small, and it closes a real hole: `?at=` and `?eye=` make a *position*
// reproducible but not the time of day, so every night check meant loading
// and then hunting for the toggle. A night shot could not be written down
// and handed to someone, which for a game whose whole second half is the
// dark is a strange thing to be missing.
applyDayNight(!new URLSearchParams(window.location.search).has('night'));

// The renderer's own `antialias: true` only ever applies to the default
// framebuffer. Everything here is drawn into the composer's render targets
// instead, which don't inherit it — so with post-processing in the chain
// the scene was being rendered with no MSAA at all. That's survivable for
// big flat surfaces and brutal for a third of a million hair-thin grass
// blades, which is exactly the geometry that aliases worst. Handing the
// composer an explicitly multisampled target is what actually turns it on.
const composerTargetSize = renderer.getDrawingBufferSize(new THREE.Vector2());
// Samples only — deliberately NOT HalfFloatType. The composer's targets
// were 8-bit before, which clamped every colour at 1.0; half-float doesn't,
// so genuinely HDR values (the emissive patio lights, the fire, the sun
// sprite, the grass's transmission term) suddenly reached the bloom pass at
// full strength rather than capped. Bloom is tuned against the clamped
// range, so those blew out and flared white as they crossed its threshold.
// Antialiasing was the point here; the wider colour range was not.
const composerTarget = new THREE.WebGLRenderTarget(
  composerTargetSize.width,
  composerTargetSize.height,
  { samples: 4 }
);
const composer = new EffectComposer(renderer, composerTarget);
composer.addPass(new RenderPass(scene, camera));

// Screen-space ambient occlusion is DISABLED, deliberately.
//
// It was added for contact shadows — grounding the house against the lawn,
// darkening the corners under the roof overhang — and tuned for that: a
// 0.3 unit kernel radius, on a scene whose objects are a few units across.
//
// That tuning is fundamentally incompatible with the grass. Blades are
// 0.024 wide and sit 0.065 apart, so a 0.3 radius spans four or five
// neighbours: every blade pixel is surrounded by other blade geometry and
// the pass returns near-total occlusion across the whole sward. The result
// was black grass over bright unoccluded ground, getting steadily worse
// with every density increase. Shrinking the radius below blade spacing
// would stop it eating the lawn but leaves it too small to do the job it
// was there for, so it earns nothing either way now that grass is the
// dominant surface in the scene. The blades do their own occlusion in the
// fragment shader instead, which is both cheaper and actually aware of
// what it's shading.

// Up from the original 0.25/0.6/0.85 (strength/radius/threshold) for the
// soft glow of a painted scene rather than a tight realistic
// highlight-only bloom — but the threshold pulled back up from an earlier
// 0.65, which was low enough that the house's near-white siding cleared it
// and the walls visibly glowed. Bright things (sun, fire, sky) should
// bloom; a painted wall shouldn't.
const bloomPass = new UnrealBloomPass(
  new THREE.Vector2(window.innerWidth, window.innerHeight),
  0.32,
  0.7,
  0.82
);
composer.addPass(bloomPass);

// A permanent, always-on painterly grade — unlike psychedelicPass below
// (a temporary skill effect), this is meant to be the game's actual
// baseline look: a warm color push, a soft vignette (illustrated scenes
// read as focused/composed rather than flat-lit like a photo), and light
// grain standing in for canvas texture rather than a perfectly clean
// digital gradient.
const painterlyPass = new ShaderPass({
  uniforms: {
    tDiffuse: { value: null },
  },
  vertexShader: `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    varying vec2 vUv;

    float grainNoise(vec2 uv) {
      return fract(sin(dot(uv, vec2(12.9898, 78.233))) * 43758.5453);
    }

    void main() {
      vec4 color = texture2D(tDiffuse, vUv);

      color.rgb *= vec3(1.06, 1.03, 0.92);

      vec2 centered = vUv - 0.5;
      float vignette = 1.0 - dot(centered, centered) * 0.55;
      color.rgb *= vignette;

      float grain = (grainNoise(vUv * 500.0) - 0.5) * 0.02;
      color.rgb += grain;

      gl_FragColor = color;
    }
  `,
});
// Sun glare — what you get for turning and looking into a low sun.
//
// Deliberately after bloom and before the painterly grade: bloom is about
// bright *things in the scene* spilling into their surroundings, and this
// is about light hitting the lens, which happens in front of all of that.
// Putting it after the grade instead would leave it untouched by the warm
// push and the vignette and it would sit on top of the image like a decal.
//
// Three parts, in rough order of how much they matter:
//
//   1. A broad veiling haze that lifts and warms the whole frame as the sun
//      comes into view. This is the one doing the real work — glare is
//      mostly a loss of contrast, not a shape.
//   2. A bright bloom centred on the sun itself, plus a horizontal streak,
//      which is what a wide anamorphic-ish lens does with a point source.
//   3. Ghosts — a few soft discs spaced along the line from the sun through
//      the centre of the screen, which is where internal reflections land
//      in a real lens. Faint; they read as an artefact rather than a
//      decoration.
//
// Occlusion is approximated rather than computed. There's no depth buffer
// available at this point in the chain, so instead it samples the already-
// rendered image at the sun's own screen position: bright means open sky,
// dark means something is standing in front of it. That's a single tap and
// it gets the important case exactly right — walking behind the tree line
// and having the glare go out as trunks cross the sun.
const glarePass = new ShaderPass({
  uniforms: {
    tDiffuse: { value: null },
    // Where the sun is on screen, in UV. Off-screen values are meaningful
    // and expected: the streak and the haze still reach in from outside the
    // frame, which is what makes turning toward the sun feel gradual.
    uSunUv: { value: new THREE.Vector2(0.5, 1.5) },
    // How much the sun is in view at all: 0 when it's behind the camera.
    uFacing: { value: 0 },
    uColor: { value: new THREE.Color(0xffb066) },
    // Screen aspect, so the halo is round rather than an ellipse.
    uAspect: { value: 1 },
    // Master switch — zero at night, where a moon shouldn't flare.
    uStrength: { value: 1 },
  },
  vertexShader: `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform vec2 uSunUv;
    uniform float uFacing;
    uniform float uAspect;
    uniform float uStrength;
    uniform vec3 uColor;
    varying vec2 vUv;

    void main() {
      vec4 color = texture2D(tDiffuse, vUv);
      float amount = uFacing * uStrength;
      if (amount < 0.001) {
        gl_FragColor = color;
        return;
      }

      // Cheap occlusion: how bright the frame already is where the sun is.
      // Clamped into the frame so a sun just off-screen samples the edge
      // pixel nearest it rather than wrapping or clamping to a corner.
      vec2 probe = clamp(uSunUv, vec2(0.0), vec2(1.0));
      vec3 atSun = texture2D(tDiffuse, probe).rgb;
      float open = smoothstep(0.28, 0.85, max(atSun.r, max(atSun.g, atSun.b)));
      // Never all the way to zero — a sun behind bare branches still throws
      // some glare, and snapping fully off as a trunk crosses it looks like
      // a bug rather than an occlusion.
      amount *= mix(0.25, 1.0, open);

      // Aspect-corrected offset from the sun, so distances are circular.
      vec2 d = (vUv - uSunUv) * vec2(uAspect, 1.0);
      float dist = length(d);

      // 1. Veiling haze across the whole frame. Small — this is the term
      // that lifts the blacks, and it only takes a little before the image
      // stops looking hazy and starts looking washed out.
      color.rgb += uColor * amount * 0.06;

      // 2. The halo, and the streak through it. The broad lobe fell off at
      // 4.2 and covered most of the frame, which erased the sky's own
      // gradient and every cloud in it — the glare was drowning the exact
      // thing it was meant to be reacting to.
      float halo = exp(-dist * 7.0) * 0.30 + exp(-dist * 16.0) * 0.60;
      float streak = exp(-abs(d.y) * 52.0) * exp(-abs(d.x) * 2.1) * 0.38;
      color.rgb += uColor * (halo + streak) * amount;

      // 3. Ghosts along the sun-to-centre line.
      vec2 toCentre = vec2(0.5) - uSunUv;
      for (int i = 1; i <= 3; i++) {
        float t = float(i) * 0.62;
        vec2 gp = uSunUv + toCentre * t;
        float gd = length((vUv - gp) * vec2(uAspect, 1.0));
        // Each one a little wider and fainter than the last.
        color.rgb += uColor * exp(-gd * (26.0 - float(i) * 5.0)) * 0.05 * amount;
      }

      gl_FragColor = color;
    }
  `,
});
composer.addPass(glarePass);

const _sunScreen = new THREE.Vector3();
const _toSun = new THREE.Vector3();
const _camForward = new THREE.Vector3();

// Points the glare pass at wherever the sun currently is on screen, and
// tells it how squarely the camera is looking at it. Called every frame,
// after the camera has finished moving for this one.
function updateSunGlare() {
  glarePass.uniforms.uStrength.value = glareStrength;
  if (glareColor !== null) glarePass.uniforms.uColor.value.set(glareColor);
  if (glareStrength < 0.001) {
    glarePass.uniforms.uFacing.value = 0;
    return;
  }

  // Where the sprite actually is, not SUN_DIRECTION — the sprite sits at a
  // fixed world point and bobs, so at close range the two disagree by
  // enough to slide the halo off the disc.
  _sunScreen.copy(sunSprite.position);
  _toSun.copy(_sunScreen).sub(camera.position).normalize();
  camera.getWorldDirection(_camForward);
  const align = _camForward.dot(_toSun);

  // Ramp rather than a cutoff. The lower bound is well outside the frame
  // (about 80 degrees off axis) so the veiling haze creeps in before the
  // sun itself appears, which is what turning toward a low sun actually
  // feels like — the image washes out first and the disc arrives after.
  const facing = THREE.MathUtils.smoothstep(align, 0.15, 0.92);
  glarePass.uniforms.uFacing.value = facing;

  if (facing > 0.001) {
    _sunScreen.project(camera);
    glarePass.uniforms.uSunUv.value.set(
      _sunScreen.x * 0.5 + 0.5,
      _sunScreen.y * 0.5 + 0.5
    );
    glarePass.uniforms.uAspect.value = camera.aspect;
  }
}

composer.addPass(painterlyPass);

// Miranda's "trip" skill: a full-screen wiggle (UV displaced by layered
// sine waves) plus a slow hue rotation and a little chromatic split, all
// scaled by uIntensity so toggling it fades in/out instead of snapping —
// see setPsychedelic below. Goes after bloom (so it distorts the already-
// composited image) but before OutputPass (so OutputPass's color-space
// conversion still happens last, same as any other pipeline).
const psychedelicPass = new ShaderPass({
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uIntensity: { value: 0 },
  },
  vertexShader: `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform float uTime;
    uniform float uIntensity;
    varying vec2 vUv;

    // Standard NTSC-derived hue-rotation matrix (rotates RGB around the
    // luma axis) — cheap enough to run per-pixel without a HSL round trip.
    vec3 hueRotate(vec3 color, float angle) {
      float c = cos(angle);
      float s = sin(angle);
      mat3 hueMat = mat3(
        0.299 + 0.701 * c + 0.168 * s, 0.587 - 0.587 * c + 0.330 * s, 0.114 - 0.114 * c - 0.497 * s,
        0.299 - 0.299 * c - 0.328 * s, 0.587 + 0.413 * c + 0.035 * s, 0.114 - 0.114 * c + 0.292 * s,
        0.299 - 0.300 * c + 1.250 * s, 0.587 - 0.588 * c - 1.050 * s, 0.114 + 0.886 * c - 0.203 * s
      );
      return hueMat * color;
    }

    void main() {
      vec2 uv = vUv;
      float wiggle = 0.012 * uIntensity;
      uv.x += sin(uv.y * 18.0 + uTime * 2.2) * wiggle;
      uv.y += cos(uv.x * 14.0 + uTime * 1.7) * wiggle;

      float split = 0.004 * uIntensity;
      vec4 color = texture2D(tDiffuse, uv);
      color.r = texture2D(tDiffuse, uv + vec2(split, 0.0)).r;
      color.b = texture2D(tDiffuse, uv - vec2(split, 0.0)).b;

      color.rgb = mix(color.rgb, hueRotate(color.rgb, uTime * 0.6), uIntensity);
      gl_FragColor = color;
    }
  `,
});
composer.addPass(psychedelicPass);

composer.addPass(new OutputPass());

// A screen-space post-effect is inherently per-viewer (it's applied to
// this browser's own composer, not the 3D scene itself), so — unlike the
// other skills — this one stays purely local: it's what Miranda herself
// is "seeing," not a change to shared world state, and there's nothing to
// network-sync in multiplayer either way.
let psychedelicActive = false;
const psychedelicButton = document.getElementById('psychedelic-button');
const PSYCHEDELIC_DURATION_MS = 15000;

// The trip is now purely a change in how the world looks: the wiggle/colour
// shader and the slowed music, nothing else. It used to also take Miranda
// into first-person flight and have Darla bark "Get down here!" at her
// twice on a timer — both are gone, so you stay on the ground and keep
// normal control of her for the whole fifteen seconds.
//
// The flight system below is left intact but is no longer reached from
// anywhere. It's the only first-person camera rig in the codebase, so it's
// worth keeping around rather than deleting outright.
psychedelicButton.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  if (playerKind !== 'miranda' || psychedelicActive) return;
  psychedelicActive = true;
  psychedelicButton.classList.add('aiming');
  setMusicPsychedelic(true);
  setTimeout(() => {
    psychedelicActive = false;
    psychedelicButton.classList.remove('aiming');
    setMusicPsychedelic(false);
    // Miranda's own "coming down" beat stays — it's hers, not Darla's, and
    // it's what marks the end of the effect. Plays locally and broadcasts,
    // so both screens see it regardless of who triggered the skill.
    showSpeechBubble(mom, 'Whoa..');
    sendFx('mirandaComeDown');
  }, PSYCHEDELIC_DURATION_MS);
});

// Fades uIntensity toward on/off (rather than snapping) so the effect
// ramps in and out instead of just appearing/vanishing — called every
// frame from animate() regardless of playerKind, so it fades back out
// cleanly even if she stops playing Miranda mid-trip (can't currently
// happen mid-session, but cheap enough not to bother special-casing).
function updatePsychedelic(delta) {
  const target = psychedelicActive ? 1 : 0;
  const u = psychedelicPass.uniforms;
  u.uIntensity.value += (target - u.uIntensity.value) * Math.min(1, delta * 2);
  u.uTime.value = elapsed;
}

// Mushroom skill, part 2: pointer-lock first-person flying, for the same
// window as the wiggle/color shader and slowed music. WASD + mouse-look
// move her freely in full 3D instead of the usual ground-relative walk,
// and the camera sits at her own eye height instead of following from
// behind. Purely local, same as the shader/music: a first-person camera
// is inherently per-viewer, so this only changes what Miranda's own
// player sees/controls — her position still syncs to the other player
// completely normally either way, whatever put it there.
let flightActive = false;
let flightYaw = 0;
let flightPitch = 0;
const FLIGHT_SPEED = 8;
const FLIGHT_EYE_HEIGHT = 1.5;
const flightForward = new THREE.Vector3();
const flightRight = new THREE.Vector3();
const flightDir = new THREE.Vector3();

function enterFlight() {
  flightActive = true;
  flightYaw = camera.rotation.y;
  flightPitch = 0;
  // Fresh treading-water baseline each trip, rather than picking up
  // wherever the smoothed tilt happened to leave off last time.
  mirandaSwimTilt = 0.15;
  controls.enabled = false;
  mom.visible = false;
  renderer.domElement.requestPointerLock();
}

function exitFlight() {
  if (!flightActive) return;
  flightActive = false;
  mom.visible = true;
  // Undoes the swim pose — updateMirandaWalkCycle takes over her arms'
  // rotation.x again next frame regardless, but it never touches
  // rotation.z at all (only the stroke does), so without resetting that
  // here explicitly her arms would stay stuck rotated outward at whatever
  // angle the last stroke left them, forever.
  mom.rotation.x = 0;
  mom.userData.arms.armL.rotation.z = 0;
  mom.userData.arms.armR.rotation.z = 0;
  // "Lands" her — flight ignores the ground entirely, so without this
  // she'd just be left floating wherever she happened to stop. Onto the
  // terrain, not y=0, or she'd sink into the hill.
  mom.position.y = terrainHeight(mom.position.x, mom.position.z);
  // OrbitControls recomputes its own spherical state from wherever
  // camera.position/target actually are the next time it runs (rather
  // than some stale pre-flight snapshot), so just pointing target back at
  // her is enough for it to pick up cleanly — no manual camera reposition
  // needed here.
  controls.target.set(mom.position.x, 0.5, mom.position.z);
  controls.enabled = true;
  if (document.pointerLockElement === renderer.domElement) {
    document.exitPointerLock();
  }
}

document.addEventListener('mousemove', (e) => {
  if (!flightActive || document.pointerLockElement !== renderer.domElement) return;
  const sensitivity = 0.0022;
  flightYaw -= e.movementX * sensitivity;
  flightPitch -= e.movementY * sensitivity;
  flightPitch = THREE.MathUtils.clamp(flightPitch, -1.5, 1.5);
});

// Escape (or anything else that drops pointer lock — alt-tab, etc.) ends
// the flying specifically, rather than leaving her stuck mid-air with
// working WASD but no way to look around anymore. The wiggle/color shader
// and slowed music keep running on their own 20s timer regardless — only
// the flying part is tied to having the lock.
document.addEventListener('pointerlockchange', () => {
  if (flightActive && document.pointerLockElement !== renderer.domElement) {
    exitFlight();
  }
});
document.addEventListener('pointerlockerror', () => {
  console.error('Pointer lock failed — ending the flying part of the trip.');
  exitFlight();
});

// Full 3D movement in whatever direction the camera's actually looking —
// forward/back climbs or dives if you're looking up/down, not the flat-
// ground strafing WASD normally does. Space/Shift add pure vertical
// regardless of pitch, for finer altitude control while looking level.
function updateFlight(delta) {
  camera.rotation.set(flightPitch, flightYaw, 0, 'YXZ');
  flightForward.set(0, 0, -1).applyEuler(camera.rotation);
  flightRight.set(1, 0, 0).applyEuler(camera.rotation);
  flightDir.set(0, 0, 0);
  if (pressedKeys.has('KeyW') || pressedKeys.has('ArrowUp')) flightDir.add(flightForward);
  if (pressedKeys.has('KeyS') || pressedKeys.has('ArrowDown')) flightDir.sub(flightForward);
  if (pressedKeys.has('KeyD') || pressedKeys.has('ArrowRight')) flightDir.add(flightRight);
  if (pressedKeys.has('KeyA') || pressedKeys.has('ArrowLeft')) flightDir.sub(flightRight);
  if (pressedKeys.has('Space')) flightDir.y += 1;
  if (pressedKeys.has('ShiftLeft') || pressedKeys.has('ShiftRight')) flightDir.y -= 1;

  const isMoving = flightDir.lengthSq() > 0.0001;
  if (isMoving) {
    flightDir.normalize();
    mom.position.x += flightDir.x * FLIGHT_SPEED * delta;
    mom.position.y += flightDir.y * FLIGHT_SPEED * delta;
    mom.position.z += flightDir.z * FLIGHT_SPEED * delta;
    // Generous but finite bounds — well past the yard so it still feels
    // free, without letting her drift off into the woods forever during
    // what's meant to be a brief, contained trip.
    mom.position.x = THREE.MathUtils.clamp(mom.position.x, YARD_BOUNDS.xMin - 15, YARD_BOUNDS.xMax + 15);
    mom.position.z = THREE.MathUtils.clamp(mom.position.z, YARD_BOUNDS.zMin - 15, YARD_BOUNDS.zMax + 15);
    // Floor is the ground under her, not zero — otherwise she can fly
    // straight into the hillside.
    const groundY = terrainHeight(mom.position.x, mom.position.z);
    mom.position.y = THREE.MathUtils.clamp(mom.position.y, groundY + 0.1, groundY + 25);
  }
  mom.rotation.y = flightYaw;
  camera.position.set(mom.position.x, mom.position.y + FLIGHT_EYE_HEIGHT, mom.position.z);
  // Purely cosmetic on her own client (mom.visible is false here — she
  // can't see herself in first person) but kept in sync anyway rather
  // than skipped, since it's the same call applyRemoteState makes for the
  // *other* player's view of her, and there's no reason for the two to
  // diverge.
  updateMirandaSwim(elapsed, isMoving);
  return isMoving;
}

// Body tilt eases toward its target rather than snapping, so starting/
// stopping mid-air doesn't whip her upright/horizontal instantly — module-
// level since it needs to persist and smooth across calls, same idea as
// psychedelicPass's uIntensity fade.
let mirandaSwimTilt = 0.15;

// A freestyle-stroke pose for flying, responsive to whether she's actually
// moving: near-upright with a slow, gentle stroke when stationary (reads
// as treading water in place), tilted forward toward horizontal with a
// bigger, faster stroke and kick when she's actually flying somewhere
// (reads as swimming forward) — a constant tilt regardless of movement
// just looked like treading water the whole time, moving or not. Driven
// by a shared time value (elapsed) rather than each client's own delta-
// summed state, so the two clients' strokes land in approximately the
// same phase instead of drifting apart over the trip.
function updateMirandaSwim(t, isMoving) {
  const targetTilt = isMoving ? 1.3 : 0.15;
  mirandaSwimTilt += (targetTilt - mirandaSwimTilt) * 0.12;
  mom.rotation.x = mirandaSwimTilt;

  const strokeSpeed = isMoving ? 5 : 2;
  const armSwing = isMoving ? 1.3 : 0.5;
  const stroke = t * strokeSpeed;
  mom.userData.arms.armL.rotation.x = Math.sin(stroke) * armSwing - 0.3;
  mom.userData.arms.armR.rotation.x = Math.sin(stroke + Math.PI) * armSwing - 0.3;
  mom.userData.arms.armL.rotation.z = Math.cos(stroke) * 0.3;
  mom.userData.arms.armR.rotation.z = -Math.cos(stroke + Math.PI) * 0.3;

  const kickSpeed = isMoving ? 9 : 4;
  const kickAmount = isMoving ? 0.35 : 0.15;
  const kick = t * kickSpeed;
  mom.userData.legs.legL.rotation.x = Math.sin(kick) * kickAmount;
  mom.userData.legs.legR.rotation.x = Math.sin(kick + Math.PI) * kickAmount;
}

// Movement — WASD / arrow keys, relative to the camera so "forward" always
// means "away from where you're looking," with Darla turning to face the
// direction she's walking and her legs cycling into a trot.
const pressedKeys = new Set();
window.addEventListener('keydown', (e) => pressedKeys.add(e.code));
window.addEventListener('keyup', (e) => pressedKeys.delete(e.code));

// Debug-mode free-fly: WASD/arrows translate the camera along whatever
// direction it's actually facing, Space/Shift add pure vertical — mouse
// drag/scroll to look around and zoom is just OrbitControls' own normal
// input, untouched. Moves controls.target by the same amount as
// camera.position each frame so controls.update() (still running
// normally every frame) reconstructs the same position instead of
// snapping the camera back to orbit around a stale target.
// Lets you tilt the camera all the way up to vertical without it ever
// going through the ground.
//
// Limiting the polar angle is the obvious approach and it's the wrong one:
// it stops the tilt dead at whatever angle the current orbit distance
// allows, so you still can't look up. Instead this leaves the angle free
// and squeezes the *radius*. camera.y = target.y + r * cos(phi), so
// staying above a floor means r <= (floor - target.y) / cos(phi) whenever
// cos(phi) is negative — i.e. once the camera has swung below the target.
// As the tilt approaches vertical that limit shrinks toward zero, so the
// camera rolls in closer and closer, ends up inside the character (who
// therefore stops being drawn in the way), and looks straight up.
// Camera-to-target distance below which the player stops being drawn. Set
// above the ~0.25 m the tilt-up clamp bottoms out at, so they're already
// gone by the time you reach vertical rather than popping out at the last
// moment.
const PLAYER_HIDE_DISTANCE = 1.4;

// How far in front of a wall the camera is allowed to sit. Bigger than the
// near plane (0.1) so the wall doesn't clip through the lens.
const CAMERA_SKIN = 0.38;
// Everything the camera is allowed to be pushed in front of stands between
// the ground and the ridge, so one y span covers the lot.
const CAMERA_BLOCK_TOP = 12;

const _camDir = new THREE.Vector3();

// Distance along a ray at which it first enters an axis-aligned box, or
// null. Standard slab test, in plan only — the y extent is handled by the
// caller, since every blocker here runs from the ground to the roof.
function rayEntersBox(ox, oz, dx, dz, b, maxT) {
  let tMin = 0;
  let tMax = maxT;
  // x slab
  if (Math.abs(dx) < 1e-6) {
    if (ox < b.xMin || ox > b.xMax) return null;
  } else {
    let t1 = (b.xMin - ox) / dx;
    let t2 = (b.xMax - ox) / dx;
    if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
    tMin = Math.max(tMin, t1);
    tMax = Math.min(tMax, t2);
  }
  // z slab
  if (Math.abs(dz) < 1e-6) {
    if (oz < b.zMin || oz > b.zMax) return null;
  } else {
    let t1 = (b.zMin - oz) / dz;
    let t2 = (b.zMax - oz) / dz;
    if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
    tMin = Math.max(tMin, t1);
    tMax = Math.min(tMax, t2);
  }
  if (tMax < tMin) return null;
  return tMin;
}

// Pulls the camera in until nothing solid stands between it and what it's
// looking at.
//
// This is the fix for three separate queue items that all turned out to be
// one problem: the camera clipping through walls near the house, ending up
// inside shrubs, and burying itself in the roof when the player walks over
// the ridge. In each case the camera was in a legal position and something
// had got between it and the target — which no amount of floor-clamping can
// address, because the camera isn't below anything. It's behind something.
//
// Deliberately *not* a THREE.Raycaster against the scene. The house bakes
// down to a handful of merged meshes of tens of thousands of triangles
// each, and three tests them linearly — so the cost would land exactly when
// the camera is near the house, which is precisely when this runs. The
// house already publishes HOUSE_SOLIDS as boxes for collision and its roof
// as an analytic height function, so ray-vs-box plus a short march is both
// cheaper and more accurate than testing the real geometry.
function pullCameraPastBlockers() {
  const tx = controls.target.x;
  const ty = controls.target.y;
  const tz = controls.target.z;
  _camDir.set(camera.position.x - tx, camera.position.y - ty, camera.position.z - tz);
  const dist = _camDir.length();
  if (dist < 0.05) return;
  _camDir.divideScalar(dist);

  let nearest = dist;

  // Walls, piers and the chimney. Only tested over the height they
  // actually occupy — above the ridge there is nothing to hit.
  if (ty < CAMERA_BLOCK_TOP || camera.position.y < CAMERA_BLOCK_TOP) {
    for (let i = 0; i < HOUSE_SOLIDS.length; i++) {
      const t = rayEntersBox(tx, tz, _camDir.x, _camDir.z, HOUSE_SOLIDS[i], nearest);
      if (t !== null && t > 0.01 && t < nearest) {
        // Only counts if the ray is actually below the eaves where it
        // crosses — otherwise the camera gets yanked in by a wall it is
        // comfortably flying over.
        const yAt = ty + _camDir.y * t;
        if (yAt < HOUSE_GROUND_Y + HOUSE_EAVE_Y) nearest = t;
      }
    }
    const c = HOUSE_CHIMNEY;
    const t = rayEntersBox(tx, tz, _camDir.x, _camDir.z, {
      xMin: c.x - c.halfX, xMax: c.x + c.halfX,
      zMin: c.z - c.halfZ, zMax: c.z + c.halfZ,
    }, nearest);
    if (t !== null && t > 0.01 && t < nearest) nearest = t;
  }

  // The roof itself, which is what the ridge case needs. Marched rather
  // than solved: the hip is four planes and two ends, and stepping along
  // the height field handles all of them without casing them out.
  {
    const STEP = 0.5;
    for (let d = STEP; d < nearest; d += STEP) {
      const x = tx + _camDir.x * d;
      const z = tz + _camDir.z * d;
      const y = ty + _camDir.y * d;
      const roof = roofSurfaceY(x, z);
      if (roof !== null && y < roof) {
        nearest = Math.max(0, d - STEP);
        break;
      }
    }
  }

  if (nearest >= dist) return;
  const pulled = Math.max(controls.minDistance, nearest - CAMERA_SKIN);
  if (pulled >= dist) return;
  camera.position.set(
    tx + _camDir.x * pulled,
    ty + _camDir.y * pulled,
    tz + _camDir.z * pulled
  );
}

function clampOrbitToGround() {
  const distance = camera.position.distanceTo(controls.target);
  if (distance < 0.0001) return;
  const cosPhi = (camera.position.y - controls.target.y) / distance;
  // Sampled under the camera rather than under the target, since that's the
  // bit of ground it's actually in danger of dipping into.
  let under = terrainHeight(camera.position.x, camera.position.z);

  const floor = under + 0.25;
  const drop = floor - controls.target.y;

  let limit = orbitMaxDistance;
  // Only bites when the camera is below the target *and* the target is
  // above the floor; otherwise there's no radius that would help and the
  // expression would flip sign.
  if (cosPhi < -0.0001 && drop < 0) limit = Math.min(limit, drop / cosPhi);
  controls.maxDistance = Math.max(controls.minDistance, limit);
}

// The debug camera is a free-fly — Miranda's flight, without a character
// attached and three times the speed.
//
// It used to drive WASD *through* OrbitControls, moving the camera and its
// orbit target together. That looks like flying until you want to back off and
// see something whole: the camera can never leave the target's orbit, the
// ground clamp keeps hauling it in, and `?cam=` radii bigger than the orbit
// allows quietly collapse. Owning the camera outright is the fix.
const debugFlyDir = new THREE.Vector3();
const debugFlyForward = new THREE.Vector3();
const debugFlyRight = new THREE.Vector3();
const DEBUG_FLY_SPEED = 24;
const DEBUG_BOOST = 3;
const DEBUG_LOOK_SENSITIVITY = 0.0042;
let debugYaw = 0;
let debugPitch = 0;
let debugLookReady = false;
let debugLookDragging = false;
let debugLookLastX = 0;
let debugLookLastY = 0;

// Swap debug between the free-fly camera and the ordinary third-person one,
// live. Both directions have to hand over cleanly or the switch is useless:
// going to fixed, OrbitControls would otherwise derive an orbit from
// wherever the free camera had flown to (often fifty metres away, aimed at
// nothing); coming back, the free camera would snap to whatever heading it
// held before, throwing away the view you were just looking at.
function setDebugCamera(free) {
  if (free === debugFreeFly) return;
  debugFreeFly = free;
  controls.enabled = !free;

  if (free) {
    // Seed the fly camera from where the orbit camera currently is, so the
    // view doesn't jump at the moment of the switch.
    orbitMaxDistance = 60;
    const dir = camera.getWorldDirection(new THREE.Vector3());
    debugYaw = Math.atan2(-dir.x, -dir.z);
    debugPitch = Math.asin(THREE.MathUtils.clamp(dir.y, -1, 1));
    debugLookReady = true;
  } else {
    // Re-attach to the player: aim at them and drop the camera a sensible
    // distance behind, rather than letting OrbitControls invent a radius
    // from the free camera's position.
    orbitMaxDistance = 13;
    controls.target.set(
      player.position.x,
      player.position.y + cameraAimHeight(),
      player.position.z
    );
    camera.position.set(
      player.position.x + 4.5,
      player.position.y + 3.2,
      player.position.z + 5.5
    );
    controls.update();
  }

  // Debug pushes the fog away so distance doesn't wash out whatever's being
  // inspected — but the fixed camera exists to show what the game actually
  // looks like, and no fog is exactly the wrong answer for that. Re-applying
  // the current mode is what moves it (see applyDayNight).
  applyDayNight(isDay);
}

if (DEBUG_MODE) {
  // OrbitControls is off in free-fly — orbiting a target is the wrong model
  // when what you want is to go and look at something. Fixed mode turns it
  // back on (see setDebugCamera).
  controls.enabled = !debugFreeFly;

  // Drag to look, not pointer lock. Lock would swallow clicks on the debug
  // panel, which is the other half of what debug mode is for. Directions match
  // the rest of the game: drag right and the view turns right, drag down and
  // it looks down.
  renderer.domElement.addEventListener('pointerdown', (e) => {
    // Registered once, but only active in free-fly — in fixed mode
    // OrbitControls owns the drag and both would turn at once.
    if (!debugFreeFly) return;
    debugLookDragging = true;
    debugLookLastX = e.clientX;
    debugLookLastY = e.clientY;
  });
  window.addEventListener('pointerup', () => {
    debugLookDragging = false;
  });
  window.addEventListener('pointermove', (e) => {
    if (!debugLookDragging) return;
    debugYaw -= (e.clientX - debugLookLastX) * DEBUG_LOOK_SENSITIVITY;
    debugPitch -= (e.clientY - debugLookLastY) * DEBUG_LOOK_SENSITIVITY;
    debugPitch = THREE.MathUtils.clamp(debugPitch, -1.5, 1.5);
    debugLookLastX = e.clientX;
    debugLookLastY = e.clientY;
  });
}

function updateDebugFly(delta) {
  // Picked up from wherever the camera already is on the first frame, so a
  // ?cam= starting shot still frames what it framed before the fly takes over.
  if (!debugLookReady) {
    debugLookReady = true;
    if (SPAWN_EYE) camera.position.set(SPAWN_EYE.x, SPAWN_EYE.y, SPAWN_EYE.z);
    if (SPAWN_LOOK) {
      debugYaw = THREE.MathUtils.degToRad(SPAWN_LOOK.yaw);
      debugPitch = THREE.MathUtils.degToRad(SPAWN_LOOK.pitch);
    } else {
      camera.rotation.reorder('YXZ');
      debugYaw = camera.rotation.y;
      debugPitch = camera.rotation.x;
    }
  }

  camera.rotation.set(debugPitch, debugYaw, 0, 'YXZ');
  debugFlyForward.set(0, 0, -1).applyEuler(camera.rotation);
  debugFlyRight.set(1, 0, 0).applyEuler(camera.rotation);

  debugFlyDir.set(0, 0, 0);
  if (pressedKeys.has('KeyW') || pressedKeys.has('ArrowUp')) debugFlyDir.add(debugFlyForward);
  if (pressedKeys.has('KeyS') || pressedKeys.has('ArrowDown')) debugFlyDir.sub(debugFlyForward);
  if (pressedKeys.has('KeyD') || pressedKeys.has('ArrowRight')) debugFlyDir.add(debugFlyRight);
  if (pressedKeys.has('KeyA') || pressedKeys.has('ArrowLeft')) debugFlyDir.sub(debugFlyRight);
  // Space and Shift are pure vertical regardless of pitch, for holding an
  // altitude while looking around.
  if (pressedKeys.has('Space')) debugFlyDir.y += 1;
  if (pressedKeys.has('ShiftLeft') || pressedKeys.has('ShiftRight')) debugFlyDir.y -= 1;

  if (debugFlyDir.lengthSq() > 0.0001) {
    // Crossing a 100 m world at a walking pace is most of what made the old
    // one tedious, so Ctrl is a sprint on top of an already-quick base.
    const boost = pressedKeys.has('ControlLeft') || pressedKeys.has('ControlRight') ? DEBUG_BOOST : 1;
    debugFlyDir.normalize().multiplyScalar(DEBUG_FLY_SPEED * boost * delta);
    camera.position.add(debugFlyDir);
  }

  // Parked a few metres ahead of the camera so anything still reading the
  // orbit target — the sky dome, camView() — describes where we're looking.
  controls.target.copy(camera.position).addScaledVector(debugFlyForward, 6);
}

// On-screen D-pad for touch devices, feeding the same pressedKeys set
document.querySelectorAll('#touch-controls button[data-key]').forEach((button) => {
  const key = button.dataset.key;
  const press = (e) => {
    e.preventDefault();
    pressedKeys.add(key);
  };
  const release = (e) => {
    e.preventDefault();
    pressedKeys.delete(key);
  };
  button.addEventListener('pointerdown', press);
  button.addEventListener('pointerup', release);
  button.addEventListener('pointercancel', release);
  button.addEventListener('pointerleave', release);
});

const jumpButtonEl = document.querySelector('#touch-controls button[data-action="jump"]');
jumpButtonEl.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  jumpHeld = true;
  triggerJump();
});
['pointerup', 'pointercancel', 'pointerleave'].forEach((evt) => {
  jumpButtonEl.addEventListener(evt, () => {
    jumpHeld = false;
  });
});

function isTypingTarget(target) {
  if (!target || !target.tagName) return false;
  return target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;
}

// Space and Backspace both jump (hold to fly), Enter makes her moo, P makes
// her poop.
//
// Poop moved off Backspace to make room for the second jump key. Backspace is
// the more natural thumb reach of the two and jumping is the far more common
// action, so it wins the good key; P is at least mnemonic.
window.addEventListener('keydown', (e) => {
  // Not while typing. This matters more than it used to: the multiplayer
  // join-code field is a real text input, and swallowing Backspace there would
  // stop anyone correcting a typo in the code.
  if (isTypingTarget(e.target)) return;
  if (e.code === 'Space' || e.code === 'Backspace') {
    // Backspace navigates back in some browser/focus combinations, so this
    // wants preventing whether or not it ends up jumping.
    e.preventDefault();
    // Space is "ascend" during flight instead — see updateFlight.
    if (flightActive) return;
    jumpHeld = true;
    if (!e.repeat) triggerJump();
  }
  if (e.code === 'Enter' && !e.repeat && playerKind === 'darla') {
    e.preventDefault();
    playMooSound();
    sendFx('moo');
  }
  if (e.code === 'KeyP' && !e.repeat && playerKind === 'darla') {
    e.preventDefault();
    spawnPoop();
  }
  // C for sit — WASD owns the obvious letters and S is already "back", so
  // the mnemonic key is taken. C is at least the usual crouch key.
  if (e.code === 'KeyC' && !e.repeat) {
    e.preventDefault();
    toggleSit();
  }
});
window.addEventListener('keyup', (e) => {
  if (e.code === 'Space' || e.code === 'Backspace') jumpHeld = false;
});

// Holding both mouse buttons walks forward, so the mouse alone can drive her:
// right-drag already rotates the camera, so with both down you steer and walk
// at once.
//
// Read off `e.buttons` (a bitmask of what's currently held) rather than
// counting `button` presses, because that can't drift out of sync — every
// pointer event carries the true current state, so a button released over
// another element, or a chord broken up in an odd order, still resolves
// correctly. The blur handler covers the one case events don't: alt-tabbing
// away mid-chord, which would otherwise leave her walking forever.
let bothMouseButtonsHeld = false;
const LEFT_AND_RIGHT = 1 | 2;
function trackMouseChord(e) {
  bothMouseButtonsHeld = (e.buttons & LEFT_AND_RIGHT) === LEFT_AND_RIGHT;
}
renderer.domElement.addEventListener('pointerdown', trackMouseChord);
window.addEventListener('pointermove', trackMouseChord);
window.addEventListener('pointerup', trackMouseChord);
window.addEventListener('pointercancel', trackMouseChord);
window.addEventListener('blur', () => {
  bothMouseButtonsHeld = false;
});
// Without this the right button opens the browser's context menu, which both
// interrupts the chord and leaves a menu sitting over the yard. OrbitControls
// already uses the right button to rotate, so this was overdue regardless.
renderer.domElement.addEventListener('contextmenu', (e) => e.preventDefault());

document.getElementById('moo-button').addEventListener('pointerdown', (e) => {
  e.preventDefault();
  playMooSound();
  sendFx('moo');
});

let poopButtonHeld = false;
let poopHoldStart = 0;
const poopButton = document.getElementById('poop-button');
poopButton.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  poopButtonHeld = true;
  poopHoldStart = elapsed;
  poopSpawnTimer = 0;
});
['pointerup', 'pointercancel', 'pointerleave'].forEach((evt) => {
  poopButton.addEventListener(evt, () => {
    poopButtonHeld = false;
  });
});

document.getElementById('dress-button').addEventListener('pointerdown', (e) => {
  e.preventDefault();
  darla.userData.dress.visible = !darla.userData.dress.visible;
});

// The only skill both characters share, so unlike the rest of the stack it
// isn't hidden in either mode.
const sitButton = document.getElementById('sit-button');
sitButton.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  toggleSit();
});

document.getElementById('bark-button').addEventListener('pointerdown', (e) => {
  e.preventDefault();
  playBarkSound();
  sendFx('bark');
});

// Bite: a prank rather than a useful skill — press the button and Darla
// chases Miranda down (re-targeting her every frame in case she's off on a
// collection run, rather than a single fixed point) instead of just
// biting from wherever she happens to be standing. Once she actually
// reaches her, the leash comes off if she's currently wearing one —
// otherwise it's just the reaction pulse, no other effect.
let biteElapsed = 0;
let biteActive = false;
let biteChasing = false;
const BITE_DURATION = 0.35;
const BITE_ARRIVE_DIST = 0.55;

// Bitten once and she's done collecting poop for the rest of the session.
//
// Declared here rather than next to momState, which is where it belongs by
// subject, because triggerBite is right below and uses it — and this file
// has taught me five times over to put a constant above its first *use*.
//
// Deliberately permanent, and deliberately not reset by anything: not the
// day/night toggle, not walking away, not picking her as the player and
// switching back. Only a reload clears it. It started as a 14-second sulk,
// which turned out to be the wrong shape — a timer makes biting her a way to
// buy a pause, where this makes it a decision about how you want the yard to
// be. Leaving the poop on the lawn is the consequence you chose.
let momQuitPoopDuty = false;

// Bitten: she abandons the poop she was heading for and walks home.
//
// Split out from triggerBite because the same thing has to happen on the
// other player's screen when a bite arrives over the network — otherwise the
// biter sees her quit and Miranda's own client sees her carry on working.
function stopMomCollecting() {
  momQuitPoopDuty = true;
  // A scoop in progress gets interrupted too.
  //
  // This exempted 'pickingUp' at first, on the theory that finishing the one
  // in her hands was tidier than snapping out of it. That was wrong, and
  // badly so for exactly the case worth biting her over: a big poop shrinks
  // rather than vanishing (removeOrShrinkPoop), so she scoops the same one
  // over and over, and the exemption meant biting her did nothing at all for
  // as long as the pile lasted.
  //
  // The pose has to be unwound by hand because updateMomPickup owns the bend
  // and the shovel swing and only resets them when it runs to completion —
  // leaving mid-scoop without this walks her home doubled over.
  if (momState === 'pickingUp') {
    mom.rotation.x = 0;
    mom.userData.arms.armR.rotation.x = 0;
    mom.position.y = terrainHeight(mom.position.x, mom.position.z);
  }
  momTargetPoop = null;
  // 'walking' with no target poop is already "head back to MOM_HOME" (see
  // updateMom), so this reuses the retreat rather than adding a state.
  momState = 'walking';
}

function triggerBite() {
  playBiteSound();
  if (darlaLeashed) {
    setDarlaLeashed(false);
    sendCommand('leashOff');
  }
  biteActive = true;
  biteElapsed = 0;
  stopMomCollecting();
  // The impact pulse itself (biteActive, driven in animate()) already
  // runs unconditionally on whatever local darla/mom objects exist — this
  // just makes sure it also fires on Mom's own screen, not only the biter's.
  sendFx('bite');
}

function updateBiteChase() {
  if (!biteChasing) return;
  // WASD cancels the chase, same as it cancels a regular click-to-move
  // target — losing control of Darla just because the button got pressed
  // would feel bad.
  const keyboardActive =
    pressedKeys.has('KeyW') ||
    pressedKeys.has('ArrowUp') ||
    pressedKeys.has('KeyS') ||
    pressedKeys.has('ArrowDown') ||
    pressedKeys.has('KeyD') ||
    pressedKeys.has('ArrowRight') ||
    pressedKeys.has('KeyA') ||
    pressedKeys.has('ArrowLeft');
  if (keyboardActive) {
    biteChasing = false;
    return;
  }
  const dist = Math.hypot(darla.position.x - mom.position.x, darla.position.z - mom.position.z);
  if (dist < BITE_ARRIVE_DIST) {
    biteChasing = false;
    moveTarget = null;
    clickMarker.visible = false;
    triggerBite();
    return;
  }
  moveTarget = new THREE.Vector3(mom.position.x, 0, mom.position.z);
}

document.getElementById('bite-button').addEventListener('pointerdown', (e) => {
  e.preventDefault();
  if (playerKind !== 'darla') return;
  biteChasing = true;
});

// Fetch: Miranda's only skill. Click the ball button to arm a throw, then
// click/tap a spot in the yard to throw it there (clamped to a reasonable
// distance from wherever she's standing) — Darla runs over and grabs it
// (see updateDarlaFetch below), the same "NPC notices something in the
// world and goes to deal with it" idiom as her collecting Darla's poops
// when Darla's the one being played. The button stays greyed out until
// Darla's back with it.
const ballButton = document.getElementById('ball-button');
const ballMat = new THREE.MeshStandardMaterial({ color: 0xd93025, roughness: 0.55 });
const ball = new THREE.Mesh(new THREE.SphereGeometry(0.06, 12, 10), ballMat);
ball.castShadow = true;
ball.visible = false;
scene.add(ball);

let ballState = 'idle'; // 'idle' | 'flying' | 'thrown'
let ballAiming = false;
let ballThrowElapsed = 0;
let ballThrowDuration = 0.55;
let ballArcHeight = 1.5;
const MAX_THROW_DIST = 8;
const ballThrowStart = new THREE.Vector3();
const ballThrowTarget = new THREE.Vector3();

function throwBallTo(x, z) {
  if (ballState !== 'idle' || darlaCheeseState !== 'idle' || darlaLeashed) return;
  ballState = 'flying';
  ballThrowElapsed = 0;
  ballButton.disabled = true;
  ballButton.classList.add('disabled');

  const dx = x - player.position.x;
  const dz = z - player.position.z;
  const dist = Math.hypot(dx, dz);
  const scale = dist > MAX_THROW_DIST ? MAX_THROW_DIST / dist : 1;
  const tx = THREE.MathUtils.clamp(
    player.position.x + dx * scale,
    YARD_BOUNDS.xMin,
    YARD_BOUNDS.xMax
  );
  const tz = THREE.MathUtils.clamp(
    player.position.z + dz * scale,
    YARD_BOUNDS.zMin,
    YARD_BOUNDS.zMax
  );

  // Launches from roughly hand height, out of Miranda herself, rather than
  // teleporting above the landing spot and dropping straight down. Flight
  // time and arc height both scale a bit with distance so a short toss
  // and a long bomb of a throw don't look identical.
  const throwDist = Math.hypot(tx - player.position.x, tz - player.position.z);
  ballThrowDuration = THREE.MathUtils.clamp(throwDist / 11, 0.35, 0.9);
  ballArcHeight = THREE.MathUtils.clamp(throwDist * 0.22, 0.8, 3);
  ballThrowStart.set(player.position.x, player.position.y + 1.1, player.position.z);
  ballThrowTarget.set(tx, terrainHeight(tx, tz) + 0.06, tz);
  ball.visible = true;
  ball.position.copy(ballThrowStart);
}

ballButton.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  if (ballState !== 'idle') return;
  ballAiming = !ballAiming;
  ballButton.classList.toggle('aiming', ballAiming);
});

// Cheese: Miranda's other skill, same aim-then-throw idiom as fetch, but
// Darla doesn't bring anything back — she eats it where it lands and
// immediately poops (see updateDarlaCheese below), which Miranda then has
// to go clean up herself. Guards against both her own state and the fetch
// state below since Darla can't run two different errands at once.
const cheeseButton = document.getElementById('cheese-button');
const cheeseMat = new THREE.MeshStandardMaterial({ color: 0xf4c430, roughness: 0.6 });
const cheese = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.09, 3), cheeseMat);
cheese.rotation.z = Math.PI / 2;
cheese.castShadow = true;
cheese.visible = false;
scene.add(cheese);

let cheeseState = 'idle'; // 'idle' | 'flying' | 'landed'
let cheeseAiming = false;
let cheeseThrowElapsed = 0;
let cheeseThrowDuration = 0.55;
let cheeseArcHeight = 1.5;
const cheeseThrowStart = new THREE.Vector3();
const cheeseThrowTarget = new THREE.Vector3();

function throwCheeseTo(x, z) {
  if (cheeseState !== 'idle' || darlaFetchState !== 'idle' || darlaCheeseState !== 'idle' || darlaLeashed)
    return;
  cheeseState = 'flying';
  cheeseThrowElapsed = 0;
  cheeseButton.disabled = true;
  cheeseButton.classList.add('disabled');

  const dx = x - player.position.x;
  const dz = z - player.position.z;
  const dist = Math.hypot(dx, dz);
  const scale = dist > MAX_THROW_DIST ? MAX_THROW_DIST / dist : 1;
  const tx = THREE.MathUtils.clamp(
    player.position.x + dx * scale,
    YARD_BOUNDS.xMin,
    YARD_BOUNDS.xMax
  );
  const tz = THREE.MathUtils.clamp(
    player.position.z + dz * scale,
    YARD_BOUNDS.zMin,
    YARD_BOUNDS.zMax
  );

  const throwDist = Math.hypot(tx - player.position.x, tz - player.position.z);
  cheeseThrowDuration = THREE.MathUtils.clamp(throwDist / 11, 0.35, 0.9);
  cheeseArcHeight = THREE.MathUtils.clamp(throwDist * 0.22, 0.8, 3);
  cheeseThrowStart.set(player.position.x, player.position.y + 1.1, player.position.z);
  cheeseThrowTarget.set(tx, terrainHeight(tx, tz) + 0.06, tz);
  cheese.visible = true;
  cheese.position.copy(cheeseThrowStart);
}

cheeseButton.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  if (cheeseState !== 'idle') return;
  cheeseAiming = !cheeseAiming;
  cheeseButton.classList.toggle('aiming', cheeseAiming);
});

// Calling Darla over: an instant skill, no aiming step — press it and she
// comes running, reusing the ball-fetch AI's own "returning" leg (which
// already walks her toward Miranda's live position and re-idles on
// arrival) rather than a whole separate state machine for the same walk.
const callButton = document.getElementById('call-button');
callButton.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  if (
    playerKind !== 'miranda' ||
    darlaFetchState !== 'idle' ||
    darlaCheeseState !== 'idle' ||
    darlaLeashed
  )
    return;
  playCallDarlaSound();
  showSpeechBubble(mom, 'Darla!');
  darlaFetchState = 'returning';
  sendCommand('callDarla');
  sendFx('callBark');
});

// Leash: click to arm, then click Darla herself (not a ground point, like
// fetch/cheese) to clip it on. Once leashed she's kept on a short tether
// rather than free to wander — see updateDarlaLeash below — instead of
// commanding her off on an errand the way the other skills do, so it's
// gated against those the same way they're gated against each other.
const leashButton = document.getElementById('leash-button');
const leashMat = new THREE.MeshStandardMaterial({ color: 0x7a3b1e, roughness: 0.7 });
const leash = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 1, 6), leashMat);
leash.castShadow = true;
leash.visible = false;
scene.add(leash);
const leashStart = new THREE.Vector3();
const leashEnd = new THREE.Vector3();
const leashDirVec = new THREE.Vector3();
const LEASH_UP = new THREE.Vector3(0, 1, 0);

let leashAiming = false;
let darlaLeashed = false;

function setDarlaLeashed(value) {
  darlaLeashed = value;
  leash.visible = value;
  leashButton.classList.toggle('aiming', value || leashAiming);
}

leashButton.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  if (darlaLeashed) {
    setDarlaLeashed(false);
    sendCommand('leashOff');
    return;
  }
  if (darlaFetchState !== 'idle' || darlaCheeseState !== 'idle') return;
  leashAiming = !leashAiming;
  leashButton.classList.toggle('aiming', leashAiming);
});

// Stretches the leash cylinder (default unit height along its local Y)
// between roughly Miranda's hand and Darla's collar — same "billboard a
// thin primitive between two live points" trick as everything else in
// this codebase that connects two moving things, just with a quaternion
// instead of a 2D rotation since this one isn't flat-on-the-ground.
function updateLeashVisual() {
  if (!darlaLeashed) return;
  leashStart.set(mom.position.x, mom.position.y + 1.0, mom.position.z);
  leashEnd.set(darla.position.x, darla.position.y + 0.22, darla.position.z);
  leash.position.copy(leashStart).add(leashEnd).multiplyScalar(0.5);
  leashDirVec.subVectors(leashEnd, leashStart);
  const len = leashDirVec.length();
  leash.scale.set(1, Math.max(len, 0.001), 1);
  if (len > 0.0001) {
    leash.quaternion.setFromUnitVectors(LEASH_UP, leashDirVec.normalize());
  }
}

// Keeps her within DARLA_LEASH_DISTANCE of Miranda — slack (no movement)
// once she's within it, walking to close the gap (capped so a single big
// frame-time spike can't snap her straight past the leash length) once
// she's not. Returns whether she moved, same isMoving-for-the-walk-cycle
// contract as updateDarlaFetch/updateDarlaCheese below.
const DARLA_LEASH_DISTANCE = 1.2;
const darlaLeashDir = new THREE.Vector3();

function updateDarlaLeash(delta) {
  if (!darlaLeashed) return false;
  darlaLeashDir.set(mom.position.x - darla.position.x, 0, mom.position.z - darla.position.z);
  const dist = darlaLeashDir.length();
  if (dist <= DARLA_LEASH_DISTANCE) return false;
  darlaLeashDir.normalize();
  const step = Math.min(dist - DARLA_LEASH_DISTANCE, WALK_SPEED * delta);
  darla.position.x += darlaLeashDir.x * step;
  darla.position.z += darlaLeashDir.z * step;
  const targetAngle = Math.atan2(darlaLeashDir.x, darlaLeashDir.z);
  darla.rotation.y += wrapAngle(targetAngle - darla.rotation.y) * Math.min(1, delta * 10);
  return true;
}

// Poops are left behind in the world, permanently, rather than attached to
// Darla, so she can walk away and leave them there — well, "permanently"
// until Mom comes and collects them (see updateMom below). Holding the
// button spawns a quick, slightly randomized scatter instead of just one.
let poopSpawnTimer = 0;
const POOP_SPAWN_INTERVAL = 0.1;
const poops = [];
// Stable per-pile ids, assigned only on real creation (not on a merge into
// an existing pile) — what lets a networked peer's poop snapshot diff
// cleanly against its own locally-rendered copies each tick.
let nextPoopId = 1;
// Poops rendered on the *other* client's snapshot when I'm not the one
// playing Darla — a parallel set of plain visual objects, never touched by
// spawnPoop/totalPoopCount/momUsingShovel, since only whoever's playing
// Darla owns the real `poops` array.
const remotePoops = new Map();

// Total individual poops across all piles — a pile that 5 poops merged
// into still counts as 5 toward the shovel threshold, not 1.
function totalPoopCount() {
  // `poops` is empty on Miranda's own client in multiplayer (Darla's
  // client owns the real array) — her copies live in remotePoops instead,
  // so the shovel threshold needs to count those there or it'd never
  // trigger no matter how big the backlog actually is.
  const remoteCount =
    isMultiplayer && playerKind === 'miranda'
      ? Array.from(remotePoops.values()).reduce((sum, p) => sum + p.userData.growth + 1, 0)
      : 0;
  return poops.reduce((sum, p) => sum + p.userData.growth + 1, 0) + remoteCount;
}

// Pooping in roughly the same spot repeatedly grows whatever's already
// there instead of scattering a pile of identical little ones — each
// nearby poop adds 40% more scale, uncapped, rather than spawning a new
// object. The pile's own userData.growth tracks how many have merged into
// it.
const POOP_COMBINE_RADIUS = 0.7;
const POOP_GROWTH_PER_MERGE = 0.4;

function spawnPoop(spread = 1) {
  const behindX = -Math.sin(darla.rotation.y);
  const behindZ = -Math.cos(darla.rotation.y);
  const jitterX = (Math.random() - 0.5) * 0.5 * spread;
  const jitterZ = (Math.random() - 0.5) * 0.35 * spread;
  const x = darla.position.x + behindX * 0.35 + jitterX;
  const z = darla.position.z + behindZ * 0.35 + jitterZ;

  let nearest = null;
  let nearestDist = POOP_COMBINE_RADIUS;
  for (const existing of poops) {
    const dist = Math.hypot(existing.position.x - x, existing.position.z - z);
    if (dist < nearestDist) {
      nearest = existing;
      nearestDist = dist;
    }
  }

  if (nearest) {
    nearest.userData.growth += 1;
    const scale = 1 + nearest.userData.growth * POOP_GROWTH_PER_MERGE;
    nearest.scale.setScalar(scale);
    // A deeper, weightier plop the bigger the pile gets — floored so it
    // doesn't fade into inaudible sub-bass once the pile gets absurd.
    playPoopSound(Math.max(1 / scale, 0.35));
    return;
  }

  const poop = createPoop();
  poop.userData.growth = 0;
  poop.userData.id = nextPoopId++;
  poop.position.set(x, terrainHeight(x, z), z);
  poop.rotation.y = Math.random() * Math.PI * 2;
  // Same hover-glow idiom as Mom/Darla/the hammock — a child of the poop
  // itself (rather than one shared/reparented sprite) so it scales for
  // free with the pile's own growth, and each pile can be independently
  // hovered without tracking "which one" separately.
  const poopGlow = createHoverGlow(0.4, 0.4, 0.15);
  poop.add(poopGlow);
  poop.userData.hoverGlow = poopGlow;
  scene.add(poop);
  poops.push(poop);
  playPoopSound();
}

// Click/tap-to-move: click the lawn and Darla walks there, isometric-game
// style. A short drag is treated as an orbit-camera gesture, not a click.
const raycaster = new THREE.Raycaster();
const pointerNDC = new THREE.Vector2();
const groundPlaneMath = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
let moveTarget = null;
let pointerDownPos = null;

const clickMarker = new THREE.Mesh(
  new THREE.RingGeometry(0.18, 0.26, 24),
  new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.85,
    side: THREE.DoubleSide,
    toneMapped: false,
  })
);
clickMarker.rotation.x = -Math.PI / 2;
clickMarker.visible = false;
scene.add(clickMarker);

// Where a ray first meets the roof, or null if it never does.
//
// Marched rather than raycast against the mesh. The roof is inside the
// baked, merged house geometry, so a mesh hit can't tell roof from wall
// without unpicking what it landed on — where the roof as a *height field*
// is one function call per sample (roofSurfaceY), covers all four planes
// and both hips for free, and can't disagree with the surface she's
// standing on because it is the same surface.
function marchToRoof(ray) {
  const STEP = 0.35;
  const MAX = 70;
  let prevT = 0;
  let prevAbove = true;
  const p = new THREE.Vector3();
  for (let t = STEP; t < MAX; t += STEP) {
    ray.at(t, p);
    const surface = roofSurfaceY(p.x, p.z);
    const above = surface === null || p.y > surface;
    // Crossing from above the surface to below it is the hit.
    if (prevAbove && !above) {
      // Bisect a few times, or the destination lands on a 35 cm grid and
      // clicks feel like they snap.
      let lo = prevT;
      let hi = t;
      for (let i = 0; i < 12; i++) {
        const mid = (lo + hi) / 2;
        ray.at(mid, p);
        const s = roofSurfaceY(p.x, p.z);
        if (s === null || p.y > s) lo = mid;
        else hi = mid;
      }
      return ray.at(hi, new THREE.Vector3());
    }
    prevT = t;
    prevAbove = above;
  }
  return null;
}

function getGroundPoint(clientX, clientY) {
  const rect = renderer.domElement.getBoundingClientRect();
  pointerNDC.x = ((clientX - rect.left) / rect.width) * 2 - 1;
  pointerNDC.y = -((clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointerNDC, camera);

  // On the roof, the roof *is* the ground. Without this the ray sails
  // straight through the shingles to the lawn below, hands back a point
  // inside the building's footprint, and clampTargetPoint then dutifully
  // shoves it out to the nearest patch of grass — so every click sent her
  // walking off the edge. That, not the camera, was what made being up
  // there useless.
  if (onRoof) {
    const roofPoint = marchToRoof(raycaster.ray);
    if (roofPoint) return roofPoint;
  }

  // Hit the actual ground mesh, not a mathematical plane at y=0. That plane
  // was correct while the world was flat, but the terrain now stands up to
  // 2.4 units above it — so a ray aimed at a visible patch of hillside
  // passed straight through it and carried on until it finally reached
  // y=0 somewhere far beyond, at a shallow angle that could put it hundreds
  // of units out. clampToWorldRadius then hauled that overshoot back to the
  // 50-unit ring, which is why every distant click ended up at much the
  // same spot instead of where it was aimed.
  const hits = raycaster.intersectObject(yard.userData.lawn, false);
  if (hits.length > 0) return hits[0].point;

  // Fallback for rays that miss the lawn entirely — over the horizon, or
  // past its edge. Keeps the old behaviour rather than swallowing the click.
  const point = new THREE.Vector3();
  return raycaster.ray.intersectPlane(groundPlaneMath, point) ? point : null;
}

// Speech bubble: a DOM element projected onto the speaking character's
// (not the clicked character's) head position each frame, rather than a
// sprite in the 3D scene, so text stays crisp and screen-aligned.
const speechBubbleEl = document.getElementById('speech-bubble');
let speechBubbleTarget = null;
let speechBubbleUntil = 0;
const speechBubbleWorldPos = new THREE.Vector3();

function showSpeechBubble(target, text, duration = 1.6) {
  speechBubbleEl.textContent = text;
  speechBubbleTarget = target;
  speechBubbleUntil = elapsed + duration;
  speechBubbleEl.classList.add('visible');
}

function hitsMom(clientX, clientY) {
  const rect = renderer.domElement.getBoundingClientRect();
  pointerNDC.x = ((clientX - rect.left) / rect.width) * 2 - 1;
  pointerNDC.y = -((clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointerNDC, camera);
  return raycaster.intersectObject(mom, true).length > 0;
}

// Returns the specific poop pile clicked (its own meshes are direct
// children of the pile's group, so the first hit's parent is the pile
// itself), or null. Checks remotePoops too — on Miranda's own client in
// multiplayer, `poops` is empty (Darla's client owns the real array) and
// every pile she sees is a remote-rendered stand-in there instead.
function pickPoop(clientX, clientY) {
  const rect = renderer.domElement.getBoundingClientRect();
  pointerNDC.x = ((clientX - rect.left) / rect.width) * 2 - 1;
  pointerNDC.y = -((clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointerNDC, camera);
  const targets = remotePoops.size > 0 ? [...poops, ...remotePoops.values()] : poops;
  const hits = raycaster.intersectObjects(targets, true);
  return hits.length > 0 ? hits[0].object.parent : null;
}

// Talking to another character: for now just Darla clicking on Miranda,
// who gets a "Woof!" speech bubble and her bark sound — the speaking
// character (not whoever got clicked) is who the bubble appears over.
// Snaps both of them to face one another, so a conversation doesn't play
// out with either of them still looking off in whatever direction they
// happened to be facing when the click landed.
function faceEachOther() {
  const dx = darla.position.x - mom.position.x;
  const dz = darla.position.z - mom.position.z;
  mom.rotation.y = Math.atan2(dx, dz);
  darla.rotation.y = Math.atan2(-dx, -dz);
}

function talkToMiranda() {
  faceEachOther();
  playBarkSound();
  showSpeechBubble(darla, 'Woof!');
  sendFx('speechBark', { text: 'Woof!' });
}

function hitsDarla(clientX, clientY) {
  const rect = renderer.domElement.getBoundingClientRect();
  pointerNDC.x = ((clientX - rect.left) / rect.width) * 2 - 1;
  pointerNDC.y = -((clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointerNDC, camera);
  return raycaster.intersectObject(darla, true).length > 0;
}

// The reverse direction: Miranda clicking on Darla brings up a menu of
// things she can say. Each node pairs Miranda's question with Darla's
// reply, plus an optional list of follow-up nodes — after her reply
// plays, if there are follow-ups the menu reopens showing those instead
// of closing, so a conversation can go several exchanges deep rather than
// stopping after one reply. No voice sample for either yet (unlike
// Darla's bark), just bubbles.
const DIALOGUE_TREE = [
  {
    question: 'Hi Bubby',
    response: 'Woof!',
    followUps: [
      {
        question: 'Who’s a good girl?',
        response: 'Woof! Woof!',
        followUps: [{ question: 'Yes you are!', response: 'Woof! Woof! Woof!', followUps: [] }],
      },
    ],
  },
];

// The options menu is gone, on the owner's call — it was clunky and nobody
// used it. Clicking Darla now just plays the next exchange straight away.
//
// The tree above is kept as the source of the lines rather than being
// flattened by hand, because the *order* it encodes is the whole joke:
// "Hi Bubby" then "Who's a good girl?" then "Yes you are!", with the bark
// getting longer each time. Walking it depth-first preserves that, so
// repeated clicks escalate the way the branching version did when you
// picked the obvious answer each time — and then loop back to the start.
//
// The #dialogue-menu element is left in index.html, unused. It costs
// nothing and makes putting the menu back a smaller job than it would be
// from scratch.
const DIALOGUE_LINES = (function flatten(nodes, out = []) {
  for (const node of nodes) {
    out.push({ question: node.question, response: node.response, end: node.end });
    if (node.followUps) flatten(node.followUps, out);
  }
  return out;
})(DIALOGUE_TREE);

let dialogueIndex = 0;

// The two-stage bubble playback: question, then — after a beat — bark and
// reply. Shared between the local click and the replay a networked peer
// runs for the same exchange (see applyRemoteFx), which is why it takes a
// plain {question, response} rather than reaching for the tree itself.
//
// It used to take an `onReplyShown` callback, which existed solely to
// reopen the options menu once the reply had landed. The menu is gone, and
// so is the callback.
function playDialogueBubbles(node) {
  showSpeechBubble(mom, node.question);
  window.setTimeout(() => {
    playBarkSound();
    showSpeechBubble(darla, node.response);
  }, 1700);
}

function talkToDarla(node) {
  sendFx('dialogue', { question: node.question, response: node.response });
  playDialogueBubbles(node);
}

function hitsHammock(clientX, clientY) {
  const rect = renderer.domElement.getBoundingClientRect();
  pointerNDC.x = ((clientX - rect.left) / rect.width) * 2 - 1;
  pointerNDC.y = -((clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointerNDC, camera);
  return raycaster.intersectObject(yard.userData.hammock, true).length > 0;
}

// Clicking the hammock (Miranda only) walks her over via the normal
// moveTarget path, then — once she arrives — settles her into it instead
// of just stopping. mirandaLoungeTarget marks "this particular walk ends
// in lying down" so updateMovement knows to call enterHammockLounge()
// on arrival rather than just clearing moveTarget like an ordinary click.
let mirandaLounging = false;
let mirandaLoungeTarget = false;
// Same idiom, for "this particular walk ends in picking up a poop" —
// clicking a poop as Miranda walks her over the normal click-to-move way,
// then this tells updateMovement to hand off to the pickup animation on
// arrival instead of just idling. See updateMomPickup below.
let mirandaPoopTarget = false;
// Same idiom again — clicking Darla while leashAiming walks Miranda over
// to her first, rather than clipping the leash on from wherever Miranda
// happened to be standing.
let mirandaLeashTarget = false;

function enterHammockLounge() {
  mirandaLounging = true;
  const hammock = yard.userData.hammock;
  // Built directly from the world-space axes she should end up pointing
  // along, rather than hand-composing Euler angles (which turned out
  // wrong — she ended up lying crosswise instead of along the fabric):
  // her local +Y (head-to-feet) axis maps onto the hammock's length
  // direction, her local +Z (chest) maps straight up so she lies face-up,
  // and +X (right side) falls out of those two via the cross product.
  const theta = hammock.rotation.y;
  const lengthDir = new THREE.Vector3(Math.cos(theta), 0, -Math.sin(theta));
  const upDir = new THREE.Vector3(0, 1, 0);
  const rightDir = new THREE.Vector3().crossVectors(lengthDir, upDir);
  const basis = new THREE.Matrix4().makeBasis(rightDir, lengthDir, upDir);
  mom.quaternion.setFromRotationMatrix(basis);

  // Her local origin sits near her feet, not her center, so anchoring it
  // at the hammock's center would hang half of her off one side — offset
  // back along the length axis by roughly half her standing height to
  // center her instead, and lift her slightly above the fabric's sag
  // point so her back doesn't clip through the mesh she's lying on.
  const halfHeight = 0.72;
  const restLift = 0.15;
  mom.position.set(
    hammock.position.x - lengthDir.x * halfHeight,
    // hammock.position.y matters: lieHeight is a height *within* the hammock
    // (attachHeight minus the fabric's sag), not a world position. Without
    // the hammock's own y added, she was placed that far above the world
    // origin instead of above the hammock — which was harmless while the
    // yard was flat and buried her about two metres underground once the
    // terrain got its hill. That's the "she disappears".
    hammock.position.y + hammock.userData.lieHeight + restLift,
    hammock.position.z - lengthDir.z * halfHeight
  );

  mom.userData.legs.legL.rotation.x = 0;
  mom.userData.legs.legR.rotation.x = 0;
  mom.userData.arms.armL.rotation.x = 0;
  mom.userData.arms.armR.rotation.x = 0;

  // First person, from her head, looking at the sky. Lying in a hammock is
  // one of the few things in the game with nothing to *do* — the point is
  // the view, and a third-person camera of someone lying still isn't it.
  //
  // Orbit is switched off so the framing holds; the follow-cam is skipped
  // for the same reason (see the guard in animate). Clicking anywhere gets
  // her up again, which restores both.
  controls.enabled = false;
  const headOffset = lengthDir.clone().multiplyScalar(1.24);
  camera.position.set(
    mom.position.x + headOffset.x,
    mom.position.y + 0.18,
    mom.position.z + headOffset.z
  );
  // Deliberately a few degrees off vertical rather than dead-on. Aiming
  // exactly along the camera's own up vector is a degenerate lookAt — the
  // orientation is undefined and the view rolls arbitrarily. The tilt is
  // small enough to read as straight up, and leans back over her head so
  // the horizon sits just out of frame.
  controls.target.set(
    camera.position.x + lengthDir.x * 0.35,
    camera.position.y + 6,
    camera.position.z + lengthDir.z * 0.35
  );
  // Where she's looking, as yaw/pitch about her own head. Yaw starts along
  // her body so the initial view leans back over her; pitch is measured from
  // straight up, so 0 is the zenith.
  // Aimed back down her body toward her feet, not up over her head. Looking
  // straight up is a degenerate lookAt, so the aim is tilted a few degrees
  // to give the roll something to resolve against — and screen-up ends up
  // being world-up projected onto the view, which points *opposite* the
  // tilt. Tilting toward her head therefore put screen-up at her feet and
  // mirrored left and right: the house appeared on the wrong side.
  loungeYaw = Math.atan2(-lengthDir.z, -lengthDir.x);
  loungePitch = LOUNGE_PITCH_MIN;
  loungeYawHome = loungeYaw;
  applyLoungeLook();
  // Otherwise the camera sits inside her head and renders its backfaces.
  mom.visible = false;
}

// Look-around while lying down, driven by dragging.
//
// This can't go through OrbitControls even with it enabled, because orbit
// swings the *camera* around a fixed target — and here the target sits six
// metres above her head, so dragging would carry her viewpoint in a wide arc
// through the air instead of turning her head. First person needs the
// opposite: camera pinned, target moved. So it's a small custom handler.
//
// Pitch is clamped short of the horizon: she can look up, and out at the
// treeline, but not down past her own body at the ground — which both looks
// wrong lying in a hammock and would show the camera clipping through her.
// Yaw is limited either side of her body axis rather than free, because a
// person lying down can turn their head, not spin it.
const LOUNGE_PITCH_MIN = 0.05; // ~3 degrees off the zenith
const LOUNGE_PITCH_MAX = 1.32; // ~76 degrees, a little above the horizon
const LOUNGE_YAW_RANGE = 1.85; // ~106 degrees either side
let loungeYaw = 0;
let loungeYawHome = 0;
let loungePitch = LOUNGE_PITCH_MIN;
let loungeDragging = false;
let loungeLastX = 0;
let loungeLastY = 0;

function applyLoungeLook() {
  const sinP = Math.sin(loungePitch);
  controls.target.set(
    camera.position.x + sinP * Math.cos(loungeYaw) * 6,
    camera.position.y + Math.cos(loungePitch) * 6,
    camera.position.z + sinP * Math.sin(loungeYaw) * 6
  );
  // lookAt rather than controls.update(): update() recomputes the camera
  // position from OrbitControls' own internal state and would immediately
  // undo the head placement.
  camera.lookAt(controls.target);
}

renderer.domElement.addEventListener('pointerdown', (e) => {
  if (!mirandaLounging) return;
  loungeDragging = true;
  loungeLastX = e.clientX;
  loungeLastY = e.clientY;
});
window.addEventListener('pointerup', () => {
  loungeDragging = false;
});
window.addEventListener('pointermove', (e) => {
  if (!mirandaLounging || !loungeDragging) return;
  const dx = e.clientX - loungeLastX;
  const dy = e.clientY - loungeLastY;
  loungeLastX = e.clientX;
  loungeLastY = e.clientY;
  // Both axes match OrbitControls' feel, which is what the drag does
  // everywhere else in the game: drag right and her head turns right, drag
  // down and she looks down toward the treeline. Both were subtracting, so
  // both were backwards — increasing yaw swings the look direction toward the
  // camera's own right, and pitch is measured from the zenith, so *adding* to
  // it is what tilts the view down.
  loungeYaw = clampLoungeYaw(loungeYaw + dx * 0.005);
  loungePitch = Math.min(
    LOUNGE_PITCH_MAX,
    Math.max(LOUNGE_PITCH_MIN, loungePitch + dy * 0.005)
  );
  applyLoungeLook();
});

// Kept as a signed difference from her body axis so the limit works across
// the -pi/pi wrap, which a plain min/max on the raw angle does not.
function clampLoungeYaw(yaw) {
  let d = yaw - loungeYawHome;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return loungeYawHome + Math.min(LOUNGE_YAW_RANGE, Math.max(-LOUNGE_YAW_RANGE, d));
}

function exitHammockLounge() {
  mirandaLounging = false;
  loungeDragging = false;
  mom.quaternion.identity();
  mom.visible = true;
  controls.enabled = true;
}

// On permanently rather than on hover. Hover still reads — it brightens
// (see updateIdleGlows) — but the resting state is lit, so you can tell
// from across the yard that the thing does something.
const hammockGlow = addIdleGlow(
  yard.userData.hammock,
  3.4,
  1.7,
  yard.userData.hammock.userData.attachHeight
);
hammockGlow.userData.hideWhenLounging = true;
let hammockHovered = false;
function setHammockHover(hovered) {
  if (hovered === hammockHovered) return;
  hammockHovered = hovered;
  hammockGlow.userData.hovered = hovered;
  renderer.domElement.style.cursor = hovered ? CURSOR_PAW_ACTIVE : CURSOR_PAW;
}

// The ladder is tall and thin, so its glow is too — a square one centred on
// it would spill halfway across the back wall.
if (yard.userData.ladder) {
  addIdleGlow(yard.userData.ladder, 1.1, 3.6, 1.7);
}

// Poops don't get a single shared glow the way Mom/Darla/the hammock do —
// there can be many of them, so this just tracks whichever *specific* pile
// is currently under the pointer and toggles that one's own glow (see
// spawnPoop) rather than one glow being reparented around.
let hoveredPoop = null;
function setPoopHover(poop) {
  if (poop === hoveredPoop) return;
  if (hoveredPoop) hoveredPoop.userData.hoverGlow.visible = false;
  hoveredPoop = poop;
  if (hoveredPoop) hoveredPoop.userData.hoverGlow.visible = true;
  renderer.domElement.style.cursor = hoveredPoop ? CURSOR_PAW_ACTIVE : CURSOR_PAW;
}

// Hover highlight only makes sense with a mouse (no persistent "hover" on
// touch); pointermove still fires harmlessly during a touch drag, it just
// never matters since nothing reads momHovered/hammockHovered on mobile.
renderer.domElement.addEventListener('pointermove', (e) => {
  setMomHover(gameStarted && playerKind === 'darla' && hitsMom(e.clientX, e.clientY));
  setDarlaHover(gameStarted && playerKind === 'miranda' && hitsDarla(e.clientX, e.clientY));
  setHammockHover(
    gameStarted && playerKind === 'miranda' && !mirandaLounging && hitsHammock(e.clientX, e.clientY)
  );
  setPoopHover(
    gameStarted && playerKind === 'miranda' && momState !== 'pickingUp'
      ? pickPoop(e.clientX, e.clientY)
      : null
  );
});

renderer.domElement.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  pointerDownPos = { x: e.clientX, y: e.clientY };
});
renderer.domElement.addEventListener('pointerup', (e) => {
  // Under pointer lock, clientX/clientY go stale (frozen wherever the
  // cursor was when lock engaged) instead of tracking real position — the
  // normal click-to-act handling below would misfire off that stale
  // point, so this bails out entirely while flying (which owns WASD/mouse
  // itself already).
  if (flightActive) return;
  if (e.button !== 0 || !pointerDownPos) return;
  const dragDist = Math.hypot(e.clientX - pointerDownPos.x, e.clientY - pointerDownPos.y);
  pointerDownPos = null;
  if (dragDist > 6) return; // was an orbit-camera drag, not a click

  if (playerKind === 'darla' && hitsMom(e.clientX, e.clientY)) {
    talkToMiranda();
    return;
  }

  if (leashAiming && playerKind === 'miranda' && hitsDarla(e.clientX, e.clientY)) {
    leashAiming = false;
    leashButton.classList.remove('aiming');
    if (mirandaLounging) exitHammockLounge();
    mirandaLeashTarget = true;
    // Aims for a point DARLA_LEASH_DISTANCE short of Darla along the line
    // to her, rather than her exact position — walks up next to her
    // instead of into her, and arrives at exactly the leash's own resting
    // length so clipping it on doesn't need an immediate tug of slack.
    const dx = darla.position.x - mom.position.x;
    const dz = darla.position.z - mom.position.z;
    const dist = Math.hypot(dx, dz);
    const scale = dist > 0.001 ? Math.max(dist - DARLA_LEASH_DISTANCE, 0) / dist : 0;
    moveTarget = new THREE.Vector3(mom.position.x + dx * scale, 0, mom.position.z + dz * scale);
    clickMarker.position.set(
      moveTarget.x,
      terrainHeight(moveTarget.x, moveTarget.z) + 0.02,
      moveTarget.z
    );
    clickMarker.visible = true;
    return;
  }

  if (playerKind === 'miranda' && hitsDarla(e.clientX, e.clientY)) {
    faceEachOther();
    // faceEachOther only touches the local mom/darla objects — in
    // multiplayer Darla is remote here, so her own client's copy of
    // herself never actually turned to face Miranda. Without this, the
    // very next position sync from her real client (still facing
    // whichever way she originally was) overwrites the snap this just
    // did, which is why it looked like a one-frame flash back to her old
    // direction instead of sticking.
    sendFx('faceMiranda');
    talkToDarla(DIALOGUE_LINES[dialogueIndex % DIALOGUE_LINES.length]);
    dialogueIndex++;
    return;
  }

  // The ladder. Available to whoever is being played rather than Miranda
  // only, unlike the hammock — a dog going up a ladder is a stretch, but
  // it's the sort of stretch this game is made of, and gating it would mean
  // the roof simply doesn't exist for anyone playing Darla.
  if (!climbing && !mirandaLounging && hitsLadder(e.clientX, e.clientY)) {
    if (onRoof) {
      startClimb(true);
    } else {
      ladderTarget = true;
      moveTarget = new THREE.Vector3(HOUSE_LADDER.x, 0, HOUSE_LADDER.standZ);
      clickMarker.position.set(
        moveTarget.x,
        terrainHeight(moveTarget.x, moveTarget.z) + 0.02,
        moveTarget.z
      );
      clickMarker.visible = true;
    }
    return;
  }

  if (playerKind === 'miranda' && !mirandaLounging && hitsHammock(e.clientX, e.clientY)) {
    const hammock = yard.userData.hammock;
    mirandaLoungeTarget = true;
    moveTarget = new THREE.Vector3(hammock.position.x, 0, hammock.position.z);
    clickMarker.position.set(
      moveTarget.x,
      terrainHeight(moveTarget.x, moveTarget.z) + 0.02,
      moveTarget.z
    );
    clickMarker.visible = true;
    return;
  }

  // Clicking a poop as Miranda walks her over there the normal
  // click-to-move way (not the AI's own MOM_WALK_SPEED pathing, which is
  // only for when she's an NPC) — the arrival branch in updateMovement
  // hands off to the actual pickup animation once she's there. Works in
  // multiplayer too now: pickPoop checks remotePoops as well as the real
  // `poops` array, and the eventual pickup sends a 'poopPicked' command so
  // Darla's client (which owns the authoritative array) shrinks/removes
  // the real one too — see updateMomPickup's onComplete in animate().
  if (playerKind === 'miranda' && momState !== 'pickingUp') {
    const clickedPoop = pickPoop(e.clientX, e.clientY);
    if (clickedPoop) {
      if (mirandaLounging) exitHammockLounge();
      momTargetPoop = clickedPoop;
      mirandaPoopTarget = true;
      moveTarget = new THREE.Vector3(clickedPoop.position.x, 0, clickedPoop.position.z);
      clickMarker.position.set(
      moveTarget.x,
      terrainHeight(moveTarget.x, moveTarget.z) + 0.02,
      moveTarget.z
    );
      clickMarker.visible = true;
      return;
    }
  }

  const point = getGroundPoint(e.clientX, e.clientY);
  if (!point) return;

  if (ballAiming) {
    ballAiming = false;
    ballButton.classList.remove('aiming');
    throwBallTo(point.x, point.z);
    return;
  }

  if (cheeseAiming) {
    cheeseAiming = false;
    cheeseButton.classList.remove('aiming');
    throwCheeseTo(point.x, point.z);
    return;
  }

  if (mirandaLounging) exitHammockLounge();
  const clamped = clampTargetPoint(point.x, point.z);
  moveTarget = new THREE.Vector3(clamped.x, 0, clamped.z);
  // The marker sits on whatever she's actually walking on, which on the
  // roof is the shingles — at terrain height it would be buried inside the
  // house, out of sight under her feet.
  const markerY =
    (onRoof ? roofSurfaceY(moveTarget.x, moveTarget.z) : null) ??
    terrainHeight(moveTarget.x, moveTarget.z);
  clickMarker.position.set(moveTarget.x, markerY + 0.02, moveTarget.z);
  clickMarker.visible = true;
});

const WALK_SPEED = 4.2;
// Where a thrown ball or wedge of cheese is allowed to land, and (widened by
// 15 m) how far Miranda's flight can carry her. Back-yard only.
//
// zMin follows the house: it used to be -4, which sat behind the old back wall
// at -7.5, but the house moved back to -1.5 (see HOUSE_Z) and -4 is now inside
// the building — a throw short of the wall would have put the ball indoors.
const YARD_BOUNDS = { xMin: -9, xMax: 9, zMin: 0, zMax: 14 };

// The house is a solid obstacle you walk around. It's a list of boxes
// rather than one, because the building isn't rectangular: the garage and
// the front bay stick out past the main mass, and the screened porch is a
// notch cut *into* the back of it that she's meant to be able to walk into.
// house.js owns those numbers (it's what builds the walls) and exports them
// in world coordinates.
function isInHouseFootprint(x, z) {
  return HOUSE_SOLIDS.some((b) => x > b.xMin && x < b.xMax && z > b.zMin && z < b.zMax);
}

function houseBoxAt(x, z) {
  return HOUSE_SOLIDS.find((b) => x > b.xMin && x < b.xMax && z > b.zMin && z < b.zMax);
}

// Resolves a per-frame move against the house as a solid box using
// axis-separated sliding collision: try the full move, then each axis on
// its own, keeping whichever axes don't land inside the footprint. This is
// what lets Darla slide smoothly along a wall she's walking beside. The old
// approach snapped straight to whichever edge was numerically nearest the
// candidate point, which — especially near a corner, or approaching at a
// shallow angle — could be a different wall than the one she was actually
// pressed up against, yanking her sideways into the house instead of
// blocking just the axis that was actually obstructed.
function pushOutOfHouse(prevX, prevZ, x, z) {
  if (!isInHouseFootprint(x, z)) return { x, z };
  if (!isInHouseFootprint(x, prevZ)) return { x, z: prevZ };
  if (!isInHouseFootprint(prevX, z)) return { x: prevX, z };
  return { x: prevX, z: prevZ };
}

// Used only for picking a click-to-move destination, where there's no
// "previous position" to slide from — just projects an arbitrary clicked
// point to the nearest valid point outside the house footprint.
function nearestPointOutsideHouse(x, z) {
  const box = houseBoxAt(x, z);
  if (!box) return { x, z };
  const distLeft = x - box.xMin;
  const distRight = box.xMax - x;
  const distFront = box.zMax - z;
  const distBack = z - box.zMin;
  // Try the four ways out in order of how far each one is, and take the
  // first that isn't inside some *other* part of the house — pushing
  // straight out of the garage, say, can land you inside the main mass it's
  // attached to. Falling all the way through means she was somewhere deep
  // inside the building, so put her out front by the door.
  const exits = [
    { d: distFront, p: { x, z: box.zMax } },
    { d: distBack, p: { x, z: box.zMin } },
    { d: distLeft, p: { x: box.xMin, z } },
    { d: distRight, p: { x: box.xMax, z } },
  ].sort((a, b) => a.d - b.d);
  const clear = exits.find((e) => !isInHouseFootprint(e.p.x, e.p.z));
  // Last resort (every way out of this box lands in another): put her on the
  // back walk, which is always outside the building and always reachable.
  return clear ? clear.p : { x, z: HOUSE_BACK_WALK_Z };
}

// The fire pit is solid too. It gets a radial push-out rather than the house's
// axis-separated slide, because it's round: projecting the point back out along
// its own radius is both simpler and what makes her skirt smoothly around it,
// where a box would catch on invisible corners.
//
// Stateless, unlike pushOutOfHouse, which is why the same function serves both
// the per-frame move and the click-to-move destination.
//
// The margin is deliberately tight. Miranda's home spot beside the fire is
// 1.08 out from the centre (see MOM_HOME) and hanging out by the fire is the
// whole point of her, so the blocked radius has to stay under that or she can
// never stand where she belongs.
const FIRE_PIT_CLEARANCE = FIRE_PIT.radius + 0.3;

// Deliberately a smaller radius than the one the push-out uses, and the gap is
// load-bearing rather than a fudge. Being pushed out leaves you resting at
// *exactly* FIRE_PIT_CLEARANCE, and re-measuring that point with hypot can
// come back a hair under it. Testing "am I inside?" against the same radius
// therefore flips to true the moment you touch the rim, which exempts you from
// the push, which lets you walk straight through — the collision worked right
// up until you leaned on it. The margin means a point resting on the boundary
// is unambiguously outside, and only being properly in the pit (having jumped
// in) counts as inside.
const FIRE_PIT_INSIDE = FIRE_PIT_CLEARANCE - 0.08;

function insideFirePit(x, z) {
  return Math.hypot(x - FIRE_PIT.x, z - FIRE_PIT.z) < FIRE_PIT_INSIDE;
}

// Jump onto the pit and you stand on the stonework, not down in the fire.
//
// The rim is the only thing in the yard that isn't terrain but can be stood
// on, so this stays a special case rather than becoming a general height-field
// — one prop doesn't justify one.
//
// Note the radius: the *stone ring's* outer face, not the wider radius the pit
// blocks and clears grass at. Standing extends only as far as there is
// actually something under your feet, so landing in the gap between the
// stonework and the collision boundary leaves you on the grass beside the pit,
// which is what it looks like.
const FIRE_PIT_RIM_Y = terrainHeight(FIRE_PIT.x, FIRE_PIT.z) + FIRE_PIT.rimHeight;

// The house's own base height. The graded pad is dead flat out to
// TERRAIN_PAD (see terrainHeight), and the house sits at its centre, so
// this one number serves the whole roof rather than needing a per-point
// terrain sample under a building that is level by construction.
const HOUSE_GROUND_Y = terrainHeight(0, HOUSE_ORIGIN_Z);

// True only while she's actually up there. It has to be a state rather than
// a test on position, because the roof and the lawn overlap in plan: if
// groundHeightAt simply returned the roof whenever you stood inside the
// building's outline, walking *past* the house at ground level would
// teleport you onto it.
let onRoof = false;

// Absolute world height of the roof surface at a point, or null off it.
function roofSurfaceY(x, z) {
  const local = houseRoofHeight(x, z);
  return local === null ? null : HOUSE_GROUND_Y + local;
}

function groundHeightAt(x, z) {
  if (onRoof) {
    const roof = roofSurfaceY(x, z);
    if (roof !== null) return roof;
  }
  if (Math.hypot(x - FIRE_PIT.x, z - FIRE_PIT.z) < FIRE_PIT.rimRadius) {
    return FIRE_PIT_RIM_Y;
  }
  return terrainHeight(x, z);
}

// Slides her along the chimney rather than stopping her dead at it — the
// same axis-separated approach the house walls use, and for the same
// reason: walking into a corner should let you keep moving along the face
// you're pressed against instead of sticking.
//
// Takes the previous position because that's what says which face she came
// in through. Whichever axis she had already cleared before this step is
// the one that gets pushed back.
function pushOutOfChimney(prevX, prevZ, x, z) {
  const c = HOUSE_CHIMNEY;
  const insideX = Math.abs(x - c.x) < c.halfX;
  const insideZ = Math.abs(z - c.z) < c.halfZ;
  if (!insideX || !insideZ) return { x, z };

  const wasOutsideX = Math.abs(prevX - c.x) >= c.halfX;
  const wasOutsideZ = Math.abs(prevZ - c.z) >= c.halfZ;
  // Coming in through a face: undo only that axis. Coming in diagonally
  // through the corner (or starting inside, which shouldn't happen but
  // would otherwise trap her), take the shallower of the two pushes.
  const outX = c.x + Math.sign(x - c.x || 1) * c.halfX;
  const outZ = c.z + Math.sign(z - c.z || 1) * c.halfZ;
  if (wasOutsideX && !wasOutsideZ) return { x: outX, z };
  if (wasOutsideZ && !wasOutsideX) return { x, z: outZ };
  return Math.abs(outX - x) < Math.abs(outZ - z) ? { x: outX, z } : { x, z: outZ };
}

// The hammock, as an oriented box: rotate the point into the hammock's own
// frame, do the ordinary axis-separated push there, rotate the result back.
//
// Exempt while she's on her way into it or already lying in it. Without
// that the collision defeats the interaction entirely — clicking the
// hammock walks her to its centre, which is exactly the point this pushes
// her away from, so she'd be shoved off before ever arriving and the
// arrival test would never fire.
const _hamCos = Math.cos(-HAMMOCK.rotation);
const _hamSin = Math.sin(-HAMMOCK.rotation);
function pushOutOfHammock(prevX, prevZ, x, z) {
  if (mirandaLounging || mirandaLoungeTarget) return { x, z };

  const toLocal = (wx, wz) => {
    const dx = wx - HAMMOCK.x;
    const dz = wz - HAMMOCK.z;
    return { x: dx * _hamCos - dz * _hamSin, z: dx * _hamSin + dz * _hamCos };
  };
  const p = toLocal(x, z);
  if (Math.abs(p.x) >= HAMMOCK.halfLength || Math.abs(p.z) >= HAMMOCK.halfWidth) {
    return { x, z };
  }

  const prev = toLocal(prevX, prevZ);
  const wasOutX = Math.abs(prev.x) >= HAMMOCK.halfLength;
  const wasOutZ = Math.abs(prev.z) >= HAMMOCK.halfWidth;
  const outX = Math.sign(p.x || 1) * HAMMOCK.halfLength;
  const outZ = Math.sign(p.z || 1) * HAMMOCK.halfWidth;
  let local;
  if (wasOutX && !wasOutZ) local = { x: outX, z: p.z };
  else if (wasOutZ && !wasOutX) local = { x: p.x, z: outZ };
  else local = Math.abs(outX - p.x) < Math.abs(outZ - p.z)
    ? { x: outX, z: p.z }
    : { x: p.x, z: outZ };

  // Back to world. Inverse of the rotation above, so the signs flip.
  return {
    x: HAMMOCK.x + local.x * _hamCos + local.z * _hamSin,
    z: HAMMOCK.z - local.x * _hamSin + local.z * _hamCos,
  };
}

function pushOutOfFirePit(x, z) {
  const dx = x - FIRE_PIT.x;
  const dz = z - FIRE_PIT.z;
  const dist = Math.hypot(dx, dz);
  if (dist >= FIRE_PIT_CLEARANCE) return { x, z };
  // Dead centre has no direction to push along. Only reachable by spawning
  // exactly on it with ?at=, but it would divide by zero if it happened.
  if (dist < 1e-4) return { x: FIRE_PIT.x + FIRE_PIT_CLEARANCE, z: FIRE_PIT.z };
  const scale = FIRE_PIT_CLEARANCE / dist;
  return { x: FIRE_PIT.x + dx * scale, z: FIRE_PIT.z + dz * scale };
}

// Keeps her within the generated world (see generateWorld/WORLD_RADIUS
// above) — pulled in a bit short of the actual generation radius, so she
// always stays comfortably inside real trees/fog rather than able to walk
// out to the literal edge of what got generated and see it stop.
// Right out to the edge of what's generated, less a metre so you can't
// quite stand on the boundary and look at nothing.
//
// It used to hold you 5 m short, which was the right call when the far
// corner was empty hillside — but the pond is out there now, at a radius
// of about 51, and the old clamp stopped you 1 m before reaching it. The
// cost of opening it up is that the outer ring genuinely is bare: grass
// has faded out by 44 and the terrain flattens to zero past
// TERRAIN_RADIUS. Walkable, as asked, but there is nothing to find between
// the pond and the edge.
const MOVEMENT_RADIUS = WORLD_RADIUS - 1;

function clampToWorldRadius(x, z) {
  const dist = Math.hypot(x, z);
  if (dist <= MOVEMENT_RADIUS) return { x, z };
  const scale = MOVEMENT_RADIUS / dist;
  return { x: x * scale, z: z * scale };
}

// Used for the per-frame movement step.
function clampToWalkable(prevX, prevZ, x, z) {
  // On the roof you are *above* the building, so its walls must stop
  // blocking you — otherwise the whole roof is unreachable ground sitting
  // inside a solid box. Walking off the edge is handled by beginFallOffRoof
  // rather than by a wall.
  //
  // The chimney is the exception: it's the one part of the house that is
  // still solid when you're standing on top of the rest of it.
  if (onRoof) {
    const past = pushOutOfChimney(prevX, prevZ, x, z);
    return clampToWorldRadius(past.x, past.z);
  }
  const pushed = pushOutOfHouse(prevX, prevZ, x, z);
  // The pit stops you *walking* in, but you're allowed to jump in if you want
  // to. Two exemptions make that work: airborne, so a jump can carry you over
  // the rim instead of hitting an invisible wall mid-flight; and already
  // inside, so having landed in there you can move about and walk back out
  // under your own steam rather than being spat straight out again.
  const exempt = isJumping || insideFirePit(prevX, prevZ);
  const clear = exempt ? pushed : pushOutOfFirePit(pushed.x, pushed.z);
  const past = isJumping ? clear : pushOutOfHammock(prevX, prevZ, clear.x, clear.z);
  // Trunks. Exempt while airborne for the same reason the fire pit is —
  // being stopped in mid-jump by something at ground level reads as an
  // invisible wall — and because a jump arcing past a tree shouldn't care.
  const trees = isJumping ? past : pushOutOfTrees(past.x, past.z);
  return clampToWorldRadius(trees.x, trees.z);
}

// Used for picking a click-to-move destination — a stateless best-guess
// clamp, same idea as clampToWalkable but with no previous position to
// slide from.
function clampTargetPoint(x, z) {
  // Same exemption as clampToWalkable: up on the roof you are above the
  // building, so pushing the destination out of its footprint would make
  // every point up there unreachable.
  if (onRoof) return clampToWorldRadius(x, z);
  const outside = nearestPointOutsideHouse(x, z);
  const clear = pushOutOfFirePit(outside.x, outside.z);
  // So clicking on a trunk walks you to the near side of it rather than
  // setting a destination inside it that she can never actually reach.
  const trees = pushOutOfTrees(clear.x, clear.z);
  return clampToWorldRadius(trees.x, trees.z);
}

const cameraForward = new THREE.Vector3();
const cameraRight = new THREE.Vector3();
const moveDir = new THREE.Vector3();
const worldUp = new THREE.Vector3(0, 1, 0);
const followOffset = new THREE.Vector3();

// How far above the player's feet the camera aims, which is not one number:
// zoomed out you want the whole character framed, so it sits mid-body;
// zoomed in you want their face, so it climbs to eye height. A fixed 0.5 put
// the pivot at Miranda's waist, so zooming in got you a close-up of her
// corset while her head sat off the top of the screen.
//
// It's per-character because they're wildly different heights — Miranda's
// eyes are at 1.55, Darla's are barely off the grass.
const CAMERA_AIM = {
  darla: { eye: 0.6, body: 0.45 },
  miranda: { eye: 1.53, body: 0.95 },
};
function cameraAimHeight() {
  const aim = CAMERA_AIM[playerKind] ?? CAMERA_AIM.darla;
  const distance = camera.position.distanceTo(controls.target);
  // Fully at eye height by 1.5 units out, fully at body height from 5.
  const t = THREE.MathUtils.clamp((distance - 1.5) / 3.5, 0, 1);
  return THREE.MathUtils.lerp(aim.eye, aim.body, t);
}

function wrapAngle(angle) {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}

// Darla's tiny AI, active only while Miranda is the one being played: sit
// by the fire, and whenever Miranda throws the ball, run over, grab it,
// and trot back to Miranda — the mirror image of Mom's own poop-collecting
// AI below (nearest-target, walk-toward-it, rotate-to-face idiom), just
// with a single ball instead of a list of poops. Miranda is `player` here
// (fetch only ever runs in Miranda-mode), and re-reads her live position
// every frame rather than a fixed spot, since she can keep walking around
// while Darla is out fetching.
// An eager sprint, not just her normal walk — matches the 1.6x stride
// speedup her walk-cycle animation already fakes while fetching (see the
// ballState === 'thrown' check in the stride calc below).
const DARLA_FETCH_SPEED = WALK_SPEED * 1.6;
const darlaFetchDir = new THREE.Vector3();
let darlaFetchState = 'idle'; // 'idle' | 'fetching' | 'returning'

// Returns whether she's currently moving, so the caller can drive her walk
// animation/bob the same way updateMovement's isMoving return value does
// for whichever character is actually player-controlled.
function updateDarlaFetch(delta) {
  if (darlaFetchState === 'idle') return false;

  const returning = darlaFetchState === 'returning';
  // Targets `mom` explicitly rather than `player` — in single-player this
  // only ever runs while playerKind is 'miranda' (player === mom anyway),
  // but in multiplayer it runs on Darla's own client, where player ===
  // darla instead. `mom` is correct in both cases either way.
  const target = returning ? mom.position : ball.position;
  darlaFetchDir.set(target.x - darla.position.x, 0, target.z - darla.position.z);
  const dist = darlaFetchDir.length();
  // Returning stops well short of Miranda's own position (unlike the 0.35
  // used for reaching the ball itself) so Darla ends up standing next to
  // her instead of walking into/through her — needs to clear both her
  // skirt's radius (~0.22) and Darla's own body length. 0.6 wasn't quite
  // enough in practice — she'd still visibly overlap Miranda's skirt on
  // approach — so this is padded further out.
  const arriveDist = returning ? 1.2 : 0.35;
  if (dist < arriveDist) {
    if (returning) {
      darlaFetchState = 'idle';
      ballState = 'idle';
      ballButton.disabled = false;
      ballButton.classList.remove('disabled');
      // Same completion covers both fetch and call-Darla-over, since both
      // end on this leg — in multiplayer, only Darla's own client reaches
      // this (see the darlaCommandable gate in animate), so Miranda's
      // client needs telling to release its own guard/button state too.
      sendCommand('fetchDone');
    } else {
      ball.visible = false;
      playBarkSound();
      darlaFetchState = 'returning';
      // Only hides it on Darla's own client (this only runs there in
      // multiplayer) — Miranda's client is what actually broadcasts
      // ball.visible each tick (see sendNetworkState), and her own local
      // copy stayed true the whole way back until fetchDone reset it,
      // overwriting this the moment her next sync arrived. This is what
      // was making the ball look like it never got picked up at all.
      sendCommand('ballGrabbed');
    }
    return false;
  }

  darlaFetchDir.normalize();
  // Capped at the remaining distance so a large delta spike (a throttled/
  // backgrounded tab catching up — plausible here specifically, since
  // being called over or sent fetching doesn't need the Darla player's
  // own input at all) can't overshoot straight past the target in one
  // frame — without this, that read as her randomly snapping/teleporting
  // rather than walking.
  const step = Math.min(dist, DARLA_FETCH_SPEED * delta);
  darla.position.x += darlaFetchDir.x * step;
  darla.position.z += darlaFetchDir.z * step;
  const targetAngle = Math.atan2(darlaFetchDir.x, darlaFetchDir.z);
  darla.rotation.y += wrapAngle(targetAngle - darla.rotation.y) * Math.min(1, delta * 10);
  return true;
}

// Same idiom again for the cheese trick, except she doesn't bring
// anything back — she eats it in place, then poops and takes a few steps
// off (rather than trotting all the way home to Miranda the way fetch
// does), so Miranda/Mom actually have room to reach the poop instead of
// it landing right underneath her.
const DARLA_CHEESE_EAT_DURATION = 0.5;
const DARLA_CHEESE_WALKAWAY_DIST = 1.5;
const darlaCheeseDir = new THREE.Vector3();
let darlaCheeseState = 'idle'; // 'idle' | 'going' | 'eating' | 'walkingAway'
let darlaCheeseElapsed = 0;
let darlaCheeseWalked = 0;

function updateDarlaCheese(delta) {
  if (darlaCheeseState === 'idle') return false;

  if (darlaCheeseState === 'going') {
    darlaCheeseDir.set(cheese.position.x - darla.position.x, 0, cheese.position.z - darla.position.z);
    const dist = darlaCheeseDir.length();
    if (dist < 0.35) {
      darlaCheeseState = 'eating';
      darlaCheeseElapsed = 0;
      return false;
    }
    darlaCheeseDir.normalize();
    // Same overshoot cap as updateDarlaFetch above, same reason.
    const step = Math.min(dist, DARLA_FETCH_SPEED * delta);
    darla.position.x += darlaCheeseDir.x * step;
    darla.position.z += darlaCheeseDir.z * step;
    const targetAngle = Math.atan2(darlaCheeseDir.x, darlaCheeseDir.z);
    darla.rotation.y += wrapAngle(targetAngle - darla.rotation.y) * Math.min(1, delta * 10);
    return true;
  }

  if (darlaCheeseState === 'eating') {
    // a quick head-dip chomp, then she poops right where she's standing
    // and heads off a few steps before the cheese/button reset for next
    // time (see 'walkingAway' below).
    darlaCheeseElapsed += delta;
    const t = Math.min(darlaCheeseElapsed / DARLA_CHEESE_EAT_DURATION, 1);
    darla.userData.head.rotation.x = -Math.sin(t * Math.PI) * 0.3;
    if (t >= 1) {
      darla.userData.head.rotation.x = 0;
      cheese.visible = false;
      cheeseState = 'idle';
      spawnPoop();
      // Continues in whatever direction she's already facing — no target
      // object to steer toward here, just "put some distance between
      // herself and the spot she just pooped on," captured once rather
      // than recomputed every frame.
      darlaCheeseDir.set(Math.sin(darla.rotation.y), 0, Math.cos(darla.rotation.y));
      darlaCheeseWalked = 0;
      darlaCheeseState = 'walkingAway';
    }
    return false;
  }

  // walkingAway: a short trot clear of the poop pile, then the actual
  // cheese/button reset for next time — held off until now (rather than
  // right after eating) so Miranda can't throw a second cheese while
  // she's still standing on top of the first poop.
  const step = Math.min(DARLA_CHEESE_WALKAWAY_DIST - darlaCheeseWalked, DARLA_FETCH_SPEED * delta);
  darla.position.x += darlaCheeseDir.x * step;
  darla.position.z += darlaCheeseDir.z * step;
  darlaCheeseWalked += step;
  if (darlaCheeseWalked >= DARLA_CHEESE_WALKAWAY_DIST - 0.001) {
    cheeseButton.disabled = false;
    cheeseButton.classList.remove('disabled');
    darlaCheeseState = 'idle';
    sendCommand('cheeseDone');
  }
  return true;
}

// Mom's tiny AI: stand by the fire, and whenever Darla leaves a poop
// behind, walk over, bend down to collect it, and head back home. Reuses
// the same "nearest unclaimed target, walk toward it, rotate to face
// travel direction" idiom as Darla's own click-to-move.
const MOM_HOME = new THREE.Vector3(mom.position.x, 0, mom.position.z);
const MOM_WALK_SPEED = 2.6;
const MOM_PICKUP_DURATION = 0.7;
const momMoveDir = new THREE.Vector3();
let momState = 'idle'; // 'idle' | 'walking' | 'pickingUp'
let momTargetPoop = null;
let momPickupElapsed = 0;
// Once the backlog gets past 5, she grabs the shovel instead of picking up
// by hand — still one poop per pickup either way, just a different tool/
// animation for a big mess.
const MOM_SHOVEL_THRESHOLD = 5;
let momUsingShovel = false;

function resetMomLimbs() {
  mom.userData.legs.legL.rotation.x = 0;
  mom.userData.legs.legR.rotation.x = 0;
  mom.userData.arms.armL.rotation.x = 0;
  mom.userData.arms.armR.rotation.x = 0;
}

// Checked live every frame (rather than snapshotted once when a fetch
// starts) so the shovel reflects the current backlog even if more poops
// land while she's already out collecting an earlier one. Hysteresis: once
// she's grabbed the shovel she keeps using it down to the last poop,
// rather than swapping back to picking up by hand the instant the count
// dips back under the threshold. Shared between the AI (updateMom below)
// and Miranda's own player-triggered pickups, so a big backlog gets her
// the shovel either way.
function updateMomShovel() {
  momUsingShovel = momUsingShovel ? totalPoopCount() > 1 : totalPoopCount() >= MOM_SHOVEL_THRESHOLD;
  mom.userData.shovel.visible = momUsingShovel;
}

// The actual bend-down-and-shrink-the-poop animation, shared between the
// AI walking herself over to the nearest one (updateMom) and Miranda
// clicking a specific pile and walking over there herself
// (updateMovement's mirandaPoopTarget handoff) — only *what happens next*
// once she's done differs between those two callers, hence `onComplete`
// instead of hardcoding a next momState here.
// A merged pile only loses one poop per pickup, same as an unmerged one —
// shrink it back down a growth step rather than clearing the whole pile in
// one go, so a pile of 5 genuinely takes 5 pickups. Shared between the
// local pickup animation (updateMomPickup, whichever poop it targets — a
// real one or, on Miranda's client in multiplayer, a remote-rendered
// stand-in) and applyRemoteCommand's 'poopPicked' handler, which applies
// the exact same mutation to the *authoritative* copy on Darla's client.
function removeOrShrinkPoop(poop) {
  if (poop.userData.growth > 0) {
    poop.userData.growth -= 1;
    poop.scale.setScalar(1 + poop.userData.growth * POOP_GROWTH_PER_MERGE);
  } else {
    scene.remove(poop);
    poop.traverse((child) => {
      if (child.isMesh) child.geometry.dispose();
    });
    const idx = poops.indexOf(poop);
    if (idx !== -1) poops.splice(idx, 1);
  }
}

// onComplete receives the poop's id — needed by the Miranda-click-in-
// multiplayer caller (animate) to tell Darla's client which one to also
// remove/shrink on the authoritative side; the AI-mode caller (updateMom)
// just ignores it.
function updateMomPickup(delta, onComplete) {
  // Nothing to pick up means something cancelled it mid-scoop — a bite, in
  // practice. Bailing here rather than letting the completion branch below
  // read `.userData` off null, which is a crash rather than a glitch.
  if (!momTargetPoop) return;
  resetMomLimbs();
  momPickupElapsed += delta;
  const t = Math.min(momPickupElapsed / MOM_PICKUP_DURATION, 1);
  const bend = Math.sin(t * Math.PI) * (momUsingShovel ? 0.3 : 0.55);
  mom.rotation.x = bend;
  mom.position.y = terrainHeight(mom.position.x, mom.position.z) - bend * 0.15;
  if (momUsingShovel) {
    mom.userData.arms.armR.rotation.x = Math.sin(t * Math.PI) * 0.9;
  }
  if (t >= 1) {
    mom.rotation.x = 0;
    mom.position.y = terrainHeight(mom.position.x, mom.position.z);
    mom.userData.arms.armR.rotation.x = 0;
    const poopId = momTargetPoop.userData.id;
    removeOrShrinkPoop(momTargetPoop);
    momTargetPoop = null;
    onComplete(poopId);
  }
}

function updateMom(delta) {
  updateMomShovel();

  if (momState === 'idle') {
    resetMomLimbs();
    if (poops.length === 0) return;
    // Bitten at some point, so she is off poop duty for good and stands at
    // the fire letting it pile up. Tested here rather than at the top of
    // updateMom so the walk home still runs — she retreats first, then
    // refuses to work, which reads as her giving up rather than as the AI
    // freezing mid-stride.
    if (momQuitPoopDuty) return;
    let nearest = poops[0];
    let nearestDist = mom.position.distanceTo(nearest.position);
    for (let i = 1; i < poops.length; i++) {
      const dist = mom.position.distanceTo(poops[i].position);
      if (dist < nearestDist) {
        nearest = poops[i];
        nearestDist = dist;
      }
    }
    momTargetPoop = nearest;
    momState = 'walking';
    return;
  }

  if (momState === 'walking') {
    const target = momTargetPoop ? momTargetPoop.position : MOM_HOME;
    momMoveDir.set(target.x - mom.position.x, 0, target.z - mom.position.z);
    const dist = momMoveDir.length();
    if (dist < 0.2) {
      if (momTargetPoop) {
        momState = 'pickingUp';
        momPickupElapsed = 0;
      } else {
        momState = 'idle';
      }
      return;
    }

    // Steer around the fire pit rather than cutting through it — a simple
    // repulsion nudge (stronger the closer she gets) is enough for one
    // small circular prop, no real pathfinding needed.
    const fpDx = mom.position.x - FIRE_PIT.x;
    const fpDz = mom.position.z - FIRE_PIT.z;
    const fpDist = Math.hypot(fpDx, fpDz);
    const avoidRadius = FIRE_PIT.radius + 0.5;
    if (fpDist < avoidRadius && fpDist > 0.001) {
      const push = (avoidRadius - fpDist) / avoidRadius;
      momMoveDir.x += (fpDx / fpDist) * push * 2;
      momMoveDir.z += (fpDz / fpDist) * push * 2;
    }

    momMoveDir.normalize();
    mom.position.x += momMoveDir.x * MOM_WALK_SPEED * delta;
    mom.position.z += momMoveDir.z * MOM_WALK_SPEED * delta;
    // The repulsion above only steers her; it can still be overpowered by a
    // poop sitting right against the stones. This is the hard stop, and it's
    // the same one the player gets.
    const momTrees = pushOutOfTrees(mom.position.x, mom.position.z);
    mom.position.x = momTrees.x;
    mom.position.z = momTrees.z;
    const momClear = pushOutOfFirePit(mom.position.x, mom.position.z);
    mom.position.x = momClear.x;
    mom.position.z = momClear.z;
    mom.position.y =
      terrainHeight(mom.position.x, mom.position.z) + Math.abs(Math.sin(elapsed * 9)) * 0.02;
    const targetAngle = Math.atan2(momMoveDir.x, momMoveDir.z);
    mom.rotation.y += wrapAngle(targetAngle - mom.rotation.y) * Math.min(1, delta * 8);

    const stride = elapsed * 10;
    mom.userData.legs.legL.rotation.x = Math.sin(stride) * 0.5;
    mom.userData.legs.legR.rotation.x = Math.sin(stride + Math.PI) * 0.5;
    mom.userData.arms.armL.rotation.x = Math.sin(stride + Math.PI) * 0.35;
    mom.userData.arms.armR.rotation.x = Math.sin(stride) * 0.35;
    return;
  }

  // pickingUp: a quick bend-down-and-back-up while the poop disappears, or
  // — with the shovel out — a shallower bend plus a scoop-and-flick swing
  // of the right arm instead, since a full shovel scoop still only clears
  // one poop per swing, same as picking up by hand.
  updateMomPickup(delta, () => {
    // If there's another poop waiting, go idle so the branch above picks
    // the nearest one immediately next frame instead of detouring home
    // first — only actually heads back to MOM_HOME once there's nothing
    // left to clean up.
    momState = poops.length > 0 ? 'idle' : 'walking';
  });
}

function updateMovement(delta) {
  // In multiplayer, Miranda can temporarily force Darla's movement (fetch,
  // cheese, being called over, the leash) — the same "AI takes over" idiom
  // single-player already uses, just driven by network commands instead
  // of local AI decisions on the same client. WASD/click-to-move are
  // locked out on Darla's own client for as long as one of those is
  // active, the same way mirandaLounging already locks out Miranda's own
  // movement below. The leash specifically doesn't lock out an active bite
  // chase, though — biting is how she gets free of it (see triggerBite),
  // so she needs to be able to close the last bit of distance herself
  // rather than being stuck exactly at the leash's own resting length,
  // just out of bite range.
  if (
    isMultiplayer &&
    playerKind === 'darla' &&
    (darlaFetchState !== 'idle' || darlaCheeseState !== 'idle' || (darlaLeashed && !biteChasing))
  ) {
    // Clears out any click-to-move target she already had queued up
    // rather than just leaving it sitting there — otherwise the moment
    // the command ends and this guard stops firing, she'd resume walking
    // toward wherever that stale target was, which looks exactly like
    // randomly taking off right after finishing the errand.
    moveTarget = null;
    clickMarker.visible = false;
    return false;
  }

  // Both mouse buttons held counts as forward, and deliberately goes in here
  // rather than beside it: everything downstream that treats forward as "the
  // player is driving" — cancelling a click-to-move target, waking her out of
  // the hammock — then applies to the mouse chord for free.
  // Nothing drives her while she's on the ladder. The tween is short and
  // uninterruptible by design (see startClimb) — accepting input here would
  // let her walk off mid-rung with her position still being written by
  // updateClimb.
  if (climbing) {
    moveTarget = null;
    clickMarker.visible = false;
    return true;
  }

  // Free-fly owns WASD outright: the same keys steer the debug camera, so
  // flying across the yard to look at something walked the character the
  // same distance underneath you — and with the camera detached from her
  // in this mode, you didn't find out until you switched back. Only the
  // keys are taken away; click-to-move still works, and the panel's fixed
  // camera gives her the keyboard back.
  const driving = !debugFreeFly;
  const keyUp = driving &&
    (pressedKeys.has('KeyW') || pressedKeys.has('ArrowUp') || bothMouseButtonsHeld);
  const keyDown = driving && (pressedKeys.has('KeyS') || pressedKeys.has('ArrowDown'));
  const keyRight = driving && (pressedKeys.has('KeyD') || pressedKeys.has('ArrowRight'));
  const keyLeft = driving && (pressedKeys.has('KeyA') || pressedKeys.has('ArrowLeft'));
  const keyboardActive = keyUp || keyDown || keyRight || keyLeft;

  // Frozen in the hammock until WASD wakes her back up (a click-elsewhere
  // wakes her too, but that's handled where the click sets moveTarget,
  // since by then this function needs to already treat her as not lounging
  // in order to actually walk her there).
  if (mirandaLounging) {
    if (!keyboardActive) return false;
    exitHammockLounge();
  }

  camera.getWorldDirection(cameraForward);
  cameraForward.y = 0;
  cameraForward.normalize();
  cameraRight.crossVectors(cameraForward, worldUp);

  moveDir.set(0, 0, 0);

  if (keyboardActive) {
    moveTarget = null;
    clickMarker.visible = false;
    if (keyUp) moveDir.add(cameraForward);
    if (keyDown) moveDir.sub(cameraForward);
    if (keyRight) moveDir.add(cameraRight);
    if (keyLeft) moveDir.sub(cameraRight);
  } else if (moveTarget) {
    const dx = moveTarget.x - player.position.x;
    const dz = moveTarget.z - player.position.z;
    if (Math.hypot(dx, dz) > 0.12) {
      moveDir.set(dx, 0, dz);
    } else {
      moveTarget = null;
      clickMarker.visible = false;
      if (ladderTarget) {
        ladderTarget = false;
        startClimb(false);
      } else if (mirandaLoungeTarget) {
        mirandaLoungeTarget = false;
        enterHammockLounge();
      } else if (mirandaPoopTarget) {
        mirandaPoopTarget = false;
        momState = 'pickingUp';
        momPickupElapsed = 0;
      } else if (mirandaLeashTarget) {
        mirandaLeashTarget = false;
        setDarlaLeashed(true);
        sendCommand('leashOn');
      }
    }
  }

  const isMoving = moveDir.lengthSq() > 0.0001;
  if (isMoving) {
    moveDir.normalize();
    const clamped = clampToWalkable(
      player.position.x,
      player.position.z,
      player.position.x + moveDir.x * WALK_SPEED * delta,
      player.position.z + moveDir.z * WALK_SPEED * delta
    );
    player.position.x = clamped.x;
    player.position.z = clamped.z;

    const targetAngle = Math.atan2(moveDir.x, moveDir.z);
    player.rotation.y += wrapAngle(targetAngle - player.rotation.y) * Math.min(1, delta * 10);
  }

  return isMoving;
}

function updateWalkCycle(isMoving, jumping, flying) {
  const legs = darla.userData.legs;
  if (flying) {
    const kick = elapsed * 14;
    legs.legFR.rotation.x = Math.sin(kick) * 0.6 - 0.2;
    legs.legFL.rotation.x = Math.sin(kick + Math.PI) * 0.6 - 0.2;
    legs.legBR.rotation.x = Math.sin(kick + Math.PI) * 0.5 + 0.3;
    legs.legBL.rotation.x = Math.sin(kick) * 0.5 + 0.3;
    return 0;
  }
  if (jumping) {
    legs.legFR.rotation.x = -0.5;
    legs.legFL.rotation.x = -0.5;
    legs.legBR.rotation.x = 0.4;
    legs.legBL.rotation.x = 0.4;
    return 0;
  }
  if (isMoving) {
    // Faster stride specifically while she's off on a fetch/call errand
    // (darlaFetchState stays non-'idle' for the whole out-and-back trip,
    // whether that's chasing a thrown ball or just coming when called —
    // see updateDarlaFetch) — an eager sprint rather than her normal
    // walk/player-driven pace.
    const stride = elapsed * (darlaFetchState !== 'idle' ? 19 * 1.6 : 19);
    legs.legFR.rotation.x = Math.sin(stride) * 0.55;
    legs.legBL.rotation.x = Math.sin(stride) * 0.55;
    legs.legFL.rotation.x = Math.sin(stride + Math.PI) * 0.55;
    legs.legBR.rotation.x = Math.sin(stride + Math.PI) * 0.55;
    return Math.abs(Math.sin(stride * 2)) * 0.035;
  }
  legs.legFR.rotation.x = 0;
  legs.legFL.rotation.x = 0;
  legs.legBR.rotation.x = 0;
  legs.legBL.rotation.x = 0;
  return Math.sin(elapsed * 1.6) * 0.01;
}

// Miranda's own walk cycle when she's the one being played — the same
// arm/leg swing her fire-pit AI already uses in updateMom's 'walking'
// state below, just driven by player input instead of a pathing target.
// She has no jump pose (no skills beyond walking), so the vertical offset
// during a jump is just whatever updateJump contributes on its own.
function updateMirandaWalkCycle(isMoving) {
  const legs = mom.userData.legs;
  const arms = mom.userData.arms;
  if (isMoving) {
    const stride = elapsed * 10;
    legs.legL.rotation.x = Math.sin(stride) * 0.5;
    legs.legR.rotation.x = Math.sin(stride + Math.PI) * 0.5;
    arms.armL.rotation.x = Math.sin(stride + Math.PI) * 0.35;
    arms.armR.rotation.x = Math.sin(stride) * 0.35;
    return Math.abs(Math.sin(stride * 2)) * 0.02;
  }
  legs.legL.rotation.x = 0;
  legs.legR.rotation.x = 0;
  arms.armL.rotation.x = 0;
  arms.armR.rotation.x = 0;
  return 0;
}

// ── sitting ─────────────────────────────────────────────────────────────
//
// Poses rather than a cycle: both characters have a single sit pose that the
// rig blends into, so this is a set of target angles plus a blend weight
// rather than anything driven by `elapsed`.
//
// It runs *after* the walk cycle each frame and lerps from whatever that
// left behind toward the targets. That ordering is deliberate — it means the
// blend handles the transition for free (sit down mid-stride and the legs
// swing from wherever they were), and it means no state has to be restored
// on standing up, because the walk cycle overwrites every channel it owns
// the moment the weight reaches zero.
//
// Sign convention, which is not guessable from the rig: rotating a leg pivot
// about +X swings the foot *backward*, since the leg hangs below its pivot.
// So forward is negative. Darla's jump pose already relies on this (front
// legs -0.5, back legs +0.4 — tucked and trailing).
const SIT_BLEND_RATE = 5;
let sitting = false;
let sitBlend = 0;

// Both characters get YXZ rotation order so pitch is applied *after* yaw and
// therefore means "lean back" in their own frame rather than "rotate about
// the world X axis". Under the default XYZ, X is the outermost rotation, so
// a pitch tips a character sideways whenever they aren't facing along Z —
// which also quietly affects Miranda's existing bend and swim tilt, and
// makes them correct rather than breaking them.
darla.rotation.order = 'YXZ';
mom.rotation.order = 'YXZ';

// Darla is a dog sit: haunches folded under and dropped, chest lifted, front
// legs straight. The front legs get the pitch subtracted back out so they
// stay vertical in world space while the body leans off them.
const DARLA_SIT = { pitch: -0.34, front: 0.34, back: -1.2, drop: -0.05 };
// Miranda sits on the ground with her legs out in front and her arms propped
// behind her. Her hip pivot is at 0.63, so the drop is most of a leg length.
const MIRANDA_SIT = { pitch: -0.14, legs: -1.45, arms: 0.5, drop: -0.55 };

// Applies the pose at the given weight and returns the height offset to add.
// Split out from the local state so the same function can pose a networked
// peer from a blend value that arrived over the wire.
function applySitPose(char, kind, b) {
  const lerp = (from, to) => from + (to - from) * b;
  if (kind === 'darla') {
    const legs = char.userData.legs;
    char.rotation.x = lerp(char.rotation.x, DARLA_SIT.pitch);
    legs.legFR.rotation.x = lerp(legs.legFR.rotation.x, DARLA_SIT.front);
    legs.legFL.rotation.x = lerp(legs.legFL.rotation.x, DARLA_SIT.front);
    legs.legBR.rotation.x = lerp(legs.legBR.rotation.x, DARLA_SIT.back);
    legs.legBL.rotation.x = lerp(legs.legBL.rotation.x, DARLA_SIT.back);
    return DARLA_SIT.drop * b;
  }
  const legs = char.userData.legs;
  const arms = char.userData.arms;
  char.rotation.x = lerp(char.rotation.x, MIRANDA_SIT.pitch);
  legs.legL.rotation.x = lerp(legs.legL.rotation.x, MIRANDA_SIT.legs);
  legs.legR.rotation.x = lerp(legs.legR.rotation.x, MIRANDA_SIT.legs);
  arms.armL.rotation.x = lerp(arms.armL.rotation.x, MIRANDA_SIT.arms);
  arms.armR.rotation.x = lerp(arms.armR.rotation.x, MIRANDA_SIT.arms);
  return MIRANDA_SIT.drop * b;
}

// Everything here owns the character's position or pose outright for its
// duration, so sitting on top of any of them would be two animations
// fighting over the same channels.
function canSit() {
  return !isJumping && !flightActive && !climbing && !mirandaLounging;
}

// Single entry point so the button's lit state can't drift out of sync with
// the flag — sitting is cleared from several places (walking off it, jumping,
// climbing) and not just from the button itself.
function setSitting(v) {
  if (sitting === v) return;
  sitting = v;
  sitButton?.classList.toggle('active', sitting);
}

function toggleSit() {
  setSitting(sitting ? false : canSit());
}

// Jump — a normal gravity arc triggered by space bar or the on-screen
// button. Holding it doesn't change the height or duration at all — it
// only switches her legs into the reindeer-kick animation for however long
// the (otherwise ordinary) jump lasts.
const JUMP_SPEED = 3.4;
const GRAVITY = 9;
let isJumping = false;
let jumpVelocity = 0;
let jumpHeight = 0;
let jumpHeld = false;
// The ground she left, in absolute world height. The arc is measured from
// here rather than from whatever happens to be underneath her right now, and
// that distinction is the whole point: jump height used to be relative to the
// current ground, so crossing over the fire pit's rim mid-flight moved the
// reference up 0.345 and threw her up with it — a second little hop in the
// middle of the first.
let jumpGroundY = 0;
let wasOverPitRim = false;

function triggerJump() {
  if (!gameStarted || isJumping || mirandaLounging) return;
  isJumping = true;
  jumpVelocity = JUMP_SPEED;
  jumpGroundY = groundHeightAt(player.position.x, player.position.z);
  playJumpSound();
}

// Walking off the rim should drop her, not teleport her down 0.345 in a single
// frame. Reuses the jump arc with no upward velocity, so it's a fall.
//
// Keyed off crossing the rim specifically rather than "the ground got lower",
// which would misfire constantly on the hill — walking downhill changes the
// ground under her by more per frame than any sane threshold.
// Walking off the roof drops you off it. Same reuse of the jump arc as the
// fire pit rim below — no upward velocity, so it's a fall — but keyed off
// leaving the roof's *plan outline* rather than a radius.
//
// Clearing `onRoof` here is what puts the house's walls back: from the
// moment she's past the edge she's ordinary airborne, and she lands on
// whatever is actually down there.
function beginFallOffRoof() {
  if (!onRoof || climbing) return;
  const still = roofSurfaceY(player.position.x, player.position.z);
  if (still !== null) {
    lastRoofY = still;
    return;
  }
  onRoof = false;
  isJumping = true;
  jumpVelocity = 0;
  jumpHeight = 0;
  jumpGroundY = lastRoofY;
}
let lastRoofY = 0;

// ── the roof ladder ────────────────────────────────────────────────────
//
// Clicking it walks her to the foot the ordinary click-to-move way and then
// hands off to a scripted climb, in exactly the idiom the hammock already
// uses (mirandaLoungeTarget). Clicking it again while she's up there brings
// her back down.
//
// The climb is a tween rather than real movement, and deliberately so:
// there's no ladder collision, no vertical movement in the controller, and
// building either just for this would be a great deal of machinery for one
// prop. What it costs is that the climb can't be interrupted halfway.
const CLIMB_SECONDS = 1.9;
// Where the rungs end and stepping onto the shingles begins. Below this the
// tween follows the ladder; above it she moves onto the roof.
const CLIMB_STEP_OFF = 0.78;

let climbing = false;
let climbT = 0;
let climbDown = false;
let ladderTarget = false;

function atLadderFoot() {
  return {
    x: HOUSE_LADDER.x,
    y: HOUSE_GROUND_Y,
    z: HOUSE_LADDER.standZ,
  };
}
function atLadderTop() {
  return {
    x: HOUSE_LADDER.x,
    y: HOUSE_GROUND_Y + HOUSE_LADDER.topY,
    z: HOUSE_LADDER.topZ,
  };
}
function atRoofArrival() {
  const y = roofSurfaceY(HOUSE_LADDER.x, HOUSE_LADDER.arriveZ);
  return {
    x: HOUSE_LADDER.x,
    y: y === null ? HOUSE_GROUND_Y + HOUSE_LADDER.topY : y,
    z: HOUSE_LADDER.arriveZ,
  };
}

function startClimb(down) {
  climbing = true;
  climbDown = down;
  climbT = 0;
  moveTarget = null;
  ladderTarget = false;
  // Facing the ladder, both directions — which is how you actually climb
  // down one, and now also the only thing the pose makes sense against.
  //
  // This used to turn her outward for the descent. That was invisible while
  // the climb was a bare positional tween, but the moment she's braced on
  // the rungs it reads as leaning backwards off the ladder into thin air.
  player.rotation.y = Math.PI;
}

// How many reach-and-step cycles fit into the climb. Four over the ladder's
// run puts a rung under each hand about where the rungs actually are, which
// is the thing that stops it reading as a loop playing over a lift.
const CLIMB_CYCLES = 4;

// Poses the climber against the rungs.
//
// `t` is 0 at the foot and 1 at the roof *regardless of direction* — the
// tween already plays the descent by running t backwards, and the limbs get
// the same treatment for free, which is why going down looks like climbing
// down rather than like falling up.
//
// `weight` fades the whole pose out across the step-off onto the shingles.
// Without it she arrives on the roof still splayed against a ladder that is
// now behind her, and snaps out of it a frame later.
function applyClimbPose(t, weight) {
  const swing = Math.sin(t * CLIMB_CYCLES * Math.PI * 2);
  const w = weight;
  if (playerKind === 'darla') {
    const legs = darla.userData.legs;
    // Reared up against the rungs. Negative pitch is nose-up (see the sit
    // pose), and a dog on a ladder has to be near-vertical or she reads as
    // swimming up the side of the house.
    darla.rotation.x = -1.15 * w;
    // Front paws reach and pull, back legs push off alternately — opposite
    // phase, the same diagonal pattern her walk uses.
    legs.legFR.rotation.x = (-0.95 + swing * 0.5) * w;
    legs.legFL.rotation.x = (-0.95 - swing * 0.5) * w;
    legs.legBR.rotation.x = (0.4 - swing * 0.3) * w;
    legs.legBL.rotation.x = (0.4 + swing * 0.3) * w;
    return;
  }
  const arms = mom.userData.arms;
  const legs = mom.userData.legs;
  // Arms overhead on the rungs, one always higher than the other. Forward is
  // negative on these pivots, so past -pi/2 is up rather than out.
  arms.armL.rotation.x = (-2.15 + swing * 0.4) * w;
  arms.armR.rotation.x = (-2.15 - swing * 0.4) * w;
  // Knees come up high — a ladder rung is a much bigger step than a stride.
  legs.legL.rotation.x = (-0.6 - swing * 0.5) * w;
  legs.legR.rotation.x = (-0.6 + swing * 0.5) * w;
  // Leaning into the ladder rather than standing bolt upright off it.
  mom.rotation.x = 0.14 * w;
}

// Puts back whatever applyClimbPose moved, so the walk cycle and the sit
// pose inherit a clean rig. The pitch especially: nothing else writes
// rotation.x on Darla, so a leftover would stay until something else did.
function clearClimbPose() {
  player.rotation.x = 0;
  if (playerKind === 'darla') {
    const legs = darla.userData.legs;
    legs.legFR.rotation.x = 0;
    legs.legFL.rotation.x = 0;
    legs.legBR.rotation.x = 0;
    legs.legBL.rotation.x = 0;
  } else {
    mom.userData.arms.armL.rotation.x = 0;
    mom.userData.arms.armR.rotation.x = 0;
    mom.userData.legs.legL.rotation.x = 0;
    mom.userData.legs.legR.rotation.x = 0;
  }
}

function updateClimb(delta) {
  if (!climbing) return;
  climbT = Math.min(1, climbT + delta / CLIMB_SECONDS);
  // Read the tween as always going *up*, then play it backwards for the
  // descent. One path, so the two directions can't disagree about where the
  // ladder is.
  const t = climbDown ? 1 - climbT : climbT;
  const foot = atLadderFoot();
  const top = atLadderTop();
  const roof = atRoofArrival();

  let from = foot;
  let to = top;
  let k = t / CLIMB_STEP_OFF;
  if (t > CLIMB_STEP_OFF) {
    from = top;
    to = roof;
    k = (t - CLIMB_STEP_OFF) / (1 - CLIMB_STEP_OFF);
  }
  player.position.set(
    from.x + (to.x - from.x) * k,
    from.y + (to.y - from.y) * k,
    from.z + (to.z - from.z) * k
  );

  // Full pose while she's on the rungs, fading out across the step-off. `t`
  // is the up-the-ladder parameter either way, so this needs no direction
  // case of its own.
  applyClimbPose(
    t,
    t < CLIMB_STEP_OFF ? 1 : 1 - (t - CLIMB_STEP_OFF) / (1 - CLIMB_STEP_OFF)
  );

  if (climbT >= 1) {
    climbing = false;
    clearClimbPose();
    onRoof = !climbDown;
    if (onRoof) lastRoofY = player.position.y;
  }
}

function hitsLadder(clientX, clientY) {
  const ladder = yard.userData.ladder;
  if (!ladder) return false;
  const rect = renderer.domElement.getBoundingClientRect();
  pointerNDC.x = ((clientX - rect.left) / rect.width) * 2 - 1;
  pointerNDC.y = -((clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointerNDC, camera);
  return raycaster.intersectObject(ladder, true).length > 0;
}

function beginFallOffRim() {
  const overRim =
    Math.hypot(player.position.x - FIRE_PIT.x, player.position.z - FIRE_PIT.z) <
    FIRE_PIT.rimRadius;
  if (!isJumping && wasOverPitRim && !overRim) {
    isJumping = true;
    jumpVelocity = 0;
    jumpHeight = 0;
    jumpGroundY = FIRE_PIT_RIM_Y;
  }
  wasOverPitRim = overRim;
}

// Returns her absolute height this frame, or null once she's back on the
// ground. `ground` is whatever is under her *now*, which needn't be what she
// took off from — landing on the pit's rim catches her early and high, and
// dropping off it lets her fall further than she rose.
function updateJump(delta, ground) {
  if (!isJumping) return null;
  jumpVelocity -= GRAVITY * delta;
  jumpHeight += jumpVelocity * delta;
  const y = jumpGroundY + jumpHeight;
  if (jumpVelocity <= 0 && y <= ground) {
    jumpHeight = 0;
    isJumping = false;
    jumpVelocity = 0;
    return null;
  }
  return y;
}

// --- Multiplayer sync ----------------------------------------------------
// Each browser fully simulates only the character it's driving (100% the
// same code above, completely unmodified) and mirrors whatever the peer
// last reported for the *other* character — no host-side "simulate both"
// step, no client-side prediction, just apply the latest snapshot.

// Poops rendered from a peer's snapshot are plain visual copies, not real
// entries in `poops` — this reconciles remotePoops (id -> mesh) against
// whatever list just arrived: add meshes for new ids, drop ones no longer
// present, update position/scale for the rest.
function reconcileRemotePoops(list) {
  const seen = new Set();
  for (const p of list) {
    seen.add(p.id);
    let obj = remotePoops.get(p.id);
    if (!obj) {
      obj = createPoop();
      obj.userData.id = p.id;
      obj.rotation.y = Math.random() * Math.PI * 2;
      // spawnPoop gives every real poop its own hover glow (see there) —
      // remote-rendered stand-ins need the same, since setPoopHover
      // toggles .userData.hoverGlow.visible on whatever pickPoop finds,
      // real or remote, and this was the one place that never attached it.
      const poopGlow = createHoverGlow(0.4, 0.4, 0.15);
      obj.add(poopGlow);
      obj.userData.hoverGlow = poopGlow;
      scene.add(obj);
      remotePoops.set(p.id, obj);
    }
    obj.position.set(p.x, terrainHeight(p.x, p.z), p.z);
    obj.userData.growth = p.growth;
    obj.scale.setScalar(1 + p.growth * POOP_GROWTH_PER_MERGE);
  }
  for (const [id, obj] of remotePoops) {
    if (seen.has(id)) continue;
    scene.remove(obj);
    obj.traverse((child) => {
      if (child.isMesh) child.geometry.dispose();
    });
    remotePoops.delete(id);
  }
}

// Whether the *remote* Miranda was lounging as of the last snapshot — kept
// separate from `mirandaLounging` (which only ever describes *my own*
// locally-driven Mom) so the two can't stomp on each other depending on
// who's playing which character.
let remoteWasLounging = false;

function applyRemoteState(msg) {
  if (playerKind === 'darla') {
    // The peer is playing Miranda/Mom.
    if (msg.lounging !== remoteWasLounging) {
      remoteWasLounging = msg.lounging;
      if (msg.lounging) enterHammockLounge();
      else exitHammockLounge();
    }
    // enterHammockLounge already set her exact pose from the hammock's own
    // fixed transform — a plain x/y/z + yaw can't represent lying down, so
    // this skips overwriting it with the sender's (frozen, pre-lounge) raw
    // transform while she's actually in the hammock.
    if (!msg.lounging) {
      mom.position.set(msg.x, msg.y, msg.z);
      mom.rotation.y = msg.ry;
    }
    if (msg.flying) {
      updateMirandaSwim(elapsed, msg.moving);
    } else {
      // Same reset exitFlight does locally for the flying player herself —
      // updateMirandaWalkCycle only ever touches the arms' rotation.x,
      // never rotation.z, so without resetting that here too her arms
      // would stay stuck rotated outward from the last swim stroke.
      mom.rotation.x = 0;
      mom.userData.arms.armL.rotation.z = 0;
      mom.userData.arms.armR.rotation.z = 0;
      updateMirandaWalkCycle(msg.moving);
      // After the walk cycle and after the rotation.x reset above, matching
      // the order the local player uses — otherwise that reset would flatten
      // the lean straight back out.
      if (msg.sit > 0.001) applySitPose(mom, 'miranda', msg.sit);
    }
    // Mirrors Miranda's own ball/cheese physics so updateDarlaFetch/
    // updateDarlaCheese (running locally on this — Darla's — client once
    // a fetchStart/cheeseStart command arrives) have a live target,
    // without ever simulating the arc itself here.
    if (msg.ball) {
      ball.position.set(msg.ball.x, msg.ball.y, msg.ball.z);
      ball.visible = msg.ball.visible;
    }
    if (msg.cheese) {
      cheese.position.set(msg.cheese.x, msg.cheese.y, msg.cheese.z);
      cheese.visible = msg.cheese.visible;
    }
  } else {
    // The peer is playing Darla.
    darla.position.set(msg.x, msg.y, msg.z);
    darla.rotation.y = msg.ry;
    updateWalkCycle(msg.moving, msg.jumping, msg.jumping && msg.jumpHeld);
    if (msg.sit > 0.001) applySitPose(darla, 'darla', msg.sit);
    else darla.rotation.x = 0;
    if (typeof msg.dress === 'boolean') darla.userData.dress.visible = msg.dress;
    if (msg.poops) reconcileRemotePoops(msg.poops);
    // Same head-dip math as updateDarlaCheese's own local animation,
    // replayed here from the synced progress value instead of a local
    // timer — cheap enough (and low-stakes enough looking slightly off by
    // a network round-trip) not to need real interpolation.
    darla.userData.head.rotation.x = -Math.sin((msg.eating || 0) * Math.PI) * 0.3;
  }
}

function applyRemoteDayNight(day) {
  if (day === isDay) return;
  dayNightButton.disabled = true;
  dayNightFade.style.opacity = '1';
  playNightTransition(!day, DAY_NIGHT_FADE_MS * 2);
  setTimeout(() => {
    applyDayNight(day);
    dayNightFade.style.opacity = '0';
    setTimeout(() => {
      dayNightButton.disabled = false;
    }, DAY_NIGHT_FADE_MS);
  }, DAY_NIGHT_FADE_MS);
}

function applyRemoteFx(msg) {
  if (msg.name === 'bark') playBarkSound();
  else if (msg.name === 'moo') playMooSound();
  else if (msg.name === 'speechBark') {
    faceEachOther();
    playBarkSound();
    showSpeechBubble(darla, msg.text);
  } else if (msg.name === 'dialogue') {
    faceEachOther();
    playDialogueBubbles({ question: msg.question, response: msg.response });
  } else if (msg.name === 'bite') {
    playBiteSound();
    biteActive = true;
    biteElapsed = 0;
    // Same interruption as a local bite. Without it the biter watches her
    // give up while Miranda's own client has her calmly carry on collecting.
    stopMomCollecting();
  } else if (msg.name === 'callBark') {
    playCallDarlaSound();
    showSpeechBubble(mom, 'Darla!');
  } else if (msg.name === 'faceMiranda') {
    // Turns Darla's own client's copy of herself to match what Miranda's
    // client already snapped to locally when she opened the dialogue menu
    // — without this it just gets overwritten by Darla's next position
    // sync, since her real client never actually turned.
    faceEachOther();
  } else if (msg.name === 'mirandaComeDown') {
    showSpeechBubble(mom, 'Whoa..');
  }
}

function sendNetworkState(isMoving) {
  if (!net.isConnected()) return;
  const msg = {
    t: 'state',
    x: player.position.x,
    y: player.position.y,
    z: player.position.z,
    ry: player.rotation.y,
    moving: isMoving,
    jumping: isJumping,
    jumpHeld,
    // The blend, not the boolean: the y drop is already baked into the
    // position above, so a peer that only knew "sitting" would snap the pose
    // on while the height eased, and the character would sink through the
    // pose instead of into it.
    sit: sitBlend,
  };
  if (playerKind === 'darla') {
    msg.dress = darla.userData.dress.visible;
    msg.poops = poops.map((p) => ({
      id: p.userData.id,
      x: p.position.x,
      z: p.position.z,
      growth: p.userData.growth,
    }));
    // The head-dip chomp itself is only ever set directly on darla's own
    // client (see updateDarlaCheese) — this is what lets Miranda's screen
    // replay the same motion instead of just seeing the cheese vanish and
    // a poop appear with no animation in between.
    msg.eating = darlaCheeseState === 'eating' ? Math.min(darlaCheeseElapsed / DARLA_CHEESE_EAT_DURATION, 1) : 0;
  } else {
    msg.lounging = mirandaLounging;
    msg.flying = flightActive;
    // Ball/cheese physics stay entirely local to Miranda's client (she's
    // the one throwing them) — Darla's client never runs that arc math
    // itself, just renders whatever position/visibility arrives here, so
    // updateDarlaFetch/updateDarlaCheese always have something current to
    // walk toward.
    msg.ball = { visible: ball.visible, x: ball.position.x, y: ball.position.y, z: ball.position.z };
    msg.cheese = {
      visible: cheese.visible,
      x: cheese.position.x,
      y: cheese.position.y,
      z: cheese.position.z,
    };
  }
  net.send(msg);
}

function onResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  composer.setSize(window.innerWidth, window.innerHeight);
  // The grass's minimum on-screen blade width is measured in pixels, so it
  // depends on how many pixels tall the viewport is.
  updateGrassAngularSize(camera, window.innerHeight);
}
window.addEventListener('resize', onResize);
updateGrassAngularSize(camera, window.innerHeight);

const clock = new THREE.Clock();
let elapsed = 0;

function animate() {
  requestAnimationFrame(animate);
  // Clamped, because requestAnimationFrame stops entirely while the tab is
  // hidden or the window minimised. The first frame back would otherwise
  // carry a delta of however long you were away — minimise for two minutes
  // and every `position += speed * delta` in here advances by two minutes'
  // worth in a single step, which teleported Darla and Miranda to wherever
  // that landed. Timers built on `elapsed` jumped with them.
  //
  // 1/15s is low enough that nothing can cross a wall or a trigger in one
  // frame, and high enough that a genuine slow frame still animates rather
  // than stuttering in slow motion.
  // Kept unclamped for the FPS readout specifically. The clamp below exists
  // to stop physics exploding after a long stall, but it also means `delta`
  // can never report worse than 15 fps — which would quietly hide exactly
  // the spikes the counter is there to catch.
  const rawDelta = clock.getDelta();
  const delta = Math.min(rawDelta, 1 / 15);
  elapsed += delta;
  updateDebugFps(rawDelta);

  // Sent to the peer once, at the very end of this function, once every
  // way Darla or Miranda might have moved this frame — WASD/click-to-move
  // below, and (for whichever client is actually simulating Darla) the
  // fetch/cheese/leash commands further down — has had its say.
  let localIsMoving = false;

  if (debugFreeFly) updateDebugFly(delta);

  if (gameStarted) {
    // Darla chasing Mom down to bite her already works unmodified in
    // multiplayer — it just sets the normal moveTarget on Darla's own
    // client and reads mom.position, which is kept in sync the regular
    // way whether Mom's local or over the network.
    updateBiteChase();
    if (flightActive) {
      // Flying owns her position/camera entirely on its own terms — the
      // usual ground-relative walk/jump math doesn't apply mid-air.
      localIsMoving = updateFlight(delta);
    } else {
      localIsMoving = updateMovement(delta);
      // The climb owns her position outright for its couple of seconds, the
      // same way lounging does — the ground-relative math below would drag
      // her straight back down the ladder every frame.
      updateClimb(delta);
      // While lounging her position/pose is fixed by enterHammockLounge —
      // the usual walk-cycle/jump-height math would otherwise stomp her y
      // back toward 0 every frame.
      if (!mirandaLounging && !climbing) {
        const ground = groundHeightAt(player.position.x, player.position.z);
        beginFallOffRoof();
        beginFallOffRim();
        const airY = updateJump(delta, ground);
        const baseY =
          playerKind === 'darla'
            ? updateWalkCycle(localIsMoving, isJumping, isJumping && jumpHeld)
            : updateMirandaWalkCycle(localIsMoving);
        player.position.y = baseY + (airY ?? ground);
        // Walking cancels the sit rather than blocking movement — standing
        // up by pressing a direction is what every game does, and having
        // the button be the only way out would feel like a trap.
        if (sitting && (localIsMoving || !canSit())) setSitting(false);
        sitBlend += ((sitting ? 1 : 0) - sitBlend) * Math.min(1, delta * SIT_BLEND_RATE);
        if (sitBlend > 0.001) {
          player.position.y += applySitPose(player, playerKind, sitBlend);
        } else {
          // The blend approaches zero asymptotically and never reaches it, so
          // the lean needs clearing outright once it's below the threshold —
          // nothing else in either character's animation writes rotation.x
          // while they're the one being played.
          player.rotation.x = 0;
        }
      }
    }
  }

  // Darla's own idle tail wag + head sway run regardless of whether she's
  // the one being played — she still stands by the fire looking alive
  // either way.
  darla.userData.tail.rotation.y = Math.sin(elapsed * 5) * 0.5;
  darla.userData.head.rotation.y = Math.sin(elapsed * 0.7) * 0.08;

  // A quick snap-and-flinch for the bite: Darla's head dips forward and
  // back (rotation.x, otherwise untouched by her idle sway which only
  // uses .y), Mom recoils with a startled tilt (rotation.z, likewise free
  // — her own animations only ever touch .x for bending and .y for facing).
  if (biteActive) {
    biteElapsed += delta;
    const t = Math.min(biteElapsed / BITE_DURATION, 1);
    const pulse = Math.sin(t * Math.PI);
    darla.userData.head.rotation.x = -pulse * 0.4;
    mom.rotation.z = pulse * 0.18;
    if (t >= 1) {
      biteActive = false;
      darla.userData.head.rotation.x = 0;
      mom.rotation.z = 0;
    }
  }

  // Mom's own fire-pit AI (and the idle sway that goes with it) only runs
  // while she's an NPC — once she's the player, her limbs are driven by
  // updateMirandaWalkCycle above instead, and running both would fight
  // over the same rotations every frame. In multiplayer she's never an
  // NPC (a real second player drives her, whether local or over the
  // network via applyRemoteState), so this is skipped there too.
  if (!isMultiplayer && playerKind !== 'miranda') {
    updateMom(delta);
    if (momState === 'idle') {
      mom.userData.torso.rotation.y = Math.sin(elapsed * 0.4) * 0.04;
      mom.userData.head.rotation.y = Math.sin(elapsed * 0.55 + 1) * 0.06;
      mom.userData.hairBack.rotation.z = Math.sin(elapsed * 0.9) * 0.02;
    }
  } else if (playerKind === 'miranda') {
    // Mirrors just the two bits of updateMom that still apply once she's
    // player-controlled: keeping the shovel prop in sync with the current
    // backlog, and running the actual pickup animation on arrival (see the
    // mirandaPoopTarget handoff in updateMovement) — never the idle/
    // walking AI branches, since WASD/click-to-move already own her
    // movement in this mode. Works the same in multiplayer now too — just
    // needs telling Darla's client which poop to also remove/shrink on
    // her authoritative copy once the pickup actually finishes.
    updateMomShovel();
    if (momState === 'pickingUp') {
      updateMomPickup(delta, (poopId) => {
        momState = 'idle';
        if (isMultiplayer) sendCommand('poopPicked', { poopId });
      });
    }
  }

  if (clickMarker.visible) {
    clickMarker.scale.setScalar(1 + Math.sin(elapsed * 8) * 0.08);
  }

  if (speechBubbleTarget) {
    if (elapsed < speechBubbleUntil) {
      speechBubbleTarget.userData.head.getWorldPosition(speechBubbleWorldPos);
      speechBubbleWorldPos.y += 0.15;
      speechBubbleWorldPos.project(camera);
      speechBubbleEl.style.left = `${(speechBubbleWorldPos.x * 0.5 + 0.5) * window.innerWidth}px`;
      speechBubbleEl.style.top = `${(-speechBubbleWorldPos.y * 0.5 + 0.5) * window.innerHeight}px`;
    } else {
      speechBubbleTarget = null;
      speechBubbleEl.classList.remove('visible');
    }
  }

  if (poopButtonHeld) {
    poopSpawnTimer -= delta;
    if (poopSpawnTimer <= 0) {
      const heldDuration = elapsed - poopHoldStart;
      const spread = 1 + Math.min(heldDuration / 1.5, 1) * 2; // ramps 1x -> 3x over 1.5s
      spawnPoop(spread);
      poopSpawnTimer = POOP_SPAWN_INTERVAL;
    }
  }

  if (ballState === 'flying') {
    ballThrowElapsed += delta;
    const t = Math.min(ballThrowElapsed / ballThrowDuration, 1);
    // A real thrown-ball arc: straight-line lerp for x/z, a parabola (zero
    // at both ends, peaking at t=0.5) layered on top of the height lerp
    // for y — rather than teleporting horizontally to the landing spot and
    // just dropping straight down onto it.
    ball.position.x = THREE.MathUtils.lerp(ballThrowStart.x, ballThrowTarget.x, t);
    ball.position.z = THREE.MathUtils.lerp(ballThrowStart.z, ballThrowTarget.z, t);
    const heightLerp = THREE.MathUtils.lerp(ballThrowStart.y, ballThrowTarget.y, t);
    ball.position.y = heightLerp + ballArcHeight * 4 * t * (1 - t);
    if (t >= 1) {
      ballState = 'thrown';
      darlaFetchState = 'fetching';
      // In multiplayer this only sets state on Miranda's own (guard-only)
      // copy — Darla's client needs telling separately, since it's the
      // one that'll actually run updateDarlaFetch.
      sendCommand('fetchStart');
    }
  }

  if (cheeseState === 'flying') {
    cheeseThrowElapsed += delta;
    const t = Math.min(cheeseThrowElapsed / cheeseThrowDuration, 1);
    cheese.position.x = THREE.MathUtils.lerp(cheeseThrowStart.x, cheeseThrowTarget.x, t);
    cheese.position.z = THREE.MathUtils.lerp(cheeseThrowStart.z, cheeseThrowTarget.z, t);
    const heightLerp = THREE.MathUtils.lerp(cheeseThrowStart.y, cheeseThrowTarget.y, t);
    cheese.position.y = heightLerp + cheeseArcHeight * 4 * t * (1 - t);
    if (t >= 1) {
      cheeseState = 'landed';
      darlaCheeseState = 'going';
      sendCommand('cheeseStart');
    }
  }

  // Fetch/cheese/leash all move Darla directly, so they can only ever run
  // on whichever client actually simulates her: in single-player that's
  // the one and only client, while playerKind is 'miranda' (Darla's the
  // AI there); in multiplayer it's Darla's own client instead (playerKind
  // 'darla' there, driven by commands from Miranda's client rather than
  // local AI decisions — see sendCommand/applyRemoteCommand above).
  // Reuses her own (quadruped) walk cycle for the run, same as the
  // player-driven path does, just fed by whichever of these is currently
  // moving her instead of WASD/click-to-move (mutually exclusive with it
  // via the updateMovement guard above, and with each other via the
  // guards in throwBallTo/throwCheeseTo/the leash/call handlers).
  const darlaCommandable =
    (!isMultiplayer && playerKind === 'miranda') || (isMultiplayer && playerKind === 'darla');
  if (darlaCommandable) {
    const fetching = updateDarlaFetch(delta);
    const eatingCheese = updateDarlaCheese(delta);
    const onLeash = updateDarlaLeash(delta);

    // The fire pit is solid for her too.
    //
    // Her three commanded paths above each write darla.position directly
    // and so bypass clampToWalkable, which is where the pit's push-out
    // lives for the player — so a ball thrown across the fire sent her
    // trotting straight through it. (The bite chase is fine: it only sets
    // moveTarget, which does go through the clamp.)
    //
    // One call here rather than three inside those functions, and placed
    // before the y write below so her height is sampled at the corrected
    // position. A fourth commanded path added later gets this for free,
    // which is the whole reason it's here and not in each of them.
    //
    // Same two exemptions the player gets: airborne, so a jump can carry
    // her over the rim rather than hitting an invisible wall mid-flight;
    // and already inside, so having landed in there she can walk out under
    // her own steam instead of being spat back. `darlaOwnsJump` is
    // recomputed below for the walk cycle — the jump globals only describe
    // *her* jump in multiplayer, and in single-player this block runs on
    // Miranda's client where they describe Miranda.
    // No "already inside, so leave her alone" exemption here, and that
    // omission is the fix rather than an oversight.
    //
    // The player gets that exemption so someone who jumped into the pit can
    // walk back out. It was copied here and it does not survive contact
    // with a moving dog: `FIRE_PIT_INSIDE` is only 0.08 m tighter than
    // `FIRE_PIT_CLEARANCE`, and one frame at her run speed covers 0.083 m —
    // so a single step carries her from outside the blocked radius to
    // inside the exempt one, at which point she is excused for good and
    // strolls through the fire. That is exactly what "calling Darla still
    // walks her through the fire pit" was.
    //
    // She never legitimately starts inside during fetch, cheese or leash,
    // so there is nothing for the exemption to protect. Airborne stays,
    // because a jump genuinely does need to carry her over the rim.
    const darlaAirborne = isMultiplayer && playerKind === 'darla' && isJumping;
    if (!darlaAirborne) {
      const clear = pushOutOfFirePit(darla.position.x, darla.position.z);
      const cleared = pushOutOfTrees(clear.x, clear.z);
      clear.x = cleared.x;
      clear.z = cleared.z;
      darla.position.x = clear.x;
      darla.position.z = clear.z;
    }

    const commandedMoving = fetching || eatingCheese || onLeash;
    const darlaCommandActive = darlaFetchState !== 'idle' || darlaCheeseState !== 'idle' || darlaLeashed;
    // In multiplayer this runs on Darla's own client, which is *also*
    // already driving her via WASD/click-to-move up in updateMovement
    // whenever she's not under one of these commands — skipping the
    // write-out here in that case, or this would stomp the walk cycle
    // WASD already set this same frame back to idle, every single frame,
    // which is what was silently killing her walk animation. No such
    // conflict in single-player: this whole block only ever runs there on
    // Miranda's own client, driving *herself*, not Darla.
    if (!isMultiplayer || darlaCommandActive) {
      // Only in the multiplayer case does jumpHeight/isJumping/jumpHeld
      // actually describe *Darla's own* jump — in single-player this
      // whole block runs on Miranda's client, where those same globals
      // describe her jump instead, which has nothing to do with AI-Darla
      // and always stayed grounded during fetch/cheese before this
      // feature existed.
      const darlaOwnsJump = isMultiplayer && playerKind === 'darla';
      const bob = updateWalkCycle(
        commandedMoving,
        darlaOwnsJump && isJumping,
        darlaOwnsJump && isJumping && jumpHeld
      );
      darla.position.y =
        bob + (darlaOwnsJump ? jumpHeight : 0) + terrainHeight(darla.position.x, darla.position.z);
      if (darlaOwnsJump) localIsMoving = localIsMoving || commandedMoving;
    }
  }
  // Pure rendering, not authoritative state — safe (and necessary) to run
  // on both clients independently, each using its own local mom/darla
  // references (one locally simulated, one network-synced, but both
  // correct either way).
  updateLeashVisual();

  // camera follows whichever character is being played, keeping the same
  // relative angle/distance the player has set up via orbit controls —
  // held still at its starting shot until a character is actually chosen.
  // Skipped while flying, since updateFlight already places the camera
  // itself every frame — this would just fight it. Also skipped in debug
  // mode, which wants the camera to stay parked over DEBUG_FOCUS rather
  // than drift toward wherever the player wanders off to.
  // ...and not while she's in the hammock, which parks the camera at her
  // head looking up and wants it left exactly there.
  if (gameStarted && !flightActive && !debugFreeFly && !mirandaLounging) {
    // Aim just above the player's feet, wherever those actually are. This
    // used to be a flat 0.5 — fine on level ground, but with the hill in
    // place that's an absolute world height, so standing on the crown the
    // camera would have been staring at a point two metres below her.
    followOffset
      .set(player.position.x, player.position.y + cameraAimHeight(), player.position.z)
      .sub(controls.target)
      .multiplyScalar(0.08);
    controls.target.add(followOffset);
    camera.position.add(followOffset);
  }

  // A small bob layered on top of each sprite's own direction-based height
  // — overwriting position.y with one fixed absolute value here (the old
  // code) only ever looked right for whichever sprite happened to sit at
  // that exact height, which silently broke the sun once it got its own
  // real direction instead of just reusing the moon's spot in the sky.
  updateIdleGlows(elapsed);

  const skyBob = Math.sin(elapsed * 0.8) * 0.6;
  moonSprite.position.y = MOON_DIRECTION.y * SKY_DISTANCE + skyBob;
  sunSprite.position.y = SUN_DIRECTION.y * SKY_DISTANCE + skyBob;

  // Fire pit flicker and smoke. Self-skips by day, when the wood is just
  // sitting there unlit.
  updateFirePit(yard.userData.firePit, elapsed, delta);
  updateDragonflies(yard.userData.dragonflies, elapsed);

  setGrassTime(elapsed);
  setWaterTime(elapsed);
  // Miranda's hair sways on the same clock — see the strand system in mom.js.
  setHairTime(elapsed);

  // The lawn used to be a flat plane that chased the player around, with
  // its texture offset scrolled to compensate — necessary back when the
  // woods streamed on forever and no finite plane could cover them. The
  // world is bounded now and the ground has real shape (see terrainHeight),
  // so the lawn is a fixed displaced mesh: nothing to move, nothing to
  // scroll.

  starfield.position.set(player.position.x, 0, player.position.z);
  starfield.userData.material.uniforms.uTime.value = elapsed;

  // Sent last, now that localIsMoving reflects everything that could have
  // moved the local player this frame — WASD/click-to-move, and (on
  // whichever client is simulating Darla) fetch/cheese/leash too.
  if (isMultiplayer && gameStarted) sendNetworkState(localIsMoving);

  updatePsychedelic(delta);

  // Skipped while flying — controls.enabled=false already stops it
  // reacting to input, but .update() still recomputes camera.position
  // from its own internal state every call regardless, which would
  // undo updateFlight's manual positioning this same frame.
  // Every mode, not just debug — swinging the camera under the ground is
  // never something you want, and normal play hits it too as soon as you
  // try to look up at the pines or the roof.
  // Skipped while lounging for the same reason as flying: .update() would
  // recompute camera.position from OrbitControls' own state and undo the
  // manual head placement, and the player.visible line below would keep
  // switching her back on while the camera sits inside her head.
  // Debug is skipped for the same reason as the other two: updateDebugFly owns
  // camera.position outright now, and .update() would recompute it from
  // OrbitControls' spherical state and drag it straight back to the target.
  if (!flightActive && !mirandaLounging && !debugFreeFly) {
    clampOrbitToGround();
    controls.update();
    // After update(), so it acts on where the camera actually ended up.
    pullCameraPastBlockers();
    // Tilting all the way up rolls the camera in until it's inside the
    // player (see clampOrbitToGround), at which point they're a wall of
    // fur across the lens. Drop them once the camera is that close so the
    // view is actually clear. Flight already manages mom.visible itself,
    // hence staying out of its way here.
    player.visible = camera.position.distanceTo(controls.target) > PLAYER_HIDE_DISTANCE;
  }
  // There is deliberately no "lift the camera off the roof" step here.
  //
  // One was written, at 0.9 m of clearance and then 2.2 m, on the theory
  // that the camera was burying itself in the shingles. It never fired
  // once: a probe showed the camera sitting a good five metres *above*
  // the roof the whole time. The screen was full of shingles for an
  // unrelated reason — clicking on the roof punched a ray straight
  // through it to the lawn below, and clampTargetPoint then pushed that
  // point out of the building's footprint, so every click walked her off
  // the edge. See marchToRoof in getGroundPoint; fixing the click fixed
  // the camera, and clampOrbitToGround handles the rest unchanged.

  // After controls.update(), so the dome is centred on where the camera
  // actually ended up this frame rather than trailing it by one.
  sky.update(elapsed, camera.position);
  // The shadow box travels with whoever's being played. In debug the free
  // camera goes wherever it likes, so it follows that instead — otherwise
  // flying out to inspect the tree line leaves the shadows behind at
  // Darla's feet.
  updateShadowCamera(debugFreeFly ? camera.position : player.position);
  updateSunGlare();
  composer.render();
}

// The first rendered frame costs a fixed ~1.9s of shader compilation
// (notes/load-times.md, and it barely varies run to run). Paying it here,
// with the loading screen still up, is the whole reason that screen can be
// dismissed onto a yard that's immediately smooth — otherwise the first
// second of play is a freeze on a world that looks ready.
// Given the measured ~1.9s as the sweep duration, so the edge keeps gliding
// across this last stretch instead of arriving early and freezing — there are
// no progress updates inside a single compile.
setLoadingProgress(LOAD_SHADERS_TO, 1900);
await nextFrame();
composer.render();

setLoadingStatus('Ready!');
finishLoading();
animate();
