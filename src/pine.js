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

// Deeply furrowed bark broken into irregular plates, which is what southern
// yellow pine actually has close up — vertical fissures with reddish-grey
// plates between them, not the smooth brown wrap the shared TRUNK_MAT gives.
function makeBarkTexture(rand) {
  const W = 256;
  const H = 512;
  const { canvas, ctx } = canvas2d(W, H);

  ctx.fillStyle = '#6b5445';
  ctx.fillRect(0, 0, W, H);

  // Plates first, then the fissures cut through them.
  for (let i = 0; i < 420; i++) {
    const pw = 18 + rand() * 46;
    const ph = 20 + rand() * 60;
    const px = rand() * W;
    const py = rand() * H;
    const tone = 96 + Math.floor(rand() * 62);
    ctx.fillStyle = `rgb(${tone + 22},${Math.floor(tone * 0.78)},${Math.floor(tone * 0.62)})`;
    ctx.globalAlpha = 0.35 + rand() * 0.4;
    ctx.beginPath();
    ctx.ellipse(px, py, pw / 2, ph / 2, (rand() - 0.5) * 0.5, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  // Vertical fissures. They wander rather than running dead straight, and
  // they wrap the texture horizontally so the trunk has no visible seam.
  for (let i = 0; i < 34; i++) {
    let x = rand() * W;
    ctx.strokeStyle = `rgba(38,26,20,${0.5 + rand() * 0.45})`;
    ctx.lineWidth = 2 + rand() * 6;
    ctx.beginPath();
    ctx.moveTo(x, -10);
    for (let y = 0; y <= H + 10; y += 26) {
      x += (rand() - 0.5) * 13;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = 8;
  return texture;
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
function taperedTube(curve, rStart, rEnd, along, radial, power = 1) {
  const frames = curve.computeFrenetFrames(along, false);
  const positions = [];
  const normals = [];
  const uvs = [];
  const indices = [];
  const length = curve.getLength();

  for (let i = 0; i <= along; i++) {
    const t = i / along;
    const p = curve.getPointAt(t);
    const N = frames.normals[i];
    const B = frames.binormals[i];
    const r = rEnd + (rStart - rEnd) * (1 - t) ** power;
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
      // 0.34 m trunk and a 0.03 m twig.
      uvs.push((j / radial) * Math.max(1, r * 8), t * length * 0.55);
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
  // The photos are consistent about this: no limb anywhere on the lower
  // half. Everything that makes the silhouette happens above it.
  const crownBase = options.crownBase ?? 0.56;
  const trunkR = options.trunkRadius ?? 0.34;

  const group = new THREE.Group();
  const barkMat = new THREE.MeshStandardMaterial({
    map: makeBarkTexture(rand),
    color: 0xa89078,
    roughness: 0.97,
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
  // 2.6 gives a pronounced swell in the first metre or so and a near-even
  // taper above it. These sit on a visible root flare in the photos, and a
  // straight cone reads as a post driven into the turf.
  const woodGeos = [taperedTube(trunkCurve, trunkR * 1.55, trunkR * 0.16, trunkSegs * 3, 12, 2.6)];

  // ── limbs ────────────────────────────────────────────────────────────
  const tufts = [];
  const whorls = options.whorls ?? 14;
  // Spread is set against crown *height*, not overall height, and that
  // ratio is the whole silhouette. The crown runs from crownBase to the
  // top — about 8.8 m on a 20 m tree — so a 0.3 spread gave 6 m limbs and
  // a 12 m-wide crown: a parasol, markedly wider than tall. These read as
  // taller than wide in every photo, so the limbs have to come in.
  const maxLen = height * (options.spread ?? 0.19);
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
      if (len < 0.6) continue;

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
      const twigs = 4 + Math.floor(rand() * 4);
      for (let k = 0; k < twigs; k++) {
        const t0 = 0.44 + rand() * 0.46;
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

        const perTwig = 5 + Math.floor(rand() * 4);
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
      for (let n = 0; n < 4; n++) {
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
