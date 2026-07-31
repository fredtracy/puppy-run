import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { taperedTube } from './pine.js';

// The deciduous half of the woods, built the way pine.js builds a pine:
// real tapered limb geometry and discrete foliage clusters hung on the
// twigs, rather than a cylinder with a few spheres balanced on it.
//
// The cheap version this replaces got the same three things wrong that the
// stacked-cone pine did, and for the same reason — it was a silhouette
// approximated from outside instead of a structure built from inside:
//
//   1. **No limbs.** A tree read from any distance is mostly branch. Four
//      spheres on a stick has no branch at all, so it reads as a lollipop
//      from every angle and there is no tinting or texturing that fixes it.
//   2. **A solid crown.** You can see sky through a real canopy everywhere.
//      A sphere is opaque by construction, so the crown was a painted ball.
//   3. **One fork, at best.** Real branching is recursive and self-similar —
//      it's the repeated splitting that makes the eye read "tree", and one
//      level of it isn't enough for that to happen.
//
// Where this deliberately differs from the pine: a pine is one straight
// leader with whorls of limbs hung off it, and a broadleaf is the opposite —
// the trunk gives out a third of the way up and hands over to a few
// competing leaders that fork, and fork again. So this recurses where the
// pine loops.
//
// Cost: nothing in here is built per tree. The forest builds about a dozen
// of these once and stamps them (see createTreeChunk in yard.js), which is
// what makes real geometry affordable at a few hundred trees.

const TAU = Math.PI * 2;
const UP = new THREE.Vector3(0, 1, 0);

// ── foliage texture ────────────────────────────────────────────────────

