import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Darla's house, rebuilt from a full counter-clockwise walk-around of the
// real one (17 photos, starting at the garage). Everything here is
// procedural: the brick, the shingles, the blinds, the porch screen. That's
// deliberate — the downloaded PBR sets that used to clad this house are
// generic (uniform orange running-bond brick, generic gray roof), and the
// thing that makes this particular house recognisable is exactly what a
// generic texture throws away: the wild colour spread of the brick (reds,
// browns, cream flashing and near-black burnt bricks in the same wall,
// under wide pale mortar) and shingles weathered to gray-tan. Generating
// them means they can be matched to the photos rather than merely
// resembling masonry.
//
// Coordinate convention for this whole file, matching how the house sits in
// the yard: local -z faces the street (garage, front door, arched windows),
// local +z faces the backyard (screened porch, dog kennel), and local +x is
// the garage side (service door, AC unit, parking apron).

function mesh(geometry, material) {
  const m = new THREE.Mesh(geometry, material);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

// Detail small enough that its own shadow is a couple of pixels of noise —
// muntin bars, light bulbs, door panels. Skipping the shadow pass for them
// keeps the shadow map's draw count in the same ballpark as before the
// house grew this many parts.
function trinket(geometry, material) {
  const m = new THREE.Mesh(geometry, material);
  m.castShadow = false;
  m.receiveShadow = true;
  return m;
}

function place(obj, x, y, z) {
  obj.position.set(x, y, z);
  return obj;
}

// ── procedural texture plumbing ────────────────────────────────────────

function newCanvas(w, h) {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  return canvas;
}

function finishTexture(canvas, srgb) {
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  if (srgb) texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 16;
  return texture;
}

// Small deterministic PRNG, so the brick lottery below comes out identical
// on every load. With Math.random the same wall gets a different set of
// burnt and cream bricks each refresh, which makes it impossible to tell
// whether a tweak actually changed anything.
function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick(list, rand) {
  return list[Math.floor(rand() * list.length)];
}

// Sobel a grayscale height canvas into a tangent-space normal map. Without
// this every procedural surface here would be dead flat under the sun —
// brick would read as wallpaper rather than as courses with recessed joints
// catching their own shadow. Sampling wraps at the edges so the result
// tiles as seamlessly as the height field it came from.
function heightToNormalTexture(heightCanvas, strength) {
  const w = heightCanvas.width;
  const h = heightCanvas.height;
  const src = heightCanvas.getContext('2d').getImageData(0, 0, w, h).data;
  const canvas = newCanvas(w, h);
  const ctx = canvas.getContext('2d');
  const out = ctx.createImageData(w, h);
  const at = (x, y) => src[(((y % h) + h) % h) * w * 4 + (((x % w) + w) % w) * 4];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = ((at(x + 1, y) - at(x - 1, y)) / 255) * strength;
      // Canvas Y runs down while the texture's V runs up (three.js flips on
      // upload), so the vertical gradient is used as-is rather than negated.
      const dy = ((at(x, y + 1) - at(x, y - 1)) / 255) * strength;
      const len = Math.hypot(dx, dy, 1);
      const i = (y * w + x) * 4;
      out.data[i] = ((-dx / len) * 0.5 + 0.5) * 255;
      out.data[i + 1] = ((dy / len) * 0.5 + 0.5) * 255;
      out.data[i + 2] = (1 / len) * 0.5 * 255 + 127.5;
      out.data[i + 3] = 255;
    }
  }
  ctx.putImageData(out, 0, 0);
  return finishTexture(canvas, false);
}

// ── brick ──────────────────────────────────────────────────────────────

// One brick module: a 194 x 57 mm face with 10 mm joints, i.e. the ordinary
// modular brick this house is built from. Tile size in metres and pixels
// per brick both follow from it, so courses come out at real-world scale on
// every wall without per-wall fiddling.
const BRICK_UNIT_W = 0.204;
const BRICK_UNIT_H = 0.067;
const BRICK_TILE_W = BRICK_UNIT_W * 16; // 3.264 m
const BRICK_TILE_H = BRICK_UNIT_H * 20; // 1.34 m

// Read off the walk-around photos. This brick is emphatically *not* one
// colour with noise on top — individual bricks land anywhere from cream
// through orange and red-brown to near-black burnt ones, and that per-brick
// lottery is the single most recognisable thing about the house. Weighted
// by repetition rather than by a parallel array of probabilities.
const BRICK_COLORS = [
  '#7e4232', '#7e4232', '#7e4232', '#7e4232', '#7e4232',
  '#8c4a36', '#8c4a36', '#8c4a36', '#8c4a36',
  '#6d3728', '#6d3728', '#6d3728',
  '#96543c', '#96543c', '#96543c',
  '#5f2f24', '#5f2f24',
  '#a05f44',
  // Cream and tan flashed bricks are the accent, not the field. There were
  // twice as many of these to start with and the wall read pink rather than
  // red, especially on the elevations the key light hits square on.
  '#9c8163', '#ab8f6e', '#8e7658',
  '#402a22', '#2e211d', '#3a2820',
];
const MORTAR_COLOR = '#a89f8c';

// The scene lights this house far harder than the sun did on the day the
// reference photos were taken: a 2.2-intensity key light, a hemisphere
// fill, a bounce light and a full-strength HDRI environment all at once.
// Colours sampled straight off a photograph are already "correct" for the
// exposure that photograph was taken at, so re-lighting them this hard
// blows them out — brick came out pale pink, shingles nearly white. These
// scale each material's albedo back down to compensate. They're linear
// multipliers written as sRGB hex, which is why the numbers look higher
// than the fraction they represent (0xe0 is about 0.75 of full, not 0.88).
// Tuned against side-by-side comparisons of the real house and the game.
// The elevations that face the key light square-on are the constraint: they
// blow out long before the shaded ones go muddy, so these sit lower than
// "correct for a photograph" on purpose.
const BRICK_TINT = 0xc4c0ba;
const SHINGLE_TINT = 0xd4d0c6;
const CONCRETE_TINT = 0xc0c0bc;
const TRIM_TINT = 0xdcd8ce;
// How much of the sky HDRI each surface is allowed to mirror. At full
// strength every wall behaves like polished stone — that's what read as
// "way too shiny" — and matte building materials barely reflect their
// surroundings at all. Glass and metal keep the full amount below, since
// for them the reflection is the whole point.
//
// This is also the right dial for the elevations facing away from the key
// light, which are lit almost entirely by the sky: raising it lifts them
// out of the murk without touching the sunlit faces, where the directional
// light dominates and any extra would blow them out again. Reaching for
// the albedo tints instead moves both at once, which is why the walls went
// from washed out to gloomy in one step.
const MATTE_ENV = 0.5;

function drawBrickFace(ctx, x, y, w, h, color, rand) {
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w, h);
  // Cream/lime flashing blotches — the mottling that makes each brick read
  // as fired clay rather than a flat swatch.
  // Kept deliberately restrained. Heavy light flashing on top of an already
  // light palette is what whitewashed the first version of this wall — the
  // mottling should be visible up close and barely register from the
  // street, not lift the whole elevation a stop.
  const blotches = 1 + Math.floor(rand() * 4);
  for (let i = 0; i < blotches; i++) {
    const bw = w * (0.12 + rand() * 0.4);
    const bh = h * (0.25 + rand() * 0.6);
    ctx.fillStyle = rand() < 0.45
      ? `rgba(214,200,176,${0.05 + rand() * 0.13})`
      : `rgba(40,26,20,${0.06 + rand() * 0.18})`;
    ctx.fillRect(x + rand() * (w - bw), y + rand() * (h - bh), bw, bh);
  }
  // A darker bottom edge fakes the shadow the brick's own arris casts into
  // the joint below it.
  ctx.fillStyle = 'rgba(0,0,0,0.12)';
  ctx.fillRect(x, y + h - Math.max(1, h * 0.1), w, Math.max(1, h * 0.1));
}

// `stagger` is the fraction of a cell each successive course shifts by —
// 0.5 for the running bond of the walls, 0 for the stack bond of a soldier
// course. Colour, height and roughness are drawn in one pass so all three
// stay in register.
function makeMasonryTextures({ cols, rows, cellW, cellH, jointPx, stagger, seed }) {
  const w = cols * cellW;
  const h = rows * cellH;
  const colorCanvas = newCanvas(w, h);
  const ctx = colorCanvas.getContext('2d');
  const heightCanvas = newCanvas(w, h);
  const hctx = heightCanvas.getContext('2d');
  const roughCanvas = newCanvas(w, h);
  const rctx = roughCanvas.getContext('2d');

  ctx.fillStyle = MORTAR_COLOR;
  ctx.fillRect(0, 0, w, h);
  hctx.fillStyle = '#4a4a4a';
  hctx.fillRect(0, 0, w, h);
  rctx.fillStyle = '#f0f0f0';
  rctx.fillRect(0, 0, w, h);

  const rand = seeded(seed);
  const j = jointPx;
  for (let row = 0; row < rows; row++) {
    const y = row * cellH;
    const offset = (row % 2) * stagger * cellW;
    // One extra cell each side so staggered courses still cover the tile's
    // left and right edges seamlessly.
    for (let col = -1; col <= cols; col++) {
      const bx = col * cellW + offset + j / 2;
      const by = y + j / 2;
      const bw = cellW - j;
      const bh = cellH - j;
      drawBrickFace(ctx, bx, by, bw, bh, pick(BRICK_COLORS, rand), rand);
      const proud = 190 + Math.floor(rand() * 45);
      hctx.fillStyle = `rgb(${proud},${proud},${proud})`;
      hctx.fillRect(bx, by, bw, bh);
      // Fired brick is matte — nearly as matte as the mortar around it. The
      // first pass had this down at 0.6, which gave every wall a broad
      // specular sheen under the key light.
      const rough = 222 + Math.floor(rand() * 33);
      rctx.fillStyle = `rgb(${rough},${rough},${rough})`;
      rctx.fillRect(bx, by, bw, bh);
    }
  }

  // Mortar grit, sprinkled afterwards so it also lands in the joints rather
  // than only on the brick faces.
  const grit = Math.floor(w * h * 0.05);
  for (let i = 0; i < grit; i++) {
    ctx.fillStyle = `rgba(${rand() < 0.5 ? '0,0,0' : '255,255,255'},${rand() * 0.07})`;
    ctx.fillRect(rand() * w, rand() * h, 1, 1);
  }

  return {
    map: finishTexture(colorCanvas, true),
    normalMap: heightToNormalTexture(heightCanvas, 2.2),
    roughnessMap: finishTexture(roughCanvas, false),
  };
}

// ── shingles ───────────────────────────────────────────────────────────

const SHINGLE_TILE_W = 0.3 * 8; // 2.4 m
const SHINGLE_TILE_H = 0.145 * 8; // 1.16 m

// Weathered-wood architectural shingles: gray with a warm cast, sun-faded
// unevenly tab to tab, each course throwing a shadow onto the one below.
const SHINGLE_COLORS = [
  '#a49e90', '#ada798', '#9a9486', '#928c7e', '#b2ad9e', '#89836f',
  '#a09a8c', '#b7b2a2',
];

function makeShingleTextures() {
  const cols = 8;
  const rows = 8;
  const cellW = 128;
  const cellH = 62;
  const w = cols * cellW;
  const h = rows * cellH;
  const colorCanvas = newCanvas(w, h);
  const ctx = colorCanvas.getContext('2d');
  const heightCanvas = newCanvas(w, h);
  const hctx = heightCanvas.getContext('2d');
  const rand = seeded(90210);

  for (let row = 0; row < rows; row++) {
    const y = row * cellH;
    // Half-tab offset per course, the way shingles are actually laid, so
    // the keyways never line up into vertical channels.
    const offset = (row % 2) * cellW * 0.5;
    for (let col = -1; col <= cols; col++) {
      const x = col * cellW + offset;
      ctx.fillStyle = pick(SHINGLE_COLORS, rand);
      ctx.fillRect(x, y, cellW - 2, cellH);
      // The laminate: a darker strip along the lower part of each tab, which
      // is what gives architectural shingles their depth from a distance.
      ctx.fillStyle = `rgba(48,45,40,${0.18 + rand() * 0.2})`;
      ctx.fillRect(x, y + cellH * 0.55, cellW - 2, cellH * 0.45);
      ctx.fillStyle = 'rgba(30,28,25,0.55)';
      ctx.fillRect(x + cellW - 2, y, 2, cellH);

      hctx.fillStyle = '#3c3c3c';
      hctx.fillRect(x, y, cellW, cellH * 0.55);
      const proud = 180 + Math.floor(rand() * 40);
      hctx.fillStyle = `rgb(${proud},${proud},${proud})`;
      hctx.fillRect(x, y + cellH * 0.55, cellW - 2, cellH * 0.45);
    }
    // Shadow line cast by this course's butt edge onto the one below.
    ctx.fillStyle = 'rgba(25,23,20,0.5)';
    ctx.fillRect(0, y + cellH - 4, w, 4);
  }

  const granules = Math.floor(w * h * 0.08);
  for (let i = 0; i < granules; i++) {
    ctx.fillStyle = `rgba(${rand() < 0.5 ? '255,255,255' : '0,0,0'},${rand() * 0.11})`;
    ctx.fillRect(rand() * w, rand() * h, 1, 1);
  }

  return {
    map: finishTexture(colorCanvas, true),
    normalMap: heightToNormalTexture(heightCanvas, 1.6),
  };
}

// ── small textures ─────────────────────────────────────────────────────

// Slats deliberately wide and low-contrast. At 7px and half-opacity they
// read as a second, finer muntin grid behind the real one and the windows
// came out looking like greenhouses; in the photos the blinds are just a
// soft horizontal banding you barely resolve from the street.
function makeBlindsTexture() {
  const canvas = newCanvas(32, 128);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#d6d9d2';
  ctx.fillRect(0, 0, 32, 128);
  for (let y = 0; y < 128; y += 13) {
    ctx.fillStyle = 'rgba(126,132,124,0.3)';
    ctx.fillRect(0, y, 32, 2);
  }
  return finishTexture(canvas, true);
}

function makeSpeckleTexture(base, variance, seed) {
  const size = 128;
  const canvas = newCanvas(size, size);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, size, size);
  const rand = seeded(seed);
  for (let i = 0; i < 3000; i++) {
    const dark = rand() > 0.5;
    const v = dark ? 0 : 255;
    ctx.fillStyle = `rgba(${v},${v},${v},${(rand() * variance) / 255})`;
    ctx.fillRect(rand() * size, rand() * size, 1.5, 1.5);
  }
  return finishTexture(canvas, true);
}

// The garage door's raised-panel grid, drawn rather than modelled. Built as
// geometry the panels stand about a centimetre proud, which at any distance
// you actually see this door from is far too subtle to register — the first
// pass had twenty little boxes on the door and the whole thing still read
// as four blank bands. What you actually pick out in the photos is the dark
// groove around each panel and the bevel catching the light, and both of
// those are texture, not shape.
function makeGarageDoorTexture(cols, rows) {
  const w = 640;
  const h = 282;
  const canvas = newCanvas(w, h);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#e8e4da';
  ctx.fillRect(0, 0, w, h);

  const cellW = w / cols;
  const cellH = h / rows;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = c * cellW;
      const y = r * cellH;
      const mx = cellW * 0.1;
      const my = cellH * 0.16;
      // Recessed groove around the panel, then the raised face inside it.
      ctx.fillStyle = '#b5b0a4';
      ctx.fillRect(x + mx, y + my, cellW - mx * 2, cellH - my * 2);
      ctx.fillStyle = '#eeebe1';
      ctx.fillRect(x + mx + 4, y + my + 4, cellW - mx * 2 - 8, cellH - my * 2 - 8);
      // Bevel: the top edge of a raised panel catches the sky, the bottom
      // edge sits in its own shadow.
      ctx.fillStyle = '#f7f5ec';
      ctx.fillRect(x + mx + 4, y + my + 4, cellW - mx * 2 - 8, 3);
      ctx.fillStyle = '#c6c1b4';
      ctx.fillRect(x + mx + 4, y + cellH - my - 7, cellW - mx * 2 - 8, 3);
    }
    // Joint between sections, with the shadow falling on the section below.
    if (r > 0) {
      ctx.fillStyle = '#8f8b81';
      ctx.fillRect(0, r * cellH - 2, w, 4);
    }
  }
  return finishTexture(canvas, true);
}

