import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFireStore } from "../store";
import type { Quality, WoodObject } from "../types";
import { centroidInto } from "./utils";

const POINT_VERT = /* glsl */ `
attribute float aSize;
attribute float aAlpha;
uniform float uScale;
varying float vAlpha;
void main() {
  vAlpha = aAlpha;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = aSize * uScale / max(0.1, -mv.z);
  gl_Position = projectionMatrix * mv;
}
`;

const POINT_FRAG = /* glsl */ `
precision mediump float;
uniform vec3 uColor;
uniform float uSoft;
varying float vAlpha;
void main() {
  float d = length(gl_PointCoord - 0.5);
  float a = 1.0 - smoothstep(uSoft, 0.5, d);
  a *= vAlpha;
  if (a < 0.01) discard;
  gl_FragColor = vec4(uColor, a);
}
`;

function makePointsMaterial(
  color: THREE.Color,
  soft: number,
  additive: boolean
): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: POINT_VERT,
    fragmentShader: POINT_FRAG,
    uniforms: {
      uColor: { value: color },
      uSoft: { value: soft },
      uScale: { value: 500 },
    },
    transparent: true,
    depthWrite: false,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
  });
}

/** Fixed-size particle pool over a Points BufferGeometry. */
class Pool {
  readonly n: number;
  readonly geometry = new THREE.BufferGeometry();
  private readonly pos: Float32Array;
  private readonly vel: Float32Array;
  private readonly life: Float32Array;
  private readonly maxLife: Float32Array;
  private readonly size0: Float32Array;
  private readonly size1: Float32Array;
  private readonly baseAlpha: Float32Array;
  private readonly aPos: THREE.BufferAttribute;
  private readonly aSize: THREE.BufferAttribute;
  private readonly aAlpha: THREE.BufferAttribute;
  private readonly smokeEnvelope: boolean;
  private cursor = 0;

  constructor(n: number, smokeEnvelope: boolean) {
    this.n = n;
    this.smokeEnvelope = smokeEnvelope;
    this.pos = new Float32Array(n * 3);
    this.vel = new Float32Array(n * 3);
    this.life = new Float32Array(n);
    this.maxLife = new Float32Array(n);
    this.size0 = new Float32Array(n);
    this.size1 = new Float32Array(n);
    this.baseAlpha = new Float32Array(n);
    // park dead particles far underground
    for (let i = 0; i < n; i++) this.pos[i * 3 + 1] = -100;
    this.aPos = new THREE.BufferAttribute(this.pos, 3);
    this.aSize = new THREE.BufferAttribute(this.size0.slice(), 1);
    this.aAlpha = new THREE.BufferAttribute(this.baseAlpha.slice(), 1);
    this.aPos.setUsage(THREE.DynamicDrawUsage);
    this.aSize.setUsage(THREE.DynamicDrawUsage);
    this.aAlpha.setUsage(THREE.DynamicDrawUsage);
    this.geometry.setAttribute("position", this.aPos);
    this.geometry.setAttribute("aSize", this.aSize);
    this.geometry.setAttribute("aAlpha", this.aAlpha);
  }

  spawn(
    x: number,
    y: number,
    z: number,
    vx: number,
    vy: number,
    vz: number,
    life: number,
    size0: number,
    size1: number,
    alpha: number
  ): void {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.n;
    this.pos[i * 3] = x;
    this.pos[i * 3 + 1] = y;
    this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx;
    this.vel[i * 3 + 1] = vy;
    this.vel[i * 3 + 2] = vz;
    this.life[i] = life;
    this.maxLife[i] = life;
    this.size0[i] = size0;
    this.size1[i] = size1;
    this.baseAlpha[i] = alpha;
  }

