import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { createSouthernPine } from './pine.js';
import {
  createHouse,
  isHousePaved,
  CONCRETE_MAT,
  CONCRETE_UV_SCALE,
  HOUSE_Z,
  HOUSE_DRIVEWAY,
} from './house.js';

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

// Real photographed CC0 textures (polyhaven.com): diffuse + normal +
// roughness maps give actual physical depth and per-pixel variation under
// lighting. `folder` doubles as the shared filename prefix, matching how
// Poly Haven ships each set. Only bark still comes from here — everything
// the house is made of is generated at runtime instead (see house.js),
// because a photographed set can only ever be generic, and matching one
// specific house is the whole point.
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

function loadBarkTextures() {
  return loadPbrTextures('bark_brown_02', 'diff', 1, 2);
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
  // (rotation.x = -PI/2), which mirrors the texture on the Z axis relative
  // to how it lands on X.
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
// z lower bound pushed out to -48 (from -24, then -40) so the open
// corridor reaches all the way past the road (see ROAD_Z below) instead of
// a forest wall cutting across the extended driveway partway there. It has
// to clear the mailbox on the far shoulder too (ROAD_Z - ROAD_HALF_WIDTH -
// 1.2 = -43.9), or trees grow through it.
const inOpenArea = (x, z) => x > -13 && x < 13 && z > -48 && z < 18;

// The straight run of driveway between where the house's own slab stops
// (HOUSE_DRIVEWAY) and the road.
const DRIVE_X = HOUSE_DRIVEWAY.x;
const DRIVE_HALF_W = HOUSE_DRIVEWAY.halfWidth;
const DRIVE_START_Z = HOUSE_DRIVEWAY.endZ;

// The run to the road isn't straight. In the photos the drive leaves the
// garage, drifts steadily away from the garage side, and opens into a
// broad bell where it meets the pavement — a county road with no curb cut,
// so the concrete itself has to give cars room to swing in off the lane.
//
// Sign: the garage sits at +x, and from the road you're looking down +z,
// which puts the garage on your left. The apron in the photos opens to the
// right of the drive as you look at the house, so the centreline drifts
// toward -x on its way out.
const DRIVE_BEND = -2.4;
const DRIVE_APRON_HALF = 5.6;

// Where the drive is along its run, 0 at the house slab and 1 at the curb.
const driveT = (z) =>
  Math.min(1, Math.max(0, (DRIVE_START_Z - z) / (DRIVE_START_Z - (ROAD_Z + ROAD_HALF_WIDTH))));
const driveCenterX = (t) => DRIVE_X + DRIVE_BEND * smootherstep(t);
// Fifth power, so the flare stays tight for nearly the whole run and only
// opens over the last two or three metres. What the photos actually show
// is a constant-width drive with a radiused return at the pavement, not a
// widening wedge — cubic was already too gradual and rendered as a fan
// spanning most of the frontage, which read as a parking lot.
const driveHalfWidth = (t) => DRIVE_HALF_W + (DRIVE_APRON_HALF - DRIVE_HALF_W) * t ** 5;

const onDriveway = (x, z) => {
  if (z > DRIVE_START_Z || z < ROAD_Z + ROAD_HALF_WIDTH) return false;
  const t = driveT(z);
  return Math.abs(x - driveCenterX(t)) < driveHalfWidth(t);
};

// Where grass and trees can't grow because a building or a slab is standing
// there. The house's own shapes live in house.js — walls, driveway, side
// apron, back walk and the curved front walk — so that this file and the
// house can't drift apart about where the lawn stops. Everything the house
// knows about is deliberately hugged tight, not boxed generously: the whole
// point is that turf comes right up to the brick the way it does in the
// reference photos.
const inHouse = (x, z) =>
  isHousePaved(x, z) ||
  // the curved, flaring extension carrying the driveway the rest of the
  // way out to the road (createDrivewayExtension). Shares its centreline
  // and width functions rather than approximating them with a box, or the
  // lawn grows through the apron where the two disagree.
  onDriveway(x, z);

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
//
// Moved out from -34 when the house went to its real assessor dimensions.
// The house grew *forwards* (see HOUSE_Z in house.js) — the garage door
// went from world z -17.5 to -23.96, a 6.46 m march toward the street —
// while the road stayed put, so the drive from door to curb collapsed
// from 14.3 m to 7.84 m and the house ended up sitting almost on the
// road. This puts the near edge back at 14.3 m from the garage door,
// which is the length it had before the rebuild.
//
// It also fixes the elevation: the dome is centred under the house, so
// at -34 the road sat 2.20 m up the hill against the pad's 2.40 — a
// 0.20 m climb across the whole drive, i.e. visually flat. At -40.5 the
// near edge is at 0.84 m, a 1.56 m climb, so the driveway actually rises
// to the house the way the terrain comment upstream claims it does.
const ROAD_Z = -40.5;
const ROAD_HALF_WIDTH = 2.2;
const inRoad = (x, z) => z > ROAD_Z - ROAD_HALF_WIDTH && z < ROAD_Z + ROAD_HALF_WIDTH;

// ── roadside drainage ──────────────────────────────────────────────────
// This is a county road with no curb and no storm sewer. The photos show
// the lawn crowning up away from the pavement and dropping into an open
// grass swale that runs the length of the frontage and carries runoff
// along it — the single most legible piece of ground shaping out front,
// and the reason the yard reads as a mound rather than a flat sheet.
//
// The ditch still has to close up under the driveway, or the concrete
// would sag through the low point. The culvert pipe that used to be
// modelled at the crossing is gone — it never read as anything but a
// length of tube lying in the grass — but the fill it implies stays,
// since that's what carries the drive across.
// Set back far enough from the pavement that the ditch's near bank clears
// the road edge entirely (needs at least DITCH_HALF of gap), or the road
// itself sags into the profile.
const DITCH_Z = ROAD_Z + ROAD_HALF_WIDTH + 2.8;
const DITCH_HALF = 2.4;
// These are proper trenches, not a dip in the lawn — the far bank is over
// your head standing in the bottom. Depth does double duty: it's also what
// buys the culvert its cover, so the pipe runs three-quarters of a metre
// under the driveway instead of scraping the underside of the slab the way
// it did at 0.55 and again at 0.75.
const DITCH_DEPTH = 1.2;
// Reaches clear of the apron's widest point so the fill carries past the
// concrete edge, rather than the slab overhanging an open trench.
const DITCH_FILL_HALF = DRIVE_APRON_HALF + 1.4;

function ditchDepthAt(x, z) {
  const dz = Math.abs(z - DITCH_Z);
  if (dz >= DITCH_HALF) return 0;
  // Parabolic section — a rounded swale you could run a mower through,
  // not a slot trench.
  const profile = 1 - (dz / DITCH_HALF) ** 2;
  // Measured from where the drive actually *is* at this z, not from
  // DRIVE_X. The centreline has bent 2.3 m by the time it reaches the
  // swale, and centring the fill on the straight-line x put the raised
  // embankment 2.3 m to one side of the concrete it carries: the apron's
  // left edge overhung an open ditch and stood on a visible lip, while on
  // the right the fill humped up under open lawn and left the culvert
  // mouth lying on top of the ground.
  const dx = Math.abs(x - driveCenterX(driveT(z)));
  if (dx >= DITCH_FILL_HALF) return DITCH_DEPTH * profile;
  return DITCH_DEPTH * profile * smootherstep(dx / DITCH_FILL_HALF);
}

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

// Tumbled split-face wall block. The real ones aren't a flat colour: each
// block is mottled across its own face, with exposed aggregate speckle and
// faint horizontal striation from the mould, and the tone wanders within a
// single block as much as it does between blocks. Tinting a plain material
// per block only ever gets the second half of that.
function makeStoneTexture() {
  const S = 256;
  const canvas = document.createElement('canvas');
  canvas.width = S;
  canvas.height = S;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#cec4ae';
  ctx.fillRect(0, 0, S, S);

  // Broad tonal drift first — big soft patches, so the face reads as cast
  // stone rather than painted board.
  for (let i = 0; i < 26; i++) {
    const x = Math.random() * S;
    const y = Math.random() * S;
    const r = S * (0.1 + Math.random() * 0.28);
    const tone = 128 + Math.floor(Math.random() * 70);
    const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, `rgba(${tone},${Math.floor(tone * 0.94)},${Math.floor(tone * 0.83)},0.5)`);
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }

  // Faint horizontal striation from the mould face.
  for (let i = 0; i < 40; i++) {
    const y = Math.random() * S;
    ctx.strokeStyle = `rgba(${90 + Math.random() * 60},${84 + Math.random() * 55},${72 + Math.random() * 48},${0.05 + Math.random() * 0.09})`;
    ctx.lineWidth = 1 + Math.random() * 4;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.bezierCurveTo(S * 0.3, y + (Math.random() - 0.5) * 12, S * 0.7, y + (Math.random() - 0.5) * 12, S, y);
    ctx.stroke();
  }

  // Exposed aggregate — the fine light and dark grit that makes it read as
  // concrete close up.
  for (let i = 0; i < 2600; i++) {
    // Weighted light: dark grit at full strength turned the whole face
    // muddy once the material tint multiplied through it.
    const g = Math.random();
    const v = g < 0.38 ? 95 + Math.random() * 45 : 200 + Math.random() * 50;
    ctx.fillStyle = `rgba(${v},${Math.floor(v * 0.96)},${Math.floor(v * 0.88)},${0.1 + Math.random() * 0.22})`;
    const s = 0.6 + Math.random() * 1.9;
    ctx.fillRect(Math.random() * S, Math.random() * S, s, s);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = 8;
  return texture;
}

// Deterministic per-position hash, so every copy of a shared corner gets the
// same offset. Jittering vertices independently would tear the box open at
// its seams — BoxGeometry duplicates corner vertices once per face.
function cornerHash(x, y, z, seed) {
  const n = Math.sin(x * 127.1 + y * 311.7 + z * 74.7 + seed * 53.3) * 43758.5453;
  return n - Math.floor(n);
}

// A block knocked out of true: corners and mid-edge points pushed around so
// no two are the same shape and none has a clean machined arris. These are
// cast, tumbled to break the edges, then stacked by hand.
function jitteredBlock(w, h, d, seed) {
  const geo = new THREE.BoxGeometry(w, h, d, 2, 2, 2);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    pos.setX(i, x + (cornerHash(x, y, z, seed) - 0.5) * w * 0.09);
    pos.setY(i, y + (cornerHash(x, y, z, seed + 7) - 0.5) * h * 0.2);
    pos.setZ(i, z + (cornerHash(x, y, z, seed + 13) - 0.5) * d * 0.22);
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  return geo;
}

// Soft round puff, dense in the middle and falling away to nothing at the
// edge. Drawn once and shared by every smoke sprite.
function makeSmokeTexture() {
  const S = 128;
  const canvas = document.createElement('canvas');
  canvas.width = S;
  canvas.height = S;
  const ctx = canvas.getContext('2d');
  const grad = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  grad.addColorStop(0, 'rgba(210,205,198,0.85)');
  grad.addColorStop(0.45, 'rgba(188,183,176,0.4)');
  grad.addColorStop(1, 'rgba(170,166,160,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, S, S);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

const SMOKE_COUNT = 16;
const SMOKE_RISE = 2.6;

function createFirePit() {
  const group = new THREE.Group();

  // A built pit, not a campfire ring: three courses of stacked wall block in
  // a circle, laid in running bond (each course offset half a block so the
  // vertical joints don't line up, which is both how they actually go
  // together and what stops it reading as a stack of rings).
  const ringRadius = 0.55;
  const blocksPerCourse = 13;
  const courses = 3;
  const courseHeight = 0.115;
  const blockDepth = 0.13;
  // Chord width measured at the *outer* face, not the centreline. A block
  // sitting tangentially spans a longer chord the further out you measure,
  // so sizing it to the centre radius leaves every joint open by about 4 cm
  // on the face you actually look at — which is what made the ring read as
  // spaced-out rather than stacked. The 1.04 is deliberate overlap to cover
  // the shape jitter; blocks interpenetrate slightly at the inner face,
  // where the steel insert hides it.
  const blockWidth =
    2 * (ringRadius + blockDepth / 2) * Math.sin(Math.PI / blocksPerCourse) * 1.04;
  // Seven pre-jittered block shapes, picked from at random. One shape reused
  // 39 times reads as a machined ring no matter how it's tinted, but 39
  // unique buffers is wasteful for a static prop — seven is enough that the
  // repeat never registers.
  const blockGeos = [];
  for (let s = 0; s < 7; s++) {
    blockGeos.push(jitteredBlock(blockWidth, courseHeight, blockDepth, s + 1));
  }

  // Tumbled split-face block, which is what the real pit is built from: warm
  // and varied rather than uniformly grey. The photo runs tan through
  // rust-brown to a cool grey, block to block, so the palette spans that.
  //
  // The tint is only half of it though — each block is also mottled across
  // its own face, so they share one stone texture and the colour just shifts
  // it. bumpMap off the same canvas picks out the aggregate so the surface
  // catches light unevenly instead of reading as flat card.
  const stoneTexture = makeStoneTexture();
  // Lighter than they look right, because the tint multiplies *through* the
  // texture rather than replacing it — the map already averages well below
  // white, so a mid-tone here lands close to black on the finished block.
  const blockMats = [
    0xe4d8c0, 0xcdc6b6, 0xc0a487, 0xd6b18f, 0xefe6d4, 0xb3a795,
  ].map(
    (hex) =>
      new THREE.MeshStandardMaterial({
        map: stoneTexture,
        bumpMap: stoneTexture,
        bumpScale: 0.45,
        color: hex,
        roughness: 0.97,
      })
  );

  for (let c = 0; c < courses; c++) {
    // Half-block twist per course, plus a touch of per-course rotation so the
    // whole thing isn't perfectly regular.
    const offset = (c % 2 === 0 ? 0 : Math.PI / blocksPerCourse) + c * 0.03;
    for (let i = 0; i < blocksPerCourse; i++) {
      const angle = (i / blocksPerCourse) * Math.PI * 2 + offset;
      const blockMat = blockMats[Math.floor(Math.random() * blockMats.length)];
      const block = mesh(
        blockGeos[Math.floor(Math.random() * blockGeos.length)],
        blockMat
      );
      block.position.set(
        Math.cos(angle) * ringRadius,
        courseHeight / 2 + c * courseHeight,
        Math.sin(angle) * ringRadius
      );
      // pi/2 - angle, not -angle. The block's width runs along its local x,
      // and -angle points that straight out from the centre — so every block
      // stuck out radially like a petal with gaps between them, and the
      // 0.13 depth was doing the job of closing the ring. This turns them
      // side-on: width around the circumference, depth through the wall.
      block.rotation.y = Math.PI / 2 - angle;
      // Tumbled block is never laid dead true. A little jitter in seating and
      // depth is the difference between stacked stone and a machined ring —
      // these are cast, tumbled to knock the arrises off, then stacked by
      // hand on an uneven base.
      block.rotation.z = (Math.random() - 0.5) * 0.05;
      block.rotation.x = (Math.random() - 0.5) * 0.04;
      block.scale.set(1, 0.94 + Math.random() * 0.12, 0.92 + Math.random() * 0.16);
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
  insert.material.side = THREE.DoubleSide;
  insert.position.y = insertHeight / 2 + 0.02;
  group.add(insert);

  const rim = mesh(new THREE.TorusGeometry(ringRadius - 0.095, 0.022, 8, 28), steelMat);
  rim.rotation.x = Math.PI / 2;
  rim.position.y = courses * courseHeight + 0.01;
  group.add(rim);

  // Ring of air slots just under the rim. This is a smokeless pit — the
  // double wall draws air up through these and reburns the smoke — and the
  // band of dark notches is the detail that identifies it as one.
  const slotMat = new THREE.MeshStandardMaterial({ color: 0x0b0a09, roughness: 0.9 });
  const slotGeo = new THREE.BoxGeometry(0.035, 0.022, 0.03);
  for (let i = 0; i < 22; i++) {
    const angle = (i / 22) * Math.PI * 2;
    const slot = mesh(slotGeo, slotMat);
    slot.position.set(
      Math.cos(angle) * (ringRadius - 0.1),
      courses * courseHeight - 0.045,
      Math.sin(angle) * (ringRadius - 0.1)
    );
    slot.rotation.y = -angle;
    group.add(slot);
  }

  // A dark floor well down inside, rather than a pale ash disc sitting near
  // the rim. The real one reads as an empty black drum from any angle you
  // actually see it from.
  const floorMat = new THREE.MeshStandardMaterial({ color: 0x231f1c, roughness: 1 });
  const floor = mesh(new THREE.CircleGeometry(ringRadius - 0.11, 24), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = 0.03;
  group.add(floor);

  // ── firewood ──────────────────────────────────────────────────────────
  // Split logs, laid as a real fire is: two on the bottom running one way, a
  // couple across them, and two more leaned into a shallow teepee. The old
  // version put three logs at the same point and only changed their rotation,
  // so they all radiated from a single spot in mid-air.
  const logMat = new THREE.MeshStandardMaterial({ color: 0x5b4330, roughness: 0.94 });
  const barkMat = new THREE.MeshStandardMaterial({ color: 0x3d2c1e, roughness: 1 });
  const logs = new THREE.Group();
  const addLog = (len, r, x, y, z, rotY, rotZ, mat = logMat) => {
    const log = mesh(new THREE.CylinderGeometry(r, r * 0.92, len, 9), mat);
    log.rotation.z = Math.PI / 2 + rotZ;
    log.rotation.y = rotY;
    log.position.set(x, y, z);
    logs.add(log);
  };
  addLog(0.52, 0.05, 0, 0.085, -0.07, 0.15, 0, barkMat);
  addLog(0.48, 0.046, 0, 0.085, 0.08, 0.02, 0);
  addLog(0.5, 0.048, -0.03, 0.175, 0, Math.PI / 2 + 0.12, 0, barkMat);
  addLog(0.44, 0.043, 0.05, 0.175, 0, Math.PI / 2 - 0.25, 0);
  // The two leaners, tipped up out of the stack.
  addLog(0.46, 0.04, -0.09, 0.23, -0.05, 0.9, -0.5);
  addLog(0.42, 0.038, 0.1, 0.23, 0.06, -0.7, 0.55, barkMat);
  group.add(logs);

  // ── fire, embers and smoke ────────────────────────────────────────────
  // All of this is night-only. main.js switches it with the day/night toggle
  // — a fire burning at noon was the single most obviously wrong thing about
  // the old pit.
  // A scatter of small tongues rather than three big concentric cones. The
  // old version was one solid opaque cone standing well above the rim, and
  // at 85% opacity it read as a traffic cone rather than a fire — real
  // flames are lots of small, thin, overlapping shapes, and the see-through
  // is most of what sells it.
  const flames = new THREE.Group();
  for (let i = 0; i < 8; i++) {
    const a = Math.random() * Math.PI * 2;
    const d = Math.random() * 0.15;
    const h = 0.14 + Math.random() * 0.2;
    const flameMat = new THREE.MeshBasicMaterial({
      color: [0xff5a12, 0xff8c1a, 0xffb347, 0xffd166][i % 4],
      transparent: true,
      opacity: 0.42 + Math.random() * 0.2,
      toneMapped: false,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const flame = new THREE.Mesh(
      new THREE.ConeGeometry(0.032 + Math.random() * 0.026, h, 7),
      flameMat
    );
    flame.position.set(Math.cos(a) * d, 0.04 + h / 2, Math.sin(a) * d);
    flame.userData.phase = Math.random() * Math.PI * 2;
    flames.add(flame);
  }
  flames.position.y = 0.08;
  group.add(flames);

  // Coals glowing down in the log stack. Unlit these would just be gravel, so
  // they're switched with everything else.
  const embers = new THREE.Group();
  for (let i = 0; i < 9; i++) {
    const a = Math.random() * Math.PI * 2;
    const d = Math.random() * 0.2;
    const ember = new THREE.Mesh(
      new THREE.SphereGeometry(0.018 + Math.random() * 0.016, 6, 5),
      new THREE.MeshBasicMaterial({ color: 0xff5a12, toneMapped: false })
    );
    ember.position.set(Math.cos(a) * d, 0.05 + Math.random() * 0.03, Math.sin(a) * d);
    embers.add(ember);
  }
  group.add(embers);

  // Smoke as billboarded sprites rather than geometry — a puff has no form
  // worth modelling, and Sprite turns to face the camera for free, so it
  // reads from every angle including from directly above.
  const smokeTexture = makeSmokeTexture();
  const smoke = new THREE.Group();
  for (let i = 0; i < SMOKE_COUNT; i++) {
    const puff = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: smokeTexture,
        transparent: true,
        depthWrite: false,
        opacity: 0,
      })
    );
    // Staggered so they don't all rise and vanish in lockstep.
    puff.userData.life = i / SMOKE_COUNT;
    puff.userData.drift = (Math.random() - 0.5) * 0.5;
    puff.userData.spin = (Math.random() - 0.5) * 0.4;
    smoke.add(puff);
  }
  group.add(smoke);

  // Reaches further than it did (3 -> 7) now that night is actually dark, and
  // casts real shadows. A shadow-casting point light renders six faces, so
  // the map is kept small and the range tight — at 512 that's cheap enough
  // for the one light in the scene that genuinely wants it, and it's what
  // throws the pit's own stones and anyone standing at it across the grass.
  const fireLight = new THREE.PointLight(0xffa64d, 1.2, 7, 2);
  fireLight.position.set(0, 0.34, 0);
  fireLight.castShadow = true;
  fireLight.shadow.mapSize.set(512, 512);
  fireLight.shadow.camera.near = 0.12;
  fireLight.shadow.camera.far = 7;
  // Curved blades and stacked stone self-shadow badly at this map size
  // without a bias — it shows up as dark banding crawling over the blocks.
  fireLight.shadow.bias = -0.004;
  group.add(fireLight);

  group.userData.flames = flames;
  group.userData.embers = embers;
  group.userData.smoke = smoke;
  group.userData.light = fireLight;
  group.userData.logs = logs;

  return group;
}

// ── dragonflies ─────────────────────────────────────────────────────────
// Night-only, green and blue. At this scale a dragonfly is only a few
// centimetres of geometry, so what actually reads across a dark yard is the
// glow rather than the body — each one carries an additive halo sprite
// several times its own size, and the body is unlit basic colour with tone
// mapping off so it stays saturated instead of being rolled off toward white
// by the filmic curve.
const DRAGONFLY_COUNT = 22;

function makeGlowTexture() {
  const S = 64;
  const canvas = document.createElement('canvas');
  canvas.width = S;
  canvas.height = S;
  const ctx = canvas.getContext('2d');
  const grad = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.25, 'rgba(255,255,255,0.42)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, S, S);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function createDragonflies() {
  const group = new THREE.Group();
  const glowTexture = makeGlowTexture();

  // Bodies point along +z so lookAt aims them nose-first down their path.
  const bodyGeo = new THREE.CapsuleGeometry(0.009, 0.1, 4, 7);
  bodyGeo.rotateX(Math.PI / 2);
  const headGeo = new THREE.SphereGeometry(0.016, 7, 6);
  headGeo.translate(0, 0, 0.066);
  const bodyMerged = mergeGeometries([bodyGeo, headGeo]);

  // One flat cross of wings. Individual beats are far too fast to resolve at
  // this size — a translucent blur that shivers reads better than four wings
  // flapping, and costs a quarter as much.
  const wingGeo = new THREE.PlaneGeometry(0.17, 0.055);
  wingGeo.rotateX(-Math.PI / 2);

  for (let i = 0; i < DRAGONFLY_COUNT; i++) {
    const green = i % 2 === 0;
    const color = green
      ? [0x35ffa8, 0x66ffc4, 0x1fe38c][i % 3]
      : [0x39b6ff, 0x6ad9ff, 0x2b8cff][i % 3];

    const fly = new THREE.Group();

    const body = new THREE.Mesh(
      bodyMerged,
      new THREE.MeshBasicMaterial({ color, toneMapped: false })
    );
    fly.add(body);

    const wings = new THREE.Mesh(
      wingGeo,
      new THREE.MeshBasicMaterial({
        color: 0xdff4ff,
        transparent: true,
        opacity: 0.3,
        side: THREE.DoubleSide,
        depthWrite: false,
        toneMapped: false,
      })
    );
    wings.position.z = 0.012;
    fly.add(wings);
    fly.userData.wings = wings;

    const glow = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: glowTexture,
        color,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        opacity: 0.42,
        toneMapped: false,
      })
    );
    // Big enough to carry across a dark yard, small enough that one passing
    // near the camera still reads as an insect rather than a floating orb.
    glow.scale.setScalar(0.26);
    fly.add(glow);

    // Each one owns a patch of the backyard clearing and wanders inside it,
    // rather than all of them orbiting one point.
    fly.userData.home = new THREE.Vector3(
      -9 + Math.random() * 18,
      0,
      -1 + Math.random() * 14
    );
    fly.userData.span = new THREE.Vector3(
      0.9 + Math.random() * 2.6,
      0.28 + Math.random() * 0.5,
      0.9 + Math.random() * 2.6
    );
    fly.userData.height = 0.5 + Math.random() * 1.5;
    fly.userData.speed = 0.35 + Math.random() * 0.5;
    fly.userData.phase = Math.random() * Math.PI * 2;
    fly.userData.beat = 26 + Math.random() * 14;

    group.add(fly);
  }

  return group;
}

// Position on a wandering path, nose pointed the way it's going. The
// incommensurate frequencies are the point — round numbers give a visible
// repeating loop, and once you notice one dragonfly doing laps you notice
// all of them.
const flyAhead = new THREE.Vector3();
export function updateDragonflies(group, elapsed) {
  if (!group.visible) return;
  group.children.forEach((fly) => {
    const d = fly.userData;
    const t = elapsed * d.speed + d.phase;
    const at = (k) =>
      new THREE.Vector3(
        d.home.x + Math.sin(t * 1.0 + k) * d.span.x + Math.sin(t * 2.31 + k) * 0.35,
        d.height + Math.sin(t * 1.73 + k + 1) * d.span.y,
        d.home.z + Math.cos(t * 0.83 + k) * d.span.z + Math.cos(t * 1.97 + k) * 0.35
      );

    const here = at(0);
    fly.position.set(here.x, terrainHeight(here.x, here.z) + here.y, here.z);
    // Aim at where it will be a moment from now, so it banks into turns.
    const soon = at(0.08);
    flyAhead.set(soon.x, terrainHeight(soon.x, soon.z) + soon.y, soon.z);
    fly.lookAt(flyAhead);

    // Wing blur: a fast shiver in span rather than a flap.
    const beat = Math.sin(elapsed * d.beat + d.phase);
    d.wings.scale.set(1, 1, 0.55 + Math.abs(beat) * 0.6);
    d.wings.material.opacity = 0.18 + Math.abs(beat) * 0.2;
  });
}

// Lights the fire, or puts it out. Called from applyDayNight.
export function setFirePitLit(pit, lit) {
  pit.userData.flames.visible = lit;
  pit.userData.embers.visible = lit;
  pit.userData.smoke.visible = lit;
  pit.userData.light.visible = lit;
  // The grass applies the fire by hand, so hiding the light isn't enough —
  // it has to be told the fire is out or the lawn keeps its warm pool.
  if (!lit) setGrassFireLight(null, 0);
}

// Feeds the grass shader the fire's world position and current brightness.
const fireWorldPos = new THREE.Vector3();
function setGrassFireLight(pit, intensity) {
  if (pit) pit.userData.light.getWorldPosition(fireWorldPos);
  grassMaterials.forEach((m) => {
    if (pit) m.uniforms.uFirePos.value.copy(fireWorldPos);
    m.uniforms.uFireIntensity.value = intensity;
  });
}

// Flicker and smoke. Only worth running while the fire is actually lit.
export function updateFirePit(pit, elapsed, delta) {
  if (!pit.userData.flames.visible) return;

  // Each tongue flickers on its own phase — in lockstep the whole fire
  // pulses like a heartbeat instead of dancing.
  pit.userData.flames.children.forEach((flame, i) => {
    const p = flame.userData.phase;
    const flicker = Math.sin(elapsed * (13 + i * 2.3) + p) * 0.18 + Math.random() * 0.12;
    flame.scale.set(1 + flicker * 0.35, 1 + flicker * 1.3, 1 + flicker * 0.35);
  });
  const fireIntensity = 1.1 + Math.sin(elapsed * 17) * 0.2 + Math.random() * 0.15;
  pit.userData.light.intensity = fireIntensity;
  // Same flicker drives the grass, so the pool of light on the lawn breathes
  // with the fire instead of sitting there as a static disc.
  setGrassFireLight(pit, fireIntensity * 0.42);

  pit.userData.embers.children.forEach((ember, i) => {
    ember.material.opacity = 1;
    const pulse = 0.6 + 0.4 * Math.sin(elapsed * (3 + i) + i);
    ember.scale.setScalar(0.8 + pulse * 0.4);
  });

  pit.userData.smoke.children.forEach((puff) => {
    const d = puff.userData;
    d.life += delta * 0.22;
    if (d.life > 1) d.life -= 1;
    const t = d.life;
    // Wanders as it climbs. Without enough lateral drift the puffs stack
    // straight up and the column reads as a searchlight beam rather than
    // smoke.
    puff.position.set(
      d.drift * t * t * 3.2,
      0.32 + t * SMOKE_RISE,
      d.spin * t * t * 3.2
    );
    // Grows as it rises and thins out — a puff that keeps its size looks
    // like a balloon on a string.
    puff.scale.setScalar(0.34 + t * 1.5);
    // Fades in fast off the fire, then away to nothing by the top.
    puff.material.opacity = Math.min(1, t * 5) * (1 - t) * 0.22;
  });
}

// The original driveway (see createHouse) is a short straight slab right
// at the garage — fine up close, but the road sits a long way out (see
// ROAD_Z), so this picks up where that ends and carries it the rest of the
// way. Not a straight run: it follows the drifting centreline and
// trumpeting width defined up by DRIVE_BEND, so it matches the photos and
// so isHousePaved/onDriveway agree with it exactly.
//
// Built directly in the XZ plane as a parametric ribbon rather than as a
// rotated PlaneGeometry. There's no rectangle to start from once the
// centreline moves and the width varies, and going direct drops the
// local-Y-is-minus-world-Z sign flip that the rotated version needed.
function createDrivewayExtension() {
  const startZ = DRIVE_START_Z;
  // Exactly the road's near edge — both this and the road sample the same
  // terrainHeight() at the boundary, so they meet flush without needing a
  // deliberate overlap (which just showed as the driveway visibly
  // covering part of the road instead of ending at it).
  const endZ = ROAD_Z + ROAD_HALF_WIDTH;
  const segsAlong = 56;
  const segsAcross = 10;

  // The house's own driveway is a flat slab riding on its flat graded pad —
  // it never dips with the terrain the way this extension (which samples
  // real terrainHeight per vertex) does. Left alone that's a step right at
  // the seam, since the pad has run out by the time the driveway ends.
  // Blending from the pad's height at startZ down to the real terrain
  // height by endZ removes the step without flattening the slope.
  const flatHeight = terrainHeight(0, HOUSE_Z) + HOUSE_DRIVEWAY.surfaceY;
  const realStartHeight = terrainHeight(DRIVE_X, startZ);
  const seamOffset = flatHeight - realStartHeight;

  const positions = [];
  const uvs = [];
  const indices = [];
  for (let iv = 0; iv <= segsAlong; iv++) {
    const t = iv / segsAlong;
    const z = startZ + (endZ - startZ) * t;
    const cx = driveCenterX(t);
    const halfW = driveHalfWidth(t);
    for (let iu = 0; iu <= segsAcross; iu++) {
      const x = cx + (iu / segsAcross - 0.5) * 2 * halfW;
      positions.push(
        x,
        // ditchDepthAt already fills the swale back in under the drive, so
        // sampling the terrain here follows a smooth grade across the
        // culvert rather than sagging into the ditch.
        // 0.045, not the 0.018 this used to sit at. The road surface is
        // terrain + 0.015 and the apron ends exactly on the road's near
        // edge, so 3 mm of separation left the two meshes z-fighting into
        // a torn white fringe along the whole apron lip. The resulting
        // ~3 cm step reads correctly anyway — concrete meeting asphalt.
        terrainHeight(x, z) + seamOffset * (1 - t) + 0.045,
        z
      );
      // The same procedural concrete the house's own slabs use, mapped in
      // metres like they are — the two meet in plain sight at startZ, and
      // any difference in tint or grain size reads as a patch job.
      uvs.push(x * CONCRETE_UV_SCALE, z * CONCRETE_UV_SCALE);
    }
  }
  const stride = segsAcross + 1;
  for (let iv = 0; iv < segsAlong; iv++) {
    for (let iu = 0; iu < segsAcross; iu++) {
      const a = iv * stride + iu;
      const b = a + 1;
      const c = a + stride;
      const d = c + 1;
      // Winding matters and is easy to get backwards here: iv advances
      // toward the road, which is -z, so the row step is -z rather than
      // +z. That flips the sign of the cross product against what the
      // usual +x/+z grid gives, and (a, c, b) — correct for a normal
      // grid — points every normal into the ground, leaving the slab
      // invisible under backface culling.
      indices.push(a, b, c, b, d, c);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();

  const extension = mesh(geo, CONCRETE_MAT);
  extension.receiveShadow = true;
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

// ── terrain ────────────────────────────────────────────────────────────
// The house sits on a level pad at the top of a broad dome that falls away
// in every direction — the driveway climbs to it from the road, and the
// back lawn rolls off behind it. This is the single source of truth for
// ground height: the lawn mesh, every grass blade, every tree, both
// characters and all the yard props sample it, so if it changes they all
// move together.
const TERRAIN_CENTER_X = 0;
// Directly under the house, wherever house.js puts it.
const TERRAIN_CENTER_Z = HOUSE_Z;
const TERRAIN_HEIGHT = 2.4;
// Flat out to PAD, so the house, its porch and all its flatwork sit on
// level ground rather than one corner hanging in the air — real lots get
// graded that way, and a building this size on a curved dome would visibly
// float at the edges.
// 16 clears the furthest corner of everything the house lays down. That's
// the outside corner of the walk wrapping the garage, which is a long way
// out now that the house is at its real size: the assessor's plan puts the
// garage 23 ft forward of the front door, and the concrete rings the whole
// building. Pushing the pad further would just flatten lawn that should be
// rolling away, but stopping short of it would leave the driveway end
// hanging off the side of the hill.
// Widened from 16 so the *frontage* is near-level: the garage and the road
// sit at close to the same height, which is what the photos show. At 16 the
// pad ran out well short of the curb and the drive climbed 1.5 m over its
// length — a 10% grade nobody would pour. The relief in the lot comes from
// the northwest/southeast tilt below and from the drainage swale, not from
// the drive itself being a ramp.
const TERRAIN_PAD = 23;
// Raised with it, or the 10 m of falloff left between pad and radius turns
// the yard into a plateau with a cliff around the rim.
const TERRAIN_RADIUS = 46;

// Flat at both ends, steepest in the middle — a rounded brow rather than a
// cone, and it meets the flat outer ground without a crease.
function smootherstep(t) {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

// The lot is not a symmetric dome. Its high corner is the northwest and it
// falls away to the southeast, so the dome's falloff is biased by heading
// rather than depending on distance alone: ground downhill of the pad drops
// sooner, ground uphill of it stays high further out.
//
// Compass: the evening sun's position across photos 002 and 006 puts west
// at +x and north at +z, which makes the house's front (-z, the street)
// face south and the northwest corner the back garage side. If that's
// rotated, THIS is the only thing to change — the slope is derived from it.
const UPHILL_X = Math.SQRT1_2;
const UPHILL_Z = Math.SQRT1_2;
// How much faster the ground falls heading downhill than uphill. 0 gives
// back the symmetric dome this replaced; at 0.35 the southeast reaches flat
// ground around radius 25 while the northwest carries on to about 44.
const TILT_BIAS = 0.35;

export function terrainHeight(x, z) {
  const dx = x - TERRAIN_CENTER_X;
  const dz = z - TERRAIN_CENTER_Z;
  const d = Math.hypot(dx, dz);
  let h;
  if (d <= TERRAIN_PAD) h = TERRAIN_HEIGHT;
  else {
    // +1 heading straight downhill (southeast), -1 straight uphill.
    const downhill = -(dx * UPHILL_X + dz * UPHILL_Z) / d;
    const t = (d - TERRAIN_PAD) / (TERRAIN_RADIUS - TERRAIN_PAD);
    // Clamped, so this also covers what used to be the d >= TERRAIN_RADIUS
    // early return: smootherstep(1) is 1, which lands on h = 0 anyway.
    const biased = Math.min(1, Math.max(0, t * (1 + TILT_BIAS * downhill)));
    h = TERRAIN_HEIGHT * (1 - smootherstep(biased));
  }
  // The drainage swale is cut *into* whatever the dome gives rather than
  // set at a fixed height, so it stays a ditch running across the slope
  // near the road instead of a level trench slicing through the hill.
  return h - ditchDepthAt(x, z);
}

// Segments per world unit across the lawn. The dome's slope is gentle, so
// this only has to be fine enough that the silhouette doesn't facet.
// Raised from 120 (1 m per segment) once the drainage swale went in: a
// 3.2 m ditch only spanned three segments at the old density and came out
// as a hard crease, and grass/trees sampling terrainHeight showed the
// ditch long before the lawn mesh did.
const LAWN_SIZE = 120;
const LAWN_SEGMENTS = 200;

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
      // The grass is a hand-written shader, so it gets none of Three's
      // lighting for free — it has to be told what time of day it is. These
      // are driven from applyDayNight, exactly like the fog uniforms.
      uLightDir: { value: new THREE.Vector3(0.45, 0.75, 0.35).normalize() },
      uLightColor: { value: new THREE.Color(1, 1, 1) },
      uBackScatter: { value: 1 },
      // The fire, as a point light the shader has to apply by hand. Three's
      // PointLight lights every other material in the scene for free but
      // can't touch this one, so without it the pit sat in a pool of black
      // turf while its own stones were glowing.
      uFirePos: { value: new THREE.Vector3(0, -999, 0) },
      uFireColor: { value: new THREE.Color(0xff8a3d) },
      uFireIntensity: { value: 0 },
      uFireRange: { value: 6.5 },
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
      uniform vec3 uLightDir;
      uniform vec3 uLightColor;
      uniform float uBackScatter;
      uniform vec3 uFirePos;
      uniform vec3 uFireColor;
      uniform float uFireIntensity;
      uniform float uFireRange;

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

        vec3 lightDir = normalize(uLightDir);
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
        // Scaled down at night — sunlight coming *through* a blade is a
        // daylight effect, and at full strength under a moon it lit the
        // lawn from the inside like it was radioactive.
        color += vec3(0.45, 0.80, 0.28) * back * (1.0 - ndl) * vHeightT * 0.75 * uBackScatter;

        color += tipWarm * pow(vHeightT, 4.0) * 0.16 * ndl;
        color *= 0.85 + vRandom * 0.3;

        // The whole reason the lawn glowed after dark: every term above is
        // baked daylight, so without this the grass stayed at noon while the
        // rest of the scene went dark around it.
        color *= uLightColor;

        // Firelight, added *after* the day/night tint rather than before —
        // the fire is its own source, so it shouldn't be dimmed by how dark
        // the night is. Quadratic falloff, and blades facing the fire catch
        // more of it, which is what makes the pool of light read as coming
        // from a point rather than being a flat disc painted on the lawn.
        if (uFireIntensity > 0.001) {
          vec3 toFire = uFirePos - vWorldPos;
          float fireDist = length(toFire);
          float atten = clamp(1.0 - fireDist / uFireRange, 0.0, 1.0);
          atten *= atten;
          float faceFire = max(dot(N, normalize(toFire)), 0.0) * 0.65 + 0.35;
          color += uFireColor * atten * faceFire * uFireIntensity;
        }

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

// Sun or moon direction, and the tint/intensity the grass is lit at. Called
// from applyDayNight next to setGrassFog.
export function setGrassLight(direction, color, backScatter) {
  grassMaterials.forEach((m) => {
    m.uniforms.uLightDir.value.copy(direction).normalize();
    m.uniforms.uLightColor.value.set(color);
    m.uniforms.uBackScatter.value = backScatter;
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
  house.position.set(0, terrainHeight(0, HOUSE_Z), HOUSE_Z);
  group.add(house);
  // Handed up so main.js's day/night toggle can switch the porch and garage
  // lamps on after dark (see createHouse).
  group.userData.nightLights = house.userData.nightLights;

  // "FORT DARLA" — staked in the front lawn beside the walk rather than
  // hung on the house, and clear of the walk's outer edge so it reads as
  // planted in grass. The board's default orientation faces back toward the
  // house, hence the flip to greet someone coming up from the street.
  const fortSign = buildYardSign('FORT DARLA');
  fortSign.position.set(-8.5, terrainHeight(-8.5, -18), -18);
  fortSign.rotation.y = Math.PI + 0.3;
  group.add(fortSign);

  // Trees are streamed in as chunks (see createTreeChunk / CHUNK_SIZE),
  // managed from main.js based on Darla's position, not added here.

  const firePit = createFirePit();
  firePit.position.set(-1, terrainHeight(-1, 5), 5);
  group.add(firePit);
  group.userData.firePit = firePit;

  // Out over the backyard clearing, and only after dark.
  const dragonflies = createDragonflies();
  group.add(dragonflies);
  group.userData.dragonflies = dragonflies;

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

  // Both pines stand right at the road, one either side of the apron,
  // which is how the photos read: you see the frontage framed between two
  // trunks with the drive opening out between them. z is set just uphill
  // of the swale (which now spans z -37.9 to -33.1) rather than in it —
  // real trees sit on the crown of the lawn, not down in the drainage.
  //
  // These two are the only createSouthernPine in the world (see pine.js).
  // Everything else is the cheap cone tree, which is fine out among the
  // forest but was never going to pass for these at ten metres.
  const pineRand = mulberry32(20260727);
  const leftTree = createSouthernPine(pineRand, {
    height: 6,
    spread: 0.2,
    trunkRadius: 0.33,
  });
  leftTree.position.set(-3.4, terrainHeight(-3.4, -32), -32);
  group.add(leftTree);

  const rightTree = createSouthernPine(pineRand, {
    height: 6.6,
    spread: 0.175,
    trunkRadius: 0.36,
    // The taller of the two carries its crown a little higher, which is
    // what separates them in the photos.
    crownBase: 0.6,
  });
  rightTree.position.set(9.6, terrainHeight(9.6, -32), -32);
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
