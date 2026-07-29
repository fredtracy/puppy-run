import * as THREE from 'three';

// A painted sky dome with drifting procedural clouds, replacing the flat
// scene.background colour the yard used to sit under.
//
// Deliberately not photoreal. The rest of the game is painterly — hand-drawn
// grass strokes, a cartoon sun sprite, flat-shaded foliage — so this aims for
// soft gouache cloud shapes over a clean gradient rather than anything
// physically derived. Two rules keep it from fighting the existing scene:
//
//   * no sun disc. There's already a hand-drawn sun sprite, and the whole
//     reason scene.background stayed flat was to avoid a second, competing
//     one. This draws only a soft glow around SUN_DIRECTION.
//   * every colour is a uniform, driven from DAY_LIGHTING / NIGHT_LIGHTING,
//     so the day/night toggle keeps working without knowing what's in here.

const vertexShader = /* glsl */ `
  varying vec3 vDir;
  void main() {
    // Direction from the dome's centre, which (because the dome is
    // recentred on the camera every frame) is the view ray for this pixel.
    vDir = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const fragmentShader = /* glsl */ `
  varying vec3 vDir;

  uniform vec3 uHorizon;
  uniform vec3 uZenith;
  uniform vec3 uCloudLit;
  uniform vec3 uCloudShade;
  uniform vec3 uGlow;
  uniform vec3 uSunDir;
  uniform float uCoverage;
  uniform float uOpacity;
  uniform float uTime;

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
  }

  float valueNoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    // Smoothstep the cell interpolation, or the noise shows its grid.
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
      mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
      u.y
    );
  }

  float fbm(vec2 p) {
    float sum = 0.0;
    float amp = 0.5;
    for (int i = 0; i < 5; i++) {
      sum += amp * valueNoise(p);
      p *= 2.03;
      amp *= 0.5;
    }
    return sum;
  }

  void main() {
    vec3 dir = normalize(vDir);
    // Everything below works off |dir.y|, so the lower half of the dome is a
    // mirror of the upper rather than a dead zone.
    //
    // It used to clamp dir.y to 0, which left the entire hemisphere below
    // the horizon as one flat fill of uHorizon with the sun glow smeared
    // across it — the "sky stops halfway down and turns into a single colour
    // with light streaming through it". You see that hemisphere whenever the
    // camera looks out past the edge of the terrain, which on a 55m world is
    // most of the time.
    float ay = abs(dir.y);
    float h = clamp(ay, 0.0, 1.0);

    // Gradient. The low exponent keeps a wide band of pale colour sitting on
    // the horizon instead of the zenith blue crushing straight down to it.
    vec3 sky = mix(uHorizon, uZenith, pow(h, 0.5));

    // Broad, soft glow around the sun/moon — no disc.
    float sd = max(dot(dir, normalize(uSunDir)), 0.0);
    sky += uGlow * (pow(sd, 6.0) * 0.16 + pow(sd, 40.0) * 0.35);

    if (ay > 0.008) {
      // Project the view ray onto a flat cloud deck overhead. This is what
      // gives the clouds real perspective — they crowd together and flatten
      // out toward the horizon the way a real deck does, which a plain
      // spherical mapping never does.
      // The 3.0 is what sets how many cloud cells you see at once, and it
      // matters more than it looks: at 0.34 the whole visible sky mapped to
      // barely one cell of the noise field, so the entire dome came out a
      // single flat magnified blob. The max() stops the divisor collapsing
      // near the horizon, where the projection would otherwise run off to
      // infinity and alias into hard streaks.
      // Two things about this divisor, and they cause different artefacts.
      //
      // It is *added* rather than clamped. With max(ay, 0.12) every ray
      // below 0.12 divides by the same number, so uv stops depending on
      // elevation entirely and varies only with compass direction — every
      // pixel in a vertical line samples identical noise and the skyline
      // turns to hard stripes.
      //
      // And it is large. A true deck projection divides by ay alone, which
      // runs away toward the horizon: uv covers enormous distances for tiny
      // changes in elevation, so a single cloud gets smeared into a vertical
      // curtain hanging down out of the deck. That is geometrically honest —
      // a real deck really does converge like that — but a real deck also
      // has internal structure to converge, where smooth fbm blobs just
      // stretch. Those curtains read as light shafts, and they were the
      // "light streaming down", not anything near the horizon.
      //
      // 0.32 keeps enough perspective that clouds crowd toward the skyline,
      // while holding the stretch to about 3x across the whole dome instead
      // of unbounded. The scale is raised to match, or the gentler divisor
      // would simply magnify every cloud.
      vec2 uv = dir.xz / (ay + 0.32) * 7.0;
      // Offset so the zenith doesn't sit exactly on a noise cell corner,
      // which reads as a seam directly overhead.
      uv += vec2(17.3, 23.9);
      uv += uTime * vec2(0.0055, 0.0027);

      // Domain warp: billowy, curdled edges rather than the smooth blobs
      // raw fbm gives on its own.
      vec2 warp = vec2(fbm(uv * 0.55 + 3.1), fbm(uv * 0.55 + 8.7)) - 0.5;
      float n = fbm(uv + warp * 1.35);

      float cover = smoothstep(uCoverage, uCoverage + 0.22, n);
      // A short fade right at the skyline. It no longer has to hide the
      // streaking — the divisor above handles that — so it can stay low and
      // let cloud run most of the way down, which is where it needs to be:
      // the sky band you actually see while playing is nearly all within a
      // few degrees of the horizon. This is just haze.
      cover *= smoothstep(0.012, 0.14, ay);

      // Cloud only above the horizon. The *gradient* mirrors below it, which
      // is what stops the lower dome being a flat fill — but mirroring the
      // deck as well means you see the same cloud twice, with a reflection
      // line along the skyline. From a high vantage point that reads as
      // water, or as the whole yard being a floating island.
      //
      // Below the horizon you get the bare gradient instead, which passes as
      // distant haze. (The world edge being visible at all is a separate
      // thing — that's the 55m terrain simply running out.)
      cover *= smoothstep(-0.035, 0.015, dir.y);

      // Denser interior reads as shadowed base, thin edges as lit top.
      float lit = smoothstep(0.0, 0.42, n - uCoverage);
      vec3 cloud = mix(uCloudShade, uCloudLit, lit);
      // A little warmth where the cloud faces the sun.
      cloud += uGlow * pow(sd, 4.0) * 0.1 * lit;

      sky = mix(sky, cloud, cover * uOpacity);
    }

    gl_FragColor = vec4(sky, 1.0);
  }
