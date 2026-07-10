import * as THREE from 'three';

// Coloring sampled from reference photos: tan/fawn body, cream chest & blaze,
// white paw socks, near-black nose/eyes, pink inner ears.
const COLORS = {
  tan: 0xc4a074,
  tanDark: 0xa9855c,
  cream: 0xf1e8d9,
  nose: 0x1c1712,
  pink: 0xd99a8a,
};

function furMaterial(color, extra = {}) {
  return new THREE.MeshPhysicalMaterial({
    color,
    roughness: 0.75,
    sheen: 0.6,
    sheenRoughness: 0.55,
    sheenColor: new THREE.Color(0xffffff),
    ...extra,
  });
}

const tanMat = furMaterial(COLORS.tan);
const tanDarkMat = furMaterial(COLORS.tanDark);
const creamMat = furMaterial(COLORS.cream);
const noseMat = new THREE.MeshPhysicalMaterial({
  color: COLORS.nose,
  roughness: 0.3,
  clearcoat: 0.6,
  clearcoatRoughness: 0.3,
});
const eyeMat = new THREE.MeshPhysicalMaterial({
  color: COLORS.nose,
  roughness: 0.15,
  clearcoat: 1,
  clearcoatRoughness: 0.1,
});
const pinkMat = furMaterial(COLORS.pink, { sheen: 0.2, roughness: 0.6 });