function makeConcreteTexture() {
  const size = 256;
  const canvas = newCanvas(size, size);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#b6b2a8';
  ctx.fillRect(0, 0, size, size);
  const rand = seeded(4242);
  // Broad tonal drift first — real slabs cure unevenly and stain, and
  // without it the driveway reads as a flat gray card.
  //
  // Every mark is stamped nine times, offset by a full canvas in each
  // direction, so anything crossing an edge comes back on the opposite one.
  // Without that the marks are simply clipped at the border, and since this
  // texture is tiled across every slab in the game, each clipped stain
  // becomes a hard seam repeating on a grid — which is exactly the
  // checkerboard the concrete has been showing. Scaling the UVs correctly
  // did not fix it and could not: the discontinuity is baked into the image,
  // so all a scale change does is resize the squares.
  const wrapped = (draw) => {
    for (let ox = -1; ox <= 1; ox++) {
      for (let oy = -1; oy <= 1; oy++) draw(ox * size, oy * size);
    }
  };
  for (let i = 0; i < 60; i++) {
    const cx = rand() * size;
    const cy = rand() * size;
    // Smaller than before. At up to 70 on a 256 canvas a single stain
    // covered a quarter of the tile, which at 2.4 m per tile is a metre-wide
    // disc — it read as a circular patch rather than as uneven curing.
    const r = 14 + rand() * 34;
    // Halved again in strength below. The driveway photo is a near-uniform
    // pale grey pour — the staining on real concrete is barely there, and
    // anything strong enough to see as a *shape* is wrong however well it
    // tiles.
    const tint = rand() < 0.5 ? '90,88,82' : '206,202,192';
    wrapped((dx, dy) => {
      const grad = ctx.createRadialGradient(cx + dx, cy + dy, 0, cx + dx, cy + dy, r);
      grad.addColorStop(0, `rgba(${tint},0.075)`);
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, size, size);
    });
  }
  // Speckle is 1.5 px and only wraps in the sense that a grain landing on
  // the border needs its other half on the far side; cheap enough to stamp
  // the same way rather than special-case.
  for (let i = 0; i < 9000; i++) {
    const v = rand() > 0.5 ? 0 : 255;
    const x = rand() * size;
    const y = rand() * size;
    const a = rand() * 0.1;
    ctx.fillStyle = `rgba(${v},${v},${v},${a})`;
    wrapped((dx, dy) => ctx.fillRect(x + dx, y + dy, 1.5, 1.5));
  }
  return finishTexture(canvas, true);
}

// ── shared materials ───────────────────────────────────────────────────

const brickTextures = makeMasonryTextures({
  cols: 16, rows: 20, cellW: 64, cellH: 21, jointPx: 3, stagger: 0.5, seed: 12345,
});
// UVs on every brick surface in this file are authored in metres, so one
// repeat of the texture covers exactly one tile's worth of real wall. That
// replaces the old approach of cloning and rescaling three maps for every
// differently-sized wall face with a single shared material: same brick
// size everywhere, a fraction of the GPU state.
[brickTextures.map, brickTextures.normalMap, brickTextures.roughnessMap].forEach((t) => {
  t.repeat.set(1 / BRICK_TILE_W, 1 / BRICK_TILE_H);
});
const BRICK_MAT = new THREE.MeshStandardMaterial({
  map: brickTextures.map,
  color: BRICK_TINT,
  normalMap: brickTextures.normalMap,
  normalScale: new THREE.Vector2(0.85, 0.85),
  roughnessMap: brickTextures.roughnessMap,
  roughness: 1,
  envMapIntensity: MATTE_ENV,
});

// Bricks stood on end. The real house wears a soldier course as a header
// over the garage door and as a band right under the eave all the way
// round — it's the only brick "detailing" on an otherwise plain elevation,
// and leaving it out is part of why the old walls read as a texture swatch
// rather than as masonry someone laid.
const SOLDIER_TILE_W = BRICK_UNIT_H * 16; // 1.072 m
const SOLDIER_TILE_H = BRICK_UNIT_W; // 0.204 m
const soldierTextures = makeMasonryTextures({
  cols: 16, rows: 1, cellW: 40, cellH: 122, jointPx: 3, stagger: 0, seed: 777,
});
[soldierTextures.map, soldierTextures.normalMap, soldierTextures.roughnessMap].forEach((t) => {
  t.repeat.set(1 / SOLDIER_TILE_W, 1 / SOLDIER_TILE_H);
});
const SOLDIER_MAT = new THREE.MeshStandardMaterial({
  map: soldierTextures.map,
  color: BRICK_TINT,
  normalMap: soldierTextures.normalMap,
  normalScale: new THREE.Vector2(0.85, 0.85),
  roughnessMap: soldierTextures.roughnessMap,
  roughness: 1,
  envMapIntensity: MATTE_ENV,
});

const shingleTextures = makeShingleTextures();
[shingleTextures.map, shingleTextures.normalMap].forEach((t) => {
  t.repeat.set(1 / SHINGLE_TILE_W, 1 / SHINGLE_TILE_H);
});
const SHINGLE_MAT = new THREE.MeshStandardMaterial({
  map: shingleTextures.map,
  color: SHINGLE_TINT,
  normalMap: shingleTextures.normalMap,
  normalScale: new THREE.Vector2(0.7, 0.7),
  roughness: 1,
  envMapIntensity: MATTE_ENV,
});

const CONCRETE_TILE = 2.4;
const concreteTexture = makeConcreteTexture();
concreteTexture.repeat.set(1 / CONCRETE_TILE, 1 / CONCRETE_TILE);
// Exported because the driveway doesn't stop at the property line: yard.js
// carries it the rest of the way out to the road, and the seam between the
// two is in plain sight. Anything mapped with this needs UVs in metres.
export const CONCRETE_MAT = new THREE.MeshStandardMaterial({
  map: concreteTexture,
  color: CONCRETE_TINT,
  roughness: 1,
  envMapIntensity: MATTE_ENV,
});

// Fascia, soffit, gutters, window frames, door casings — all the same
// creamy off-white on the real house, and all matte. Anything glossier
// starts clipping the bloom threshold and the trim glows at midday.
const TRIM_MAT = new THREE.MeshStandardMaterial({
  map: makeSpeckleTexture('#e9e5d7', 14, 31),
  color: TRIM_TINT,
  roughness: 0.96,
  envMapIntensity: MATTE_ENV,
});
const SIDING_MAT = new THREE.MeshStandardMaterial({
  map: makeSpeckleTexture('#e4e0d2', 12, 57),
  color: TRIM_TINT,
  roughness: 0.96,
  envMapIntensity: MATTE_ENV,
});
// The ceilings of the two deep recesses — the covered patio and the entry
// alcove. Same cream as the soffit everywhere else, deliberately mixed much
// darker: they sit several metres under a roof with no sky above them, but
// nothing in the lighting model knows that (there's no ambient occlusion —
// see the note on why SSAO is off), so at the trim's own brightness the
// patio came out as a flat pale panel and the recess read as shallow. In
// the reference photo it's the ceiling being in shadow that makes the brick
// piers stand out in front of it.
const RECESS_CEILING_MAT = new THREE.MeshStandardMaterial({
  color: 0x8b8880,
  roughness: 1,
  envMapIntensity: 0.14,
});
const STUCCO_MAT = new THREE.MeshStandardMaterial({
  map: makeSpeckleTexture('#dcd6c7', 16, 99),
  color: TRIM_TINT,
  roughness: 1,
  envMapIntensity: MATTE_ENV,
});
const DOOR_MAT = new THREE.MeshStandardMaterial({
  color: 0xcbc0a6, roughness: 0.8, envMapIntensity: MATTE_ENV,
});
const GARAGE_DOOR_MAT = new THREE.MeshStandardMaterial({
  map: makeGarageDoorTexture(5, 4),
  color: TRIM_TINT,
  roughness: 0.82,
  envMapIntensity: MATTE_ENV,
});
const DARK_METAL_MAT = new THREE.MeshStandardMaterial({
  color: 0x24211d, roughness: 0.45, metalness: 0.55,
});
const GLASS_MAT = new THREE.MeshPhysicalMaterial({
  color: 0x243640,
  roughness: 0.06,
  metalness: 0,
  transparent: true,
  opacity: 0.62,
  clearcoat: 0.6,
});
const BLINDS_MAT = new THREE.MeshStandardMaterial({
  map: makeBlindsTexture(), color: 0xb9b9b9, roughness: 0.95, envMapIntensity: 0.2,
});

// The blinds of a room that has its light on. Identical by day — see
// setHouseWindowsLit, which is what actually turns it warm and emissive
// after dark — so this costs one extra draw call and nothing else.
//
// A separate material rather than one shared one, because a house with
// *every* window lit reads as an office block. Rooms are empty, people go
// to bed. Which windows get it is decided in buildWindowUnit.
const BLINDS_LIT_MAT = new THREE.MeshStandardMaterial({
  map: makeBlindsTexture(), color: 0xb9b9b9, roughness: 0.95, envMapIntensity: 0.2,
});

// Warm tungsten, and brighter than it looks like it needs to be: the glass
// pane in front of these is dark (0x243640) and 62% opaque, so most of what
// this emits is absorbed before it reaches the eye. Tuned through the
// glass, not against it.
export function setHouseWindowsLit(lit) {
  BLINDS_LIT_MAT.color.set(lit ? 0xffcf96 : 0xb9b9b9);
  BLINDS_LIT_MAT.emissive.set(lit ? 0xffa63c : 0x000000);
  BLINDS_LIT_MAT.emissiveIntensity = lit ? 1.7 : 0;
}

// Which windows are lit. A fixed seed, so the same rooms are on every load
// rather than the house reshuffling itself each time you start the game —
// and consumed in build order, which is stable because createHouse builds
// the elevations in a fixed sequence.
const windowLitRand = seeded(0x9d0715);
const LIT_WINDOW_SHARE = 0.55;
// The lamp glass and the string-light bulbs. Emissive at night, plain at
// noon — see setHouseLampsLit.
//
// They used to be emissive around the clock, so every fixture on the house
// read as switched on in full sun. The point lights beside them (see
// lampSpots / nightLights) were already going to zero intensity by day; it
// was only the glass that never noticed.
const LAMP_GLASS_LIT = 0xffbe66;
const BULB_LIT = 0xffe6a8;
const LAMP_GLASS_MAT = new THREE.MeshStandardMaterial({
  color: 0xfff0d0, emissive: LAMP_GLASS_LIT, emissiveIntensity: 1.5, roughness: 0.35,
});
const BULB_MAT = new THREE.MeshStandardMaterial({
  color: 0xfff2cf, emissive: BULB_LIT, emissiveIntensity: 1.6, roughness: 0.4,
});

// Emissive intensity rather than the colour, because these have a bloom
// pass downstream keyed off brightness — dropping the intensity takes them
// out of it cleanly, where darkening the colour would leave them hovering
// around the threshold and flickering into bloom as the exposure moves.
export function setHouseLampsLit(lit) {
  LAMP_GLASS_MAT.emissiveIntensity = lit ? 1.5 : 0;
  BULB_MAT.emissiveIntensity = lit ? 1.6 : 0;
}
const CORD_MAT = new THREE.MeshStandardMaterial({ color: 0x2a2622, roughness: 0.9 });
// Porch screen and kennel mesh are flat translucent panels rather than an
// alpha-cut wire texture: real mesh is sub-pixel at any distance you
// actually play from, so it either aliases into noise or mips away to
// nothing. A tinted sheet reads correctly (you see the porch dimly through
// it) and costs one quad.
// Near-black dyed mulch, which is what's actually in the beds — a mid-brown
// bark read as bare dirt against the brick curb.
const MULCH_MAT = new THREE.MeshStandardMaterial({
  map: makeSpeckleTexture('#2b2320', 46, 8), roughness: 1, envMapIntensity: 0.2,
});
const AC_MAT = new THREE.MeshStandardMaterial({
  color: 0x70746f, roughness: 0.75, metalness: 0.25, envMapIntensity: 0.6,
});
const BIN_MAT = new THREE.MeshStandardMaterial({
  color: 0x2a2d2e, roughness: 0.92, envMapIntensity: MATTE_ENV,
});
const FURNITURE_MAT = new THREE.MeshStandardMaterial({
  color: 0x4a443d, roughness: 0.98, envMapIntensity: MATTE_ENV,
});

// ── geometry helpers ───────────────────────────────────────────────────

// Rewrites a BoxGeometry's UVs from the default 0..1-per-face into metres,
// so the shared brick/shingle/concrete materials tile at a constant
// real-world size no matter what the box's dimensions are. BoxGeometry lays
// its 24 vertices out face by face in the order +x, -x, +y, -y, +z, -z, and
// each face's u and v run across a known pair of the box's own dimensions.
function meterUvs(geo, w, h, d, vOffset = 0) {
  const uv = geo.attributes.uv;
  const spans = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  let i = 0;
  for (let f = 0; f < 6; f++) {
    const [su, sv] = spans[f];
    // Only the four vertical faces get the course offset — on the top and
    // bottom faces "v" runs horizontally and shifting it means nothing.
    const off = f < 2 || f > 3 ? vOffset : 0;
    for (let v = 0; v < 4; v++, i++) {
      uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv + off);
    }
  }
  uv.needsUpdate = true;
  return geo;
}

function meterBox(w, h, d, material, vOffset = 0) {
  return mesh(meterUvs(new THREE.BoxGeometry(w, h, d), w, h, d, vOffset), material);
}

// A brick mass. `baseY` is where the box's bottom sits, and it shifts the
// texture's V so brick courses line up across every separate box of the
// house instead of each one starting a fresh course at its own bottom edge.
function brickBox(w, h, d, baseY = 0) {
  return meterBox(w, h, d, BRICK_MAT, baseY);
}

function concreteBox(w, h, d) {
  return meterBox(w, h, d, CONCRETE_MAT);
}

function trimBox(w, h, d) {
  return mesh(new THREE.BoxGeometry(w, h, d), TRIM_MAT);
}

// A hip roof surface: two trapezoidal slopes meeting at a ridge, with a
// triangular hip at each end. Only the top surface exists — the underside
// is never visible because the boxed soffit and fascia below (addEaveTrim)
// close off the overhang. UVs come out in metres along and up the slope, so
// shingle courses stay level and correctly sized on all four planes.
// Requires halfW >= halfD; every roof here is wider than it is deep.
function buildHipRoofSurface(halfW, halfD, rise) {
  const rw = halfW - halfD; // half the ridge length
  const slope = Math.hypot(1, rise / halfD);
  const positions = [];
  const uvs = [];
  const tri = (pts, uv) => {
    pts.forEach((p, i) => {
      positions.push(p[0], p[1], p[2]);
      uvs.push(uv[i][0], uv[i][1]);
    });
  };

  const e0 = [-halfW, 0, -halfD];
  const e1 = [halfW, 0, -halfD];
  const e2 = [halfW, 0, halfD];
  const e3 = [-halfW, 0, halfD];
  const rA = [-rw, rise, 0];
  const rB = [rw, rise, 0];
  const ridgeV = halfD * slope;

  // Street-facing (-z) slope, then backyard (+z) slope: u runs along x.
  tri([e0, rB, e1], [[e0[0], 0], [rB[0], ridgeV], [e1[0], 0]]);
  tri([e0, rA, rB], [[e0[0], 0], [rA[0], ridgeV], [rB[0], ridgeV]]);
  tri([e2, rA, e3], [[e2[0], 0], [rA[0], ridgeV], [e3[0], 0]]);
  tri([e2, rB, rA], [[e2[0], 0], [rB[0], ridgeV], [rA[0], ridgeV]]);
  // Hip ends: u runs along the eave, which here is z.
  tri([e1, rB, e2], [[e1[2], 0], [rB[2], ridgeV], [e2[2], 0]]);
  tri([e3, rA, e0], [[e3[2], 0], [rA[2], ridgeV], [e0[2], 0]]);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.computeVertexNormals();
  return mesh(geo, SHINGLE_MAT);
}

