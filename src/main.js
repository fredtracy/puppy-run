import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { SSAOPass } from 'three/addons/postprocessing/SSAOPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { createDarla, createPoop } from './darla.js';
import { createMom } from './mom.js';
import {
  createYard,
  createTreeChunk,
  CHUNK_SIZE,
  grassMaterial,
  FIRE_PIT,
  updateLawnTexture,
} from './yard.js';
import {
  initAudio,
  startMusic,
  setMusicMode,
  playJumpSound,
  playMooSound,
  playPoopSound,
  playBarkSound,
  playBiteSound,
} from './audio.js';

// Browsers block audio until a user gesture — kick it off on the first
// keypress or tap/click, whichever comes first.
function beginAudioOnFirstInput() {
  initAudio();
  startMusic();
}
window.addEventListener('keydown', beginAudioOnFirstInput, { once: true });
window.addEventListener('pointerdown', beginAudioOnFirstInput, { once: true });

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
controls.minDistance = 0.8;
controls.maxDistance = 26;

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
  hemi: { sky: 0x87ceeb, ground: 0x6b8e4e, intensity: 0.6 },
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
mom.position.set(-1.9, 0, 4.4);
mom.rotation.y = 0.7;
scene.add(mom);

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

function startGame(kind) {
  playerKind = kind;
  player = kind === 'darla' ? darla : mom;
  gameStarted = true;
  document.body.classList.toggle('miranda-mode', kind === 'miranda');
  document.getElementById('character-select').classList.add('hidden');
}

document.getElementById('pick-darla').addEventListener('click', () => startGame('darla'));
document.getElementById('pick-miranda').addEventListener('click', () => startGame('miranda'));

// Endless woods: trees stream in as chunks around Darla's current position
// (each chunk seeded so revisiting it looks the same) and unload once far
// behind her, so she can walk in any direction indefinitely without the
// tree count growing forever.
const CHUNK_LOAD_RADIUS = 3;
const CHUNK_UNLOAD_RADIUS = 4;
const loadedChunks = new Map();

function updateTreeChunks() {
  const currentCx = Math.floor(player.position.x / CHUNK_SIZE);
  const currentCz = Math.floor(player.position.z / CHUNK_SIZE);

  for (let dx = -CHUNK_LOAD_RADIUS; dx <= CHUNK_LOAD_RADIUS; dx++) {
    for (let dz = -CHUNK_LOAD_RADIUS; dz <= CHUNK_LOAD_RADIUS; dz++) {
      const cx = currentCx + dx;
      const cz = currentCz + dz;
      const key = `${cx},${cz}`;
      if (!loadedChunks.has(key)) {
        const chunk = createTreeChunk(cx, cz);
        scene.add(chunk);
        loadedChunks.set(key, chunk);
      }
    }
  }

  for (const [key, chunk] of loadedChunks) {
    const [cx, cz] = key.split(',').map(Number);
    if (
      Math.abs(cx - currentCx) > CHUNK_UNLOAD_RADIUS ||
      Math.abs(cz - currentCz) > CHUNK_UNLOAD_RADIUS
    ) {
      scene.remove(chunk);
      chunk.traverse((child) => {
        if (child.isMesh) child.geometry.dispose();
      });
      loadedChunks.delete(key);
    }
  }
}

updateTreeChunks();

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

// Day/night toggle: re-tunes the shared lights/fog/exposure/sprites in
// place rather than rebuilding the scene — see DAY_LIGHTING/NIGHT_LIGHTING
// above for the actual values.
let isDay = false;
function applyDayNight(day) {
  isDay = day;
  const cfg = day ? DAY_LIGHTING : NIGHT_LIGHTING;
  setMusicMode(day ? 'day' : 'night');

  scene.background.set(cfg.background);
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
  grassMaterial.uniforms.fogColor.value.set(cfg.fogColor);
  grassMaterial.uniforms.fogNear.value = cfg.fogNear;
  grassMaterial.uniforms.fogFar.value = cfg.fogFar;

  sunMoonLight.color.set(cfg.sun.color);
  sunMoonLight.intensity = cfg.sun.intensity;
  sunMoonLight.position.copy(cfg.sun.direction).multiplyScalar(6);

  fillLight.color.set(cfg.fill.color);
  fillLight.intensity = cfg.fill.intensity;

  hemiLight.color.set(cfg.hemi.sky);
  hemiLight.groundColor.set(cfg.hemi.ground);
  hemiLight.intensity = cfg.hemi.intensity;

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

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));

