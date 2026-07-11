import * as THREE from 'three';

function mesh(geometry, material) {
  const m = new THREE.Mesh(geometry, material);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

function makeSpeckleTexture(base, variance, repeatX, repeatY) {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 4000; i++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const dark = Math.random() > 0.5;
    ctx.fillStyle = `rgba(${dark ? 0 : 255},${dark ? 0 : 255},${dark ? 0 : 255},${(Math.random() * variance) / 255})`;
    ctx.fillRect(x, y, 1.5, 1.5);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(repeatX, repeatY);
  texture.colorSpace = THREE.SRGBColorSpace;
  // Without this, tiled textures shimmer/moiré at grazing viewing angles —
  // most noticeable exactly at the house's corners, where a wall face is
  // seen nearly edge-on. The renderer clamps this to whatever the GPU
  // actually supports, so it's safe to just ask for the max.
  texture.anisotropy = 16;
  return texture;
}

// A blotchy "clumps of leaves" value texture — soft overlapping circles at a
// few brightness levels, tiled onto the canopy blobs and multiplied by each
// material's own green tint (see LEAF_MATS below). Cheap to generate once
// and share across every tree instead of a downloaded photo, which doesn't
// map cleanly onto a handful of low-poly spheres anyway.
function makeFoliageTexture() {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = 'rgb(190,190,190)';
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 140; i++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const r = 6 + Math.random() * 22;
    const shade = Math.random() > 0.5 ? 120 + Math.random() * 40 : 210 + Math.random() * 45;
    ctx.fillStyle = `rgba(${shade},${shade},${shade},${0.35 + Math.random() * 0.35})`;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(2, 2);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

const textureLoader = new THREE.TextureLoader();

// Real photographed CC0 textures (polyhaven.com) instead of hand-drawn
// canvas speckle — diffuse + normal + roughness maps give actual physical
// depth and per-pixel material variation under lighting. `folder` doubles
// as the shared filename prefix, matching how Poly Haven ships each set;
// `diffuseSuffix` covers the one inconsistency between sets ("diffuse" for
// brick_wall_001, "diff" for everything else added since).
function loadPbrTextures(folder, diffuseSuffix, repeatX, repeatY) {
  const base = `${import.meta.env.BASE_URL}textures/${folder}/${folder}_`;
  const map = textureLoader.load(`${base}${diffuseSuffix}_1k.jpg`);
  map.colorSpace = THREE.SRGBColorSpace;
  const normalMap = textureLoader.load(`${base}nor_gl_1k.jpg`);
  const roughnessMap = textureLoader.load(`${base}rough_1k.jpg`);
  [map, normalMap, roughnessMap].forEach((texture) => {
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(repeatX, repeatY);
    texture.anisotropy = 16;
  });
  return { map, normalMap, roughnessMap };
}

function loadBrickTextures() {
  return loadPbrTextures('brick_wall_001', 'diffuse', 4, 2);
}

function loadBarkTextures() {
  return loadPbrTextures('bark_brown_02', 'diff', 1, 2);
}

function loadRoofTextures() {
  // 1.5x1 instead of 6x4 — 4x fewer repeats across the same roof surface,
  // so each shingle reads at roughly actual size instead of tiling tiny.
  return loadPbrTextures('grey_roof_01', 'diff', 1.5, 1);
}

function loadConcreteTextures() {
  return loadPbrTextures('concrete_floor', 'diff', 3, 2);
}

// Negative Y repeat compensates for how the lawn plane gets rotated flat
// (rotation.x = -PI/2) — without it, the offset compensation in
// updateLawnTexture below would scroll the texture backwards on the Z
// axis relative to how it scrolls correctly on X.
function loadLawnTextures() {
  return loadPbrTextures('leafy_grass', 'diff', 25, -25);
}

function loadWoodFloorTextures() {
  return loadPbrTextures('wood_floor', 'diff', 5, 3);
}

function makeSignTexture(text) {
  const w = 512;
  const h = 140;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#d9c39a';
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = '#7a5230';
  ctx.lineWidth = 8;
  ctx.strokeRect(4, 4, w - 8, h - 8);
  ctx.fillStyle = '#4a2f1a';
  ctx.font = 'bold 64px Georgia, serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, w / 2, h / 2 + 4);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

// A unit hip-roof pyramid, rotated so its base is axis-aligned, wrapped in a
// group so it can be non-uniformly scaled to any width/depth/height without
// distorting the rotation.
function buildHipRoof(width, depth, height, material) {
  const geo = new THREE.ConeGeometry(1 / Math.SQRT2, 1, 4, 1, true);
  const inner = mesh(geo, material);
  inner.rotation.y = Math.PI / 4;
  const group = new THREE.Group();
  group.add(inner);
  group.scale.set(width, height, depth);
  return group;
}

function buildWindow(w, h, trimMat, glassMat) {
  const group = new THREE.Group();
  const frame = mesh(new THREE.BoxGeometry(w, h, 0.06), trimMat);
  group.add(frame);
  const glass = mesh(new THREE.PlaneGeometry(w * 0.85, h * 0.85), glassMat);
  glass.position.z = 0.035;
  group.add(glass);
  const vBar = mesh(new THREE.BoxGeometry(0.04, h * 0.85, 0.02), trimMat);
  vBar.position.z = 0.05;
  group.add(vBar);
  const hBar = mesh(new THREE.BoxGeometry(w * 0.85, 0.04, 0.02), trimMat);
  hBar.position.z = 0.05;
  group.add(hBar);
  return group;
}

function buildFrenchDoors(totalW, h, trimMat, glassMat, rightOpen = false) {
  const group = new THREE.Group();
  const doorW = totalW / 2 - 0.03;
  const left = buildWindow(doorW, h, trimMat, glassMat);
  left.position.x = -totalW / 4;
  group.add(left);
  if (!rightOpen) {
    const right = buildWindow(doorW, h, trimMat, glassMat);
    right.position.x = totalW / 4;
    group.add(right);
    const centerMullion = mesh(new THREE.BoxGeometry(0.06, h, 0.08), trimMat);
    group.add(centerMullion);
  }
  return group;
}

export function createHouse() {
  const group = new THREE.Group();
  const width = 11;
  const depth = 7;
  const wallHeight = 2.7;
  const roofHeight = 2.3;

  const brickTextures = loadBrickTextures();
  const brickMat = new THREE.MeshStandardMaterial({
    map: brickTextures.map,
    normalMap: brickTextures.normalMap,
    roughnessMap: brickTextures.roughnessMap,
    roughness: 1,
  });
  const roofTextures = loadRoofTextures();
  const roofMat = new THREE.MeshStandardMaterial({
    map: roofTextures.map,
    normalMap: roofTextures.normalMap,
    roughnessMap: roofTextures.roughnessMap,
    roughness: 1,
  });
  const trimMat = new THREE.MeshStandardMaterial({
    map: makeSpeckleTexture('#e8e2d1', 20, 6, 2),
    roughness: 0.75,
  });
  const glassMat = new THREE.MeshPhysicalMaterial({
    color: 0x1b2b33,
    roughness: 0.15,
    metalness: 0.1,
    clearcoat: 0.4,
  });
  const concreteTextures = loadConcreteTextures();
  const concreteMat = new THREE.MeshStandardMaterial({
    map: concreteTextures.map,
    normalMap: concreteTextures.normalMap,
    roughnessMap: concreteTextures.roughnessMap,
    roughness: 1,
  });
  const interiorWallMat = new THREE.MeshStandardMaterial({
    color: 0xf5f2ea,
    roughness: 0.9,
  });
  const ceilingMat = new THREE.MeshStandardMaterial({ color: 0xfafaf6, roughness: 0.9 });
  const woodMat = new THREE.MeshStandardMaterial({ color: 0x7a5230, roughness: 0.6 });

  // Walls are a hollow shell (not one solid box) with a doorway gap in the
  // front wall, matching the right patio door, so Darla can actually walk
  // inside rather than the "door" just being a decorative overlay on solid
  // brick. Brick faces outward, plain white faces the interior — matching
  // the reference photo of the living room.
  const wallThickness = 0.3;
  const doorway = { xMin: -0.1, xMax: 1.25, yMax: 2.2 };

  // Physical size (world units) that one repeat of the brick texture should
  // cover, so bricks read as the same size on every wall piece instead of a
  // different density on every differently-sized surface.
  const brickTileSize = wallHeight / 2;
  function scaledBrickMat(faceWidth, faceHeight) {
    const repeatX = faceWidth / brickTileSize;
    const repeatY = faceHeight / brickTileSize;
    const map = brickMat.map.clone();
    map.needsUpdate = true;
    map.repeat.set(repeatX, repeatY);
    const normalMap = brickMat.normalMap.clone();
    normalMap.needsUpdate = true;
    normalMap.repeat.set(repeatX, repeatY);
    const roughnessMap = brickMat.roughnessMap.clone();
    roughnessMap.needsUpdate = true;
    roughnessMap.repeat.set(repeatX, repeatY);
    return new THREE.MeshStandardMaterial({ map, normalMap, roughnessMap, roughness: 1 });
  }

  // Front/back walls stop at the *inner* face of the side walls instead of
  // running the full building width. They used to extend all the way to
  // the outer corner, which put their thin end-cap face exactly coplanar
  // with the side wall's own face at that same corner — two overlapping
  // brick surfaces occupying the same spot, which is a textbook z-fighting
  // setup and showed up as shimmering right where the walls met. The side
  // walls' own end-cap faces (below) already cover that sliver, so nothing
  // is left uncovered.
  const innerHalfWidth = width / 2 - wallThickness;
  const sideBrickMat = scaledBrickMat(depth, wallHeight);
  const sideEndCapMat = scaledBrickMat(wallThickness, wallHeight);

  // BoxGeometry material order: [+x, -x, +y, -y, +z, -z]
  const frontMats = [brickMat, brickMat, brickMat, brickMat, brickMat, interiorWallMat];
  const backMats = [brickMat, brickMat, brickMat, brickMat, interiorWallMat, brickMat];
  const leftMats = [
    interiorWallMat,
    sideBrickMat,
    sideEndCapMat,
    sideEndCapMat,
    sideEndCapMat,
    sideEndCapMat,
  ];
  const rightMats = [
    sideBrickMat,
    interiorWallMat,
    sideEndCapMat,
    sideEndCapMat,
    sideEndCapMat,
    sideEndCapMat,
  ];

  const frontLeft = mesh(
    new THREE.BoxGeometry(innerHalfWidth + doorway.xMin, wallHeight, wallThickness),
    frontMats
  );
  frontLeft.position.set(
    (-innerHalfWidth + doorway.xMin) / 2,
    wallHeight / 2,
    depth / 2 - wallThickness / 2
  );
  group.add(frontLeft);

  const frontRight = mesh(
    new THREE.BoxGeometry(innerHalfWidth - doorway.xMax, wallHeight, wallThickness),
    frontMats
  );
  frontRight.position.set(
    (doorway.xMax + innerHalfWidth) / 2,
    wallHeight / 2,
    depth / 2 - wallThickness / 2
  );
  group.add(frontRight);

  // The lintel is much smaller than the wall sections around it, so mapping
  // it with the same brick texture repeat (tuned for a much bigger surface)
  // would squeeze in far too many brick courses, both horizontally and
  // vertically — a distorted, dense pattern instead of matching brick.
  const lintelWidth = doorway.xMax - doorway.xMin;
  const lintelHeight = wallHeight - doorway.yMax;
  const lintelBrickMat = scaledBrickMat(lintelWidth, lintelHeight);
  const lintelMats = [
    lintelBrickMat,
    lintelBrickMat,
    lintelBrickMat,
    lintelBrickMat,
    lintelBrickMat,
    interiorWallMat,
  ];

  const lintel = mesh(
    new THREE.BoxGeometry(lintelWidth, lintelHeight, wallThickness),
    lintelMats
  );
  lintel.position.set(
    (doorway.xMin + doorway.xMax) / 2,
    doorway.yMax + (wallHeight - doorway.yMax) / 2,
    depth / 2 - wallThickness / 2
  );
  group.add(lintel);

  const backWall = mesh(
    new THREE.BoxGeometry(innerHalfWidth * 2, wallHeight, wallThickness),
    backMats
  );
  backWall.position.set(0, wallHeight / 2, -depth / 2 + wallThickness / 2);
  group.add(backWall);

  const leftWall = mesh(new THREE.BoxGeometry(wallThickness, wallHeight, depth), leftMats);
  leftWall.position.set(-width / 2 + wallThickness / 2, wallHeight / 2, 0);
  group.add(leftWall);

  const rightWall = mesh(new THREE.BoxGeometry(wallThickness, wallHeight, depth), rightMats);
  rightWall.position.set(width / 2 - wallThickness / 2, wallHeight / 2, 0);
  group.add(rightWall);

  const woodFloorTextures = loadWoodFloorTextures();
  const floorMat = new THREE.MeshStandardMaterial({
    map: woodFloorTextures.map,
    normalMap: woodFloorTextures.normalMap,
    roughnessMap: woodFloorTextures.roughnessMap,
    roughness: 1,
  });
  const interiorFloor = mesh(
    new THREE.PlaneGeometry(width - wallThickness, depth - wallThickness),
    floorMat
  );
  interiorFloor.rotation.x = -Math.PI / 2;
  interiorFloor.position.set(0, 0.02, 0);
  group.add(interiorFloor);

  const ceiling = mesh(
    new THREE.PlaneGeometry(width - wallThickness, depth - wallThickness),
    ceilingMat
  );
  ceiling.rotation.x = Math.PI / 2;
  ceiling.position.set(0, wallHeight - 0.02, 0);
  group.add(ceiling);

  // Brick fireplace with a wood mantel, against the interior-left wall
  const fireboxMat = new THREE.MeshStandardMaterial({ color: 0x141210, roughness: 0.9 });
  const hearthX = -width / 2 + wallThickness;
  const surround = mesh(new THREE.BoxGeometry(0.45, 1.5, 1.6), brickMat);
  surround.position.set(hearthX + 0.225, 0.75, 0);
  group.add(surround);

  const firebox = mesh(new THREE.BoxGeometry(0.46, 0.7, 0.9), fireboxMat);
  firebox.position.set(hearthX + 0.23, 0.45, 0);
  group.add(firebox);

  const fireplaceFlames = new THREE.Group();
  [0xff8c1a, 0xffb347, 0xffd166].forEach((color, i) => {
    const flameMat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.85,
      toneMapped: false,
    });
    const flame = new THREE.Mesh(
      new THREE.ConeGeometry(0.05 - i * 0.01, 0.16 - i * 0.03, 8),
      flameMat
    );
    flame.position.y = 0.08 + i * 0.03;
    fireplaceFlames.add(flame);
  });
  fireplaceFlames.position.set(hearthX + 0.16, 0.12, 0);
  group.add(fireplaceFlames);

  const fireplaceLight = new THREE.PointLight(0xffa64d, 0.9, 2.5, 2);
  fireplaceLight.position.set(hearthX + 0.2, 0.35, 0);
  group.add(fireplaceLight);

  const mantel = mesh(new THREE.BoxGeometry(0.55, 0.08, 1.8), woodMat);
  mantel.position.set(hearthX + 0.275, 1.52, 0);
  group.add(mantel);

  // Ceiling fan, hanging center-room, blades exposed for slow rotation
  const fanGroup = new THREE.Group();
  fanGroup.position.set(0, wallHeight - 0.03, 0);

  const fanMountMat = new THREE.MeshStandardMaterial({ color: 0x3a3a3a, roughness: 0.5 });
  const fanRod = mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.18, 6), fanMountMat);
  fanRod.position.y = -0.09;
  fanGroup.add(fanRod);

  const fanBlades = new THREE.Group();
  fanBlades.position.y = -0.19;
  const bladeMat = new THREE.MeshStandardMaterial({ color: 0x4a3524, roughness: 0.6 });
  const hub = mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.05, 10), fanMountMat);
  fanBlades.add(hub);
  for (let i = 0; i < 4; i++) {
    const blade = mesh(new THREE.BoxGeometry(0.5, 0.015, 0.11), bladeMat);
    blade.position.set(0.28, 0, 0);
    const pivot = new THREE.Group();
    pivot.rotation.y = (i / 4) * Math.PI * 2;
    pivot.add(blade);
    fanBlades.add(pivot);
  }
  fanGroup.add(fanBlades);
  group.add(fanGroup);
  group.userData.fanBlades = fanBlades;
  group.userData.fireplaceFlames = fireplaceFlames;
  group.userData.fireplaceLight = fireplaceLight;

  const roof = buildHipRoof(width * 1.12, depth * 1.12, roofHeight, roofMat);
  roof.position.y = wallHeight + roofHeight / 2;
  group.add(roof);

  // Covered patio, matching the reference photos
  const patioWidth = width * 0.72;
  const patioDepth = 2.6;
  const patioFloor = mesh(
    new THREE.BoxGeometry(patioWidth, 0.1, patioDepth),
    concreteMat
  );
  patioFloor.position.set(0, 0.05, depth / 2 + patioDepth / 2);
  group.add(patioFloor);

  // Column height is set to reach exactly the underside of the patio roof
  // panel below (wallHeight + 0.02, thickness 0.14), not past it.
  const columnHeight = wallHeight - 0.05;
  const columnSize = 0.35;

  // Columns are far thinner than the walls, so — same issue as the lintel —
  // the wall-sized brick repeat would squeeze in way too many courses.
  const columnBrickMat = scaledBrickMat(columnSize, columnHeight);

  [-patioWidth / 2 + 0.2, 0.3, patioWidth / 2 - 0.2].forEach((x) => {
    const col = mesh(
      new THREE.BoxGeometry(columnSize, columnHeight, columnSize),
      columnBrickMat
    );
    col.position.set(x, columnHeight / 2, depth / 2 + patioDepth - 0.2);
    group.add(col);
  });

  // Patio roof, extending from the wall out past the columns so they
  // actually hold something up. Uses the same gray roof material (not the
  // white trim) so it reads as a roofline extension, not a floating shelf.
  const patioRoofPanel = mesh(
    new THREE.BoxGeometry(patioWidth + 0.4, 0.14, patioDepth + 0.5),
    roofMat
  );
  patioRoofPanel.position.set(0, wallHeight + 0.02, depth / 2 + patioDepth / 2);
  group.add(patioRoofPanel);

  const winL = buildWindow(1.3, 1.5, trimMat, glassMat);
  winL.position.set(-width * 0.3, wallHeight * 0.6, depth / 2 + 0.01);
  group.add(winL);

  const winR = buildWindow(1.3, 1.5, trimMat, glassMat);
  winR.position.set(width * 0.3, wallHeight * 0.6, depth / 2 + 0.01);
  group.add(winR);

  const doors = buildFrenchDoors(2.2, 2.0, trimMat, glassMat, true);
  doors.position.set(0, wallHeight * 0.42, depth / 2 + 0.01);
  group.add(doors);

  // "FORT DARLA" sign on the back wall, facing the doorway so it's the
  // first thing you see walking in
  const signMat = new THREE.MeshBasicMaterial({
    map: makeSignTexture('FORT DARLA'),
    toneMapped: false,
  });
  const sign = mesh(new THREE.PlaneGeometry(2.4, 0.66), signMat);
  sign.position.set(0, wallHeight * 0.55, -depth / 2 + wallThickness + 0.02);
  group.add(sign);

  return group;
}

