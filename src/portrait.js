// Shooting a character out of the world and into a flat image.
//
// Shared by the loading screen (Darla, full body, nose to tail) and the
// day/night transition (Miranda, head and shoulders). Both work the same way:
// take one render up front, then treat the result as a 2D image for the rest
// of its life. That's what lets either screen keep animating while the main
// thread is busy — no per-frame 3D work is involved once the shot is taken.
//
// Orthographic rather than perspective. These are stickers on a flat screen,
// and perspective foreshortening on a character seen side-on mostly just makes
// the far limbs look wrong.

import * as THREE from 'three';

export function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

// The camera always sits on +X looking back at the subject, which puts world
// -Z to the right of frame. Characters are modelled facing +Z, so with no yaw
// that's a left-facing profile; `yaw` turns the subject on the spot to pick
// any other angle against that fixed camera.
//
// Returns the image plus a `project` for turning a world position into a pixel
// coordinate in it — which is how the transition knows where on her face to
// put the wings without hardcoding anything.
export function captureObject(renderer, object, options) {
  const {
    width,
    height,
    yaw = 0,
    elevation = 0.2,
    padX = 0.06,
    padTop = 0.05,
    padBottom = 0.05,
    lights = defaultLights,
    frame = null,
    pose = null,
    points = null,
  } = options;

  const scene = new THREE.Scene();

  // Stand the subject at the origin for the shot, then put everything back
  // exactly as it was — they're already placed in the world by this point and
  // are about to be animated.
  const parent = object.parent;
  const savedPosition = object.position.clone();
  const savedRotation = object.rotation.clone();
  object.position.set(0, 0, 0);
  object.rotation.set(0, yaw, 0);
  scene.add(object);

  const restorePose = pose ? pose(object) : null;

  for (const light of lights()) scene.add(light);

  object.updateWorldMatrix(false, true);

  // Visible meshes only. Box3.setFromObject would happily include hidden
  // children — Darla's stowed dress, for one — and framing to a garment that
  // never renders just shrinks her inside a margin of nothing.
  const box = new THREE.Box3();
  const subject = frame ? frame(object) : object;
  subject.traverseVisible((node) => {
    if (node.isMesh) box.expandByObject(node);
  });
  const center = box.getCenter(new THREE.Vector3());

  // Lifting the camera in the X-Y plane leaves screen-right pointing along
  // world -Z regardless, so elevation is free to set without disturbing which
  // way round the subject reads.
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 100);
  camera.position.set(
    center.x + 5 * Math.cos(elevation),
    center.y + 5 * Math.sin(elevation),
    center.z
  );
  camera.lookAt(center);
  camera.updateMatrixWorld(true);
  camera.matrixWorldInverse.copy(camera.matrixWorld).invert();

  // Fit the frustum by pushing the framing box's eight corners through the
  // view matrix and taking their extents on screen. Measuring the world-space
  // box's width and height instead only works while the camera is exactly
  // side-on and level, and would quietly crop the subject the next time the
  // angle is touched.
  const corner = new THREE.Vector3();
  let minU = Infinity;
  let maxU = -Infinity;
  let minV = Infinity;
  let maxV = -Infinity;
  for (let i = 0; i < 8; i++) {
    corner
      .set(
        i & 1 ? box.max.x : box.min.x,
        i & 2 ? box.max.y : box.min.y,
        i & 4 ? box.max.z : box.min.z
      )
      .applyMatrix4(camera.matrixWorldInverse);
    minU = Math.min(minU, corner.x);
    maxU = Math.max(maxU, corner.x);
    minV = Math.min(minV, corner.y);
    maxV = Math.max(maxV, corner.y);
  }

  const spanU = maxU - minU;
  const spanV = maxV - minV;
  let left = minU - spanU * padX;
  let right = maxU + spanU * padX;
  let bottom = minV - spanV * padBottom;
  let top = maxV + spanV * padTop;

  // Widen whichever axis is short, about its own centre, so the subject is
  // fitted to the canvas without being cropped or stretched.
  const aspect = width / height;
  if ((right - left) / (top - bottom) < aspect) {
    const want = (top - bottom) * aspect;
    const mid = (left + right) / 2;
    left = mid - want / 2;
    right = mid + want / 2;
  } else {
    const want = (right - left) / aspect;
    const mid = (top + bottom) / 2;
    bottom = mid - want / 2;
    top = mid + want / 2;
  }
  camera.left = left;
  camera.right = right;
  camera.top = top;
  camera.bottom = bottom;
  camera.updateProjectionMatrix();

  // Project any requested markers *now*, while the subject is still standing
  // in the shot. Doing it afterwards would mean undoing the restore below to
  // work out where anything was, which is exactly the kind of matrix algebra
  // that silently produces plausible-looking wrong answers.
  const projected = [];
  if (points) {
    const v = new THREE.Vector3();
    for (const node of points(object)) {
      node.getWorldPosition(v);
      v.applyMatrix4(camera.matrixWorldInverse).applyMatrix4(camera.projectionMatrix);
      projected.push({ x: ((v.x + 1) / 2) * width, y: ((1 - v.y) / 2) * height });
    }
  }

  const target = new THREE.WebGLRenderTarget(width, height, { samples: 4 });
  target.texture.colorSpace = THREE.SRGBColorSpace;

  const prevTarget = renderer.getRenderTarget();
  const prevClear = new THREE.Color();
  renderer.getClearColor(prevClear);
  const prevClearAlpha = renderer.getClearAlpha();

  renderer.setRenderTarget(target);
  renderer.setClearColor(0x000000, 0);
  renderer.clear();
  renderer.render(scene, camera);

  const raw = new Uint8Array(width * height * 4);
  renderer.readRenderTargetPixels(target, 0, 0, width, height, raw);

  renderer.setRenderTarget(prevTarget);
  renderer.setClearColor(prevClear, prevClearAlpha);
  target.dispose();

  if (restorePose) restorePose();
  if (parent) parent.add(object);
  else scene.remove(object);
  object.position.copy(savedPosition);
  object.rotation.copy(savedRotation);

  // GL reads bottom-up, ImageData is top-down. Antialiased edge pixels come
  // back premultiplied (the MSAA resolve averages covered samples against a
  // fully transparent clear), so they're divided back out — skip that and the
  // subject gets a dark fringe everywhere it meets a pale background.
  const image = new ImageData(width, height);
  const out = image.data;
  for (let y = 0; y < height; y++) {
    let src = (height - 1 - y) * width * 4;
    let dst = y * width * 4;
    for (let x = 0; x < width; x++, src += 4, dst += 4) {
      const a = raw[src + 3];
      if (a === 0 || a === 255) {
        out[dst] = raw[src];
        out[dst + 1] = raw[src + 1];
        out[dst + 2] = raw[src + 2];
      } else {
        out[dst] = Math.min(255, (raw[src] * 255) / a);
        out[dst + 1] = Math.min(255, (raw[src + 1] * 255) / a);
        out[dst + 2] = Math.min(255, (raw[src + 2] * 255) / a);
      }
      out[dst + 3] = a;
    }
  }

  return { image, points: projected };
}

// A warm key from the front and a cool fill from behind. Roughly the daytime
// yard, which keeps a portrait and the first real frame of the game from
// looking like two different characters.
function defaultLights() {
  const key = new THREE.DirectionalLight(0xfff1d8, 3.4);
  key.position.set(2.5, 3, 2);
  const fill = new THREE.DirectionalLight(0xcfe0ff, 1.1);
  fill.position.set(-2, 0.6, -1.5);
  return [new THREE.AmbientLight(0xffffff, 1.8), key, fill];
}

// Where the subject actually landed in frame, in pixels. Measured off the
// alpha rather than assumed, so a reframe can't silently break anything that
// positions itself off the subject's edges.
export function measureBounds(image, w, h) {
  const data = image.data;
  let minX = w;
  let maxX = -1;
  let minY = h;
  let maxY = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (data[(y * w + x) * 4 + 3] < 8) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  return maxX < 0 ? { minX: 0, maxX: w, minY: 0, maxY: h } : { minX, maxX, minY, maxY };
}
