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

// A painted-grass texture instead of a photo — thousands of short, thinly
// stroked "blades" baked directly into the map, standing in for real
// geometry everywhere the real instanced blades (see createChunkGrass)
// have thinned out with distance or already shrunk below a pixel at
// range. Real geometry still does the up-close work (it casts shadows,
// bends in the wind, and reads as individual blades close to the camera);
// this is what keeps the ground from ever looking bare in between and at
// range, without paying more per-instance GPU cost to get there — the
// same "fake it as a texture, not more geometry" idea the reference image
// (Twitter, Claude Opus 5's Ghibli demo) is actually built on, just via a
// baked canvas here instead of a live shader.
function createPaintedGrassTexture() {
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#4c8a3a';
  ctx.fillRect(0, 0, size, size);

  // NO large soft blotches here, deliberately. This texture tiles roughly
  // every 4.8 world units across the lawn, and low-frequency features are
  // exactly what makes tiling visible — a big blotch repeating on a 4.8
  // unit pitch reads as a grid of light and dark patches stamped across
  // the ground, which is precisely what it did. Fine high-frequency detail
  // (the strokes below) tiles invisibly at this scale, so all the
  // large-scale variation is left to the blades' own dry-patch term, which
  // is keyed off world position and therefore never repeats.

  // Thousands of short, thin, randomly angled strokes — this is the part
  // that actually reads as "grass" rather than a flat tinted color, at any
  // distance, since it's resolution baked into the texture rather than
  // real geometry that can shrink below a pixel and disappear.
  const strokeCount = 9000;
  ctx.lineWidth = 1;
  for (let i = 0; i < strokeCount; i++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const len = 3 + Math.random() * 6;
    const angle = Math.random() * Math.PI * 2;
    const lightness = 0.55 + Math.random() * 0.55;
    const r = Math.floor(40 * lightness);
    const g = Math.floor(115 * lightness);
    const b = Math.floor(30 * lightness);
    ctx.strokeStyle = `rgba(${r},${g},${b},0.55)`;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.cos(angle) * len, y - Math.sin(angle) * len);
    ctx.stroke();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  // Negative Y repeat compensates for how the lawn plane gets rotated flat
  // (rotation.x = -PI/2) — without it, the offset compensation in
  // updateLawnTexture below would scroll the texture backwards on the Z
  // axis relative to how it scrolls correctly on X. Same repeat count the
  // old photo texture used, so the existing tiling/scroll math in
  // the lawn mesh's own UVs still line up unchanged.
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(25, -25);
  texture.anisotropy = 16;
  return texture;
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
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  // Shrinks to fit rather than a fixed size, so a longer sign (e.g. "Under
  // Construction") doesn't just run off the edges of the board the way a
  // fixed 64px would for anything much longer than "FORT DARLA".
  let fontSize = 64;
  const maxWidth = w - 40;
  ctx.font = `bold ${fontSize}px Georgia, serif`;
  while (ctx.measureText(text).width > maxWidth && fontSize > 20) {
    fontSize -= 2;
    ctx.font = `bold ${fontSize}px Georgia, serif`;
  }
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

// A flat triangular slab (base at y=0, apex at (0, peakHeight), thin along
// Z) — the brick gable-end pediment above the garage and front entry,
// matching the reference house's front-facing gables.
function buildGableEnd(width, peakHeight, thickness, material) {
  const shape = new THREE.Shape();
  shape.moveTo(-width / 2, 0);
  shape.lineTo(width / 2, 0);
  shape.lineTo(0, peakHeight);
  shape.lineTo(-width / 2, 0);
  const geo = new THREE.ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: false });
  geo.translate(0, 0, -thickness / 2);
  return mesh(geo, material);
}

// Two tilted slabs meeting at a ridge running the full `runDepth` (plus
// overhang) — a simple gable roof cap sized to sit over a `width`-wide
// gable end below. Unlike buildHipRoof's single cone, this needs an actual
// ridge *line* rather than a point, hence two flat rectangular slabs
// instead of one radially-symmetric shape.
function buildGableRoof(width, runDepth, peakHeight, thickness, overhangSide, overhangEnd, material) {
  const group = new THREE.Group();
  const halfSpan = width / 2 + overhangSide;
  const angle = Math.atan2(peakHeight, halfSpan);
  const slopeLength = Math.hypot(halfSpan, peakHeight);
  [-1, 1].forEach((side) => {
    const slab = mesh(
      new THREE.BoxGeometry(slopeLength, thickness, runDepth + overhangEnd * 2),
      material
    );
    slab.rotation.z = -side * angle;
    slab.position.set((side * halfSpan) / 2, peakHeight / 2, 0);
    group.add(slab);
  });
  return group;
}

// A flat semicircular cap sized to sit on top of a `width`-wide buildWindow
// — a stylized approximation of the reference house's arched front windows
// (a true curved arch doesn't read as anything different from a faceted
// one at this camera distance, so this keeps the same flat-panel
// construction style as the rest of the house).
function buildArchCap(width, thickness, material) {
  const radius = width / 2;
  const segments = 12;
  const shape = new THREE.Shape();
  shape.moveTo(-radius, 0);
  for (let i = 0; i <= segments; i++) {
    const a = Math.PI - (Math.PI * i) / segments;
    shape.lineTo(Math.cos(a) * radius, Math.sin(a) * radius);
  }
  shape.lineTo(-radius, 0);
  const geo = new THREE.ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: false });
  geo.translate(0, 0, -thickness / 2);
  return mesh(geo, material);
}

function buildArchedWindow(w, h, trimMat, glassMat) {
  const group = new THREE.Group();
  group.add(buildWindow(w, h, trimMat, glassMat));
  const cap = buildArchCap(w, 0.06, trimMat);
  cap.position.y = h / 2;
  group.add(cap);
  return group;
}

// Ground-to-cap brick chimney, standing proud of whatever wall it's placed
// against.
function buildChimney(width, depth, height, capMat, brickMat) {
  const group = new THREE.Group();
  const shaft = mesh(new THREE.BoxGeometry(width, height, depth), brickMat);
  shaft.position.y = height / 2;
  group.add(shaft);
  const cap = mesh(new THREE.BoxGeometry(width + 0.08, 0.08, depth + 0.08), capMat);
  cap.position.y = height + 0.04;
  group.add(cap);
  const flue = mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.18, 8), capMat);
  flue.position.y = height + 0.17;
  group.add(flue);
  return group;
}