const foliageTexture = makeFoliageTexture();
const PINE_MATS = [0x2f5233, 0x386040, 0x264a2c].map(
  (color) => new THREE.MeshStandardMaterial({ color, map: foliageTexture, roughness: 0.88 })
);
const LEAF_MATS = [0x4a7c3f, 0x567f3f, 0x3f6b38, 0x6b8f42].map(
  (color) => new THREE.MeshStandardMaterial({ color, map: foliageTexture, roughness: 0.85 })
);
const barkTextures = loadBarkTextures();
const TRUNK_MAT = new THREE.MeshStandardMaterial({
  map: barkTextures.map,
  normalMap: barkTextures.normalMap,
  roughnessMap: barkTextures.roughnessMap,
  roughness: 1,
});

function createTree(kind, rand = Math.random) {
  const group = new THREE.Group();
  const trunkH = kind === 'pine' ? 1.2 + rand() * 0.6 : 0.9 + rand() * 0.4;
  const trunk = mesh(new THREE.CylinderGeometry(0.08, 0.11, trunkH, 9), TRUNK_MAT);
  trunk.position.y = trunkH / 2;
  group.add(trunk);

  if (kind === 'pine') {
    // Each tier gets its own slight color pick and a small horizontal
    // jitter/rotation so the stack reads as a slightly shaggy conifer
    // instead of three perfectly concentric cones.
    for (let i = 0; i < 4; i++) {
      const r = 0.85 - i * 0.17;
      const h = 0.95 - i * 0.08;
      const cone = mesh(
        new THREE.ConeGeometry(r, h, 10, 1, false),
        PINE_MATS[Math.floor(rand() * PINE_MATS.length)]
      );
      cone.position.set(
        (rand() - 0.5) * 0.08,
        trunkH + i * 0.55 + h * 0.4,
        (rand() - 0.5) * 0.08
      );
      cone.rotation.y = rand() * Math.PI * 2;
      group.add(cone);
    }
  } else {
    // A fuller, more varied canopy: more blobs than before, each with its
    // own material pick and a slight squash so they read as leaf clumps
    // rather than perfect spheres.
    const blobCount = 4 + Math.floor(rand() * 2);
    for (let i = 0; i < blobCount; i++) {
      const r = 0.5 + rand() * 0.38;
      const foliageMat = LEAF_MATS[Math.floor(rand() * LEAF_MATS.length)];
      const blob = mesh(new THREE.SphereGeometry(r, 10, 8), foliageMat);
      const scaleY = 0.82 + rand() * 0.25;
      blob.scale.set(1, scaleY, 1);
      // The vertical offset is derived from this blob's own (already
      // rolled) half-height rather than picked independently — otherwise
      // an unlucky combination (high offset, small/squashed blob) leaves a
      // gap above the trunk instead of overlapping it.
      const halfExtent = r * scaleY;
      const dip = halfExtent * (0.2 + rand() * 0.5);
      blob.position.set(
        (rand() - 0.5) * 0.7,
        trunkH + halfExtent - dip,
        (rand() - 0.5) * 0.7
      );
      group.add(blob);
    }
  }

  group.rotation.y = rand() * Math.PI * 2;
  group.scale.setScalar(0.8 + rand() * 0.6);
  return group;
}

