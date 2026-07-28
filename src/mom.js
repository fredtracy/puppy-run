import * as THREE from 'three';

// Miranda — anime/Ghibli styled, and deliberately a different visual language
// from Darla.
//
// Darla stays blocky on purpose: a stack of primitives reads fine when
// everything around it is also primitive, and on a dog it's funny. A human at
// that fidelity doesn't read as stylised, it reads as a failed human — we
// scrutinise faces and proportions far too closely to get away with it. So
// Miranda commits to being *drawn* instead of approximated:
//
//   * cel shading — three flat bands, hard terminator
//   * an ink outline via inverted hull
//   * one continuous swept body profile rather than stacked cylinders, so she
//     has a real hourglass silhouette
//   * a graphic face: big simple eyes read as a design choice, whereas
//     slightly-wrong realistic ones read as a mistake
//   * strand hair (kept from the previous pass — under toon shading it stops
//     being the one high-detail thing on a low-detail body and just belongs)
//
// Proportions follow the reference: curvy, defined waist, and a head large
// enough to sit in anime territory rather than realistic eight-heads.
const COLORS = {
  skin: 0xffe4d4,
  hairTint: 0x8a4a38,
  outfit: 0x1b1a22,
  corset: 0x101018,
  lace: 0x4a4a55,
  tights: 0x22222c,
  boots: 0x0d0d13,
  lips: 0x5e1c34,
  blush: 0xf0a9a4,
  metal: 0xb8b8c2,
  // Blue rather than the reference illustration's green — the photos are the
  // truth for who she is, the illustration is only the truth for the style.
  eye: 0x5ea3d8,
  eyeDeep: 0x2f6aa6,
  liner: 0x1a1016,
};

function mesh(geometry, material) {
  const m = new THREE.Mesh(geometry, material);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

// ── anime shading ───────────────────────────────────────────────────────

// Flat bands rather than a smooth ramp — the hard step between lit and
// shadow is most of what says "anime" before you've even looked at the face.
function makeToonGradient(stops) {
  const data = new Uint8Array(stops.length * 4);
  stops.forEach((s, i) => {
    const v = Math.round(s * 255);
    data[i * 4] = v;
    data[i * 4 + 1] = v;
    data[i * 4 + 2] = v;
    data[i * 4 + 3] = 255;
  });
  const texture = new THREE.DataTexture(data, stops.length, 1, THREE.RGBAFormat);
  texture.minFilter = THREE.NearestFilter;
  texture.magFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}
const TOON_GRADIENT = makeToonGradient([0.46, 0.76, 1.0]);

// Skin gets its own, far gentler ramp. The punchy three-band version is right
// for cloth and hair, but on a face the terminator is a hard-edged patch
// sweeping across the cheek and jaw, and at skin tones that reads as
// stubble — she looked like she needed a shave. Anime renders faces nearly
// flat for exactly this reason: one soft step, no drama.
const SKIN_GRADIENT = makeToonGradient([0.87, 1.0]);

function toonMat(color, extra = {}) {
  return new THREE.MeshToonMaterial({ color, gradientMap: TOON_GRADIENT, ...extra });
}

function skinToonMat(color) {
  return new THREE.MeshToonMaterial({ color, gradientMap: SKIN_GRADIENT });
}

// Ink outline by inverted hull: the same geometry drawn back-faces-only and
// pushed out along its normals, so it survives behind the real mesh as a rim.
// Offsetting along the normal rather than scaling the whole mesh keeps the
// line an even weight on shapes that aren't spheres — a uniform scale makes
// it thin at the ends of anything elongated.
const OUTLINE_COLOR = 0x1b1116;
function makeOutlineMaterial(thickness) {
  const material = new THREE.MeshBasicMaterial({
    color: OUTLINE_COLOR,
    side: THREE.BackSide,
  });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uOutline = { value: thickness };
    shader.vertexShader = `uniform float uOutline;\n${shader.vertexShader}`.replace(
      '#include <begin_vertex>',
      '#include <begin_vertex>\n  transformed += normalize(normal) * uOutline;'
    );
  };
  return material;
}

// A lathe is radially symmetric, so any radius that widens the hips sideways
// pushes the same distance forward — which renders as a belly. Nobody is
// circular in plan: hips are wide side to side and flat front to back, while
// the bust does project. So this squashes z as a function of height, hard at
// the hip and easing back to full by the bust.
//
// Symmetric front-to-back on purpose. Scaling the front more than the back
// would be closer to anatomy, but it puts a discontinuity down the side seam,
// and toon shading renders any crease as a drawn line — she'd have a stripe
// down each flank.
// Squashes z from `atZ` at world height `atY`, easing back to circular by
// world height `toY`. `toY` may be above or below `atY` — the skirt runs the
// opposite way to the bodice, flat where it meets the hip and round by the
// hem.
function flattenZ(geo, baseY, atY, toY, atZ) {
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const t = THREE.MathUtils.clamp((baseY + pos.getY(i) - atY) / (toY - atY), 0, 1);
    const eased = t * t * (3 - 2 * t);
    pos.setZ(i, pos.getZ(i) * (atZ + (1 - atZ) * eased));
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  return geo;
}