// A tilted yard sign on a stake, planted in the lawn near the front walk —
// a livelier home for "FORT DARLA" than a wall plaque, closer to a kid's
// clubhouse sign than a house number.
function buildYardSign(text) {
  const group = new THREE.Group();
  const postMat = new THREE.MeshStandardMaterial({ color: 0x6b4a2f, roughness: 0.85 });
  const post = mesh(new THREE.CylinderGeometry(0.035, 0.045, 1.1, 8), postMat);
  post.position.y = 0.55;
  group.add(post);
  const signMat = new THREE.MeshBasicMaterial({
    map: makeSignTexture(text),
    toneMapped: false,
    side: THREE.DoubleSide,
  });
  const board = mesh(new THREE.PlaneGeometry(1.5, 0.42), signMat);
  board.position.set(0, 0.95, 0.02);
  board.rotation.y = 0.2;
  group.add(board);
  group.rotation.z = -0.04;
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
  // Every exterior wall is brick, including this "front" one under the
  // covered patio. It was sided here, read from the Zillow shots — but the
  // owner's own photos of the back of the house show brick running right
  // across under the patio roof, with white only on the trim, soffit and
  // door surrounds. White walls with brick columns had it backwards.
  const patioWallBrickMat = scaledBrickMat(width, wallHeight);
  const frontMats = [
    patioWallBrickMat,
    patioWallBrickMat,
    patioWallBrickMat,
    patioWallBrickMat,
    patioWallBrickMat,
    interiorWallMat,
  ];
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

  const lintelWidth = doorway.xMax - doorway.xMin;
  const lintelHeight = wallHeight - doorway.yMax;
  // Brick too — it's the strip of the same patio wall above the doorway.
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

  // Doorway infill: the back door is closed now (see `doors` below, no
  // longer built with an open right leaf) and there's no interior behind
  // it to walk into, so the actual gap in the wall — frontLeft/frontRight
  // above only build up to doorway.xMin/xMax — needs to be filled in
  // rather than just covered by a door panel that doesn't quite match its
  // edges. Same brick as the rest of this wall, scaled to its own size so
  // the tiling still reads as continuous brick, not a patched-in seam.
  const doorwayInfillMat = scaledBrickMat(lintelWidth, doorway.yMax);
  const doorwayInfillMats = [
    doorwayInfillMat,
    doorwayInfillMat,
    doorwayInfillMat,
    doorwayInfillMat,
    doorwayInfillMat,
    interiorWallMat,
  ];
  const doorwayInfill = mesh(
    new THREE.BoxGeometry(lintelWidth, doorway.yMax, wallThickness),
    doorwayInfillMats
  );
  doorwayInfill.position.set(
    (doorway.xMin + doorway.xMax) / 2,
    doorway.yMax / 2,
    depth / 2 - wallThickness / 2
  );
  group.add(doorwayInfill);

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

  // Festoon lights swagged along the outer edge of the patio roof — strung
  // across the front of the porch in the owner's photos, and the one bit of
  // the house that reads as lived-in rather than architectural.
  //
  // Bulbs are emissive rather than actual lights: forty point lights would
  // be absurd, and the bloom pass (threshold 0.82) picks emissive geometry
  // up on its own, so they glow at night without costing anything.
  const bulbMat = new THREE.MeshStandardMaterial({
    color: 0xfff2cf,
    emissive: 0xffe6a8,
    emissiveIntensity: 1.6,
    roughness: 0.4,
  });
  const cordMat = new THREE.MeshStandardMaterial({ color: 0x2a2622, roughness: 0.9 });
  const bulbGeo = new THREE.SphereGeometry(0.045, 8, 6);

  const strandZ = depth / 2 + patioDepth - 0.18;
  const strandTop = wallHeight - 0.06;
  const strandHalf = patioWidth / 2 - 0.25;
  const strandSag = 0.28;
  const bulbCount = 15;

  // Parabolic swag rather than a straight run — close enough to a catenary
  // at this span, and a dead-level string reads as a pipe.
  const strandY = (u) => strandTop - strandSag * (1 - u * u);

  let prev = null;
  for (let i = 0; i < bulbCount; i++) {
    // u runs -1..1 across the span, so u*u gives zero sag at the ends and
    // maximum in the middle.
    const u = (i / (bulbCount - 1)) * 2 - 1;
    const x = u * strandHalf;
    const y = strandY(u);
    const bulb = mesh(bulbGeo, bulbMat);
    bulb.position.set(x, y, strandZ);
    group.add(bulb);

    if (prev) {
      // One short cord segment bridging each neighbouring pair, rotated to
      // lie along the gap — a cheap way to draw a curve out of straight
      // pieces without building a tube geometry.
      const dx = x - prev.x;
      const dy = y - prev.y;
      const len = Math.hypot(dx, dy);
      const cord = mesh(new THREE.CylinderGeometry(0.008, 0.008, len, 5), cordMat);
      cord.position.set((x + prev.x) / 2, (y + prev.y) / 2, strandZ);
      cord.rotation.z = Math.atan2(dx, -dy) + Math.PI;
      group.add(cord);
    }
    prev = { x, y };
  }

  // Two sets of French doors along the patio wall, matching the reference
  // photos' composition — both purely decorative now that the doorway
  // behind them is filled in (see doorwayInfill above) and there's no
  // interior to walk into.
  const doors = buildFrenchDoors(2.2, 2.0, trimMat, glassMat, false);
  doors.position.set(0, wallHeight * 0.42, depth / 2 + 0.01);
  group.add(doors);

  const doorsSecondary = buildFrenchDoors(2.0, 2.0, trimMat, glassMat, false);
  doorsSecondary.position.set(-2.6, wallHeight * 0.42, depth / 2 + 0.01);
  group.add(doorsSecondary);

  const patioWin = buildWindow(1.1, 1.3, trimMat, glassMat);
  patioWin.position.set(2.7, wallHeight * 0.55, depth / 2 + 0.01);
  group.add(patioWin);

  // AC condenser unit, tucked against the wall just outside the patio.
  const acMat = new THREE.MeshStandardMaterial({ color: 0xd6d6d2, roughness: 0.6 });
  const acUnit = mesh(new THREE.BoxGeometry(0.5, 0.45, 0.5), acMat);
  acUnit.position.set(patioWidth / 2 + 0.5, 0.225, depth / 2 + 0.3);
  group.add(acUnit);

  // --- Front of the house (the solid "back" wall above, -z) -------------
  // Garage, gabled entry, arched windows, and chimney, matching the
  // reference photos' street-facing side. Everything below attaches to the
  // outward face of `backWall`, at local z = -depth / 2.

  const garageWidth = 4.4;
  const garageDepth = 3.0;
  const garageCenterX = 2.6;
  const garageFrontZ = -depth / 2 - garageDepth;
  const garageBrickMat = scaledBrickMat(garageWidth, wallHeight);
  const garageSideBrickMat = scaledBrickMat(garageDepth, wallHeight);

  const garageBox = mesh(new THREE.BoxGeometry(garageWidth, wallHeight, garageDepth), [
    garageSideBrickMat,
    garageSideBrickMat,
    garageBrickMat,
    garageBrickMat,
    garageBrickMat,
    garageBrickMat,
  ]);
  garageBox.position.set(garageCenterX, wallHeight / 2, -depth / 2 - garageDepth / 2);
  group.add(garageBox);

  const garageDoorMat = new THREE.MeshStandardMaterial({ color: 0xf0efe9, roughness: 0.55 });
  const garageDoorGrooveMat = new THREE.MeshStandardMaterial({ color: 0xd8d6cd, roughness: 0.6 });
  const garageDoorHeight = wallHeight * 0.72;
  const garageDoor = mesh(
    new THREE.BoxGeometry(garageWidth - 1, garageDoorHeight, 0.05),
    garageDoorMat
  );
  garageDoor.position.set(garageCenterX, garageDoorHeight / 2, garageFrontZ - 0.03);
  group.add(garageDoor);
  for (let i = 1; i < 4; i++) {
    const groove = mesh(
      new THREE.BoxGeometry((garageWidth - 1) * 0.92, 0.02, 0.01),
      garageDoorGrooveMat
    );
    groove.position.set(garageCenterX, (garageDoorHeight * i) / 4, garageFrontZ - 0.06);
    group.add(groove);
  }

  // Wall-lantern porch lights flanking the garage door — present in the
  // owner's own photo and one of the few things that reads as "lived in"
  // on an otherwise flat run of brick either side of the door.
  const sconceMetalMat = new THREE.MeshStandardMaterial({
    color: 0x2a2622,
    roughness: 0.5,
    metalness: 0.4,
  });
  const sconceGlassMat = new THREE.MeshStandardMaterial({
    color: 0xfff2cf,
    emissive: 0xffcf80,
    emissiveIntensity: 1.4,
    roughness: 0.4,
  });
  function buildSconce() {
    const sconceGroup = new THREE.Group();
    // Backplate sits flush against the wall; the lantern body and cap
    // project outward (local -Z) from it, toward the street.
    const backplate = mesh(new THREE.BoxGeometry(0.14, 0.22, 0.04), sconceMetalMat);
    sconceGroup.add(backplate);
    const lantern = mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.16, 8), sconceGlassMat);
    lantern.position.set(0, -0.02, -0.09);
    sconceGroup.add(lantern);
    const cap = mesh(new THREE.ConeGeometry(0.07, 0.06, 8), sconceMetalMat);
    cap.position.set(0, 0.09, -0.09);
    sconceGroup.add(cap);
    return sconceGroup;
  }
  // Just outside the door's own edges (door spans garageCenterX +/- (garageWidth - 1) / 2).
  const sconceInset = (garageWidth - 1) / 2 + 0.25;
  const sconceLeft = buildSconce();
  sconceLeft.position.set(garageCenterX - sconceInset, garageDoorHeight * 0.85, garageFrontZ);
  group.add(sconceLeft);
  const sconceRight = buildSconce();
  sconceRight.position.set(garageCenterX + sconceInset, garageDoorHeight * 0.85, garageFrontZ);
  group.add(sconceRight);

  // Driveway, leading away from the garage door.
  const drivewayWidth = garageWidth - 0.2;
  const drivewayLength = 6;
  const driveway = mesh(new THREE.BoxGeometry(drivewayWidth, 0.06, drivewayLength), concreteMat);
  driveway.position.set(garageCenterX, 0.03, garageFrontZ - drivewayLength / 2);
  group.add(driveway);

  // Brick gable pediment over the garage, with a round louvered vent — this
  // is what makes the garage read as its own gabled volume rather than just
  // a box tucked under the main hip roof.
  const garageGablePeak = 1.7;
  const gableEnd = buildGableEnd(garageWidth, garageGablePeak, 0.1, garageBrickMat);
  gableEnd.position.set(garageCenterX, wallHeight, garageFrontZ);
  group.add(gableEnd);

  const ventOuter = mesh(new THREE.CircleGeometry(0.24, 16), trimMat);
  ventOuter.rotation.y = Math.PI;
  ventOuter.position.set(garageCenterX, wallHeight + garageGablePeak * 0.5, garageFrontZ - 0.061);
  group.add(ventOuter);
  const ventInnerMat = new THREE.MeshStandardMaterial({ color: 0x141210, roughness: 0.9 });
  const ventInner = mesh(new THREE.CircleGeometry(0.16, 16), ventInnerMat);
  ventInner.rotation.y = Math.PI;
  ventInner.position.set(garageCenterX, wallHeight + garageGablePeak * 0.5, garageFrontZ - 0.062);
  group.add(ventInner);

  const garageRoof = buildGableRoof(
    garageWidth,
    garageDepth,
    garageGablePeak,
    0.12,
    0.35,
    0.35,
    roofMat
  );
  garageRoof.position.set(garageCenterX, wallHeight, -depth / 2 - garageDepth / 2);
  group.add(garageRoof);

  // Front entry: oval-glass door under a small gabled hood, on a slim
  // brick support column.
  const frontDoorX = -1.1;
  const frontDoorMat = new THREE.MeshStandardMaterial({ color: 0xefe7d8, roughness: 0.55 });
  const frontDoor = mesh(new THREE.BoxGeometry(0.85, 2.0, 0.06), frontDoorMat);
  frontDoor.position.set(frontDoorX, 1.0, -depth / 2 - 0.03);
  group.add(frontDoor);

  const ovalMat = new THREE.MeshPhysicalMaterial({
    color: 0xbcd4e0,
    roughness: 0.2,
    metalness: 0.05,
    clearcoat: 0.5,
  });
  const oval = mesh(new THREE.CircleGeometry(0.16, 20), ovalMat);
  oval.scale.set(1, 1.7, 1);
  oval.rotation.y = Math.PI;
  oval.position.set(frontDoorX, 1.35, -depth / 2 - 0.061);
  group.add(oval);

  const entryRoof = buildGableRoof(1.3, 0.9, 0.55, 0.08, 0.15, 0.15, roofMat);
  entryRoof.position.set(frontDoorX, wallHeight, -depth / 2 - 0.45);
  group.add(entryRoof);

  const entryColumnHeight = wallHeight * 0.62;
  const entryColumnMat = scaledBrickMat(0.18, entryColumnHeight);
  const entryColumn = mesh(
    new THREE.BoxGeometry(0.18, entryColumnHeight, 0.18),
    entryColumnMat
  );
  entryColumn.position.set(frontDoorX - 0.75, entryColumnHeight / 2, -depth / 2 - 0.85);
  group.add(entryColumn);

  // Arched front windows.
  const archWinBig = buildArchedWindow(1.3, 1.4, trimMat, glassMat);
  archWinBig.position.set(-3.3, 1.15, -depth / 2 - 0.03);
  group.add(archWinBig);

  const archWinSmall = buildArchedWindow(0.8, 1.1, trimMat, glassMat);
  archWinSmall.position.set(-4.5, 1.0, -depth / 2 - 0.03);
  group.add(archWinSmall);

  // Chimney — rising up through the main hip roof itself rather than
  // standing beside an exterior wall, matching the owner's own satellite
  // photo (the pin sits well inside the roof's outline, near the ridge,
  // not at any edge). It was previously parked at x = -4.6 against the
  // front wall, which also happened to clip straight through
  // archWinSmall (x = -4.5) — this new spot is clear of both windows and
  // the front entry, still on the side opposite the garage per the
  // ground photo, but pulled back toward the rear half of the roof where
  // nothing else is placed.
  //
  // Taller than before (was wallHeight + roofHeight * 0.85 = 4.655,
  // shorter than the roof's own peak at wallHeight + roofHeight = 5.0) —
  // that only cleared the roof because it stood right at the low eave
  // edge. Moved this far in from the edge, the local roof surface is much
  // closer to full peak height, so the chimney needs to clear the actual
  // peak, not just the eave, plus a bit more so the cap visibly stands
  // proud of the ridge the way a real flue does.
  const chimneyHeight = wallHeight + roofHeight + 0.6;
  // Painted masonry, not exposed brick — it's the one light-coloured mass
  // on an otherwise all-brick exterior in the owner's photos, and having it
  // brick made it disappear into the wall behind it.
  const chimneyBodyMat = new THREE.MeshStandardMaterial({
    map: makeSpeckleTexture('#ddd7c8', 10, 8, 3),
    roughness: 0.92,
  });
  const chimney = buildChimney(0.55, 0.5, chimneyHeight, trimMat, chimneyBodyMat);
  chimney.position.set(-3.5, 0, -2);
  group.add(chimney);

  // "FORT DARLA" — a tilted yard sign staked in the lawn by the front walk,
  // rather than a wall plaque. Default board orientation faces back toward
  // the house, so this needs the +PI flip to actually greet someone
  // approaching from the street instead of showing them the mirrored back.
  const yardSign = buildYardSign('FORT DARLA');
  yardSign.position.set(-2.2, 0, -depth / 2 - 2.5);
  yardSign.rotation.y = Math.PI + 0.3;
  group.add(yardSign);

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
// Tightened from 3.6 (and the thinning below eased off) for a denser
// forest — kept more conservative than the grass density changes though,
// since each tree is its own handful of individual meshes/draw calls
// (see createTree — trunk + several foliage pieces, not instanced the way
// grass blades are), so tree count is a noticeably more expensive lever
// to pull than blade count.
const TREE_SPACING = 3.0;

