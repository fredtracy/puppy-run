// Miranda's drawn portrait, used both for her character-select card and for the
// day/night transition.
//
// Drawn rather than a render of her model, deliberately. It's a 128px card that
// also has to work at 32px on the multiplayer button, and at that size flat
// graphic shapes beat a shrunk photograph of geometry. The trade is that this
// has to be kept in step with mom.js by hand — the palette below is lifted
// straight from its COLORS so at least the colours can't drift.
//
// `night` and `wing` are continuous 0..1 rather than booleans so the transition
// can animate straight through them: `night` brings in the violet ground, the
// hair rim light and the sparkles, and `wing` extends the eyeliner flick.
// `wing` may go slightly above 1 — the transition overshoots it and settles
// back, which is what makes the eyeliner read as being flicked on rather than
// sliding out.

const SKIN = '#ffe4d4';
const SKIN_SHADE = '#f6d0bd';
// Darker than mom.js's raw hairTint (#8a4a38) on purpose: a mid-brown against
// #ffe4d4 skin has so little contrast that the whole portrait turns to mush at
// icon size. This is the one place the drawing knowingly departs from the model.
const HAIR = '#6e3a2c';
const HAIR_DARK = '#47231b';
const HAIR_LIGHT = '#a85c46';
const LIPS = '#5e1c34';
const EYE = '#5ea3d8';
const EYE_DEEP = '#2f6aa6';
const LINER = '#1a1016';
const OUTFIT = '#1b1a22';
const METAL = '#b8b8c2';
const INK = '#2a1720';

// Fixed rather than random, so her card doesn't reshuffle every reload.
const SPARKLES = [
  [-0.68, -0.46, 0.14, 0.95],
  [0.64, 0.2, 0.1, 0.8],
  [0.46, -0.66, 0.065, 0.75],
];

const DAY_INNER = [255, 244, 232];
const DAY_OUTER = [255, 224, 205];
const NIGHT_INNER = [122, 82, 163];
const NIGHT_OUTER = [43, 26, 64];

function mixHex(a, b, t) {
  const r = Math.round(a[0] + (b[0] - a[0]) * t);
  const g = Math.round(a[1] + (b[1] - a[1]) * t);
  const bl = Math.round(a[2] + (b[2] - a[2]) * t);
  return `rgb(${r}, ${g}, ${bl})`;
}

function facePath(c) {
  const p = new Path2D();
  p.moveTo(-0.54 * c, -0.12 * c);
  p.quadraticCurveTo(-0.56 * c, 0.3 * c, -0.3 * c, 0.6 * c);
  p.quadraticCurveTo(0, 0.82 * c, 0.3 * c, 0.6 * c);
  p.quadraticCurveTo(0.56 * c, 0.3 * c, 0.54 * c, -0.12 * c);
  p.quadraticCurveTo(0.52 * c, -0.66 * c, 0, -0.7 * c);
  p.quadraticCurveTo(-0.52 * c, -0.66 * c, -0.54 * c, -0.12 * c);
  p.closePath();
  return p;
}

function hairBackPath(c) {
  const p = new Path2D();
  p.ellipse(0, 0.16 * c, 0.84 * c, 1.06 * c, 0, 0, Math.PI * 2);
  return p;
}

// Blunt fringe, sitting high enough to leave a forehead and room for the eyes.
// Brought down to the brows it turns her face into a slot in a helmet of hair.
function bangsPath(c) {
  const p = new Path2D();
  p.moveTo(-0.58 * c, -0.3 * c);
  p.quadraticCurveTo(-0.62 * c, -0.78 * c, 0, -0.8 * c);
  p.quadraticCurveTo(0.62 * c, -0.78 * c, 0.58 * c, -0.3 * c);
  p.lineTo(0.4 * c, -0.22 * c);
  p.quadraticCurveTo(0.2 * c, -0.34 * c, 0.04 * c, -0.21 * c);
  p.quadraticCurveTo(-0.16 * c, -0.34 * c, -0.36 * c, -0.24 * c);
  p.closePath();
  return p;
}

