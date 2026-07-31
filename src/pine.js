import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// Southern yellow pine, built to match the two in the owner's front yard.
//
// The thing that makes these read as the right species is what they *don't*
// have: no cone, no foliage anywhere near the ground, no solid mass of
// green. The lower 55-60% is bare trunk, the crown is open enough to see
// sky through everywhere, and the needles sit in discrete tufts out at the
// branch tips rather than clothing the branch along its length. The generic
// stacked-cone tree the rest of the yard uses gets all three backwards,
// which is why it never looked like these no matter how it was tinted.
//
// Cost is spent deliberately: this is only ever built for the two hero
// trees at the road (see createYard), so it can afford real tapered limb
// geometry and a few hundred instanced needle tufts. The forest that
// streams in by chunk still uses the cheap createTree in yard.js.

// ── textures ───────────────────────────────────────────────────────────

function canvas2d(w, h) {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  return { canvas, ctx: canvas.getContext('2d') };
}

// A single needle cluster: sixty-odd needles fanning out and drooping away
// from one attachment point. Drawn with the pivot at the bottom centre so a
// tuft can be dropped straight onto a branch tip and pointed along it.
function makeNeedleTexture(rand) {
  const S = 256;
  const { canvas, ctx } = canvas2d(S, S);
  ctx.clearRect(0, 0, S, S);
  ctx.lineCap = 'round';

  const ox = S / 2;
  const oy = S * 0.99;
  for (let i = 0; i < 240; i++) {
    // Fanned wide — a narrow fan reads as a paintbrush, and the whole point
    // of these trees is that you can see between the needles.
    const angle = -Math.PI / 2 + (rand() - 0.5) * Math.PI * 1.15;
    const len = S * (0.4 + rand() * 0.55);
    const droop = len * (0.05 + rand() * 0.16);
    const ex = ox + Math.cos(angle) * len;
    const ey = oy + Math.sin(angle) * len + droop;
    const cx = ox + Math.cos(angle) * len * 0.5;
    const cy = oy + Math.sin(angle) * len * 0.5 + droop * 0.3;

    const g = 62 + Math.floor(rand() * 78);
    ctx.strokeStyle = `rgb(${26 + Math.floor(rand() * 34)},${g},${32 + Math.floor(rand() * 30)})`;
    ctx.lineWidth = 1.1 + rand() * 1.7;
    ctx.beginPath();
    ctx.moveTo(ox, oy);
    ctx.quadraticCurveTo(cx, cy, ex, ey);
    ctx.stroke();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

// Mature southern yellow pine bark: big flat irregular plates, like crazy
// paving, separated by a connected network of deep dark fissures.
//
// Three versions got this wrong before it worked, and the third is the
// instructive one:
//
//   1. Soft ellipses with wandering dark lines over them. Read as smeared
//      rust. Plates need *hard edges* — a fissure is the gap between two
//      flat faces, not a dark line painted on a continuous surface.
//   2. Jittered rectangles on a row lattice. Fixed the edges and produced
//      what the owner called "made out of bricks", which was exactly right.
//   3. The same rectangles with far more jitter, more colour variation and
//      wobbled polygon edges instead of straight ones. **Still bricks.**
//
// Three is the lesson: a rectangle with its corners moved is a rectangle,
// and a grid of them is a wall no matter how much noise is thrown at it.
// The wobble was a few pixels on plates up to ninety wide, so it was
// invisible, and the rows still lined up because they were still rows. The
// structure was the problem and only the structure.
//
// So this doesn't draw plates at all. It's a Voronoi field: seeds scattered
// on a jittered grid, and every pixel asks which seed is nearest (that's
// its plate, and its colour) and how much nearer that one is than the
// second nearest (that's how far it is from a fissure). Cells come out as
// irregular convex polygons meeting at three-way junctions — which is what
// crazy paving actually is, and it cannot line up into courses because
// there are no courses.
//
// Two things on top of the raw Voronoi, both load-bearing:
//
//   * the lookup position is domain-warped by low-frequency noise first,
//     which bends the cell walls. Without it the polygons are dead straight
//     and the whole thing reads as a tiled floor rather than as bark.
//   * the fissure width is itself a noise field rather than a constant, so
//     a furrow pinches and opens along its length instead of being a ruled
//     line of even mortar. This is the specific thing the queue item asked
//     for and the rectangle version never had.
//
// Colour is warm and varies per plate. Real southern pine plates run from
// fresh cinnamon to weathered grey-tan, often side by side, and that spread
// does more for "wood" than the average tone does. (An earlier note here
// said the photos were grey-brown and the redness was a bug — true of a
// version whose material tint multiplied an already-red map. The material
// is neutral now, so the texture carries the warmth itself.)
//
// Returns a bump map built from the same field: the fissures are what
// should catch a shadow, and flat-shaded bark stays looking painted no
// matter how good the colour is.
function makeBarkTextures(rand) {
  const W = 256;
  const H = 512;
  const col = canvas2d(W, H);
  const bmp = canvas2d(W, H);

  // Seeds on a jittered grid rather than fully random. Poisson-ish spacing
  // is what keeps plates roughly the same size as each other; uniformly
  // random seeds clump, and clumped seeds give slivers next to slabs.
  // Cell counts set the plate size, and they are the number to touch if the
  // bark reads at the wrong scale. On a 0.33 m hero trunk the texture wraps
  // ~2.8 times (see uScale in taperedTube), so 10 cells across works out at
  // roughly 7 cm per plate — the middle of the 5-15 cm real southern pine
  // plates run to. At 7 across they came out nearer 17 cm, which read as
  // slabs rather than bark.
  const GX = 10;
  const GY = 16;
  const CW = W / GX;
  const CH = H / GY;
  const N = GX * GY;
  const seedX = new Float32Array(N);
  const seedY = new Float32Array(N);
  const faceR = new Float32Array(N);
  const faceG = new Float32Array(N);
  const faceB = new Float32Array(N);
  const faceLift = new Float32Array(N);

  for (let gy = 0; gy < GY; gy++) {
    for (let gx = 0; gx < GX; gx++) {
      const i = gy * GX + gx;
      seedX[i] = (gx + 0.14 + rand() * 0.72) * CW;
      seedY[i] = (gy + 0.14 + rand() * 0.72) * CH;
      // 0 is a fresh plate, 1 a weathered one. Neighbours weather at
      // different rates and having both in shot is most of what stops a
      // trunk reading as one flat painted tone.
      const weather = rand();
      const level = 88 + rand() * 72;
      faceR[i] = level * (1.18 - weather * 0.2);
      faceG[i] = level * (0.7 + weather * 0.14);
      faceB[i] = level * (0.4 + weather * 0.26);
      // The most weathered plates stand highest, being oldest and thickest.
      faceLift[i] = 150 + weather * 88;
    }
  }

  const hash2 = (ix, iy) => {
    let h = Math.imul(ix, 374761393) + Math.imul(iy, 668265263);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
  };
  const noise = (x, y) => {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const fx = x - ix;
    const fy = y - iy;
    const ux = fx * fx * (3 - 2 * fx);
    const uy = fy * fy * (3 - 2 * fy);
    const a = hash2(ix, iy);
    const b = hash2(ix + 1, iy);
    const c = hash2(ix, iy + 1);
    const d = hash2(ix + 1, iy + 1);
    return a * (1 - ux) * (1 - uy) + b * ux * (1 - uy) + c * (1 - ux) * uy + d * ux * uy;
  };
  const smoothstep = (e0, e1, x) => {
    const t = Math.min(1, Math.max(0, (x - e0) / Math.max(1e-5, e1 - e0)));
    return t * t * (3 - 2 * t);
  };

  const colData = col.ctx.createImageData(W, H);
  const bmpData = bmp.ctx.createImageData(W, H);
  const cd = colData.data;
  const bd = bmpData.data;

  // Distances are squashed vertically, so plates come out a little taller
  // than wide — which is how they sit on a trunk.
  const ANISO = 0.78;
  // Furrow colour. Nearly black and warm rather than neutral: the bottom of
  // a real furrow is in shadow, but it is still wood.
  const FURROW_R = 28;
  const FURROW_G = 19;
  const FURROW_B = 16;

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      // Domain warp. Amplitude is a good fraction of a cell — small values
      // do nothing visible, which was lesson three. Scaled off the cell size
      // rather than fixed, so changing GX/GY above doesn't either scramble
      // the cells into slivers or stop bending them at all.
      const wx = x + (noise(x * 0.034, y * 0.034) - 0.5) * CW * 0.75;
      const wy = y + (noise(x * 0.034 + 41.3, y * 0.034 - 17.7) - 0.5) * CH * 0.75;

      let d1 = 1e9;
      let d2 = 1e9;
      let best = 0;
      const cgx = Math.floor(wx / CW);
      const cgy = Math.floor(wy / CH);
      for (let oy = -1; oy <= 1; oy++) {
        for (let ox = -1; ox <= 1; ox++) {
          const gx = (((cgx + ox) % GX) + GX) % GX;
          const gy = (((cgy + oy) % GY) + GY) % GY;
          const i = gy * GX + gx;
          // Wrapped deltas, so the texture tiles seamlessly both around the
          // trunk and along it — a seam on a trunk is very visible.
          let dx = seedX[i] - wx;
          dx -= W * Math.round(dx / W);
          let dy = seedY[i] - wy;
          dy -= H * Math.round(dy / H);
          dy /= ANISO;
          const d = Math.sqrt(dx * dx + dy * dy);
          if (d < d1) {
            d2 = d1;
            d1 = d;
            best = i;
          } else if (d < d2) {
            d2 = d;
          }
        }
      }

      // How far this pixel is from the wall between its plate and the next.
      const edge = d2 - d1;
      // ...and how wide the furrow is *here*. A noise field, not a
      // constant, which is what makes a fissure pinch and open along its
      // run rather than reading as mortar.
      const furrow = (0.07 + noise(x * 0.028 + 7.1, y * 0.028 + 3.3) * 0.19) * CW;
      const onPlate = smoothstep(furrow * 0.4, furrow, edge);

      // Thin flakes across the face. Southern pine plates are layered like
      // puff pastry and shed in sheets; the high y frequency is what makes
      // those layers run horizontally, around the trunk.
      const flake = 0.86 + noise(x * 0.055 + 19.4, y * 0.62 - 5.2) * 0.3;
      // Plates dome slightly rather than being flat-topped mesas — the
      // light has to break over them gradually or the bump reads as tiling.
      const dome = 0.5 + 0.5 * smoothstep(furrow, furrow * 4.5, edge);

      const p = (y * W + x) * 4;
      cd[p] = FURROW_R + (faceR[best] * flake - FURROW_R) * onPlate;
      cd[p + 1] = FURROW_G + (faceG[best] * flake - FURROW_G) * onPlate;
      cd[p + 2] = FURROW_B + (faceB[best] * flake - FURROW_B) * onPlate;
      cd[p + 3] = 255;

      const h = faceLift[best] * onPlate * dome;
      bd[p] = h;
      bd[p + 1] = h;
      bd[p + 2] = h;
      bd[p + 3] = 255;
    }
  }

  col.ctx.putImageData(colData, 0, 0);
  bmp.ctx.putImageData(bmpData, 0, 0);

  const make = (canvas, srgb) => {
    const t = new THREE.CanvasTexture(canvas);
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = THREE.RepeatWrapping;
    t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 8;
    return t;
  };
  return { map: make(col.canvas, true), bump: make(bmp.canvas, false) };
}