// One leaf cluster — thirty-odd leaves on short stems radiating from a
// single attachment point, drawn with the pivot at the bottom centre so a
// cluster can be dropped on a twig and pointed along it, exactly like the
// pine's needle tuft.
//
// The gaps matter more than the leaves. This is what replaces an opaque
// sphere, so if it's drawn dense enough to be solid the whole exercise is
// pointless — the canopy has to be something you can see through.
function makeLeafClusterTexture(rand, options = {}) {
  // How many leaves and how big, as a pair. The canopy wants an open
  // cluster you can see sky through; the understory wants the opposite —
  // smaller leaves, more of them, and enough overlap that a thicket four
  // metres deep is genuinely solid. Same drawing code, opposite job.
  const leafCount = options.leafCount ?? 46;
  const leafScale = options.leafScale ?? 1;
  const stemCount = options.stemCount ?? 9;

  const S = 256;
  const canvas = document.createElement('canvas');
  canvas.width = S;
  canvas.height = S;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, S, S);

  const ox = S / 2;
  const oy = S * 0.97;

  // Twigs first, so the leaves sit on top of them. Without these the
  // leaves float in a ring with a visible hole in the middle.
  ctx.lineCap = 'round';
  const stems = [];
  for (let i = 0; i < stemCount; i++) {
    const angle = -Math.PI / 2 + (rand() - 0.5) * Math.PI * 1.05;
    const len = S * (0.3 + rand() * 0.42);
    const ex = ox + Math.cos(angle) * len;
    const ey = oy + Math.sin(angle) * len;
    stems.push([ex, ey, angle]);
    ctx.strokeStyle = `rgba(${64 + rand() * 30},${52 + rand() * 26},${34 + rand() * 20},0.85)`;
    ctx.lineWidth = 1.2 + rand() * 1.4;
    ctx.beginPath();
    ctx.moveTo(ox, oy);
    ctx.quadraticCurveTo((ox + ex) / 2 + (rand() - 0.5) * 20, (oy + ey) / 2, ex, ey);
    ctx.stroke();
  }

  // A single leaf: two quadratics meeting at a point, so it comes to a tip
  // rather than being an ellipse. Rounded blobs read as a hedge.
  const leaf = (x, y, len, wide, angle, fill) => {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.quadraticCurveTo(wide, -len * 0.42, 0, -len);
    ctx.quadraticCurveTo(-wide, -len * 0.42, 0, 0);
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
    // Midrib. Barely visible at the size these are drawn on screen, but it
    // stops each leaf being a flat colour chip.
    ctx.strokeStyle = 'rgba(30,52,26,0.3)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(0, -len * 0.9);
    ctx.stroke();
    ctx.restore();
  };

  for (let i = 0; i < leafCount; i++) {
    // Hung off a stem most of the time, scattered loose the rest, so the
    // cluster has both structure and a ragged outline.
    const onStem = stems[Math.floor(rand() * stems.length)];
    const along = 0.35 + rand() * 0.75;
    const bx = ox + (onStem[0] - ox) * along + (rand() - 0.5) * 26;
    const by = oy + (onStem[1] - oy) * along + (rand() - 0.5) * 26;
    const len = S * (0.13 + rand() * 0.13) * leafScale;
    const wide = len * (0.3 + rand() * 0.18);
    // Leaves hang off their stem rather than pointing straight out from
    // the middle — a radial fan reads as a starburst.
    const angle = onStem[2] + Math.PI / 2 + (rand() - 0.5) * 2.4;
    const g = 92 + Math.floor(rand() * 66);
    const shade = 0.72 + rand() * 0.5;
    leaf(
      bx,
      by,
      len,
      wide,
      angle,
      `rgba(${Math.floor(g * 0.44 * shade)},${Math.floor(g * shade)},${Math.floor(g * 0.36 * shade)},${0.86 + rand() * 0.14})`
    );
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

// Three planes through a common vertical axis — same trick and same reason
// as the pine's needle tuft: a single quad swims as the camera moves, a
// crossed pair vanishes edge-on at 45 degrees, three at 60 never fully
// disappear, and it costs six triangles.
function clusterGeometry(size) {
  const blade = new THREE.PlaneGeometry(size, size);
  blade.translate(0, size / 2, 0);
  const parts = [0, Math.PI / 3, (2 * Math.PI) / 3].map((a) => {
    const g = blade.clone();
    g.rotateY(a);
    return g;
  });
  blade.dispose();
  return mergeGeometries(parts);
}

// White base colour deliberately: the forest tints these per tree through
// InstancedMesh.instanceColor, so a whole stand isn't one flat green. A
// coloured material here would multiply that a second time.
export function createLeafAssets(rand, options) {
  const map = makeLeafClusterTexture(rand, options);
  return {
    geometry: clusterGeometry(1),
    material: new THREE.MeshStandardMaterial({
      map,
      color: 0xffffff,
      roughness: 0.9,
      alphaTest: 0.4,
      side: THREE.DoubleSide,
    }),
    depthMaterial: new THREE.MeshDepthMaterial({
      depthPacking: THREE.RGBADepthPacking,
      map,
      alphaTest: 0.4,
    }),
  };
}

// ── the tree ───────────────────────────────────────────────────────────

// Ring counts per branching level. The trunk gets enough to read as round
// up close; a terminal twig is two or three pixels wide with leaves hanging
// off it and gets four, because nothing about it is ever visible.
//
// These are the whole triangle budget, and the outermost level is most of
// it — there are twenty-odd terminal twigs to one trunk, so a ring saved
// out there is worth twenty saved on the trunk.
const RADIAL_BY_DEPTH = [7, 5, 4, 4];

export function buildBroadleafParts(rand, options = {}) {
  const height = options.height ?? 7;
  const trunkR = options.trunkRadius ?? height * 0.036;
  // Where the trunk stops being a trunk. Low — that's the difference
  // between a broadleaf and a conifer, and the reason this recurses.
  const forkAt = options.forkAt ?? 0.26 + rand() * 0.12;
  const maxDepth = options.maxDepth ?? 3;
  // Scales foliage only, never the limbs — the limbs are the silhouette.
  const density = options.density ?? 1;
  // Crown half-width as a fraction of height. Broadleaves in a wood are
  // drawn up and narrow by their neighbours; ones in the open spread. The
  // caller picks, since the tree line has both.
  const spread = options.spread ?? 0.38;
  const leafScale = (options.leafScale ?? 1) * (height / 7);

  const wood = [];
  const tufts = [];

  function addTufts(curve, from, count) {
    const n = Math.max(1, Math.round(count * density));
    for (let i = 0; i < n; i++) {
      const t = Math.min(1, from + rand() * (1 - from));
      tufts.push({
        pos: curve.getPointAt(t),
        dir: curve.getTangentAt(t),
        size: (0.42 + rand() * 0.3) * leafScale,
        roll: rand() * TAU,
      });
    }
  }

  // One limb, and then its children. `dir` is where it sets off; the curve
  // arcs up and to one side from there, because a straight limb reads as
  // scaffolding — the arc is most of what makes this look grown.
  function grow(start, dir, len, radius, depth) {
    // Steps along the limb. The arc is the point of these, so the inner
    // levels get enough to curve; a terminal twig is short and nearly
    // straight and two steps is all it can show.
    const segs = depth === 0 ? 5 : depth >= 3 ? 2 : 3;
    const perp = new THREE.Vector3().crossVectors(dir, UP);
    if (perp.lengthSq() < 1e-6) perp.set(1, 0, 0);
    perp.normalize();

    // Lower limbs arc up hard (reaching past the canopy above them); higher
    // ones are already pointed at the light and stay straighter.
    const bendUp = (0.34 - depth * 0.07) * (0.6 + rand() * 0.9);
    const sway = (rand() - 0.5) * 0.4;

    const pts = [];
    for (let s = 0; s <= segs; s++) {
      const t = s / segs;
      pts.push(
        new THREE.Vector3()
          .copy(start)
          .addScaledVector(dir, len * t)
          .addScaledVector(UP, len * bendUp * t * t)
          .addScaledVector(perp, len * sway * t * t)
      );
    }
    const curve = new THREE.CatmullRomCurve3(pts);
    const rEnd = radius * 0.55;
    wood.push(
      taperedTube(curve, radius, rEnd, segs, RADIAL_BY_DEPTH[Math.min(depth, 3)], 1.25)
    );

    if (depth >= maxDepth) {
      // Terminal twig: foliage along its outer two thirds, and always
      // something right on the tip so the branch doesn't end bare.
      addTufts(curve, 0.34, 2 + rand() * 2);
      return;
    }

    const tip = curve.getPointAt(1);
    const tan = curve.getTangentAt(1);
    // Two children usually, three sometimes. Always at least two, or the
    // "branch" is just a longer branch and nothing ever forks.
    const kids = 2 + (rand() < 0.42 ? 1 : 0);
    for (let k = 0; k < kids; k++) {
      // Rotate the parent's own end direction away from itself about a
      // random perpendicular axis, rather than picking a fresh direction —
      // children carrying their parent's heading is what makes a branching
      // structure read as one tree instead of a bundle of sticks.
      const axis = new THREE.Vector3(rand() - 0.5, rand() - 0.5, rand() - 0.5)
        .cross(tan)
        .normalize();
      const diverge = 0.4 + rand() * 0.55;
      const kdir = tan
        .clone()
        .applyAxisAngle(axis, diverge)
        .addScaledVector(UP, 0.14)
        .normalize();
      grow(tip, kdir, len * (0.56 + rand() * 0.22), rEnd * 0.86, depth + 1);
    }

    // A little foliage on the inner limbs too, not only at the tips. Real
    // crowns aren't hollow shells — leaving these off gave a ring of green
    // with a visible void inside it whenever you looked up through one.
    if (depth >= maxDepth - 1) addTufts(curve, 0.55, 1);
  }

  // ── trunk ────────────────────────────────────────────────────────────
  // Multi-stemmed trees are common in a fence line, and the three on the
  // left of the owner's photo are crepe myrtles, which are always that way.
  const stems = options.stems ?? 1;
  const clumpLean = rand() * TAU;

  for (let stem = 0; stem < stems; stem++) {
    const leanAz = stems > 1 ? clumpLean + (stem / stems) * TAU : rand() * TAU;
    // A multi-stem clump leans its stems apart from a shared root; a single
    // trunk just isn't plumb.
    const lean = (stems > 1 ? 0.1 + rand() * 0.06 : 0.03 + rand() * 0.07) * height;
    const stemR = trunkR * (stems > 1 ? 0.72 : 1);
    const top = height * forkAt * (stems > 1 ? 0.85 + rand() * 0.3 : 1);

    const segs = 6;
    const trunkPts = [];
    for (let i = 0; i <= segs; i++) {
      const f = i / segs;
      const bend = lean * f ** 1.7;
      trunkPts.push(
        new THREE.Vector3(
          Math.cos(leanAz) * bend + (rand() - 0.5) * 0.03,
          top * f,
          Math.sin(leanAz) * bend + (rand() - 0.5) * 0.03
        )
      );
    }
    const trunkCurve = new THREE.CatmullRomCurve3(trunkPts);
    // Same two-term taper as the pine's trunk: a gentle overall thinning
    // plus a root flare confined to the bottom of the run, because one
    // exponent can't do both without turning the trunk into a spike.
    wood.push(taperedTube(trunkCurve, stemR * 1.05, stemR * 0.6, segs * 2, 7, 1.4, 0.5));

    const tip = trunkCurve.getPointAt(1);
    const tan = trunkCurve.getTangentAt(1);
    const leaders = 3 + Math.floor(rand() * 2);
    for (let b = 0; b < leaders; b++) {
      const az = leanAz + (b / leaders) * TAU + rand() * 0.6;
      // Off vertical. Wide enough that the crown spreads rather than
      // growing as a column, but the leaders still climb.
      const tilt = 0.4 + rand() * 0.36;
      const dir = new THREE.Vector3(
        Math.sin(tilt) * Math.cos(az),
        Math.cos(tilt),
        Math.sin(tilt) * Math.sin(az)
      )
        .addScaledVector(tan, 0.35)
        .normalize();
      // Sized off the crown the tree is meant to end up with, so `spread`
      // actually controls the silhouette instead of being advisory.
      const len = height * spread * (0.78 + rand() * 0.5);
      grow(tip, dir, len, stemR * 0.6, 1);
    }
  }

  // Scale the finished tree to the height that was actually asked for.
  //
  // `height` can't control this directly the way it does on a pine, where
  // the trunk *is* the height. Here it only seeds the first limb length,
  // and every level of recursion arcs upward on top of its parent — so the
  // finished tree lands somewhere between 1.3x and 1.7x the number, and
  // which end depends on how the branch angles happened to roll. Two
  // templates were coming out at 13 m from a request for 7.5.
  //
  // Measuring and correcting is both simpler and more honest than trying to
  // solve for the right seed length: the shape is whatever it grew into,
  // and only its size gets pinned. Uniform, and about the origin, which is
  // where the base of the trunk sits — so the tree stays on the ground and
  // keeps its proportions.
  const geometry = mergeGeometries(wood);
  geometry.computeBoundingBox();
  const grown = geometry.boundingBox.max.y;
  if (grown > 0.01) {
    const k = height / grown;
    geometry.scale(k, k, k);
    for (const tuft of tufts) {
      tuft.pos.multiplyScalar(k);
      tuft.size *= k;
    }
  }

  return { wood: geometry, tufts, height };
}