// Trees fill a regular grid (with jitter, so it doesn't look mechanical)
// everywhere outside the walkable lawn and the house footprint — the
// backyard's own clearing, reused unchanged for every chunk since these
// exclusion checks trivially fail (no effect) far from the origin anyway.
// A grid also can't leave a directional gap the way random angular sampling
// can — every slot outside the safe zone gets a tree, full stop.
// The backyard clearing (open lawn, no trees) and the house's own
// footprint — shared between the tree chunks (which exclude both) and the
// grass field (which only grows in the clearing, minus the house).
// Widened to wrap the whole house — front yard/driveway and both sides,
// not just the backyard clearing behind it — since this is what both
// createTreeChunk (keeps trees out of it) and createChunkGrass (keeps
// forest-floor tufts out of it, so they don't double up with the yard's
// own denser grass below) key off of.
// z lower bound pushed out to -40 (from -24) so the open corridor reaches
// all the way past the road (see ROAD_Z below) instead of a forest wall
// cutting across the extended driveway partway there.
const inOpenArea = (x, z) => x > -13 && x < 13 && z > -40 && z < 18;
// Where grass and trees can't grow because a building is standing there.
// This used to be one box spanning x ±8.7 and z -24.2..-3.8, which was
// sized to reach the garage and driveway at the back — but the house
// itself is only x ±5.5, so that box left a ~3 unit strip of bare ground
// running down each side of the house for its whole depth. Hugging the
// actual structures instead lets the lawn come right up to the walls, the
// way it does in the reference photos.
//
// Coordinates are world-space; the house group sits at (0, 0, -11) with an
// 11 x 7 main box, so its walls are x ±5.5 / z -14.5..-7.5. The margins
// below are deliberately a few centimetres proud of each wall so blades
// don't clip through from the inside — was 0.2 (20cm), which at close
// range read as a visible bald strip of bare lawn-base color between the
// grass and every wall/driveway edge rather than turf actually meeting
// them. 0.03 is closer to what "a few centimetres" actually meant.
const inBuildingBox = (x, z, xMin, xMax, zMin, zMax) =>
  x > xMin && x < xMax && z > zMin && z < zMax;