`;

export function createSky() {
  const uniforms = {
    uHorizon: { value: new THREE.Color(0xbfe4f2) },
    uZenith: { value: new THREE.Color(0x4c9fd6) },
    uCloudLit: { value: new THREE.Color(0xffffff) },
    uCloudShade: { value: new THREE.Color(0xc0cddb) },
    uGlow: { value: new THREE.Color(0xffd9a0) },
    uSunDir: { value: new THREE.Vector3(0, 1, 0) },
    uCoverage: { value: 0.52 },
    uOpacity: { value: 0.95 },
    uTime: { value: 0 },
  };

  // Radius sits well inside the camera's far plane (1000) and outside the
  // sun/moon sprites (SKY_DISTANCE 125.8), so they hang in front of it.
  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(400, 48, 32),
    new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms,
      side: THREE.BackSide,
      // Skybox handling: drawn first, never writes depth, so every piece of
      // real geometry lands in front of it regardless of the dome's radius.
      depthWrite: false,
      // ShaderMaterial opts out of scene.fog unless asked, which is what we
      // want — fogging the sky toward the fog colour would flatten the whole
      // gradient back to where it started.
      fog: false,
    })
  );
  mesh.renderOrder = -1000;
  mesh.frustumCulled = false;

  return {
    mesh,
    // Called by applyDayNight with the sky block from the lighting config.
    apply(cfg, sunDirection) {
      uniforms.uHorizon.value.set(cfg.horizon);
      uniforms.uZenith.value.set(cfg.zenith);
      uniforms.uCloudLit.value.set(cfg.cloudLit);
      uniforms.uCloudShade.value.set(cfg.cloudShade);
      uniforms.uGlow.value.set(cfg.glow);
      uniforms.uCoverage.value = cfg.coverage;
      uniforms.uOpacity.value = cfg.opacity;
      uniforms.uSunDir.value.copy(sunDirection);
    },
    update(elapsed, cameraPosition) {
      uniforms.uTime.value = elapsed;
      // Follows the camera so you can never walk out from under the dome or
      // reach its edge.
      mesh.position.copy(cameraPosition);
    },
  };
}