// A front-facing gable that hips down at its back end — the garage roof.
//
// It has to hip rather than just stop, because of how steep the real one is.
// The garage's outer wall is flush with the side of the house, so its roof
// sits over the low outer edge of the main roof's hip plane; at the pitch
// the photos actually show (about 8:12 against the main roof's 6:12) the
// ridge stands well above that plane, and a squared-off back end would hang
// in the air above the shingles. Hipping it means the ridge descends to
// eave height over its last `halfSpan` of run and buries itself in the main
// roof, which is also how it's framed in reality. `zRidgeEnd` is where the
// ridge starts falling; equal pitch puts the back eave at zRidgeEnd +
// halfSpan.
function buildGableHipRoofSurface(halfSpan, rise, zFront, zRidgeEnd) {
  const zHipEnd = zRidgeEnd + halfSpan;
  const slope = Math.hypot(1, rise / halfSpan);
  const positions = [];
  const uvs = [];
  const tri = (pts, uv) => {
    pts.forEach((p, i) => {
      positions.push(p[0], p[1], p[2]);
      uvs.push(uv[i][0], uv[i][1]);
    });
  };
  const ridgeV = halfSpan * slope;

  // Long slopes: u runs along the ridge, v up the slope.
  const lF = [-halfSpan, 0, zFront];
  const lH = [-halfSpan, 0, zHipEnd];
  const rF = [halfSpan, 0, zFront];
  const rH = [halfSpan, 0, zHipEnd];
  const pF = [0, rise, zFront];
  const pR = [0, rise, zRidgeEnd];
  tri([lF, lH, pR], [[zFront, 0], [zHipEnd, 0], [zRidgeEnd, ridgeV]]);
  tri([lF, pR, pF], [[zFront, 0], [zRidgeEnd, ridgeV], [zFront, ridgeV]]);
  tri([rF, pF, pR], [[zFront, 0], [zFront, ridgeV], [zRidgeEnd, ridgeV]]);
  tri([rF, pR, rH], [[zFront, 0], [zRidgeEnd, ridgeV], [zHipEnd, 0]]);
  // The hip end itself: u along its eave (x), v up the slope.
  tri([lH, rH, pR], [[-halfSpan, 0], [halfSpan, 0], [0, ridgeV]]);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.computeVertexNormals();
  return mesh(geo, SHINGLE_MAT);
}

const FASCIA_H = 0.24;
const SOFFIT_DROP = 0.17;
const EAVE = 0.44;

// The white band that wraps every roof edge: a boxed soffit under the
// overhang, a fascia board at its outer edge, and a gutter hung off that.
// It's most of what you actually read as "roofline" from ground level, and
// the old house had none of it — the shingles simply ended in mid-air.
// A side set to false is one that's buried inside a bigger roof (the back
// of the garage gable). A side given an explicit [from, to] span is one
// that has to stop short of where another roof takes over — the main roof's
// front eave must not run on across the garage's gable, and the main roof's
// side eave must run all the way to the front corner because the garage's
// own side eave ends exactly where it begins.
function addEaveTrim(parent, { x0, x1, z0, z1, y, sides = {} }) {
  const soffitY = y - SOFFIT_DROP;
  const fasciaY = y - FASCIA_H / 2 + 0.05;
  const gutterY = y - 0.1;
  const spec = { nz: true, pz: true, nx: true, px: true, ...sides };
  // Default spans: the ±x runs stop short of the ±z ones so no two soffit
  // panels overlap in the same plane at a corner.
  const span = (v, whole) => (Array.isArray(v) ? v : whole);
  const nz = span(spec.nz, [x0, x1]);
  const pz = span(spec.pz, [x0, x1]);
  const nx = span(spec.nx, [z0 + (spec.nz ? EAVE : 0), z1 - (spec.pz ? EAVE : 0)]);
  const px = span(spec.px, [z0 + (spec.nz ? EAVE : 0), z1 - (spec.pz ? EAVE : 0)]);

  const alongX = (range, z, outward) => {
    const w = range[1] - range[0];
    const cx = (range[0] + range[1]) / 2;
    parent.add(place(trimBox(w, 0.06, EAVE), cx, soffitY, z - outward * EAVE / 2));
    parent.add(place(trimBox(w, FASCIA_H, 0.055), cx, fasciaY, z - outward * 0.028));
    parent.add(place(trimBox(w, 0.12, 0.12), cx, gutterY, z + outward * 0.085));
  };
  const alongZ = (range, x, outward) => {
    const d = Math.max(0.02, range[1] - range[0]);
    const cz = (range[0] + range[1]) / 2;
    parent.add(place(trimBox(EAVE, 0.06, d), x - outward * EAVE / 2, soffitY, cz));
    parent.add(place(trimBox(0.055, FASCIA_H, d), x - outward * 0.028, fasciaY, cz));
    parent.add(place(trimBox(0.12, 0.12, d), x + outward * 0.085, gutterY, cz));
  };

  if (spec.nz) alongX(nz, z0, -1);
  if (spec.pz) alongX(pz, z1, 1);
  if (spec.nx) alongZ(nx, x0, -1);
  if (spec.px) alongZ(px, x1, 1);
}

// White rectangular downspout: an elbow tucking it back under the gutter, a
// straight drop, and a kick-out at the bottom. Built facing +z, then
// rotated for whichever wall it hangs on.
function buildDownspout(height, facing) {
  const g = new THREE.Group();
  g.add(place(trimBox(0.08, height, 0.09), 0, -height / 2, 0));
  g.add(place(trimBox(0.08, 0.09, 0.22), 0, 0.06, 0.13));
  g.add(place(trimBox(0.08, 0.09, 0.22), 0, -height + 0.06, 0.13));
  if (facing === 'nz') g.rotation.y = Math.PI;
  else if (facing === 'nx') g.rotation.y = -Math.PI / 2;
  else if (facing === 'px') g.rotation.y = Math.PI / 2;
  return g;
}

// ── windows and doors ──────────────────────────────────────────────────

const WIN_DEPTH = 0.1;
// How far a window's outer face stands off the brick. The walls are solid
// masses with no cut openings, so anything set flush would be swallowed by
// the wall it sits in; standing the frame slightly proud makes it read as
// the trim casing it is, while the brick soldier course above and rowlock
// sill below do the work of making it look set *into* masonry.
const WIN_PROUD = 0.055;

// A window unit whose origin is the centre of the glass, with +z pointing
// out of the wall. Frame, glass, blinds behind it, a colonial muntin grid
// and a sill — the real windows are white vinyl with grilles in both
// sashes, and the blinds are what make them read as windows rather than as
// dark holes on a sunny day.
function buildWindowUnit(w, h, cols = 2, rows = 3, withSill = true) {
  const g = new THREE.Group();
  const fw = 0.07;
  g.add(place(trimBox(w + fw * 2, fw, WIN_DEPTH), 0, h / 2 + fw / 2, -WIN_DEPTH / 2));
  g.add(place(trimBox(w + fw * 2, fw, WIN_DEPTH), 0, -h / 2 - fw / 2, -WIN_DEPTH / 2));
  g.add(place(trimBox(fw, h, WIN_DEPTH), -w / 2 - fw / 2, 0, -WIN_DEPTH / 2));
  g.add(place(trimBox(fw, h, WIN_DEPTH), w / 2 + fw / 2, 0, -WIN_DEPTH / 2));

  // Rolled once per unit and stashed on the group, so an arched window's
  // extra pane above (buildArchedWindowUnit) matches the rest of its own
  // window instead of being lit independently — half a window lit is the
  // one arrangement that looks like a bug rather than a house.
  const blindsMat = windowLitRand() < LIT_WINDOW_SHARE ? BLINDS_LIT_MAT : BLINDS_MAT;
  g.userData.blindsMat = blindsMat;

  g.add(place(trinket(new THREE.PlaneGeometry(w, h), blindsMat), 0, 0, -0.05));
  g.add(place(trinket(new THREE.PlaneGeometry(w, h), GLASS_MAT), 0, 0, -0.035));

  for (let i = 1; i < cols; i++) {
    const bar = trinket(new THREE.BoxGeometry(0.032, h, 0.02), TRIM_MAT);
    g.add(place(bar, -w / 2 + (w * i) / cols, 0, -0.02));
  }
  for (let i = 1; i < rows; i++) {
    const bar = trinket(new THREE.BoxGeometry(w, 0.032, 0.02), TRIM_MAT);
    g.add(place(bar, 0, -h / 2 + (h * i) / rows, -0.02));
  }
  if (withSill) {
    const sill = trimBox(w + 0.22, 0.05, 0.16);
    sill.position.set(0, -h / 2 - fw - 0.02, 0.02);
    sill.rotation.x = -0.07;
    g.add(sill);
  }
  return g;
}

// The arched heads over the three front windows, built as segmental arches
// (a circle squashed vertically) rather than semicircles: the real ones
// rise only about a third of their half-width, and a full half-round reads
// as a completely different, much fancier house.
function archShape(halfW, rise, bottom) {
  const shape = new THREE.Shape();
  const segs = 16;
  shape.moveTo(-halfW, bottom);
  shape.lineTo(-halfW, 0);
  for (let i = 0; i <= segs; i++) {
    const a = Math.PI - (Math.PI * i) / segs;
    shape.lineTo(Math.cos(a) * halfW, Math.sin(a) * rise);
  }
  shape.lineTo(halfW, bottom);
  shape.lineTo(-halfW, bottom);
  return shape;
}

function buildArchedWindowUnit(w, h, rise, cols = 2, rows = 3) {
  const g = buildWindowUnit(w, h, cols, rows);
  const halfW = w / 2;
  const fw = 0.07;

  const glassGeo = new THREE.ShapeGeometry(archShape(halfW, rise, -0.02), 18);
  g.add(place(trinket(glassGeo, g.userData.blindsMat), 0, h / 2, -0.05));
  g.add(place(trinket(glassGeo.clone(), GLASS_MAT), 0, h / 2, -0.035));

  // The white arch frame: the band between two arches, extruded to the same
  // depth as the rest of the frame. The inner arch's bottom edge is kept
  // strictly inside the outer's so the triangulator gets a clean hole.
  const outer = archShape(halfW + fw, rise + fw, -0.12);
  outer.holes.push(new THREE.Path(archShape(halfW, rise, -0.06).getPoints(24)));
  const frame = mesh(
    new THREE.ExtrudeGeometry(outer, { depth: WIN_DEPTH, bevelEnabled: false }),
    TRIM_MAT
  );
  g.add(place(frame, 0, h / 2, -WIN_DEPTH));

  // Radiating muntins springing from the centre of the arch.
  for (let i = 1; i < 3; i++) {
    const a = Math.PI - (Math.PI * i) / 3;
    const bar = trinket(new THREE.BoxGeometry(0.03, rise, 0.02), TRIM_MAT);
    bar.position.set((Math.cos(a) * halfW) / 2, h / 2 + (Math.sin(a) * rise) / 2, -0.02);
    bar.rotation.z = a - Math.PI / 2;
    g.add(bar);
  }
  return g;
}

const FACING_ROT = { nz: Math.PI, pz: 0, nx: -Math.PI / 2, px: Math.PI / 2 };
const FACING_OUT = { nz: [0, -1], pz: [0, 1], nx: [-1, 0], px: [1, 0] };

// Places a window (or door) on a wall facing one of the four cardinal
// directions, given the coordinates of the wall face itself — callers say
// "on the east wall at z = 1.2" rather than doing the rotation and
// stand-off bookkeeping every time.
function addOnWall(parent, unit, { x, y, z, facing, proud = WIN_PROUD }) {
  const [ox, oz] = FACING_OUT[facing];
  unit.rotation.y = FACING_ROT[facing];
  unit.position.set(x + ox * proud, y, z + oz * proud);
  parent.add(unit);
}

// A brick rowlock sill under a window and a soldier course over it. Both
// are on the real house, and both are what stop a window from looking like
// a sticker on a flat wall.
// `h` is the height of the rectangular opening; `archRise` lifts the header
// clear of an arched head without dragging the sill down with it.
function addWindowSurround(parent, { x, y, z, w, h, facing, archRise = 0, sill = true }) {
  const [ox, oz] = FACING_OUT[facing];
  const alongX = facing === 'nz' || facing === 'pz';
  const headW = w + 0.28;
  const headY = y + h / 2 + archRise + BRICK_UNIT_W / 2 + 0.13;
  const sillY = y - h / 2 - 0.13;

  const head = alongX
    ? meterBox(headW, BRICK_UNIT_W, 0.06, SOLDIER_MAT)
    : meterBox(0.06, BRICK_UNIT_W, headW, SOLDIER_MAT);
  parent.add(place(head, x + ox * 0.02, headY, z + oz * 0.02));

  if (sill) {
    const s = alongX
      ? brickBox(w + 0.24, 0.09, 0.12, sillY)
      : brickBox(0.12, 0.09, w + 0.24, sillY);
    parent.add(place(s, x + ox * 0.03, sillY, z + oz * 0.03));
  }
}

function buildFrenchDoorPair(w, h) {
  const g = new THREE.Group();
  const leafW = w / 2 - 0.02;
  [-1, 1].forEach((side) => {
    const leaf = buildWindowUnit(leafW, h, 2, 5, false);
    leaf.position.x = (side * w) / 4;
    g.add(leaf);
  });
  g.add(place(trimBox(0.07, h + 0.14, WIN_DEPTH), 0, 0, -WIN_DEPTH / 2));
  return g;
}

// The front door: almond, with the tall oval leaded-glass light the real
// one has, and its wreath.
function buildFrontDoor() {
  const g = new THREE.Group();
  const w = 0.95;
  const h = 2.06;
  g.add(place(mesh(new THREE.BoxGeometry(w, h, 0.07), DOOR_MAT), 0, 0, -0.035));
  g.add(place(trimBox(w + 0.2, 0.1, 0.14), 0, h / 2 + 0.05, -0.02));
  [-1, 1].forEach((s) => {
    g.add(place(trimBox(0.1, h + 0.1, 0.14), (s * (w + 0.1)) / 2, 0, -0.02));
  });

  // The light: a tall oval, and *tall* is the whole character of it. The
  // first version was a 0.34 x 0.65 ellipse sitting in the middle of the
  // door, which at any distance read as a porthole. On the real door the
  // glass runs from knee height to just under the top rail — about 1.2 m of
  // a 2.06 m door, well over half its height — and it's that proportion,
  // not the shape, that makes it read as a front door rather than a hatch.
  const ovalW = 0.27;
  const ovalH = 0.60;
  const oval = trinket(new THREE.CircleGeometry(1, 28), GLASS_MAT);
  oval.scale.set(ovalW, ovalH, 1);
  g.add(place(oval, 0, 0.16, 0.006));
  // Two rings: a wide bevel round the glass and a thin bead inside it,
  // which is what the moulded surround on the real one does.
  const ovalTrim = trinket(new THREE.RingGeometry(1, 1.13, 28), TRIM_MAT);
  ovalTrim.scale.set(ovalW, ovalH, 1);
  g.add(place(ovalTrim, 0, 0.16, 0.008));
  const ovalBead = trinket(new THREE.RingGeometry(0.93, 0.97, 28), TRIM_MAT);
  ovalBead.scale.set(ovalW, ovalH, 1);
  g.add(place(ovalBead, 0, 0.16, 0.009));

  // The leaded pattern inside the glass — a long vertical came with a
  // diamond at its foot, which is the figure in the close-up. Thin brass
  // strips rather than a texture, so it catches light like the real
  // leading does.
  const cameMat = new THREE.MeshStandardMaterial({
    color: 0xc0a468, roughness: 0.45, metalness: 0.6,
  });
  const came = (wid, hei, x, y, rot) => {
    const bar = trinket(new THREE.PlaneGeometry(wid, hei), cameMat);
    bar.rotation.z = rot;
    g.add(place(bar, x, y, 0.0105));
  };
  came(0.008, ovalH * 1.15, 0, 0.16, 0);
  // The diamond: four short bars meeting at their ends, low in the glass.
  const dY = 0.16 - ovalH * 0.55;
  const dS = 0.085;
  [[-1, 1], [1, 1], [-1, -1], [1, -1]].forEach(([sx, sy]) => {
    came(0.008, dS * 1.5, (sx * dS) / 2, dY + (sy * dS) / 2, (sx * sy * Math.PI) / 4);
  });

  const wreath = trinket(
    new THREE.TorusGeometry(0.17, 0.045, 6, 16),
    new THREE.MeshStandardMaterial({ color: 0x27301f, roughness: 0.98, envMapIntensity: MATTE_ENV })
  );
  g.add(place(wreath, 0, 0.28, 0.04));

  const brass = new THREE.MeshStandardMaterial({
    color: 0xb08d4a, roughness: 0.35, metalness: 0.7,
  });
  const knob = trinket(new THREE.SphereGeometry(0.035, 8, 6), brass);
  g.add(place(knob, w / 2 - 0.13, -0.16, 0.03));
  // Deadbolt above the knob — a keypad one on the real door, so it's a
  // small raised plate rather than a cylinder.
  g.add(place(
    trinket(new THREE.BoxGeometry(0.07, 0.11, 0.02), brass),
    w / 2 - 0.13, 0.02, 0.025
  ));
  // Brass threshold strip at the foot, which is surprisingly visible in
  // the close-up and reads as the door being a real assembly.
  g.add(place(
    trinket(new THREE.BoxGeometry(w, 0.045, 0.05), brass),
    0, -h / 2 + 0.02, 0.01
  ));
  return g;
}