const inHouse = (x, z) =>
  // main house
  inBuildingBox(x, z, -5.53, 5.53, -14.53, -7.47) ||
  // covered patio slab off the back
  inBuildingBox(x, z, -3.99, 3.99, -7.53, -4.87) ||
  // garage, projecting past the main roofline
  inBuildingBox(x, z, 0.37, 4.83, -17.53, -14.5) ||
  // and its driveway
  inBuildingBox(x, z, 0.47, 4.73, -23.53, -17.5) ||
  // the straight extension carrying it the rest of the way to the road
  // (createDrivewayExtension)
  inBuildingBox(x, z, 0.47, 4.73, -31.83, -23.5);

// Matches firePit's own placement in createYard() below — kept separate so
// grass (createChunkGrass) can skip it without needing the actual fire pit
// object to exist yet.
export const FIRE_PIT = { x: -1, z: 5, radius: 0.7 };
const inFirePit = (x, z) => Math.hypot(x - FIRE_PIT.x, z - FIRE_PIT.z) < FIRE_PIT.radius;

// The street out front — pushed well past the driveway's old short end
// (see the extended, curved driveway in createYard()) rather than sitting
// right at the garage. A band across the whole world rather than just
// near the house, so the road reads as continuing off into the trees on
// either side instead of stopping dead at the edge of the yard. Matches
// createRoad() below.
const ROAD_Z = -34;
const ROAD_HALF_WIDTH = 2.2;
const inRoad = (x, z) => z > ROAD_Z - ROAD_HALF_WIDTH && z < ROAD_Z + ROAD_HALF_WIDTH;

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
      if (inOpenArea(x, z) || inHouse(x, z) || inRoad(x, z)) continue;
      if (rand() < 0.1) continue; // thin out a bit so it reads as a forest, not a wall

      const kind = rand() < 0.3 ? 'pine' : 'round';
      const tree = createTree(kind, rand);
      tree.position.set(x, terrainHeight(x, z), z);
      group.add(tree);
    }
  }

  const grass = createChunkGrass(cx, cz, rand);
  if (grass) group.add(grass);

  return group;
}

function createFirePit() {
  const group = new THREE.Group();

  // A built pit, not a campfire ring: three courses of stacked wall block
  // in a circle, laid in running bond (each course offset half a block so
  // the vertical joints don't line up, which is both how they actually go
  // together and what stops it reading as a stack of rings).
  const ringRadius = 0.55;
  const blocksPerCourse = 13;
  const courses = 3;
  const courseHeight = 0.115;
  const blockDepth = 0.13;
  // Chord width of one block, less a hair so neighbours don't interpenetrate
  // at the corners once they're rotated to face outward.
  const blockWidth = 2 * ringRadius * Math.sin(Math.PI / blocksPerCourse) * 0.94;
  const blockGeo = new THREE.BoxGeometry(blockWidth, courseHeight, blockDepth);

  // A small shared palette rather than a fresh material per block: these
  // are tumbled concrete pavers and want mottling, but 39 individual
  // materials would be 39 draw calls for one fire pit.
  const blockMats = [0x9c8f7a, 0x8b7f6c, 0xa89a83, 0x7d7264].map(
    (hex) => new THREE.MeshStandardMaterial({ color: hex, roughness: 0.95 })
  );

  for (let c = 0; c < courses; c++) {
    // Half-block twist per course, plus a touch of per-course rotation so
    // the whole thing isn't perfectly regular.
    const offset = (c % 2 === 0 ? 0 : Math.PI / blocksPerCourse) + c * 0.03;
    for (let i = 0; i < blocksPerCourse; i++) {
      const angle = (i / blocksPerCourse) * Math.PI * 2 + offset;
      const blockMat = blockMats[Math.floor(Math.random() * blockMats.length)];
      const block = mesh(blockGeo, blockMat);
      block.position.set(
        Math.cos(angle) * ringRadius,
        courseHeight / 2 + c * courseHeight,
        Math.sin(angle) * ringRadius
      );
      block.rotation.y = -angle;
      group.add(block);
    }
  }

  // The black steel insert that sits down inside the stone, with its rim
  // proud of the top course.
  const steelMat = new THREE.MeshStandardMaterial({
    color: 0x1c1a18,
    roughness: 0.55,
    metalness: 0.6,
  });
  const insertHeight = courses * courseHeight * 0.82;
  const insert = mesh(
    new THREE.CylinderGeometry(ringRadius - 0.1, ringRadius - 0.12, insertHeight, 28, 1, true),
    steelMat
  );
  insert.position.y = insertHeight / 2 + 0.02;
  group.add(insert);

  const rim = mesh(new THREE.TorusGeometry(ringRadius - 0.095, 0.022, 8, 28), steelMat);
  rim.rotation.x = Math.PI / 2;
  rim.position.y = courses * courseHeight + 0.01;
  group.add(rim);

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

// The original driveway (see createHouse) is a short straight slab right
// at the garage — fine up close, but the road now sits much further out
// (see ROAD_Z), so this picks up where that ends and runs straight on to
// it. Built the same way as the lawn and the road (a PlaneGeometry with
// each vertex's height sampled from terrainHeight, then laid flat) rather
// than the hand-rolled curved ribbon this replaced, which had its winding
// backwards and came out as a broken white patch.
function createDrivewayExtension() {
  const width = 4.2;
  // Flush with the garage driveway's own end (garageCenterX = 2.6, ending
  // at local z = -12.5 -> world z = -23.5, from createHouse).
  const startZ = -23.5;
  // Exactly the road's near edge — both this and the road sample the same
  // terrainHeight() at the boundary, so they meet flush without needing a
  // deliberate overlap (which just showed as the driveway visibly
  // covering part of the road instead of ending at it).
  const endZ = ROAD_Z + ROAD_HALF_WIDTH;
  const centerX = 2.6;
  const centerZ = (startZ + endZ) / 2;
  const length = Math.abs(startZ - endZ);

  // The original driveway (createHouse) is a flat box riding on the
  // house's own flat local Y — it never dips with the terrain the way
  // this extension (which samples real terrainHeight per vertex) does.
  // Left alone, that's a step right at the seam, since the house's pad is
  // already past TERRAIN_PAD by the time the driveway ends. Blending from
  // that same flat height at startZ down to the real terrain height by
  // endZ removes the step without flattening the extension's own slope.
  const flatHeight = terrainHeight(0, -11) + 0.03;
  const realStartHeight = terrainHeight(centerX, startZ);
  const seamOffset = flatHeight - realStartHeight;

  const geo = new THREE.PlaneGeometry(width, length, 4, 16);
  // Recenters local (x, y) on (centerX, centerZ) before the height
  // sampling below reads it back out — see createLawn's comment on the
  // rotation.x = -PI/2 sign flip (local Y becomes -worldZ once flat).
  geo.translate(centerX, -centerZ, 0);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const worldX = pos.getX(i);
    const worldZ = -pos.getY(i);
    const t = Math.min(1, Math.max(0, (startZ - worldZ) / (startZ - endZ)));
    pos.setZ(i, terrainHeight(worldX, worldZ) + seamOffset * (1 - t) + 0.018);
  }
  geo.computeVertexNormals();

  // Same photographed concrete as the garage driveway (createHouse), not
  // the flat canvas-speckle tint this replaced — that one read as
  // near-white once lit, since it had no roughnessMap to vary the
  // highlight the way a real photo texture does.
  const concreteTextures = loadPbrTextures('concrete_floor', 'diff', 4, 2);
  const concreteMat = new THREE.MeshStandardMaterial({
    map: concreteTextures.map,
    normalMap: concreteTextures.normalMap,
    roughnessMap: concreteTextures.roughnessMap,
    roughness: 1,
  });
  const extension = mesh(geo, concreteMat);
  extension.rotation.x = -Math.PI / 2;
  return extension;
}

