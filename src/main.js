import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { createDarla } from './darla.js';
import { createYard } from './yard.js';
import { initAudio, startMusic, playJumpSound, playMooSound } from './audio.js';

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

// Yard: lawn, house, and tree line
scene.add(createYard());

// Darla
const darla = createDarla();
scene.add(darla);

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

// A real place in the sky, high above the tree line. Rendered without depth
// testing (so the roof/trees can never block it) and exempt from fog (so it
// stays bright instead of fading to the fog color at distance) — those were
// the two actual bugs that made it "disappear" before, not its being in
// world space.
const sunMaterial = new THREE.SpriteMaterial({
  map: makeSunTexture(),
  transparent: true,
  toneMapped: false,
  depthTest: false,
  depthWrite: false,
  fog: false,
});
const sunSprite = new THREE.Sprite(sunMaterial);
sunSprite.scale.set(7, 7, 1);
sunSprite.renderOrder = -1;
sunSprite.position.set(-16, 20, -26);
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

document.querySelector('#touch-controls button[data-action="jump"]').addEventListener(
  'pointerdown',
  (e) => {
    e.preventDefault();
    triggerJump();
  }
);

// Space bar jumps, Enter makes her moo
window.addEventListener('keydown', (e) => {
  if (e.code === 'Space' && !e.repeat) {
    e.preventDefault();
    triggerJump();
  }
  if (e.code === 'Enter' && !e.repeat) {
    e.preventDefault();
    playMooSound();
  }
});

document.getElementById('moo-button').addEventListener('pointerdown', (e) => {
  e.preventDefault();
  playMooSound();
});

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
  moveTarget = new THREE.Vector3(
    THREE.MathUtils.clamp(point.x, YARD_BOUNDS.xMin, YARD_BOUNDS.xMax),
    0,
    THREE.MathUtils.clamp(point.z, YARD_BOUNDS.zMin, YARD_BOUNDS.zMax)
  );
  clickMarker.position.set(moveTarget.x, 0.02, moveTarget.z);
  clickMarker.visible = true;
});

const WALK_SPEED = 2.6;
const YARD_BOUNDS = { xMin: -9, xMax: 9, zMin: -4, zMax: 14 };

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
    darla.position.x = THREE.MathUtils.clamp(
      darla.position.x + moveDir.x * WALK_SPEED * delta,
      YARD_BOUNDS.xMin,
      YARD_BOUNDS.xMax
    );
    darla.position.z = THREE.MathUtils.clamp(
      darla.position.z + moveDir.z * WALK_SPEED * delta,
      YARD_BOUNDS.zMin,
      YARD_BOUNDS.zMax
    );

    const targetAngle = Math.atan2(moveDir.x, moveDir.z);
    darla.rotation.y += wrapAngle(targetAngle - darla.rotation.y) * Math.min(1, delta * 10);
  }

  return isMoving;
}

function updateWalkCycle(isMoving, jumping) {
  const legs = darla.userData.legs;
  if (jumping) {
    legs.legFR.rotation.x = -0.5;
    legs.legFL.rotation.x = -0.5;
    legs.legBR.rotation.x = 0.4;
    legs.legBL.rotation.x = 0.4;
    return 0;
  }
  if (isMoving) {
    const stride = elapsed * 12;
    legs.legFR.rotation.x = Math.sin(stride) * 0.45;
    legs.legBL.rotation.x = Math.sin(stride) * 0.45;
    legs.legFL.rotation.x = Math.sin(stride + Math.PI) * 0.45;
    legs.legBR.rotation.x = Math.sin(stride + Math.PI) * 0.45;
    return Math.abs(Math.sin(stride * 2)) * 0.025;
  }
  legs.legFR.rotation.x = 0;
  legs.legFL.rotation.x = 0;
  legs.legBR.rotation.x = 0;
  legs.legBL.rotation.x = 0;
  return Math.sin(elapsed * 1.6) * 0.01;
}

// Jump — a simple gravity arc triggered by space bar or the on-screen button
const JUMP_SPEED = 3.4;
const GRAVITY = 9;
let isJumping = false;
let jumpVelocity = 0;
let jumpHeight = 0;

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
  const baseY = updateWalkCycle(isMoving, isJumping);
  darla.position.y = baseY + jumpY;

  // tail wag + head sway so there's life on screen even standing still
  darla.userData.tail.rotation.y = Math.sin(elapsed * 5) * 0.5;
  darla.userData.head.rotation.y = Math.sin(elapsed * 0.7) * 0.08;

  if (clickMarker.visible) {
    clickMarker.scale.setScalar(1 + Math.sin(elapsed * 8) * 0.08);
  }

  // camera follows Darla, keeping the same relative angle/distance the
  // player has set up via orbit controls
  followOffset
    .set(darla.position.x, 0.5, darla.position.z)
    .sub(controls.target)
    .multiplyScalar(0.08);
  controls.target.add(followOffset);
  camera.position.add(followOffset);

  sunSprite.position.y = 20 + Math.sin(elapsed * 0.8) * 0.2;
  sunSprite.material.rotation = elapsed * 0.05;

  controls.update();
  composer.render();
}

animate();
