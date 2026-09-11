import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFireStore } from "../store";
import type { Quality } from "../types";
import { makeFlameGeometry, makeFlameMaterial } from "./flameShader";
import { sceneState } from "./sceneState";
import { centroidInto } from "./utils";

const POOL_SIZE: Record<Quality, number> = { low: 10, mid: 16, high: 24 };

const tmpCentroid = new THREE.Vector3();

export function Flames() {
  const quality = useFireStore((s) => s.quality);
  const poolSize = POOL_SIZE[quality];

  const geometry = useMemo(() => makeFlameGeometry(), []);
  const mats = useMemo(
    () =>
      Array.from({ length: poolSize }, (_, i) =>
        makeFlameMaterial((i * 0.37) % 1)
      ),
    [poolSize]
  );
  const centralMat = useMemo(() => makeFlameMaterial(0.71), []);
  const flareMat = useMemo(() => makeFlameMaterial(0.13), []);

  useEffect(() => {
    return () => {
      for (const m of mats) m.dispose();
    };
  }, [mats]);
  useEffect(() => {
    return () => {
      geometry.dispose();
      centralMat.dispose();
      flareMat.dispose();
    };
  }, [geometry, centralMat, flareMat]);

  const flameRefs = useRef<(THREE.Mesh | null)[]>([]);
  const centralRef = useRef<THREE.Group>(null);
  const flareRef = useRef<THREE.Mesh>(null);

  useFrame((state, delta) => {
    const dt = Math.min(delta, 0.1);
    const st = useFireStore.getState();
    const t = state.clock.elapsedTime;
    const cam = state.camera;

    const windX = Math.cos(st.env.windDir) * st.env.windSpeed;
    const windZ = Math.sin(st.env.windDir) * st.env.windSpeed;
    const jitter = 1 + st.env.windSpeed * 0.18;

    // per-wood flames from the pool
    let fi = 0;
    for (const w of st.woods) {
      if (w.output <= 0) continue;
      if (fi >= mats.length) break;
      const mesh = flameRefs.current[fi];
      const mat = mats[fi];
      fi++;
      if (!mesh) continue;
      mesh.visible = true;
      mesh.position.set(w.position.x, w.position.y, w.position.z);
      const h = 0.15 + w.output * 0.008;
      mesh.scale.set(h * 0.62, h, 1);
      const yaw = Math.atan2(
        cam.position.x - w.position.x,
        cam.position.z - w.position.z
      );
      mesh.rotation.set(0, yaw, 0);
      // world wind projected onto the billboard's local +x axis
      const wl = windX * Math.cos(yaw) - windZ * Math.sin(yaw);
      const u = mat.uniforms;
      u.uTime.value = t;
      u.uPower.value = Math.min(1, w.output / 80);
      u.uBend.value = THREE.MathUtils.clamp(wl * 0.05, -0.75, 0.75);
      u.uJitter.value = jitter;
    }
    for (; fi < mats.length; fi++) {
      const mesh = flameRefs.current[fi];
      if (mesh) mesh.visible = false;
    }

    // central main flame (crossed quads)
    const central = centralRef.current;
    if (central) {
      const power = st.metrics.firePower;
      const on = power > 2;
      central.visible = on;
      if (on) {
        centroidInto(st.woods, tmpCentroid);
        central.position.set(tmpCentroid.x, tmpCentroid.y - 0.02, tmpCentroid.z);
        const h = 0.25 + Math.min(power, 120) * 0.0095;
        central.scale.set(h * 0.66, h, h * 0.66);
        const yaw = Math.atan2(
          cam.position.x - tmpCentroid.x,
          cam.position.z - tmpCentroid.z
        );
        central.rotation.set(0, yaw, 0);
        const wl = windX * Math.cos(yaw) - windZ * Math.sin(yaw);
        const u = centralMat.uniforms;
        u.uTime.value = t;
        u.uPower.value = Math.min(1, power / 85);
        u.uBend.value = THREE.MathUtils.clamp(wl * 0.045, -0.7, 0.7);
        u.uJitter.value = jitter;
      }
    }

    // lighter flare (short-lived mini flame at the click point)
    const flare = flareRef.current;
    if (flare) {
      if (sceneState.lighter.t > 0) {
        sceneState.lighter.t -= dt;
        flare.visible = true;
        flare.position.copy(sceneState.lighter.pos);
        const s = 0.09 * Math.min(1, sceneState.lighter.t / 0.35 + 0.4);
        flare.scale.set(s * 0.7, s, 1);
        flare.rotation.set(
          0,
          Math.atan2(
            cam.position.x - flare.position.x,
            cam.position.z - flare.position.z
          ),
          0
        );
        const u = flareMat.uniforms;
        u.uTime.value = t * 1.6;
        u.uPower.value = 0.55;
        u.uJitter.value = 1.4;
      } else {
        flare.visible = false;
      }
    }
  });

  return (
    <group>
      {mats.map((m, i) => (
        <mesh
          key={i}
          ref={(el) => {
            flameRefs.current[i] = el;
          }}
          geometry={geometry}
          material={m}
          visible={false}
          frustumCulled={false}
        />
      ))}
      {/* the group billboards to the camera, so the pair is splayed a little
          off-axis rather than crossed at 90° (which would be edge-on) */}
      <group ref={centralRef} visible={false}>
        <mesh
          geometry={geometry}
          material={centralMat}
          rotation={[0, 0.5, 0]}
          frustumCulled={false}
        />
        <mesh
          geometry={geometry}
          material={centralMat}
          rotation={[0, -0.5, 0]}
          frustumCulled={false}
        />
      </group>
      <mesh
        ref={flareRef}
        geometry={geometry}
        material={flareMat}
        visible={false}
        frustumCulled={false}
      />
    </group>
  );
}