// The street out front. A wide, gently-sloped world (see terrainHeight)
// means a flat road box would either float above the ground or bury
// itself in it away from dead center, so this follows the same
// sample-terrainHeight-per-vertex approach as the lawn itself.
function createRoad() {
  // Past TERRAIN_RADIUS (34) — the road needs to reach the actual edge of
  // the world, not just the visible foreground, or the tail end of
  // inRoad's exclusion band (which applies across all x) shows bare
  // unpaved lawn beyond wherever the mesh itself stopped.
  const roadHalfLength = 42;
  const segsAlong = 50;
  const segsAcross = 6;
  const geo = new THREE.PlaneGeometry(
    roadHalfLength * 2,
    ROAD_HALF_WIDTH * 2,
    segsAlong,
    segsAcross
  );
  // Recenters local Y on ROAD_Z before the height sampling below reads it
  // back out — see createLawn's own comment on the rotation.x = -PI/2
  // sign flip (local Y becomes -worldZ once the mesh is laid flat).
  geo.translate(0, -ROAD_Z, 0);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const worldX = pos.getX(i);
    const worldZ = -pos.getY(i);
    // A hair above the lawn/terrain surface so it doesn't z-fight with
    // the ground it's sitting on.
    pos.setZ(i, terrainHeight(worldX, worldZ) + 0.015);
  }
  geo.computeVertexNormals();

  const asphaltMat = new THREE.MeshStandardMaterial({
    // repeatX scaled up to match roadHalfLength so the speckle grain stays
    // the same physical size now that the road is much longer.
    map: makeSpeckleTexture('#3d3c3e', 10, 30, 3),
    roughness: 0.95,
  });
  const road = mesh(geo, asphaltMat);
  road.rotation.x = -Math.PI / 2;
  road.receiveShadow = true;

  // A dashed centerline, built out of short boxes rather than a texture —
  // this is the one piece of the road that has to actually line up with
  // the terrain's slope rather than just tiling across it, and a handful
  // of boxes each individually placed at their own sampled height does
  // that for free.
  const lineMat = new THREE.MeshStandardMaterial({ color: 0xe8d98a, roughness: 0.7 });
  const dashLength = 0.9;
  const dashGap = 0.7;
  const dashGeo = new THREE.BoxGeometry(0.1, 0.01, dashLength);
  for (let x = -roadHalfLength + 1; x < roadHalfLength - 1; x += dashLength + dashGap) {
    const dash = mesh(dashGeo, lineMat);
    dash.position.set(x + dashLength / 2, terrainHeight(x, ROAD_Z) + 0.025, ROAD_Z);
    road.add(dash);
  }

  return road;
}

