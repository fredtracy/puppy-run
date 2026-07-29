import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { createDarla, createPoop } from './darla.js';
import { createMom, setHairTime } from './mom.js';
import {
  createYard,
  createTreeChunk,
  CHUNK_SIZE,
  FIRE_PIT,
  terrainHeight,
  updateGrassAngularSize,
  setGrassFog,
  setGrassLight,
  setGrassTime,
  setFirePitLit,
  updateFirePit,
  updateDragonflies,
} from './yard.js';
import { HOUSE_SOLIDS, HOUSE_BACK_WALK_Z } from './house.js';
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
camera.position.set(7, 4.5, 11);

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
controls.enableDamping = true;
// Small enough that the camera can pull right in to the character's own
// position when you tilt all the way up — see clampOrbitToGround.
controls.minDistance = 0.12;
// The zoom-out limit you actually control with the scroll wheel.
// controls.maxDistance is driven per-frame off this, so it can be
// temporarily tightened without losing what it's meant to be.
//
// Kept deliberately short for normal play. Past roughly this distance the
// camera clears the treeline and you start looking out over the edge of the
// 55m world, which reads as the yard being a floating island — and the sky
// dome's lower half comes into view with it. Debug mode raises it below,
// since inspecting a whole roof or a treeline genuinely needs the room.
let orbitMaxDistance = 13;
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