// Steel raised-panel garage door: four sections of five panels, all of it
// carried by makeGarageDoorTexture above rather than by geometry.
function buildGarageDoor(w, h) {
  return mesh(new THREE.BoxGeometry(w, h, 0.07), GARAGE_DOOR_MAT);
}

// The arched louvered attic vent in the garage gable. Origin at the centre
// of the opening's springline, +z outward.
function buildGableVent(w, bodyH, rise) {
  const g = new THREE.Group();
  const halfW = w / 2;
  const outline = archShape(halfW, rise, -bodyH);
  g.add(place(
    mesh(
      new THREE.ShapeGeometry(outline, 16),
      new THREE.MeshStandardMaterial({ color: 0x191614, roughness: 0.95 })
    ),
    0, 0, 0
  ));

  const frameShape = archShape(halfW + 0.06, rise + 0.06, -bodyH - 0.06);
  frameShape.holes.push(new THREE.Path(archShape(halfW, rise, -bodyH).getPoints(24)));
  g.add(place(
    mesh(new THREE.ExtrudeGeometry(frameShape, { depth: 0.08, bevelEnabled: false }), TRIM_MAT),
    0, 0, 0
  ));

  const slats = Math.floor((bodyH + rise) / 0.08);
  for (let i = 0; i < slats; i++) {
    const y = -bodyH + 0.05 + i * 0.08;
    // Slats narrow inside the arch so they stop at its curve.
    const halfAt = y <= 0 ? halfW : halfW * Math.sqrt(Math.max(0, 1 - (y / rise) ** 2));
    if (halfAt < 0.04) continue;
    const slat = trinket(new THREE.BoxGeometry(halfAt * 2, 0.045, 0.05), TRIM_MAT);
    slat.position.set(0, y, 0.035);
    slat.rotation.x = -0.5;
    g.add(slat);
  }
  return g;
}

// Bronze coach lantern: a tapered four-sided glass cage under a little
// pyramid cap, on a wall arm. There are four of these on the house (both
// sides of the garage door, the service door, the back porch) and they're
// emissive rather than real lights — four point lights purely for
// decoration would be silly, and the bloom pass makes them glow at dusk on
// its own.
function buildSconce() {
  const g = new THREE.Group();
  g.add(place(mesh(new THREE.BoxGeometry(0.13, 0.2, 0.035), DARK_METAL_MAT), 0, 0, 0.017));
  g.add(place(mesh(new THREE.BoxGeometry(0.05, 0.04, 0.1), DARK_METAL_MAT), 0, 0.06, 0.07));
  const cage = mesh(new THREE.CylinderGeometry(0.075, 0.095, 0.19, 4), LAMP_GLASS_MAT);
  cage.rotation.y = Math.PI / 4;
  g.add(place(cage, 0, -0.03, 0.13));
  const cap = mesh(new THREE.ConeGeometry(0.115, 0.075, 4), DARK_METAL_MAT);
  cap.rotation.y = Math.PI / 4;
  g.add(place(cap, 0, 0.1, 0.13));
  g.add(place(trinket(new THREE.SphereGeometry(0.022, 6, 5), DARK_METAL_MAT), 0, -0.135, 0.13));
  return g;
}

// ── the house's own dimensions ─────────────────────────────────────────

// Feet to metres. Every dimension below is taken from the county
// assessor's floor-plan sketch, so they're written in the units the sketch
// uses rather than converted by hand — that way the numbers in the code
// still match the numbers on the drawing when someone checks them.
const FT = 0.3048;

// 50 x 31 ft of main body. The sketch's areas corroborate it: 50 x 31 is
// 1550 sq ft, less the covered porch notch and plus the bay and east-end
// steps, which lands on the stated 1508 sq ft of living area.
const W = FT * 50;
const D = FT * 31;
const HALF_W = W / 2;
const HALF_D = D / 2;
const WALL_H = 2.72;
const PITCH = 0.5; // 6:12, matching the main roof in the photos

// The covered patio is a notch cut out of the back of the house rather than
// a lean-to stuck onto it: the main roof runs straight over it with no
// change in eave height, the brick piers stand on the same line as the back
// wall, and the patio ceiling is the house's own soffit. Building it as a
// notch means the roof needs no special case.
//
// Open, per the owner's preferred reference shot — the screen panels and
// the chain-link dog run that used to close it in are gone. What's left is
// three brick piers dividing two bays, a white-sided back wall (the one
// wall on the house that isn't brick, along with the entry alcove), French
// doors, and the string lights.
const PORCH = { xMin: -FT * 10, xMax: FT * 10, depth: FT * 11 };
const PORCH_BACK_Z = HALF_D - PORCH.depth;

// The street elevation, divided exactly as the assessor's sketch has it:
// 20 ft of garage, 4 ft of entry, 17 ft of window bay, 9 ft of east end.
// They sum to the full 50 ft width, and each one steps forward by a
// different amount — which is the whole character of the front and the
// thing the earlier eyeballed version flattened out.
const GARAGE = { xMin: HALF_W - FT * 20, xMax: HALF_W, proj: FT * 23 };
const ALCOVE = { xMin: HALF_W - FT * 24, xMax: HALF_W - FT * 20 };
const BAY = { xMin: HALF_W - FT * 41, xMax: HALF_W - FT * 24, proj: FT * 9 };
const EAST_END = { xMin: -HALF_W, xMax: HALF_W - FT * 41, proj: FT * 4 };

const BAY_FRONT_Z = -HALF_D - BAY.proj;
const EAST_FRONT_Z = -HALF_D - EAST_END.proj;
const GARAGE_FRONT_Z = -HALF_D - GARAGE.proj;
const GARAGE_CX = (GARAGE.xMin + GARAGE.xMax) / 2;
const GARAGE_W = GARAGE.xMax - GARAGE.xMin;
// How far the covered stoop reaches out from the door — the sketch's 28 sq
// ft porch is 4 x 7, so the entry is roofed for 7 ft and the rest of the
// slot beside the garage is open to the sky.
const STOOP_DEPTH = FT * 7;

// The main roof covers the body and the east end's small step, and the
// window bay gets its own hip in front of it. It can't simply be stretched
// forward over the bay any more: at 9 ft of projection that would leave a
// 3 m overhang hanging off the entry wall and the east end.
const ROOF_Z0 = EAST_FRONT_Z - EAVE;
const ROOF_Z1 = HALF_D + EAVE;
const ROOF_HALF_W = HALF_W + EAVE;
const ROOF_HALF_D = (ROOF_Z1 - ROOF_Z0) / 2;
const ROOF_CZ = (ROOF_Z0 + ROOF_Z1) / 2;
const ROOF_RISE = PITCH * ROOF_HALF_D;
const ROOF_Y = WALL_H + 0.05;

// The bay's own hip roof, tied into the main one. Its back edge runs far
// enough under the main roof that the cut end is buried.
const BAY_ROOF = {
  x0: BAY.xMin - EAVE,
  x1: BAY.xMax + EAVE,
  z0: BAY_FRONT_Z - EAVE,
  z1: -3.0,
};

// The planting bed's outer edge, as a polyline in world x/z.
//
// It was one arc — a single centre and three radii for the whole thing —
// and that was wrong twice over. The real bed runs **straight** along the
// front of the window bay and only starts curving once it's past the
// windows, wrapping the corner where the wall steps back to the east end.
// A pure arc bows out in front of the windows, where it should be dead
// straight, and cuts the corner where it should swing wide.
//
// So: a straight run at the bay's bed line, a curve round the corner, and a
// straight run at the east end's bed line. The curve is a quadratic Bézier
// rather than a circular arc, because the two straights it joins are at
// different depths and a circle can only meet both tangentially at one
// specific radius — the Bézier just takes the corner as its control point
// and is tangent to both by construction.
// How deep the planting bed is against the front wall.
//
// The bed sits *between* the brick and the sidewalk — wall, bed, walk,
// lawn — so the walk in front of the bay and the east end has to start
// where the bed ends. It used to start at the brick with the bed drawn on
// top of it, and a comment called that invisible. It isn't: the brick curb
// ran straight across the concrete.
//
// Declared here rather than beside PERIMETER, which is its other consumer
// and sits 270 lines further down. BAY_BED_Z below reads it at module load,
// and a `const` read before its declaration is a temporal-dead-zone throw
// that kills the module mid-load — which surfaces as a loading screen that
// never finishes, with nothing in the console. Fourth time this session.
const FRONT_BED_W = 1.3;

const BAY_BED_Z = BAY_FRONT_Z - FRONT_BED_W;
const EAST_BED_Z = EAST_FRONT_Z - FRONT_BED_W;
// Where the bed starts and stops, and where the corner turn happens.
//
// All three were overshooting and all three put mulch on concrete:
//
//   * the west end ran WALK_W past the bay and straight across the path to
//     the front door. It stops at the bay's own jamb now — in the photos
//     the entry walk is clear concrete the whole way.
//   * the east end ran WALK_W past the house corner and out into the side
//     walk. Photo 3 settles that one: the east elevation has no bed at all,
//     just lawn to a narrow strip of concrete, so the bed has to finish at
//     the front corner and not turn it.
//   * the curve started 0.55 short of the bay's east jamb, so the bed was
//     already bending while it was still in front of the windows. The
//     straight now runs the full length of them and only turns past the
//     last one.
const BED_FROM_X = BAY.xMax;
// Where the straight run ends and the arc begins — past the last window.
const BED_CURVE_FROM_X = BAY.xMin + 0.3;

// The arc is a *constant* radius, and it is not chosen — it is forced.
//
// The curve has to leave the straight tangentially (or there's a visible
// kink where they meet) and arrive at the east end's front wall running
// straight into it. A circular arc that does both is a quarter circle, and
// a quarter circle that climbs from the bay's bed line to the east end's
// wall can only have one radius: the distance between them. So the radius
// falls out of the two walls' offset rather than being a number anyone
// picks, and it re-derives itself if the bay's projection ever changes.
//
// This replaces a quadratic Bézier, which was the wrong tool. A Bézier
// meets both tangents happily but its curvature varies along its length —
// it is flattest at the ends and tightest in the middle — and the owner's
// description was "a constant curve".
const BED_ARC_R = EAST_FRONT_Z - BAY_BED_Z;
// Where the arc lands on the east end's wall, and therefore where the bed
// stops. Comes out just short of the house's east corner, which is where
// the curb ends in the photo.
const BED_TO_X = BED_CURVE_FROM_X - BED_ARC_R;

function frontBedOuterEdge() {
  const pts = [];
  // Straight along the bay, from the front-door end.
  pts.push([BED_FROM_X, BAY_BED_Z]);
  pts.push([BED_CURVE_FROM_X, BAY_BED_Z]);
  // Quarter circle, centred inland of where the straight ends. Sweeping
  // from due -z round to due -x takes the edge from running along the bay
  // to running straight into the east end's wall.
  const cx = BED_CURVE_FROM_X;
  const cz = BAY_BED_Z + BED_ARC_R;
  const STEPS = 16;
  for (let i = 1; i <= STEPS; i++) {
    const a = (-90 - 90 * (i / STEPS)) * (Math.PI / 180);
    pts.push([cx + Math.cos(a) * BED_ARC_R, cz + Math.sin(a) * BED_ARC_R]);
  }
  return pts;
}

// The wall line the bed backs onto: bay front, the bay's east return, then
// as far along the east end's front as the arc reaches. This is the bed's
// inner edge, and tracing it properly is what lets the bed meet the brick
// instead of being pushed inside it and hoping the overlap is hidden.
function frontBedInnerEdge() {
  return [
    [BED_FROM_X, BAY_FRONT_Z],
    [BAY.xMin, BAY_FRONT_Z],
    [BAY.xMin, EAST_FRONT_Z],
    [BED_TO_X, EAST_FRONT_Z],
  ];
}

// Outward normal at a point on the bed's outer edge — perpendicular to the
// local run, pointing away from the house.
function frontBedOutward(pts, i) {
  const a = pts[Math.max(0, i - 1)];
  const b = pts[Math.min(pts.length - 1, i + 1)];
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const len = Math.hypot(dx, dz) || 1;
  return [-dz / len, dx / len];
}

// How far the front walk runs *past* each end of the planting bed.
//
// The bed stops where the arc lands on the east wall, and the walk used to
// stop with it — which left a gap between the end of the front walk and the
// perimeter walk coming round the corner, with lawn showing through between
// two pieces of concrete that plainly ought to be one. Running the strip on
// along its own end tangent overlaps the perimeter instead, so the two
// merge. The extension is walk only; the bed itself still ends where it
// ends, or mulch would spill round the corner with it.
const FRONT_WALK_RUN_ON = 2.6;

// Continues a polyline past both ends along the direction it was already
// heading, so an extended strip stays parallel to the run it extends.
function extendPolylineEnds(pts, d) {
  const n = pts.length;
  const dir = (from, to) => {
    const dx = to[0] - from[0];
    const dz = to[1] - from[1];
    const len = Math.hypot(dx, dz) || 1;
    return [dx / len, dz / len];
  };
  const head = dir(pts[1], pts[0]);
  const tail = dir(pts[n - 2], pts[n - 1]);
  return [
    [pts[0][0] + head[0] * d, pts[0][1] + head[1] * d],
    ...pts,
    [pts[n - 1][0] + tail[0] * d, pts[n - 1][1] + tail[1] * d],
  ];
}

// The walk's inner edge: the bed's outer edge, run on past both ends.
function frontWalkInnerEdge() {
  return extendPolylineEnds(frontBedOuterEdge(), FRONT_WALK_RUN_ON);
}

// The walk's outer edge: that same line pushed FRONT_WALK_W away from the
// house. Shared by the mesh that draws the walk and by isHousePaved, which
// is the point — the grass mask drifting away from the geometry it is
// supposed to mask is exactly the bug this fixes.
function frontWalkOuterEdge() {
  const inner = frontWalkInnerEdge();
  return inner.map(([x, z], i) => {
    const [nx, nz] = frontBedOutward(inner, i);
    return [x + nx * FRONT_WALK_W, z + nz * FRONT_WALK_W];
  });
}

const DRIVEWAY_END_Z = GARAGE_FRONT_Z - FT * 14;
const APRON_X1 = HALF_W + FT * 9;
// The back walk is as wide as the parking run on the garage side, not the
// 3 ft strip the rest of the perimeter gets. It's the width of a patio in
// the photos — people stand on it — and at 3 ft it read as a path.
// Walk widths. Declared up here rather than beside PERIMETER, which is
// their main consumer 200 lines below, because BACK_WALK_Z1 immediately
// under this reads PARK_W at module load — and a `const` read before its
// declaration is a temporal-dead-zone throw that kills the module and
// shows up only as a loading screen that never finishes.
//
// That is the fifth time this file has done this to me in one session. The
// pattern is always the same: a constant gets used by something declared
// earlier than the block it was written in. If you add another, put it
// above its first *use*, not next to its most obvious relative.
// How generously the concrete turns every corner. See where it's used.
const WALK_CORNER_R = 2.4;
// The walk that rings the house. Was 3 ft, which is a service path — too
// mean for the run down the side that you actually walk to get to the back,
// and it made the wide back run land as a step rather than a flare. Carried
// up by the same 1.55x the front walk got, so front, sides and back now
// read as one piece of concrete that changes width rather than three.
const WALK_W = FT * 4.65;
// The front walk is wider than the 3 ft strip that rings the rest of the
// house. It's the approach to the front door and the piece you stand on,
// and at WALK_W it read as a service path squeezed between the bed and the
// lawn rather than as the front walk.
//
// Declared here, immediately after the constant it is derived from, and not
// up beside the front-walk code where it reads better. Putting it there is
// what the file's own warning is about: it was a `const` evaluated at module
// load reading a `WALK_W` declared 26 lines further down, which throws a
// temporal-dead-zone ReferenceError and shows up only as a loading screen
// that never finishes. The functions around it get away with it because they
// read WALK_W when called; a const does not.
// Now the same as the rest of the ring. It was 1.55x while the ring was
// still 3 ft; widening the ring to match is what the owner asked for, so
// keeping a multiplier here would just put the front back out of step.
// Left as its own name so the two can diverge again without hunting.
const FRONT_WALK_W = WALK_W;
const PARK_W = FT * 9;