// A brick mailbox post at the curb, off the right shoulder of the
// driveway — matching the reference photo rather than a campfire-ring
// cluster of guesses about what "other stuff" belongs out front.
function createMailbox() {
  const group = new THREE.Group();

  const postMat = new THREE.MeshStandardMaterial({
    map: makeSpeckleTexture('#8a3f30', 18, 3, 6),
    roughness: 0.9,
  });
  const postHeight = 0.85;
  const post = mesh(new THREE.BoxGeometry(0.22, postHeight, 0.22), postMat);
  post.position.y = postHeight / 2;
  group.add(post);

  const capMat = new THREE.MeshStandardMaterial({ color: 0xd8d2c2, roughness: 0.8 });
  const cap = mesh(new THREE.BoxGeometry(0.28, 0.04, 0.28), capMat);
  cap.position.y = postHeight + 0.02;
  group.add(cap);

  const boxMat = new THREE.MeshStandardMaterial({ color: 0xf4f4f0, roughness: 0.5 });
  const boxGeo = new THREE.CylinderGeometry(0.11, 0.11, 0.32, 12, 1, false, -Math.PI / 2, Math.PI);
  const mailboxBody = mesh(boxGeo, boxMat);
  mailboxBody.rotation.z = Math.PI / 2;
  mailboxBody.position.set(0, postHeight + 0.16, 0.02);
  group.add(mailboxBody);

  const doorMat = new THREE.MeshStandardMaterial({ color: 0xe0e0da, roughness: 0.5 });
  const door = mesh(new THREE.BoxGeometry(0.01, 0.32, 0.22), doorMat);
  door.position.set(0.115, postHeight + 0.16, 0.02);
  group.add(door);

  const flagMat = new THREE.MeshStandardMaterial({ color: 0xc0392b, roughness: 0.6 });
  const flag = mesh(new THREE.BoxGeometry(0.02, 0.14, 0.05), flagMat);
  flag.position.set(-0.005, postHeight + 0.24, 0.155);
  group.add(flag);

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
// ── terrain ────────────────────────────────────────────────────────────
// The house sits on a level pad at the top of a broad dome that falls away
// in every direction — the driveway climbs to it from the road, and the
// back lawn rolls off behind it. This is the single source of truth for
// ground height: the lawn mesh, every grass blade, every tree, both
// characters and all the yard props sample it, so if it changes they all
// move together.
const TERRAIN_CENTER_X = 0;
// Under the house, which sits at z = -11.
const TERRAIN_CENTER_Z = -11;
const TERRAIN_HEIGHT = 2.4;
// Flat out to PAD, so the house, patio and driveway all sit on level
// ground rather than one corner hanging in the air — real lots get graded
// that way, and a 7-unit-deep building on a curved dome would visibly
// float at the edges.
// 9 clears the furthest corner of the house-plus-patio footprint (about
// 7.6 units from centre) with a little margin, and no more — pushing it
// further just flattens back lawn that should be rolling away.
const TERRAIN_PAD = 9;
const TERRAIN_RADIUS = 34;

// Flat at both ends, steepest in the middle — a rounded brow rather than a
// cone, and it meets the flat outer ground without a crease.
function smootherstep(t) {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

export function terrainHeight(x, z) {
  const d = Math.hypot(x - TERRAIN_CENTER_X, z - TERRAIN_CENTER_Z);
  if (d <= TERRAIN_PAD) return TERRAIN_HEIGHT;
  if (d >= TERRAIN_RADIUS) return 0;
  const t = (d - TERRAIN_PAD) / (TERRAIN_RADIUS - TERRAIN_PAD);
  return TERRAIN_HEIGHT * (1 - smootherstep(t));
}

// Segments per world unit across the lawn. The dome's slope is gentle, so
// this only has to be fine enough that the silhouette doesn't facet.
const LAWN_SIZE = 120;
const LAWN_SEGMENTS = 120;

function createLawn() {
  // No normalMap/roughnessMap here — those came from the old photo
  // texture, and painted-on strokes don't have a matching bump/gloss
  // pattern to go with them the way a real photo does; a flat roughness
  // suits the painterly look better anyway.
  const map = createPaintedGrassTexture();
  const geo = new THREE.PlaneGeometry(LAWN_SIZE, LAWN_SIZE, LAWN_SEGMENTS, LAWN_SEGMENTS);

  // The mesh gets rotated flat below (rotation.x = -PI/2), which maps local
  // (x, y, z) to world (x, z, -y). So world height is the local z axis, and
  // a vertex's world Z is minus its local y — hence the sign flip when
  // sampling.
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const worldX = pos.getX(i);
    const worldZ = -pos.getY(i);
    pos.setZ(i, terrainHeight(worldX, worldZ));
  }
  geo.computeVertexNormals();

  const ground = new THREE.Mesh(
    geo,
    new THREE.MeshStandardMaterial({
      map,
      color: 0x8fcf72,
      roughness: 1,
    })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  ground.userData.textures = [map];
  return ground;
}

// A taller, lusher blade for the wild patch by the fire pit — somewhere to
// see a nicer grass model in context, next to the mowed lawn, before
// deciding whether it's worth rolling out everywhere (it is a good deal
// more expensive per blade: more vertices, and a fragment shader doing
// real transmission work).
//
// Three things it does that the lawn blade doesn't:
//   1. enough height segments to actually curve, rather than approximating
//      a bend with a handful of straight facets;
//   2. wind that *bends* the blade over an arc and shortens it vertically
//      as it goes, instead of shearing it sideways — a real blade pivots
//      at the root and keeps its length;
//   3. light transmitted THROUGH the blade when it's between you and the
//      sun, which is where most of a sunlit field's glow actually comes
//      from. Grass is thin enough to be quite translucent and shading it
//      as a purely opaque surface is what leaves it looking flat.
// Thin stalks. Wide blades read as a leafy weed or a reed; mown turf is
// fine and needle-like, and at this width the angular floor in the vertex
// shader is what keeps distant blades from disappearing rather than sheer
// thickness.
// Roughly a tenth of the blade's height. A blade only ~4x taller than it
// is wide reads as a spike or a shark's tooth no matter what else is done
// to it; real grass is a long thin ribbon, and getting this ratio right
// matters more than any shading trick.
const LUSH_BLADE_WIDTH = 0.024;
const LUSH_BLADE_HALF_WIDTH = LUSH_BLADE_WIDTH / 2;

// Height and segment count are parameters so the one blade model can serve
// both the mowed lawn and anything taller: a short blade barely curves, so
// paying for ten height segments on it would be waste — the segments only
// earn their keep once there's a real arc to describe.
function createLushBladeGeometry(height, segments) {
  const geo = new THREE.PlaneGeometry(LUSH_BLADE_WIDTH, height, 1, segments);
  geo.translate(0, height / 2, 0);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    // Clamped to [0, 1]: PlaneGeometry's translate() leaves the root row a
    // hair off exactly zero (float rounding, e.g. -3e-9 instead of 0), and
    // Math.pow() of a negative base to a non-integer exponent is NaN in
    // JS — which was quietly poisoning every blade's geometry and, via
    // InstancedMesh.computeBoundingSphere() reading that shared shape,
    // getting whole grass chunks frustum-culled into invisible/black.
    const t = Math.min(1, Math.max(0, pos.getY(i) / height));
    // Taper to a fine point — a real blade narrows to almost nothing.
    // Hold most of the width up the shaft and only pinch near the tip. An
    // even taper from root to point makes a triangle; a real blade is
    // near-parallel-sided for most of its length.
    pos.setX(i, pos.getX(i) * (1 - Math.pow(t, 2.4) * 0.85));
    // A gentle resting curve; the wind adds its own bend on top.
    pos.setZ(i, pos.getZ(i) + t * t * height * 0.22);
  }
  geo.computeVertexNormals();
  return geo;
}

function createLushGrassMaterial(bladeHeight) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      fogColor: { value: new THREE.Color(0x87ceeb) },
      fogNear: { value: 18 },
      fogFar: { value: 55 },
      uAngPerPx: { value: 0.002 },
      uMinBladePx: { value: 1.5 },
    },
    vertexShader: `
      attribute float instanceRandom;
      uniform float uTime;
      uniform float uAngPerPx;
      uniform float uMinBladePx;
      varying float vHeightT;
      varying float vRandom;
      varying float vFogDepth;
      varying vec3 vNormalW;
      varying vec3 vWorldPos;

      void main() {
        float t = position.y / ${bladeHeight.toFixed(3)};
        vHeightT = t;
        vRandom = instanceRandom;
        vNormalW = normalize(mat3(instanceMatrix) * normal);

        // Same angular width floor as the lawn blade — see the comment
        // there. Matters more here since these taper to a finer point.
        vec4 mvRoot = modelViewMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
        float rootDist = max(-mvRoot.z, 0.001);
        float instScale = length(mat3(instanceMatrix)[0]);
        float restHalfW = ${LUSH_BLADE_HALF_WIDTH.toFixed(4)} * instScale;
        float minHalfW = rootDist * uAngPerPx * uMinBladePx * 0.5;
        float widen = max(1.0, minHalfW / max(restHalfW, 1e-5));
        vec3 widened = position;
        widened.x *= widen;

        vec4 restPos = instanceMatrix * vec4(widened, 1.0);

        // Wind, layered the same way as the lawn's: a slow gust envelope
        // rolling across the field, a main lean, and a finer flutter.
        float dirWobble = sin(uTime * 0.12 + restPos.x * 0.02 - restPos.z * 0.02) * 0.3;
        vec2 windDir = normalize(vec2(1.0 + dirWobble, 0.35 - dirWobble * 0.5));

        // The sway used to carry instanceRandom in its *phase*, which meant
        // every blade swung on its own clock. That can never look like wind
        // however it's tuned — wind is a thing that happens to the whole
        // field at once. So the two coherent terms below carry no per-blade
        // randomness at all, and only a small flutter does.

        // Gentle background motion, always present.
        float baseSway = sin(uTime * 0.8 - restPos.x * 0.05 - restPos.z * 0.04) * 0.28;

        // Gusts. The spatial term is subtracted from the time term, so the
        // crest travels across the lawn rather than the whole field pulsing
        // in place — blades lean, hold, and recover in sequence as the front
        // passes over them. Raising a clamped sine to a power leaves it near
        // zero for most of the cycle and briefly near one, which is what
        // makes it read as an occasional gust instead of a constant heave.
        float gustPhase = uTime * 0.85 - (restPos.x * 0.055 + restPos.z * 0.042);
        float gust = pow(max(sin(gustPhase), 0.0), 2.5);

        // The only per-blade term, and deliberately small: just enough that
        // the field isn't a rigid sheet moving as one plate.
        float flutter = sin(uTime * 3.1 + instanceRandom * 6.2831) * 0.14;

        float wave = baseSway + gust * 1.15 + flutter;

        // Quadratic in height, so the bend accumulates toward the tip and
        // the root stays planted rather than the whole blade sliding.
        // Scaled by the blade's own height (and its instance scale) so a
        // mowed blade and a waist-high one lean by the same proportion —
        // a fixed world-space bend would fold a short blade flat.
        float bendScale = ${bladeHeight.toFixed(3)} * instScale;
        // Mown turf barely moves — it's short and stiff, and the deep
        // rippling sway that suits a hay meadow reads as wrong on a lawn.
        // Enough to breathe, not enough to billow.
        float bend = wave * 0.16 * bendScale * t * t;
        restPos.x += windDir.x * bend;
        restPos.z += windDir.y * bend;
        // Leaning over has to cost height, or the blade stretches as it
        // bends — a blade pivots, it doesn't grow.
        restPos.y -= abs(bend) * 0.45 * t;

        vec4 worldPos = modelMatrix * restPos;
        vWorldPos = worldPos.xyz;

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
      varying vec3 vNormalW;
      varying vec3 vWorldPos;
      uniform vec3 fogColor;
      uniform float fogNear;
      uniform float fogFar;

      void main() {
        // A shadowed green, not a near-black one. This was (0.04, 0.16,
        // 0.06), which is almost black before anything else touches it —
        // and since two further terms below darken the lower blade again,
        // the bottom of every blade came out effectively at zero.
        vec3 baseColor = vec3(0.11, 0.30, 0.13);
        vec3 tipWarm = vec3(0.52, 0.86, 0.32);
        vec3 tipCool = vec3(0.22, 0.58, 0.24);

        // Dark green near the house, lightening toward the edge of the
        // map — radial distance from the terrain's own center (see
        // TERRAIN_CENTER_X/Z above) rather than noise, so it actually
        // tracks "close to the house" instead of drawing an unrelated
        // patchwork over it. Flat dark out to TERRAIN_PAD (the level pad
        // the house sits on), then fading out to TERRAIN_RADIUS (the
        // world's edge).
        float distFromCenter = length(vWorldPos.xz - vec2(${TERRAIN_CENTER_X.toFixed(3)}, ${TERRAIN_CENTER_Z.toFixed(3)}));
        float shade = 1.0 - smoothstep(${TERRAIN_PAD.toFixed(3)}, ${TERRAIN_RADIUS.toFixed(3)}, distFromCenter);
        baseColor = mix(baseColor, vec3(0.02, 0.09, 0.04), shade);
        tipWarm = mix(tipWarm, vec3(0.14, 0.32, 0.11), shade);
        tipCool = mix(tipCool, vec3(0.05, 0.16, 0.07), shade);

        vec3 tipColor = mix(tipCool, tipWarm, vRandom);
        // Slightly biased toward the base rather than squared. vHeightT*
        // vHeightT is only a quarter of the way to the tip colour at
        // mid-blade, so most of the blade's visible length sat at base
        // colour — the gradient was doing far more darkening than intended.
        vec3 color = mix(baseColor, tipColor, pow(vHeightT, 1.3));

        // Ambient occlusion down in the sward: little light reaches the
        // bottom of dense turf, and lighting every blade evenly root to tip
        // makes a field look like a flat sheet of spikes rather than
        // something with depth. Gentle, though — at 0.30 this was stacking
        // on top of an already-dark base and crushing it to black.
        color *= 0.66 + 0.34 * smoothstep(0.0, 0.7, vHeightT);

        vec3 lightDir = normalize(vec3(0.45, 0.75, 0.35));
        vec3 N = normalize(vNormalW);
        float ndl = abs(dot(N, lightDir));
        color *= 0.55 + 0.55 * (ndl * 0.5 + 0.5);

        // Transmission: when the blade sits between the eye and the sun,
        // light comes through it rather than off it. Strongest where the
        // blade is edge-on to the sun (low ndl) — that is exactly the
        // geometry where an opaque shading model would render it darkest,
        // which is why grass without this looks flat and dead in
        // backlight.
        vec3 V = normalize(cameraPosition - vWorldPos);
        float back = pow(clamp(dot(V, -lightDir), 0.0, 1.0), 3.0);
        color += vec3(0.45, 0.80, 0.28) * back * (1.0 - ndl) * vHeightT * 0.75;

        color += tipWarm * pow(vHeightT, 4.0) * 0.16 * ndl;
        color *= 0.85 + vRandom * 0.3;

        float fogFactor = smoothstep(fogNear, fogFar, vFogDepth);
        color = mix(color, fogColor, fogFactor);
        gl_FragColor = vec4(color, 1.0);
      }
    `,
    side: THREE.DoubleSide,
  });
}

