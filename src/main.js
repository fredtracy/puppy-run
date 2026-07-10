import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { createDarla, createPoop } from './darla.js';
import { createYard, createTreeChunk, CHUNK_SIZE } from './yard.js';
import {
  initAudio,
  startMusic,
  playJumpSound,
  playMooSound,
  playPoopSound,
  playBarkSound,
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
scene.background = new THREE.Color(0x87ceeb);
scene.fog = new THREE.Fog(0x87ceeb, 18, 55);

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
renderer.toneMappingExposure = 1.15;
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.body.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 0.5, 0);
controls.enableDamping = true;
controls.minDistance = 0.8;
controls.maxDistance = 26;

// Image-based lighting so materials get realistic reflections/ambient
// without depending on an external HDRI download.
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

// Sun + fill lighting on top of the environment lighting
const sunLight = new THREE.DirectionalLight(0xfff2e0, 2.2);
sunLight.position.set(3, 4, 2);
sunLight.castShadow = true;
sunLight.shadow.mapSize.set(2048, 2048);
sunLight.shadow.camera.left = -14;
sunLight.shadow.camera.right = 14;
sunLight.shadow.camera.top = 14;
sunLight.shadow.camera.bottom = -14;
sunLight.shadow.camera.near = 1;
sunLight.shadow.camera.far = 30;
sunLight.shadow.bias = -0.0015;
scene.add(sunLight);

const fillLight = new THREE.DirectionalLight(0xcfe8ff, 0.4);
fillLight.position.set(-4, 2, -3);
scene.add(fillLight);

// Yard: lawn, house, tree line, and fire pit
const yard = createYard();
scene.add(yard);

// Darla
const darla = createDarla();
scene.add(darla);

// Endless woods: trees stream in as chunks around Darla's current position
// (each chunk seeded so revisiting it looks the same) and unload once far
// behind her, so she can walk in any direction indefinitely without the
// tree count growing forever.
const CHUNK_LOAD_RADIUS = 3;
const CHUNK_UNLOAD_RADIUS = 4;
const loadedChunks = new Map();