// A small seeded PRNG (mulberry32) so a given chunk always generates the
// exact same trees no matter how many times it's loaded/unloaded as Darla
// wanders in and out of range — using Math.random() per chunk would make
// the forest reshuffle every time you walked back into an old area.
function mulberry32(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const CHUNK_SIZE = 18;
const TREE_SPACING = 3.6;

// Trees fill a regular grid (with jitter, so it doesn't look mechanical)
// everywhere outside the walkable lawn and the house footprint — the
// backyard's own clearing, reused unchanged for every chunk since these
// exclusion checks trivially fail (no effect) far from the origin anyway.
// A grid also can't leave a directional gap the way random angular sampling
// can — every slot outside the safe zone gets a tree, full stop.
// The backyard clearing (open lawn, no trees) and the house's own
// footprint — shared between the tree chunks (which exclude both) and the
// grass field (which only grows in the clearing, minus the house).
const inOpenArea = (x, z) => x > -9.5 && x < 9.5 && z > -4.5 && z < 14.5;
const inHouse = (x, z) => x > -8.7 && x < 8.7 && z > -17.3 && z < -3.8;

// Matches firePit's own placement in createYard() below — kept separate so
// grass tufts (createGrassField) can skip it without needing the actual
// fire pit object to exist yet.
export const FIRE_PIT = { x: -1, z: 5, radius: 0.7 };
const inFirePit = (x, z) => Math.hypot(x - FIRE_PIT.x, z - FIRE_PIT.z) < FIRE_PIT.radius;

export function createTreeChunk(cx, cz) {
  const group = new THREE.Group();
  const seed = (cx * 374761393 + cz * 668265263) ^ 0x9e3779b9;
  const rand = mulberry32(seed);
  const originX = cx * CHUNK_SIZE;
  const originZ = cz * CHUNK_SIZE;

  for (let lx = 0; lx < CHUNK_SIZE; lx += TREE_SPACING) {
    for (let lz = 0; lz < CHUNK_SIZE; lz += TREE_SPACING) {
      const x = originX + lx + (rand() - 0.5) * TREE_SPACING * 0.8;
      const z = originZ + lz + (rand() - 0.5) * TREE_SPACING * 0.8;
      if (inOpenArea(x, z) || inHouse(x, z)) continue;
      if (rand() < 0.15) continue; // thin out a bit so it reads as a forest, not a wall

      const kind = rand() < 0.3 ? 'pine' : 'round';
      const tree = createTree(kind, rand);
      tree.position.set(x, 0, z);
      group.add(tree);
    }
  }

  const grass = createChunkGrass(cx, cz, rand);
  if (grass) group.add(grass);

  return group;
}

function createFirePit() {
  const group = new THREE.Group();

  const stoneMat = new THREE.MeshStandardMaterial({ color: 0x8a8378, roughness: 0.9 });
  const ringRadius = 0.45;
  const stoneCount = 10;
  for (let i = 0; i < stoneCount; i++) {
    const angle = (i / stoneCount) * Math.PI * 2;
    const stone = mesh(
      new THREE.SphereGeometry(0.07 + Math.random() * 0.02, 8, 6),
      stoneMat
    );
    stone.position.set(Math.cos(angle) * ringRadius, 0.05, Math.sin(angle) * ringRadius);
    stone.scale.set(1, 0.7, 1);
    stone.rotation.y = Math.random() * Math.PI;
    group.add(stone);
  }

  const ashMat = new THREE.MeshStandardMaterial({ color: 0x3a3530, roughness: 1 });
  const ash = mesh(new THREE.CircleGeometry(0.38, 20), ashMat);
  ash.rotation.x = -Math.PI / 2;
  ash.position.y = 0.01;
  group.add(ash);

  const logMat = new THREE.MeshStandardMaterial({ color: 0x5b4330, roughness: 0.9 });
  const logGeo = new THREE.CylinderGeometry(0.045, 0.05, 0.5, 8);
  [0, 1, 2].forEach((i) => {
    const log = mesh(logGeo, logMat);
    log.rotation.z = Math.PI / 2.6;
    log.rotation.y = (i / 3) * Math.PI * 2 + 0.3;
    log.position.set(0, 0.1, 0);
    group.add(log);
  });

  const flames = new THREE.Group();
  [0xff8c1a, 0xffb347, 0xffd166].forEach((color, i) => {
    const flameMat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.85,
      toneMapped: false,
    });
    const flame = new THREE.Mesh(
      new THREE.ConeGeometry(0.09 - i * 0.02, 0.28 - i * 0.06, 8),
      flameMat
    );
    flame.position.y = 0.15 + i * 0.05;
    flames.add(flame);
  });
  flames.position.y = 0.1;
  group.add(flames);

  const fireLight = new THREE.PointLight(0xffa64d, 1.2, 3, 2);
  fireLight.position.set(0, 0.3, 0);
  group.add(fireLight);

  group.userData.flames = flames;
  group.userData.light = fireLight;

  return group;
}