// Mowed-lawn height — this is now the only grass in the world, so the
// blade model above carries everything from the yard to the treeline.
// Was doubled to 0.4 to fix bare-looking turf, but that read as knee-high
// field grass rather than a mowed lawn — a taller blade was the wrong fix
// for gaps between blades. Back down near the original 0.2, with
// GRASS_SPACING tightened below instead so short blades still mat into a
// surface rather than standing apart as separate spikes.
const MOWED_BLADE_HEIGHT = 0.13;
// Three height segments rather than the ten a tall blade wants: at this
// height there is barely an arc to describe, and the segment count is
// pure vertex cost across ~150k blades.
// Two, down from three, to pay for the density above. A 0.2-tall blade has
// almost no arc to describe, so segments here buy very little — whereas
// the reference gets away with as few as one on anything past ~15 units.
// Blade *count* is what makes turf look thick; segments per blade aren't.
const MOWED_BLADE_SEGMENTS = 2;

export const grassMaterial = createLushGrassMaterial(MOWED_BLADE_HEIGHT);

// Every grass material there is. Keeping the per-frame/per-mode updates
// behind these helpers means main.js doesn't have to know how many there
// are — adding another can't silently leave one with a stale clock or the
// wrong fog. Populated at the bottom of the grass section, once all the
// materials it names actually exist.
const grassMaterials = [];

export function setGrassTime(elapsed) {
  grassMaterials.forEach((m) => {
    m.uniforms.uTime.value = elapsed;
  });
}

export function setGrassFog(color, near, far) {
  grassMaterials.forEach((m) => {
    m.uniforms.fogColor.value.set(color);
    m.uniforms.fogNear.value = near;
    m.uniforms.fogFar.value = far;
  });
}

// How much world space one screen pixel covers, per unit of distance from
// the camera — purely a function of vertical FOV and viewport height, so
// it only has to be recomputed when either changes (startup and resize).
// The grass vertex shaders use it to keep a receding blade from ever
// rendering thinner than uMinBladePx.
export function updateGrassAngularSize(camera, viewportHeight) {
  const fovRadians = (camera.fov * Math.PI) / 180;
  const angPerPx = (2 * Math.tan(fovRadians / 2)) / viewportHeight;
  grassMaterials.forEach((m) => {
    m.uniforms.uAngPerPx.value = angPerPx;
  });
}

// Now that it exists — see the note on grassMaterials above.
grassMaterials.push(grassMaterial);

