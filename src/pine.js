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
// The previous version drew soft ellipses and then laid a few wandering
// vertical lines over them, which came out as smeared rust rather than bark.
// Two things were wrong with that and both matter:
//
//   1. Plates need *hard edges*. The fissure is a gap between two flat
//      faces, not a dark line painted on a continuous surface. Soft-edged
//      blobs can never read as plates however they're tinted.
//   2. The fissure network runs both ways. Vertical-only furrows give
//      stripes; the real thing breaks horizontally too, which is what turns
//      stripes into plates.
//
// It was also far too red. The photos are grey-brown in the face with only a
// warm cast, and the strong colour was coming from the material's `color`
// multiplying an already-red map — the texture carries its own colour now
// and the material tint is neutral.
//
// Returns a bump map alongside, built from the same lattice: the fissures
// are what should catch a shadow, and flat-shaded bark stays looking painted
// no matter how good the colour is.
function makeBarkTextures(rand) {
  const W = 256;
  const H = 512;
  const col = canvas2d(W, H);
  const bmp = canvas2d(W, H);

  // Fissure colour underneath — plates are then laid on top, and whatever
  // shows between them is the furrow.
  col.ctx.fillStyle = '#2a1f18';
  col.ctx.fillRect(0, 0, W, H);
  bmp.ctx.fillStyle = '#000000';
  bmp.ctx.fillRect(0, 0, W, H);

  // One plate, drawn as a jittered quad. Repeated at ±W so plates crossing
  // the seam wrap cleanly and the trunk has no visible join.
  const plate = (x, y, w, h) => {
    const jx = () => (rand() - 0.5) * w * 0.22;
    const jy = () => (rand() - 0.5) * h * 0.22;
    const pts = [
      [x + jx(), y + jy()],
      [x + w + jx(), y + jy()],
      [x + w + jx(), y + h + jy()],
      [x + jx(), y + h + jy()],
    ];
    // Grey-brown face, warm but not red, with a fair spread plate to plate.
    const base = 104 + rand() * 46;
    const warm = 1 + rand() * 0.16;
    const face = `rgb(${Math.round(base * warm)},${Math.round(base * 0.86)},${Math.round(base * 0.72)})`;
    // Plates stand proud; the brightest are the most weathered.
    const lift = 150 + rand() * 80;

    for (const dx of [-W, 0, W]) {
      for (const [ctx2, fill] of [
        [col.ctx, face],
        [bmp.ctx, `rgb(${lift},${lift},${lift})`],
      ]) {
        ctx2.beginPath();
        ctx2.moveTo(pts[0][0] + dx, pts[0][1]);
        for (let i = 1; i < pts.length; i++) ctx2.lineTo(pts[i][0] + dx, pts[i][1]);
        ctx2.closePath();
        ctx2.fillStyle = fill;
        ctx2.fill();
      }

      // Thin flakes across the plate face. Southern pine plates are layered
      // like puff pastry and shed in sheets, and without this the faces read
      // as flat painted panels.
      col.ctx.save();
      col.ctx.beginPath();
      col.ctx.moveTo(pts[0][0] + dx, pts[0][1]);
      for (let i = 1; i < pts.length; i++) col.ctx.lineTo(pts[i][0] + dx, pts[i][1]);
      col.ctx.closePath();
      col.ctx.clip();
      const flakes = 2 + Math.floor(rand() * 4);
      for (let f = 0; f < flakes; f++) {
        const fy = y + rand() * h;
        col.ctx.strokeStyle = `rgba(${rand() < 0.5 ? '58,42,32' : '190,170,146'},${0.12 + rand() * 0.2})`;
        col.ctx.lineWidth = 1 + rand() * 1.6;
        col.ctx.beginPath();
        col.ctx.moveTo(x + dx - 2, fy);
        col.ctx.lineTo(x + dx + w + 2, fy + (rand() - 0.5) * 5);
        col.ctx.stroke();
      }
      col.ctx.restore();
    }
  };

  // Jittered rows of plates. Row heights and plate widths both vary, and
  // each row starts at its own offset, so the lattice never lines up into
  // visible columns.
  let y = -40;
  while (y < H + 40) {
    const rowH = 34 + rand() * 46;
    let x = -40 + rand() * 40;
    while (x < W + 40) {
      const pw = 26 + rand() * 42;
      plate(x, y, pw, rowH);
      // The gap left here is the fissure — width is the furrow depth.
      x += pw + 3 + rand() * 5;
    }
    y += rowH + 3 + rand() * 5;
  }

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
function taperedTube(curve, rStart, rEnd, along, radial, power = 1, flare = 0) {
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
      indices.push(a, b, a + 1, b, b + 1, a + 1);
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

export function createSouthernPine(rand, options = {}) {
  const height = options.height ?? 20;
  // Where the lowest limb attaches, as a fraction of height. The photos of
  // the real pair have this a shade under halfway — the first branches come
  // off well below the mass of the crown, they're just short and sparse
  // there. It was 0.56, which read as a bare pole with a cap on top.
  const crownBase = options.crownBase ?? 0.44;
  const trunkR = options.trunkRadius ?? 0.34;

  const group = new THREE.Group();
  const bark = makeBarkTextures(rand);
  const barkMat = new THREE.MeshStandardMaterial({
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
    taperedTube(trunkCurve, trunkR * 1.05, trunkR * 0.42, trunkSegs * 3, 12, 1.5, 0.5),
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
      woodGeos.push(taperedTube(curve, rBase, rBase * 0.22, segs, 6));

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
      const twigs = 3 + Math.floor(rand() * 3);
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
        woodGeos.push(taperedTube(twigCurve, twigR, twigR * 0.4, 3, 5));

        const perTwig = 3 + Math.floor(rand() * 3);
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

  const wood = new THREE.Mesh(mergeGeometries(woodGeos), barkMat);
  wood.castShadow = true;
  wood.receiveShadow = true;
  group.add(wood);

  // ── needles ──────────────────────────────────────────────────────────
  const needleTex = makeNeedleTexture(rand);
  const needleMat = new THREE.MeshStandardMaterial({
    map: needleTex,
    color: 0x7e9b63,
    roughness: 0.88,
    // alphaTest rather than transparent: a few hundred overlapping alpha
    // quads have no correct draw order, and sorting artefacts on a tree
    // this size are far more obvious than the hard needle edges are.
    alphaTest: 0.42,
    side: THREE.DoubleSide,
  });

  const instances = new THREE.InstancedMesh(tuftGeometry(1), needleMat, tufts.length);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  const roll = new THREE.Quaternion();
  tufts.forEach((tuft, i) => {
    // Point the tuft's local +y (the direction the needles fan) along the
    // branch, then spin it about that axis so neighbouring tufts on the
    // same limb don't present identical silhouettes.
    q.setFromUnitVectors(up, tuft.dir);
    roll.setFromAxisAngle(tuft.dir, tuft.roll);
    q.premultiply(roll);
    scale.setScalar(tuft.size);
    m.compose(tuft.pos, q, scale);
    instances.setMatrixAt(i, m);
  });
  instances.instanceMatrix.needsUpdate = true;
  instances.castShadow = true;
  // Without this the shadow pass ignores alphaTest and every tuft throws
  // the shadow of a solid three-plane box, which turns the crown's dappled
  // shade into a stack of dark slabs.
  instances.customDepthMaterial = new THREE.MeshDepthMaterial({
    depthPacking: THREE.RGBADepthPacking,
    map: needleTex,
    alphaTest: 0.42,
  });
  group.add(instances);

  group.userData.trunkHeight = height;
  return group;
}