if (DEBUG_MODE) {
  // Steep-but-not-quite-vertical (OrbitControls doesn't like sitting
  // exactly at the polar singularity) so it still reads as a 3D view
  // rather than a flat map. maxDistance raised since eyeballing a whole
  // roof from up here needs more room than the normal follow-cam ever did.
  orbitMaxDistance = 60;
  controls.target.copy(DEBUG_FOCUS);
  camera.position.copy(DEBUG_FOCUS).add(DEBUG_EYE);
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
const SUN_DIRECTION = new THREE.Vector3(3, 1.5, 2).normalize();
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
const DAY_LIGHTING = {
  background: 0x87ceeb,
  fogColor: 0x87ceeb,
  fogNear: 18,
  fogFar: 55,
  exposure: 1.15,
  envIntensity: 1,
  envRotationY: ENV_ROTATION_Y,
  sun: { color: 0xfff2e0, intensity: 2.2, direction: SUN_DIRECTION },
  fill: { color: 0xcfe8ff, intensity: 0.4 },
  // Ground colour is the light bouncing up off the lawn onto everything's
  // undersides. It was 0x6b8e4e — near the lawn's own green, and saturated
  // enough that on pale skin it landed squarely on olive: Miranda's underjaw
  // and collarbone came out looking bruised. Bounce light is always far less
  // saturated than the surface it bounced off, so this is both the fix and
  // the more correct value.
  hemi: { sky: 0x87ceeb, ground: 0x84876c, intensity: 0.6 },
  // The grass shader is hand-written and reads none of the lights above, so
  // it takes its own copy. Full daylight, full through-the-blade scatter.
  grassLight: 0xffffff,
  grassBackScatter: 1,
  sky: {
    // Deep, saturated blue overhead washing out to a pale band at the
    // skyline. The first pass was far too milky — it read as haze rather
    // than sky, and the clouds had nothing to sit against.
    horizon: 0x7cbde9,
    zenith: 0x1150b0,
    cloudLit: 0xfffdf8,
    cloudShade: 0xb9c9dc,
    glow: 0xffe0ac,
    // Higher coverage threshold = less cloud. 0.52 gives scattered fair-
    // weather cumulus with plenty of open blue between them.
    coverage: 0.52,
    opacity: 0.95,
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
  // else went dark. Back-scatter drops close to nothing too — light coming
  // *through* a blade is a sun effect, and at full strength under a moon it
  // lit the turf from the inside.
  grassLight: 0x36486e,
  grassBackScatter: 0.08,
  sky: {
    horizon: 0x14203c,
    zenith: 0x05080f,
    // Moonlit cloud, not white — and dim enough that the starfield behind
    // still carries the night sky rather than being washed out by it.
    cloudLit: 0x38456b,
    cloudShade: 0x151d33,
    glow: 0x9fb4e8,
    // Thinner cover at night, so there's more open sky for the stars.
    coverage: 0.6,
    opacity: 0.8,
  },
};

// One directional light doubles as both sun and moon — only its color,
// intensity, and direction change between modes — so shadows always fall
// as if actually cast by whichever one is currently in the sky, instead of
// from an unrelated fixed angle.
const sunMoonLight = new THREE.DirectionalLight();
sunMoonLight.castShadow = true;
sunMoonLight.shadow.mapSize.set(2048, 2048);
sunMoonLight.shadow.camera.left = -14;
sunMoonLight.shadow.camera.right = 14;
sunMoonLight.shadow.camera.top = 14;
sunMoonLight.shadow.camera.bottom = -14;
sunMoonLight.shadow.camera.near = 1;
sunMoonLight.shadow.camera.far = 30;
sunMoonLight.shadow.bias = -0.0015;
scene.add(sunMoonLight);

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
const darla = createDarla();
darla.position.set(-0.1, 0, 5.6);
darla.rotation.y = 0.7 + Math.PI;
scene.add(darla);

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
mom.position.set(-1.9, terrainHeight(-1.9, 4.4), 4.4);
mom.rotation.y = 0.7;
scene.add(mom);

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

const momGlow = createHoverGlow(1.1, 1.9, 0.75);
mom.add(momGlow);
let momHovered = false;
function setMomHover(hovered) {
  if (hovered === momHovered) return;
  momHovered = hovered;
  momGlow.visible = hovered;
  renderer.domElement.style.cursor = hovered ? 'pointer' : '';
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
  renderer.domElement.style.cursor = hovered ? 'pointer' : '';
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

function drawMirandaPortrait(ctx, size) {
  const c = size / 2;
  ctx.clearRect(0, 0, size, size);
  ctx.save();
  ctx.translate(c, c);

  // Long hair volume behind the head
  ctx.fillStyle = '#1f1613';
  ctx.beginPath();
  ctx.ellipse(0, c * 0.05, c * 0.82, c * 0.92, 0, 0, Math.PI * 2);
  ctx.fill();

  // Face
  ctx.fillStyle = '#f0c9a8';
  ctx.beginPath();
  ctx.arc(0, c * 0.02, c * 0.58, 0, Math.PI * 2);
  ctx.fill();

  // Blunt bangs across the forehead
  ctx.fillStyle = '#1f1613';
  ctx.beginPath();
  ctx.ellipse(0, -c * 0.32, c * 0.56, c * 0.2, 0, 0, Math.PI * 2);
  ctx.fill();

  // Blush
  ctx.fillStyle = 'rgba(217, 154, 138, 0.5)';
  [-1, 1].forEach((side) => {
    ctx.beginPath();
    ctx.ellipse(side * c * 0.38, c * 0.14, c * 0.12, c * 0.08, 0, 0, Math.PI * 2);
    ctx.fill();
  });

  // Eyes
  ctx.fillStyle = '#2f7fd1';
  [-1, 1].forEach((side) => {
    ctx.beginPath();
    ctx.arc(side * c * 0.24, -c * 0.02, c * 0.08, 0, Math.PI * 2);
    ctx.fill();
  });

  // Lips
  ctx.fillStyle = '#6b1c2e';
  ctx.beginPath();
  ctx.ellipse(0, c * 0.28, c * 0.14, c * 0.06, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

drawDarlaPortrait(document.getElementById('portrait-darla').getContext('2d'), 128);
drawMirandaPortrait(document.getElementById('portrait-miranda').getContext('2d'), 128);

// Same two portraits, small and overlapping, standing in for a generic
// "two players" icon on the multiplayer button — reuses the exact same
// drawing functions rather than a separate composited image.
drawMirandaPortrait(document.getElementById('mp-icon-miranda').getContext('2d'), 32);
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
  const sph = new THREE.Spherical().setFromVector3(
    camera.position.clone().sub(controls.target)
  );
  const n = (v, d = 2) => Number(v.toFixed(d));
  const url =
    `${location.origin}${location.pathname}?at=${n(player?.position.x ?? 0)},` +
    `${n(player?.position.z ?? 0)}&cam=${n(sph.radius)},` +
    `${n(THREE.MathUtils.radToDeg(sph.phi), 1)},` +
    `${n(THREE.MathUtils.radToDeg(sph.theta), 1)}` +
    (playerKind === 'miranda' ? '&as=miranda' : '');
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

function generateWorld() {
  for (let cx = -CHUNK_GRID_RADIUS; cx <= CHUNK_GRID_RADIUS; cx++) {
    for (let cz = -CHUNK_GRID_RADIUS; cz <= CHUNK_GRID_RADIUS; cz++) {
      const centerX = cx * CHUNK_SIZE + CHUNK_SIZE / 2;
      const centerZ = cz * CHUNK_SIZE + CHUNK_SIZE / 2;
      if (Math.hypot(centerX, centerZ) > WORLD_RADIUS) continue;
      const chunk = createTreeChunk(cx, cz);
      scene.add(chunk);
    }
  }
}

generateWorld();

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

  const haloR = size * 0.49;
  const halo = ctx.createRadialGradient(0, 0, haloR * 0.55, 0, 0, haloR);
  halo.addColorStop(0, 'rgba(214, 226, 255, 0.55)');
  halo.addColorStop(1, 'rgba(214, 226, 255, 0)');
  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.arc(0, 0, haloR, 0, Math.PI * 2);
  ctx.fill();

  const faceR = size * 0.32;
  const faceGradient = ctx.createRadialGradient(
    -faceR * 0.3,
    -faceR * 0.3,
    faceR * 0.1,
    0,
    0,
    faceR
  );
  faceGradient.addColorStop(0, '#f5f8ff');
  faceGradient.addColorStop(1, '#c7d3ee');
  ctx.fillStyle = faceGradient;
  ctx.beginPath();
  ctx.arc(0, 0, faceR, 0, Math.PI * 2);
  ctx.fill();

  // A few soft craters for texture
  ctx.fillStyle = 'rgba(150, 165, 200, 0.35)';
  [
    [-faceR * 0.4, -faceR * 0.5, faceR * 0.11],
    [faceR * 0.45, -faceR * 0.15, faceR * 0.08],
    [-faceR * 0.15, faceR * 0.5, faceR * 0.13],
    [faceR * 0.35, faceR * 0.45, faceR * 0.07],
  ].forEach(([x, y, r]) => {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  });

  // Wide, surprised eyes
  ctx.fillStyle = '#3a3f55';
  [-1, 1].forEach((side) => {
    ctx.beginPath();
    ctx.ellipse(side * faceR * 0.32, -faceR * 0.08, faceR * 0.1, faceR * 0.12, 0, 0, Math.PI * 2);
    ctx.fill();
  });
  ctx.fillStyle = '#fff';
  [-1, 1].forEach((side) => {
    ctx.beginPath();
    ctx.arc(side * faceR * 0.32 + 3, -faceR * 0.11, faceR * 0.03, 0, Math.PI * 2);
    ctx.fill();
  });

  // A little "oh!" mouth
  ctx.fillStyle = '#3a3f55';
  ctx.beginPath();
  ctx.ellipse(0, faceR * 0.28, faceR * 0.11, faceR * 0.14, 0, 0, Math.PI * 2);
  ctx.fill();

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

// A cheerful smiling sun, same hand-drawn/billboarded approach as the moon
// above — rayed and warm-colored rather than glowing and pale.
function makeSunTexture() {
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const c = size / 2;

  ctx.translate(c, c);
  ctx.fillStyle = '#ffd54a';
  const rayCount = 16;
  const outerR = size * 0.49;
  const innerR = size * 0.33;
  ctx.beginPath();
  for (let i = 0; i < rayCount * 2; i++) {
    const angle = (Math.PI / rayCount) * i;
    const r = i % 2 === 0 ? outerR : innerR;
    const x = Math.cos(angle) * r;
    const y = Math.sin(angle) * r;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fill();

  const faceR = size * 0.3;
  const faceGradient = ctx.createRadialGradient(
    -faceR * 0.3,
    -faceR * 0.3,
    faceR * 0.1,
    0,
    0,
    faceR
  );
  faceGradient.addColorStop(0, '#fff2b0');
  faceGradient.addColorStop(1, '#ffc93c');
  ctx.fillStyle = faceGradient;
  ctx.beginPath();
  ctx.arc(0, 0, faceR, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = '#ffb3c6';
  ctx.globalAlpha = 0.6;
  ctx.beginPath();
  ctx.ellipse(-faceR * 0.55, faceR * 0.15, faceR * 0.16, faceR * 0.1, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(faceR * 0.55, faceR * 0.15, faceR * 0.16, faceR * 0.1, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;

  ctx.fillStyle = '#3a2b1a';
  [-1, 1].forEach((side) => {
    ctx.beginPath();
    ctx.ellipse(side * faceR * 0.32, -faceR * 0.08, faceR * 0.075, faceR * 0.095, 0, 0, Math.PI * 2);
    ctx.fill();
  });
  ctx.fillStyle = '#fff';
  [-1, 1].forEach((side) => {
    ctx.beginPath();
    ctx.arc(side * faceR * 0.32 + 3, -faceR * 0.11, faceR * 0.022, 0, Math.PI * 2);
    ctx.fill();
  });

  ctx.strokeStyle = '#3a2b1a';
  ctx.lineWidth = faceR * 0.05;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.arc(0, faceR * 0.12, faceR * 0.38, 0.18 * Math.PI, 0.82 * Math.PI);
  ctx.stroke();

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

const sunMaterial = new THREE.SpriteMaterial({
  map: makeSunTexture(),
  transparent: true,
  toneMapped: false,
  fog: false,
});
const sunSprite = new THREE.Sprite(sunMaterial);
sunSprite.scale.set(28, 28, 1);
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
  scene.fog.color.set(cfg.fogColor);
  scene.fog.near = cfg.fogNear;
  scene.fog.far = cfg.fogFar;
  renderer.toneMappingExposure = cfg.exposure;
  scene.environmentIntensity = cfg.envIntensity;
  scene.environmentRotation.y = cfg.envRotationY;

  // The grass shader fogs itself out with its own fogColor/fogNear/fogFar
  // uniforms (it can't read scene.fog directly), so those need to be kept
  // in sync by hand or distant grass would stay fogged to whichever mode
  // was active when the material was first created.
  setGrassFog(cfg.fogColor, cfg.fogNear, cfg.fogFar);
  // And the same for its lighting, which it also can't read from the scene.
  setGrassLight(cfg.sun.direction, cfg.grassLight, cfg.grassBackScatter);

  sunMoonLight.color.set(cfg.sun.color);
  sunMoonLight.intensity = cfg.sun.intensity;
  sunMoonLight.position.copy(cfg.sun.direction).multiplyScalar(6);

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
applyDayNight(true);

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

function clampOrbitToGround() {
  const distance = camera.position.distanceTo(controls.target);
  if (distance < 0.0001) return;
  const cosPhi = (camera.position.y - controls.target.y) / distance;
  // Sampled under the camera rather than under the target, since that's
  // the bit of ground it's actually in danger of dipping into.
  const floor = terrainHeight(camera.position.x, camera.position.z) + 0.25;
  const drop = floor - controls.target.y;

  let limit = orbitMaxDistance;
  // Only bites when the camera is below the target *and* the target is
  // above the floor; otherwise there's no radius that would help and the
  // expression would flip sign.
  if (cosPhi < -0.0001 && drop < 0) limit = Math.min(limit, drop / cosPhi);
  controls.maxDistance = Math.max(controls.minDistance, limit);
}

const debugFlyDir = new THREE.Vector3();
const debugFlyForward = new THREE.Vector3();
const debugFlyRight = new THREE.Vector3();
const DEBUG_FLY_SPEED = 14;
function updateDebugFly(delta) {
  camera.getWorldDirection(debugFlyForward);
  debugFlyRight.crossVectors(debugFlyForward, camera.up).normalize();
  debugFlyDir.set(0, 0, 0);
  if (pressedKeys.has('KeyW') || pressedKeys.has('ArrowUp')) debugFlyDir.add(debugFlyForward);
  if (pressedKeys.has('KeyS') || pressedKeys.has('ArrowDown')) debugFlyDir.sub(debugFlyForward);
  if (pressedKeys.has('KeyD') || pressedKeys.has('ArrowRight')) debugFlyDir.add(debugFlyRight);
  if (pressedKeys.has('KeyA') || pressedKeys.has('ArrowLeft')) debugFlyDir.sub(debugFlyRight);
  if (pressedKeys.has('Space')) debugFlyDir.y += 1;
  if (pressedKeys.has('ShiftLeft') || pressedKeys.has('ShiftRight')) debugFlyDir.y -= 1;
  if (debugFlyDir.lengthSq() < 0.0001) return;
  debugFlyDir.normalize().multiplyScalar(DEBUG_FLY_SPEED * delta);
  camera.position.add(debugFlyDir);
  controls.target.add(debugFlyDir);
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

// Space bar jumps (hold to fly), Enter makes her moo, Backspace makes her poop
window.addEventListener('keydown', (e) => {
  if (e.code === 'Space') {
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
  if (e.code === 'Backspace' && !e.repeat && playerKind === 'darla') {
    e.preventDefault();
    spawnPoop();
  }
});
window.addEventListener('keyup', (e) => {
  if (e.code === 'Space') jumpHeld = false;
});

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

function triggerBite() {
  playBiteSound();
  if (darlaLeashed) {
    setDarlaLeashed(false);
    sendCommand('leashOff');
  }
  biteActive = true;
  biteElapsed = 0;
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

function getGroundPoint(clientX, clientY) {
  const rect = renderer.domElement.getBoundingClientRect();
  pointerNDC.x = ((clientX - rect.left) / rect.width) * 2 - 1;
  pointerNDC.y = -((clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointerNDC, camera);

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

const dialogueMenuEl = document.getElementById('dialogue-menu');
// True once any exchange has actually happened this conversation — just
// changes the cancel button's wording (see openDialogueMenu below), reset
// whenever Darla's clicked fresh (see the pointerup handler).
let dialogueStarted = false;

function openDialogueMenu(options) {
  dialogueMenuEl.innerHTML = '';
  options.forEach((node) => {
    const btn = document.createElement('button');
    btn.textContent = node.question;
    btn.addEventListener('click', () => {
      dialogueMenuEl.classList.remove('visible');
      talkToDarla(node);
    });
    dialogueMenuEl.appendChild(btn);
  });
  const cancel = document.createElement('button');
  cancel.className = 'cancel';
  cancel.textContent = dialogueStarted ? 'End conversation' : 'Never mind';
  cancel.addEventListener('click', () => dialogueMenuEl.classList.remove('visible'));
  dialogueMenuEl.appendChild(cancel);
  dialogueMenuEl.classList.add('visible');
}

// The actual two-stage bubble playback (question, then — after a beat —
// bark + reply), shared between the local interactive flow below and the
// non-interactive replay a networked peer runs for the same exchange (see
// applyRemoteFx) — `onReplyShown` is where the local-only "reopen the menu"
// follow-up hooks in, since a peer just watching the conversation play out
// has no menu to reopen.
function playDialogueBubbles(node, onReplyShown) {
  showSpeechBubble(mom, node.question);
  window.setTimeout(() => {
    playBarkSound();
    showSpeechBubble(darla, node.response);
    if (onReplyShown) onReplyShown();
  }, 1700);
}

// A node with no follow-ups falls back to the full top-level topic list
// (so casual conversations never run out of things to say on their own),
// UNLESS it's marked `end: true` — that's how a specific scripted
// exchange gets a definite, written ending instead of looping back.
function talkToDarla(node) {
  dialogueStarted = true;
  sendFx('dialogue', { question: node.question, response: node.response });
  playDialogueBubbles(node, () => {
    if (node.end) return;
    const next = node.followUps && node.followUps.length > 0 ? node.followUps : DIALOGUE_TREE;
    window.setTimeout(() => openDialogueMenu(next), 1700);
  });
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
  loungeYaw = clampLoungeYaw(loungeYaw - dx * 0.005);
  loungePitch = Math.min(
    LOUNGE_PITCH_MAX,
    Math.max(LOUNGE_PITCH_MIN, loungePitch - dy * 0.005)
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

const hammockGlow = createHoverGlow(3.4, 1.7, yard.userData.hammock.userData.attachHeight);
yard.userData.hammock.add(hammockGlow);
let hammockHovered = false;
function setHammockHover(hovered) {
  if (hovered === hammockHovered) return;
  hammockHovered = hovered;
  hammockGlow.visible = hovered;
  renderer.domElement.style.cursor = hovered ? 'pointer' : '';
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
  renderer.domElement.style.cursor = hoveredPoop ? 'pointer' : '';
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

  // Clicking anywhere else on the scene while the dialogue menu is open
  // just dismisses it, same as the cancel button — without also acting on
  // the click itself (moving, throwing, etc.), which is why this returns
  // immediately rather than falling through to the rest of the handler.
  if (dialogueMenuEl.classList.contains('visible')) {
    dialogueMenuEl.classList.remove('visible');
    return;
  }

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
    dialogueStarted = false;
    faceEachOther();
    // faceEachOther only touches the local mom/darla objects — in
    // multiplayer Darla is remote here, so her own client's copy of
    // herself never actually turned to face Miranda. Without this, the
    // very next position sync from her real client (still facing
    // whichever way she originally was) overwrites the snap this just
    // did, which is why it looked like a one-frame flash back to her old
    // direction instead of sticking.
    sendFx('faceMiranda');
    openDialogueMenu(DIALOGUE_TREE);
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
  clickMarker.position.set(
      moveTarget.x,
      terrainHeight(moveTarget.x, moveTarget.z) + 0.02,
      moveTarget.z
    );
  clickMarker.visible = true;
});

const WALK_SPEED = 4.2;
const YARD_BOUNDS = { xMin: -9, xMax: 9, zMin: -4, zMax: 14 };

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

// Keeps her within the generated world (see generateWorld/WORLD_RADIUS
// above) — pulled in a bit short of the actual generation radius, so she
// always stays comfortably inside real trees/fog rather than able to walk
// out to the literal edge of what got generated and see it stop.
const MOVEMENT_RADIUS = WORLD_RADIUS - 5;

function clampToWorldRadius(x, z) {
  const dist = Math.hypot(x, z);
  if (dist <= MOVEMENT_RADIUS) return { x, z };
  const scale = MOVEMENT_RADIUS / dist;
  return { x: x * scale, z: z * scale };
}

// Used for the per-frame movement step.
function clampToWalkable(prevX, prevZ, x, z) {
  const pushed = pushOutOfHouse(prevX, prevZ, x, z);
  return clampToWorldRadius(pushed.x, pushed.z);
}

// Used for picking a click-to-move destination — a stateless best-guess
// clamp, same idea as clampToWalkable but with no previous position to
// slide from.
function clampTargetPoint(x, z) {
  const outside = nearestPointOutsideHouse(x, z);
  return clampToWorldRadius(outside.x, outside.z);
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

  const keyUp = pressedKeys.has('KeyW') || pressedKeys.has('ArrowUp');
  const keyDown = pressedKeys.has('KeyS') || pressedKeys.has('ArrowDown');
  const keyRight = pressedKeys.has('KeyD') || pressedKeys.has('ArrowRight');
  const keyLeft = pressedKeys.has('KeyA') || pressedKeys.has('ArrowLeft');
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
      if (mirandaLoungeTarget) {
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

function triggerJump() {
  if (!gameStarted || isJumping || mirandaLounging) return;
  isJumping = true;
  jumpVelocity = JUMP_SPEED;
  playJumpSound();
}

function updateJump(delta) {
  if (!isJumping) return 0;
  jumpVelocity -= GRAVITY * delta;
  jumpHeight += jumpVelocity * delta;
  if (jumpHeight <= 0) {
    jumpHeight = 0;
    isJumping = false;
    jumpVelocity = 0;
  }
  return jumpHeight;
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
  const delta = Math.min(clock.getDelta(), 1 / 15);
  elapsed += delta;

  // Sent to the peer once, at the very end of this function, once every
  // way Darla or Miranda might have moved this frame — WASD/click-to-move
  // below, and (for whichever client is actually simulating Darla) the
  // fetch/cheese/leash commands further down — has had its say.
  let localIsMoving = false;

  if (DEBUG_MODE) updateDebugFly(delta);

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
      // While lounging her position/pose is fixed by enterHammockLounge —
      // the usual walk-cycle/jump-height math would otherwise stomp her y
      // back toward 0 every frame.
      if (!mirandaLounging) {
        const jumpY = updateJump(delta);
        const baseY =
          playerKind === 'darla'
            ? updateWalkCycle(localIsMoving, isJumping, isJumping && jumpHeld)
            : updateMirandaWalkCycle(localIsMoving);
        player.position.y = baseY + jumpY + terrainHeight(player.position.x, player.position.z);
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
  if (gameStarted && !flightActive && !DEBUG_MODE && !mirandaLounging) {
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
  const skyBob = Math.sin(elapsed * 0.8) * 0.6;
  moonSprite.position.y = MOON_DIRECTION.y * SKY_DISTANCE + skyBob;
  sunSprite.position.y = SUN_DIRECTION.y * SKY_DISTANCE + skyBob;

  // Fire pit flicker and smoke. Self-skips by day, when the wood is just
  // sitting there unlit.
  updateFirePit(yard.userData.firePit, elapsed, delta);
  updateDragonflies(yard.userData.dragonflies, elapsed);

  setGrassTime(elapsed);
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
  if (!flightActive && !mirandaLounging) {
    clampOrbitToGround();
    controls.update();
    // Tilting all the way up rolls the camera in until it's inside the
    // player (see clampOrbitToGround), at which point they're a wall of
    // fur across the lens. Drop them once the camera is that close so the
    // view is actually clear. Flight already manages mom.visible itself,
    // hence staying out of its way here.
    player.visible = camera.position.distanceTo(controls.target) > PLAYER_HIDE_DISTANCE;
  }
  // After controls.update(), so the dome is centred on where the camera
  // actually ended up this frame rather than trailing it by one.
  sky.update(elapsed, camera.position);
  composer.render();
}

animate();