function buildGrassMesh(positions, rand) {
  const geometry = createLushBladeGeometry(MOWED_BLADE_HEIGHT, MOWED_BLADE_SEGMENTS);
  const field = new THREE.InstancedMesh(geometry, grassMaterial, positions.length);
  const instanceRandom = new Float32Array(positions.length);
  const dummy = new THREE.Object3D();
  positions.forEach(([x, z], i) => {
    dummy.position.set(x, terrainHeight(x, z), z);
    // Facing, plus a real lean. Blades standing dead upright read as a bed
    // of nails — turf mats down, with stalks lying over each other at all
    // angles, and that tangle is most of what makes it look like a mass
    // rather than a field of pins. YXZ order so Y is the facing and the
    // other two tip it over from there.
    //
    // Safe for the vertex shader's normal handling: this is still a pure
    // rotation, so `mat3(instanceMatrix)` stays a rotation times a uniform
    // scale, which is what both the normal transform and the instScale
    // measurement there assume.
    dummy.rotation.order = 'YXZ';
    dummy.rotation.set(
      (rand() - 0.5) * 0.85,
      rand() * Math.PI * 2,
      (rand() - 0.5) * 0.85
    );
    // Some unevenness so it doesn't read as bristles on a brush, but a
    // tighter spread than a wild field would have — this is a mowed lawn,
    // so blades top out at roughly a common height. Deliberately kept
    // *uniform* (not a taller-but-not-wider stretch): the vertex shader's
    // normal transform above takes the plain upper 3x3 of instanceMatrix,
    // which is only correct for uniform scale.
    // Enough spread that it isn't a uniform crop, but not so much that it
    // reads as scraggly — a mown lawn's blades are broadly the same
    // length, unlike the hay-meadow spread this had before.
    const scale = 0.72 + rand() * 0.6;
    dummy.scale.set(scale, scale, scale);
    dummy.updateMatrix();
    field.setMatrixAt(i, dummy.matrix);
    instanceRandom[i] = rand();
  });
  geometry.setAttribute('instanceRandom', new THREE.InstancedBufferAttribute(instanceRandom, 1));
  field.instanceMatrix.needsUpdate = true;
  return field;
}

// Grass used to come from two separate systems — a dense grid over a
// hardcoded rectangle for the yard, and a handful of sparse scattered
// tufts per wooded chunk — which left an obvious hard-edged rectangle of
// lawn sitting in an otherwise nearly bare world. This is one system
// instead: the same even grid everywhere, at a density that simply fades
// out with distance from the house, so there's no boundary to see.
//
// Kept per-chunk (rather than one huge mesh for the whole world) so each
// piece frustum-culls independently — a single combined InstancedMesh
// would have to vertex-process every blade in the world every frame no
// matter where the camera was pointing.
// Tight, and tighter still now that MOWED_BLADE_HEIGHT is back down near
// 0.2 — a short blade doesn't lean far enough to cross its neighbours, so
// the density has to do the covering work that length no longer does.
// Thin blades need to be numerous or the mass goes gappy — a lawn is thick
// *because* it's thousands of fine stalks, not because each one is broad.
// Going sparse-and-thin at the same time (as an earlier pass did) gives
// stubble, which is the one thing it must not look like.
const GRASS_SPACING = 0.03;
// Full density out to FULL_RADIUS, then thinning linearly to nothing by
// FADE_RADIUS. FULL_RADIUS is set to clear the whole yard clearing (whose
// far corners sit at radius ~22-27, see inOpenArea) so the lawn itself is
// never the thing being thinned — the fade happens out among the trees,
// where sparser grass just reads as forest floor rather than as a
// boundary.
const GRASS_FULL_RADIUS = 24;
// Extended from 34 — the road (ROAD_Z = -34) and its far-side mailbox now
// sit right around the old fade-to-nothing distance, which was leaving
// the new road frontage patchy/bald. Only the tail is pushed out, not
// FULL_RADIUS, so this doesn't touch the cost of the already-dense area.
const GRASS_FADE_RADIUS = 44;

// Grass loads as normal, except in debug mode (?debug in the URL — see
// DEBUG_MODE in main.js), where it's skipped for faster reloads while
// iterating. Checked independently here rather than passed in from
// main.js, since both files agree on the same URL regardless. Nothing
// else about the grass system changes; this just short-circuits chunk
// generation before it builds any blades.
const GRASS_ENABLED = !new URLSearchParams(window.location.search).has('debug');

function createChunkGrass(cx, cz, rand) {
  if (!GRASS_ENABLED) return null;
  const originX = cx * CHUNK_SIZE;
  const originZ = cz * CHUNK_SIZE;

  // Cheap early-out for chunks entirely past the fade — skips ~26k inner
  // loop iterations each for the outer ring of the world, which is most
  // of the chunks generateWorld builds.
  const nearestX = Math.max(originX, Math.min(0, originX + CHUNK_SIZE));
  const nearestZ = Math.max(originZ, Math.min(0, originZ + CHUNK_SIZE));
  if (Math.hypot(nearestX, nearestZ) > GRASS_FADE_RADIUS) return null;

  const exclude = (x, z) => inHouse(x, z) || inFirePit(x, z) || inRoad(x, z);
  const jitter = GRASS_SPACING * 0.9;
  const positions = [];

  for (let lx = 0; lx < CHUNK_SIZE; lx += GRASS_SPACING) {
    for (let lz = 0; lz < CHUNK_SIZE; lz += GRASS_SPACING) {
      const x = originX + lx + (rand() - 0.5) * jitter;
      const z = originZ + lz + (rand() - 0.5) * jitter;
      if (exclude(x, z)) continue;

      const dist = Math.hypot(x, z);
      if (dist > GRASS_FADE_RADIUS) continue;
      if (dist > GRASS_FULL_RADIUS) {
        const keep =
          1 - (dist - GRASS_FULL_RADIUS) / (GRASS_FADE_RADIUS - GRASS_FULL_RADIUS);
        if (rand() > keep) continue;
      }

      positions.push([x, z]);
    }
  }

  if (positions.length === 0) return null;
  return buildGrassMesh(positions, rand);
}

export function createYard() {
  const group = new THREE.Group();
  const lawn = createLawn();
  group.add(lawn);
  group.userData.lawn = lawn;

  const house = createHouse();
  house.position.set(0, terrainHeight(0, -11), -11);
  group.add(house);

  // Trees are streamed in as chunks (see createTreeChunk / CHUNK_SIZE),
  // managed from main.js based on Darla's position, not added here.

  const firePit = createFirePit();
  firePit.position.set(-1, terrainHeight(-1, 5), 5);
  group.add(firePit);
  group.userData.firePit = firePit;

  const hammock = createHammock();
  hammock.position.set(6, terrainHeight(6, 9), 9);
  hammock.rotation.y = 0.4;
  group.add(hammock);
  group.userData.hammock = hammock;

  // A little developer joke, staked out in the open lawn away from the
  // fire pit and hammock — facing back toward the middle of the yard so
  // it's actually readable as you wander past.
  const underConstructionSign = buildYardSign('Under Construction');
  underConstructionSign.position.set(-7, terrainHeight(-7, 11), 11);
  underConstructionSign.rotation.y = Math.PI * 0.75;
  group.add(underConstructionSign);

  // The street out front, matching the owner's own reference photo (and
  // their sketch of it): the short garage driveway now curves the rest of
  // the way out to the road, two mature pines flank that curve where it
  // nears the road, and the mailbox sits across the road rather than on
  // the house's own side of it.
  const drivewayExtension = createDrivewayExtension();
  group.add(drivewayExtension);

  const road = createRoad();
  group.add(road);

  const leftTree = createTree('pine', Math.random);
  leftTree.scale.multiplyScalar(2.1);
  leftTree.position.set(-3.4, terrainHeight(-3.4, -30.5), -30.5);
  group.add(leftTree);

  const rightTree = createTree('pine', Math.random);
  rightTree.scale.multiplyScalar(2.3);
  rightTree.position.set(9.6, terrainHeight(9.6, -29.5), -29.5);
  group.add(rightTree);

  // Across the road from the house, not the near shoulder — the far edge
  // sits at ROAD_Z - ROAD_HALF_WIDTH, so this clears it by a step further.
  const mailbox = createMailbox();
  const mailboxZ = ROAD_Z - ROAD_HALF_WIDTH - 1.2;
  mailbox.position.set(5.5, terrainHeight(5.5, mailboxZ), mailboxZ);
  mailbox.rotation.y = Math.PI / 2;
  group.add(mailbox);

  return group;
}
