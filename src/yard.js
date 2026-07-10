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
  return texture;
}

function makeBrickTexture() {
  const w = 256;
  const h = 256;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#cbbfae';
  ctx.fillRect(0, 0, w, h);
  const brickH = 20;
  const brickW = 46;
  const gap = 4;
  let row = 0;
  for (let y = -brickH; y < h + brickH; y += brickH + gap) {
    const offset = row % 2 === 0 ? 0 : -(brickW + gap) / 2;
    for (let x = offset - brickW; x < w + brickW; x += brickW + gap) {
      const shade = Math.random() * 30 - 15;
      const r = 139 + shade;
      const g = 68 + shade * 0.6;
      const b = 56 + shade * 0.5;
      ctx.fillStyle = `rgb(${r | 0},${g | 0},${b | 0})`;
      ctx.fillRect(x, y, brickW, brickH);
    }
    row++;
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(4, 2);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

// A unit hip-roof pyramid, rotated so its base is axis-aligned, wrapped in a
// group so it can be non-uniformly scaled to any width/depth/height without
// distorting the rotation.
function buildHipRoof(width, depth, height, material) {
  const geo = new THREE.ConeGeometry(1 / Math.SQRT2, 1, 4);
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

function buildFrenchDoors(totalW, h, trimMat, glassMat) {
  const group = new THREE.Group();
  const doorW = totalW / 2 - 0.03;
  const left = buildWindow(doorW, h, trimMat, glassMat);
  left.position.x = -totalW / 4;
  group.add(left);
  const right = buildWindow(doorW, h, trimMat, glassMat);
  right.position.x = totalW / 4;
  group.add(right);
  const centerMullion = mesh(new THREE.BoxGeometry(0.06, h, 0.08), trimMat);
  group.add(centerMullion);
  return group;
}

export function createHouse() {
  const group = new THREE.Group();
  const width = 11;
  const depth = 7;
  const wallHeight = 2.7;
  const roofHeight = 2.3;

  const brickMat = new THREE.MeshStandardMaterial({
    map: makeBrickTexture(),
    roughness: 0.85,
  });
  const roofMat = new THREE.MeshStandardMaterial({
    map: makeSpeckleTexture('#8d8880', 40, 6, 4),
    roughness: 0.8,
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
  const concreteMat = new THREE.MeshStandardMaterial({
    map: makeSpeckleTexture('#c7c2b6', 25, 4, 3),
    roughness: 0.9,
  });

  const walls = mesh(new THREE.BoxGeometry(width, wallHeight, depth), brickMat);
  walls.position.y = wallHeight / 2;
  group.add(walls);

  const roof = buildHipRoof(width * 1.12, depth * 1.12, roofHeight, roofMat);
  roof.position.y = wallHeight;
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

  const patioRoof = mesh(
    new THREE.BoxGeometry(patioWidth + 0.4, 0.15, patioDepth + 0.5),
    trimMat
  );
  patioRoof.position.set(0, wallHeight + 0.08, depth / 2 + patioDepth / 2);
  group.add(patioRoof);

  [-patioWidth / 2 + 0.2, 0.3, patioWidth / 2 - 0.2].forEach((x) => {
    const col = mesh(
      new THREE.BoxGeometry(0.35, wallHeight + 0.15, 0.35),
      brickMat
    );
    col.position.set(x, (wallHeight + 0.15) / 2, depth / 2 + patioDepth - 0.2);
    group.add(col);
  });

  const winL = buildWindow(1.3, 1.5, trimMat, glassMat);
  winL.position.set(-width * 0.3, wallHeight * 0.6, depth / 2 + 0.01);
  group.add(winL);

  const winR = buildWindow(1.3, 1.5, trimMat, glassMat);
  winR.position.set(width * 0.3, wallHeight * 0.6, depth / 2 + 0.01);
  group.add(winR);

  const doors = buildFrenchDoors(2.2, 2.0, trimMat, glassMat);
  doors.position.set(0, wallHeight * 0.42, depth / 2 + 0.01);
  group.add(doors);

  return group;
}

const PINE_MAT = new THREE.MeshStandardMaterial({ color: 0x2f5233, roughness: 0.9 });
const LEAF_MATS = [0x4a7c3f, 0x567f3f, 0x3f6b38].map(
  (color) => new THREE.MeshStandardMaterial({ color, roughness: 0.85 })
);
const TRUNK_MAT = new THREE.MeshStandardMaterial({ color: 0x5b4330, roughness: 0.95 });

function createTree(kind) {
  const group = new THREE.Group();
  const trunkH = kind === 'pine' ? 1.2 + Math.random() * 0.6 : 0.9 + Math.random() * 0.4;
  const trunk = mesh(new THREE.CylinderGeometry(0.08, 0.11, trunkH, 7), TRUNK_MAT);
  trunk.position.y = trunkH / 2;
  group.add(trunk);

  if (kind === 'pine') {
    for (let i = 0; i < 3; i++) {
      const r = 0.9 - i * 0.22;
      const h = 1.1;
      const cone = mesh(new THREE.ConeGeometry(r, h, 8), PINE_MAT);
      cone.position.y = trunkH + i * 0.65 + h * 0.35;
      group.add(cone);
    }
  } else {
    const foliageMat = LEAF_MATS[Math.floor(Math.random() * LEAF_MATS.length)];
    for (let i = 0; i < 3; i++) {
      const r = 0.55 + Math.random() * 0.35;
      const blob = mesh(new THREE.SphereGeometry(r, 8, 6), foliageMat);
      blob.position.set(
        (Math.random() - 0.5) * 0.6,
        trunkH + 0.5 + Math.random() * 0.5,
        (Math.random() - 0.5) * 0.6
      );
      group.add(blob);
    }
  }

  group.rotation.y = Math.random() * Math.PI * 2;
  group.scale.setScalar(0.8 + Math.random() * 0.6);
  return group;
}

// Trees fill a regular grid (with jitter, so it doesn't look mechanical)
// everywhere outside the walkable lawn and the house footprint. This is a
// backyard, fully enclosed by trees on every side except where the house
// itself stands — not a park with an open entrance — so the "keep clear"
// zone matches the actual walkable area exactly, nothing wider. A grid also
// can't leave a directional gap the way random angular sampling can — every
// slot outside the safe zone gets a tree, full stop.
function createTreeline() {
  const group = new THREE.Group();
  const spacing = 4.2;
  const extent = 46;

  const inOpenArea = (x, z) => x > -9.5 && x < 9.5 && z > -4.5 && z < 14.5;
  const inHouse = (x, z) => x > -7 && x < 7 && z > -15.5 && z < -4.5;

  for (let gx = -extent; gx <= extent; gx += spacing) {
    for (let gz = -extent; gz <= extent; gz += spacing) {
      const x = gx + (Math.random() - 0.5) * spacing * 0.8;
      const z = gz + (Math.random() - 0.5) * spacing * 0.8;
      if (inOpenArea(x, z) || inHouse(x, z)) continue;
      if (Math.random() < 0.25) continue; // thin out a bit so it reads as a forest, not a wall

      const kind = Math.random() < 0.3 ? 'pine' : 'round';
      const tree = createTree(kind);
      tree.position.set(x, 0, z);
      group.add(tree);
    }
  }

  return group;
}

function createLawn() {
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(100, 100),
    new THREE.MeshStandardMaterial({
      map: makeSpeckleTexture('#4f8f45', 40, 40, 40),
      roughness: 0.95,
    })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  return ground;
}

export function createYard() {
  const group = new THREE.Group();
  group.add(createLawn());

  const house = createHouse();
  house.position.set(0, 0, -11);
  group.add(house);

  group.add(createTreeline());

  return group;
}