// Tapers the bottom of a head sphere to a chin. A scaled sphere gives a
// rounded, wide jaw — fine on Darla, but on a stylised human it reads square
// and heavy. Narrowing below the cheekbone gives the pointed chin the style
// wants, and because the outline shell shares this geometry it follows for
// free.
//
// The taper deliberately starts *below* the mouth: everything on the face is
// positioned against the head's surface, so pulling that surface inward any
// higher would leave the lips and nose floating in front of it.
function taperChin(geo, cheekY, chinY, chinScale) {
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    if (y >= cheekY) continue;
    const t = THREE.MathUtils.clamp((cheekY - y) / (cheekY - chinY), 0, 1);
    const s = 1 + (chinScale - 1) * t * t;
    pos.setX(i, pos.getX(i) * s);
    pos.setZ(i, pos.getZ(i) * s);
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  return geo;
}

// Attaches an outline shell to a mesh, riding along as a child at identity so
// it inherits the parent's transform for free.
function outline(target, thickness = 0.007) {
  const shell = new THREE.Mesh(target.geometry, makeOutlineMaterial(thickness));
  shell.castShadow = false;
  shell.receiveShadow = false;
  target.add(shell);
  return target;
}

// ── hair ────────────────────────────────────────────────────────────────
// Strand cards rather than solid capsules: ~360 thin tapered ribbons rooted
// over the scalp, each carrying a texture of finer filaments, all merged into
// one mesh and swayed in the vertex shader.
//
// Same idea the grass uses (see createLushGrassMaterial in yard.js) —
// geometry for the silhouette, a texture for the detail below what geometry
// can afford, and the motion on the GPU so nothing re-uploads per frame.

// Driven from main.js each frame, exactly like setGrassTime.
const hairTime = { value: 0 };
export function setHairTime(t) {
  hairTime.value = t;
}

// Fine vertical filaments with gaps between them. u runs across the ribbon so
// the filaments sit side by side; v runs root-to-tip, and alpha falls off
// toward the tip so strands thin out instead of ending on a hard edge.
function makeHairTexture() {
  const W = 64;
  const H = 256;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, W, H);

  for (let i = 0; i < 44; i++) {
    const x = Math.random() * W;
    const w = 0.7 + Math.random() * 1.9;
    // Dark at the root, auburn at the tip — the two-tone rides along each
    // strand's own length rather than coming from separate meshes.
    const grad = ctx.createLinearGradient(0, 0, 0, H);
    const warm = 40 + Math.random() * 45;
    grad.addColorStop(0, `rgba(38,20,16,${0.78 + Math.random() * 0.22})`);
    grad.addColorStop(0.55, `rgba(${74 + warm * 0.6},${34 + warm * 0.2},${26 + warm * 0.12},0.92)`);
    grad.addColorStop(1, `rgba(${120 + warm},${58 + warm * 0.5},${42 + warm * 0.3},0)`);
    ctx.strokeStyle = grad;
    ctx.lineWidth = w;
    ctx.beginPath();
    ctx.moveTo(x, -4);
    // A gentle drift across the card so the filaments aren't a barcode.
    for (let y = 0; y <= H; y += 24) {
      ctx.lineTo(x + Math.sin(y * 0.012 + i) * 2.4, y);
    }
    ctx.stroke();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

// One tapered ribbon following a falling, waving path. Returns raw arrays so
// every strand can be concatenated into a single buffer.
function buildStrand(out, opts) {
  const {
    azimuth, rootY, rootR, length, spread, width, waves, amp, phase,
    bow = true, skullR,
  } = opts;
  // How much of the global sway this strand takes, scaled by its own length.
  // Without it the shader swings every tip by the same absolute distance, so
  // short bangs whip about a quarter of their own length while the long back
  // strands barely move.
  const sway = Math.min(1, length / 0.55);
  const segs = 10;
  const sinA = Math.sin(azimuth);
  const cosA = Math.cos(azimuth);
  // Ribbon width runs tangentially around the head, so the card presents its
  // face outward rather than its edge.
  const tanX = cosA;
  const tanZ = -sinA;
  const base = out.position.length / 3;

  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    // Long strands bow outward and come back in: a monotonic flare gives an
    // A-line that hugs the skull at the top, whereas the bow puts fullness up
    // near the head where hair actually has volume and lets the ends fall in.
    //
    // Short strands can't use it. The bow's radius drops back to 0.54 of its
    // peak by the tip, which for the bangs lands at ~0.109 — inside a head
    // that's 0.117 wide. The tip buries itself in her face and the only part
    // you see is where the strand exits her cheek, so each one looked like it
    // sprouted out of her jaw. They grow outward the whole way instead.
    const profileR = bow
      ? rootR + spread * Math.sin(t * Math.PI * 0.82)
      : rootR + spread * t ** 0.85;
    // Hard floor at the skull. Whatever the profile wants, a strand can never
    // be closer to the axis than the head is wide at that height.
    //
    // This is what actually fixed hair sprouting out of her cheeks, and no
    // amount of parameter tuning would have: a strand rooted near the crown
    // starts close to the axis, and as it falls the head widens faster than
    // the strand's radius grows, so it ends up *inside* the skull and the
    // only visible part is where it punches back out through her face. It's
    // invisible in the numbers unless you go looking, and it comes back the
    // moment anyone touches a length or spread. Cheaper to make it
    // impossible than to keep rediscovering it.
    const cy = rootY - length * t;
    const r = Math.max(profileR, skullR(cy) + 0.014);
    const wave = Math.sin(t * Math.PI * waves + phase) * amp * t;
    const cx = r * sinA + tanX * wave;
    const cz = r * cosA + tanZ * wave;
    // Tapers hard toward the tip — anime hair comes to points, and a card
    // that keeps its width to the end reads as a ribbon.
    const halfW = (width * (1 - 0.78 * t ** 1.4)) / 2;

    out.position.push(cx + tanX * halfW, cy, cz + tanZ * halfW);
    out.position.push(cx - tanX * halfW, cy, cz - tanZ * halfW);
    for (let k = 0; k < 2; k++) {
      out.normal.push(sinA, 0.25, cosA);
      out.phase.push(phase);
      out.sway.push(sway);
    }
    out.uv.push(0, t, 1, t);
  }

  for (let i = 0; i < segs; i++) {
    const a = base + i * 2;
    out.index.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
  }
}