function makeStripeTexture(colorA, colorB) {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const stripeCount = 6;
  const stripeWidth = size / stripeCount;
  for (let i = 0; i < stripeCount; i++) {
    ctx.fillStyle = i % 2 === 0 ? colorA : colorB;
    ctx.fillRect(i * stripeWidth, 0, stripeWidth, size);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(4, 1);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

// A round tree with a fixed (not randomized) trunk height, so the hammock
// fabric can be attached at a reliably known point.
function createHammockTree() {
  const group = new THREE.Group();
  const trunkH = 1.1;
  const trunk = mesh(new THREE.CylinderGeometry(0.09, 0.12, trunkH, 9), TRUNK_MAT);
  trunk.position.y = trunkH / 2;
  group.add(trunk);

  const blobCount = 5;
  for (let i = 0; i < blobCount; i++) {
    const r = 0.5 + Math.random() * 0.38;
    const foliageMat = LEAF_MATS[Math.floor(Math.random() * LEAF_MATS.length)];
    const blob = mesh(new THREE.SphereGeometry(r, 10, 8), foliageMat);
    const scaleY = 0.82 + Math.random() * 0.25;
    blob.scale.set(1, scaleY, 1);
    const halfExtent = r * scaleY;
    const dip = halfExtent * (0.2 + Math.random() * 0.5);
    blob.position.set(
      (Math.random() - 0.5) * 0.7,
      trunkH + halfExtent - dip,
      (Math.random() - 0.5) * 0.7
    );
    group.add(blob);
  }

  group.userData.trunkHeight = trunkH;
  return group;
}

function createHammock() {
  const group = new THREE.Group();
  const spacing = 3.4;
  const attachHeight = 0.85;
  const maxSag = 0.32;

  [-1, 1].forEach((side) => {
    const tree = createHammockTree();
    tree.position.set((side * spacing) / 2, 0, 0);
    tree.rotation.y = Math.random() * Math.PI * 2;
    group.add(tree);
  });

  // Fabric sags in a parabola along its length (local X), which after the
  // plane is laid flat becomes a droop in world Y — computed before rotation
  // so the math stays simple (flat 2D droop, not a 3D rotation problem).
  const fabricWidth = spacing - 0.5;
  const fabricGeo = new THREE.PlaneGeometry(fabricWidth, 0.75, 12, 6);
  const posAttr = fabricGeo.attributes.position;
  for (let i = 0; i < posAttr.count; i++) {
    const x = posAttr.getX(i);
    const sag = (1 - (x / (fabricWidth / 2)) ** 2) * maxSag;
    posAttr.setZ(i, posAttr.getZ(i) - sag);
  }
  fabricGeo.computeVertexNormals();

  const fabricMat = new THREE.MeshStandardMaterial({
    map: makeStripeTexture('#4a90d9', '#f0ece0'),
    roughness: 0.8,
    side: THREE.DoubleSide,
  });
  const fabric = mesh(fabricGeo, fabricMat);
  fabric.rotation.x = -Math.PI / 2;
  fabric.position.y = attachHeight;
  group.add(fabric);

  // Exposed so main.js can raycast for click-to-lie-down and know exactly
  // where the fabric's deepest point sits (its resting height at the point
  // of max sag, right at the center where someone would actually lie).
  group.userData.lieHeight = attachHeight - maxSag;
  // Exposed alongside lieHeight so main.js can position a hover-highlight
  // glow at the fabric's actual mounting height without duplicating the
  // constant.
  group.userData.attachHeight = attachHeight;

  return group;
}

// World units covered by one texture tile (plane size / repeat count) —
// used by updateLawnTexture below to keep the pattern anchored to world
// space instead of gluing itself to whoever's standing on it.
const LAWN_TILE_WORLD_SIZE = 100 / 25;

function createLawn() {
  const lawnTextures = loadLawnTextures();
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(100, 100),
    new THREE.MeshStandardMaterial({
      map: lawnTextures.map,
      normalMap: lawnTextures.normalMap,
      roughnessMap: lawnTextures.roughnessMap,
      // The raw photo reads a bit dry/brown for a cartoon backyard lawn —
      // a green tint (multiplied against the map) pushes it back toward
      // the same lush green as the grass-blade tufts planted on top of it.
      color: 0x8fcf72,
      roughness: 1,
    })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  ground.userData.textures = [lawnTextures.map, lawnTextures.normalMap, lawnTextures.roughnessMap];
  return ground;
}

// The lawn plane itself is finite and gets recentered on whoever's playing
// every frame (see main.js) so they never walk off its edge — but with a
// real photo texture (unlike the old positionally-invariant noise), simply
// recentering the mesh without also shifting its texture offset makes the
// pattern look glued in place under the player instead of scrolling by
// like actual ground would as they walk. This keeps the sampled texture
// anchored to world coordinates regardless of where the finite plane
// currently sits.
export function updateLawnTexture(lawn, worldX, worldZ) {
  const offsetX = worldX / LAWN_TILE_WORLD_SIZE;
  const offsetZ = worldZ / LAWN_TILE_WORLD_SIZE;
  lawn.userData.textures.forEach((texture) => {
    texture.offset.set(offsetX, offsetZ);
  });
}

const GRASS_BLADE_HEIGHT = 0.35;

// A single tapered blade (base pinned at y=0, tip at y=BLADE_HEIGHT) with
// several height segments so the wind shader below can bend it smoothly
// like it's actually rooted in the ground, instead of hinging at one point.
function createGrassBladeGeometry() {
  const bladeWidth = 0.05;
  const geo = new THREE.PlaneGeometry(bladeWidth, GRASS_BLADE_HEIGHT, 1, 4);
  geo.translate(0, GRASS_BLADE_HEIGHT / 2, 0);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const t = pos.getY(i) / GRASS_BLADE_HEIGHT;
    pos.setX(i, pos.getX(i) * (1 - t * 0.7));
  }
  geo.computeVertexNormals();
  return geo;
}

// Cheap per-blade shading: a fixed vertical color gradient (dark at the
// root, bright toward the tip) plus per-instance tint variation, rather
// than a real lit response — the sun never moves in this scene, so a real
// lighting calculation here would just reproduce the same gradient anyway.
// The wind itself is a sine wave offset by world position (so it ripples
// across the field instead of every blade moving in lockstep) and by a
// per-instance random phase (so they don't all ripple in perfect unison),
// applied more strongly toward the tip so the blade bends like it's rooted.
function createGrassMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      fogColor: { value: new THREE.Color(0x87ceeb) },
      fogNear: { value: 18 },
      fogFar: { value: 55 },
    },
    vertexShader: `
      attribute float instanceRandom;
      uniform float uTime;
      varying float vHeightT;
      varying float vRandom;
      varying float vFogDepth;

      void main() {
        vHeightT = position.y / ${GRASS_BLADE_HEIGHT.toFixed(3)};
        vRandom = instanceRandom;

        // Each blade's own random per-instance rotation (baked into
        // instanceMatrix) is for visual variety of its resting shape only.
        // The wind bend below is added AFTER that transform, as a fixed
        // world-space direction shared by every blade — bending in local
        // space first (before the per-instance rotation) made each blade
        // sway off in its own random direction, which read as worms
        // wriggling rather than a field leaning together in the wind.
        vec4 restPos = instanceMatrix * vec4(position, 1.0);

        vec2 windDir = normalize(vec2(1.0, 0.35));
        float wave = sin(uTime * 1.6 + restPos.x * 0.3 + restPos.z * 0.3 + instanceRandom * 6.2831);
        float bendAmount = wave * 0.16 * pow(vHeightT, 1.6);
        restPos.x += windDir.x * bendAmount;
        restPos.z += windDir.y * bendAmount;

        vec4 mvPosition = modelViewMatrix * restPos;
        vFogDepth = -mvPosition.z;
        gl_Position = projectionMatrix * mvPosition;
      }
    `,
    fragmentShader: `
      precision mediump float;
      varying float vHeightT;
      varying float vRandom;
      varying float vFogDepth;
      uniform vec3 fogColor;
      uniform float fogNear;
      uniform float fogFar;

      void main() {
        vec3 baseColor = vec3(0.08, 0.28, 0.09);
        vec3 tipColor = vec3(0.24, 0.62, 0.2);
        vec3 color = mix(baseColor, tipColor, vHeightT);
        color *= 0.8 + vRandom * 0.35;

        float fogFactor = smoothstep(fogNear, fogFar, vFogDepth);
        color = mix(color, fogColor, fogFactor);

        gl_FragColor = vec4(color, 1.0);
      }
    `,
    side: THREE.DoubleSide,
  });
}