function updateTreeChunks() {
  const currentCx = Math.floor(darla.position.x / CHUNK_SIZE);
  const currentCz = Math.floor(darla.position.z / CHUNK_SIZE);

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

// A cheerful smiling sun, hand-drawn onto a canvas texture and billboarded
// so it always faces the camera
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

// A real place in the sky, genuinely far away rather than just "high up" —
// at this distance, normal depth testing keeps it correctly behind Darla,
// the roof, and trees whenever they're actually in the way (as they should
// be), while it still reads as impossibly distant everywhere else. Disabling
// depth testing (an earlier attempt at fixing occlusion) was the wrong fix —
// it made the sun draw on top of literally everything, including Darla.
// Still exempt from fog so it doesn't fade to the fog color at this range.
const sunMaterial = new THREE.SpriteMaterial({
  map: makeSunTexture(),
  transparent: true,
  toneMapped: false,
  fog: false,
});
const sunSprite = new THREE.Sprite(sunMaterial);
sunSprite.scale.set(28, 28, 1);
sunSprite.position.set(-65, 40, 100);
scene.add(sunSprite);

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
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
  if (e.code === 'Enter' && !e.repeat) {
    e.preventDefault();
    playMooSound();
  }
  if (e.code === 'Backspace' && !e.repeat) {
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

// Fetch: click the ball button to arm a throw, then click/tap a spot in the
// yard to throw it there (clamped to a reasonable distance from Darla).
// Darla walks to it (reusing the click-to-move system); the button stays
// greyed out until she arrives.
const ballButton = document.getElementById('ball-button');
const ballMat = new THREE.MeshStandardMaterial({ color: 0xd93025, roughness: 0.55 });
const ball = new THREE.Mesh(new THREE.SphereGeometry(0.06, 12, 10), ballMat);
ball.castShadow = true;
ball.visible = false;
scene.add(ball);

let ballState = 'idle'; // 'idle' | 'flying' | 'thrown'
let ballAiming = false;
let ballThrowElapsed = 0;
const BALL_THROW_DURATION = 0.55;
const MAX_THROW_DIST = 8;
const ballThrowStart = new THREE.Vector3();
const ballThrowTarget = new THREE.Vector3();

function throwBallTo(x, z) {
  if (ballState !== 'idle') return;
  ballState = 'flying';
  ballThrowElapsed = 0;
  ballButton.disabled = true;
  ballButton.classList.add('disabled');

  const dx = x - darla.position.x;
  const dz = z - darla.position.z;
  const dist = Math.hypot(dx, dz);
  const scale = dist > MAX_THROW_DIST ? MAX_THROW_DIST / dist : 1;
  const tx = THREE.MathUtils.clamp(
    darla.position.x + dx * scale,
    YARD_BOUNDS.xMin,
    YARD_BOUNDS.xMax
  );
  const tz = THREE.MathUtils.clamp(
    darla.position.z + dz * scale,
    YARD_BOUNDS.zMin,
    YARD_BOUNDS.zMax
  );

  // Falls from directly above the landing spot, like the player tossed it
  // in from off-screen, rather than Darla lobbing it herself.
  ballThrowStart.set(tx, 7, tz);
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
// Darla, so she can walk away and leave them there. Holding the button spawns
// a quick, slightly randomized scatter of them instead of just one.
let poopSpawnTimer = 0;
const POOP_SPAWN_INTERVAL = 0.1;

function spawnPoop(spread = 1) {
  const behindX = -Math.sin(darla.rotation.y);
  const behindZ = -Math.cos(darla.rotation.y);
  const jitterX = (Math.random() - 0.5) * 0.5 * spread;
  const jitterZ = (Math.random() - 0.5) * 0.35 * spread;
  const poop = createPoop();
  poop.position.set(
    darla.position.x + behindX * 0.35 + jitterX,
    0,
    darla.position.z + behindZ * 0.35 + jitterZ
  );
  poop.rotation.y = Math.random() * Math.PI * 2;
  scene.add(poop);
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
    const dx = moveTarget.x - darla.position.x;
    const dz = moveTarget.z - darla.position.z;
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
    const speed = ballState === 'thrown' ? WALK_SPEED * 1.6 : WALK_SPEED;
    const clamped = clampToWalkable(
      darla.position.x,
      darla.position.z,
      darla.position.x + moveDir.x * speed * delta,
      darla.position.z + moveDir.z * speed * delta
    );
    darla.position.x = clamped.x;
    darla.position.z = clamped.z;

    const targetAngle = Math.atan2(moveDir.x, moveDir.z);
    darla.rotation.y += wrapAngle(targetAngle - darla.rotation.y) * Math.min(1, delta * 10);
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
  if (isJumping) return;
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

  const isMoving = updateMovement(delta);
  const jumpY = updateJump(delta);
  const baseY = updateWalkCycle(isMoving, isJumping, isJumping && jumpHeld);
  darla.position.y = baseY + jumpY;

  // tail wag + head sway so there's life on screen even standing still
  darla.userData.tail.rotation.y = Math.sin(elapsed * 5) * 0.5;
  darla.userData.head.rotation.y = Math.sin(elapsed * 0.7) * 0.08;

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
    const t = Math.min(ballThrowElapsed / BALL_THROW_DURATION, 1);
    const fallT = t * t; // ease-in, accelerating like it's actually falling
    ball.position.x = ballThrowTarget.x;
    ball.position.z = ballThrowTarget.z;
    ball.position.y = THREE.MathUtils.lerp(ballThrowStart.y, ballThrowTarget.y, fallT);
    if (t >= 1) {
      ballState = 'thrown';
      moveTarget = new THREE.Vector3(ballThrowTarget.x, 0, ballThrowTarget.z);
      clickMarker.visible = false;
    }
  } else if (ballState === 'thrown') {
    const dx = darla.position.x - ball.position.x;
    const dz = darla.position.z - ball.position.z;
    if (Math.hypot(dx, dz) < 0.4) {
      ballState = 'idle';
      ball.visible = false;
      playBarkSound();
      ballButton.disabled = false;
      ballButton.classList.remove('disabled');
    }
  }

  // camera follows Darla, keeping the same relative angle/distance the
  // player has set up via orbit controls
  followOffset
    .set(darla.position.x, 0.5, darla.position.z)
    .sub(controls.target)
    .multiplyScalar(0.08);
  controls.target.add(followOffset);
  camera.position.add(followOffset);

  sunSprite.position.y = 40 + Math.sin(elapsed * 0.8) * 0.6;

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

  updateTreeChunks();

  // The lawn is a large-but-finite plane (its speckle texture tiles
  // seamlessly via RepeatWrapping) so it can just follow Darla around
  // instead of needing genuinely infinite geometry — otherwise, since the
  // woods stream in endlessly around her, walking past the plane's fixed
  // edge would drop her off the grass into bare background color.
  yard.userData.lawn.position.set(darla.position.x, 0, darla.position.z);

  controls.update();
  composer.render();
}

animate();