// Places the strands over the scalp and merges them into one geometry.
// `skull` describes the head the hair has to stay outside of: { y, halfH, r }
// for an ellipsoid centred on the vertical axis. Every strand's radius is
// floored against it — see buildStrand.
function buildHairGeometry(center, rand, skull) {
  const skullR = (y) => {
    const dy = (y - skull.y) / skull.halfH;
    if (Math.abs(dy) >= 1) return 0;
    return skull.r * Math.sqrt(1 - dy * dy);
  };

  const out = { position: [], normal: [], uv: [], phase: [], sway: [], index: [] };
  // Enough overlap that the cards read as one mass with a broken edge. At
  // 170 you could see between them and it looked like loose threads.
  const COUNT = 460;

  for (let i = 0; i < COUNT; i++) {
    // Azimuth measured from straight ahead. The face wedge is left empty —
    // the fringe covers the forehead and the front strands start beside it.
    const backness = rand();
    // No strand roots forward of the temples. This is the single number that
    // decides whether the hair frames her face or hangs over it: a root at
    // 0.55 rad sits at z 0.11, which is her face surface, so those strands
    // fell straight down the front of it. At 0.95 the root is at x 0.105,
    // z 0.076 — out at the temple, so the hair falls *beside* the face and
    // past the ear. Everything inboard of this is the fringe's job, which is
    // why the bare-temple problem this was opened up to fix stays fixed.
    const azimuth = (rand() < 0.5 ? 1 : -1) * (0.95 + backness * (Math.PI - 0.95));
    const phi = 0.4 + rand() * 0.95;
    const R = 0.13;
    const rootR = Math.sin(phi) * R;
    const rootY = center.y + Math.cos(phi) * R * 1.12;
    // How far round the back this strand sits, 0 at the face, 1 dead behind.
    const behind = (1 - Math.cos(azimuth)) / 2;

    buildStrand(out, {
      azimuth,
      rootY,
      rootR,
      length: 0.32 + behind * 0.36 + rand() * 0.11,
      // Pulled back in from 0.055/0.105 — that read as a blow-dried bouffant.
      // The bow shape stays (it puts what fullness there is up near the head
      // rather than at the ends) but at a fraction of the magnitude, because
      // the cut it's after hangs close and straight.
      spread: 0.026 + behind * 0.055 + rand() * 0.028,
      width: 0.044 + rand() * 0.036,
      waves: 1.2 + rand() * 1.4,
      amp: 0.011 + rand() * 0.02,
      phase: rand() * Math.PI * 2,
      skullR,
    });
  }

  // Bangs, as strands rather than the solid shell they used to be. A shell
  // reads as plastic next to 460 individual filaments, and worse, it gave the
  // side strands nothing to emerge from — their roots sat exposed on bare
  // scalp and they looked like they started in mid-air. Rooting the fringe in
  // the same field makes it one continuous head of hair.
  //
  // Rooted high and forward, short enough to stop at the brows, and given
  // most of their radial growth up front so they drape over the forehead
  // rather than dropping behind it.
  const FRINGE_COUNT = 150;
  for (let i = 0; i < FRINGE_COUNT; i++) {
    const azimuth = (rand() * 2 - 1) * 0.98;
    const phi = 0.26 + rand() * 0.32;
    const R = 0.127;
    buildStrand(out, {
      azimuth,
      rootY: center.y + Math.cos(phi) * R * 1.12,
      rootR: Math.sin(phi) * R,
      // Short enough to sit above the eyes rather than across them.
      length: 0.088 + rand() * 0.038,
      spread: 0.082 + rand() * 0.03,
      bow: false,
      width: 0.03 + rand() * 0.024,
      // Barely any wave — bangs this short read as frizz if they wander.
      waves: 0.7 + rand() * 0.7,
      amp: 0.005 + rand() * 0.009,
      phase: rand() * Math.PI * 2,
      skullR,
    });
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(out.position, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(out.normal, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(out.uv, 2));
  geo.setAttribute('aPhase', new THREE.Float32BufferAttribute(out.phase, 1));
  geo.setAttribute('aSway', new THREE.Float32BufferAttribute(out.sway, 1));
  geo.setIndex(out.index);
  // Translate onto the head after building, so the maths above can treat the
  // head as sitting on the origin's vertical axis.
  geo.translate(center.x, 0, center.z);
  return geo;
}

function makeHairStrandMaterial(texture) {
  const material = new THREE.MeshToonMaterial({
    map: texture,
    gradientMap: TOON_GRADIENT,
    // The texture carries the root-to-tip warmth; the tint keeps the mass
    // from reading silver, which it did at a lighter value.
    color: COLORS.hairTint,
    // alphaTest rather than transparent: 360 overlapping cards have no
    // correct draw order, and sorting artefacts crawling over her head would
    // be far worse than slightly hard filament edges.
    alphaTest: 0.32,
    side: THREE.DoubleSide,
  });

  // The flow. Roots are pinned and the sway grows with the square of the
  // length fraction, so the scalp stays put and the ends drift — done in the
  // shader so the vertices never leave the GPU.
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uHairTime = hairTime;
    // Declarations go in via the <common> chunk rather than being prepended
    // to the source string. Both approaches appear to work; this is the
    // idiomatic hook and keeps the uniform and attributes next to the code
    // that uses them.
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
         uniform float uHairTime;
         attribute float aPhase;
         attribute float aSway;`
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
         float hairSway = uv.y * uv.y * aSway;
         transformed.x += sin(uHairTime * 1.05 + aPhase) * 0.030 * hairSway;
         transformed.z += cos(uHairTime * 0.83 + aPhase * 1.4) * 0.024 * hairSway;
         transformed.y += sin(uHairTime * 1.45 + aPhase * 0.7) * 0.008 * hairSway;`
      );
  };
  return material;
}

