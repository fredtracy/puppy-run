import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// Coconut palms for the pond glade.
//
// Its own module rather than another shape in broadleaf.js, because a palm
// isn't a tree in the sense that file means. There is no branching: a palm
// is one leaning unbranched stem with a crown of fronds at the very top and
// nothing anywhere else. The whole of broadleaf.js is about trunks giving
// out into leaders and leaders forking again, which describes none of it.
//
// Three things carry the read, and none of them is the trunk:
//
//   * the lean. A coconut palm almost never stands straight — it curves
//     toward the light and away from the prevailing wind, and a vertical
//     one immediately looks like a telegraph pole with a hat.
//   * the frond droop. Fronds leave the crown going *up and out*, then
//     bend over under their own weight. A straight frond reads as a spike.
//   * the crown sitting entirely at the top. The bare stem below it is
//     most of the silhouette.

const TRUNK_SEGMENTS = 10;
const TRUNK_SIDES = 7;

// The stem: a swept tube following a curve that leans and then straightens
// slightly near the crown, the way a palm does as it grows back toward
// vertical.
function buildTrunk(height, baseR, lean, leanDir, rand) {
  const positions = [];
  const indices = [];
  const rings = TRUNK_SEGMENTS;

  const centre = [];
  for (let i = 0; i <= rings; i++) {
    const t = i / rings;
    // Lean grows fastest low down and eases off near the top — that's the
    // characteristic palm curve, rather than a constant arc.
    const bend = Math.sin(t * Math.PI * 0.62) * lean;
    centre.push([
      Math.cos(leanDir) * bend * height,
      t * height,
      Math.sin(leanDir) * bend * height,
    ]);
  }

  for (let i = 0; i <= rings; i++) {
    const t = i / rings;
    // Tapers hard in the first fifth — palms are swollen at the base —
    // then very gently for the rest of the run.
    const taper = t < 0.2
      ? 1 - (t / 0.2) * 0.35
      : 0.65 - ((t - 0.2) / 0.8) * 0.22;
    const r = baseR * taper;
    const [cx, cy, cz] = centre[i];
    for (let s = 0; s < TRUNK_SIDES; s++) {
      const a = (s / TRUNK_SIDES) * Math.PI * 2;
      // A little per-ring wobble, so the stem isn't a machined cylinder.
      const wob = 1 + (rand() - 0.5) * 0.13;
      positions.push(cx + Math.cos(a) * r * wob, cy, cz + Math.sin(a) * r * wob);
    }
  }
  for (let i = 0; i < rings; i++) {
    for (let s = 0; s < TRUNK_SIDES; s++) {
      const a = i * TRUNK_SIDES + s;
      const b = i * TRUNK_SIDES + ((s + 1) % TRUNK_SIDES);
      const c = a + TRUNK_SIDES;
      const d = b + TRUNK_SIDES;
      indices.push(a, c, b, b, c, d);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return { geo, tip: centre[rings] };
}

// One frond: a tapering strip that leaves the crown rising, then arcs over
// and hangs. Built as a flat ribbon with a kink along its spine so it isn't
// a plane seen edge-on from the side.
function buildFrond(length, width, droop, rand) {
  const STEPS = 7;
  const positions = [];
  const indices = [];
  for (let i = 0; i <= STEPS; i++) {
    const t = i / STEPS;
    // Up first, then over. The peak is early, so most of the frond is on
    // its way down — which is what makes it hang rather than arch.
    const rise = Math.sin(t * 1.5) * 0.45 - t * t * droop;
    const out = t * length;
    // Widest a third of the way along, tapering to a point.
    const w = width * Math.sin(Math.min(1, t * 1.35) * Math.PI * 0.85);
    // The spine sits slightly above the two edges, giving the frond a
    // shallow V section so it catches light from more than one direction.
    const spine = w * 0.22;
    positions.push(out, rise + spine, 0);
    positions.push(out, rise, -w);
    positions.push(out, rise, w);
  }
  for (let i = 0; i < STEPS; i++) {
    const a = i * 3;
    const b = a + 3;
    // left half
    indices.push(a, a + 1, b, b, a + 1, b + 1);
    // right half
    indices.push(a, b, a + 2, b, b + 2, a + 2);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

// A coconut: a squashed sphere, in a cluster tucked under the crown.
function buildNuts(rand) {
  const geos = [];
  const count = 3 + Math.floor(rand() * 4);
  for (let i = 0; i < count; i++) {
    const g = new THREE.SphereGeometry(0.085 + rand() * 0.03, 6, 5);
    g.scale(1, 0.85, 0.92);
    const a = rand() * Math.PI * 2;
    const r = 0.12 + rand() * 0.14;
    g.translate(Math.cos(a) * r, -0.1 - rand() * 0.12, Math.sin(a) * r);
    geos.push(g);
  }
  return mergeGeometries(geos);
}

// Returns { wood, frond, nut } geometries in the palm's own space, origin
// at the foot of the stem. Merged per part so a stand of palms costs three
// draw calls rather than three per tree.
export function createPalm(rand, opts = {}) {
  const height = opts.height ?? 6.5 + rand() * 3.5;
  const baseR = opts.baseR ?? 0.17 + rand() * 0.05;
  const lean = 0.07 + rand() * 0.1;
  const leanDir = rand() * Math.PI * 2;

  const { geo: wood, tip } = buildTrunk(height, baseR, lean, leanDir, rand);

  const fronds = [];
  const count = 9 + Math.floor(rand() * 5);
  for (let i = 0; i < count; i++) {
    // Spread round the crown with jitter, so they aren't a fan of evenly
    // spaced spokes.
    const a = (i / count) * Math.PI * 2 + (rand() - 0.5) * 0.5;
    const len = 1.9 + rand() * 1.1;
    const g = buildFrond(len, 0.22 + rand() * 0.08, 0.55 + rand() * 0.5, rand);
    const m = new THREE.Matrix4();
    m.compose(
      new THREE.Vector3(tip[0], tip[1], tip[2]),
      new THREE.Quaternion().setFromEuler(
        // Tilt each frond up a little before the droop takes over; the
        // outer ones sit flatter than the inner ones.
        new THREE.Euler(0, a, 0.15 + rand() * 0.35, 'YZX')
      ),
      new THREE.Vector3(1, 1, 1)
    );
    g.applyMatrix4(m);
    fronds.push(g);
  }

  const nut = buildNuts(rand);
  nut.translate(tip[0], tip[1], tip[2]);

  return { wood, frond: mergeGeometries(fronds), nut };
}
