import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { createPalm } from './palm.js';
import {
  createSouthernPine,
  buildSouthernPineParts,
  createPineBarkMaterial,
  createNeedleAssets,
  composeTuftMatrix,
  taperedTube,
} from './pine.js';
import { buildBroadleafParts, createLeafAssets } from './broadleaf.js';
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

const barkTextures = loadBarkTextures();
const TRUNK_MAT = new THREE.MeshStandardMaterial({
  map: barkTextures.map,
  normalMap: barkTextures.normalMap,
  roughnessMap: barkTextures.roughnessMap,
  roughness: 1,
});

// ── the forest's trees ─────────────────────────────────────────────────
//
// Real limb geometry, from the same builders as the two hero pines at the
// road (pine.js) and their deciduous counterpart (broadleaf.js). What used
// to be here was a cylinder wearing four spheres, or a stack of cones.
//
// The thing that makes this affordable is that no tree in the forest is
// generated. A dozen or so are built once, up front, and every tree in the
// world is one of those stamped in with its own position, rotation and
// scale. Generating each one for real is roughly 8ms of curve and Frenet
// frame maths, which at ~700 trees would be about six seconds — as much
// again as the entire rest of the load (see notes/load-times.md).
//
// The repetition doesn't read, and the reason it doesn't is worth writing
// down, because "just reuse a few models" sounds like it obviously should:
// each stamp gets a free yaw, a non-uniform scale and its own foliage tint,
// and a tree is a silhouette rather than a face — you cannot spot two
// matching silhouettes at forest density the way you'd instantly spot two
// identical houses.
//
// Everything else about the cost follows from stamping. All the wood in a
// chunk merges into one mesh per bark material, and all the foliage becomes
// one InstancedMesh per kind, so a chunk of forty real trees is four draw
// calls — where forty separate Groups of limbs and clusters would have been
// several hundred.
const BROADLEAF_TEMPLATES = 10;
const PINE_TEMPLATES = 4;

// Deliberately small — this is a yard, and the two hero pines out front are
// only about 5 m. The old forest trees topped out around 3.5 m, which is
// shoulder height on a real tree line and part of why the woods read as
// scenery rather than as woods.
const FOREST_TREE_HEIGHT = { min: 4.6, max: 8.2 };

// Built on first use rather than at module load: yard.js is imported for
// terrainHeight and friends by code that never builds a forest, and a
// couple of hundred milliseconds of curve maths shouldn't happen just
// because someone imported the module.
let treeTemplates = null;

function getTreeTemplates() {
  if (treeTemplates) return treeTemplates;
  // Fixed seed, so the world's dozen tree shapes are the same every load —
  // same reason the chunks themselves are seeded.
  const rand = mulberry32(0x7ee5eed);
  const lerpHeight = () =>
    FOREST_TREE_HEIGHT.min + rand() * (FOREST_TREE_HEIGHT.max - FOREST_TREE_HEIGHT.min);

  const broadleaf = [];
  for (let i = 0; i < BROADLEAF_TEMPLATES; i++) {
    broadleaf.push(
      buildBroadleafParts(rand, {
        height: lerpHeight(),
        // A couple of multi-stemmed ones in the mix. The three trees on the
        // left of the owner's photo are crepe myrtles, which are never
        // single-trunked, and a stand where every tree has exactly one stem
        // is the sort of wrong you notice without being able to say why.
        stems: i < 3 ? 2 + (i % 2) : 1,
        // Crowded trees are drawn up narrow, open-grown ones spread. Mixing
        // both is what stops the canopy reading as one repeated blob.
        spread: 0.3 + rand() * 0.22,
        density: 0.85,
      })
    );
  }

  const pine = [];
  for (let i = 0; i < PINE_TEMPLATES; i++) {
    pine.push(
      buildSouthernPineParts(rand, {
        height: lerpHeight() * 1.05,
        trunkRadius: 0.2 + rand() * 0.1,
        spread: 0.26 + rand() * 0.1,
        whorls: 8,
        // A forest pine carries about a third of a hero pine's twigs and
        // needle clusters. Pines were coming out at four times a
        // broadleaf's triangle count for 30% of the trees, which is the
        // wrong way round — a whorled conifer has far more limbs than a
        // recursive broadleaf of the same size, so it needs more cutting,
        // not less.
        density: 0.38,
        detail: 0.5,
      })
    );
  }

  const leafRand = mulberry32(0x1eaf00);
  treeTemplates = {
    broadleaf,
    pine,
    barkMat: TRUNK_MAT,
    pineBarkMat: createPineBarkMaterial(mulberry32(0xba4c)),
    leaves: createLeafAssets(leafRand),
    needles: createNeedleAssets(mulberry32(0x0ee01e)),
  };
  return treeTemplates;
}

// The spread of greens a single tree's foliage gets tinted to. Applied per
// tree through instanceColor, so neighbours differ — one flat green across
// a whole wood is the other half of why the old canopies read as plastic.
const FOLIAGE_TINTS = [0x8fae74, 0x7f9e66, 0xa2bb84, 0x6f8f5c, 0x93a86e, 0x86a56f].map(
  (hex) => new THREE.Color(hex)
);

const UP_AXIS = new THREE.Vector3(0, 1, 0);