const BACK_WALK_Z1 = HALF_D + PARK_W;

// There is no back patio, despite the assessor's sketch labelling 457 sq ft
// of "Patio" back here. That figure is the sidewalk: the sketch measures the
// concrete round the back and down the garage side and calls the total a
// patio, so building it as a slab on top of the perimeter walk produced a
// second, much deeper apron jutting into the lawn that doesn't exist. The
// walk (and the wide parking run on the garage side) is the whole of it.

// Where the house sits in the world, expressed as where the back wall lands.
//
// Moved 6 m back off the road (-7.5 to -1.5) to match the satellite view,
// which shows a longer driveway and a much shallower back yard than this had.
// Both come from the one number: the front of the lot grows from about 19 m to
// about 25 m and the back yard shrinks from about 25 m to about 19 m, since the
// road (ROAD_Z in yard.js) and the tree line (inOpenArea) both stay put. Doing
// it this way rather than pushing the road out keeps the world the same size,
// which matters — grass is 97% of world generation, so a bigger world is
// directly a slower load.
//
// Most things follow this on their own: yard.js derives TERRAIN_CENTER_Z from
// it (so the graded pad, the lawn shading and the mown radius all move too) and
// the driveway run is measured from HOUSE_DRIVEWAY below. What does *not*
// follow is anything with a hardcoded world z — the fire pit, the hammock, both
// characters' spawns and YARD_BOUNDS. Those were checked against the new
// position rather than moved: the pit ends up 6.5 m off the back wall instead
// of 12.5 m, which suits the shallower yard.
export const HOUSE_Z = -1.5 - HALF_D;

// Where the driveway leaves the property, so yard.js can pick it up and
// carry it out to the road without either file guessing: the centreline it
// runs on, how wide the slab is where it hands over, the world z it stops
// at, and how far its surface stands above the house's own flat pad.
export const HOUSE_DRIVEWAY = {
  x: GARAGE_CX,
  halfWidth: 2.5,
  // Half-width of the slab in front of the garage doors. The yard-side
  // driveway needs it so it can leave the house at the apron's own width
  // instead of stepping straight in to its running width.
  apronHalfWidth: (GARAGE_W + WALK_W * 2) / 2,
  endZ: HOUSE_Z + DRIVEWAY_END_Z,
  // The top of the driveway slab, above the house's graded pad. Must equal
  // the SLAB thickness the flatwork is actually built at (0.05) — it was
  // 0.1, which put yard.js's continuation half a slab proud of the concrete
  // it joins. With the road-clearance offset on top that came to a 9.5 cm
  // lip across the mouth of the drive: you saw the step's own side face as
  // a line, and daylight past it at the edges.
  surfaceY: 0.05,
};

// The concrete walk along the back of the house — a safe place to put
// anything that needs to be outside the building but next to it.
export const HOUSE_BACK_WALK_Z = HOUSE_Z + HALF_D + 0.7;

// ── the roof ladder ────────────────────────────────────────────────────
//
// A fixed roof ladder bolted to the back wall, east of the covered patio.
// It's on the east side because the back wall only exists either side of
// the patio notch (see MASSES) and the west half is the garage end, where
// the bins and the condenser already stand.
//
// Everything about where it is lives here rather than in main.js, because
// main.js needs three different things from it — where to raycast for a
// click, where to stand to start climbing, and what height to arrive at —
// and all three have to agree with the rungs that actually got built.
const LADDER_X = -5.6;
const LADDER_HALF_W = 0.21;
// It leans rather than being bolted flat to the brick, and that isn't
// styling — the eave overhangs the wall by EAVE (0.44 m), so a ladder
// standing against the wall runs straight into the underside of the soffit
// and can never reach the roof at all. Leaning puts its top *outside* the
// overhang, at the edge of the shingles, which is also where a real one
// goes.
const LADDER_LEAN = 0.16;
const LADDER_LENGTH = 3.35;
// Local z of the foot. The top then lands at foot - sin(lean) * length,
// which needs to clear HALF_D + EAVE — that's the constraint this number
// exists to satisfy.
const LADDER_FOOT_Z = HALF_D + 1.02;
const LADDER_TOP_Z = LADDER_FOOT_Z - Math.sin(LADDER_LEAN) * LADDER_LENGTH;
const LADDER_TOP_Y = Math.cos(LADDER_LEAN) * LADDER_LENGTH;

// The chimney, in world coordinates, so main.js can stop her walking
// through it up on the roof.
//
// Deliberately not in HOUSE_SOLIDS. That list is the building's footprint
// and is checked only at ground level — `clampToWalkable` skips it entirely
// while `onRoof`, because up there you're above the walls and treating them
// as solid would make the whole roof unreachable. The chimney is the one
// piece of the house that is still solid when you're standing on top of it,
// so it needs its own test rather than an entry in that list.
//
// The stack is 0.74 x 0.64 with a slightly wider cap; the half-extents here
// take the cap and add a little, since a chimney you can clip the corner of
// reads worse than one you stop a few centimetres short of.
export const HOUSE_CHIMNEY = {
  x: -3.4,
  z: HOUSE_Z - 2.3,
  halfX: 0.52,
  halfZ: 0.47,
};

export const HOUSE_LADDER = {
  x: LADDER_X,
  halfWidth: LADDER_HALF_W,
  footZ: HOUSE_Z + LADDER_FOOT_Z,
  topZ: HOUSE_Z + LADDER_TOP_Z,
  topY: LADDER_TOP_Y,
  // Where she stands to start the climb — just behind the foot, facing the
  // house.
  standZ: HOUSE_Z + LADDER_FOOT_Z + 0.5,
  // Where she ends up on the roof: back from the eave rather than balanced
  // on its very edge, which both looks precarious and puts her half a step
  // from falling off the moment she moves.
  arriveZ: HOUSE_Z + ROOF_Z1 - 0.9,
};

// Height of the main hip roof's surface at a world point, in the house's
// own local y (so callers add the house's ground height to it). Returns
// null anywhere off the main roof.
//
// This is the same equal-pitch hip that buildHipRoofSurface draws, solved
// rather than sampled: every plane of it descends from the ridge at the
// same rate, so the height only depends on whichever of the two distances
// — sideways from the ridge line, or inward from the hip end — is greater.
//
// Only the *main* roof. The garage and bay hips stand proud of it at the
// front, so walking there would put you inside them; the back slope, which
// is the one the ladder reaches and the whole point of going up, is clear.
// Height of the eaves above the house's own base, so main.js's camera
// cast knows how high the walls go without keeping its own copy of the
// number.
export const HOUSE_EAVE_Y = ROOF_Y;

export function houseRoofHeight(worldX, worldZ) {
  const u = worldX;
  const v = worldZ - HOUSE_Z - ROOF_CZ;
  if (Math.abs(u) > ROOF_HALF_W || Math.abs(v) > ROOF_HALF_D) return null;
  const rw = ROOF_HALF_W - ROOF_HALF_D;
  const inward = Math.max(Math.abs(v), Math.abs(u) - rw);
  const t = Math.min(1, Math.max(0, inward / ROOF_HALF_D));
  return ROOF_Y + ROOF_RISE * (1 - t);
}

// Built lying along its own +y and then tipped back by LADDER_LEAN, so the
// rails and rungs stay square to each other and only the group rotates.
function buildRoofLadder() {
  const group = new THREE.Group();

  const railGeo = new THREE.BoxGeometry(0.052, LADDER_LENGTH, 0.07);
  [-1, 1].forEach((side) => {
    const rail = mesh(railGeo.clone(), DARK_METAL_MAT);
    rail.position.set(side * LADDER_HALF_W, LADDER_LENGTH / 2, 0);
    group.add(rail);
  });

  const rungGeo = new THREE.CylinderGeometry(0.019, 0.019, LADDER_HALF_W * 2, 8);
  rungGeo.rotateZ(Math.PI / 2);
  // Starts a rung's height off the ground and stops short of the very top,
  // the way a ladder's rails always run past its last rung.
  for (let y = 0.26; y < LADDER_LENGTH - 0.22; y += 0.28) {
    const rung = mesh(rungGeo.clone(), DARK_METAL_MAT);
    rung.position.set(0, y, 0);
    group.add(rung);
  }

  // Rubber feet, so it isn't a pair of rails ending in mid-air on the
  // concrete.
  [-1, 1].forEach((side) => {
    const foot = mesh(new THREE.BoxGeometry(0.075, 0.05, 0.13), DARK_METAL_MAT);
    foot.position.set(side * LADDER_HALF_W, 0.025, 0.02);
    group.add(foot);
  });

  // An invisible slab filling the ladder's outline, purely to be clicked.
  //
  // A ladder is mostly holes — two 5 cm rails and a rung every 28 cm — so
  // raycasting the real geometry means most of a click aimed squarely at it
  // sails between the rungs and hits the brick behind, and you get a
  // walk-to-the-wall instead of a climb. Which is exactly what it did.
  //
  // Zero opacity rather than `visible = false`: three raycasts invisible
  // objects inconsistently across versions, and depending on that is a
  // silent breakage waiting for an upgrade.
  const target = new THREE.Mesh(
    new THREE.BoxGeometry(LADDER_HALF_W * 2 + 0.16, LADDER_LENGTH, 0.16),
    new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false })
  );
  target.position.set(0, LADDER_LENGTH / 2, 0);
  group.add(target);

  // Negative: rotating +x tips the top toward +z, which is away from the
  // house. LADDER_TOP_Z above subtracts the lean for the same reason, and
  // the two have to agree or the click target and the geometry part company.
  group.rotation.x = -LADDER_LEAN;
  group.position.set(LADDER_X, 0, LADDER_FOOT_Z);
  return group;
}

// Three piers, two bays of roughly equal width.
//
// The middle pier was at 0.75, which made the east bay noticeably wider
// than the west one. Measuring it off the straight-on reference shot puts
// it at about 52% of the recess — near enough dead centre — so the two
// bays are close to equal, and the pier lands between the patio doors and
// the window rather than off to one side of both.
const PIER_X = [PORCH.xMin + 0.26, 0.1, PORCH.xMax - 0.26];
const PIER_Z = HALF_D - 0.26;
const PIER_HALF = 0.26;

// The building's masses, in the house's own coordinates. Everything else
// that needs to know the shape of the house — the collision boxes, the
// grass exclusion, and the perimeter walk — is derived from this one list
// rather than repeating the numbers.
const MASSES = [
  { xMin: -HALF_W, xMax: HALF_W, zMin: -HALF_D, zMax: PORCH_BACK_Z },
  { xMin: PORCH.xMax, xMax: HALF_W, zMin: PORCH_BACK_Z, zMax: HALF_D },
  { xMin: -HALF_W, xMax: PORCH.xMin, zMin: PORCH_BACK_Z, zMax: HALF_D },
  { xMin: BAY.xMin, xMax: BAY.xMax, zMin: BAY_FRONT_Z, zMax: -HALF_D },
  { xMin: EAST_END.xMin, xMax: EAST_END.xMax, zMin: EAST_FRONT_Z, zMax: -HALF_D },
  { xMin: GARAGE.xMin, xMax: GARAGE.xMax, zMin: GARAGE_FRONT_Z, zMax: -HALF_D },
];

// The concrete the satellite view shows running the whole way around the
// building. Rather than tracing an offset outline round an L-shaped
// footprint with three different forward steps, each mass simply gets its
// own slab grown by the walk's width: the union is the ring, and the parts
// that fall under the house are hidden by the house.
//
// It's the same width everywhere except the garage side, where it's about
// three times as wide because that's where the cars park — the AC
// condenser and the bins stand on it too. Only masses whose outer face is
// the +x wall get the wide version.

// Which masses have a bed along their street face — the window bay and the
// east end. The garage doesn't; that's where the driveway meets the slab.
const BAY_MASS = 3;
const EAST_MASS = 4;
const HAS_FRONT_BED = new Set([BAY_MASS, EAST_MASS]);

// The perimeter walk. Masses with a bed get no walk extension at the front
// at all — their front strip is laid separately, outboard of the bed, in
// buildFrontWalk.
const PERIMETER = MASSES.map((m, i) => ({
  xMin: m.xMin - WALK_W,
  xMax: m.xMax + (m.xMax >= HALF_W - 0.01 ? PARK_W : WALK_W),
  zMin: m.zMin - (HAS_FRONT_BED.has(i) ? 0 : WALK_W),
  zMax: m.zMax + WALK_W,
}));

// What the dog can't walk through, in world coordinates, so main.js's
// collision and yard.js's ground cover both read from one place instead of
// each keeping its own copy of the numbers. These are the actual masses,
// not one bounding box around them — which means the screened porch (a
// notch in the back of the house, not part of any mass) is somewhere Darla
// can walk, as it should be given there's a dog door and a run out there.
// The piers are listed individually so she goes around them rather than
// through them.
const toWorld = (b) => ({
  xMin: b.xMin, xMax: b.xMax, zMin: HOUSE_Z + b.zMin, zMax: HOUSE_Z + b.zMax,
});

export const HOUSE_SOLIDS = [
  ...MASSES.map(toWorld),
  ...PIER_X.map((x) => toWorld({
    xMin: x - PIER_HALF,
    xMax: x + PIER_HALF,
    zMin: PIER_Z - PIER_HALF,
    zMax: PIER_Z + PIER_HALF,
  })),
];

// Everything paved: no grass, no trees. Same world coordinates as
// HOUSE_SOLIDS, but this is the flatwork the dog is perfectly welcome to
// walk on — including the porch slab, which is inside the building
// outline but isn't a mass.
// The back run of the walk, spanning the full width in one piece. The
// per-mass expansion alone leaves a notch here: the two wings either side
// of the covered porch push their walk out to HALF_D + WALK_W, but across
// the porch the nearest mass is the core, set back at PORCH_BACK_Z, so the
// concrete stepped in and out instead of running as one straight line.
const BACK_WALK = {
  xMin: -HALF_W - WALK_W,
  xMax: HALF_W + PARK_W,
  zMin: HALF_D,
  zMax: BACK_WALK_Z1,
};

// What's left as boxes: the two pieces that aren't part of the walk surface.
// The ring itself, and the driveway that runs off it, are handled by
// WALK_OUTLINE below — they're one continuous polygon now, not a list.
const FLATWORK = [
  // the covered patio's own slab, inside the building outline
  toWorld({ xMin: PORCH.xMin, xMax: PORCH.xMax, zMin: PORCH_BACK_Z, zMax: HALF_D }),
];

const inBox = (x, z, b) => x > b.xMin && x < b.xMax && z > b.zMin && z < b.zMax;