// One shared shader program for every grass field — the yard clearing's
// and every wooded chunk's — so there's only ever one shader compile and
// one place (main.js) needs to update the wind's time uniform. Geometry is
// NOT shared: each field gets its own copy (see buildGrassMesh) so a
// chunk's grass can be safely disposed when it unloads without taking
// down every other field that happens to reuse the same blade shape.
export const grassMaterial = createGrassMaterial();

// Scatters blades in sparse, dense tufts rather than blanketing an area
// evenly — most of the ground stays plain, and every so often there's a
// cute little clump. `exclude(x, z)` skips spots that shouldn't get grass
// (the house footprint, or — for wooded chunks — the open clearing, which
// already gets its own denser tufts from createGrassField). Linear radius
// sampling naturally packs more blades near a tuft's center than its edge.
function scatterTuftPositions(tuftCenters, tuftRadius, bladesPerTuft, rand, exclude) {
  const positions = [];
  tuftCenters.forEach(({ cx, cz }) => {
    for (let i = 0; i < bladesPerTuft; i++) {
      const angle = rand() * Math.PI * 2;
      const r = rand() * tuftRadius;
      const x = cx + Math.cos(angle) * r;
      const z = cz + Math.sin(angle) * r;
      if (exclude(x, z)) continue;
      positions.push([x, z]);
    }
  });
  return positions;
}

