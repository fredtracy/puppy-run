import * as THREE from 'three';

// A stylized, cartoon-proportioned figure in the spirit of Darla's own
// low-poly build — not a likeness, just the same warm gothic-glam palette
// (dark hair, black off-shoulder corset dress, pale tights, choker) that
// makes her instantly read as "Darla's mom" standing in the yard.
const COLORS = {
  skin: 0xf0c9a8,
  hair: 0x1f1613,
  outfit: 0x161616,
  corset: 0x0d0d0d,
  tights: 0xe9e2df,
  shoes: 0x0a0a0a,
  lips: 0x6b1c2e,
  blush: 0xd99a8a,
  metal: 0x2a2a2a,
};

function mesh(geometry, material) {
  const m = new THREE.Mesh(geometry, material);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

export function createMom() {
  const group = new THREE.Group();

  const skinMat = new THREE.MeshPhysicalMaterial({
    color: COLORS.skin,
    roughness: 0.55,
    sheen: 0.3,
    sheenRoughness: 0.6,
    sheenColor: new THREE.Color(0xffffff),
  });
  const hairMat = new THREE.MeshStandardMaterial({ color: COLORS.hair, roughness: 0.35 });
  const outfitMat = new THREE.MeshStandardMaterial({ color: COLORS.outfit, roughness: 0.55 });
  const corsetMat = new THREE.MeshStandardMaterial({
    color: COLORS.corset,
    roughness: 0.4,
    metalness: 0.15,
  });
  const tightsMat = new THREE.MeshStandardMaterial({ color: COLORS.tights, roughness: 0.75 });
  const shoeMat = new THREE.MeshStandardMaterial({ color: COLORS.shoes, roughness: 0.35 });
  const metalMat = new THREE.MeshStandardMaterial({
    color: COLORS.metal,
    roughness: 0.3,
    metalness: 0.6,
  });
  const lipMat = new THREE.MeshStandardMaterial({ color: COLORS.lips, roughness: 0.4 });
  const eyeMat = new THREE.MeshPhysicalMaterial({
    color: 0x2f7fd1,
    roughness: 0.2,
    clearcoat: 0.8,
    clearcoatRoughness: 0.15,
  });
  const blushMat = new THREE.MeshStandardMaterial({
    color: COLORS.blush,
    roughness: 0.6,
    transparent: true,
    opacity: 0.5,
  });

  // Legs + shoes — each leg is a pivot group hinged at the hip (rather than
  // a plain mesh) so a walk cycle can swing the whole thing forward/back.
  // Capsules instead of flat-capped cylinders round off the joints so the
  // silhouette reads as a limb, not a stack of tubes.
  const legGeo = new THREE.CapsuleGeometry(0.05, 0.5, 6, 20);
  const legPivots = {};
  [-1, 1].forEach((side) => {
    const legPivot = new THREE.Group();
    legPivot.position.set(side * 0.09, 0.62, 0);
    group.add(legPivot);

    const leg = mesh(legGeo, tightsMat);
    leg.position.set(0, -0.31, 0);
    legPivot.add(leg);

    // A tall lace-up boot shaft wrapping the lower leg, plus the foot
    // itself, instead of a bare ankle and shoe.
    const bootShaft = mesh(new THREE.CylinderGeometry(0.062, 0.07, 0.26, 14), shoeMat);
    bootShaft.position.set(0, -0.47, 0.01);
    legPivot.add(bootShaft);

    const shoe = mesh(new THREE.SphereGeometry(0.065, 16, 12), shoeMat);
    shoe.scale.set(1.2, 0.7, 1.6);
    shoe.position.set(0, -0.6, 0.025);
    legPivot.add(shoe);

    legPivots[side] = legPivot;
  });

  // Ruffled skirt: a lathe-revolved bell profile (narrow at the waist,
  // flaring out, curling in slightly at the hem) reads as fabric far better
  // than a straight cone does.
  const skirtProfile = [
    [0.02, 0.3],
    [0.14, 0.26],
    [0.2, 0.18],
    [0.235, 0.08],
    [0.24, 0.0],
    [0.22, -0.02],
  ].map(([r, y]) => new THREE.Vector2(r, y));
  // LatheGeometry is an open shell (no cap where the profile doesn't close
  // back to the axis), so with the default single-sided material you can
  // see straight through it into the hollow interior from above or behind
  // — hence its own material with both faces rendered, instead of sharing
  // outfitMat with the (already-solid) torso/waist cylinders.
  const skirtMat = outfitMat.clone();
  skirtMat.side = THREE.DoubleSide;
  const skirt = mesh(new THREE.LatheGeometry(skirtProfile, 32), skirtMat);
  skirt.position.y = 0.58;
  group.add(skirt);
  const skirtHem = mesh(new THREE.TorusGeometry(0.22, 0.02, 12, 32), outfitMat);
  skirtHem.rotation.x = Math.PI / 2;
  skirtHem.position.y = 0.56;
  group.add(skirtHem);

  // Cinched corset waist, with a hint of front lacing. Top radius matches
  // the torso's bottom radius exactly so the two cylinders meet flush
  // instead of stepping.
  const waist = mesh(new THREE.CylinderGeometry(0.135, 0.16, 0.2, 32), corsetMat);
  waist.position.y = 0.88;
  group.add(waist);
  for (let i = -2; i <= 2; i++) {
    const lace = mesh(new THREE.SphereGeometry(0.012, 8, 8), metalMat);
    lace.position.set(0, 0.8 + i * 0.035, 0.125);
    group.add(lace);
  }

  // Bodice + bare off-shoulder chest/shoulders
  const torso = mesh(new THREE.CylinderGeometry(0.15, 0.135, 0.26, 32), outfitMat);
  torso.position.y = 1.11;
  group.add(torso);
  const chest = mesh(
    new THREE.SphereGeometry(0.145, 24, 16, 0, Math.PI * 2, 0, Math.PI * 0.55),
    skinMat
  );
  chest.position.y = 1.24;
  group.add(chest);

  // Arms — same pivot-group trick as the legs, hinged at the shoulder, so
  // they can swing opposite the legs during a walk cycle.
  const armGeo = new THREE.CapsuleGeometry(0.029, 0.32, 6, 16);
  const armPivots = {};
  [-1, 1].forEach((side) => {
    const armPivot = new THREE.Group();
    armPivot.position.set(side * 0.2, 1.23, 0.01);
    group.add(armPivot);

    const arm = mesh(armGeo, skinMat);
    arm.position.set(0, -0.22, 0);
    arm.rotation.z = side * 0.16;
    armPivot.add(arm);

    const hand = mesh(new THREE.SphereGeometry(0.03, 12, 10), skinMat);
    hand.position.set(side * 0.035, -0.43, 0.02);
    armPivot.add(hand);

    armPivots[side] = armPivot;
  });

  // Neck, choker, and a small pendant
  const neck = mesh(new THREE.CylinderGeometry(0.045, 0.05, 0.06, 20), skinMat);
  neck.position.y = 1.35;
  group.add(neck);
  const choker = mesh(new THREE.TorusGeometry(0.05, 0.011, 12, 24), corsetMat);
  choker.rotation.x = Math.PI / 2;
  choker.position.y = 1.365;
  group.add(choker);
  const pendant = mesh(new THREE.SphereGeometry(0.014, 8, 8), metalMat);
  pendant.scale.set(1, 1.6, 0.6);
  pendant.position.set(0, 1.32, 0.05);
  group.add(pendant);

  // Head + face
  const head = mesh(new THREE.SphereGeometry(0.11, 32, 24), skinMat);
  head.position.y = 1.47;
  group.add(head);

  // Eyes are sized way up (small dots were getting swallowed by the head
  // sphere at this scale) and pushed proud of the face surface rather than
  // sitting flush with it, same trick Darla's own eyes use, plus brows and
  // a winged eyeliner flick for the bold made-up look from the photo.
  const eyeWhiteMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.3 });
  [-1, 1].forEach((side) => {
    const iris = mesh(new THREE.SphereGeometry(0.022, 16, 12), eyeMat);
    iris.position.set(side * 0.05, 1.485, 0.108);
    group.add(iris);
    const highlight = mesh(new THREE.SphereGeometry(0.007, 8, 6), eyeWhiteMat);
    highlight.position.set(side * 0.05 - side * 0.008, 1.492, 0.126);
    group.add(highlight);

    // A slim capsule instead of a box gives the brow rounded ends rather
    // than sharp corners.
    const brow = mesh(new THREE.CapsuleGeometry(0.0045, 0.036, 4, 8), hairMat);
    brow.rotation.z = Math.PI / 2 + side * -0.2;
    brow.position.set(side * 0.05, 1.515, 0.1);
    group.add(brow);

    const wing = mesh(new THREE.ConeGeometry(0.012, 0.032, 10), hairMat);
    wing.position.set(side * 0.078, 1.487, 0.098);
    wing.rotation.z = side * 1.15;
    wing.rotation.y = Math.PI / 2;
    group.add(wing);

    const blush = mesh(new THREE.SphereGeometry(0.024, 12, 10), blushMat);
    blush.scale.set(1, 0.65, 0.3);
    blush.position.set(side * 0.075, 1.45, 0.09);
    group.add(blush);
  });
  const mouth = mesh(new THREE.SphereGeometry(0.024, 12, 10), lipMat);
  mouth.scale.set(1.4, 0.6, 0.55);
  mouth.position.set(0, 1.435, 0.112);
  group.add(mouth);

  // Hair: a head-hugging cap (sized to fully wrap the scalp/temples with
  // no bald gaps, but stopping at jaw level rather than ballooning down
  // over the neck — an earlier version sized it big enough to swallow the
  // neck and part of the chest, which read as a black void under her
  // chin), a separate drape that falls behind her back for length, a blunt
  // forehead fringe, and two face-framing locks past the shoulders. Long
  // dark hair is the single biggest identity cue from the reference
  // photos. The bangs piece is a flattened shell rather than a full dome
  // so its lower edge clears eyebrow height by a comfortable margin (an
  // even earlier version sized it as a dome reaching low enough to fully
  // enclose the brow/mouth coordinates, hiding those features entirely).
  const hairCap = mesh(new THREE.SphereGeometry(0.12, 24, 18), hairMat);
  hairCap.scale.set(1.1, 1.2, 0.9);
  hairCap.position.set(0, 1.47, -0.03);
  group.add(hairCap);
  // Positioned to sit well inside hairCap's lower-back volume (rather than
  // just touching tip-to-tip, which left a visible gap between the two
  // rounded ends) so the two pieces read as one continuous mass of hair.
  const hairFlow = mesh(new THREE.CapsuleGeometry(0.075, 0.4, 8, 12), hairMat);
  hairFlow.position.set(0, 1.18, -0.1);
  group.add(hairFlow);
  const bangs = mesh(new THREE.SphereGeometry(0.1, 16, 12), hairMat);
  bangs.scale.set(1, 0.24, 0.55);
  bangs.position.set(0, 1.56, 0.08);
  group.add(bangs);

  const lockGeo = new THREE.CapsuleGeometry(0.026, 0.34, 6, 12);
  [-1, 1].forEach((side) => {
    const lock = mesh(lockGeo, hairMat);
    lock.position.set(side * 0.1, 1.36, 0.05);
    lock.rotation.z = side * 0.06;
    group.add(lock);
  });

  group.userData.head = head;
  group.userData.hairBack = hairCap;
  group.userData.torso = torso;
  group.userData.legs = { legL: legPivots[-1], legR: legPivots[1] };
  group.userData.arms = { armL: armPivots[-1], armR: armPivots[1] };

  return group;
}