// Collapses one kind's worth of stamped trees into two objects: every
// trunk, limb and twig in the chunk as a single merged mesh, and every
// foliage cluster as a single InstancedMesh.
function addTreeMeshes(group, woodGeos, tufts, barkMat, foliageAssets) {
  if (!woodGeos.length) return;

  const trees = mesh(mergeGeometries(woodGeos), barkMat);
  group.add(trees);
  // The clones were only ever a staging buffer for the merge; without this
  // the world holds a second full copy of every tree's geometry on the GPU.
  woodGeos.forEach((geo) => geo.dispose());

  if (!tufts.length) return;
  const instances = new THREE.InstancedMesh(
    foliageAssets.geometry,
    foliageAssets.material,
    tufts.length
  );
  for (let i = 0; i < tufts.length; i++) {
    instances.setMatrixAt(i, tufts[i].matrix);
    instances.setColorAt(i, tufts[i].tint);
  }
  instances.instanceMatrix.needsUpdate = true;
  if (instances.instanceColor) instances.instanceColor.needsUpdate = true;
  instances.castShadow = true;
  instances.receiveShadow = true;
  // Same reason as the pine's: without a depth material that honours
  // alphaTest, the shadow pass throws the shadow of a solid box per
  // cluster and the dappled shade under the canopy turns into dark slabs.
  instances.customDepthMaterial = foliageAssets.depthMaterial;
  group.add(instances);
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
// The frontage is wider than the rest. At a flat -13 the forest wall came
// right up beside the front pines and read as woods growing into the lawn,
// where both the satellite and the photo from the driveway show open mown
// grass running out to the road on that side. It widens over 8 m rather than
// stepping, or the tree line ends on a dead straight edge you can see.
// Both flanks widened again after an overhead pass: at 13 either side the
// clearing was barely 11 m wider than the house itself, so the forest crowded
// right up against both long walls — a band of it along the west side and a
// stray on the east. The satellite has the tree line well back from the
// building on both sides.
const OPEN_X_MAX = 16;
const OPEN_X_NARROW = -19;
const OPEN_X_WIDE = -21;
// Hoisted out of inOpenArea so the tree line below can measure distance to
// the same boundary the clearing is actually cut from, rather than against
// a second copy of these numbers that would drift the first time one moved.
const OPEN_Z_MIN = -48;
const OPEN_Z_MAX = 18;
const openXMin = (z) => {
  const t = Math.min(1, Math.max(0, (-18 - z) / 8));
  return OPEN_X_NARROW + (OPEN_X_WIDE - OPEN_X_NARROW) * smootherstep(t);
};

const inOpenArea = (x, z) =>
  x > openXMin(z) && x < OPEN_X_MAX && z > OPEN_Z_MIN && z < OPEN_Z_MAX;

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

// The built pit's actual dimensions, hoisted out of createFirePit so the
// numbers the rest of the game collides and stands on come from the same place
// as the blocks themselves, rather than being copied and left to drift.
const PIT_RING_RADIUS = 0.55;
const PIT_BLOCK_DEPTH = 0.13;
const PIT_COURSES = 3;
const PIT_COURSE_HEIGHT = 0.115;

// Matches firePit's own placement in createYard() below — kept separate so
// grass (createChunkGrass) can skip it without needing the actual fire pit
// object to exist yet.
// Where the hammock hangs, and how big a footprint it blocks.
//
// Hoisted out of createYard so main.js's collision reads the same numbers
// the geometry is built from. It's an *oriented* box rather than an
// axis-aligned one — the thing is 3.4 m long, 0.75 m wide and turned 0.4
// radians, so a box lined up with the world axes would either be far too
// big or miss the ends entirely.
//
// Half-extents are the fabric plus a little: `halfLength` covers the span
// between the two trees, `halfWidth` the fabric's width. Generous across
// rather than tight, since brushing past the side of a hammock and
// clipping through it looks worse than stopping slightly short.
export const HAMMOCK = {
  x: 6,
  z: 9,
  rotation: 0.4,
  halfLength: 1.6,
  halfWidth: 0.5,
};

export const FIRE_PIT = {
  // Sits well out from the house, toward the tree line rather than tucked up
  // against the back wall. It was 6.5 m off the wall after the house moved
  // back; at 11.7 m it reads as a fire pit you walk out to.
  x: -0.7,
  z: 10.2,
  // Generous compared to the stonework, because this is also what clears grass
  // away around the pit.
  radius: 0.7,
  // The outer face of the ring, and how far its top course stands above the
  // ground it's built on — between them, the surface you land on if you jump
  // onto it. See groundHeightAt in main.js.
  rimRadius: PIT_RING_RADIUS + PIT_BLOCK_DEPTH / 2,
  rimHeight: PIT_COURSES * PIT_COURSE_HEIGHT,
};
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

// ── the tree line ──────────────────────────────────────────────────────
//
// What reads as "woods" in the owner's photo of the real yard isn't the
// trees. It's that there is no visible ground behind the mown edge: a
// solid understory of privet, vine and brush fills the first two or three
// metres, and past that first metre the inside of the wood goes nearly
// black. The trees are what you see *above* that mass — they are not what
// closes the sightline.
//
// What this file had was the opposite: well-spaced trunks standing on
// lawn, grass running underneath them, and clear sky between every one of
// them out to the fog. Adding more createTree wouldn't have fixed it,
// because a trunk is mostly empty space at eye level and stacking them
// only makes a denser colonnade.
//
// So the brush is its own layer, separate from the trees and drawn from
// its own PRNG (see createTreeChunk) so that adding it doesn't reshuffle
// a forest and a lawn that were already placed. Darla's eye is about a
// foot off the ground, which is the one break the geometry gets here: the
// band doesn't have to be tall to be opaque, it has to have no gap
// underneath.

// How deep the band runs, measured out from the clearing edge. Deep enough
// that a gap in the front row is backed by two or three more behind it —
// one row of anything, however tight, still shows daylight at some angle.
const BRUSH_DEPTH = 4.2;
// How far the inner edge wanders in and out of that line. The clearing is
// a box (see inOpenArea); brush planted straight along it would end on the
// same visible straight edge the trees do and read as a clipped hedge. The
// real line has bays several metres deep and points that jut out into the
// mown grass — and it's the negative half of this range, the brush growing
// *inside* the clearing, that does most of that work.
const BRUSH_BAY = 2.2;
// Tighter than it looks, because clumps are ~1 m across and overlap by
// design. This is the number that decides whether the band is opaque, and
// it's the one to pull if it isn't. Pulled from 1.15 when the sphere blobs
// were replaced with leaf clusters — the spheres were solid by
// construction and leaf cards are not, so the same layout stopped being
// enough on its own.
const BRUSH_SPACING = 1.0;
// Raised from 1.5: at that floor the shortest runs of the band topped out
// right where a 1.5 m sightline runs, and you could see over them (5 holes
// in 240 rays at that height, against 1 at Darla's own eye level).
const BRUSH_MIN_HEIGHT = 1.9;
const BRUSH_MAX_HEIGHT = 3.1;

// How far outside the clearing a point is, in metres: negative inside, 0 on
// the boundary, growing into the woods. Ordinary exterior box distance,
// except the west edge isn't straight so it comes from openXMin(z).
function woodsDepth(x, z) {
  const dx = Math.max(openXMin(z) - x, x - OPEN_X_MAX);
  const dz = Math.max(OPEN_Z_MIN - z, z - OPEN_Z_MAX);
  return Math.hypot(Math.max(dx, 0), Math.max(dz, 0)) + Math.min(Math.max(dx, dz), 0);
}

// The wander applied to that boundary. Two octaves rather than one: a
// single octave gives a smooth rolling edge that still reads as drawn,
// where the broad-plus-ragged pair gives bays with a fringe on them.
function brushEdge(x, z) {
  const broad = valueNoise(x / 11 + 61.3, z / 11 - 24.8);
  const fine = valueNoise(x / 3.4 - 12.7, z / 3.4 + 88.1);
  return (broad * 0.7 + fine * 0.3 - 0.5) * 2 * BRUSH_BAY;
}

// Height varies as a field, not per clump. Rolled independently each clump
// it comes out as even static at 2 m; as a field the line has genuinely
// tall thickets and lower runs between them, which is what the photo has.
function brushHeight(x, z) {
  const n = valueNoise(x / 9.5 - 40.2, z / 9.5 + 17.6);
  return BRUSH_MIN_HEIGHT + n * (BRUSH_MAX_HEIGHT - BRUSH_MIN_HEIGHT);
}

// Deliberately darker and less yellow than FOLIAGE_TINTS. Canopy foliage is
// lit from above and this isn't — understory sits under everything else.
const BRUSH_TINTS = [0x5c7a4a, 0x4e6b40, 0x678451, 0x445c38, 0x5a7346].map(
  (hex) => new THREE.Color(hex)
);

// Brush stems are the same photographed bark as everything else, knocked
// well down. They're 2-3 cm thick and mostly buried in leaves, but a
// full-brightness twig showing through the dark interior of a thicket is
// exactly the sort of thing the eye picks out.
const BRUSH_STEM_MAT = new THREE.MeshStandardMaterial({
  map: barkTextures.map,
  color: 0x7c7060,
  roughness: 1,
});

// The understory's own leaf cluster: smaller leaves, half as many again,
// and more twigs than the canopy's. See makeLeafClusterTexture — the
// canopy's job is to be see-through and this one's job is the opposite.
let brushLeaves = null;
function getBrushLeaves() {
  if (!brushLeaves) {
    // These numbers are a measurement, not a taste call. A leaf card is
    // mostly empty space, so what decides whether the band is opaque is how
    // much of one card is solid at alphaTest times how many cards a
    // sightline crosses. At the canopy's settings a card was 24% solid and
    // an eye-height ray crossed twelve of them, which leaves 0.76^12 — an
    // 18% chance of seeing clean through. These take one card to ~45%.
    brushLeaves = createLeafAssets(mulberry32(0xb0075), {
      leafCount: 130,
      leafScale: 0.92,
      stemCount: 16,
    });
  }
  return brushLeaves;
}

// One thicket: a handful of thin stems arching up and out from a common
// root, with leaf clusters strung along them.
//
// This replaced a stack of squashed spheres. The spheres were opaque and
// cheap and that was the whole of their case — they read as exactly what
// they were, which is the same complaint the old trees had, and standing
// them next to rebuilt trees made it obvious. Privet and vine tangle isn't
// a mass with a surface; it's a thousand small leaves at every depth, and
// the only honest way to get that is to put a thousand small leaves there.
function addBrushClump(stemGeos, clusters, x, z, groundY, shade, rand) {
  const clumpHeight = brushHeight(x, z) * (0.85 + rand() * 0.3);
  const stems = 3 + Math.floor(rand() * 4);
  const tint = BRUSH_TINTS[Math.floor(rand() * BRUSH_TINTS.length)]
    .clone()
    .multiplyScalar(shade);

  for (let s = 0; s < stems; s++) {
    const az = rand() * Math.PI * 2;
    // Off vertical. Brush stems lean out hard — that's what makes a thicket
    // wider than it is tall and lets neighbouring clumps interlock instead
    // of standing as separate bushes with gaps between them.
    const lean = 0.3 + rand() * 0.55;
    const len = clumpHeight * (0.85 + rand() * 0.45);
    const bx = x + (rand() - 0.5) * 0.35;
    const bz = z + (rand() - 0.5) * 0.35;

    const segs = 3;
    const pts = [];
    for (let i = 0; i <= segs; i++) {
      const t = i / segs;
      // Reaches out faster than it climbs, and the tip nods over — an
      // arching cane, not a straight rod planted at an angle.
      const out = Math.sin(lean) * len * t ** 1.35;
      const up = Math.cos(lean) * len * t - len * 0.14 * t * t;
      pts.push(
        new THREE.Vector3(bx + Math.cos(az) * out, groundY + up, bz + Math.sin(az) * out)
      );
    }
    const curve = new THREE.CatmullRomCurve3(pts);
    const r = 0.016 + rand() * 0.016;
    stemGeos.push(taperedTube(curve, r, r * 0.4, segs, 4));

    const perStem = 3 + Math.floor(rand() * 3);
    for (let i = 0; i < perStem; i++) {
      // From very low on the cane, not just the outer end. Daylight
      // underneath the band is the one gap that matters — Darla's eye is
      // about a foot off the ground.
      const t = 0.1 + rand() * 0.9;
      clusters.push({
        matrix: composeTuftMatrix(new THREE.Matrix4(), {
          pos: curve.getPointAt(t),
          dir: curve.getTangentAt(t),
          size: 0.34 + rand() * 0.26,
          roll: rand() * Math.PI * 2,
        }),
        tint,
      });
    }
  }

  // A skirt of foliage around the base, placed on the ground rather than
  // strung on a cane. The canes all converge at the root and arch away
  // upward, so foliage hung along them is at its thinnest exactly where
  // they meet the ground — a sightline at 0.3 m crossed twelve leaf cards
  // where one at 0.8 m crossed twenty. That's the one height that has to be
  // solid, because it's the height Darla's eye is at.
  const skirt = 3 + Math.floor(rand() * 3);
  for (let i = 0; i < skirt; i++) {
    const a = rand() * Math.PI * 2;
    const radius = rand() * 0.55;
    clusters.push({
      matrix: composeTuftMatrix(new THREE.Matrix4(), {
        pos: new THREE.Vector3(
          x + Math.cos(a) * radius,
          groundY + 0.02 + rand() * 0.2,
          z + Math.sin(a) * radius
        ),
        // Splayed out and up, the way low growth reaches out from under a
        // thicket rather than standing straight up inside it.
        dir: new THREE.Vector3(
          Math.cos(a) * 0.75,
          0.5 + rand() * 0.6,
          Math.sin(a) * 0.75
        ).normalize(),
        size: 0.34 + rand() * 0.26,
        roll: rand() * Math.PI * 2,
      }),
      tint,
    });
  }
}

function createChunkBrush(cx, cz, rand) {
  const originX = cx * CHUNK_SIZE;
  const originZ = cz * CHUNK_SIZE;

  // Cheap early-out for the chunks that can't touch the band at all, which
  // is most of them — the band is a ring a few metres wide and the world is
  // a disc. woodsDepth is a distance, so it can't change by more than
  // roughly the distance travelled; a chunk's centre being further from the
  // band than the chunk's own half-diagonal (~12.7, rounded up to 16 for
  // the west edge's slope) means no point in it can reach.
  const centerDepth = woodsDepth(originX + CHUNK_SIZE / 2, originZ + CHUNK_SIZE / 2);
  if (Math.abs(centerDepth) > BRUSH_DEPTH + BRUSH_BAY + 16) return null;

  const stemGeos = [];
  const clusters = [];
  for (let lx = 0; lx < CHUNK_SIZE; lx += BRUSH_SPACING) {
    for (let lz = 0; lz < CHUNK_SIZE; lz += BRUSH_SPACING) {
      const x = originX + lx + (rand() - 0.5) * BRUSH_SPACING * 0.8;
      const z = originZ + lz + (rand() - 0.5) * BRUSH_SPACING * 0.8;
      const depth = woodsDepth(x, z) - brushEdge(x, z);
      if (depth < 0 || depth > BRUSH_DEPTH) continue;
      // The road punches straight through the wall rather than being
      // walled off at the property line — it's a county road that carries
      // on into the woods both ways, and a hole it disappears into reads
      // better than pavement ending against a hedge.
      if (inRoad(x, z) || inHouse(x, z)) continue;
      // The stream cuts a gap through the band where it crosses.
      //
      // This is what makes the pond findable at all. The brush is
      // deliberately opaque — about 1% see-through at a dog's eye height —
      // so anything behind it is hidden permanently unless something opens
      // a way in. The gap is only about a metre and a half wide and it
      // isn't visible from the middle of the lawn, which is the balance
      // being struck: hidden, but there for someone poking along the far
      // corner.
      if (nearWater(x, z, 1.5)) continue;

      const shade = 1 - 0.6 * smootherstep(depth / BRUSH_DEPTH);
      addBrushClump(stemGeos, clusters, x, z, terrainHeight(x, z), shade, rand);
    }
  }

  if (!stemGeos.length) return null;
  const group = new THREE.Group();
  addTreeMeshes(group, stemGeos, clusters, BRUSH_STEM_MAT, getBrushLeaves());
  return group;
}

export function createTreeChunk(cx, cz) {
  const group = new THREE.Group();
  const seed = (cx * 374761393 + cz * 668265263) ^ 0x9e3779b9;
  const rand = mulberry32(seed);
  const originX = cx * CHUNK_SIZE;
  const originZ = cz * CHUNK_SIZE;

  const templates = getTreeTemplates();
  // One bucket of wood geometry and one list of foliage placements per
  // kind, filled by the loop and collapsed into four objects at the end.
  const wood = { broadleaf: [], pine: [] };
  const foliage = { broadleaf: [], pine: [] };
  const stamp = new THREE.Matrix4();
  const tuftMatrix = new THREE.Matrix4();
  const quat = new THREE.Quaternion();
  const pos = new THREE.Vector3();
  const scl = new THREE.Vector3();

  for (let lx = 0; lx < CHUNK_SIZE; lx += TREE_SPACING) {
    for (let lz = 0; lz < CHUNK_SIZE; lz += TREE_SPACING) {
      const x = originX + lx + (rand() - 0.5) * TREE_SPACING * 0.8;
      const z = originZ + lz + (rand() - 0.5) * TREE_SPACING * 0.8;
      if (inOpenArea(x, z) || inHouse(x, z) || inRoad(x, z)) continue;
      // Nothing grows in the water, and nothing stands in the glade — the
      // opening over the pond has to be a real gap in the canopy, or
      // lighting the ground there (see canopyShade) is just a bright patch
      // under a closed roof of leaves.
      if (nearWater(x, z, 1.2)) continue;
      if (Math.hypot(x - POND.x, z - POND.z) < GLADE_RADIUS * 0.8) continue;
      if (rand() < 0.1) continue; // thin out a bit so it reads as a forest, not a wall

      const kind = rand() < 0.3 ? 'pine' : 'broadleaf';
      const pool = templates[kind];
      const template = pool[Math.floor(rand() * pool.length)];

      // Non-uniform on purpose: scaling height and girth together means two
      // stamps of the same template are the same tree at two distances, and
      // the eye reads that. Squashing one and stretching another gives two
      // trees, from the same 40 KB of geometry.
      const s = 0.78 + rand() * 0.5;
      pos.set(x, terrainHeight(x, z), z);
      quat.setFromAxisAngle(UP_AXIS, rand() * Math.PI * 2);
      scl.set(s * (0.88 + rand() * 0.26), s, s * (0.88 + rand() * 0.26));
      stamp.compose(pos, quat, scl);

      wood[kind].push(template.wood.clone().applyMatrix4(stamp));

      const tint = FOLIAGE_TINTS[Math.floor(rand() * FOLIAGE_TINTS.length)];
      for (const tuft of template.tufts) {
        composeTuftMatrix(tuftMatrix, tuft).premultiply(stamp);
        foliage[kind].push({ matrix: tuftMatrix.clone(), tint });
      }
    }
  }

  addTreeMeshes(group, wood.broadleaf, foliage.broadleaf, templates.barkMat, templates.leaves);
  addTreeMeshes(group, wood.pine, foliage.pine, templates.pineBarkMat, templates.needles);

  // Its own stream, not the chunk's shared `rand`. Drawing brush from that
  // one would shift every subsequent draw and re-roll the entire forest and
  // lawn — deterministic still, but a different world than the one that was
  // tuned.
  const brush = createChunkBrush(cx, cz, mulberry32(seed ^ 0x5bf03635));
  if (brush) group.add(brush);

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
  const ringRadius = PIT_RING_RADIUS;
  const blocksPerCourse = 13;
  const courses = PIT_COURSES;
  const courseHeight = PIT_COURSE_HEIGHT;
  const blockDepth = PIT_BLOCK_DEPTH;
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

// The hammock's two trees. Same builder as the forest's broadleaves, but
// these get built for real rather than stamped from a template — there are
// two of them, they stand in the middle of the yard where they're looked at
// closely, and the hammock has to attach at a known point.
//
// `forkAt` is what pins that point: the trunk hands over to its leaders at
// height * forkAt, so working backwards from the 1.1 m the fabric wants
// fixes the tree's overall height. That's why the number is derived here
// instead of picked.
const HAMMOCK_ATTACH_HEIGHT = 1.1;
// Sets the tree's overall height, since the fork has to land at hammock
// height: 1.1 / 0.25 is a 4.4 m tree.
//
// Do not "fix" the camera starting inside these by lowering this. It looks
// like it should work — a lower fork means a taller tree — and it does the
// opposite, because the crown runs from the fork to the top. At 0.25 the
// crown is 1.1 m to 4.4 m and the 4.5 m spawn camera clears it by a
// whisker; at 0.16 it's 1.1 m to 6.9 m and the camera is squarely inside
// it. Tried, measured, reverted.
const HAMMOCK_FORK_AT = 0.25;

function createHammockTree() {
  const group = new THREE.Group();
  const templates = getTreeTemplates();
  const rand = mulberry32(0x4a3b17 + Math.floor(Math.random() * 1e6));
  const parts = buildBroadleafParts(rand, {
    height: HAMMOCK_ATTACH_HEIGHT / HAMMOCK_FORK_AT,
    forkAt: HAMMOCK_FORK_AT,
    // Open-grown, so it spreads — these stand alone on mown lawn rather
    // than being drawn up narrow by a stand around them.
    spread: 0.52,
  });

  const wood = mesh(parts.wood, templates.barkMat);
  group.add(wood);

  const instances = new THREE.InstancedMesh(
    templates.leaves.geometry,
    templates.leaves.material,
    parts.tufts.length
  );
  const m = new THREE.Matrix4();
  const tint = FOLIAGE_TINTS[Math.floor(Math.random() * FOLIAGE_TINTS.length)];
  parts.tufts.forEach((tuft, i) => {
    instances.setMatrixAt(i, composeTuftMatrix(m, tuft));
    instances.setColorAt(i, tint);
  });
  instances.instanceMatrix.needsUpdate = true;
  if (instances.instanceColor) instances.instanceColor.needsUpdate = true;
  instances.castShadow = true;
  instances.customDepthMaterial = templates.leaves.depthMaterial;
  group.add(instances);

  group.userData.trunkHeight = HAMMOCK_ATTACH_HEIGHT;
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
// Widened again to 33 once the house moved back off the road (HOUSE_Z), which
// carried the pad's centre back with it and left the road a metre and a bit
// down the hill. The owner's photo from the driveway shows the opposite: the
// road runs level with the yard, and what relief there is comes from the
// drainage swale, not from the lawn falling away to the kerb. 33 puts the road
// (34.3 m out from the pad's centre) right at the edge of the flat, so the
// frontage reads level and the dome only starts dropping out among the trees.
const TERRAIN_PAD = 33;
// Raised with it, or the 10 m of falloff left between pad and radius turns
// the yard into a plateau with a cliff around the rim.
const TERRAIN_RADIUS = 52;

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

// The ground before the water cuts into it.
//
// Split out from terrainHeight so the pond can work out how deep to dig
// without asking a question that depends on its own answer — waterCarveAt
// needs to know what the hillside would have been.
function groundBeforeWater(x, z) {
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

export function terrainHeight(x, z) {
  return groundBeforeWater(x, z) - waterCarveAt(x, z);
}

// ── the spring, the stream and the pond ────────────────────────────────
//
// A hidden thing in the far corner: a spring rising just behind the tree
// line, a stream running down the slope from it, and a pond in the hollow
// at the bottom. Nothing points at it. You find the water and follow it.
//
// **The terrain decided the shape of this.** The idea was originally a
// stream leading *down* to a pond, then — on a wrong reading of
// terrainHeight — a spring on high ground with the stream running away
// from it. Measuring the actual ground settled it: the corner is not the
// high end of the lot at all. The graded pad is dead flat out to
// TERRAIN_PAD and the dome falls away past it, so this corner sits about
// 1.7 m *below* the yard, dropping from 2.40 at the tree line to 0.70 at
// the hollow over roughly nineteen metres. Water runs downhill into the
// corner, which is the original idea, and the spring is simply where it
// surfaces at the top of that slope. Both halves survive; the hillside
// just told us which way round they go.
//
// Everything here is driven off two shapes — a polyline for the stream and
// a disc for the pond — and every other system reads them: the ground digs
// itself a channel, the grass and trees and brush stay out of the water,
// and the brush band opens a gap where the stream crosses it.

// The pond, out near the corner of the world, and irregular rather than a
// disc. `radius` is the mean; the real edge wobbles around it (see
// pondEdgeRadius).
const POND = { x: 34, z: 38, radius: 5.6 };
// Mean radii. Everything that used to be a single circle is now a *scale*
// applied to the wobbling edge, so the dish, the rim and the feather all
// keep the same irregular outline instead of a lumpy pond inside a round
// hole.
//
// POND_DISC is the water surface. POND_BED is where the dish's wall comes
// back up to its rim — deliberately wider, so the water's edge is a
// comfortable 12 cm underwater rather than sitting exactly on the lip. Cut
// the dish to end at the disc instead and the rim is at water level all
// the way round, which measured as the pond standing 5 cm proud of its own
// bank: water with nothing holding it.
const POND_DISC = 1.0;
const POND_BED = 1.16;
const POND_CARVE = 2.0;
// How far down the bed goes below the water at the middle of the pond.
const POND_DEPTH = 1.15;

// The pond's outline: mean radius modulated by two harmonics of the
// bearing. Real ponds are lobed — a couple of broad bays and a headland or
// two — which is three or four cycles round the compass, not the fine
// crinkle that a high-frequency noise would give. Two harmonics at 3 and 5
// cycles, out of phase, produce exactly that and cost nothing to evaluate
// (this runs per grass blade via terrainHeight).
function pondEdgeRadius(dx, dz) {
  const a = Math.atan2(dz, dx);
  return POND.radius * (1 + 0.19 * Math.sin(a * 3 + 0.7) + 0.11 * Math.sin(a * 5 - 1.9));
}

// The stream, from the spring behind the tree line all the way to the
// pond — now with a waterfall partway down.
//
// `fall` marks the two points the drop happens between. The ground between
// them is cut into a ravine (see ravineDrop) and the visible cliff is rock
// geometry standing on it, because the lawn mesh is 0.6 m per quad and a
// terrain cliff at that resolution is a staircase, not a cliff.
const STREAM_PATH = [
  [18.5, 21.5],
  [21, 25],
  [23.5, 28],
  [25.5, 30.5],
  // Lip of the fall.
  [27.2, 32.4],
  // Foot of the fall — a short run in plan for a long drop in height,
  // which is what makes it a fall rather than a rapid.
  [28.6, 33.8],
  [30.5, 35.4],
  [32.4, 36.8],
  // Stops at the pond's edge rather than its middle. Run to the centre and
  // the ribbon dives the full depth of the dish and lies on the bottom,
  // visible through the water; ending just inside the surface reads as the
  // stream running in.
  [33.2, 37.2],
];
// Which STREAM_PATH indices bracket the fall.
const FALL_FROM = 4;
const FALL_TO = 5;
const STREAM_HALF = 0.6;
const STREAM_DEPTH = 0.26;
// The opening in the canopy over the pond. Trees are kept out of the inner
// part of it and the ground is let back into full daylight (see
// canopyShade) — a pond under a closed canopy is a dark puddle, and the
// whole point of this one is that it's the pretty thing at the end.
const GLADE_RADIUS = 9.5;

// Everything water-related lives inside this box. terrainHeight runs for
// every blade of grass in the world — several million times a load — so
// the very first thing waterCarveAt does is reject the ~99% of the map
// that is nowhere near the pond, before any real work.
const WATER_BOUNDS = { x0: 15, x1: 45, z0: 18, z1: 48 };

// How deep the ravine below the fall is cut, how quickly it opens at the
// lip, and how far the valley spreads either side of the water.
//
// 4.4 m is a real drop — the yard sits at 2.4 and the corner of the map is
// already down near 0.2, so this puts the pond well below sea level of the
// lawn and makes the fall something you look *down* into.
const RAVINE_DEPTH = 4.4;
// Fraction of the post-lip run over which the drop happens. Small, because
// this is a waterfall; but not zero, because the lawn mesh is 0.6 m per
// quad and a true step would be a staircase.
const RAVINE_LIP = 0.12;
const RAVINE_REACH = 7.0;

// The shaped valley: natural ground with the ravine cut out of it, but
// before the pond digs its basin.
//
// This is the surface the pond is built against, and keeping it separate
// from groundBeforeWater is what stops the two digs fighting. Both this
// and the pond need to know "what is the ground here" and they need
// different answers — the ravine asks the hillside, the pond asks the
// ravine.
function groundWithRavine(x, z) {
  return groundBeforeWater(x, z) - ravineDrop(x, z);
}

// Where along the stream a point lies, 0 at the spring and 1 at the pond,
// or null if it's not near the stream at all. Used by the ravine, which
// has to know which side of the fall's lip a point is on.
function streamProgress(x, z) {
  let best = Infinity;
  let bestAt = null;
  const segs = STREAM_PATH.length - 1;
  for (let i = 0; i < segs; i++) {
    const [ax, az] = STREAM_PATH[i];
    const [bx, bz] = STREAM_PATH[i + 1];
    const vx = bx - ax;
    const vz = bz - az;
    const len2 = vx * vx + vz * vz;
    const t = Math.min(1, Math.max(0, ((x - ax) * vx + (z - az) * vz) / len2));
    const d = Math.hypot(x - (ax + vx * t), z - (az + vz * t));
    if (d < best) {
      best = d;
      // Segment index plus position within it, normalised over the path.
      bestAt = (i + t) / segs;
    }
  }
  // Beyond this the ravine has feathered out anyway, so save the callers
  // the arithmetic.
  return best > RAVINE_REACH * 1.5 ? null : bestAt;
}

// Distance from a point to the stream's centreline, as a polyline.
function distanceToStream(x, z) {
  let best = Infinity;
  for (let i = 0; i < STREAM_PATH.length - 1; i++) {
    const [ax, az] = STREAM_PATH[i];
    const [bx, bz] = STREAM_PATH[i + 1];
    const vx = bx - ax;
    const vz = bz - az;
    const len2 = vx * vx + vz * vz;
    // Clamped projection onto the segment, so the ends are round rather
    // than the line running on forever past them.
    const t = Math.min(1, Math.max(0, ((x - ax) * vx + (z - az) * vz) / len2));
    const dx = x - (ax + vx * t);
    const dz = z - (az + vz * t);
    const d = Math.hypot(dx, dz);
    if (d < best) best = d;
  }
  return best;
}

// Water level, worked out from the hillside rather than typed in.
//
// A pond on a slope has to sit below the *lowest* point of its own rim or
// it runs out of the downhill side. Sampling the rim and taking the
// minimum is what guarantees that, and it keeps working if the terrain
// ever changes shape underneath it.
// Sampled at POND_BED, which is where the rim is, and set below it.
//
// The dig only ever lowers ground — it can't build a bank up. So on the
// downhill side the rim can be no higher than the hill already is, and the
// water has to sit under *that*, or it runs out. Taking the minimum around
// the rim ring and dropping 8 cm is what guarantees it, and it keeps
// holding if the hillside is ever reshaped underneath.
const POND_RIM_DROP = 0.08;
const POND_WATER_Y = (() => {
  let min = Infinity;
  for (let a = 0; a < 128; a++) {
    const ang = (a / 128) * Math.PI * 2;
    // Walks the *irregular* rim, not a circle — the bays reach further out
    // and downhill than a mean-radius circle does, so sampling a circle
    // would miss the genuinely lowest point and the pond would run out
    // through whichever lobe pokes furthest down the slope.
    const r = pondEdgeRadius(Math.cos(ang), Math.sin(ang)) * POND_BED;
    min = Math.min(
      min,
      groundWithRavine(POND.x + Math.cos(ang) * r, POND.z + Math.sin(ang) * r)
    );
  }
  return min - POND_RIM_DROP;
})();

function waterCarveAt(x, z) {
  if (x < WATER_BOUNDS.x0 || x > WATER_BOUNDS.x1) return 0;
  if (z < WATER_BOUNDS.z0 || z > WATER_BOUNDS.z1) return 0;

  let carve = 0;

  // Distance to the pond expressed as a *fraction of the local edge
  // radius*, so every threshold below is a scale on the pond's real
  // wobbling outline rather than a circle laid over it. Without this the
  // dish would be round inside a lumpy hole.
  const dx = x - POND.x;
  const dz = z - POND.z;
  const edge = pondEdgeRadius(dx, dz);
  const pd = Math.hypot(dx, dz) / edge;
  if (pd < POND_CARVE) {
    // The valley floor, not the original hillside. The ravine has already
    // taken 4.4 m out of this corner, and the pond has to be dug into
    // *that* — measuring against the pre-ravine ground put the water
    // surface four metres above its own bed, with the rim below the water
    // all the way round.
    const ground = groundWithRavine(x, z);
    // The rim, which stands just *above* the water — that's what contains
    // it. Equal to the lowest natural ground on the rim ring by
    // construction (see POND_WATER_Y), so the downhill side needs no dig
    // and every other side is cut down to meet it.
    const lip = POND_WATER_Y + POND_RIM_DROP;
    let target;
    if (pd <= POND_BED) {
      // A dish, deepest in the middle, rising to the rim. The water's own
      // edge sits at POND_DISC, well inside this, so it meets the bed
      // rather than balancing on the lip.
      const t = pd / POND_BED;
      target = lip - POND_DEPTH * (1 - t * t);
    } else {
      // Outside the dish, climbing back to meet the untouched hillside.
      const t = (pd - POND_BED) / (POND_CARVE - POND_BED);
      target = lip + (ground - lip) * smootherstep(Math.min(1, t));
    }
    // Only ever digs. Where the hill is already lower than the dish wants
    // — the downhill side — it's left alone, which is what leaves the pond
    // sitting in the top of the hollow with the ground falling away below.
    // Composed, not maxed: the ravine lowers the ground and the pond digs
    // into the result, so the total is one on top of the other. Taking the
    // larger of the two would let whichever is deeper erase the other.
    carve = Math.max(carve, ravineDrop(x, z) + Math.max(0, ground - target));
  }

  const sd = distanceToStream(x, z);
  if (sd < STREAM_HALF) {
    const t = sd / STREAM_HALF;
    carve = Math.max(carve, STREAM_DEPTH * (1 - t * t));
  }

  carve = Math.max(carve, ravineDrop(x, z));

  return Math.max(0, carve);
}

// The ravine below the waterfall.
//
// Everything downstream of the fall's lip is cut down by RAVINE_DEPTH, and
// the transition from "not cut" to "cut" happens over RAVINE_LIP metres of
// run — about two lawn quads. That is as close to vertical as this terrain
// can get: the lawn mesh is 0.6 m per quad, so anything sharper comes out
// as a staircase rather than a cliff. The visible drop is rock geometry
// standing on this ramp (see createFallRocks); the terrain only has to get
// out of its way and be walkable.
//
// Falls off with distance from the stream so it stays a valley rather than
// lowering the whole corner of the map, and feathers back to nothing at
// RAVINE_REACH so it meets the hillside without a wall.
function ravineDrop(x, z) {
  const along = streamProgress(x, z);
  if (along === null) return 0;
  const lipAt = FALL_FROM / (STREAM_PATH.length - 1);
  if (along < lipAt) return 0;

  // How far past the lip, in the same 0..1 units the path uses.
  const past = (along - lipAt) / (1 - lipAt);
  const depth = RAVINE_DEPTH * smootherstep(Math.min(1, past / RAVINE_LIP));

  const sd = distanceToStream(x, z);
  const across = 1 - smootherstep(Math.min(1, sd / RAVINE_REACH));
  return depth * across;
}

// Signed distance to the waterline: negative in the water, positive on the
// bank, null when nowhere near. Used for the reed band, which straddles the
// edge — reeds stand in the shallows *and* just back from them, so a plain
// "is it wet" test can't place them.
function waterEdgeBand(x, z) {
  if (x < WATER_BOUNDS.x0 - 2 || x > WATER_BOUNDS.x1 + 2) return null;
  if (z < WATER_BOUNDS.z0 - 2 || z > WATER_BOUNDS.z1 + 2) return null;
  // Signed against the *irregular* waterline, so the reed band follows the
  // bays and headlands instead of a circle drawn through them.
  const dx = x - POND.x;
  const dz = z - POND.z;
  const pond = Math.hypot(dx, dz) - pondEdgeRadius(dx, dz) * POND_DISC;
  const stream = distanceToStream(x, z) - STREAM_HALF;
  return Math.min(pond, stream);
}

// How close a point is to open water, for keeping things out of it. The
// margin lets callers ask for their own clearance — grass can grow to the
// waterline, a tree can't stand in the channel.
function nearWater(x, z, margin) {
  if (x < WATER_BOUNDS.x0 - margin || x > WATER_BOUNDS.x1 + margin) return false;
  if (z < WATER_BOUNDS.z0 - margin || z > WATER_BOUNDS.z1 + margin) return false;
  const dx = x - POND.x;
  const dz = z - POND.z;
  if (Math.hypot(dx, dz) < pondEdgeRadius(dx, dz) * POND_BED + margin) return true;
  return distanceToStream(x, z) < STREAM_HALF + margin;
}

// Water, as a shader rather than a tinted surface.
//
// The first version was a MeshStandardMaterial — one flat colour, 82%
// opaque — and it read as painted lino. A still surface with no variation
// across it isn't water however well the colour is chosen, because
// everything the eye uses to identify water is *movement* and *change
// across the surface*: ripples catching the light at different angles, the
// far edge going reflective while the near edge stays clear, the middle
// reading deeper than the margin.
//
// So: two crossing ripple trains perturbing the normal, a Fresnel term
// governing both reflectivity and transparency, depth tinting from a
// distance field the geometry passes in, and a flow direction so the
// stream moves along its own length while the pond just breathes.
const WATER_UNIFORMS = {
  uTime: { value: 0 },
  // Shallow water at the margin, deep water in the middle.
  // Both darkened after a look. Water is almost always darker than the
  // ground around it — it absorbs rather than scattering back — and the
  // first pair were light enough that the pond read as a bright patch in
  // the grass instead of a hole full of water.
  uShallow: { value: new THREE.Color(0x3c6656) },
  uDeep: { value: new THREE.Color(0x0b2028) },
  // What the surface reflects at a grazing angle. Driven from the sky's own
  // horizon colour by applyDayNight, so the pond changes with the time of
  // day instead of staying a fixed blue while the sky goes gold.
  uSkyTint: { value: new THREE.Color(0x9fc4e8) },
  uLightDir: { value: new THREE.Vector3(0, 1, 0) },
  uSunColor: { value: new THREE.Color(0xffffff) },
};

const WATER_MAT = new THREE.ShaderMaterial({
  uniforms: WATER_UNIFORMS,
  transparent: true,
  depthWrite: false,
  vertexShader: /* glsl */ `
    // x is flow along the surface, y is depth: 0 at the shore, 1 in the
    // middle. Both are baked per-vertex when the geometry is built, since
    // the shader can't work out where the bank is on its own.
    attribute vec2 waterInfo;
    varying vec2 vInfo;
    varying vec3 vWorld;
    varying vec3 vViewDir;
    void main() {
      vInfo = waterInfo;
      vec4 world = modelMatrix * vec4(position, 1.0);
      vWorld = world.xyz;
      vViewDir = normalize(cameraPosition - world.xyz);
      gl_Position = projectionMatrix * viewMatrix * world;
    }
  `,
  fragmentShader: /* glsl */ `
    precision highp float;
    uniform float uTime;
    uniform vec3 uShallow;
    uniform vec3 uDeep;
    uniform vec3 uSkyTint;
    uniform vec3 uLightDir;
    uniform vec3 uSunColor;
    varying vec2 vInfo;
    varying vec3 vWorld;
    varying vec3 vViewDir;

    void main() {
      float depth = vInfo.y;
      float flow = vInfo.x;

      // Two ripple trains at different scales and angles, plus a slow
      // drift along the flow direction. Crossing them is what stops the
      // pattern reading as corrugation — a single train is a washboard.
      vec2 p = vWorld.xz;
      float drift = flow * 0.9 - uTime * 0.35;
      float r1 = sin(p.x * 3.1 + p.y * 1.7 + uTime * 1.15 + drift * 3.0);
      float r2 = sin(p.x * -1.9 + p.y * 4.3 + uTime * 0.87 - drift * 2.0);
      float r3 = sin((p.x + p.y) * 8.5 - uTime * 2.4 + drift * 6.0);

      // Perturb the surface normal. Bigger than it first was — at 0.09 the
      // ripples were invisible from more than a few metres away, which left
      // the pond a flat wash of whatever the sky colour happened to be.
      // They have to survive being seen from across the glade.
      vec3 n = normalize(vec3(
        (r1 * 0.32 + r3 * 0.10) * 0.16,
        1.0,
        (r2 * 0.32 + r3 * 0.10) * 0.16
      ));

      // Fresnel. Looking straight down you see into the water; looking
      // across it you see the sky. This one term does most of the work of
      // making it read as a surface with a medium under it.
      float fres = pow(1.0 - max(dot(n, vViewDir), 0.0), 3.0);
      fres = clamp(fres, 0.0, 1.0);

      // Reaches full depth by 45% of the way in, not 75%. A pond is deep
      // over most of its area and only shallow at the very margin; ramping
      // slowly left three quarters of the surface reading as shallows.
      vec3 body = mix(uShallow, uDeep, smoothstep(0.0, 0.45, depth));
      // Held to 0.5, down from 0.82.
      //
      // A pond seen from standing height is nearly all grazing angle, so at
      // 0.82 the sky reflection swamped everything — under the sunrise the
      // whole surface went salmon and read as orange juice. Water does
      // reflect hard at that angle, but it never loses its own colour
      // entirely, and the body colour is what says "there is a depth of
      // something here" rather than "this is a mirror lying on the grass".
      vec3 col = mix(body, uSkyTint, fres * 0.32);

      // Specular glint off the ripples — the sparkle, and the single most
      // water-like thing in here.
      //
      // Both ends of this were wrong before. At exponent 220 the highlight
      // was so tight it fell between pixels and never showed; at 60 with a
      // 0.9 gain it did the opposite and washed the entire pond khaki —
      // because with a low sun and a downward view the half-vector sits
      // near vertical, so every ripple lands inside the lobe at once and
      // the "sparkle" becomes a flat sheen over the whole surface.
      //
      // 140 and a quarter of the gain: narrow enough that only ripples at
      // the right angle catch it, bright enough to see when they do.
      vec3 h = normalize(normalize(uLightDir) + vViewDir);
      float spec = pow(max(dot(n, h), 0.0), 140.0);
      col += uSunColor * spec * 0.22;

      // The ripples also just *shade* the surface, independently of any
      // reflection maths.
      //
      // Perturbing the normal alone turned out not to be enough: the normal
      // only reaches the image through the Fresnel and specular terms, and
      // at a near-horizontal view — which is how you actually see a pond,
      // standing beside it — Fresnel is close to saturated and stops
      // responding. The result was a surface that was mathematically
      // rippling and visually a smooth gradient.
      //
      // Modulating brightness directly is not physical, but it is what
      // makes the movement legible from every angle rather than only from
      // directly overhead.
      float ripple = r1 * 0.5 + r2 * 0.34 + r3 * 0.16;
      col *= 0.86 + 0.26 * ripple;

      // Shallow water is more transparent, and the very edge fades out
      // entirely so the waterline is a soft wet margin rather than a cut
      // line across the grass.
      //
      // The floor here is 0.72, well up from 0.35. At 0.35 the margin was
      // transparent enough to show the pond bed straight through — and the
      // bed is the painted lawn texture, lit by the glade's canopy
      // exemption, so the pond looked like a pale green puddle sitting on
      // bright grass. A real pond this deep is murky; you do not see the
      // bottom of it. Being *more* opaque is what makes it read as having
      // a body of water in it at all.
      float alpha = mix(0.93, 1.0, smoothstep(0.0, 0.45, depth));
      alpha = mix(alpha, 1.0, fres * 0.5);
      alpha *= smoothstep(0.0, 0.1, depth);

      gl_FragColor = vec4(col, alpha);
    }
  `,
});

function createWater() {
  const group = new THREE.Group();

  // The pond surface: flat, because water is level, but built as a fan on
  // the pond's own irregular outline rather than a CircleGeometry. A round
  // surface inside a lobed basin shows the bed through the bays and buries
  // its own edge under the headlands.
  //
  // Depth is baked per vertex — 1 at the centre falling to 0 at the rim.
  // The shader can't derive it; it has no idea where the bank is. Flow is
  // zero: a pond doesn't go anywhere, it just breathes.
  const SEGMENTS = 72;
  const discGeo = (() => {
    const pos = [0, 0, 0];
    const info = [0, 1];
    const idx = [];
    for (let i = 0; i < SEGMENTS; i++) {
      const a = (i / SEGMENTS) * Math.PI * 2;
      const c = Math.cos(a);
      const s = Math.sin(a);
      const r = pondEdgeRadius(c, s) * POND_DISC;
      pos.push(c * r, s * r, 0);
      info.push(0, 0);
      idx.push(0, 1 + i, 1 + ((i + 1) % SEGMENTS));
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('waterInfo', new THREE.Float32BufferAttribute(info, 2));
    g.setIndex(idx);
    return g;
  })();
  const disc = mesh(discGeo, WATER_MAT);
  disc.rotation.x = -Math.PI / 2;
  disc.position.set(POND.x, POND_WATER_Y, POND.z);
  group.add(disc);

  // The stream: a ribbon that follows the ground down. Unlike the pond it
  // can't be level — it's moving, so its surface runs with the slope, and
  // sampling terrainHeight (already carved by now) puts it in its channel.
  const positions = [];
  const indices = [];
  const info = [];
  const STEPS = 14;
  let row = 0;
  // Distance travelled along the stream, so the ripples drift downhill
  // rather than sitting still. Accumulated in metres and fed to the shader
  // as the flow coordinate.
  let run = 0;
  for (let i = 0; i < STREAM_PATH.length - 1; i++) {
    const [ax, az] = STREAM_PATH[i];
    const [bx, bz] = STREAM_PATH[i + 1];
    for (let s = 0; s <= STEPS; s++) {
      // Skip the duplicated joint between segments.
      if (i > 0 && s === 0) continue;
      const t = s / STEPS;
      const cx = ax + (bx - ax) * t;
      const cz = az + (bz - az) * t;
      // Perpendicular to the segment, in plan.
      const vx = bx - ax;
      const vz = bz - az;
      const len = Math.hypot(vx, vz) || 1;
      const nx = -vz / len;
      const nz = vx / len;
      const w = STREAM_HALF * 0.85;
      if (row > 0) run += Math.hypot(vx, vz) / STEPS;
      for (const side of [-1, 1]) {
        const px = cx + nx * w * side;
        const pz = cz + nz * w * side;
        positions.push(px, terrainHeight(px, pz) + 0.05, pz);
        // Flow along the run; depth peaks in the middle of the channel and
        // goes to zero at both banks, which is what feathers the stream's
        // edges into the wet ground rather than ending on a hard line.
        info.push(run, 0.55);
      }
      if (row > 0) {
        const a = (row - 1) * 2;
        indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
      row++;
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('waterInfo', new THREE.Float32BufferAttribute(info, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  const stream = mesh(geo, WATER_MAT);
  group.add(stream);

  return group;
}

// Water is animated, so it needs the clock. Called from the frame loop
// alongside the grass's own wind time.
// ── the fall, and the rocks it comes over ──────────────────────────────
//
// The terrain can only drop so sharply — the lawn mesh is 0.6 m per quad,
// so a true vertical face comes out as a staircase. The ravine gives a
// steep ramp; these give it a cliff to be.
//
// Boulders rather than a cliff wall. A single face at this scale needs to
// be modelled and lit properly to look like anything; a jumble of blocks
// is what a real fall over a rock ledge looks like anyway, it hides the
// terrain's stair-stepping behind irregular silhouettes, and each one is
// a cheap deformed box.

const ROCK_MAT = new THREE.MeshStandardMaterial({
  color: 0x6a6560,
  roughness: 0.92,
  metalness: 0,
  flatShading: true,
});
const ROCK_WET_MAT = new THREE.MeshStandardMaterial({
  // Wet rock is darker and shinier, and the line between wet and dry is
  // most of what tells you where the water has been.
  color: 0x3d4442,
  roughness: 0.32,
  metalness: 0,
  flatShading: true,
});

// One boulder: a box pushed around at the corners so no two are alike, and
// flat-shaded so the facets catch light like broken stone.
function makeBoulder(size, rand) {
  const geo = new THREE.BoxGeometry(size, size * (0.6 + rand() * 0.5), size * (0.7 + rand() * 0.6), 2, 2, 2);
  const pos = geo.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    // Push each vertex out along its own direction by a random amount.
    // Doing it per-vertex rather than per-axis is what stops them all
    // being the same lozenge at different scales.
    const k = 1 + (rand() - 0.5) * 0.55;
    v.multiplyScalar(k);
    v.x += (rand() - 0.5) * size * 0.18;
    v.y += (rand() - 0.5) * size * 0.18;
    v.z += (rand() - 0.5) * size * 0.18;
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  geo.computeVertexNormals();
  return geo;
}

function createFallRocks() {
  const rand = mulberry32(0x9a11f5);
  const group = new THREE.Group();
  const dry = [];
  const wet = [];

  const lip = STREAM_PATH[FALL_FROM];
  const foot = STREAM_PATH[FALL_TO];
  const dx = foot[0] - lip[0];
  const dz = foot[1] - lip[1];
  const runLen = Math.hypot(dx, dz);
  // Along the fall, and across it.
  const ax = dx / runLen;
  const az = dz / runLen;
  const nx = -az;
  const nz = ax;

  // The face itself: boulders stacked down the drop, clustered on the
  // centreline where the water runs and thinning outward. Placed by
  // *sampling the terrain* rather than at fixed heights, so they sit on
  // the ramp wherever the ravine actually put it.
  const ROWS = 9;
  for (let r = 0; r <= ROWS; r++) {
    const t = r / ROWS;
    // Slightly past the lip and the foot, so the rocks overshoot the
    // terrain transition at both ends and hide where it starts and stops.
    const along = -0.25 + t * 1.5;
    const cx = lip[0] + dx * along;
    const cz = lip[1] + dz * along;
    const perRow = 3 + Math.floor(rand() * 3);
    for (let i = 0; i < perRow; i++) {
      // Across the fall: a spread that widens toward the bottom, the way
      // debris piles out at the base of a real drop.
      const spread = (1.1 + t * 2.6) * (rand() - 0.5) * 2;
      const px = cx + nx * spread + (rand() - 0.5) * 0.4;
      const pz = cz + nz * spread + (rand() - 0.5) * 0.4;
      const size = 0.55 + rand() * 1.25;
      const ground = terrainHeight(px, pz);
      const geo = makeBoulder(size, rand);
      const m = new THREE.Matrix4();
      m.compose(
        // Sunk by a third, so they read as embedded in the slope rather
        // than resting on it.
        new THREE.Vector3(px, ground - size * 0.3 + rand() * 0.25, pz),
        new THREE.Quaternion().setFromEuler(
          new THREE.Euler(
            (rand() - 0.5) * 0.5,
            rand() * Math.PI * 2,
            (rand() - 0.5) * 0.5
          )
        ),
        new THREE.Vector3(1, 1, 1)
      );
      geo.applyMatrix4(m);
      // Within about a metre of the water's line it's wet.
      (Math.abs(spread) < 1.1 ? wet : dry).push(geo);
    }
  }

  // A scatter of boulders round the pond's edge below, so the fall's
  // debris doesn't stop dead at the foot.
  for (let i = 0; i < 14; i++) {
    const a = rand() * Math.PI * 2;
    const e = pondEdgeRadius(Math.cos(a), Math.sin(a));
    const r = e * (1.05 + rand() * 0.45);
    const px = POND.x + Math.cos(a) * r;
    const pz = POND.z + Math.sin(a) * r;
    const size = 0.4 + rand() * 0.9;
    const geo = makeBoulder(size, rand);
    const m = new THREE.Matrix4();
    m.compose(
      new THREE.Vector3(px, terrainHeight(px, pz) - size * 0.35, pz),
      new THREE.Quaternion().setFromEuler(
        new THREE.Euler((rand() - 0.5) * 0.4, rand() * Math.PI * 2, (rand() - 0.5) * 0.4)
      ),
      new THREE.Vector3(1, 1, 1)
    );
    geo.applyMatrix4(m);
    dry.push(geo);
  }

  if (dry.length) group.add(mesh(mergeGeometries(dry), ROCK_MAT));
  if (wet.length) group.add(mesh(mergeGeometries(wet), ROCK_WET_MAT));
  return group;
}

// Coconut palms round the pond.
//
// Only here, and deliberately: palms in a Louisiana back yard would be
// absurd, but this corner is meant to read as somewhere else entirely —
// you follow a stream over a waterfall and arrive somewhere that doesn't
// belong to the rest of the map. The palms are most of what says that.
//
// Placed on the bank ring rather than scattered through the glade, leaning
// out over the water the way they do on a shoreline. Merged into three
// meshes for the whole stand.
const PALM_WOOD_MAT = new THREE.MeshStandardMaterial({
  color: 0x8a7355, roughness: 0.95, flatShading: true,
});
const PALM_FROND_MAT = new THREE.MeshStandardMaterial({
  color: 0x4f7a35, roughness: 0.82, side: THREE.DoubleSide, flatShading: true,
});
const PALM_NUT_MAT = new THREE.MeshStandardMaterial({
  color: 0x6b5233, roughness: 0.9, flatShading: true,
});

function createPalms() {
  const rand = mulberry32(0x50f11a);
  const wood = [];
  const frond = [];
  const nut = [];

  const COUNT = 9;
  for (let i = 0; i < COUNT; i++) {
    // Spread round the pond with jitter, skipping the arc the waterfall
    // comes down — palms don't grow on a rockfall.
    const a = (i / COUNT) * Math.PI * 2 + (rand() - 0.5) * 0.45;
    const e = pondEdgeRadius(Math.cos(a), Math.sin(a));
    const r = e * (1.2 + rand() * 0.55);
    const px = POND.x + Math.cos(a) * r;
    const pz = POND.z + Math.sin(a) * r;
    // Keep them out of the fall's run.
    if (distanceToStream(px, pz) < 2.2) continue;

    const parts = createPalm(rand);
    const m = new THREE.Matrix4();
    m.compose(
      new THREE.Vector3(px, terrainHeight(px, pz) - 0.1, pz),
      new THREE.Quaternion().setFromAxisAngle(UP_AXIS, rand() * Math.PI * 2),
      new THREE.Vector3(1, 1, 1)
    );
    wood.push(parts.wood.applyMatrix4(m));
    frond.push(parts.frond.applyMatrix4(m));
    nut.push(parts.nut.applyMatrix4(m));
  }

  const group = new THREE.Group();
  if (wood.length) {
    group.add(mesh(mergeGeometries(wood), PALM_WOOD_MAT));
    group.add(mesh(mergeGeometries(frond), PALM_FROND_MAT));
    group.add(mesh(mergeGeometries(nut), PALM_NUT_MAT));
  }
  return group;
}

export function setWaterTime(t) {
  WATER_UNIFORMS.uTime.value = t;
}

// Keeps the pond reflecting the sky it's actually under — driven from
// applyDayNight, so it goes gold at sunrise and silver under the moon
// instead of staying a fixed blue all day.
export function setWaterLight(skyTint, lightDir, sunColor) {
  WATER_UNIFORMS.uSkyTint.value.set(skyTint);
  WATER_UNIFORMS.uLightDir.value.copy(lightDir).normalize();
  WATER_UNIFORMS.uSunColor.value.set(sunColor);
}

// Segments per world unit across the lawn. The dome's slope is gentle, so
// this only has to be fine enough that the silhouette doesn't facet.
// Raised from 120 (1 m per segment) once the drainage swale went in: a
// 3.2 m ditch only spanned three segments at the old density and came out
// as a hard crease, and grass/trees sampling terrainHeight showed the
// ditch long before the lawn mesh did.
const LAWN_SIZE = 120;
const LAWN_SEGMENTS = 200;
// Where the visible ground stops. A little outside WORLD_RADIUS (55) so
// the rim sits beyond anything the player can walk to — the movement clamp
// holds them at 54, and standing at the clamp looking at the edge of the
// world a metre away would be worse than not seeing it at all.
const LAWN_EDGE = 58;

// The same regular grid a PlaneGeometry gives, minus every quad whose
// centre falls outside `edge`.
//
// Written out by hand rather than displacing a PlaneGeometry because the
// point is to *drop* geometry, and PlaneGeometry has no way to. Vertices
// are shared through a lookup keyed on grid position, so the disc costs the
// same per-quad as the square did and simply covers less area — about 65%
// of it, which is a real saving on a mesh this size.
function buildDiscGrid(size, segments, edge) {
  const step = size / segments;
  const half = size / 2;
  const index = new Int32Array((segments + 1) * (segments + 1)).fill(-1);
  const positions = [];
  const indices = [];

  const vertexAt = (ix, iz) => {
    const key = iz * (segments + 1) + ix;
    if (index[key] !== -1) return index[key];
    const id = positions.length / 3;
    // Local x/y; the mesh is rotated flat by the caller, so local y becomes
    // world -z and local z becomes world height.
    positions.push(-half + ix * step, half - iz * step, 0);
    index[key] = id;
    return id;
  };

  for (let iz = 0; iz < segments; iz++) {
    for (let ix = 0; ix < segments; ix++) {
      // Quad centre, in world x/z.
      const cx = -half + (ix + 0.5) * step;
      const cz = -(half - (iz + 0.5) * step);
      if (Math.hypot(cx, cz) > edge) continue;
      const a = vertexAt(ix, iz);
      const b = vertexAt(ix + 1, iz);
      const c = vertexAt(ix, iz + 1);
      const d = vertexAt(ix + 1, iz + 1);
      indices.push(a, c, b, b, c, d);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  return geo;
}

// How much light reaches the ground at a point, 1 in the open and near
// nothing under the wood.
//
// The tree line can be perfectly opaque and the woods still give themselves
// away the moment the camera lifts: you look down over the brush onto a
// forest floor lit exactly like mown lawn, and bright even ground behind a
// dark wall reads as a painted backdrop. A real canopy takes something like
// nine tenths of the light, and that contrast is most of what makes a wood
// look deep from outside it.
//
// This can't come from the actual shadow pass — the shadow camera is a 28 m
// box that follows Darla (see sunMoonLight in main.js), so the woods across
// the yard are outside it and always will be. It's baked into the ground
// instead, which is free and doesn't care how far away it is.
//
// Starts just inside the clearing rather than exactly on the boundary,
// because the trees overhang the edge — a tree line whose shade begins on
// the same line its trunks do reads as a wall with a spotlight at its foot.
const CANOPY_SHADE_FLOOR = 0.2;
function canopyShade(x, z) {
  const t = Math.min(1, Math.max(0, (woodsDepth(x, z) + 1.6) / 6));
  const shade = 1 - (1 - CANOPY_SHADE_FLOOR) * smootherstep(t);

  // The glade over the pond is a hole in the canopy, so the ground under
  // it comes back to daylight. Without this the pond sits at 20% shade
  // like the rest of the wood — a dark puddle at the end of the walk,
  // which is the opposite of the payoff it's meant to be. Trees are kept
  // out of the middle of the same circle (see createTreeChunk), so this
  // is lighting an opening that actually exists rather than painting a
  // bright patch under a closed canopy.
  const g = Math.hypot(x - POND.x, z - POND.z);
  if (g < GLADE_RADIUS) {
    const open = smootherstep(Math.min(1, (GLADE_RADIUS - g) / (GLADE_RADIUS * 0.55)));
    return shade + (1 - shade) * open;
  }
  return shade;
}

function createLawn() {
  // No normalMap/roughnessMap here — those came from the old photo
  // texture, and painted-on strokes don't have a matching bump/gloss
  // pattern to go with them the way a real photo does; a flat roughness
  // suits the painterly look better anyway.
  const map = createPaintedGrassTexture();
  // A disc, not a square — and this is why the world "looked square".
  //
  // Everything else about the world is radial: terrainHeight is a dome
  // falling to zero at TERRAIN_RADIUS, generation is a disc of
  // WORLD_RADIUS, movement clamps to a circle. The one thing that wasn't
  // was the ground you actually see, which was a 120 x 120 PlaneGeometry —
  // so past the point where the dome flattens out you were looking at a
  // square slab of level ground with square corners, which is exactly what
  // it reads as.
  //
  // Built by walking the same regular grid and keeping only the quads whose
  // centre falls inside the radius, rather than by switching to a radial
  // ring mesh. A ring mesh gives a perfectly smooth rim but piles all its
  // resolution into the middle and starves the rim — and the middle is the
  // yard, which needs no more detail than it already has. This keeps the
  // 0.6 m grid everywhere and pays for it with a rim that's stepped at
  // 0.6 m, which the fog and the tree line cover.
  const geo = buildDiscGrid(LAWN_SIZE, LAWN_SEGMENTS, LAWN_EDGE);

  // The mesh gets rotated flat below (rotation.x = -PI/2), which maps local
  // (x, y, z) to world (x, z, -y). So world height is the local z axis, and
  // a vertex's world Z is minus its local y — hence the sign flip when
  // sampling.
  const pos = geo.attributes.position;
  const shade = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const worldX = pos.getX(i);
    const worldZ = -pos.getY(i);
    pos.setZ(i, terrainHeight(worldX, worldZ));
    // Vertices sit 0.6 m apart on a 6 m ramp, so this resolves the gradient
    // ten times over — no need for a finer mesh to carry it.
    const k = canopyShade(worldX, worldZ);
    shade[i * 3] = k;
    shade[i * 3 + 1] = k;
    shade[i * 3 + 2] = k;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(shade, 3));
  geo.computeVertexNormals();

  const ground = new THREE.Mesh(
    geo,
    new THREE.MeshStandardMaterial({
      map,
      color: 0x8fcf72,
      vertexColors: true,
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

// The lawn used to be one blade model everywhere, which is most of why it
// read as a sheet of felt: real turf is a *mix*, and the mix is what the
// eye picks up on long before it resolves any single stalk. Three species,
// each its own geometry and its own material (the vertex shader bakes
// height and width in as literals, so they can't share one):
//
//   TURF    the fine mown blade above — the bulk of the lawn everywhere
//   COARSE  a taller, wider, straighter stalk with far less taper. This is
//           the roadside/edge grass a mower never reaches — see the left
//           edge of the frontage photo, where it stands well clear of the
//           mown height
//   CLOVER  a broadleaf weed, not a grass at all: short, several times
//           wider, and rounded off rather than pointed. Colonises the
//           thin, stressed ground where the turf has given up
//
// Widths and heights are deliberately far apart. An earlier attempt at
// variety nudged one blade model by ±15% and it was invisible at any
// distance — if two species don't differ enough to tell apart in a
// silhouette, they aren't two species.
const SPECIES = {
  TURF: {
    height: 0.13,
    segments: 2,
    width: LUSH_BLADE_WIDTH,
    // Hold width up the shaft, pinch hard only near the tip.
    taperPow: 2.4,
    taperAmt: 0.85,
    curve: 0.22,
    scaleMin: 0.72,
    scaleRange: 0.6,
    lean: 0.85,
  },
  COARSE: {
    // Tall enough to break the mown line clearly, but well short of the
    // 0.34 this started at — at that height a modest scattering of them
    // swamped the turf completely and the yard read as wheat.
    height: 0.23,
    // A real arc to describe at this height, so the segments finally earn
    // their keep — see the note on createBladeGeometry below.
    segments: 3,
    width: 0.038,
    taperPow: 1.7,
    taperAmt: 0.72,
    // Stands up far straighter than mown turf; tall stalks carry their own
    // weight rather than matting over.
    curve: 0.14,
    scaleMin: 0.65,
    scaleRange: 0.85,
    // Sparser stand, so less tangle and more upright separation.
    lean: 0.5,
  },
  // Reeds round the pond margin. Four times the height of coarse grass and
  // near enough parallel-sided — a reed is a stem, not a blade, so it holds
  // its width almost to the tip instead of tapering away like turf.
  //
  // A species rather than its own system, and that's the whole reason it's
  // cheap: it inherits the grass shader untouched, which means it gets the
  // wind — the gust envelope rolling across the field, the lean, the
  // flutter — already tuned and already in phase with every other plant in
  // the yard. Reeds swaying to their own private rhythm beside grass
  // swaying to another would read as two separate weather systems.
  //
  // `lean` is low because they stand up: tall stems carry their own weight,
  // and the sway multiplies against height anyway, so a reed still moves
  // much further at the tip than turf does.
  REED: {
    height: 0.92,
    // Enough to bend along its length rather than pivoting stiffly at the
    // base, which at this height is very visible.
    segments: 5,
    width: 0.026,
    taperPow: 3.2,
    taperAmt: 0.45,
    curve: 0.3,
    scaleMin: 0.6,
    scaleRange: 0.75,
    lean: 0.35,
  },
  // Fallen pine needles, lying on the ground rather than growing out of it.
  // Long, straight, near-parallel-sided and blunt — a southern pine needle
  // is a wire, not a blade, and tapering it to a point would read as more
  // grass. The tilt is what sells it: laid over near-flat and pointing every
  // which way, so the mat reads as scattered litter with real overlap
  // catching the light, not as brown grass.
  NEEDLE: {
    // Size is the only lever left on coverage, and coverage is the whole
    // difference between "a mat of pine straw" and "some brown bits in the
    // grass". The spawn probability is already pinned at 1.0 per candidate
    // position at the trunk, so density can't go up — but the needles are
    // scattered at random, which means gaps follow Poisson: at the 1.47x
    // nominal coverage of the previous size, e^-1.47 = 23% of the ground
    // stayed visible through the mat however the needles fell, and that
    // showed as green painted lawn between them.
    //
    // These dimensions give ~2.8x nominal, so about 6% gaps — reads as a
    // continuous mat that still breaks up naturally at the feathered edge.
    height: 0.15,
    segments: 1,
    width: 0.021,
    // Barely narrows, and only right at the end.
    taperPow: 3.0,
    taperAmt: 0.3,
    curve: 0.1,
    scaleMin: 0.7,
    scaleRange: 0.75,
    // Laid down flat. Not *exactly* flat — a hair off level so needles rest
    // across each other instead of all coplanar, which is what stops the
    // mat looking like a printed texture.
    tiltBase: Math.PI / 2 - 0.18,
    lean: 0.65,
    // Lifted up *into the grass canopy*, not laid on the soil. Fallen
    // needles land on top of an existing lawn and hang in the blades — they
    // don't sink to the ground and they don't displace the turf. At 0.005
    // they sat under a 0.13 sward and were simply invisible behind it,
    // which is why the bed kept reading as thin no matter how many were
    // added.
    yOffset: 0.085,
    // Spread through the upper canopy so needles rest across each other at
    // different heights rather than all lying in one plane. This also does
    // the work of making the bed look deep: every candidate position under
    // the trunk already becomes a needle, so the count cannot go up, and a
    // single-plane mat reads as a decal however dense it is.
    yJitter: 0.045,
  },
  // Both dandelions stand clear of the mown height on a bare stalk — that
  // pop of colour above the turf line is the whole point of them, and a
  // flower head sunk down among the blades reads as a speck of litter.
  DANDELION: {
    height: 0.19,
    // Enough rows to describe the head's curve; below about five it comes
    // out as a faceted lump rather than a bloom.
    segments: 7,
    width: 0.055,
    profile: headedProfile(0.13, 0.72, 0.75),
    crossed: true,
    curve: 0.05,
    scaleMin: 0.8,
    scaleRange: 0.45,
    // Stands up straight. A dandelion stalk is stiff and the head is heavy;
    // letting them flop at the blades' angles made them look like they'd
    // been trodden on.
    lean: 0.22,
  },
  DANDELION_CLOCK: {
    // The seed head, gone over. Slightly taller (the stalk lengthens as it
    // goes to seed, which is true and also keeps them visible) and rounder.
    height: 0.21,
    segments: 7,
    width: 0.062,
    // Lower fullness rounds the lens out into a ball.
    profile: headedProfile(0.11, 0.68, 0.45),
    crossed: true,
    curve: 0.04,
    scaleMin: 0.8,
    scaleRange: 0.4,
    lean: 0.18,
  },
  CLOVER: {
    // Taller than it looks like it should be, and this matters: at 0.075 a
    // clover leaf sat *below* the 0.13 turf around it and then flopped
    // nearly flat on top of that, so it was almost entirely buried. It has
    // been in the lawn since the first pass and was barely ever visible.
    // Real clover holds its leaves up level with mown grass or just over it.
    height: 0.115,
    segments: 2,
    width: 0.085,
    // Barely tapers, then rounds off — a leaf, not a point.
    taperPow: 3.4,
    taperAmt: 0.42,
    // Leans over, but no longer flops. At 1.25 the leaves lay flat enough to
    // vanish into the turf; this keeps the low, broad, mat-like read while
    // leaving the leaf face angled up where it can catch light and be seen.
    curve: 0.4,
    scaleMin: 0.75,
    scaleRange: 0.45,
    lean: 0.8,
  },
};

// The other two clovers are the identical plant — same leaf, same height,
// same flop. Only their palettes differ, so sharing the geometry profile
// keeps all three from drifting apart if the leaf shape is ever retuned.
SPECIES.CLOVER_PALE = { ...SPECIES.CLOVER };
SPECIES.CLOVER_BLUE = { ...SPECIES.CLOVER };

// Height, segments and the taper/curve profile are all parameters so the
// one blade model can serve all three species: a short blade barely curves,
// so paying for ten height segments on it would be waste — the segments
// only earn their keep once there's a real arc to describe.
// A dandelion isn't a blade — it's a bare stalk with a head on top — so the
// width profile can't be the blades' monotonic taper. `fullness` shapes the
// head: 1.0 is a pointed lens, and lower values round it out toward a ball,
// which is the difference between a flower and a seed clock.
function headedProfile(stalkWidth, headBase, fullness) {
  return (t) => {
    if (t < headBase) return stalkWidth;
    const u = (t - headBase) / (1 - headBase);
    return stalkWidth + (1 - stalkWidth) * Math.pow(Math.sin(u * Math.PI), fullness);
  };
}

function createBladeGeometry(profileOpts) {
  const { crossed } = profileOpts;
  if (!crossed) return buildBladePlane(profileOpts);
  // A flower head made of one plane vanishes to a line when you view it
  // edge-on, and blades are randomly rotated, so a good fraction of them
  // would be invisible. Two planes crossed at right angles read as a round
  // head from any angle for twice the (very small) vertex count.
  const a = buildBladePlane(profileOpts);
  const b = buildBladePlane(profileOpts);
  b.rotateY(Math.PI / 2);
  return mergeGeometries([a, b]);
}

function buildBladePlane({ height, segments, width, taperPow, taperAmt, curve, profile }) {
  const geo = new THREE.PlaneGeometry(width, height, 1, segments);
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
    // Taper toward the tip. A real blade narrows to almost nothing; a
    // clover leaf barely narrows at all, which is what taperAmt controls.
    // An even taper from root to point makes a triangle; a real blade is
    // near-parallel-sided for most of its length. Species with a head on a
    // stalk supply their own profile instead (see headedProfile).
    const w = profile ? profile(t) : 1 - Math.pow(t, taperPow) * taperAmt;
    pos.setX(i, pos.getX(i) * w);
    // A gentle resting curve; the wind adds its own bend on top.
    pos.setZ(i, pos.getZ(i) + t * t * height * curve);
  }
  geo.computeVertexNormals();
  return geo;
}

// `palette` is the species' own colouring. Each species carries its own,
// because two species sharing a palette read as one species with a haircut —
// and because the colour variation in the lawn now comes entirely from which
// *plant* is growing where, these are the only thing producing it.
function createLushGrassMaterial(species, palette) {
  const bladeHeight = species.height;
  const halfWidth = species.width / 2;
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
      // Shadows, sampled by hand for the same reason the lighting is: this
      // is a raw ShaderMaterial, so Three's shadow plumbing passes it by
      // entirely. Without these the trees threw shade onto the lawn *mesh*
      // and every blade standing on top of it stayed in full sun, which
      // hides the effect exactly where the ground is most visible.
      //
      // Fed from main.js each frame (setGrassShadow) out of the same
      // DirectionalLight everything else shadows from, so grass shade and
      // house shade are the same shadow map and cannot disagree.
      uShadowMap: { value: null },
      uShadowMatrix: { value: new THREE.Matrix4() },
      uShadowTexel: { value: 1 / 2048 },
      uShadowBias: { value: -0.0006 },
      // Starts at zero and stays there until the map exists — the sampler
      // is branched out entirely while it's 0, so the first frames don't
      // read an unbound texture.
      uShadowStrength: { value: 0 },
      // Moonlight rim on the blade tips. Zero by day.
      uMoonGlow: { value: 0 },
      uMoonColor: { value: new THREE.Color(0x9fd8e8) },
    },
    vertexShader: `
      attribute float instanceRandom;
      // How much daylight reaches this blade — see canopyShade. Baked per
      // blade in JS rather than recomputed here, because the clearing's
      // boundary is a real piece of geometry (openXMin, woodsDepth) and a
      // second copy of it in GLSL is a copy that drifts.
      attribute float instanceShade;
      uniform float uTime;
      uniform float uAngPerPx;
      uniform float uMinBladePx;
      uniform mat4 uShadowMatrix;
      // highp deliberately: a shadow depth compared at mediump bands badly
      // across a 68 m map, and the artefact looks like stripes of shade
      // lying across the lawn.
      varying highp vec4 vShadowCoord;
      varying float vHeightT;
      varying float vRandom;
      varying float vFogDepth;
      varying float vShade;
      varying vec3 vNormalW;
      varying vec3 vWorldPos;

      void main() {
        float t = position.y / ${bladeHeight.toFixed(3)};
        vHeightT = t;
        vRandom = instanceRandom;
        vShade = instanceShade;
        vNormalW = normalize(mat3(instanceMatrix) * normal);

        // Same angular width floor as the lawn blade — see the comment
        // there. Matters more here since these taper to a finer point.
        vec4 mvRoot = modelViewMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
        float rootDist = max(-mvRoot.z, 0.001);
        float instScale = length(mat3(instanceMatrix)[0]);
        float restHalfW = ${halfWidth.toFixed(4)} * instScale;
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
        // Offset along the normal before projecting into the shadow map —
        // the same trick as DirectionalLight.shadow.normalBias, and it earns
        // its keep here more than anywhere: a blade is a thin double-sided
        // sliver whose normal swings through most of a hemisphere, which is
        // the worst possible case for a flat depth bias.
        vShadowCoord = uShadowMatrix * vec4(worldPos.xyz + vNormalW * 0.04, 1.0);

        vec4 mvPosition = modelViewMatrix * restPos;
        vFogDepth = -mvPosition.z;
        gl_Position = projectionMatrix * mvPosition;
      }
    `,
    fragmentShader: `
      // highp, where this was mediump. Shadow depth arrives packed across
      // an RGBA8 texel and has to be unpacked to a float — at mediump's
      // ten-bit mantissa that quantises into visible bands of shade lying
      // across the lawn. Three's own materials run highp by default (it's
      // the renderer's default precision), so this only brings the grass in
      // line with everything else it stands next to.
      precision highp float;
      ${THREE.ShaderChunk.packing}
      varying float vHeightT;
      varying float vRandom;
      varying float vFogDepth;
      varying float vShade;
      varying highp vec4 vShadowCoord;
      varying vec3 vNormalW;
      varying vec3 vWorldPos;
      uniform highp sampler2D uShadowMap;
      uniform float uShadowTexel;
      uniform float uShadowBias;
      uniform float uShadowStrength;
      uniform float uMoonGlow;
      uniform vec3 uMoonColor;
      uniform vec3 fogColor;

      // 1 lit, 0 fully shadowed. Three-by-three PCF — one tap gives hard
      // aliased edges on branch shadows, which is the one shape where a
      // stair-stepped outline is unmistakable.
      float shadowMask() {
        highp vec3 c = vShadowCoord.xyz / vShadowCoord.w;
        // Outside the map is lit, not dark. Getting this backwards puts the
        // whole world beyond the shadow box in shade.
        if (c.x < 0.0 || c.x > 1.0 || c.y < 0.0 || c.y > 1.0 || c.z > 1.0) return 1.0;
        c.z += uShadowBias;
        float sum = 0.0;
        for (int y = -1; y <= 1; y++) {
          for (int x = -1; x <= 1; x++) {
            vec2 uv = c.xy + vec2(float(x), float(y)) * uShadowTexel;
            sum += step(c.z, unpackRGBAToDepth(texture2D(uShadowMap, uv)));
          }
        }
        return sum / 9.0;
      }

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
        vec3 baseColor = vec3(${palette.base});
        vec3 tipWarm = vec3(${palette.tipWarm});
        vec3 tipCool = vec3(${palette.tipCool});

        // Dark green near the house, lightening toward the edge of the
        // map — radial distance from the terrain's own center (see
        // TERRAIN_CENTER_X/Z above) rather than noise, so it actually
        // tracks "close to the house" instead of drawing an unrelated
        // patchwork over it. Flat dark out to TERRAIN_PAD (the level pad
        // the house sits on), then fading out to TERRAIN_RADIUS (the
        // world's edge).
        float distFromCenter = length(vWorldPos.xz - vec2(${TERRAIN_CENTER_X.toFixed(3)}, ${TERRAIN_CENTER_Z.toFixed(3)}));
        float shade = 1.0 - smoothstep(${TERRAIN_PAD.toFixed(3)}, ${TERRAIN_RADIUS.toFixed(3)}, distFromCenter);
        // The base (stem, root end) always takes the full shade — it sits
        // down in the sward and should darken with everything around it.
        baseColor = mix(baseColor, vec3(0.02, 0.09, 0.04), shade);
        // The tips only take as much as the species allows. This term is
        // at full strength across the whole yard (shade is 1.0 everywhere
        // inside TERRAIN_PAD), so at shadeResponse 1.0 it overwrites the
        // tip palette outright — which silently repainted every dandelion
        // head green and flattened the clover back to turf colour. Grasses
        // still want it; anything whose colour is the point of it does not.
        tipWarm = mix(tipWarm, vec3(0.14, 0.32, 0.11), shade * ${palette.shadeResponse.toFixed(2)});
        tipCool = mix(tipCool, vec3(0.05, 0.16, 0.07), shade * ${palette.shadeResponse.toFixed(2)});

        // There is deliberately no patch-scale colour term here any more.
        //
        // This went through five versions — straw, then a second green, then
        // an intermediate colour stop, then a much wider band, then a
        // per-blade dither — and every one of them was visible as *regions*
        // on the lawn. Confirmed by forcing the term to zero: the lines
        // vanished completely, so it was never shadows or the lawn mesh
        // underneath.
        //
        // The reason is structural rather than a matter of tuning. A colour
        // field painted across the ground has an isoline wherever it
        // changes, and the eye is extremely good at finding those on a flat
        // surface of otherwise uniform texture. Softening the gradient only
        // makes the region softer-edged; it does not stop it being a region.
        //
        // Colour variation now comes from the clover instead — actual plants,
        // clumped by their own noise, each with its own silhouette. A patch
        // of them reads as a patch of a different plant, which is what a real
        // lawn's colour variation actually is, and scattered instances can't
        // draw an outline the way a field can.
        vec3 tipColor = mix(tipCool, tipWarm, vRandom);
        // How the blade grades from base colour to tip colour, baked per
        // species. The grasses use a power curve slightly biased toward the
        // base — vHeightT*vHeightT is only a quarter of the way to the tip
        // colour at mid-blade, which left most of the visible length sitting
        // at base colour and made the gradient do far more darkening than
        // intended.
        //
        // The dandelions need something a power curve can't give: a stem
        // that stays green right up to where the head starts, then goes
        // fully yellow across the head. That's a smoothstep with its edges
        // sat either side of the head base, not a ramp from zero.
        vec3 color = mix(baseColor, tipColor, ${palette.tipRamp});

        // Ambient occlusion down in the sward: little light reaches the
        // bottom of dense turf, and lighting every blade evenly root to tip
        // makes a field look like a flat sheet of spikes rather than
        // something with depth. Gentle, though — at 0.30 this was stacking
        // on top of an already-dark base and crushing it to black.
        // Species that lie flat opt out via aoResponse. The gradient is
        // keyed to height *along the blade*, which is only the same thing as
        // height above ground for something standing up — on a needle lying
        // flat it runs horizontally down the needle's length and shades one
        // end of every one of them for no reason, which is what made the mat
        // read as olive mud rather than gold straw.
        color *= mix(1.0, 0.66 + 0.34 * smoothstep(0.0, 0.7, vHeightT), ${(palette.aoResponse ?? 1).toFixed(2)});

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
        // Per-blade brightness jitter. This is the only variation left in
        // the turf's colour, and it's per-blade rather than per-area, which
        // is precisely why it has never caused the banding the patch term
        // did — noise at blade scale averages into an even tone at any
        // distance instead of resolving into shapes.
        color *= 0.85 + vRandom * 0.3;

        // Cast shade from whichever of the sun or moon is up, off the same
        // shadow map the house and the trees use. Applied after all the
        // direct-light terms above rather than before, so a blade standing
        // in a tree's shadow loses its highlight and its back-scatter
        // together — light coming *through* a blade needs light to reach it
        // first, and shading only the diffuse term left blades glowing
        // green inside the shadow of the thing lighting them.
        if (uShadowStrength > 0.001) {
          color *= mix(1.0 - uShadowStrength, 1.0, shadowMask());
        }

        // Canopy shade, for the same reason and by the same numbers as the
        // ground mesh underneath (see canopyShade). Before this, culling the
        // ground to near-black under the wood just left the sparse blades
        // out there glowing on top of it.
        color *= vShade;

        // The whole reason the lawn glowed after dark: every term above is
        // baked daylight, so without this the grass stayed at noon while the
        // rest of the scene went dark around it.
        color *= uLightColor;

        // Moonlight rim. Added after the day/night tint, like the firelight
        // below and for the same reason: it's its own source, so it
        // shouldn't be dimmed by the night tint that exists to darken
        // *daylight*.
        //
        // Two terms multiplied together, and both matter. The (1 - ndl)
        // puts it on blades presenting an edge to the moon rather than a
        // face, which is what a rim light is — lighting the faces instead
        // just makes the lawn brighter. And vHeightT^3 keeps it in the top
        // fraction of each blade, so it reads as a catchlight running along
        // the top of the sward instead of the whole field fluorescing.
        if (uMoonGlow > 0.001) {
          float rim = (1.0 - ndl) * pow(vHeightT, 3.0);
          // Shaded grass shouldn't catch the moon either — the same shadow
          // mask the direct light uses, so a blade under a tree stays dark.
          color += uMoonColor * rim * uMoonGlow * vShade;
        }

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

// Mowed-lawn height lives in SPECIES.TURF above, along with the two other
// species' dimensions. It was doubled to 0.4 at one point to fix
// bare-looking turf, but that read as knee-high field grass rather than a
// mowed lawn — a taller blade was the wrong fix for gaps between blades.
// Back down near the original 0.2, with GRASS_SPACING tightened below
// instead so short blades still mat into a surface rather than standing
// apart as separate spikes.
//
// Segment counts are likewise per-species. Two for turf: a 0.13-tall blade
// has almost no arc to describe, so segments there buy very little, and
// blade *count* is what makes turf look thick. The taller COARSE stalk
// carries four, because at 0.34 there finally is an arc.

// Every grass material there is. Keeping the per-frame/per-mode updates
// behind these helpers means main.js doesn't have to know how many there
// are — adding another can't silently leave one with a stale clock or the
// wrong fog. Populated at the bottom of the grass section, once all the
// materials it names actually exist.
const grassMaterials = [];

// Every grass InstancedMesh in the world, so density can be moved at
// runtime (see setGrassDensity). Meshes are never removed — the world is
// generated once and kept — so this doesn't need to prune.
const grassFields = [];

// Thins the lawn to a fraction of what was built, live and without
// rebuilding anything.
//
// The one thing it cannot do is go *denser* than what's in the buffers.
// Spacing is baked in at generation time, so 1 is whatever tier the world
// was actually built at and there is nothing above it — a caller that wants
// more blades than that has to reload. Blade count goes as the inverse
// square of spacing, so the tiers land at roughly 1.0 / 0.51 / 0.20 of high.
export function setGrassDensity(fraction) {
  const f = Math.min(1, Math.max(0, fraction));
  for (const field of grassFields) {
    field.count = Math.round(field.userData.fullCount * f);
  }
}

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

// The moonlight rim — a cool catchlight along the blade tips. Its own
// setter rather than another argument to setGrassLight, because it is only
// ever non-zero in one of the two modes and reads better as its own thing.
export function setGrassMoonGlow(strength, color) {
  grassMaterials.forEach((m) => {
    m.uniforms.uMoonGlow.value = strength;
    m.uniforms.uMoonColor.value.set(color);
  });
}

// The shadow map, and the world-to-shadow matrix that goes with it, taken
// straight off the scene's DirectionalLight. Called every frame, because
// the shadow box travels with the player and both change as it moves.
//
// `strength` is how dark full shadow gets, and it's per-mode: a hard-edged
// tree shadow that reads well under the sun is far too heavy under a moon.
export function setGrassShadow(map, matrix, strength) {
  grassMaterials.forEach((m) => {
    m.uniforms.uShadowMap.value = map;
    if (map) {
      m.uniforms.uShadowMatrix.value.copy(matrix);
      m.uniforms.uShadowTexel.value = 1 / (map.image?.width || 2048);
    }
    // Zero while there's no map, which branches the sampler out of the
    // shader entirely rather than reading an unbound texture on the first
    // frames.
    m.uniforms.uShadowStrength.value = map ? strength : 0;
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

// Palettes. Turf keeps the colours the lawn was already tuned to; the others
// are pulled deliberately away from it, because two species that share a
// palette read as one species with a haircut.
//
// Since the painted patch-colour term was removed, these palettes are the
// entire source of colour variation in the lawn. Clover's in particular is
// doing real work now: a clump of it is the "different shade of green"
// the yard has, so it wants to stay clearly its own colour.
const GRASS_MATERIALS = {
  TURF: createLushGrassMaterial(SPECIES.TURF, {
    base: '0.11, 0.30, 0.13',
    tipWarm: '0.52, 0.86, 0.32',
    tipCool: '0.22, 0.58, 0.24',
    tipRamp: 'pow(vHeightT, 1.3)',
    // The lawn's own colouring — this is the term that was tuned against it.
    shadeResponse: 1.0,
  }),
  // Dry straw-green, and much less separated root-to-tip than a blade of
  // grass: a reed is the same colour most of the way up and only browns off
  // at the very top. Warmer than everything else in the yard on purpose —
  // it's what picks the pond margin out from the woods behind it.
  REED: createLushGrassMaterial(SPECIES.REED, {
    base: '0.15, 0.26, 0.12',
    tipWarm: '0.62, 0.63, 0.30',
    tipCool: '0.38, 0.45, 0.22',
    // Held back to the last fifth, so the stem stays green and only the
    // head goes strawy. The usual 1.3 ramps from the base and makes the
    // whole reed look dead.
    tipRamp: 'pow(vHeightT, 3.4)',
    shadeResponse: 1.0,
  }),
  COARSE: createLushGrassMaterial(SPECIES.COARSE, {
    // Greyer and bluer than the lawn — roadside grass is a coarser, duller
    // plant, and the cast is most of what separates it at a distance.
    base: '0.13, 0.26, 0.14',
    tipWarm: '0.55, 0.74, 0.36',
    tipCool: '0.28, 0.49, 0.30',
    tipRamp: 'pow(vHeightT, 1.3)',
    // Mostly lives out past TERRAIN_PAD where shade has fallen off anyway.
    shadeResponse: 1.0,
  }),
  CLOVER: createLushGrassMaterial(SPECIES.CLOVER, {
    // Deeper and bluer, with far less spread between base and tip: a broad
    // flat leaf doesn't have the root-to-tip gradient a blade does.
    base: '0.06, 0.18, 0.09',
    tipWarm: '0.26, 0.48, 0.22',
    tipCool: '0.12, 0.32, 0.15',
    tipRamp: 'pow(vHeightT, 1.3)',
    // High, and this was the bug that made the patches read as pale spray
    // paint. At 0.2 the clover skipped almost all of the radial shade the
    // turf takes, so near the house — where that shade is at full strength —
    // clover came out *lighter* than the grass around it, which is the
    // opposite of what a clover patch does. Following the shade closely
    // keeps it sitting in the same light as the lawn, so its palette being
    // darker is what actually reads, everywhere in the yard.
    shadeResponse: 0.85,
  }),
  // The blue-green one, off a walk round the real back yard. Pulled toward
  // teal rather than just darkened — that cool cast is the whole reason it
  // reads as a different plant and not as grass in shadow, which is the trap
  // with any clover colour that only differs in brightness.
  CLOVER_BLUE: createLushGrassMaterial(SPECIES.CLOVER_BLUE, {
    // Darker than the other clovers look like they need to be, and that is
    // what buys the low shadeResponse below. The two constraints fight:
    // a high shade response keeps clover from turning out *lighter* than the
    // turf near the house, but it also repaints the tips toward the turf's
    // own dark green — and at 0.85 that erased the teal completely across
    // the whole yard, which is why no blue was visible anywhere near the
    // house even though the colonies were right there.
    //
    // Starting dark resolves it: at a quarter response this still lands at
    // about the turf's lightness near the house while keeping roughly three
    // times its blue, so it reads as a different plant rather than as either
    // pale paint or grass in shadow.
    base: '0.04, 0.15, 0.14',
    tipWarm: '0.18, 0.42, 0.38',
    tipCool: '0.09, 0.27, 0.25',
    tipRamp: 'pow(vHeightT, 1.3)',
    shadeResponse: 0.25,
  }),
  // The same plant in a green barely off the turf's own. Where the dark
  // clover is a feature you notice, this one only breaks up the uniformity —
  // it should never be identifiable as a patch, just as the lawn not being
  // perfectly even.
  CLOVER_PALE: createLushGrassMaterial(SPECIES.CLOVER_PALE, {
    base: '0.10, 0.27, 0.13',
    tipWarm: '0.44, 0.76, 0.30',
    tipCool: '0.19, 0.52, 0.22',
    tipRamp: 'pow(vHeightT, 1.3)',
    // Follows the lawn's shading exactly, for the same reason as above.
    shadeResponse: 1.0,
  }),
  // Pine litter: flat, with almost no base-to-tip gradient, because a fallen
  // needle is uniform along its whole length — the root-is-darker logic that
  // makes living blades read as a sward is exactly wrong here.
  NEEDLE: createLushGrassMaterial(SPECIES.NEEDLE, {
    // Golden straw, matched to the reference photo. This is the one thing in
    // the yard that stays brown: the lawn itself went all-green because dead
    // *grass* read as neglect, but fallen needles under a pine are litter
    // rather than dying turf, and they're the correct colour for what they
    // are. The first pass was a dark oxblood, which read as mud — this sits
    // warmer and more orange.
    base: '0.44, 0.34, 0.16',
    tipWarm: '0.86, 0.66, 0.28',
    tipCool: '0.68, 0.50, 0.22',
    tipRamp: 'vHeightT * 0.35',
    shadeResponse: 0.0,
    // Lies flat — see the note on the AO term in the fragment shader.
    aoResponse: 0.0,
  }),
  // Green stalk, then a hard jump to yellow across the head. The smoothstep
  // edges bracket SPECIES.DANDELION's headBase of 0.72 — if those two ever
  // drift apart you get either a yellow stem or a green flower.
  DANDELION: createLushGrassMaterial(SPECIES.DANDELION, {
    base: '0.16, 0.34, 0.14',
    // Two yellows rather than one, so vRandom gives a patch of them some
    // spread instead of stamping out identical dots.
    tipWarm: '1.00, 0.86, 0.16',
    tipCool: '0.94, 0.68, 0.10',
    tipRamp: 'smoothstep(0.66, 0.80, vHeightT)',
    // The head keeps its yellow everywhere. The stem still darkens, since
    // baseColor takes the full shade regardless.
    shadeResponse: 0.0,
  }),
  DANDELION_CLOCK: createLushGrassMaterial(SPECIES.DANDELION_CLOCK, {
    base: '0.15, 0.31, 0.14',
    // Not pure white: a seed head is translucent grey-fawn, and at full
    // white they read as blown highlights or as snow.
    tipWarm: '0.92, 0.91, 0.86',
    tipCool: '0.74, 0.73, 0.68',
    tipRamp: 'smoothstep(0.62, 0.76, vHeightT)',
    shadeResponse: 0.0,
  }),
};

// Now that they exist — see the note on grassMaterials above. Every species
// has to be in here or it silently keeps a stale clock, the wrong fog, and
// daylight colour after dark.
grassMaterials.push(...Object.values(GRASS_MATERIALS));

// One InstancedMesh per species per chunk. The geometry is rebuilt per
// chunk rather than shared module-wide because instanceRandom
// are set *on the geometry* — a shared one would have each chunk clobber
// the last chunk's attributes.
//
// `entries` are [x, z, vigour] triples; vigour rides along from
// createChunkGrass so the shader can colour the blade by the same field
// that decided whether to plant it at all.
// Writes one instance matrix straight into the buffer: a YXZ euler, a uniform
// scale and a translation, composed by hand, column-major to match
// Matrix4.elements.
//
// This replaced an Object3D + updateMatrix() per blade, which is the same
// arithmetic plus a detour: assigning to `rotation` fires Object3D's onChange
// callback to rebuild the quaternion, and `compose()` then converts that
// quaternion straight back into a matrix. Euler -> quaternion -> matrix, when
// euler -> matrix is three lines. At a few hundred thousand blades that
// detour was measurable on load.
//
// Verified against THREE.Object3D over 20k random inputs before swapping —
// worst element difference was exactly 0, so this is not an approximation of
// the old behaviour, it's the same numbers by a shorter route.
function writeInstanceMatrix(arr, i, x, y, z, rx, ry, rz, s) {
  const a = Math.cos(rx), b = Math.sin(rx);
  const c = Math.cos(ry), d = Math.sin(ry);
  const e = Math.cos(rz), f = Math.sin(rz);
  const ce = c * e, cf = c * f, de = d * e, df = d * f;

  const o = i * 16;
  arr[o] = (ce + df * b) * s;
  arr[o + 1] = a * f * s;
  arr[o + 2] = (cf * b - de) * s;
  arr[o + 3] = 0;
  arr[o + 4] = (de * b - cf) * s;
  arr[o + 5] = a * e * s;
  arr[o + 6] = (df + ce * b) * s;
  arr[o + 7] = 0;
  arr[o + 8] = a * d * s;
  arr[o + 9] = -b * s;
  arr[o + 10] = a * c * s;
  arr[o + 11] = 0;
  arr[o + 12] = x;
  arr[o + 13] = y;
  arr[o + 14] = z;
  arr[o + 15] = 1;
}

function buildGrassMesh(speciesKey, entries, rand) {
  const profile = SPECIES[speciesKey];

  // Shuffled before anything is written into the instance buffer, and this
  // is what makes runtime density control possible at all.
  //
  // Lowering InstancedMesh.count is the only way to thin a lawn without
  // rebuilding it — the blade *spacing* is baked into these matrices and
  // can't be changed after the fact. But count only ever drops instances
  // off the *end* of the buffer, and the scatter loop above fills it in
  // scan order, so truncating an unshuffled buffer doesn't thin the chunk:
  // it shaves a solid strip off one side of it and leaves the rest at full
  // density. Shuffled, the tail is a random subset, and dropping it thins
  // evenly everywhere.
  //
  // Its own PRNG, not the chunk's `rand`: this has to not disturb the draw
  // order in the loop below, which is load-bearing (see the note there).
  const shuffle = mulberry32(0x5caff1e ^ entries.length);
  for (let i = entries.length - 1; i > 0; i--) {
    const j = Math.floor(shuffle() * (i + 1));
    const tmp = entries[i];
    entries[i] = entries[j];
    entries[j] = tmp;
  }

  const geometry = createBladeGeometry(profile);
  const field = new THREE.InstancedMesh(geometry, GRASS_MATERIALS[speciesKey], entries.length);
  const instanceRandom = new Float32Array(entries.length);
  const instanceShade = new Float32Array(entries.length);
  const matrices = field.instanceMatrix.array;
  const lean = profile.lean;
  const tiltBase = profile.tiltBase ?? 0;
  const yOffset = profile.yOffset ?? 0;
  const yJitter = profile.yJitter ?? 0;
  entries.forEach(([x, z, vigour], i) => {
    // rand() call order is load-bearing: it decides every blade's lean,
    // facing, height and shader seed. Reordering these — or adding one —
    // reshuffles the entire lawn, so it has to match what it replaced
    // exactly, in sequence.
    const lift = yOffset + (yJitter ? rand() * yJitter : 0);
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
    //
    // Lean spread is per-species: mown turf mats over itself, tall coarse
    // stalks stand much straighter, and clover lies almost flat. tiltBase
    // shifts the *centre* of that spread rather than its width, which is how
    // fallen needles get laid over near-horizontal while still varying.
    const rx = tiltBase + (rand() - 0.5) * lean;
    const ry = rand() * Math.PI * 2;
    const rz = (rand() - 0.5) * lean;
    // Some unevenness so it doesn't read as bristles on a brush, but a
    // tighter spread than a wild field would have — this is a mowed lawn,
    // so blades top out at roughly a common height. Deliberately kept
    // *uniform* (not a taller-but-not-wider stretch): the vertex shader's
    // normal transform above takes the plain upper 3x3 of instanceMatrix,
    // which is only correct for uniform scale.
    // Enough spread that it isn't a uniform crop, but not so much that it
    // reads as scraggly — a mown lawn's blades are broadly the same
    // length, unlike the hay-meadow spread this had before.
    // Poor ground grows shorter grass. Scaling by vigour is a cheap way to
    // make a thinning patch also *sag*, rather than just having fewer
    // full-height blades standing in it — a bald spot in a real lawn has a
    // fringe of stunted growth around it, not a clean edge.
    const scale = (profile.scaleMin + rand() * profile.scaleRange) * (0.72 + vigour * 0.28);
    writeInstanceMatrix(matrices, i, x, terrainHeight(x, z) + lift, z, rx, ry, rz, scale);
    instanceRandom[i] = rand();
    // Not a rand() draw, deliberately — it's a pure function of position.
    // The rand() call order in this loop is load-bearing (see above), so
    // anything added here that consumed the stream would reshuffle the
    // entire lawn.
    instanceShade[i] = canopyShade(x, z);
  });
  geometry.setAttribute('instanceRandom', new THREE.InstancedBufferAttribute(instanceRandom, 1));
  geometry.setAttribute('instanceShade', new THREE.InstancedBufferAttribute(instanceShade, 1));
  field.instanceMatrix.needsUpdate = true;
  // The full count, kept because `count` itself is what setGrassDensity
  // moves — once it's been lowered there's nothing left to restore from.
  field.userData.fullCount = entries.length;
  grassFields.push(field);
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
// --- Lawn variation fields -------------------------------------------
//
// Two scalar fields over world XZ that everything about the lawn's variety
// keys off. Keeping it to two shared fields (rather than an independent
// random roll per effect) is the whole point: in a real lawn the thin patch
// *is* the yellow patch *is* the weedy patch, and when those three are
// decided independently the result reads as noise rather than as ground.

// Integer-lattice hash. Bit ops force int32 in JS, so this stays stable and
// repeatable — the world is generated from a seeded rand() and has to come
// out the same every load.
function latticeHash(ix, iz) {
  let h = Math.imul(ix, 374761393) + Math.imul(iz, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

// Plain 2D value noise, smootherstep-interpolated. Cheap, and it only runs
// at world-build time — nothing here is per-frame.
function valueNoise(x, z) {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const ux = smootherstep(x - ix);
  const uz = smootherstep(z - iz);
  const a = latticeHash(ix, iz);
  const b = latticeHash(ix + 1, iz);
  const c = latticeHash(ix, iz + 1);
  const d = latticeHash(ix + 1, iz + 1);
  return (
    a * (1 - ux) * (1 - uz) + b * ux * (1 - uz) + c * (1 - ux) * uz + d * ux * uz
  );
}

// How much clover grows at a point, 0 to 1. Three octaves, and the reason
// there are three is the whole design.
//
// The owner's photos of the real lawn settled this: clover does not grow in
// discrete colonies with edges. It mixes into the turf at every scale at
// once — broad drifts several metres across, denser clumps within those, and
// single plants scattered between them, with the frequency varying
// continuously rather than being in or out.
//
// This replaced a jittered-grid placement that put down lobed, feathered,
// well-separated blobs. That was a good solution to the wrong problem: it
// guaranteed colonies stayed apart and gave each an irregular outline, but
// a colony with an outline at all is the thing the real lawn doesn't have.
//
// The fine octave (~1.15m, roughly leaf-clump scale) is what stops any
// continuous boundary forming: it breaks up every isoline the broader
// octaves would otherwise draw, so there is nowhere an edge can read.
//
// Cuts are solved per seed rather than shared. The seed offsets the sample
// coordinates, so the same threshold yields anywhere from 0.8% to 3.5%
// coverage over a yard this size — a shared cut is meaningless.
function cloverField(x, z, seed, cut) {
  const broad = valueNoise(x / 8.5 + seed, z / 8.5 - seed);
  const mid = valueNoise(x / 3.1 - seed, z / 3.1 + seed);
  const fine = valueNoise(x / 1.15 + seed * 1.7, z / 1.15 - seed * 1.3);
  const n = broad * 0.42 + mid * 0.34 + fine * 0.24;
  return Math.max(0, n - cut) * 1.5;
}

// --- Per-chunk field cache -------------------------------------------
//
// Every field above varies over metres, while candidate blade positions sit
// 3cm apart — so evaluating them per position recomputes a value almost
// identical to its neighbour's, several million times over. Measured, that
// was ~36 seconds of world generation.
//
// Instead each field is sampled once onto a coarse lattice per chunk and
// read back with bilinear interpolation. At 0.4m the lattice still resolves
// the finest octave any of these fields contains (~1.1m), so the result is
// visually identical, for roughly two orders of magnitude less work: ~2.2k
// samples per field per chunk instead of 360k.
//
// The values do differ from exact evaluation by a hair, so the lawn's layout
// shifts very slightly. Still fully deterministic — same every load.
const FIELD_STEP = 0.4;

function sampleChunkField(fn, originX, originZ) {
  const n = Math.ceil(CHUNK_SIZE / FIELD_STEP) + 2;
  const grid = new Float32Array(n * n);
  for (let i = 0; i < n; i++) {
    const x = originX + i * FIELD_STEP;
    for (let j = 0; j < n; j++) {
      grid[i * n + j] = fn(x, originZ + j * FIELD_STEP);
    }
  }
  return { grid, n };
}

function readChunkField(field, originX, originZ, x, z) {
  const n = field.n;
  const max = n - 1.0001;
  let fx = (x - originX) / FIELD_STEP;
  let fz = (z - originZ) / FIELD_STEP;
  // Positions are jittered and can land a hair outside the chunk; clamping
  // into the lattice is cheaper than sizing it for the overhang.
  if (fx < 0) fx = 0; else if (fx > max) fx = max;
  if (fz < 0) fz = 0; else if (fz > max) fz = max;
  const i = fx | 0;
  const j = fz | 0;
  const tx = fx - i;
  const tz = fz - j;
  const g = field.grid;
  const base = i * n + j;
  const a = g[base];
  const b = g[base + n];
  const c = g[base + 1];
  const d = g[base + n + 1];
  return (
    a * (1 - tx) * (1 - tz) + b * tx * (1 - tz) + c * (1 - tx) * tz + d * tx * tz
  );
}

function smoothBand(edge0, edge1, x) {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

// Where the two front pines stand (see createYard). Nothing grows well in
// pine duff — the frontage photo shows bare reddish needle litter running
// out several metres from each trunk, and it's the most recognisable bald
// spot on the whole property.
// One list for the front pines, used both to place the trees (createYard) and
// to kill the grass under them. They have to be the same points or the bald
// patches drift off the trunks.
export const FRONT_PINES = [
  { x: -3.4, z: -32, height: 5.1, spread: 0.36, trunkRadius: 0.33 },
  // The taller of the original pair carries its crown a little higher, which
  // is what separates them in the photos.
  { x: 9.6, z: -32, height: 5.6, spread: 0.31, trunkRadius: 0.36, crownBase: 0.5 },
  // Two more, and per the satellite they sit level with the first pair rather
  // than staggered back — the clump is all about the same distance off the
  // road. They gather on the near side of the drive instead of spreading to
  // the corners, which is where the photo shows them bunched. Kept uphill of
  // the swale (z -37.9 to -33.1) like the others.
  { x: -15.5, z: -31.4, height: 5.4, spread: 0.34, trunkRadius: 0.34 },
  { x: -18.2, z: -32.4, height: 4.9, spread: 0.33, trunkRadius: 0.31, crownBase: 0.45 },
];

const PINE_DUFF = FRONT_PINES.map((p) => [p.x, p.z]);

// How thick the pine litter is at a point, 0 (none) to 1 (bare needle mat
// at the trunk). Pulled out of lawnVigour so the needles themselves can be
// scattered against the same field that kills the grass — the litter and
// the bald spot have to be the same shape or you get needles lying on
// healthy turf and bare dirt with nothing on it.
function pineDuff(x, z) {
  let duff = 0;
  for (const [px, pz] of PINE_DUFF) {
    const d = Math.hypot(x - px, z - pz);
    // The edge wobbles rather than ending on a clean circle — needle fall
    // drifts, and a perfect disc of litter around a trunk looks stamped.
    const wobble = 0.78 + valueNoise(x / 1.7 + 210.4, z / 1.7 - 33.8) * 0.5;
    duff = Math.max(duff, Math.pow(Math.max(0, 1 - d / (3.4 * wobble)), 1.4));
  }
  return duff;
}

// How healthy the ground is, 0 (bare dirt) to 1 (thick and green).
//
// `duff` is passed in rather than computed here because the caller already
// needs it for the needle scatter, and it is not cheap — it walks every pine
// and samples noise per trunk. Computing it in both places doubled that cost
// on every candidate position in the world.
function lawnVigour(x, z, duff = pineDuff(x, z)) {
  // Two octaves. The broad one puts whole regions of the yard into shade or
  // sun; the fine one breaks those up so the edges aren't smooth blobs.
  // Three octaves, weighted away from the broadest. An earlier version put
  // 70% of the weight on the 13-unit octave, and at that scale the result
  // isn't texture — it's big amoeba outlines drawn across the lawn, which
  // the eye reads as *shapes* sitting on the grass rather than as the grass
  // itself. No amount of softening the colour hides an unnatural outline;
  // the outline has to stop existing. Most of the variation now sits at
  // 1-3 units, about the scale of real patchiness in turf.
  const broad = valueNoise(x / 13, z / 13);
  const mid = valueNoise(x / 3.4 + 31.7, z / 3.4 - 17.3);
  const fine = valueNoise(x / 1.3 - 12.6, z / 1.3 + 51.2);
  // Contrast, then bias. Both halves matter and each fixes a failure this
  // went through:
  //
  // Averaging two octaves piles the result up hard around 0.5 (they're
  // independent, so they average toward the middle) and the field then
  // never reaches its low end at all — at gain 1.0 only 0.6% of the yard
  // thinned out and 2% went dry, which is invisible. The gain stretches
  // the distribution back out so the dips are real dips.
  //
  // The bias then puts the *centre* up around 0.65, because a lawn's
  // baseline is healthy and damage is the exception. Without it the yard
  // came out straw everywhere and read as a hay field.
  //
  // At these numbers roughly 9% of blades get culled into bald patches and
  // ~22% of the yard shows visible straw. The gain is the knob for "rougher
  // lawn" and it moves both together, which is correct — a lawn that browns
  // more also thins more. It has been 2.0 (tidier, ~5%/15%) and 1.0 (which
  // was invisible); 2.5 is where the patches actually read as features of
  // the yard rather than as noise in it.
  // Averaging three independent octaves piles the result up around 0.5
  // harder than two did, so the contrast gain has to come up to compensate
  // or the field never reaches its ends at all.
  let noise = broad * 0.26 + mid * 0.44 + fine * 0.30;
  noise = Math.min(1, Math.max(0, (noise - 0.5) * 3.2 + 0.5));
  let v = 0.28 + noise * 0.72;

  // A pine shades the grass under it, so it grows a little shorter — but
  // only a little. This was 0.85, from when the litter was meant to sit on
  // bare ground; the bed lies on top of an ordinary lawn now, so knocking
  // the vigour out from under it would just reintroduce the bald patch the
  // needles are supposed to be resting on.
  v -= 0.25 * duff;

  // The road shoulder bakes: reflected heat off the asphalt, and it's the
  // strip that gets least water. Only the near side — past the road is
  // somebody else's lawn.
  const fromRoad = Math.abs(z - ROAD_Z);
  v -= 0.3 * (1 - smoothBand(2.5, 7.0, fromRoad));

  // Foot traffic wears a thin arc off the driveway apron toward the front
  // door. Grass never really recovers on a path people actually walk.
  const walkD = Math.abs(Math.hypot(x - DRIVE_X, z + 20) - 9.5);
  v -= 0.35 * (1 - smoothBand(0.0, 1.6, walkD));

  // The parts of the yard that get looked after. Dead grass reads as
  // neglect, and neglect belongs at the edges of a property rather than in
  // the middle of where people actually live:
  //
  //   - the ground close to the house, which is what gets watered, walked
  //     past and noticed
  //   - the circle around the fire pit, which is where everyone sits. A
  //     ring of dead straw around the one social spot in the yard looks
  //     wrong even when the rest of the lawn is struggling
  //
  // Additive lifts rather than a clamp, so the noise still reads underneath
  // them — tended ground varies too, it just doesn't die. Both use wide
  // falloffs so the tended area has no edge of its own to see.
  // The house lift was first tried at 0.34 out to radius 26, which reaches
  // most of the yard and knocked the dead ground from 24% to 1.3% — the
  // whole effect vanished. Kept deliberately local instead: it protects the
  // ground you see from the windows and leaves the far end of the property
  // free to go over.
  const fromHouse = Math.hypot(x - TERRAIN_CENTER_X, z - TERRAIN_CENTER_Z);
  v += 0.22 * (1 - smoothBand(4, 14, fromHouse));
  const fromPit = Math.hypot(x - FIRE_PIT.x, z - FIRE_PIT.z);
  v += 0.32 * (1 - smoothBand(1.5, 9, fromPit));

  return Math.min(1, Math.max(0, v));
}

// How unmown the ground is, 0 (kept lawn) to 1 (nobody has ever cut this).
// Separate from vigour on purpose: the roadside strip is both scruffy *and*
// dry, but the far corners of the clearing are scruffy and perfectly green,
// and one field can't say both.
function lawnWildness(x, z) {
  // The mower covers the yard proper and gives up further out.
  const fromHouse = Math.hypot(x - TERRAIN_CENTER_X, z - TERRAIN_CENTER_Z);
  let w = smoothBand(GRASS_FULL_RADIUS * 0.62, GRASS_FADE_RADIUS * 0.85, fromHouse);

  // The mown yard proper. Without this the tall species crept well inside
  // the clearing and the lawn read as a meadow — a cut lawn should show
  // almost no tall stalks at all, and "almost" is doing real work here:
  // a few stragglers are what stop it looking like carpet.
  if (inOpenArea(x, z)) w *= 0.16;

  // The strip along the road, which in the photos is visibly taller than
  // anything else on the lot — it's the one place a mower can't reach past.
  // Applied after the mown damp above so it still wins: the shoulder is
  // inside inOpenArea's z range but is emphatically not mown.
  const fromRoad = Math.abs(z - ROAD_Z);
  w = Math.max(w, 0.85 * (1 - smoothBand(2.2, 5.5, fromRoad)));

  // Broken up so the transition isn't a clean ring around the house.
  w *= 0.75 + valueNoise(x / 5.5 - 61.2, z / 5.5 + 44.8) * 0.5;

  return Math.min(1, Math.max(0, w));
}

// --- Quality tier -----------------------------------------------------
//
// Grass spacing is the single biggest cost in the game, in both directions:
// world generation is ~97% grass (see notes/load-times.md) and the blades
// are most of what the GPU draws every frame. Spacing works against area, so
// halving it is four times the blades — which cuts both ways, and makes it
// the right dial for weak hardware.
//
// The choice has to be made *before* generateWorld, because the world is
// built once at startup rather than streamed. That rules out reacting to a
// measured frame rate: by the time there are frames to measure, the load
// time has already been spent and the instances already exist.
//
// So this is a guess from what the browser will tell us up front. It is a
// guess — the signals are coarse and some are missing on some browsers —
// which is why it errs toward the middle tier rather than the low one when
// it can't tell, and why ?quality= exists to force it.
function detectQualityTier() {
  const forced = new URLSearchParams(window.location.search).get('quality');
  if (forced === 'low' || forced === 'medium' || forced === 'high') return forced;

  let score = 0;

  // Cores. Present essentially everywhere; a phone or a netbook is usually
  // 4 or fewer, a desktop 8+.
  const cores = navigator.hardwareConcurrency ?? 4;
  if (cores >= 8) score += 2;
  else if (cores >= 6) score += 1;
  else if (cores <= 2) score -= 2;
  else if (cores <= 4) score -= 1;

  // Memory, in GB. Chrome-only and capped at 8, so its absence says nothing.
  const mem = navigator.deviceMemory;
  if (mem !== undefined) {
    if (mem >= 8) score += 1;
    else if (mem <= 4) score -= 1;
    else if (mem <= 2) score -= 2;
  }

  // Touch plus a small screen. Touch alone is a bad signal now that plenty
  // of capable laptops have it, so both have to hold.
  const touch = (navigator.maxTouchPoints ?? 0) > 0;
  // The `> 0` guard is load-bearing: some embedded browsers report a screen
  // size of 0, and a bare `<= 500` treats that as a phone.
  const shortEdge = Math.min(window.screen.width, window.screen.height);
  const small = shortEdge > 0 && shortEdge <= 500;
  if (touch && small) score -= 3;

  // The GPU's own name, where the browser will part with it. Far more
  // informative than anything above when available, and often masked.
  try {
    const gl = document.createElement('canvas').getContext('webgl2');
    const ext = gl?.getExtension('WEBGL_debug_renderer_info');
    const name = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : '';
    if (/rtx|radeon rx|geforce gtx 1[6-9]|apple m[1-9]/i.test(name)) score += 3;
    else if (/adreno|mali|powervr|intel.*(hd|uhd) graphics/i.test(name)) score -= 3;
  } catch {
    // Blocked or unavailable — the other signals stand on their own.
  }

  if (score <= -3) return 'low';
  if (score >= 3) return 'high';
  return 'medium';
}

export const QUALITY_TIER = detectQualityTier();

// Blade counts go as the inverse square of this, so the tiers are further
// apart than they look: medium is about half the blades of high, low about
// a fifth. Low is deliberately still dense enough to read as turf rather
// than as bristles — a phone that can't manage it is better served by the
// lawn looking thin than by it looking like a hairbrush.
export const GRASS_SPACING_BY_TIER = { high: 0.03, medium: 0.042, low: 0.068 };
export const GRASS_SPACING = GRASS_SPACING_BY_TIER[QUALITY_TIER];
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
//
// `?debug&grass` puts it back. Debug mode is otherwise the natural place to
// inspect the yard from — free camera, far zoom, no menus — and dropping the
// grass made it useless for exactly the thing the yard is mostly made of.
// Opt-in rather than default, because grass generation is nearly all of the
// load time (see notes/load-times.md) and the fast reload is the whole point
// of debug mode the rest of the time.
const GRASS_ENABLED = (() => {
  const params = new URLSearchParams(window.location.search);
  return !params.has('debug') || params.has('grass');
})();

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

  // Sampled once for the whole chunk — see the note on sampleChunkField.
  // Deliberately after the fade early-out above, so chunks that produce no
  // grass at all don't pay for it.
  const fDuff = sampleChunkField(pineDuff, originX, originZ);
  const fVigour = sampleChunkField((x, z) => lawnVigour(x, z), originX, originZ);
  const fWild = sampleChunkField(lawnWildness, originX, originZ);
  // Cuts are solved per seed against a target share of the yard — pale 12%,
  // dark 9%, blue 5%. Because one roll picks between them they compete
  // rather than stack, landing around 24% of the yard carrying visible
  // clover: roughly double the colony version, and much closer to the real
  // lawn, which is mixed rather than patched.
  const fPale = sampleChunkField((x, z) => cloverField(x, z, 214, 0.587), originX, originZ);
  const fClover = sampleChunkField((x, z) => cloverField(x, z, 88, 0.646), originX, originZ);
  const fBlue = sampleChunkField((x, z) => cloverField(x, z, 401, 0.603), originX, originZ);
  const fCoarse = sampleChunkField(
    (x, z) => valueNoise(x / 4.2 + 7.4, z / 4.2 - 55.6), originX, originZ
  );
  const fDandy = sampleChunkField(
    (x, z) => valueNoise(x / 3.1 + 140.2, z / 3.1 - 96.4), originX, originZ
  );

  const field = (f, x, z) => readChunkField(f, originX, originZ, x, z);

  // Grass comes right down to the waterline — a bare margin round a pond
  // looks like a construction site — so the clearance here is much tighter
  // than the trees' and the brush's.
  const exclude = (x, z) =>
    inHouse(x, z) || inFirePit(x, z) || inRoad(x, z) || nearWater(x, z, 0.15);
  const jitter = GRASS_SPACING * 0.9;
  const entries = {
    TURF: [],
    COARSE: [],
    CLOVER: [],
    CLOVER_PALE: [],
    CLOVER_BLUE: [],
    DANDELION: [],
    DANDELION_CLOCK: [],
    NEEDLE: [],
    REED: [],
  };

  for (let lx = 0; lx < CHUNK_SIZE; lx += GRASS_SPACING) {
    for (let lz = 0; lz < CHUNK_SIZE; lz += GRASS_SPACING) {
      const x = originX + lx + (rand() - 0.5) * jitter;
      const z = originZ + lz + (rand() - 0.5) * jitter;
      if (exclude(x, z)) continue;

      // Pine litter goes down before anything else, and ahead of both the
      // distance fade and the bald-patch cull.
      //
      // Being ahead of the fade matters more than it looks: the fade exists
      // to feather the grass out into the woods, and the pines stand about
      // 32 units from the origin, where it was quietly deleting 40% of the
      // mat. The litter is a fixed feature of the ground under a specific
      // tree, not part of the grass field, so distance from the house has
      // no business thinning it.
      //
      // Being ahead of the cull matters because the litter is what's lying
      // *on* the bare ground, not something growing out of it — culling it
      // would leave the ground barest exactly where the mat is thickest.
      //
      // Probability tracks the duff field directly, so the mat is densest
      // at the trunk and feathers out into the grass rather than ending on
      // an edge. At 1.0 the trunk gets ~1100 needles per square metre,
      // which with a 12mm-wide needle is well past full coverage once they
      // overlap. It needs to be: anything less and the painted grass on the
      // lawn mesh shows through between them and the whole mat reads green.
      //
      // Ordering below is performance-critical, not cosmetic. Everything
      // cheap and rejecting runs first; the noise fields run only for
      // positions that have already survived. Getting this backwards — the
      // fields above the distance fade — put lawnVigour on all 360k
      // positions of every chunk including the outer woods, where nearly
      // all of them are discarded a few lines later, and took world
      // generation from a couple of seconds to ~39.
      const onProperty = inOpenArea(x, z) && z > ROAD_Z + ROAD_HALF_WIDTH;
      if (!onProperty) {
        // The distance fade exists to feather grass out into the trees and
        // keys off distance from the world origin, which sits in the back
        // yard. That meant the front lawn was being thinned to 60% purely
        // for being far from that point. The mown property is exempt; only
        // the woods and across the street fade.
        // The glade is exempt, the same way the mown property is.
        //
        // The pond sits about 45.8 out, and the fade is finished by 44 — so
        // the clearing built to be the prettiest thing in the game came out
        // as bare painted mesh with a disc of water on it. The fade exists
        // to feather grass into the trees, not to strip a place the player
        // is meant to arrive at.
        const gladeDist = Math.hypot(x - POND.x, z - POND.z);
        if (gladeDist > GLADE_RADIUS) {
          const dist = Math.hypot(x, z);
          if (dist > GRASS_FADE_RADIUS) continue;
          if (dist > GRASS_FULL_RADIUS) {
            const keep =
              1 - (dist - GRASS_FULL_RADIUS) / (GRASS_FADE_RADIUS - GRASS_FULL_RADIUS);
            if (rand() > keep) continue;
          }
        }
      }

      const duff = field(fDuff, x, z);
      const vigour = field(fVigour, x, z);

      // Reeds, in a band round the waterline.
      //
      // Densest right at the edge and thinning both ways — they grow with
      // their feet wet, so there are none out in the open water and few up
      // the dry bank. `waterEdgeBand` is signed distance from the shore, so
      // one expression covers standing in the shallows and standing just
      // back from them.
      const shore = waterEdgeBand(x, z);
      if (shore !== null) {
        // 1 at the waterline, falling away over 1.4 m in each direction.
        const band = Math.max(0, 1 - Math.abs(shore) / 1.4);
        // Squared so the band has a defined edge rather than petering out
        // across the whole glade.
        //
        // The 0.022 looks absurdly small and isn't: this loop steps at
        // GRASS_SPACING, which is 3 cm, so it visits about 1,100 candidate
        // positions per square metre. At the 0.55 this started at that was
        // six hundred reeds per square metre — a solid wall you couldn't
        // see the pond through, and the reason the first attempt filled the
        // entire screen with straw. 0.022 gives roughly 25/m², which is a
        // reed bed.
        if (rand() < band * band * 0.022) {
          entries.REED.push([x, z, vigour]);
          // Reeds grow in clumps, not as evenly spaced individuals — a
          // second at the same spot is what turns a scattering into a
          // stand, and the per-blade jitter keeps them from overlapping
          // exactly.
          if (rand() < 0.3) entries.REED.push([x, z, vigour]);
        }
      }

      if (duff > 0.04 && rand() < duff) {
        entries.NEEDLE.push([x, z, vigour]);
        // A second needle at the same spot, deeper into the colony. One per
        // candidate position was a hard ceiling on how thick the bed could
        // get — the spawn chance was already pinned at 1.0 under the trunk,
        // so there was no headroom left anywhere else. Nothing stops two
        // instances sharing a position, and with the vertical jitter they
        // land at different heights in the canopy, so the pair reads as
        // depth rather than as one needle drawn twice.
        if (rand() < duff - 0.3) entries.NEEDLE.push([x, z, vigour]);
        // Deliberately no `continue`. Litter lies *on* the ground and grass
        // grows up through it, so a needle and a blade can share a position.
        // Consuming the position meant the bed was needles *instead of*
        // grass rather than needles *as well as* grass — which is exactly
        // why it read as a bald spot with litter on it.
      }

      // Grass grows here exactly as it does anywhere else on the lawn. The
      // litter is not a substitute for turf and never thins it — needles
      // fall *onto* an existing lawn and get caught in the canopy, which is
      // what NEEDLE's yOffset is for. Earlier versions removed the grass to
      // make room for the bed and got a bald patch with debris on it.

      // The bald-patch cull that used to sit here is gone. It thinned the
      // turf wherever vigour was low, which was the right idea while the
      // lawn was meant to look neglected — but the yard reads as tended now,
      // and its only remaining effect was holes in an otherwise full lawn.
      // Vigour still varies blade height (see buildGrassMesh), which gives
      // the same unevenness without opening gaps.

      const wild = field(fWild, x, z);

      // Clover is the lawn's colour variation — the painted patch tint that
      // used to do that job was removed for drawing visible regions (see the
      // note in the fragment shader).
      //
      // Cuts are solved per seed (see the sampling block above). The 0.55
      // strength is why clover never fully takes over anywhere: even at the
      // densest point of the field, turf still grows through it. That reads
      // as clover *in* a lawn, where total takeover reads as a different
      // material laid on top of one.
      //
      // Separate seeds so the three don't sit on the same ground, and
      // deliberately independent of vigour. Real clover does favour poor
      // soil, but tying it to that field would put clover and thin grass in
      // the same places and reintroduce visible regions.
      const cloverChance = field(fClover, x, z) * 0.55;
      const paleChance = field(fPale, x, z) * 0.55;
      const blueChance = field(fBlue, x, z) * 0.55;

      const coarsePatch = field(fCoarse, x, z);
      const coarseChance = wild * Math.max(0, coarsePatch - 0.42) * 1.5;

      // Dandelions. Their own patch field on a tighter scale than the
      // clover's, and thresholded hard: dandelions come up in loose
      // colonies of a handful, not evenly salted across a lawn. The rate
      // has to stay tiny — at GRASS_SPACING there are ~1100 candidate
      // positions per square metre, so even a 0.2% chance is a couple of
      // heads per square metre, which is already a neglected lawn.
      const dandyPatch = field(fDandy, x, z);
      const dandyChance = Math.max(0, dandyPatch - 0.66) * 0.030 * (1.4 - vigour);

      // One roll against cumulative bands, so the chances compete for the
      // same position rather than each getting an independent shot — two
      // colonies overlapping would otherwise both plant here and the denser
      // one would silently win by whichever test ran last.
      const roll = rand();
      let species = 'TURF';
      let edge = dandyChance;
      if (roll < edge) {
        // A minority have gone to seed. Mixing the two states in the same
        // colony is what real dandelions do, and the white clocks are the
        // more interesting shape, so they're worth more than a token few.
        species = rand() < 0.38 ? 'DANDELION_CLOCK' : 'DANDELION';
      // Blue is tested before the dark clover, and the order is load-bearing:
      // earlier branches win every overlap, and where the two colonies cross
      // the dark one's chance can be four times the blue one's. Testing dark
      // first meant blue simply never appeared on that ground — which near
      // the house is most of the ground clover grows on at all. Rarest and
      // most deliberate species get priority.
      } else if (roll < (edge += blueChance)) species = 'CLOVER_BLUE';
      else if (roll < (edge += cloverChance)) species = 'CLOVER';
      else if (roll < (edge += paleChance)) species = 'CLOVER_PALE';
      else if (roll < edge + coarseChance) species = 'COARSE';

      entries[species].push([x, z, vigour]);
    }
  }

  // One mesh per species that actually got any blades. Returned as a group
  // so the chunk is still a single thing for generateWorld to add and for
  // the streaming code to dispose of, while each species still frustum-culls
  // on its own bounds.
  const meshes = Object.keys(entries)
    .filter((key) => entries[key].length > 0)
    .map((key) => buildGrassMesh(key, entries[key], rand));

  if (meshes.length === 0) return null;
  const group = new THREE.Group();
  meshes.forEach((m) => group.add(m));
  return group;
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
  // Passed straight through for the same reason as the lights: main.js owns
  // the click-to-climb and the glow, and needs the object to raycast.
  group.userData.ladder = house.userData.ladder;

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
  // Straight off FIRE_PIT rather than repeating the coordinates — the grass
  // exclusion, the collision and the standing surface all read from it, and a
  // second copy here is exactly how the prop and its collision drift apart.
  firePit.position.set(FIRE_PIT.x, terrainHeight(FIRE_PIT.x, FIRE_PIT.z), FIRE_PIT.z);
  group.add(firePit);
  group.userData.firePit = firePit;

  // Out over the backyard clearing, and only after dark.
  const dragonflies = createDragonflies();
  group.add(dragonflies);
  group.userData.dragonflies = dragonflies;

  group.add(createWater());
  group.add(createFallRocks());
  group.add(createPalms());

  const hammock = createHammock();
  hammock.position.set(HAMMOCK.x, terrainHeight(HAMMOCK.x, HAMMOCK.z), HAMMOCK.z);
  hammock.rotation.y = HAMMOCK.rotation;
  group.add(hammock);
  group.userData.hammock = hammock;

  // The street out front, matching the owner's own reference photo (and
  // their sketch of it): the short garage driveway now curves the rest of
  // the way out to the road, two mature pines flank that curve where it
  // nears the road, and the mailbox sits across the road rather than on
  // the house's own side of it.
  const drivewayExtension = createDrivewayExtension();
  group.add(drivewayExtension);

  const road = createRoad();
  group.add(road);

  // Positions and shapes come from FRONT_PINES above, which the pine-duff
  // field reads from too. The middle pair flank the apron, which is how the
  // photos read — the frontage framed between two trunks with the drive
  // opening out between them — and the outer two carry that scatter along the
  // road. z stays just uphill of the swale (which spans z -37.9 to -33.1)
  // rather than in it: real trees sit on the crown of the lawn, not down in
  // the drainage.
  //
  // These are the only createSouthernPine in the world (see pine.js).
  // Everything else is the cheap cone tree, which is fine out among the
  // forest but was never going to pass for these at ten metres.
  // Shorter than the real ones. At 6/6.6 they were accurate to the photos
  // but you had to tilt the camera up off the ground to see the crowns,
  // which fights how the game is actually played — the view sits low and
  // behind the character. These went to 4.1/4.5 first, which overshot and
  // made them stubby; back up a quarter from there. Still clearly the
  // tallest thing on the property, without demanding you look up at them.
  const pineRand = mulberry32(20260727);
  for (const { x, z, ...shape } of FRONT_PINES) {
    const pine = createSouthernPine(pineRand, shape);
    pine.position.set(x, terrainHeight(x, z), z);
    group.add(pine);
  }

  // Across the road from the house, not the near shoulder — the far edge
  // sits at ROAD_Z - ROAD_HALF_WIDTH, so this clears it by a step further.
  const mailbox = createMailbox();
  const mailboxZ = ROAD_Z - ROAD_HALF_WIDTH - 1.2;
  mailbox.position.set(5.5, terrainHeight(5.5, mailboxZ), mailboxZ);
  mailbox.rotation.y = Math.PI / 2;
  group.add(mailbox);

  return group;
}