// ── props ───────────────────────────────────────────────────────────────

// A simple handle + blade, held in the right hand once the poop backlog gets
// big enough that picking up by hand stops looking sane. Hidden by default;
// main.js toggles it on based on poop count.
export function buildShovel() {
  const shovel = new THREE.Group();
  const handle = mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.42, 8), toonMat(0x8a5a2f));
  handle.position.y = -0.21;
  shovel.add(handle);
  const blade = mesh(new THREE.BoxGeometry(0.09, 0.13, 0.015), toonMat(0xb9bcbf));
  blade.position.y = -0.42;
  shovel.add(blade);
  return shovel;
}

// ── the character ───────────────────────────────────────────────────────

export function createMom() {
  const group = new THREE.Group();

  const skinMat = skinToonMat(COLORS.skin);
  const skinShadeMat = skinToonMat(COLORS.skinShade);
  const hairSolidMat = toonMat(0x2a1714);
  const outfitMat = toonMat(COLORS.outfit);
  const corsetMat = toonMat(COLORS.corset);
  const laceMat = toonMat(COLORS.lace);
  const tightsMat = toonMat(COLORS.tights);
  const bootMat = toonMat(COLORS.boots);
  const metalMat = new THREE.MeshStandardMaterial({
    color: COLORS.metal,
    roughness: 0.25,
    metalness: 0.85,
  });
  const lipMat = toonMat(COLORS.lips);
  const linerMat = new THREE.MeshBasicMaterial({ color: COLORS.liner });
  const scleraMat = new THREE.MeshBasicMaterial({ color: 0xfdfbff });
  const irisMat = toonMat(COLORS.eye);
  const irisDeepMat = new THREE.MeshBasicMaterial({ color: COLORS.eyeDeep });
  const glintMat = new THREE.MeshBasicMaterial({ color: 0xffffff });

  // ── legs and boots ────────────────────────────────────────────────────
  // Each leg is a pivot group hinged at the hip so the walk cycle can swing
  // the whole thing. Thighs are fuller than the calves, which is both truer
  // and reads better under a short skirt than a uniform tube.
  const legPivots = {};
  [-1, 1].forEach((side) => {
    const legPivot = new THREE.Group();
    legPivot.position.set(side * 0.088, 0.63, 0);
    group.add(legPivot);

    const thighProfile = [
      [0.072, 0.0],
      [0.075, -0.06],
      [0.066, -0.16],
      [0.055, -0.26],
      [0.049, -0.34],
    ].map(([r, y]) => new THREE.Vector2(r, -y));
    const thigh = mesh(new THREE.LatheGeometry(thighProfile, 20), tightsMat);
    thigh.rotation.x = Math.PI;
    legPivot.add(outline(thigh, 0.006));

    const calf = mesh(new THREE.CapsuleGeometry(0.05, 0.14, 6, 18), tightsMat);
    calf.position.set(0, -0.41, 0);
    legPivot.add(calf);

    // Knee-high lace-up platform boots.
    const shaft = mesh(new THREE.CylinderGeometry(0.062, 0.072, 0.28, 18), bootMat);
    shaft.position.set(0, -0.46, 0.005);
    legPivot.add(outline(shaft, 0.006));

    for (let i = 0; i < 5; i++) {
      const rung = mesh(new THREE.BoxGeometry(0.07, 0.005, 0.005), laceMat);
      rung.position.set(0, -0.36 - i * 0.048, 0.063);
      legPivot.add(rung);
    }

    const chain = mesh(new THREE.TorusGeometry(0.07, 0.007, 8, 18), metalMat);
    chain.rotation.x = Math.PI / 2;
    chain.position.set(0, -0.578, 0.005);
    legPivot.add(chain);

    const sole = mesh(new THREE.BoxGeometry(0.11, 0.042, 0.19), bootMat);
    sole.position.set(0, -0.632, 0.026);
    legPivot.add(outline(sole, 0.005));
    const foot = mesh(new THREE.SphereGeometry(0.058, 16, 12), bootMat);
    foot.scale.set(1.15, 0.85, 1.5);
    foot.position.set(0, -0.6, 0.028);
    legPivot.add(foot);

    legPivots[side] = legPivot;
  });

  // ── body ──────────────────────────────────────────────────────────────
  // One swept profile from hip to shoulder, rather than a waist cylinder and
  // a torso cylinder stacked on each other. A lathe gives a continuous
  // surface with an actual hourglass through it: full hip, cinched waist,
  // full bust, tapering to the shoulders. This is the single change that
  // stops her reading as a pile of tubes.
  // The waist is the important number — an hourglass is made by how far the
  // middle comes *in*, not by how far the ends go out, so this cinches harder
  // rather than just inflating the hip and bust.
  const bodiceProfile = [
    [0.198, 0.00],
    [0.206, 0.045],
    [0.180, 0.120],
    [0.116, 0.198],
    [0.114, 0.238],
    [0.176, 0.300],
    [0.196, 0.348],
    [0.172, 0.406],
    // Stops here rather than carrying on up to the collarbone — this is the
    // top edge of the dress, and skin reads above it.
    [0.150, 0.442],
  ].map(([r, y]) => new THREE.Vector2(r, y));
  // 0.44, not 0.7. At 0.7 the belly still stood 24 mm forward of the waist,
  // which in profile is a tummy. The hips have to squash roughly twice as
  // hard as the bust to bring the front into a straight line, because the
  // profile radius is so much bigger down there.
  //
  // It flattens her seat by the same amount, since the squash is symmetric —
  // but the skirt flares to 0.27 over the top of it, so nothing below the
  // waist is visible from the side anyway.
  const bodice = mesh(
    flattenZ(new THREE.LatheGeometry(bodiceProfile, 40), 0.86, 0.9, 1.16, 0.44),
    outfitMat
  );
  bodice.position.y = 0.86;
  group.add(outline(bodice, 0.007));

  // Corset panel over the waist, following the same taper.
  const corsetProfile = [
    [0.184, 0.0],
    [0.124, 0.075],
    [0.118, 0.118],
    [0.172, 0.19],
  ].map(([r, y]) => new THREE.Vector2(r * 1.012, y));
  // Same squash as the bodice, or it stands proud of it at the front.
  const corset = mesh(
    flattenZ(new THREE.LatheGeometry(corsetProfile, 40), 0.965, 0.9, 1.16, 0.44),
    corsetMat
  );
  corset.position.y = 0.965;
  group.add(corset);

  // Criss-cross front lacing.
  for (let i = 0; i < 5; i++) {
    const y = 1.0 + i * 0.036;
    [-1, 1].forEach((side) => {
      const eyelet = mesh(new THREE.TorusGeometry(0.0075, 0.0028, 6, 10), metalMat);
      eyelet.position.set(side * 0.028, y, 0.142);
      group.add(eyelet);
    });
    if (i < 4) {
      [-1, 1].forEach((side) => {
        const cross = mesh(new THREE.CapsuleGeometry(0.0032, 0.05, 4, 6), laceMat);
        cross.position.set(0, y + 0.018, 0.143);
        cross.rotation.z = side * 0.95;
        group.add(cross);
      });
    }
  }

  // ── skirt ─────────────────────────────────────────────────────────────
  // Flares straight off the hip where the bodice ends, so the two read as one
  // dress rather than a top and a separate skirt.
  const skirtProfile = [
    [0.198, 0.0],
    [0.236, -0.085],
    [0.272, -0.165],
    [0.290, -0.222],
    [0.270, -0.246],
  ].map(([r, y]) => new THREE.Vector2(r, y));
  // LatheGeometry is an open shell, so with a single-sided material you see
  // straight through into the hollow interior from below.
  const skirtMat = outfitMat.clone();
  skirtMat.side = THREE.DoubleSide;
  // Flat where it meets the hip, matching the bodice exactly, then easing
  // back to circular by the hem. Left fully round it stood proud of the
  // flattened bodice at the front and the waistline stepped — the skirt
  // looked like it belonged to a different, wider body.
  const skirt = mesh(
    flattenZ(new THREE.LatheGeometry(skirtProfile, 44), 0.865, 0.865, 0.64, 0.44),
    skirtMat
  );
  skirt.position.y = 0.865;
  group.add(skirt);

  const skirtHem = mesh(new THREE.TorusGeometry(0.28, 0.014, 10, 44), outfitMat);
  skirtHem.rotation.x = Math.PI / 2;
  skirtHem.position.y = 0.622;
  group.add(outline(skirtHem, 0.005));

  // ── neckline and shoulders ────────────────────────────────────────────
  // Skin above the dress line. The bodice now stops at 1.302, so this fills
  // from there up to the neck and the neckline reads as scooped rather than
  // the fabric running straight to her collarbone.
  const chest = mesh(
    new THREE.SphereGeometry(0.15, 28, 18, 0, Math.PI * 2, 0, Math.PI * 0.5),
    skinMat
  );
  chest.scale.set(1, 0.46, 0.82);
  chest.position.y = 1.294;
  group.add(chest);

  // A short centre crease at the neckline. Toon shading turns any tight
  // crease into a drawn line, which is exactly what's wanted here — the
  // style renders this as a stroke rather than a soft gradient, so a thin
  // shaded capsule does the whole job.
  const cleft = mesh(new THREE.CapsuleGeometry(0.0075, 0.026, 4, 8), skinShadeMat);
  cleft.position.set(0, 1.316, 0.106);
  cleft.rotation.x = 0.22;
  group.add(cleft);

  [-1, 1].forEach((side) => {
    const shoulder = mesh(new THREE.SphereGeometry(0.05, 16, 12), skinMat);
    shoulder.scale.set(1, 0.82, 1);
    shoulder.position.set(side * 0.118, 1.322, 0.006);
    group.add(outline(shoulder, 0.006));
    // Straps run from the shoulder down to the lowered dress line.
    const strap = mesh(new THREE.CapsuleGeometry(0.011, 0.085, 4, 8), outfitMat);
    strap.position.set(side * 0.098, 1.318, 0.014);
    strap.rotation.z = side * 0.42;
    group.add(strap);
  });

  // ── arms ──────────────────────────────────────────────────────────────
  const armPivots = {};
  [-1, 1].forEach((side) => {
    const armPivot = new THREE.Group();
    armPivot.position.set(side * 0.15, 1.3, 0.008);
    group.add(armPivot);

    // Tapered, so it narrows toward the wrist instead of being a dowel.
    const armProfile = [
      [0.038, 0.0],
      [0.036, -0.09],
      [0.030, -0.19],
      [0.026, -0.28],
      [0.024, -0.33],
    ].map(([r, y]) => new THREE.Vector2(r, -y));
    const arm = mesh(new THREE.LatheGeometry(armProfile, 18), skinMat);
    arm.rotation.x = Math.PI;
    arm.rotation.z = side * 0.14;
    armPivot.add(outline(arm, 0.005));

    const hand = mesh(new THREE.SphereGeometry(0.03, 12, 10), skinMat);
    hand.scale.set(1, 1.25, 0.75);
    hand.position.set(side * 0.048, -0.365, 0.012);
    armPivot.add(hand);

    // Studded wrist cuff.
    const cuff = mesh(new THREE.CylinderGeometry(0.032, 0.03, 0.05, 12), bootMat);
    cuff.position.set(side * 0.042, -0.32, 0.01);
    armPivot.add(cuff);
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2;
      const stud = mesh(new THREE.SphereGeometry(0.005, 6, 5), metalMat);
      stud.position.set(
        side * 0.042 + Math.cos(a) * 0.032,
        -0.32,
        0.01 + Math.sin(a) * 0.032
      );
      armPivot.add(stud);
    }

    armPivots[side] = armPivot;

    if (side === 1) {
      const shovel = buildShovel();
      shovel.position.copy(hand.position);
      shovel.visible = false;
      armPivot.add(shovel);
      group.userData.shovel = shovel;
    }
  });

  // ── neck and choker ───────────────────────────────────────────────────
  const neck = mesh(new THREE.CylinderGeometry(0.042, 0.048, 0.06, 20), skinMat);
  neck.position.y = 1.372;
  group.add(neck);
  const choker = mesh(new THREE.TorusGeometry(0.047, 0.0085, 12, 24), corsetMat);
  choker.rotation.x = Math.PI / 2;
  choker.position.y = 1.378;
  group.add(choker);
  // Hangs clear of the chest. At z 0.047 it was inside the neckline form once
  // that got fuller, and only the top of it poked through as a stray blob.
  const pendant = mesh(new THREE.SphereGeometry(0.015, 10, 10), metalMat);
  pendant.scale.set(1, 1.5, 0.55);
  pendant.position.set(0, 1.346, 0.098);
  group.add(pendant);

  // ── head ──────────────────────────────────────────────────────────────
  // Built inside its own group in local coordinates, so head size is one
  // number instead of thirty absolute y values. The previous version had
  // every eyelash and lip lobe placed in world space, which made changing the
  // head size a rewrite.
  const HEAD_Y = 1.55;
  const headGroup = new THREE.Group();
  headGroup.position.set(0, HEAD_Y, 0);
  group.add(headGroup);

  // Larger than realistic proportion on purpose — this is what puts her in
  // anime territory rather than eight-heads-tall realism.
  // Narrower and longer than a cute-anime head. The look we're after is the
  // poised, mature end of the style rather than the goofy end — that comes
  // from an oval face rather than a round one.
  //
  // One sphere, not two. There used to be a second smaller sphere overlapped
  // at the chin to taper the jaw, and under smooth shading that would have
  // been fine — but toon shading quantises light into hard bands, so the
  // crease where two surfaces intersect stops being a soft gradient and
  // becomes a drawn line. It rendered as stubble along her jaw. Anything
  // that needs to read as one form here has to *be* one surface; the taper
  // comes from the scale instead.
  const head = mesh(
    taperChin(new THREE.SphereGeometry(0.126, 32, 24), -0.076, -0.126, 0.42),
    skinMat
  );
  head.scale.set(0.905, 1.19, 0.92);
  headGroup.add(outline(head, 0.007));

  // Graphic eyes, but restrained. Each is a stack of flattened discs pressed
  // onto the face: sclera, iris, a deeper pool at the top of the iris, pupil,
  // and two highlights.
  //
  // Sized down from the first anime pass. Very large eyes push toward the
  // cute/goofy end of the style; the mature, poised end keeps them long and
  // narrow, leans on heavy lashes and a strong lid line for drama, and lets
  // the mouth and jaw do more of the work.
  const EYE_X = 0.051;
  const EYE_Y = 0.006;
  [-1, 1].forEach((side) => {
    const eye = new THREE.Group();
    eye.position.set(side * EYE_X, EYE_Y, 0.098);
    eye.rotation.y = side * -0.22;
    headGroup.add(eye);

    // Nudged up from the mature-pass sizing. A narrower jaw makes the eyes
    // read smaller by comparison, so they come back up slightly to keep the
    // face on the cute side of composed rather than tipping severe.
    const sclera = mesh(new THREE.SphereGeometry(0.0325, 20, 16), scleraMat);
    sclera.scale.set(1.1, 0.88, 0.24);
    eye.add(sclera);

    const iris = mesh(new THREE.SphereGeometry(0.0262, 20, 16), irisMat);
    iris.scale.set(1, 1.05, 0.22);
    iris.position.set(0, -0.001, 0.006);
    eye.add(iris);

    // Darker pool across the top of the iris — the vertical gradient is a
    // signature of the style and reads even at a distance.
    const irisDeep = mesh(new THREE.SphereGeometry(0.0238, 20, 16), irisDeepMat);
    irisDeep.scale.set(1, 0.5, 0.2);
    irisDeep.position.set(0, 0.011, 0.009);
    eye.add(irisDeep);

    const pupil = mesh(new THREE.SphereGeometry(0.0106, 16, 12), linerMat);
    pupil.scale.set(1, 1.15, 0.22);
    pupil.position.set(0, -0.001, 0.011);
    eye.add(pupil);

    const glint = mesh(new THREE.SphereGeometry(0.0075, 12, 10), glintMat);
    glint.scale.set(1, 1, 0.2);
    glint.position.set(-side * 0.008, 0.011, 0.014);
    eye.add(glint);
    const glintSmall = mesh(new THREE.SphereGeometry(0.0038, 10, 8), glintMat);
    glintSmall.scale.set(1, 1, 0.2);
    glintSmall.position.set(side * 0.009, -0.011, 0.014);
    eye.add(glintSmall);

    // Heavy upper lash line, and it does more of the work now the eye itself
    // is smaller — this is where the drama lives in the mature style.
    const lash = mesh(new THREE.TorusGeometry(0.0345, 0.0072, 8, 20, Math.PI * 0.8), linerMat);
    lash.rotation.z = 0.42;
    lash.position.set(0, 0.001, 0.014);
    eye.add(lash);

    const flick = mesh(new THREE.ConeGeometry(0.0065, 0.03, 8), linerMat);
    flick.position.set(side * 0.034, 0.015, 0.011);
    flick.rotation.z = side * -1.0;
    eye.add(flick);

    // Thin, high and arched. A heavy brow reads as stern or comic; a fine one
    // set well above the eye is what makes the face read as composed.
    const brow = mesh(new THREE.CapsuleGeometry(0.0028, 0.04, 4, 8), hairSolidMat);
    brow.rotation.z = Math.PI / 2 + side * -0.2;
    brow.position.set(side * EYE_X, 0.056, 0.099);
    headGroup.add(brow);

    // No blush. The pink cheek circles read as cute-anime, and she's the
    // composed end of the style — pale and unbroken suits her better.
  });

  // Nose stays tiny. The mouth, though, gets *more* presence than the cute
  // style would give it — a strong dark lip is a big part of why the mature
  // look reads as composed rather than childlike, and it's in every photo of
  // her anyway.
  const nose = mesh(new THREE.SphereGeometry(0.0075, 8, 6), skinMat);
  nose.scale.set(0.7, 0.8, 1);
  nose.position.set(0, -0.042, 0.12);
  headGroup.add(nose);

  const lowerLip = mesh(new THREE.SphereGeometry(0.018, 12, 10), lipMat);
  lowerLip.scale.set(1.3, 0.52, 0.42);
  lowerLip.position.set(0, -0.084, 0.11);
  headGroup.add(lowerLip);
  [-1, 1].forEach((side) => {
    const upper = mesh(new THREE.SphereGeometry(0.0105, 10, 8), lipMat);
    upper.scale.set(1.05, 0.5, 0.4);
    upper.position.set(side * 0.0085, -0.0725, 0.109);
    headGroup.add(upper);
  });

  // ── hair ──────────────────────────────────────────────────────────────
  // Scalp cap, set back off the face rather than centred on the head —
  // centred, its forward hemisphere wrapped to the cheekbones and the face
  // became a slot in a helmet.
  const hairCap = mesh(new THREE.SphereGeometry(0.132, 24, 18), hairSolidMat);
  hairCap.scale.set(1.06, 1.14, 0.94);
  hairCap.position.set(0, 1.566, -0.026);
  group.add(outline(hairCap, 0.008));

  // Bangs across the forehead. Flattened hard and pushed forward, this read
  // as the brim of a backwards baseball cap: a disc that thin presents its
  // bottom edge as a dead-straight horizontal line across her forehead, and
  // the outlined scalp cap behind it completed the illusion.
  //
  // Deeper in section, tucked back inside the cap's radius so nothing juts
  // out to catch a rim, and pitched forward so it slopes down toward the
  // brows instead of sitting level like a shelf.
  // It also has to sit *in front of* the face, not behind it. Tucked back at
  // z 0.014 its front face landed at 0.083 while her forehead is at 0.116, so
  // the bangs were hidden inside her head and she looked like she was
  // receding. Blunt and heavy, reaching down to graze the brows, which is
  // what the reference haircut actually is.
  // The strand field — including the bangs, which used to be a solid shell
  // here and are now part of the same continuous field. Seeded so she has the same hair every reload rather
  // than reshuffling each time the page loads.
  let seed = 0x9e3779b9;
  const hairRand = () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  // The skull the strands must stay outside of, matching the head mesh above
  // (sphere 0.126 scaled 0.93/1.19/0.92, centred at HEAD_Y). Taking the wider
  // of the x/z radii so the clearance holds all the way round.
  const strands = new THREE.Mesh(
    buildHairGeometry(new THREE.Vector3(0, 1.575, -0.012), hairRand, {
      y: HEAD_Y,
      halfH: 0.126 * 1.19,
      r: 0.126 * 0.93,
    }),
    makeHairStrandMaterial(makeHairTexture())
  );
  // Not casting: alpha-tested cards throw noisy, crawling shadows, and 360 of
  // them over her own shoulders looked like static rather than hair.
  strands.castShadow = false;
  strands.receiveShadow = true;
  group.add(strands);

  group.userData.head = head;
  group.userData.headGroup = headGroup;
  group.userData.hairBack = hairCap;
  group.userData.torso = bodice;
  group.userData.legs = { legL: legPivots[-1], legR: legPivots[1] };
  group.userData.arms = { armL: armPivots[-1], armR: armPivots[1] };

  return group;
}