// ── the walk, as one continuous surface ─────────────────────────────────
//
// This replaces "one rounded slab per mass, all laid on top of each other",
// which was wrong in three separate ways at once and could not be tuned out
// of any of them:
//
//   * overlapping slabs at one height are coplanar, so they z-fought and
//     flickered. Stacking them a millimetre apart stopped the fighting and
//     replaced it with visible seams, because the walk was still a pile of
//     separate pieces rather than a surface.
//   * rounding each slab independently only rounds the union's corners when
//     the radius equals the dilation width. At 2.4 m against slabs 2-3 m
//     across, the radius clamp turned whole slabs into stadiums and discs --
//     the circles scalloping the outside of the walk.
//   * the grass mask had to be kept in step with all of it by hand, which is
//     what put lawn on the concrete and bare ground on the corners.
//
// So the union is computed properly instead. Every piece of flatwork is an
// axis-aligned box, and the union of axis-aligned boxes is exact on the grid
// formed by all their edges: no sampling, no tolerance. Mark the cells that
// are inside any box, walk the boundary between inside and outside, and that
// traced loop is the walk's true outline. Fillet its corners and it is one
// closed polygon -- which is then used for *both* the mesh and the mask, so
// the two cannot drift apart again.
function unionOutline(boxes) {
  const xs = [...new Set(boxes.flatMap((b) => [b.xMin, b.xMax]))].sort((a, b) => a - b);
  const zs = [...new Set(boxes.flatMap((b) => [b.zMin, b.zMax]))].sort((a, b) => a - b);
  const inside = (i, j) => {
    if (i < 0 || j < 0 || i >= xs.length - 1 || j >= zs.length - 1) return false;
    const cx = (xs[i] + xs[i + 1]) / 2;
    const cz = (zs[j] + zs[j + 1]) / 2;
    return boxes.some((b) => cx > b.xMin && cx < b.xMax && cz > b.zMin && cz < b.zMax);
  };

  // Boundary edges, wound so the paved side is always on the left. Chaining
  // them then gives one consistently-oriented loop.
  const key = (p) => p[0].toFixed(4) + ',' + p[1].toFixed(4);
  const from = new Map();
  const add = (a, b) => from.set(key(a), [a, b]);
  for (let i = 0; i < xs.length - 1; i++) {
    for (let j = 0; j < zs.length - 1; j++) {
      if (!inside(i, j)) continue;
      const [x0, x1, z0, z1] = [xs[i], xs[i + 1], zs[j], zs[j + 1]];
      if (!inside(i, j - 1)) add([x0, z0], [x1, z0]);
      if (!inside(i + 1, j)) add([x1, z0], [x1, z1]);
      if (!inside(i, j + 1)) add([x1, z1], [x0, z1]);
      if (!inside(i - 1, j)) add([x0, z1], [x0, z0]);
    }
  }

  const start = from.values().next().value;
  const loop = [start[0]];
  let cur = start;
  for (let guard = 0; guard < from.size + 2; guard++) {
    const next = from.get(key(cur[1]));
    if (!next || key(next[0]) === key(start[0])) break;
    loop.push(next[0]);
    cur = next;
  }

  // Drop the points that only exist because a box edge landed mid-run —
  // three collinear points would otherwise each get filleted into nothing.
  return loop.filter((p, i) => {
    const a = loop[(i - 1 + loop.length) % loop.length];
    const b = loop[(i + 1) % loop.length];
    return Math.abs((p[0] - a[0]) * (b[1] - a[1]) - (p[1] - a[1]) * (b[0] - a[0])) > 1e-6;
  });
}

// Rounds every corner of a closed polygon, sampling the arcs into points so
// the result is still just a polygon — which is what lets one array serve as
// both the outline to extrude and the polygon to test against.
//
// The cut-back is clamped to half of each adjacent run, so a corner can eat
// its own edge but never its neighbour's. That clamp is the difference
// between this and the per-slab version: here it only ever softens a corner,
// where before it could consume the entire shape.
// `keepSharp` marks corners that must stay square because something else
// butts onto them. The driveway's mouth is the case: yard.js carries the
// drive on out to the road from there, and it leaves the house with a
// straight edge at the apron's full width. Rounding the union's corners
// there pulls the concrete back by up to the fillet radius, and the two
// surfaces stop meeting — which is the notch either side of the drive.
function filletPolygon(pts, r, steps = 5, keepSharp = () => false) {
  const out = [];
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const p = pts[i];
    if (keepSharp(p)) { out.push(p); continue; }
    const a = pts[(i - 1 + n) % n];
    const b = pts[(i + 1) % n];
    const la = Math.hypot(p[0] - a[0], p[1] - a[1]);
    const lb = Math.hypot(b[0] - p[0], b[1] - p[1]);
    const t = Math.min(r, la / 2, lb / 2);
    if (t < 1e-4) { out.push(p); continue; }
    const p0 = [p[0] + ((a[0] - p[0]) / la) * t, p[1] + ((a[1] - p[1]) / la) * t];
    const p1 = [p[0] + ((b[0] - p[0]) / lb) * t, p[1] + ((b[1] - p[1]) / lb) * t];
    // Quadratic through the original corner: cheap, and at these radii
    // indistinguishable from a true arc.
    for (let s = 0; s <= steps; s++) {
      const u = s / steps;
      const w = (1 - u) * (1 - u);
      const wc = 2 * (1 - u) * u;
      const we = u * u;
      out.push([
        w * p0[0] + wc * p[0] + we * p1[0],
        w * p0[1] + wc * p[1] + we * p1[1],
      ]);
    }
  }
  return out;
}

// Every piece of flatwork that lies at the walk's height. The raised entry
// stoop and the porch slab are deliberately not here — they are meant to sit
// proud of it, so they can't z-fight with it.
const WALK_BOXES = [
  ...PERIMETER,
  BACK_WALK,
  {
    xMin: GARAGE.xMin - WALK_W,
    xMax: GARAGE.xMax + WALK_W,
    zMin: DRIVEWAY_END_Z,
    zMax: GARAGE_FRONT_Z,
  },
  // The entry alcove. It used to be its own slab laid 2 cm proud of the
  // walk, which is where the "concrete stacked by the door" came from — a
  // raised rectangle with the walk visibly running underneath it. In the
  // reference photo the alcove is flush: one pour from the drive, past the
  // garage, into the recess. Joining the union makes it exactly that, and
  // means the fillet rounds where it meets the drive rather than leaving a
  // step.
  {
    xMin: ALCOVE.xMin, xMax: ALCOVE.xMax, zMin: GARAGE_FRONT_Z, zMax: -HALF_D,
  },
];

// Local coordinates, for the mesh; and the same loop shifted into world
// coordinates, for the mask.
const WALK_OUTLINE = filletPolygon(
  unionOutline(WALK_BOXES),
  WALK_CORNER_R,
  5,
  // The two corners at the road end of the driveway, where the yard's
  // extension takes over. Everything else still rounds.
  ([, z]) => Math.abs(z - DRIVEWAY_END_Z) < 0.01
);
const WALK_OUTLINE_WORLD = WALK_OUTLINE.map(([x, z]) => [x, z + HOUSE_Z]);

function inPolygon(x, z, poly) {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i];
    const [xj, zj] = poly[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) hit = !hit;
  }
  return hit;
}


// Bed and front walk together, as one polygon in world coordinates.
//
// Everything else paved is a box, which is why isHousePaved was only ever a
// box test — but the bed is a wall-hugging polyline and the walk is that
// polyline offset outward, and neither has been a rectangle since the bed was
// rebuilt to run straight-then-curved *outside* the perimeter walk. The stale
// assumption was written into isHousePaved's own comment ("the planter bed
// needs no test of its own"), which was true right up until the bed moved out
// from under the walk, and then silently wasn't.
//
// One polygon rather than two, because the bed's outer edge and the walk's
// inner edge are the same line: trace the wall, jump out to the walk's far
// edge at the east end where the arc lands on the brick, and come back.
// Two polygons, one per mesh, rather than one hull spanning both.
//
// It was a single loop from the wall out to the walk's far edge, which was
// fine while the walk stopped exactly where the bed did. Now that the walk
// runs on past both ends, a single hull would cut a diagonal from the end of
// the wall to the end of the extension and claim a wedge of lawn that has no
// concrete on it — which is precisely how the corners went bald last time.
// Matching the meshes one for one costs a second point-in-polygon test and
// removes the guesswork.
const FRONT_BED_POLY = [
  ...frontBedInnerEdge(),
  ...frontBedOuterEdge().reverse(),
].map(([x, z]) => [x, z + HOUSE_Z]);

const FRONT_WALK_POLY = [
  ...frontWalkInnerEdge(),
  ...frontWalkOuterEdge().reverse(),
].map(([x, z]) => [x, z + HOUSE_Z]);

// Standard ray-crossing test. Both polygons are small (~20 points each) and
// this is only reached for points that missed every box, so there's no need
// for the bounding-box early-out the pond's equivalent has.
function inFrontPaved(x, z) {
  return inPolygon(x, z, FRONT_BED_POLY) || inPolygon(x, z, FRONT_WALK_POLY);
}

// True where the ground is building or pavement rather than lawn. The
// curved front walk is tested as an actual annulus sector — boxing it to
// its bounding rectangle would strip the grass off a big square of front
// lawn the walk never touches.
export function isHousePaved(x, z) {
  return (
    HOUSE_SOLIDS.some((b) => inBox(x, z, b))
    || FLATWORK.some((b) => inBox(x, z, b))
    || inPolygon(x, z, WALK_OUTLINE_WORLD)
    || inFrontPaved(x, z)
  );
}


// Bakes the finished house down to one mesh per material. Building it out
// of ~450 little boxes is the right way to *author* it — every brick pier,
// muntin bar and gutter run is its own readable line of code — but it's a
// terrible way to draw it, and this house is completely static, so there's
// no reason to pay 450 draw calls (plus the same again in the shadow pass)
// every frame for the privilege. Meshes are bucketed by material *and* by
// whether they cast shadows, since that flag can't survive a merge.
// Anything that can't be merged (mismatched attributes) is kept as-is
// rather than dropped.
function bakeByMaterial(group) {
  group.updateMatrixWorld(true);
  const buckets = new Map();
  const strays = [];
  group.traverse((o) => {
    if (!o.isMesh) return;
    const key = `${o.material.uuid}|${o.castShadow}`;
    if (!buckets.has(key)) {
      buckets.set(key, { material: o.material, castShadow: o.castShadow, geometries: [] });
    }
    const geo = o.geometry.clone().applyMatrix4(o.matrixWorld);
    buckets.get(key).geometries.push(geo.index ? geo.toNonIndexed() : geo);
  });

  const baked = new THREE.Group();
  buckets.forEach(({ material, castShadow, geometries }) => {
    const merged = geometries.length === 1 ? geometries[0] : mergeGeometries(geometries, false);
    if (!merged) {
      strays.push(...geometries.map((g) => {
        const m = new THREE.Mesh(g, material);
        m.castShadow = castShadow;
        m.receiveShadow = true;
        return m;
      }));
      return;
    }
    const m = new THREE.Mesh(merged, material);
    m.castShadow = castShadow;
    m.receiveShadow = true;
    baked.add(m);
  });
  strays.forEach((m) => baked.add(m));
  return baked;
}

