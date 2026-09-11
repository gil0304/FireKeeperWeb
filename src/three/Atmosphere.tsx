import { Stars } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useRef } from "react";
import * as THREE from "three";
import { useFireStore } from "../store";
import { centroidInto, flicker } from "./utils";

const tmpCentroid = new THREE.Vector3();
const tmpPos = new THREE.Vector3();
const COL_LOW = new THREE.Color("#ff5a1a");
const COL_HIGH = new THREE.Color("#ffc37a");

function FireLight() {
  const ref = useRef<THREE.PointLight>(null);

  useFrame((state, delta) => {
    const light = ref.current;
    if (!light) return;
    const st = useFireStore.getState();
    const power = st.metrics.firePower;
    const t = state.clock.elapsedTime;

    centroidInto(st.woods, tmpCentroid);
    tmpPos.set(tmpCentroid.x, tmpCentroid.y + 0.35, tmpCentroid.z);
    light.position.lerp(tmpPos, 1 - Math.exp(-Math.min(delta, 0.1) * 5));

    const f = 1 + flicker(t, 0) * 0.22 * Math.min(1, 0.3 + power * 0.02);
    light.intensity = (0.12 + power * 0.05) * f;
    light.color.lerpColors(COL_LOW, COL_HIGH, Math.min(1, power / 110));
  });

  return (
    <pointLight
      ref={ref}
      position={[0, 0.4, 0]}
      color="#ff5a1a"
      intensity={0.15}
      distance={9}
      decay={1.8}
    />
  );
}

export function Atmosphere() {
  const quality = useFireStore((s) => s.quality);
  return (
    <>
      <color attach="background" args={["#04060d"]} />
      <fog attach="fog" args={["#070b16", 7, 26]} />
      <ambientLight intensity={0.07} color="#26324f" />
      <directionalLight position={[4, 7, -3]} intensity={0.3} color="#8fa8d8" />
      <Stars
        radius={45}
        depth={25}
        count={quality === "low" ? 900 : 2200}
        factor={3.2}
        saturation={0}
        fade
        speed={0.25}
      />
      <FireLight />
    </>
  );
}