// Ambient occlusion for contact shadows — grounds objects against the
// lawn/floor and darkens tight corners (under the roof overhang, where the
// columns meet the patio floor) that direct lighting alone leaves flat.
// Tuned way down from the defaults (which assume a much larger scene scale)
// since Darla and the house are only a few units across.
const ssaoPass = new SSAOPass(scene, camera, window.innerWidth, window.innerHeight);
ssaoPass.kernelRadius = 0.3;
ssaoPass.minDistance = 0.0008;
ssaoPass.maxDistance = 0.05;
composer.addPass(ssaoPass);

const bloomPass = new UnrealBloomPass(
  new THREE.Vector2(window.innerWidth, window.innerHeight),
  0.25,
  0.6,
  0.85
);
composer.addPass(bloomPass);
composer.addPass(new OutputPass());

// Movement — WASD / arrow keys, relative to the camera so "forward" always
// means "away from where you're looking," with Darla turning to face the
// direction she's walking and her legs cycling into a trot.
const pressedKeys = new Set();
window.addEventListener('keydown', (e) => pressedKeys.add(e.code));
window.addEventListener('keyup', (e) => pressedKeys.delete(e.code));

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
    jumpHeld = true;
    if (!e.repeat) triggerJump();
  }
  if (e.code === 'Enter' && !e.repeat && playerKind === 'darla') {
    e.preventDefault();
    playMooSound();
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
});

// Bite: a prank rather than a useful skill — press the button and Darla
// chases Miranda down (re-targeting her every frame in case she's off on a
// collection run, rather than a single fixed point) instead of just
// biting from wherever she happens to be standing. Once she actually
// reaches her, Miranda's fed up and won't collect any more poops for the
// rest of the session (see the momAnnoyed guard in updateMom below); if
// she was mid-run when caught, she abandons whatever she was headed for
// and heads straight home instead of finishing the trip.
let momAnnoyed = false;
let biteElapsed = 0;
let biteActive = false;
let biteChasing = false;
const BITE_DURATION = 0.35;
const BITE_ARRIVE_DIST = 0.55;

function triggerBite() {
  playBiteSound();
  momAnnoyed = true;
  if (momState === 'walking') {
    momTargetPoop = null;
  }
  biteActive = true;
  biteElapsed = 0;
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
  if (ballState !== 'idle') return;
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
  ballThrowStart.set(player.position.x, 1.1, player.position.z);
  ballThrowTarget.set(tx, 0.06, tz);
  ball.visible = true;
  ball.position.copy(ballThrowStart);
}

ballButton.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  if (ballState !== 'idle') return;
  ballAiming = !ballAiming;
  ballButton.classList.toggle('aiming', ballAiming);
});

// Poops are left behind in the world, permanently, rather than attached to
// Darla, so she can walk away and leave them there — well, "permanently"
// until Mom comes and collects them (see updateMom below). Holding the
// button spawns a quick, slightly randomized scatter instead of just one.
let poopSpawnTimer = 0;
const POOP_SPAWN_INTERVAL = 0.1;
const poops = [];

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
  poop.position.set(x, 0, z);
  poop.rotation.y = Math.random() * Math.PI * 2;
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
  const point = new THREE.Vector3();
  return raycaster.ray.intersectPlane(groundPlaneMath, point) ? point : null;
}

renderer.domElement.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  pointerDownPos = { x: e.clientX, y: e.clientY };
});
renderer.domElement.addEventListener('pointerup', (e) => {
  if (e.button !== 0 || !pointerDownPos) return;
  const dragDist = Math.hypot(e.clientX - pointerDownPos.x, e.clientY - pointerDownPos.y);
  pointerDownPos = null;
  if (dragDist > 6) return; // was an orbit-camera drag, not a click

  const point = getGroundPoint(e.clientX, e.clientY);
  if (!point) return;

  if (ballAiming) {
    ballAiming = false;
    ballButton.classList.remove('aiming');
    throwBallTo(point.x, point.z);
    return;
  }

  const clamped = clampTargetPoint(point.x, point.z);
  moveTarget = new THREE.Vector3(clamped.x, 0, clamped.z);
  clickMarker.position.set(moveTarget.x, 0.02, moveTarget.z);
  clickMarker.visible = true;
});

const WALK_SPEED = 4.2;
const YARD_BOUNDS = { xMin: -9, xMax: 9, zMin: -4, zMax: 14 };