// ── geometry helpers ───────────────────────────────────────────────────

// A tube that tapers along its length. TubeGeometry holds one radius for
// the whole run, and a limb that doesn't thin toward its tip reads as
// plumbing, so this walks the curve's own Frenet frames and shrinks the
// ring as it goes. Used for the trunk and every branch.
// `power` shapes how the radius falls: 1 is a straight cone, higher values
// drop fast near the base and then level off, which is the root flare a
// mature trunk has. Doing it here rather than bolting a separate cone on
// the bottom keeps one continuous surface with one continuous UV run — the
// bolted-on version showed a bright ring where its open end and its
// mismatched UVs met the tube.
// `flare` adds a separate swell confined to the very bottom of the run. It
// exists because the two effects fight each other through one exponent: a
// power low enough to keep the trunk near-cylindrical has no root flare, and
// one high enough to give a flare tapers the whole trunk to a spike. The
// trunk was doing the latter and came out as a witch's hat. Two terms, one
// for the overall taper and one for the flare, and both can be right.
export function taperedTube(curve, rStart, rEnd, along, radial, power = 1, flare = 0) {
  const frames = curve.computeFrenetFrames(along, false);
  const positions = [];
  const normals = [];
  const uvs = [];
  const indices = [];
  const length = curve.getLength();
  // Horizontal texture scale, fixed for the whole limb rather than taken
  // from each ring's own radius. Using the local radius means u spans less
  // and less as the tube tapers, which *shears* the texture — every
  // horizontal feature in it gets dragged into a diagonal up the trunk. That
  // went unnoticed while the bark was soft blobs and turned into obvious
  // chevrons the moment it had plates in rows. Still per-limb, so a twig
  // keeps a finer grain than the trunk.
  const uScale = Math.max(1, rStart * 8);

  for (let i = 0; i <= along; i++) {
    const t = i / along;
    const p = curve.getPointAt(t);
    const N = frames.normals[i];
    const B = frames.binormals[i];
    const r =
      rEnd + (rStart - rEnd) * (1 - t) ** power + rStart * flare * (1 - t) ** 14;
    for (let j = 0; j <= radial; j++) {
      const a = (j / radial) * Math.PI * 2;
      const sin = Math.sin(a);
      const cos = Math.cos(a);
      const nx = cos * N.x + sin * B.x;
      const ny = cos * N.y + sin * B.y;
      const nz = cos * N.z + sin * B.z;
      positions.push(p.x + r * nx, p.y + r * ny, p.z + r * nz);
      normals.push(nx, ny, nz);
      // Metre-ish mapping so bark grain stays the same physical size on a
      // 0.34 m trunk and a 0.03 m twig — see uScale above for why it isn't
      // taken from this ring's own radius.
      uvs.push((j / radial) * uScale, t * length * 0.55);
    }
  }
  for (let i = 0; i < along; i++) {
    for (let j = 0; j < radial; j++) {
      const a = i * (radial + 1) + j;
      const b = a + radial + 1;
      // Wound so the *outside* of the tube is the front face. It was
      // a,b,a+1 / b,b+1,a+1, which is the opposite: the normals pushed
      // above point outward correctly, but the triangle order told the GPU
      // the inside was front. Backface culling then threw away the near
      // wall and drew the far interior instead, so trunks looked hollow and
      // their surface appeared to slide against the camera as you orbited —
      // and thin branches lost faces entirely and read as sparse.
      indices.push(a, a + 1, b, b, a + 1, b + 1);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  return geo;
}

// Three planes through a common vertical axis. A single billboarded quad
// would swim as the camera moves and a crossed pair still shows its edge-on
// gap at 45 degrees; three at 60 degrees never fully disappears from any
// angle and costs six triangles.
function tuftGeometry(size) {
  const blade = new THREE.PlaneGeometry(size, size);
  // Pivot at the bottom edge, so a tuft rotates about its attachment point.
  blade.translate(0, size / 2, 0);
  const parts = [0, Math.PI / 3, (2 * Math.PI) / 3].map((a) => {
    const g = blade.clone();
    g.rotateY(a);
    return g;
  });
  blade.dispose();
  return mergeGeometries(parts);
}

// ── the tree ───────────────────────────────────────────────────────────

// One tuft is a cluster of fascicles, not a whole bough: 30-60 cm across.
// The first pass had these between 0.9 and 1.75 m, and at that size they
// stop reading as needles and turn the crown into a palm.
const NEEDLE_MIN = 0.3;
const NEEDLE_VAR = 0.32;

// Just the geometry and the tuft placements, no meshes and no materials.
//
// Split out from createSouthernPine so the forest can build a handful of
// these once and then stamp them into a merged per-chunk mesh (see
// createTreeChunk in yard.js). A pine that owns its own Mesh, its own
// procedurally generated bark and its own needle InstancedMesh is right for
// the two hero trees at the road and ruinous for two hundred of them — it's
// two draw calls and two megabytes of canvas texture apiece.
export function buildSouthernPineParts(rand, options = {}) {
  const height = options.height ?? 20;
  // Where the lowest limb attaches, as a fraction of height. The photos of
  // the real pair have this a shade under halfway — the first branches come
  // off well below the mass of the crown, they're just short and sparse
  // there. It was 0.56, which read as a bare pole with a cap on top.
  const crownBase = options.crownBase ?? 0.44;
  const trunkR = options.trunkRadius ?? 0.34;
  // Scales the twig and needle-cluster counts only, not the limbs — the
  // silhouette is the limbs, so a forest pine at 0.5 still has the right
  // shape, just a thinner crown. The two hero trees stay at 1.
  const density = options.density ?? 1;
  // Scales how finely each limb is tubed — rings around it and steps along
  // it. Separate from `density` because they trade against completely
  // different things: density is what the crown looks like, detail is pure
  // triangle count for the same silhouette. The hero pines are looked at
  // from six feet away and stay at 1; a tree in the middle distance is
  // three pixels of trunk and does not need twelve-sided tubes.
  const detail = options.detail ?? 1;
  const seg = (n, floor) => Math.max(floor, Math.round(n * detail));

  // ── trunk ────────────────────────────────────────────────────────────
  // A gentle lean with a slight recovery near the top, rather than a
  // ruler-straight pole. Real ones of this size are never plumb.
  const leanAz = rand() * Math.PI * 2;
  const lean = (0.4 + rand() * 0.7) * (options.leanScale ?? 1);
  const trunkPts = [];
  const trunkSegs = 10;
  for (let i = 0; i <= trunkSegs; i++) {
    const f = i / trunkSegs;
    const bend = lean * f ** 1.7 - lean * 0.24 * f ** 3.4;
    trunkPts.push(
      new THREE.Vector3(
        Math.cos(leanAz) * bend + (rand() - 0.5) * 0.05,
        height * f,
        Math.sin(leanAz) * bend + (rand() - 0.5) * 0.05
      )
    );
  }
  const trunkCurve = new THREE.CatmullRomCurve3(trunkPts);
  // Near-cylindrical, with the flare kept to the bottom tenth by its own
  // term. The previous numbers — start 1.55x, end 0.16x, power 2.6 — put a
  // 4x reduction in the first half of the trunk, which is a witch's hat, not
  // a pine. A real one of this size is roughly as thick at the crown base as
  // two thirds of its butt diameter, and only spreads out in the last foot
  // above the ground.
  const woodGeos = [
    taperedTube(
      trunkCurve,
      trunkR * 1.05,
      trunkR * 0.42,
      seg(trunkSegs * 3, 8),
      seg(12, 6),
      1.5,
      0.5
    ),
  ];

  // ── limbs ────────────────────────────────────────────────────────────
  const tufts = [];
  // 14 put a ring of limbs every 20cm up a 2.8m crown, which is a
  // bottlebrush. Real whorls sit 40-60cm apart, and the gaps between them
  // are most of what you see sky through. 9 was a touch bare from the road,
  // so this sits just above it.
  const whorls = options.whorls ?? 11;
  // Spread is set against crown *height*, not overall height, and that
  // ratio is the whole silhouette. The crown runs from crownBase to the
  // top — about 8.8 m on a 20 m tree — so a 0.3 spread gave 6 m limbs and
  // a 12 m-wide crown: a parasol, markedly wider than tall. These read as
  // taller than wide in every photo, so the limbs have to come in.
  // Raised from 0.19. The photos show crowns roughly 0.6 as wide as the tree
  // is tall — broad, spreading limbs, not the narrow column 0.19 gave. The
  // old value was set to avoid a parasol on a 20m tree; at 4m the same ratio
  // reads as a bottlebrush instead.
  const maxLen = height * (options.spread ?? 0.34);
  // Golden angle between whorls, so successive rings of branches never
  // stack into visible columns down the trunk.
  const GOLDEN = Math.PI * (3 - Math.sqrt(5));

  for (let w = 0; w < whorls; w++) {
    const u = w / (whorls - 1);
    const f = crownBase + (1 - crownBase) * u;
    const attach = trunkCurve.getPointAt(f);
    const trunkRAt = trunkR + (trunkR * 0.16 - trunkR) * f;

    // Crown profile: shortest at the very bottom of the crown and at the
    // top, fullest just past the middle. That hump is the whole silhouette.
    const lenBase = maxLen * Math.sin(Math.PI * (0.15 + 0.8 * u));
    const perWhorl = 4 + Math.floor(rand() * 3);

    for (let b = 0; b < perWhorl; b++) {
      const az = w * GOLDEN + (b / perWhorl) * Math.PI * 2 + rand() * 0.5;
      // Heavy per-branch variation. A smooth envelope reads as a topiary;
      // the real crowns are visibly ragged, with gaps and long outliers.
      const len = lenBase * (0.62 + rand() * 0.75);
      // Relative to the tree, not an absolute 0.6m. That fixed floor was
      // written when these were 20m tall and maxLen was ~3.8m, so it culled
      // only genuine runts. Once the trees came down to ~4m, maxLen dropped
      // to under a metre and the same floor started throwing away every
      // short limb — which is all of the lower crown, since the crown
      // profile makes limbs shortest at its base. That's why the foliage had
      // retreated to a cap at the very top.
      if (len < maxLen * 0.16) continue;

      const dirX = Math.cos(az);
      const dirZ = Math.sin(az);
      // Lower limbs run out nearly level and turn up at the ends; upper
      // ones leave the trunk already climbing.
      const climb = 0.16 + 0.5 * u + rand() * 0.22;
      const sweep = (rand() - 0.5) * 0.5;
      // Lower limbs sag away from the trunk before turning up at the tip;
      // upper ones leave already climbing. Without the sag every branch
      // sweeps up on the same arc and the crown comes out a smooth vase.
      const droop = 0.28 * (1 - u);

      const segs = 6;
      const pts = [];
      for (let s = 0; s <= segs; s++) {
        const t = s / segs;
        const out = len * t;
        const rise = len * (climb * t ** 2.1 - droop * t);
        const side = sweep * len * t ** 1.6;
        pts.push(
          new THREE.Vector3(
            attach.x + dirX * out - dirZ * side,
            attach.y + rise,
            attach.z + dirZ * out + dirX * side
          )
        );
      }
      const curve = new THREE.CatmullRomCurve3(pts);
      const rBase = Math.min(trunkRAt * 0.62, 0.045 + len * 0.022);
      woodGeos.push(taperedTube(curve, rBase, rBase * 0.22, seg(segs, 3), seg(6, 4)));

      // Secondary twigs off the outer half of the limb. Hanging the
      // needles straight on the main branch gives a row of fronds down a
      // bare pole; the real mass comes from each limb splitting into a
      // handful of short shoots that each carry their own cluster.
      // Counts here and below are the crown's whole density budget, and they
      // were authored when these trees were 20m tall. Crown volume falls
      // with the cube of size, so at 5m the same numbers put ~2,800 tufts
      // into a crown that reads as a solid ball — and the open, see-through
      // crown is the single most identifying thing about the species.
      //
      // These land around 1,000. A first cut at ~500 was genuinely open but
      // went too far the other way and read as skeletal from the road: the
      // crown wants to be see-through, not sparse.
      const twigs = Math.max(1, Math.round((3 + Math.floor(rand() * 3)) * density));
      for (let k = 0; k < twigs; k++) {
        const t0 = 0.52 + rand() * 0.4;
        const base = curve.getPointAt(t0);
        const tan = curve.getTangentAt(t0);
        const twigLen = len * (0.16 + rand() * 0.22);
        // Splay off the parent, biased upward — pine shoots reach for light.
        const off = new THREE.Vector3(
          tan.z * (rand() - 0.5) * 2,
          0.5 + rand() * 0.8,
          -tan.x * (rand() - 0.5) * 2
        ).normalize();
        const twigDir = tan.clone().multiplyScalar(0.65).add(off.multiplyScalar(0.7)).normalize();
        const twigPts = [];
        for (let s = 0; s <= 3; s++) {
          const tt = s / 3;
          twigPts.push(
            base
              .clone()
              .addScaledVector(twigDir, twigLen * tt)
              .add(new THREE.Vector3(0, twigLen * 0.1 * tt * tt, 0))
          );
        }
        const twigCurve = new THREE.CatmullRomCurve3(twigPts);
        const twigR = Math.max(0.012, rBase * 0.34);
        woodGeos.push(taperedTube(twigCurve, twigR, twigR * 0.4, seg(3, 2), seg(5, 4)));

        const perTwig = Math.max(1, Math.round((3 + Math.floor(rand() * 3)) * density));
        for (let n = 0; n < perTwig; n++) {
          const tt = Math.min(1, 0.35 + (n / perTwig) * 0.7 + rand() * 0.1);
          tufts.push({
            pos: twigCurve.getPointAt(tt),
            dir: twigCurve.getTangentAt(tt),
            size: NEEDLE_MIN + rand() * NEEDLE_VAR,
            roll: rand() * Math.PI * 2,
          });
        }
      }

      // And a knot right on the limb's own tip, where the leading growth is.
      for (let n = 0; n < 2; n++) {
        const t = Math.min(1, 0.82 + rand() * 0.18);
        tufts.push({
          pos: curve.getPointAt(t),
          dir: curve.getTangentAt(t),
          size: NEEDLE_MIN + rand() * NEEDLE_VAR,
          roll: rand() * Math.PI * 2,
        });
      }
    }
  }

  // The leader — a last few tufts on the trunk above the top whorl, so the
  // tree comes to a ragged point instead of stopping flat.
  for (let i = 0; i < 5; i++) {
    const t = 0.93 + rand() * 0.07;
    tufts.push({
      pos: trunkCurve.getPointAt(Math.min(1, t)),
      dir: new THREE.Vector3(
        (rand() - 0.5) * 0.9,
        0.6 + rand() * 0.5,
        (rand() - 0.5) * 0.9
      ).normalize(),
      size: NEEDLE_MIN + rand() * NEEDLE_VAR,
      roll: rand() * Math.PI * 2,
    });
  }

  return { wood: mergeGeometries(woodGeos), tufts, height };
}

// The bark material, and the needle geometry/material/depth-material set.
// Both are per-call rather than module constants so the two hero pines can
// still each have their own procedurally generated bark and needles, while
// the forest builds one of each and shares it across every tree in it.
export function createPineBarkMaterial(rand) {
  const bark = makeBarkTextures(rand);
  return new THREE.MeshStandardMaterial({
    map: bark.map,
    // The fissure network is what gives bark its relief, and a flat-shaded
    // trunk reads as painted however good the colour is.
    bumpMap: bark.bump,
    bumpScale: 0.03,
    // Neutral. The old 0xa89078 multiplied an already-red map and was half
    // the reason the trunk came out looking like rust — the texture carries
    // its own colour now.
    color: 0xffffff,
    roughness: 0.95,
  });
}

export function createNeedleAssets(rand) {
  const map = makeNeedleTexture(rand);
  return {
    geometry: tuftGeometry(1),
    material: new THREE.MeshStandardMaterial({
      map,
      color: 0x7e9b63,
      roughness: 0.88,
      // alphaTest rather than transparent: a few hundred overlapping alpha
      // quads have no correct draw order, and sorting artefacts on a tree
      // this size are far more obvious than the hard needle edges are.
      alphaTest: 0.42,
      side: THREE.DoubleSide,
    }),
    // Without this the shadow pass ignores alphaTest and every tuft throws
    // the shadow of a solid three-plane box, which turns the crown's dappled
    // shade into a stack of dark slabs.
    depthMaterial: new THREE.MeshDepthMaterial({
      depthPacking: THREE.RGBADepthPacking,
      map,
      alphaTest: 0.42,
    }),
  };
}

// Writes one tuft's placement into `target`. Shared with the broadleaf,
// which hangs its leaf clusters exactly the same way, and used both for a
// standalone tree and for tufts being stamped into a chunk-wide instanced
// mesh — hence taking a matrix out rather than an InstancedMesh index.
const _up = new THREE.Vector3(0, 1, 0);
const _q = new THREE.Quaternion();
const _roll = new THREE.Quaternion();
const _scale = new THREE.Vector3();
export function composeTuftMatrix(target, tuft) {
  // Point the tuft's local +y (the direction the needles fan) along the
  // branch, then spin it about that axis so neighbouring tufts on the same
  // limb don't present identical silhouettes.
  _q.setFromUnitVectors(_up, tuft.dir);
  _roll.setFromAxisAngle(tuft.dir, tuft.roll);
  _q.premultiply(_roll);
  _scale.setScalar(tuft.size);
  return target.compose(tuft.pos, _q, _scale);
}

export function createSouthernPine(rand, options = {}) {
  const group = new THREE.Group();
  const parts = buildSouthernPineParts(rand, options);

  const wood = new THREE.Mesh(parts.wood, createPineBarkMaterial(rand));
  wood.castShadow = true;
  wood.receiveShadow = true;
  group.add(wood);

  const needles = createNeedleAssets(rand);
  const instances = new THREE.InstancedMesh(
    needles.geometry,
    needles.material,
    parts.tufts.length
  );
  const m = new THREE.Matrix4();
  parts.tufts.forEach((tuft, i) => instances.setMatrixAt(i, composeTuftMatrix(m, tuft)));
  instances.instanceMatrix.needsUpdate = true;
  instances.castShadow = true;
  instances.customDepthMaterial = needles.depthMaterial;
  group.add(instances);

  group.userData.trunkHeight = parts.height;
  return group;
}