  update(dt: number, ax: number, ay: number, az: number, damp: number): void {
    const alphas = this.aAlpha.array as Float32Array;
    const sizes = this.aSize.array as Float32Array;
    const d = Math.max(0, 1 - damp * dt);
    for (let i = 0; i < this.n; i++) {
      if (this.life[i] <= 0) {
        if (alphas[i] !== 0) {
          alphas[i] = 0;
          this.pos[i * 3 + 1] = -100;
        }
        continue;
      }
      this.life[i] -= dt;
      const j = i * 3;
      this.vel[j] = (this.vel[j] + ax * dt) * d;
      this.vel[j + 1] = (this.vel[j + 1] + ay * dt) * d;
      this.vel[j + 2] = (this.vel[j + 2] + az * dt) * d;
      this.pos[j] += this.vel[j] * dt;
      this.pos[j + 1] += this.vel[j + 1] * dt;
      this.pos[j + 2] += this.vel[j + 2] * dt;
      const f = Math.max(0, this.life[i] / this.maxLife[i]); // 1 → 0
      const env = this.smokeEnvelope
        ? Math.min((1 - f) * 5, 1) * f
        : f;
      alphas[i] = this.baseAlpha[i] * env;
      sizes[i] = this.size0[i] + (1 - f) * (this.size1[i] - this.size0[i]);
    }
    this.aPos.needsUpdate = true;
    this.aSize.needsUpdate = true;
    this.aAlpha.needsUpdate = true;
  }

  dispose(): void {
    this.geometry.dispose();
  }
}

const QUALITY_MULT: Record<Quality, number> = { low: 0.3, mid: 0.6, high: 1 };

const tmpCentroid = new THREE.Vector3();
const tmpSmokeCol = new THREE.Color();
const SMOKE_LIGHT = new THREE.Color("#73767c");
const SMOKE_DARK = new THREE.Color("#33353a");
const burningScratch: WoodObject[] = [];