// The house is a solid obstacle you walk around, except through the
// doorway, which leads to the free-roam interior. INTERIOR_BOUNDS covers
// the whole interior floor (not just the doorway's width) so she isn't
// funneled back out the moment she steps sideways once inside — that's
// tracked with the `insideHouse` flag below rather than being inferred
// from position each frame, since "am I inside" and "is this point inside
// the wall footprint" are different questions.
const DOORWAY_X = { min: -0.3, max: 1.7 };
const INTERIOR_BOUNDS = { xMin: -5.2, xMax: 5.2, zMin: -14.1, zMax: -7.5 };
const HOUSE_SOLID = { xMin: -6.3, xMax: 6.3, zMin: -14.9, zMax: -7.5 };

let insideHouse = false;

function isInHouseFootprint(x, z) {
  return (
    x > HOUSE_SOLID.xMin &&
    x < HOUSE_SOLID.xMax &&
    z > HOUSE_SOLID.zMin &&
    z < HOUSE_SOLID.zMax
  );
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
  if (!isInHouseFootprint(x, z)) return { x, z };
  const distLeft = x - HOUSE_SOLID.xMin;
  const distRight = HOUSE_SOLID.xMax - x;
  const distFront = HOUSE_SOLID.zMax - z;
  const distBack = z - HOUSE_SOLID.zMin;
  const minDist = Math.min(distLeft, distRight, distFront, distBack);
  if (minDist === distFront) return { x, z: HOUSE_SOLID.zMax };
  if (minDist === distBack) return { x, z: HOUSE_SOLID.zMin };
  if (minDist === distLeft) return { x: HOUSE_SOLID.xMin, z };
  return { x: HOUSE_SOLID.xMax, z };
}

// Used for the per-frame movement step: has side effects (flips
// insideHouse) since it tracks Darla's actual physical journey through
// the doorway, in either direction.
function clampToWalkable(prevX, prevZ, x, z) {
  if (insideHouse) {
    const exiting =
      z > INTERIOR_BOUNDS.zMax && x >= DOORWAY_X.min && x <= DOORWAY_X.max;
    if (!exiting) {
      return {
        x: THREE.MathUtils.clamp(x, INTERIOR_BOUNDS.xMin, INTERIOR_BOUNDS.xMax),
        z: THREE.MathUtils.clamp(z, INTERIOR_BOUNDS.zMin, INTERIOR_BOUNDS.zMax),
      };
    }
    insideHouse = false;
  }

  if (
    z <= HOUSE_SOLID.zMax &&
    z > HOUSE_SOLID.zMin &&
    x >= DOORWAY_X.min &&
    x <= DOORWAY_X.max
  ) {
    insideHouse = true;
    return {
      x: THREE.MathUtils.clamp(x, INTERIOR_BOUNDS.xMin, INTERIOR_BOUNDS.xMax),
      z: THREE.MathUtils.clamp(z, INTERIOR_BOUNDS.zMin, INTERIOR_BOUNDS.zMax),
    };
  }

  // No outer boundary anymore — she can walk endlessly in any direction;
  // the house is the only obstacle out here.
  return pushOutOfHouse(prevX, prevZ, x, z);
}

// Used for picking a click-to-move destination: a stateless best-guess
// clamp (no insideHouse side effects) — the actual per-frame walk there
// still enforces the doorway properly as she physically approaches it.
function clampTargetPoint(x, z) {
  if (isInHouseFootprint(x, z)) {
    return {
      x: THREE.MathUtils.clamp(x, INTERIOR_BOUNDS.xMin, INTERIOR_BOUNDS.xMax),
      z: THREE.MathUtils.clamp(z, INTERIOR_BOUNDS.zMin, INTERIOR_BOUNDS.zMax),
    };
  }
  return nearestPointOutsideHouse(x, z);
}

const cameraForward = new THREE.Vector3();
const cameraRight = new THREE.Vector3();
const moveDir = new THREE.Vector3();
const worldUp = new THREE.Vector3(0, 1, 0);
const followOffset = new THREE.Vector3();

function wrapAngle(angle) {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}

// Darla's tiny AI, active only while Miranda is the one being played: sit
// by the fire, and whenever Miranda throws the ball, run over, grab it,
// and trot back home — the mirror image of Mom's own poop-collecting AI
// below (nearest-target, walk-toward-it, rotate-to-face idiom), just with
// a single ball instead of a list of poops.
const DARLA_HOME = new THREE.Vector3(darla.position.x, 0, darla.position.z);
const DARLA_FETCH_SPEED = 3.2;
const darlaFetchDir = new THREE.Vector3();
let darlaFetchState = 'idle'; // 'idle' | 'fetching' | 'returning'

