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
  lips: 0x3a0f1a,
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
  const legGeo = new THREE.CylinderGeometry(0.055, 0.045, 0.62, 10);
  const legPivots = {};
  [-1, 1].forEach((side) => {
    const legPivot = new THREE.Group();
    legPivot.position.set(side * 0.09, 0.62, 0);
    group.add(legPivot);

    const leg = mesh(legGeo, tightsMat);
    leg.position.set(0, -0.31, 0);
    legPivot.add(leg);

    const shoe = mesh(new THREE.SphereGeometry(0.06, 10, 8), shoeMat);
    shoe.scale.set(1.2, 0.7, 1.6);
    shoe.position.set(0, -0.575, 0.025);
    legPivot.add(shoe);

    legPivots[side] = legPivot;
  });

  // Ruffled skirt, flared out from the waist
  const skirt = mesh(new THREE.ConeGeometry(0.27, 0.3, 16, 1, true), outfitMat);
  skirt.position.y = 0.73;
  group.add(skirt);
  const skirtHem = mesh(new THREE.TorusGeometry(0.27, 0.025, 8, 20), outfitMat);
  skirtHem.rotation.x = Math.PI / 2;
  skirtHem.position.y = 0.59;
  group.add(skirtHem);

  // Cinched corset waist, with a hint of front lacing
  const waist = mesh(new THREE.CylinderGeometry(0.125, 0.16, 0.2, 16), corsetMat);
  waist.position.y = 0.88;
  group.add(waist);
  for (let i = -2; i <= 2; i++) {
    const lace = mesh(new THREE.SphereGeometry(0.012, 6, 6), metalMat);
    lace.position.set(0, 0.8 + i * 0.035, 0.125);
    group.add(lace);
  }

  // Bodice + bare off-shoulder chest/shoulders
  const torso = mesh(new THREE.CylinderGeometry(0.15, 0.135, 0.26, 16), outfitMat);
  torso.position.y = 1.11;
  group.add(torso);
  const chest = mesh(
    new THREE.SphereGeometry(0.145, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.55),
    skinMat
  );
  chest.position.y = 1.24;
  group.add(chest);

  // Arms — same pivot-group trick as the legs, hinged at the shoulder, so
  // they can swing opposite the legs during a walk cycle.
  const armGeo = new THREE.CylinderGeometry(0.032, 0.026, 0.44, 8);
  const armPivots = {};
  [-1, 1].forEach((side) => {
    const armPivot = new THREE.Group();
    armPivot.position.set(side * 0.2, 1.23, 0.01);
    group.add(armPivot);

    const arm = mesh(armGeo, skinMat);
    arm.position.set(0, -0.22, 0);
    arm.rotation.z = side * 0.16;
    armPivot.add(arm);

    const hand = mesh(new THREE.SphereGeometry(0.03, 8, 8), skinMat);
    hand.position.set(side * 0.035, -0.43, 0.02);
    armPivot.add(hand);

    armPivots[side] = armPivot;
  });

  // Neck, choker, and a small pendant
  const neck = mesh(new THREE.CylinderGeometry(0.045, 0.05, 0.06, 10), skinMat);
  neck.position.y = 1.35;
  group.add(neck);
  const choker = mesh(new THREE.TorusGeometry(0.05, 0.011, 8, 16), corsetMat);
  choker.rotation.x = Math.PI / 2;
  choker.position.y = 1.365;
  group.add(choker);
  const pendant = mesh(new THREE.SphereGeometry(0.014, 8, 8), metalMat);
  pendant.scale.set(1, 1.6, 0.6);
  pendant.position.set(0, 1.32, 0.05);
  group.add(pendant);

  // Head + face
  const head = mesh(new THREE.SphereGeometry(0.11, 20, 16), skinMat);
  head.position.y = 1.47;
  group.add(head);

  // Eyes are sized way up (small dots were getting swallowed by the head
  // sphere at this scale) and pushed proud of the face surface rather than
  // sitting flush with it, same trick Darla's own eyes use, plus brows and
  // a winged eyeliner flick for the bold made-up look from the photo.
  const eyeWhiteMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.3 });
  [-1, 1].forEach((side) => {
    const iris = mesh(new THREE.SphereGeometry(0.022, 12, 10), eyeMat);
    iris.position.set(side * 0.05, 1.485, 0.108);
    group.add(iris);
    const highlight = mesh(new THREE.SphereGeometry(0.007, 8, 6), eyeWhiteMat);
    highlight.position.set(side * 0.05 - side * 0.008, 1.492, 0.126);
    group.add(highlight);

    const brow = mesh(new THREE.BoxGeometry(0.05, 0.009, 0.01), hairMat);
    brow.position.set(side * 0.05, 1.515, 0.1);
    brow.rotation.z = side * -0.2;
    group.add(brow);

    const wing = mesh(new THREE.ConeGeometry(0.012, 0.032, 3), hairMat);
    wing.position.set(side * 0.078, 1.487, 0.098);
    wing.rotation.z = side * 1.15;
    wing.rotation.y = Math.PI / 2;
    group.add(wing);

    const blush = mesh(new THREE.SphereGeometry(0.024, 8, 8), blushMat);
    blush.scale.set(1, 0.65, 0.3);
    blush.position.set(side * 0.075, 1.45, 0.09);
    group.add(blush);
  });
  const mouth = mesh(new THREE.SphereGeometry(0.024, 8, 8), lipMat);
  mouth.scale.set(1.4, 0.6, 0.55);
  mouth.position.set(0, 1.435, 0.112);
  group.add(mouth);

  // Hair: a rounded volume behind/around the head, bangs framing the face,
  // and a small bow like the reference photo
  const hairBack = mesh(new THREE.SphereGeometry(0.125, 16, 12), hairMat);
  hairBack.scale.set(1.05, 1.3, 0.85);
  hairBack.position.set(0, 1.47, -0.05);
  group.add(hairBack);
  const bangs = mesh(
    new THREE.SphereGeometry(0.118, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.5),
    hairMat
  );
  bangs.position.set(0, 1.49, 0);
  group.add(bangs);

  const bow = new THREE.Group();
  [-1, 1].forEach((side) => {
    const loop = mesh(new THREE.ConeGeometry(0.035, 0.05, 8), hairMat);
    loop.rotation.z = side * (Math.PI / 2 - 0.3);
    loop.position.set(side * 0.03, 0, 0);
    bow.add(loop);
  });
  const bowKnot = mesh(new THREE.SphereGeometry(0.016, 8, 8), hairMat);
  bow.add(bowKnot);
  bow.position.set(0.07, 1.58, -0.02);
  bow.rotation.x = 0.3;
  group.add(bow);

  group.userData.head = head;
  group.userData.hairBack = hairBack;
  group.userData.torso = torso;
  group.userData.legs = { legL: legPivots[-1], legR: legPivots[1] };
  group.userData.arms = { armL: armPivots[-1], armR: armPivots[1] };

  return group;
}