export function createHouse() {
  const group = new THREE.Group();

  // ── wall masses ──────────────────────────────────────────────────────
  // Solid boxes rather than a hollow shell of thin walls: there's no
  // walkable interior any more, so a shell only bought coplanar faces at
  // every corner and the z-fighting that comes with them.
  const coreDepth = PORCH_BACK_Z + HALF_D;
  group.add(place(brickBox(W, WALL_H, coreDepth), 0, WALL_H / 2, (PORCH_BACK_Z - HALF_D) / 2));

  const wingPlusW = HALF_W - PORCH.xMax;
  group.add(place(
    brickBox(wingPlusW, WALL_H, PORCH.depth),
    PORCH.xMax + wingPlusW / 2, WALL_H / 2, PORCH_BACK_Z + PORCH.depth / 2
  ));
  const wingMinusW = PORCH.xMin + HALF_W;
  group.add(place(
    brickBox(wingMinusW, WALL_H, PORCH.depth),
    -HALF_W + wingMinusW / 2, WALL_H / 2, PORCH_BACK_Z + PORCH.depth / 2
  ));

  const bayW = BAY.xMax - BAY.xMin;
  const bayCx = (BAY.xMin + BAY.xMax) / 2;
  group.add(place(brickBox(bayW, WALL_H, BAY.proj), bayCx, WALL_H / 2, -HALF_D - BAY.proj / 2));
  const eastW = EAST_END.xMax - EAST_END.xMin;
  group.add(place(
    brickBox(eastW, WALL_H, EAST_END.proj),
    (EAST_END.xMin + EAST_END.xMax) / 2, WALL_H / 2, -HALF_D - EAST_END.proj / 2
  ));
  group.add(place(
    brickBox(GARAGE_W, WALL_H, GARAGE.proj),
    GARAGE_CX, WALL_H / 2, -HALF_D - GARAGE.proj / 2
  ));

  // No brick fireplace base against the bay's side wall. There was one,
  // justified as "in three of the walk-around shots" and as what explains
  // the chimney above — but the owner looked at it in place and it isn't
  // there. Removed on their call.

  // The alcove's back wall — the one the front door is set into — is sided,
  // not brick. Both returns flanking it stay brick, which is the way round
  // the close-up photo of the entry shows it (the first pass had it exactly
  // backwards, with the garage's return sided and the door on bare brick).
  group.add(place(
    mesh(new THREE.BoxGeometry(ALCOVE.xMax - ALCOVE.xMin, WALL_H, 0.06), SIDING_MAT),
    (ALCOVE.xMin + ALCOVE.xMax) / 2, WALL_H / 2, -HALF_D - 0.03
  ));

  // Slab edge showing below the brick, as it does all the way round.
  group.add(place(concreteBox(W + 0.08, 0.1, D + 0.08), 0, 0.05, 0));
  group.add(place(
    concreteBox(GARAGE_W + 0.08, 0.1, GARAGE.proj),
    GARAGE_CX, 0.05, -HALF_D - GARAGE.proj / 2
  ));

  // ── soldier course under the eave ────────────────────────────────────
  const soldierY = WALL_H - BRICK_UNIT_W / 2 - 0.02;
  const soldierBand = (w, d, x, z) =>
    place(meterBox(w, BRICK_UNIT_W, d, SOLDIER_MAT), x, soldierY, z);
  // The core's own front and back faces, and only where they are actually
  // exposed walls.
  //
  // Both of these used to run the full 15.3 m width, and that is very
  // probably the "dark bar on the roof above the arched windows" that has
  // been on the queue for weeks (a magenta-tint test had already pinned it
  // to SOLDIER_MAT geometry without saying which band).
  //
  // On the street side the front elevation is entirely made of things
  // standing *in front of* the core — east end, bay, garage — which tile
  // the full width between them. The single exception is the entry alcove,
  // which is a recess rather than a projection, so the core's face there is
  // the back of the entry. Everything else was 14.1 m of brick band sealed
  // inside the building, and geometry buried inside a wall is exactly what
  // shows through the first seam it finds.
  //
  // On the garden side the porch is a notch with no wall at all, so the
  // band was spanning 6.1 m of open air above the patio.
  group.add(soldierBand(ALCOVE.xMax - ALCOVE.xMin + 0.06, 0.03,
    (ALCOVE.xMin + ALCOVE.xMax) / 2, -HALF_D - 0.015));
  [[-HALF_W, PORCH.xMin], [PORCH.xMax, HALF_W]].forEach(([x0, x1]) => {
    group.add(soldierBand(x1 - x0 + 0.06, 0.03, (x0 + x1) / 2, HALF_D + 0.015));
  });
  group.add(soldierBand(0.03, D + 0.06, -HALF_W - 0.015, 0));
  group.add(soldierBand(0.03, D + 0.06, HALF_W + 0.015, 0));
  group.add(soldierBand(GARAGE_W + 0.06, 0.03, GARAGE_CX, GARAGE_FRONT_Z - 0.015));
  group.add(soldierBand(0.03, GARAGE.proj, GARAGE.xMax + 0.015, -HALF_D - GARAGE.proj / 2));
  group.add(soldierBand(0.03, GARAGE.proj, GARAGE.xMin - 0.015, -HALF_D - GARAGE.proj / 2));
  group.add(soldierBand(bayW + 0.06, 0.03, bayCx, BAY_FRONT_Z - 0.015));
  group.add(soldierBand(0.03, BAY.proj, BAY.xMin - 0.015, -HALF_D - BAY.proj / 2));
  group.add(soldierBand(0.03, BAY.proj, BAY.xMax + 0.015, -HALF_D - BAY.proj / 2));
  group.add(soldierBand(eastW + 0.06, 0.03, (EAST_END.xMin + EAST_END.xMax) / 2, EAST_FRONT_Z - 0.015));

  // ── roofs ────────────────────────────────────────────────────────────
  const garageHalfSpan = GARAGE_W / 2 + EAVE;
  const garageRoofX0 = GARAGE_CX - garageHalfSpan;

  group.add(place(buildHipRoofSurface(ROOF_HALF_W, ROOF_HALF_D, ROOF_RISE), 0, ROOF_Y, ROOF_CZ));
  addEaveTrim(group, {
    x0: -ROOF_HALF_W, x1: ROOF_HALF_W, z0: ROOF_Z0, z1: ROOF_Z1, y: ROOF_Y,
    sides: {
      // The front eave only runs across the east end. Past that the bay's
      // own roof stands in front of and above this edge, so a fascia here
      // would be a white board floating in the middle of the bay's
      // shingles; and past the bay, the garage's gable takes over.
      nz: [-ROOF_HALF_W, BAY_ROOF.x0],
      px: [ROOF_Z0, ROOF_Z1 - EAVE],
    },
  });

  // Garage gable, at the steep pitch the photos actually show — it's the
  // tallest thing on the street elevation and the first thing you read from
  // the driveway, and an earlier, timid 0.46 made the whole front look
  // squat. Getting it this steep needs the hipped back end
  // (buildGableHipRoofSurface explains why); the ridge starts falling at
  // zRidgeEnd and is fully swallowed by the main roof well before the
  // garage's own footprint ends.
  const garagePitch = 0.66;
  const garageRise = garagePitch * garageHalfSpan;
  const garageRoof = buildGableHipRoofSurface(
    garageHalfSpan, garageRise, GARAGE_FRONT_Z - EAVE, -HALF_D - 1.2
  );
  group.add(place(garageRoof, GARAGE_CX, ROOF_Y, 0));

  // The window bay's own hip, in front of the main roof. At 9 ft of
  // projection the bay is far too deep to shelter under an extended main
  // roof, so it carries its own — lower ridge, same eave height, dying into
  // the main roof behind exactly like the garage's gable does.
  const bayRoofHalfW = (BAY_ROOF.x1 - BAY_ROOF.x0) / 2;
  const bayRoofHalfD = (BAY_ROOF.z1 - BAY_ROOF.z0) / 2;
  group.add(place(
    buildHipRoofSurface(bayRoofHalfW, bayRoofHalfD, PITCH * bayRoofHalfD),
    (BAY_ROOF.x0 + BAY_ROOF.x1) / 2, ROOF_Y, (BAY_ROOF.z0 + BAY_ROOF.z1) / 2
  ));
  addEaveTrim(group, {
    x0: BAY_ROOF.x0, x1: BAY_ROOF.x1, z0: BAY_ROOF.z0, z1: ROOF_Z0, y: ROOF_Y,
    sides: { pz: false },
  });
  // Only the length of gable that's actually forward of the main roof gets
  // trimmed — behind ROOF_Z0 the main roof's own fascia is already there,
  // and a second one in the same plane would z-fight with it.
  addEaveTrim(group, {
    x0: GARAGE_CX - garageHalfSpan,
    x1: GARAGE_CX + garageHalfSpan,
    z0: GARAGE_FRONT_Z - EAVE,
    z1: ROOF_Z0,
    y: ROOF_Y,
    sides: { nz: false, pz: false },
  });

  // Brick gable end, rake trim, eave returns and the louvered vent.
  //
  // The brick isn't a plain triangle springing from the wall top: it has to
  // run all the way up to the underside of the roof, and the roof plane at
  // the wall line already stands (ROOF_Y - WALL_H) plus the pitch across the
  // overhang above that. A triangle that just peaked at pitch x half-width
  // left a hand's width of open sky between the brick and the rake for the
  // whole length of both slopes. `gableTuck` keeps the brick just under the
  // rake soffit rather than exactly coplanar with the roof, which would
  // z-fight against it.
  const gableTuck = 0.1;
  const gableEdgeY = ROOF_Y - WALL_H + garagePitch * EAVE - gableTuck;
  const gableApexY = ROOF_Y - WALL_H + garageRise - gableTuck;
  const gableShape = new THREE.Shape();
  gableShape.moveTo(-GARAGE_W / 2, 0);
  gableShape.lineTo(GARAGE_W / 2, 0);
  gableShape.lineTo(GARAGE_W / 2, gableEdgeY);
  gableShape.lineTo(0, gableApexY);
  gableShape.lineTo(-GARAGE_W / 2, gableEdgeY);
  gableShape.lineTo(-GARAGE_W / 2, 0);
  const gableEnd = mesh(
    new THREE.ExtrudeGeometry(gableShape, { depth: 0.12, bevelEnabled: false }),
    BRICK_MAT
  );
  group.add(place(gableEnd, GARAGE_CX, WALL_H, GARAGE_FRONT_Z - 0.08));

  const rakeLen = Math.hypot(garageHalfSpan, garageRise);
  const rakeAngle = Math.atan2(garageRise, garageHalfSpan);
  [-1, 1].forEach((side) => {
    const rake = trimBox(rakeLen, 0.2, 0.16);
    rake.rotation.z = -side * rakeAngle;
    group.add(place(
      rake,
      GARAGE_CX + (side * garageHalfSpan) / 2,
      ROOF_Y + garageRise / 2 - 0.05,
      GARAGE_FRONT_Z - EAVE + 0.08
    ));
    // Rake soffit: the panel closing the underside of the gable overhang,
    // running up the slope from the wall out to the rake board. addEaveTrim
    // only ever builds soffits along horizontal eaves, so without this one
    // the gable's overhang is open from below — and since the roof surface
    // is single-sided, standing in the driveway you look straight up
    // through the roof into the sky.
    const rakeSoffit = trimBox(rakeLen, 0.05, EAVE);
    rakeSoffit.rotation.z = -side * rakeAngle;
    group.add(place(
      rakeSoffit,
      GARAGE_CX + (side * garageHalfSpan) / 2,
      ROOF_Y + garageRise / 2 - 0.12,
      GARAGE_FRONT_Z - EAVE / 2 + 0.02
    ));
    // Eave return: the horizontal stub of trim where the rake meets the
    // wall. Every house like this has one, and it looks conspicuously wrong
    // when it's missing.
    group.add(place(
      trimBox(0.44, 0.2, 0.34),
      GARAGE_CX + side * (GARAGE_W / 2 + 0.12),
      WALL_H + 0.03,
      GARAGE_FRONT_Z - 0.14
    ));
  });

  // The vent is built +z-outward like the windows are, so it needs the same
  // flip to face the street, and it sits a hair proud of the gable's own
  // front face (which stands 0.08 forward of the wall below it).
  const vent = buildGableVent(0.34, 0.4, 0.19);
  vent.rotation.y = Math.PI;
  group.add(place(vent, GARAGE_CX, WALL_H + 1.35, GARAGE_FRONT_Z - 0.09));

  // (There used to be a soffit panel here filling the step between the
  // bay's front wall and the main wall. It was sized for a bay that
  // projected 0.45 m; at the real 9 ft it became a 7.9 m sheet of white
  // hanging in the open air in front of the east end. The bay carries its
  // own roof now and the main roof's eave covers the east end's step, so
  // nothing needs filling.)

  // Entry roof: a flat roof carrying the alcove's ceiling all the way out
  // to the garage's front line, with its own fascia and gutter. This is the
  // piece that makes the front door read as genuinely recessed — the main
  // roof only reaches 0.9 m past the door, so before this the alcove was
  // open sky above and the door may as well have been painted on the wall.
  // Only the stoop is roofed, not the whole slot: the sketch's entry porch
  // is 4 x 7 ft, so the covering reaches about 7 ft out from the door and
  // the rest of the run alongside the garage is open to the sky.
  const entry = {
    x0: ALCOVE.xMin,
    x1: ALCOVE.xMax,
    z0: -HALF_D - STOOP_DEPTH - 0.6,
    z1: ROOF_Z0 + 0.04,
  };
  const entryW = entry.x1 - entry.x0;
  const entryD = entry.z1 - entry.z0;
  const entryCx = (entry.x0 + entry.x1) / 2;
  const entryCz = (entry.z0 + entry.z1) / 2;
  group.add(place(
    mesh(new THREE.BoxGeometry(entryW, 0.16, entryD), SHINGLE_MAT), entryCx, ROOF_Y - 0.08, entryCz
  ));
  addEaveTrim(group, {
    x0: entry.x0, x1: entry.x1, z0: entry.z0, z1: entry.z1, y: ROOF_Y - 0.02,
    sides: { pz: false, px: false },
  });
  // Alcove ceiling, running from the entry roof's outer edge all the way
  // back to the door wall so there's no strip of open roof over the door.
  const ceilD = -HALF_D + 0.05 - entry.z0;
  group.add(place(
    mesh(new THREE.BoxGeometry(entryW, 0.05, ceilD), RECESS_CEILING_MAT),
    entryCx, ROOF_Y - SOFFIT_DROP, entry.z0 + ceilD / 2
  ));

  // ── downspouts ───────────────────────────────────────────────────────
  const spoutDrop = ROOF_Y - 0.12;
  group.add(place(buildDownspout(spoutDrop, 'nx'), -HALF_W - 0.06, spoutDrop, ROOF_Z0 + 0.6));
  group.add(place(buildDownspout(spoutDrop, 'nx'), -HALF_W - 0.06, spoutDrop, HALF_D - 0.4));
  group.add(place(buildDownspout(spoutDrop, 'px'), HALF_W + 0.06, spoutDrop, HALF_D - 0.4));
  group.add(place(buildDownspout(spoutDrop, 'px'), HALF_W + 0.06, spoutDrop, -1.2));
  group.add(place(buildDownspout(spoutDrop, 'nx'), GARAGE.xMin - 0.06, spoutDrop, GARAGE_FRONT_Z + 0.5));
  group.add(place(buildDownspout(spoutDrop, 'px'), GARAGE.xMax + 0.06, spoutDrop, GARAGE_FRONT_Z + 0.5));

  // ── chimney ──────────────────────────────────────────────────────────
  // Painted masonry, not brick — it's the one pale mass on the whole
  // exterior and the only thing that breaks the roofline.
  const chimneyH = 6.7;
  const chimney = new THREE.Group();
  chimney.add(place(mesh(new THREE.BoxGeometry(0.74, chimneyH, 0.64), STUCCO_MAT), 0, chimneyH / 2, 0));
  chimney.add(place(mesh(new THREE.BoxGeometry(0.84, 0.1, 0.74), STUCCO_MAT), 0, chimneyH + 0.05, 0));
  chimney.add(place(
    mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.18, 12), DARK_METAL_MAT), 0, chimneyH + 0.19, 0
  ));
  chimney.add(place(
    mesh(new THREE.CylinderGeometry(0.25, 0.25, 0.05, 12), DARK_METAL_MAT), 0, chimneyH + 0.3, 0
  ));
  group.add(place(chimney, -3.4, 0, -2.3));

  // The two low box vents and the plumbing stack that used to sit on the
  // back slope are gone, on the owner's call — they're in the photos but
  // they read as three dark specks and earn nothing. Recoverable from
  // history if the roof ever looks too clean. Their material and the
  // roof-height helper went with them.

  // ── street elevation ─────────────────────────────────────────────────
  // Where each exterior lamp ends up, collected as they're placed so real
  // point lights can be hung on them after the bake. bakeByMaterial only
  // keeps meshes, so anything that isn't geometry has to be added to the
  // group it returns rather than to this one.
  const lampSpots = [];
  const garageDoorW = 4.9;
  const garageDoorH = 2.16;
  const garageDoor = buildGarageDoor(garageDoorW, garageDoorH);
  addOnWall(group, garageDoor, {
    x: GARAGE_CX, y: garageDoorH / 2 + 0.06, z: GARAGE_FRONT_Z, facing: 'nz', proud: 0.02,
  });
  group.add(place(
    meterBox(garageDoorW + 0.34, BRICK_UNIT_W, 0.06, SOLDIER_MAT),
    GARAGE_CX, garageDoorH + 0.2, GARAGE_FRONT_Z - 0.02
  ));

  [-1, 1].forEach((side) => {
    const s = buildSconce();
    s.rotation.y = Math.PI;
    const sx = GARAGE_CX + side * (garageDoorW / 2 + 0.38);
    group.add(place(s, sx, 1.95, GARAGE_FRONT_Z - 0.01));
    // Stood off the wall, or half the light is buried in the brick and the
    // pool it throws comes out lopsided.
    lampSpots.push([sx, 1.95, GARAGE_FRONT_Z - 0.3]);
  });

  // The three arched front windows, the centre one taller — the house's one
  // piece of real composition, and the first thing you notice from the
  // street.
  // Three windows filling the 17 ft bay, the centre one taller.
  const bayWinCx = (BAY.xMin + BAY.xMax) / 2;
  [
    { x: bayWinCx + 1.45, w: 1.1, h: 1.5, rise: 0.28 },
    { x: bayWinCx, w: 1.16, h: 1.66, rise: 0.34 },
    { x: bayWinCx - 1.45, w: 1.1, h: 1.5, rise: 0.28 },
  ].forEach(({ x, w, h, rise }) => {
    // Sill at 0.52, down from 0.72. They were riding high enough that the
    // brick below them read as a knee wall — in the photos the sill sits
    // just above the projecting course, not a course-and-a-half above it.
    const y = 0.52 + h / 2;
    addOnWall(group, buildArchedWindowUnit(w, h, rise, 2, 4), {
      x, y, z: BAY_FRONT_Z, facing: 'nz',
    });
    addWindowSurround(group, { x, y, z: BAY_FRONT_Z, w, h, archRise: rise, facing: 'nz' });
  });

  // Small bedroom window on the 9 ft east end, which steps forward 4 ft.
  const eastCx = (EAST_END.xMin + EAST_END.xMax) / 2;
  addOnWall(group, buildWindowUnit(0.98, 1.2, 2, 3), {
    x: eastCx, y: 1.64, z: EAST_FRONT_Z, facing: 'nz',
  });
  addWindowSurround(group, {
    x: eastCx, y: 1.64, z: EAST_FRONT_Z, w: 0.98, h: 1.2, facing: 'nz',
  });

  // Front door, deep in the alcove, on its sided back wall.
  const doorX = (ALCOVE.xMin + ALCOVE.xMax) / 2;
  addOnWall(group, buildFrontDoor(), {
    x: doorX, y: 1.09, z: -HALF_D - 0.06, facing: 'nz', proud: 0.02,
  });
  // The transom over the door — four panes, two by two, wider than the door
  // itself. Missing entirely before, and it's the first thing you see in
  // the close-up of the real entry: the alcove is tall enough that without
  // it there's a blank metre of siding above the door.
  addOnWall(group, buildWindowUnit(1.16, 0.34, 2, 2, false), {
    x: doorX, y: 2.44, z: -HALF_D - 0.06, facing: 'nz', proud: 0.02,
  });
  // House numbers, between the transom and the door head, as they are on
  // the real one.
  group.add(place(
    mesh(new THREE.BoxGeometry(0.38, 0.14, 0.03), DARK_METAL_MAT), doorX, 2.21, -HALF_D - 0.08
  ));
  // Pendant hanging from the alcove ceiling, and a coach lantern on the
  // garage's brick return facing back into the alcove — both are in the
  // close-up of the real entry.
  const pendantY = ROOF_Y - SOFFIT_DROP;
  const pendantZ = -HALF_D - 1.0;
  group.add(place(
    trinket(new THREE.CylinderGeometry(0.008, 0.008, 0.3, 6), DARK_METAL_MAT),
    doorX, pendantY - 0.15, pendantZ
  ));
  group.add(place(
    trinket(new THREE.ConeGeometry(0.14, 0.2, 8), DARK_METAL_MAT), doorX, pendantY - 0.38, pendantZ
  ));
  group.add(place(
    trinket(new THREE.SphereGeometry(0.08, 10, 8), LAMP_GLASS_MAT), doorX, pendantY - 0.5, pendantZ
  ));
  const alcoveSconce = buildSconce();
  alcoveSconce.rotation.y = -Math.PI / 2;
  group.add(place(alcoveSconce, GARAGE.xMin - 0.02, 1.95, -HALF_D - 1.2));
  lampSpots.push([GARAGE.xMin - 0.32, 1.95, -HALF_D - 1.2]);
  // The entry pendant, which is the one that actually lights the recess.
  lampSpots.push([doorX, pendantY - 0.55, pendantZ]);

  // ── east elevation (-x) ──────────────────────────────────────────────
  [
    { z: -2.9, w: 1.5, cols: 3 },
    { z: 0.3, w: 0.86, cols: 2 },
    { z: 3.3, w: 0.86, cols: 2 },
  ].forEach(({ z, w, cols }) => {
    addOnWall(group, buildWindowUnit(w, 1.24, cols, 3), { x: -HALF_W, y: 1.66, z, facing: 'nx' });
    addWindowSurround(group, { x: -HALF_W, y: 1.66, z, w, h: 1.24, facing: 'nx' });
  });

  // ── west elevation (+x), the working side of the house ───────────────
  [
    { z: -1.9, w: 0.86, cols: 2 },
    { z: 1.6, w: 1.2, cols: 3 },
  ].forEach(({ z, w, cols }) => {
    addOnWall(group, buildWindowUnit(w, 1.24, cols, 3), { x: HALF_W, y: 1.66, z, facing: 'px' });
    addWindowSurround(group, { x: HALF_W, y: 1.66, z, w, h: 1.24, facing: 'px' });
  });

  // Service door into the garage, with its own lantern, the meter, the AC
  // condenser and the bins — all of it on the concrete apron.
  const serviceDoor = new THREE.Group();
  serviceDoor.add(place(mesh(new THREE.BoxGeometry(0.88, 2.02, 0.06), DOOR_MAT), 0, 0, -0.03));
  serviceDoor.add(place(trimBox(1.06, 0.1, 0.12), 0, 1.06, -0.01));
  [-1, 1].forEach((s) => {
    serviceDoor.add(place(trimBox(0.09, 2.12, 0.12), s * 0.485, 0, -0.01));
  });
  // The service door on the garage's outer wall.
  //
  // Moved back from GARAGE_FRONT_Z + 2.0. At two metres it sat almost at
  // the front corner, where the photos put it well down the wall toward
  // the back yard.
  const serviceZ = GARAGE_FRONT_Z + 4.3;
  addOnWall(group, serviceDoor, {
    x: GARAGE.xMax, y: 1.06, z: serviceZ, facing: 'px', proud: 0.03,
  });
  const serviceSconce = buildSconce();
  serviceSconce.rotation.y = Math.PI / 2;
  group.add(place(serviceSconce, GARAGE.xMax + 0.02, 1.98, serviceZ + 0.7));
  lampSpots.push([GARAGE.xMax + 0.32, 1.98, serviceZ + 0.7]);

  const meterMat = new THREE.MeshStandardMaterial({
    color: 0x8e8b84, roughness: 0.85, envMapIntensity: MATTE_ENV,
  });
  const meterZ = serviceZ + 1.5;
  group.add(place(
    mesh(new THREE.BoxGeometry(0.12, 0.34, 0.26), meterMat), HALF_W + 0.07, 1.55, meterZ
  ));
  group.add(place(
    trinket(new THREE.CylinderGeometry(0.1, 0.1, 0.1, 12), GLASS_MAT), HALF_W + 0.16, 1.62, meterZ
  ));

  const ac = new THREE.Group();
  ac.add(place(mesh(new THREE.BoxGeometry(0.78, 0.86, 0.78), AC_MAT), 0, 0.43, 0));
  ac.add(place(mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.04, 16), DARK_METAL_MAT), 0, 0.88, 0));
  // The condenser goes on the *street* side of the door and the bins on
  // the back-yard side — the order along the wall is condenser, door,
  // bins. It was the other way round.
  group.add(place(ac, HALF_W + 0.62, 0.06, serviceZ - 2.6));

  [1.05, 1.78].forEach((dz) => {
    const bin = new THREE.Group();
    bin.add(place(mesh(new THREE.BoxGeometry(0.6, 0.95, 0.7), BIN_MAT), 0, 0.48, 0));
    bin.add(place(mesh(new THREE.BoxGeometry(0.64, 0.06, 0.74), BIN_MAT), 0.02, 0.98, 0));
    group.add(place(bin, HALF_W + 0.45, 0.06, serviceZ + dz));
  });

  // ── back of the house: the covered patio ─────────────────────────────
  const porchW = PORCH.xMax - PORCH.xMin;
  const porchCx = (PORCH.xMin + PORCH.xMax) / 2;
  // A touch taller than the slab edge that rings the house, so the porch
  // floor comes out proud of the surrounding grade rather than sunk into
  // it by two centimetres.
  group.add(place(
    concreteBox(porchW, 0.16, PORCH.depth + 0.3),
    porchCx, 0.08, PORCH_BACK_Z + (PORCH.depth + 0.3) / 2
  ));
  // Porch ceiling — the house's own soffit, shaded (see RECESS_CEILING_MAT).
  group.add(place(
    mesh(new THREE.BoxGeometry(porchW, 0.06, PORCH.depth), RECESS_CEILING_MAT),
    porchCx, WALL_H - 0.03, PORCH_BACK_Z + PORCH.depth / 2
  ));

  const pierX = PIER_X;
  const pierZ = PIER_Z;
  pierX.forEach((x) => {
    group.add(place(
      brickBox(PIER_HALF * 2, WALL_H - 0.06, PIER_HALF * 2), x, (WALL_H - 0.06) / 2, pierZ
    ));
  });

  // The patio's back wall is sided, not brick — one of only two such walls
  // on the house (the entry alcove is the other), and it's what makes the
  // recess read as a recess rather than as shadow on more brickwork.
  group.add(place(
    mesh(new THREE.BoxGeometry(porchW, WALL_H, 0.06), SIDING_MAT),
    porchCx, WALL_H / 2, PORCH_BACK_Z + 0.03
  ));

  // Two sets of patio doors side by side in the east bay, and a window in
  // the west bay.
  //
  // Corrected against the reference photos: this was one French pair plus a
  // *solid* door beside it. Both openings are glazed in reality — the back
  // of the house has two matching sets of patio doors next to each other,
  // which is the thing you notice about it — and the solid door was the
  // single biggest wrong note on this elevation.
  //
  // They sit toward the east end of the recess rather than centred in it,
  // with the middle pier landing just west of them and the window beyond
  // that, which is the composition in the straight-on shot.
  [-2.05, -0.55].forEach((x) => {
    addOnWall(group, buildFrenchDoorPair(1.44, 2.06), {
      x, y: 1.09, z: PORCH_BACK_Z + 0.06, facing: 'pz', proud: 0.03,
    });
  });
  addOnWall(group, buildWindowUnit(0.86, 1.0, 2, 2), {
    x: 1.7, y: 1.72, z: PORCH_BACK_Z + 0.06, facing: 'pz',
  });

  // Flush dome ceiling lights, one per bay.
  //
  // These now throw real light after dark like the front fixtures do. They
  // were the only lamps on the house whose glass lit up but which cast
  // nothing — so the covered patio, the one part of the back that people
  // actually stand under, stayed pitch black with two glowing beads stuck
  // to its ceiling.
  //
  // Hung a little below the dome itself rather than at it: a point light
  // level with the ceiling puts half its sphere inside the soffit, where
  // it lights nothing and still costs the same.
  [-1.2, 1.77].forEach((lx) => {
    const lz = PORCH_BACK_Z + PORCH.depth * 0.45;
    group.add(place(
      trinket(new THREE.SphereGeometry(0.15, 12, 8), LAMP_GLASS_MAT),
      lx, WALL_H - 0.12, lz
    ));
    lampSpots.push([lx, WALL_H - 0.32, lz]);
  });

  // Two windows in each brick wing flanking the patio, as in the reference.
  // Two windows in each brick wing flanking the patio.
  //
  // Respaced against the straight-on shot. They were bunched toward the
  // middle — both pairs sat close to the patio with a wide blank stretch
  // out at each corner. In the photo they're spread across their wing, the
  // inner one close to the pier and the outer one close to the corner.
  [
    { x: -6.25, w: 0.92 },
    { x: -3.8, w: 0.92 },
    { x: 3.85, w: 0.92 },
    { x: 6.3, w: 0.92 },
  ].forEach(({ x, w }) => {
    addOnWall(group, buildWindowUnit(w, 1.24, 2, 3), { x, y: 1.66, z: HALF_D, facing: 'pz' });
    addWindowSurround(group, { x, y: 1.66, z: HALF_D, w, h: 1.24, facing: 'pz' });
  });

  // No hose reel on the back wall. There was one — a dark disc that read as
  // a hole punched in the brick from any distance — and the owner asked for
  // it gone. Just the floodlight under the eave now.
  group.add(place(
    mesh(new THREE.BoxGeometry(0.22, 0.1, 0.12), DARK_METAL_MAT),
    4.6, ROOF_Y - SOFFIT_DROP - 0.06, HALF_D + 0.25
  ));

  // Festoon lights strung across the patio — the one thing on the house
  // that reads as lived-in rather than architectural, and the owner's
  // favourite bit. Emissive rather than real lights; the bloom pass picks
  // them up on its own.
  const strandTop = WALL_H - 0.24;
  const strandZ = pierZ - 0.12;
  const strandHalf = porchW / 2 - 0.45;
  const strandCx = porchCx;
  const bulbGeo = new THREE.SphereGeometry(0.045, 8, 6);
  let prev = null;
  for (let i = 0; i < 13; i++) {
    // u runs -1..1 across the span, so u*u gives a parabola that's flat at
    // the ends and lowest in the middle — near enough a catenary at this
    // span, and a dead-level string reads as a pipe.
    const u = (i / 12) * 2 - 1;
    const x = strandCx + u * strandHalf;
    const y = strandTop - 0.24 * (1 - u * u);
    group.add(place(trinket(bulbGeo, BULB_MAT), x, y, strandZ));
    if (prev) {
      const dx = x - prev.x;
      const dy = y - prev.y;
      const cord = trinket(new THREE.CylinderGeometry(0.008, 0.008, Math.hypot(dx, dy), 5), CORD_MAT);
      cord.rotation.z = Math.atan2(dx, -dy) + Math.PI;
      group.add(place(cord, (x + prev.x) / 2, (y + prev.y) / 2, strandZ));
    }
    prev = { x, y };
  }

  // A couple of patio chairs, in the open now that the screens are gone.
  [-2.5, 1.75].forEach((fx) => {
    const chair = new THREE.Group();
    chair.add(place(mesh(new THREE.BoxGeometry(0.68, 0.16, 0.66), FURNITURE_MAT), 0, 0.42, 0));
    chair.add(place(mesh(new THREE.BoxGeometry(0.68, 0.62, 0.14), FURNITURE_MAT), 0, 0.72, -0.28));
    group.add(place(chair, fx, 0.16, PORCH_BACK_Z + 0.95));
  });

  // ── flatwork ─────────────────────────────────────────────────────────
  // Slabs are deliberately thin. At 0.1 the exposed side faces caught the
  // light as a continuous darker band down both edges of the driveway and
  // read as a raised concrete curb, which no part of this property has.
  const SLAB = 0.05;

  // Only the front walk needs lifting off the ring now. Everything else at
  // this height was merged into one polygon, so there is nothing left for it
  // to be coplanar with. The front walk follows the planting bed's curve and
  // isn't rectilinear, so it can't join that union and instead sits a
  // millimetre proud where the two meet.
  const FRONT_WALK_LIFT = 0.001;

  // The walk, the back parking run and the driveway are one surface, built
  // from the traced union outline up top rather than from a stack of slabs.
  // One polygon means no overlaps, so nothing is coplanar with anything and
  // there is nothing left to z-fight or to seam.
  {
    const shape = new THREE.Shape();
    shape.moveTo(WALK_OUTLINE[0][0], -WALK_OUTLINE[0][1]);
    for (let i = 1; i < WALK_OUTLINE.length; i++) {
      shape.lineTo(WALK_OUTLINE[i][0], -WALK_OUTLINE[i][1]);
    }
    shape.closePath();
    const geo = new THREE.ExtrudeGeometry(shape, {
      depth: SLAB, bevelEnabled: false,
    });
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    const uv = geo.attributes.uv;
    for (let i = 0; i < pos.count; i++) {
      // UVs in metres, which is the convention meterUvs sets for every
      // other concrete surface in the house — the texture's own repeat of
      // 1/CONCRETE_TILE is what turns metres into tiles.
      //
      // These used to divide by CONCRETE_TILE here as well, so the repeat
      // applied twice and the walk tiled every 5.76 m instead of 2.4. That
      // is the whole "weirdly circular / strange squares" fault: the
      // concrete texture is built from soft radial stain blobs, so at 2.4x
      // scale they come out as metre-wide circles, with the repeat boundary
      // visible as a square around each one.
      uv.setXY(i, pos.getX(i), pos.getZ(i));
    }
    group.add(place(mesh(geo, CONCRETE_MAT), 0, 0, 0));
  }

  // The planting bed, and the walk that runs *outside* it.
  //
  // Order from the brick outward is wall, bed, walk, lawn — which is what
  // the photos show and what the old version got wrong by laying the bed
  // straight over the concrete.
  const bedOuter = frontBedOuterEdge();
  const bedInner = frontBedInnerEdge();

  // The bed itself: a filled polygon between the two edges. Built in XY and
  // laid flat, the same convention arcSlab uses — local +y maps to world
  // -z, hence the sign flip on every z below.
  {
    const shape = new THREE.Shape();
    shape.moveTo(bedOuter[0][0], -bedOuter[0][1]);
    for (let i = 1; i < bedOuter.length; i++) shape.lineTo(bedOuter[i][0], -bedOuter[i][1]);
    for (let i = bedInner.length - 1; i >= 0; i--) shape.lineTo(bedInner[i][0], -bedInner[i][1]);
    shape.closePath();
    const geo = new THREE.ShapeGeometry(shape);
    const m = mesh(geo, MULCH_MAT);
    m.rotation.x = -Math.PI / 2;
    group.add(place(m, 0, 0.07, 0));
  }

  // The brick curb along the bed's outer edge. One box per segment of the
  // polyline, turned to face along it — which is why the edge is generated
  // as points rather than as an arc: a curve described by a centre and a
  // radius can only be walked with trigonometry, where a polyline can be
  // walked by anything that needs to follow it, curb included.
  // The curb runs the outer edge, and then closes across the end nearest
  // the front door — the bed is walled in on that side rather than just
  // stopping, which is what "encapsulate" means and what the photo shows.
  // Without it the mulch simply spills out at the open end.
  const curbRun = [
    [BED_FROM_X, BAY_FRONT_Z],
    ...bedOuter,
  ];
  for (let i = 0; i < curbRun.length - 1; i++) {
    const [x0, z0] = curbRun[i];
    const [x1, z1] = curbRun[i + 1];
    const dx = x1 - x0;
    const dz = z1 - z0;
    const len = Math.hypot(dx, dz);
    if (len < 1e-4) continue;
    const curb = brickBox(len + 0.06, 0.3, 0.16);
    curb.rotation.y = -Math.atan2(dz, dx);
    group.add(place(curb, (x0 + x1) / 2, 0.15, (z0 + z1) / 2));
  }

  // The front walk, laid outboard of the bed rather than under it. Follows
  // the same polyline offset away from the house, so it stays parallel to
  // the bed's edge the whole way round instead of being a separate shape
  // that has to be kept in step by hand.
  {
    // Both edges are the run-on versions, not the bed's own outline — the
    // walk carries past each end of the bed to meet the perimeter, while the
    // bed above stops where it stops.
    const walkInner = frontWalkInnerEdge();
    const walkOuter = frontWalkOuterEdge();
    const shape = new THREE.Shape();
    shape.moveTo(walkInner[0][0], -walkInner[0][1]);
    for (let i = 1; i < walkInner.length; i++) shape.lineTo(walkInner[i][0], -walkInner[i][1]);
    for (let i = walkOuter.length - 1; i >= 0; i--) {
      shape.lineTo(walkOuter[i][0], -walkOuter[i][1]);
    }
    shape.closePath();
    const geo = new THREE.ShapeGeometry(shape);
    const pos = geo.attributes.position;
    const uv = geo.attributes.uv;
    for (let i = 0; i < pos.count; i++) {
      uv.setXY(i, pos.getX(i), pos.getY(i));
    }
    const m = mesh(geo, CONCRETE_MAT);
    m.rotation.x = -Math.PI / 2;
    // Laid last, so it sits on top of the perimeter walk it runs into rather
    // than fighting it — this is the piece in front of the door, which is
    // where the flicker was most visible.
    group.add(place(m, 0, SLAB + FRONT_WALK_LIFT, 0));
  }

  const baked = bakeByMaterial(group);

  // Real light from the exterior lamps, added after the bake since that
  // only carries meshes through. Left at zero intensity — main.js's
  // applyDayNight is what turns them on, so they cost nothing by day.
  //
  // No shadow casting: a shadow-casting point light renders six faces, and
  // five of them here would be paying for shadows of a wall the lamp is
  // bolted to. The earlier note above buildSconce called real lights for
  // these "silly" and leaned on emissive plus the bloom pass instead; that
  // reads fine at dusk but leaves the porch and the garage apron pitch
  // black at night, with four bright lamps illuminating nothing.
  baked.userData.nightLights = lampSpots.map(([x, y, z]) => {
    const light = new THREE.PointLight(0xffc98a, 0, 7.5, 2);
    light.position.set(x, y, z);
    baked.add(light);
    return light;
  });

  // Added after the bake, and handed up on its own, because main.js has to
  // be able to raycast *the ladder* for a click and hang a glow on it.
  // Merged into the rest of the house by material it would be part of one
  // enormous mesh with no way to pick it out.
  const ladder = buildRoofLadder();
  baked.add(ladder);
  baked.userData.ladder = ladder;

  return baked;
}