function buildGrassMesh(positions, rand) {
  const geometry = createGrassBladeGeometry();
  const field = new THREE.InstancedMesh(geometry, grassMaterial, positions.length);
  const instanceRandom = new Float32Array(positions.length);
  const dummy = new THREE.Object3D();
  positions.forEach(([x, z], i) => {
    dummy.position.set(x, 0, z);
    dummy.rotation.y = rand() * Math.PI * 2;
    const scale = 0.8 + rand() * 0.5;
    dummy.scale.set(scale, scale, scale);
    dummy.updateMatrix();
    field.setMatrixAt(i, dummy.matrix);
    instanceRandom[i] = rand();
  });
  geometry.setAttribute('instanceRandom', new THREE.InstancedBufferAttribute(instanceRandom, 1));
  field.instanceMatrix.needsUpdate = true;
  return field;
}

function createGrassField() {
  const tuftCount = 24;
  const bladesPerTuft = 80;
  const tuftRadius = 0.8;
  const exclude = (x, z) => inHouse(x, z) || inFirePit(x, z);

  const tufts = [];
  let attempts = 0;
  while (tufts.length < tuftCount && attempts < tuftCount * 20) {
    attempts++;
    const cx = -9.5 + Math.random() * 19;
    const cz = -4.5 + Math.random() * 19;
    if (exclude(cx, cz)) continue;
    tufts.push({ cx, cz });
  }

  const positions = scatterTuftPositions(tufts, tuftRadius, bladesPerTuft, Math.random, exclude);
  return buildGrassMesh(positions, Math.random);
}