function mesh(geometry, material) {
  const m = new THREE.Mesh(geometry, material);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

function buildLeg(front) {
  const leg = new THREE.Group();
  const length = 0.4;

  const upper = mesh(
    new THREE.CylinderGeometry(0.032, 0.026, length * 0.55, 10),
    tanDarkMat
  );
  upper.position.y = -length * 0.275;
  leg.add(upper);

  const lower = mesh(
    new THREE.CylinderGeometry(0.026, 0.02, length * 0.45, 10),
    tanDarkMat
  );
  lower.position.y = -length * 0.55 - length * 0.225;
  // slight bend for the back legs
  lower.rotation.x = front ? 0 : -0.12;
  leg.add(lower);

  const paw = mesh(new THREE.SphereGeometry(0.03, 10, 8), creamMat);
  paw.scale.set(1.1, 0.6, 1.3);
  paw.position.y = -length + 0.01;
  paw.position.z = 0.015;
  leg.add(paw);

  return leg;
}

function buildEar(folded) {
  const ear = new THREE.Group();

  const base = mesh(
    new THREE.ConeGeometry(0.045, folded ? 0.07 : 0.12, 10),
    tanMat
  );
  base.position.y = (folded ? 0.07 : 0.12) / 2;
  ear.add(base);

  const inner = mesh(
    new THREE.ConeGeometry(0.026, (folded ? 0.07 : 0.12) * 0.75, 10),
    pinkMat
  );
  inner.position.y = ((folded ? 0.07 : 0.12) * 0.75) / 2 + 0.005;
  inner.position.z = 0.012;
  ear.add(inner);

  if (folded) {
    const tip = mesh(new THREE.ConeGeometry(0.04, 0.07, 10), tanMat);
    tip.position.y = 0.07;
    tip.rotation.x = Math.PI * 0.55;
    tip.position.z = 0.03;
    ear.add(tip);
  }

  return ear;
}

export function createDarla() {
  const darla = new THREE.Group();

  // Torso (ribcage), tapering toward the hips via a smaller pelvis sphere
  const ribcage = mesh(new THREE.CapsuleGeometry(0.15, 0.3, 6, 12), tanMat);
  ribcage.rotation.x = Math.PI / 2;
  ribcage.position.set(0, 0.42, 0.05);
  darla.add(ribcage);

  const pelvis = mesh(new THREE.SphereGeometry(0.12, 14, 10), tanMat);
  pelvis.scale.set(0.9, 0.85, 0.75);
  pelvis.position.set(0, 0.4, -0.24);
  darla.add(pelvis);

  const chest = mesh(new THREE.SphereGeometry(0.1, 12, 10), creamMat);
  chest.scale.set(0.8, 1, 0.6);
  chest.position.set(0, 0.32, 0.24);
  darla.add(chest);

  // Neck — long and slender, angled up toward the head
  const neck = mesh(new THREE.CapsuleGeometry(0.05, 0.32, 6, 10), tanMat);
  neck.position.set(0, 0.6, 0.32);
  neck.rotation.x = Math.PI / 2.5;
  darla.add(neck);

  // Head
  const head = mesh(new THREE.SphereGeometry(0.13, 16, 14), tanMat);
  head.scale.set(1, 0.95, 1.05);
  head.position.set(0, 0.72, 0.6);
  darla.add(head);

  const muzzlePatch = mesh(new THREE.SphereGeometry(0.075, 12, 10), creamMat);
  muzzlePatch.scale.set(0.85, 0.6, 0.9);
  muzzlePatch.position.set(0, 0.67, 0.69);
  darla.add(muzzlePatch);

  const snout = mesh(
    new THREE.CylinderGeometry(0.033, 0.058, 0.14, 12),
    creamMat
  );
  snout.rotation.x = Math.PI / 2;
  snout.position.set(0, 0.69, 0.78);
  darla.add(snout);

  const noseTip = mesh(new THREE.SphereGeometry(0.022, 10, 8), noseMat);
  noseTip.position.set(0, 0.695, 0.85);
  darla.add(noseTip);

  // Eyes — pushed onto the front surface of the head sphere so they
  // aren't swallowed by it, sized up for that big-eyed chihuahua look
  const eyeGeo = new THREE.SphereGeometry(0.02, 12, 10);
  const eyeL = mesh(eyeGeo, eyeMat);
  eyeL.position.set(0.078, 0.746, 0.731);
  darla.add(eyeL);
  const eyeR = mesh(eyeGeo, eyeMat);
  eyeR.position.set(-0.078, 0.746, 0.731);
  darla.add(eyeR);

  const eyeHighlightGeo = new THREE.SphereGeometry(0.006, 8, 6);
  const highlightMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const highlightL = mesh(eyeHighlightGeo, highlightMat);
  highlightL.position.set(0.084, 0.752, 0.746);
  darla.add(highlightL);
  const highlightR = mesh(eyeHighlightGeo, highlightMat);
  highlightR.position.set(-0.072, 0.752, 0.746);
  darla.add(highlightR);

  // Ears: one erect, one folded — matching the reference photos
  const earErect = buildEar(false);
  earErect.position.set(-0.09, 0.8, 0.56);
  earErect.rotation.z = 0.18;
  earErect.rotation.x = -0.15;
  darla.add(earErect);

  const earFolded = buildEar(true);
  earFolded.position.set(0.09, 0.8, 0.56);
  earFolded.rotation.z = -0.25;
  earFolded.rotation.x = -0.1;
  darla.add(earFolded);

  // Legs
  const legFR = buildLeg(true);
  legFR.position.set(-0.09, 0.4, 0.22);
  darla.add(legFR);

  const legFL = buildLeg(true);
  legFL.position.set(0.09, 0.4, 0.22);
  darla.add(legFL);

  const legBR = buildLeg(false);
  legBR.position.set(-0.08, 0.4, -0.22);
  darla.add(legBR);

  const legBL = buildLeg(false);
  legBL.position.set(0.08, 0.4, -0.22);
  darla.add(legBL);

  // Tail — curls up and forward into a hook, drooping first then curling
  const tailCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(0, -0.04, -0.09),
    new THREE.Vector3(0, -0.02, -0.17),
    new THREE.Vector3(0, 0.05, -0.21),
    new THREE.Vector3(0, 0.12, -0.17),
    new THREE.Vector3(0, 0.15, -0.1),
    new THREE.Vector3(0, 0.13, -0.05),
  ]);
  const tail = mesh(
    new THREE.TubeGeometry(tailCurve, 32, 0.02, 8, false),
    tanMat
  );
  const tailGroup = new THREE.Group();
  tailGroup.position.set(0, 0.4, -0.32);
  tailGroup.add(tail);
  darla.add(tailGroup);

  darla.userData.legs = { legFR, legFL, legBR, legBL };
  darla.userData.tail = tailGroup;
  darla.userData.head = head;

  return darla;
}