function star(ctx, x, y, r, colour, alpha) {
  if (alpha <= 0.01) return;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = colour;
  ctx.translate(x, y);
  ctx.beginPath();
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 - Math.PI / 2;
    const rr = i % 2 === 0 ? r : r * 0.22;
    ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
  }
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawEye(ctx, c, side, wing, night, small) {
  ctx.save();
  ctx.translate(side * 0.27 * c, 0.02 * c);
  // Mirror the whole eye frame so everything below can treat +x as "outward"
  // and be written once. Without it the almond, the lash and especially the
  // wing all point the same absolute direction, which puts her left wing on the
  // wrong side of the eye — it reads as an angry brow rather than as eyeliner.
  ctx.scale(side, 1);
  // Positive canthal tilt — outer corner above the inner.
  ctx.rotate(-0.13);

  const eye = new Path2D();
  eye.moveTo(-0.19 * c, 0.01 * c);
  eye.quadraticCurveTo(-0.07 * c, -0.19 * c, 0.14 * c, -0.09 * c);
  eye.quadraticCurveTo(0.2 * c, -0.04 * c, 0.19 * c, 0.02 * c);
  eye.quadraticCurveTo(0.06 * c, 0.16 * c, -0.13 * c, 0.06 * c);
  eye.closePath();

  ctx.fillStyle = '#fdfbff';
  ctx.fill(eye);

  ctx.save();
  ctx.clip(eye);
  ctx.fillStyle = EYE;
  ctx.beginPath();
  ctx.arc(0.005 * c, -0.005 * c, 0.115 * c, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = EYE_DEEP;
  ctx.beginPath();
  ctx.ellipse(0.005 * c, -0.08 * c, 0.115 * c, 0.07 * c, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = LINER;
  ctx.beginPath();
  ctx.ellipse(0.005 * c, -0.005 * c, 0.045 * c, 0.058 * c, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // Heavy upper lash line — where the drama lives in her style.
  ctx.strokeStyle = LINER;
  ctx.lineWidth = (small ? 0.085 : 0.065) * c;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(-0.19 * c, 0.01 * c);
  ctx.quadraticCurveTo(-0.07 * c, -0.19 * c, 0.15 * c, -0.085 * c);
  ctx.stroke();

  if (wing > 0.01) {
    // Grown from the outer corner outward, so the flick draws itself on rather
    // than appearing whole.
    const baseX = 0.1 * c;
    const baseY = -0.09 * c;
    const tipX = baseX + (0.46 * c - baseX) * wing;
    const tipY = baseY + (-0.32 * c - baseY) * wing;
    ctx.fillStyle = LINER;
    ctx.beginPath();
    ctx.moveTo(baseX, baseY);
    ctx.lineTo(tipX, tipY);
    ctx.lineTo(0.2 * c, -0.02 * c);
    ctx.closePath();
    ctx.fill();
  }

  // Frame is already mirrored, so these are written once in outward terms.
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(-0.055 * c, -0.07 * c, 0.036 * c, 0, Math.PI * 2);
  ctx.fill();
  if (!small) {
    ctx.beginPath();
    ctx.arc(0.07 * c, 0.055 * c, 0.019 * c, 0, Math.PI * 2);
    ctx.fill();
    star(ctx, -0.055 * c, -0.07 * c, 0.1 * c, '#ffffff', night * 0.9);
  }
  ctx.restore();
}

export function drawMirandaFace(ctx, size, options = {}) {
  const night = Math.max(0, Math.min(1, options.night ?? 0));
  const wing = Math.max(0, options.wing ?? night);
  // Below about 48px the fine detail stops being detail and becomes dirt, so
  // it's dropped and the linework thickens instead.
  const small = size < 48;
  const c = size / 2;

  ctx.clearRect(0, 0, size, size);
  ctx.save();
  ctx.translate(c, c);
  ctx.lineJoin = 'round';

  ctx.save();
  ctx.beginPath();
  ctx.arc(0, 0, c, 0, Math.PI * 2);
  ctx.clip();
  const bg = ctx.createRadialGradient(0, -0.2 * c, 0, 0, 0, c);
  bg.addColorStop(0, mixHex(DAY_INNER, NIGHT_INNER, night));
  bg.addColorStop(1, mixHex(DAY_OUTER, NIGHT_OUTER, night));
  ctx.fillStyle = bg;
  ctx.fillRect(-c, -c, size, size);

  if (!small && night > 0.01) {
    // Radiating burst — big simple shapes, so it survives being shrunk.
    ctx.globalAlpha = night * 0.22;
    ctx.fillStyle = '#ffffff';
    for (let i = 0; i < 20; i += 2) {
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.arc(0, 0, c * 1.5, (i / 20) * Math.PI * 2, ((i + 1) / 20) * Math.PI * 2);
      ctx.closePath();
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
  ctx.restore();

  const hair = hairBackPath(c);
  const face = facePath(c);
  const bangs = bangsPath(c);

  ctx.fillStyle = HAIR;
  ctx.fill(hair);
  ctx.save();
  ctx.clip(hair);
  ctx.fillStyle = HAIR_DARK;
  ctx.beginPath();
  ctx.moveTo(0.2 * c, -1.2 * c);
  ctx.lineTo(1.2 * c, -1.2 * c);
  ctx.lineTo(1.2 * c, 1.2 * c);
  ctx.lineTo(0.36 * c, 1.2 * c);
  ctx.closePath();
  ctx.fill();
  if (night > 0.01) {
    ctx.save();
    ctx.globalAlpha = night;
    ctx.strokeStyle = HAIR_LIGHT;
    ctx.lineWidth = 0.085 * c;
    ctx.beginPath();
    ctx.ellipse(0, 0.16 * c, 0.79 * c, 1.01 * c, 0, Math.PI * 0.7, Math.PI * 1.34);
    ctx.stroke();
    ctx.restore();
  }
  ctx.restore();

  ctx.fillStyle = SKIN;
  ctx.fill(face);

  if (!small) {
    // One hard cel shadow, kept to a narrow strip. Half her face in shadow
    // reads as grubby rather than as lighting.
    ctx.save();
    ctx.clip(face);
    ctx.fillStyle = SKIN_SHADE;
    ctx.beginPath();
    ctx.moveTo(-1.2 * c, -1.2 * c);
    ctx.lineTo(-0.34 * c, -1.2 * c);
    ctx.quadraticCurveTo(-0.42 * c, 0.3 * c, -0.28 * c, 1.2 * c);
    ctx.lineTo(-1.2 * c, 1.2 * c);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    // Thin, high, arched brows — a heavy one reads stern or comic.
    ctx.strokeStyle = HAIR_DARK;
    ctx.lineWidth = 0.03 * c;
    ctx.lineCap = 'round';
    [-1, 1].forEach((s) => {
      ctx.beginPath();
      ctx.moveTo(s * 0.13 * c, -0.28 * c);
      ctx.quadraticCurveTo(s * 0.3 * c, -0.37 * c, s * 0.45 * c, -0.29 * c);
      ctx.stroke();
    });
  }

  drawEye(ctx, c, -1, wing, night, small);
  drawEye(ctx, c, 1, wing, night, small);

  // A strong dark lip does a lot of the "composed" read.
  ctx.fillStyle = LIPS;
  ctx.beginPath();
  ctx.ellipse(0, 0.5 * c, 0.125 * c, 0.055 * c, 0, 0, Math.PI * 2);
  ctx.fill();
  if (!small) {
    [-1, 1].forEach((s) => {
      ctx.beginPath();
      ctx.ellipse(s * 0.05 * c, 0.452 * c, 0.058 * c, 0.03 * c, 0, 0, Math.PI * 2);
      ctx.fill();
    });
  }

  ctx.fillStyle = HAIR;
  ctx.fill(bangs);
  ctx.save();
  ctx.clip(bangs);
  ctx.fillStyle = HAIR_DARK;
  ctx.beginPath();
  ctx.moveTo(0.18 * c, -1.2 * c);
  ctx.lineTo(1.2 * c, -1.2 * c);
  ctx.lineTo(1.2 * c, 0.2 * c);
  ctx.lineTo(0.32 * c, 0.2 * c);
  ctx.closePath();
  ctx.fill();
  if (!small) {
    ctx.fillStyle = night > 0.5 ? HAIR_LIGHT : 'rgba(200, 122, 96, 0.55)';
    ctx.beginPath();
    ctx.ellipse(-0.18 * c, -0.58 * c, 0.32 * c, 0.08 * c, -0.16, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  ctx.fillStyle = OUTFIT;
  ctx.beginPath();
  ctx.ellipse(0, 0.98 * c, 0.4 * c, 0.15 * c, 0, 0, Math.PI * 2);
  ctx.fill();
  if (!small) {
    ctx.fillStyle = METAL;
    ctx.beginPath();
    ctx.arc(0, 0.92 * c, 0.045 * c, 0, Math.PI * 2);
    ctx.fill();
  }

  // Ink outlines last, so nothing paints over them. This is the single thing
  // that makes a flat drawing read as the cel-shaded model.
  ctx.strokeStyle = INK;
  ctx.lineWidth = (small ? 0.05 : 0.034) * c;
  ctx.stroke(face);
  ctx.stroke(hair);
  ctx.stroke(bangs);

  if (!small) {
    for (const [x, y, r, a] of SPARKLES) {
      star(ctx, x * c, y * c, r * c, '#fff6d0', a * night);
    }
  }

  ctx.restore();
}