// Sparser forest-floor tufts for a wooded chunk — deep shade under a
// canopy has a different, patchier character than the open lawn. Seeded
// from the same per-chunk RNG as the trees so a chunk always looks the
// same on every visit, and skips both the house and the open clearing
// (which already has its own denser grass) in case a chunk happens to
// straddle either.
function createChunkGrass(cx, cz, rand) {
  const originX = cx * CHUNK_SIZE;
  const originZ = cz * CHUNK_SIZE;
  const tuftCount = 8;
  const bladesPerTuft = 60;
  const tuftRadius = 0.7;
  const exclude = (x, z) => inOpenArea(x, z) || inHouse(x, z);

  const tufts = [];
  for (let i = 0; i < tuftCount; i++) {
    const tx = originX + rand() * CHUNK_SIZE;
    const tz = originZ + rand() * CHUNK_SIZE;
    if (exclude(tx, tz)) continue;
    tufts.push({ cx: tx, cz: tz });
  }

  const positions = scatterTuftPositions(tufts, tuftRadius, bladesPerTuft, rand, exclude);
  if (positions.length === 0) return null;
  return buildGrassMesh(positions, rand);
}

export function createYard() {
  const group = new THREE.Group();
  const lawn = createLawn();
  group.add(lawn);
  group.userData.lawn = lawn;

  const grassField = createGrassField();
  group.add(grassField);

  const house = createHouse();
  house.position.set(0, 0, -11);
  group.add(house);
  group.userData.fanBlades = house.userData.fanBlades;
  group.userData.fireplaceFlames = house.userData.fireplaceFlames;
  group.userData.fireplaceLight = house.userData.fireplaceLight;

  // Trees are streamed in as chunks (see createTreeChunk / CHUNK_SIZE),
  // managed from main.js based on Darla's position, not added here.

  const firePit = createFirePit();
  firePit.position.set(-1, 0, 5);
  group.add(firePit);
  group.userData.firePit = firePit;

  const hammock = createHammock();
  hammock.position.set(6, 0, 9);
  hammock.rotation.y = 0.4;
  group.add(hammock);
  group.userData.hammock = hammock;

  return group;
}