export function Particles() {
  const quality = useFireStore((s) => s.quality);
  const mult = QUALITY_MULT[quality];

  const pools = useMemo(
    () => ({
      embers: new Pool(Math.max(24, Math.round(260 * mult)), false),
      smoke: new Pool(Math.max(16, Math.round(150 * mult)), true),
      blast: new Pool(Math.max(12, Math.round(80 * mult)), false),
    }),
    [mult]
  );
  const materials = useMemo(
    () => ({
      embers: makePointsMaterial(new THREE.Color(2.4, 0.95, 0.22), 0.12, true),
      smoke: makePointsMaterial(SMOKE_LIGHT.clone(), 0.0, false),
      blast: makePointsMaterial(new THREE.Color(1.3, 1.5, 1.8), 0.05, true),
    }),
    []
  );

  useEffect(() => {
    return () => {
      pools.embers.dispose();
      pools.smoke.dispose();
      pools.blast.dispose();
    };
  }, [pools]);
  useEffect(() => {
    return () => {
      materials.embers.dispose();
      materials.smoke.dispose();
      materials.blast.dispose();
    };
  }, [materials]);

  const emberAcc = useRef(0);
  const smokeAcc = useRef(0);
  const lastBellows = useRef(useFireStore.getState().bellowsEvent);

  useFrame((state, delta) => {
    const dt = Math.min(delta, 0.05);
    const st = useFireStore.getState();
    const playing = st.screen === "play" && !st.paused;

    const windX = Math.cos(st.env.windDir) * st.env.windSpeed;
    const windZ = Math.sin(st.env.windDir) * st.env.windSpeed;
    const gusty = st.env.windSpeed > 5;

    // perspective point-size scale: pixels for a 1-unit particle at z=1
    const cam = state.camera as THREE.PerspectiveCamera;
    const uScale =
      (state.size.height * state.viewport.dpr) /
      (2 * Math.tan((cam.fov * Math.PI) / 360));
    materials.embers.uniforms.uScale.value = uScale;
    materials.smoke.uniforms.uScale.value = uScale;
    materials.blast.uniforms.uScale.value = uScale;

    if (playing) {
      // ---- embers ----
      burningScratch.length = 0;
      for (const w of st.woods) if (w.output > 0) burningScratch.push(w);
      if (burningScratch.length > 0) {
        let rate = Math.min(90, st.metrics.firePower * 1.1) * mult;
        if (gusty) rate += 14 * mult; // 火の粉が飛ぶ
        emberAcc.current += rate * dt;
        while (emberAcc.current >= 1) {
          emberAcc.current -= 1;
          const w =
            burningScratch[(Math.random() * burningScratch.length) | 0];
          const spread = gusty ? 0.5 : 0.16;
          pools.embers.spawn(
            w.position.x + (Math.random() - 0.5) * 0.06,
            w.position.y + 0.03,
            w.position.z + (Math.random() - 0.5) * 0.06,
            (Math.random() - 0.5) * spread + windX * 0.1,
            0.5 + Math.random() * 0.7 + w.output * 0.003,
            (Math.random() - 0.5) * spread + windZ * 0.1,
            0.5 + Math.random() * 1.1,
            0.008 + Math.random() * 0.012,
            0.004,
            0.9
          );
        }
      }

      // ---- smoke ----
      const smoke = st.metrics.smoke;
      const smokeRate =
        (smoke * 0.22 + (st.metrics.firePower > 3 ? 1.2 : 0)) * mult;
      if (smokeRate > 0) {
        smokeAcc.current += smokeRate * dt;
        centroidInto(st.woods, tmpCentroid);
        while (smokeAcc.current >= 1) {
          smokeAcc.current -= 1;
          pools.smoke.spawn(
            tmpCentroid.x + (Math.random() - 0.5) * 0.22,
            tmpCentroid.y + 0.15 + Math.random() * 0.1,
            tmpCentroid.z + (Math.random() - 0.5) * 0.22,
            (Math.random() - 0.5) * 0.06 + windX * 0.05,
            0.24 + Math.random() * 0.12,
            (Math.random() - 0.5) * 0.06 + windZ * 0.05,
            2.6 + Math.random() * 2.2,
            0.06,
            0.42 + Math.min(0.35, smoke * 0.004),
            0.1 + Math.min(0.16, smoke * 0.0018)
          );
        }
      }
      // denser smoke → darker column
      tmpSmokeCol
        .copy(SMOKE_LIGHT)
        .lerp(SMOKE_DARK, Math.min(1, smoke / 80));
      (materials.smoke.uniforms.uColor.value as THREE.Color).copy(tmpSmokeCol);

      // ---- bellows blast ----
      if (st.bellowsEvent !== lastBellows.current) {
        lastBellows.current = st.bellowsEvent;
        const puff = st.puffs[st.puffs.length - 1];
        if (puff) {
          const count = Math.max(10, Math.round(26 * mult));
          for (let i = 0; i < count; i++) {
            const a = Math.random() * Math.PI * 2;
            const up = Math.random() * 0.6;
            const sp = 0.8 + Math.random() * 0.9;
            pools.blast.spawn(
              puff.x,
              puff.y + 0.04,
              puff.z,
              Math.cos(a) * sp,
              up,
              Math.sin(a) * sp,
              0.22 + Math.random() * 0.22,
              0.015 + Math.random() * 0.015,
              0.005,
              0.55
            );
          }
        }
      }
    }

    pools.embers.update(dt, windX * 0.35, 0.5, windZ * 0.35, 0.9);
    pools.smoke.update(dt, windX * 0.13, 0.05, windZ * 0.13, 0.35);
    pools.blast.update(dt, 0, 0.4, 0, 2.6);
  });

  return (
    <group>
      <points
        geometry={pools.embers.geometry}
        material={materials.embers}
        frustumCulled={false}
      />
      <points
        geometry={pools.smoke.geometry}
        material={materials.smoke}
        frustumCulled={false}
      />
      <points
        geometry={pools.blast.geometry}
        material={materials.blast}
        frustumCulled={false}
      />
    </group>
  );
}
