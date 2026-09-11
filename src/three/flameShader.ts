import * as THREE from "three";

// Billboarded flame quad. Pivot is at the bottom (geometry translated +0.5y).
// uBend shears the top of the flame in local x (wind, projected by caller).

export const FLAME_VERT = /* glsl */ `
uniform float uBend;
varying vec2 vUv;
void main() {
  vUv = uv;
  vec3 p = position;
  p.x += uBend * p.y * p.y * 1.6;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}
`;

export const FLAME_FRAG = /* glsl */ `
precision highp float;
uniform float uTime;
uniform float uPower;
uniform float uSeed;
uniform float uJitter;
varying vec2 vUv;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
    mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
    u.y
  );
}
float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) {
    v += a * noise(p);
    p *= 2.03;
    a *= 0.5;
  }
  return v;
}

void main() {
  vec2 uv = vUv;
  float t = uTime * (1.3 + uJitter * 0.35);

  // layered noise scrolling upward (uv.y - t)
  vec2 q = vec2(uv.x * 2.4 + uSeed * 3.1, uv.y * 3.0 - t * 1.9);
  float n = fbm(q);
  float n2 = fbm(q * 2.1 + vec2(7.3, -t * 0.6));

  // teardrop body: narrows with height, edges eaten by noise
  float cx = uv.x - 0.5 + (n - 0.5) * 0.28 * (0.25 + uv.y);
  float width = 0.30 * (1.0 - uv.y * 0.72) * (0.8 + n2 * 0.45);
  float body = 1.0 - smoothstep(width * 0.35, width, abs(cx));
  float vert = smoothstep(0.0, 0.10, uv.y) *
               (1.0 - smoothstep(0.45, 1.0, uv.y + (n - 0.5) * 0.4));
  float flame = body * vert;
  flame *= 0.78 + 0.22 * sin(t * 6.3 + uSeed * 9.0 + n * 4.0);
  if (flame < 0.02) discard;

  // brightness field: hotter low & centered
  float v = flame * (0.5 + 0.5 * (1.0 - uv.y)) * (0.65 + 0.35 * uPower);

  vec3 col = mix(vec3(0.45, 0.03, 0.0), vec3(1.0, 0.32, 0.02), smoothstep(0.04, 0.35, v));
  col = mix(col, vec3(1.0, 0.72, 0.12), smoothstep(0.30, 0.62, v));
  col = mix(col, vec3(1.0, 0.95, 0.78), smoothstep(0.58, 0.9, v) * uPower);

  // HDR push so Bloom (threshold ~1) catches the hot parts
  col *= 1.5 + uPower * 1.9;

  gl_FragColor = vec4(col * flame, flame * 0.9);
}
`;

export function makeFlameMaterial(seed: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: FLAME_VERT,
    fragmentShader: FLAME_FRAG,
    uniforms: {
      uTime: { value: 0 },
      uPower: { value: 0 },
      uBend: { value: 0 },
      uSeed: { value: seed },
      uJitter: { value: 1 },
    },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
}

/** Shared flame quad: 1x1, bottom pivot, height-segmented so uBend curves. */
export function makeFlameGeometry(): THREE.PlaneGeometry {
  const g = new THREE.PlaneGeometry(1, 1, 1, 6);
  g.translate(0, 0.5, 0);
  return g;
}