// Returns whether she's currently moving, so the caller can drive her walk
// animation/bob the same way updateMovement's isMoving return value does
// for whichever character is actually player-controlled.
function updateDarlaFetch(delta) {
  if (darlaFetchState === 'idle') return false;

  const returning = darlaFetchState === 'returning';
  const target = returning ? DARLA_HOME : ball.position;
  darlaFetchDir.set(target.x - darla.position.x, 0, target.z - darla.position.z);
  const dist = darlaFetchDir.length();
  const arriveDist = returning ? 0.15 : 0.35;
  if (dist < arriveDist) {
    if (returning) {
      darlaFetchState = 'idle';
    } else {
      ball.visible = false;
      ballState = 'idle';
      playBarkSound();
      ballButton.disabled = false;
      ballButton.classList.remove('disabled');
      darlaFetchState = 'returning';
    }
    return false;
  }

  darlaFetchDir.normalize();
  darla.position.x += darlaFetchDir.x * DARLA_FETCH_SPEED * delta;
  darla.position.z += darlaFetchDir.z * DARLA_FETCH_SPEED * delta;
  const targetAngle = Math.atan2(darlaFetchDir.x, darlaFetchDir.z);
  darla.rotation.y += wrapAngle(targetAngle - darla.rotation.y) * Math.min(1, delta * 10);
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

function resetMomLimbs() {
  mom.userData.legs.legL.rotation.x = 0;
  mom.userData.legs.legR.rotation.x = 0;
  mom.userData.arms.armL.rotation.x = 0;
  mom.userData.arms.armR.rotation.x = 0;
}

function updateMom(delta) {
  if (momState === 'idle') {
    resetMomLimbs();
    if (momAnnoyed || poops.length === 0) return;
    let nearest = poops[0];
    let nearestDist = mom.position.distanceTo(nearest.position);
    for (let i = 1; i < poops.length; i++) {
      const dist = mom.position.distanceTo(poops[i].position);
      if (dist < nearestDist) {
        nearest = poops[i];
        nearestDist = dist;
      }
    }
    // momTargetPoop = nearest;
    // momState = 'walking';
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
    mom.position.y = Math.abs(Math.sin(elapsed * 9)) * 0.02;
    const targetAngle = Math.atan2(momMoveDir.x, momMoveDir.z);
    mom.rotation.y += wrapAngle(targetAngle - mom.rotation.y) * Math.min(1, delta * 8);

    const stride = elapsed * 10;
    mom.userData.legs.legL.rotation.x = Math.sin(stride) * 0.5;
    mom.userData.legs.legR.rotation.x = Math.sin(stride + Math.PI) * 0.5;
    mom.userData.arms.armL.rotation.x = Math.sin(stride + Math.PI) * 0.35;
    mom.userData.arms.armR.rotation.x = Math.sin(stride) * 0.35;
    return;
  }

  // pickingUp: a quick bend-down-and-back-up while the poop disappears
  resetMomLimbs();
  momPickupElapsed += delta;
  const t = Math.min(momPickupElapsed / MOM_PICKUP_DURATION, 1);
  const bend = Math.sin(t * Math.PI) * 0.55;
  mom.rotation.x = bend;
  mom.position.y = -bend * 0.15;
  if (t >= 1) {
    mom.rotation.x = 0;
    mom.position.y = 0;
    scene.remove(momTargetPoop);
    momTargetPoop.traverse((child) => {
      if (child.isMesh) child.geometry.dispose();
    });
    const idx = poops.indexOf(momTargetPoop);
    if (idx !== -1) poops.splice(idx, 1);
    momTargetPoop = null;
    // If there's another poop waiting, go idle so the branch above picks
    // the nearest one immediately next frame instead of detouring home
    // first — only actually heads back to MOM_HOME once there's nothing
    // left to clean up.
    momState = poops.length > 0 ? 'idle' : 'walking';
  }
}

function updateMovement(delta) {
  camera.getWorldDirection(cameraForward);
  cameraForward.y = 0;
  cameraForward.normalize();
  cameraRight.crossVectors(cameraForward, worldUp);

  moveDir.set(0, 0, 0);
  const keyUp = pressedKeys.has('KeyW') || pressedKeys.has('ArrowUp');
  const keyDown = pressedKeys.has('KeyS') || pressedKeys.has('ArrowDown');
  const keyRight = pressedKeys.has('KeyD') || pressedKeys.has('ArrowRight');
  const keyLeft = pressedKeys.has('KeyA') || pressedKeys.has('ArrowLeft');
  const keyboardActive = keyUp || keyDown || keyRight || keyLeft;

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
    // Faster stride specifically while she's running to fetch a thrown
    // ball (ballState stays 'thrown' for exactly the duration of her fetch
    // run — see updateDarlaFetch) — an eager sprint rather than her normal
    // walk/player-driven pace.
    const stride = elapsed * (ballState === 'thrown' ? 19 * 1.6 : 19);
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
  if (!gameStarted || isJumping) return;
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

function onResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  composer.setSize(window.innerWidth, window.innerHeight);
}
window.addEventListener('resize', onResize);

const clock = new THREE.Clock();
let elapsed = 0;

function animate() {
  requestAnimationFrame(animate);
  const delta = clock.getDelta();
  elapsed += delta;

  if (gameStarted) {
    updateBiteChase();
    const isMoving = updateMovement(delta);
    const jumpY = updateJump(delta);
    const baseY =
      playerKind === 'darla'
        ? updateWalkCycle(isMoving, isJumping, isJumping && jumpHeld)
        : updateMirandaWalkCycle(isMoving);
    player.position.y = baseY + jumpY;
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
  // over the same rotations every frame.
  if (playerKind !== 'miranda') {
    updateMom(delta);
    if (momState === 'idle') {
      mom.userData.torso.rotation.y = Math.sin(elapsed * 0.4) * 0.04;
      mom.userData.head.rotation.y = Math.sin(elapsed * 0.55 + 1) * 0.06;
      mom.userData.hairBack.rotation.z = Math.sin(elapsed * 0.9) * 0.02;
    }
  }

  if (clickMarker.visible) {
    clickMarker.scale.setScalar(1 + Math.sin(elapsed * 8) * 0.08);
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
    }
  }

  // Darla's fetch AI only runs while Miranda is the one being played —
  // it's what makes the thrown ball actually go somewhere. Reuses her own
  // (quadruped) walk cycle for the run, same as the player-driven path
  // does, just fed by her AI's isMoving instead of WASD/click-to-move.
  if (playerKind === 'miranda') {
    const fetching = updateDarlaFetch(delta);
    darla.position.y = updateWalkCycle(fetching, false, false);
  }

  // camera follows whichever character is being played, keeping the same
  // relative angle/distance the player has set up via orbit controls —
  // held still at its starting shot until a character is actually chosen.
  if (gameStarted) {
    followOffset
      .set(player.position.x, 0.5, player.position.z)
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

  // fire pit flicker
  const firePit = yard.userData.firePit;
  firePit.userData.flames.children.forEach((flame, i) => {
    const flicker = Math.sin(elapsed * (14 + i * 3)) * 0.15 + Math.random() * 0.1;
    flame.scale.set(1 + flicker * 0.3, 1 + flicker, 1 + flicker * 0.3);
  });
  firePit.userData.light.intensity = 1.1 + Math.sin(elapsed * 17) * 0.2 + Math.random() * 0.15;

  yard.userData.fanBlades.rotation.y = elapsed * 6;

  // interior fireplace flicker
  yard.userData.fireplaceFlames.children.forEach((flame, i) => {
    const flicker = Math.sin(elapsed * (15 + i * 3)) * 0.15 + Math.random() * 0.1;
    flame.scale.set(1 + flicker * 0.3, 1 + flicker, 1 + flicker * 0.3);
  });
  yard.userData.fireplaceLight.intensity =
    0.85 + Math.sin(elapsed * 18) * 0.15 + Math.random() * 0.12;

  grassMaterial.uniforms.uTime.value = elapsed;

  updateTreeChunks();

  // The lawn is a large-but-finite plane (its texture tiles seamlessly via
  // RepeatWrapping) so it can just follow whoever's playing around instead
  // of needing genuinely infinite geometry — otherwise, since the woods
  // stream in endlessly around them, walking past the plane's fixed edge
  // would drop them off the grass into bare background color. Recentering
  // the mesh alone would leave its texture glued in place relative to the
  // player instead of scrolling like real ground — updateLawnTexture keeps
  // the pattern anchored to world coordinates regardless.
  yard.userData.lawn.position.set(player.position.x, 0, player.position.z);
  updateLawnTexture(yard.userData.lawn, player.position.x, player.position.z);

  starfield.position.set(player.position.x, 0, player.position.z);
  starfield.userData.material.uniforms.uTime.value = elapsed;

  controls.update();
  composer.render();
}

animate();
