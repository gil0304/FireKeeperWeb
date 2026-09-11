import { PerformanceMonitor } from "@react-three/drei";
import { Canvas } from "@react-three/fiber";
import {
  Bloom,
  EffectComposer,
  ToneMapping,
} from "@react-three/postprocessing";
import { useEffect, useState } from "react";
import { useFireStore } from "../store";
import type { Quality } from "../types";
import { Atmosphere } from "./Atmosphere";
import { CameraRig } from "./CameraRig";
import { Flames } from "./Flames";
import { Ground } from "./Ground";
import { Interactions } from "./Interactions";
import { Particles } from "./Particles";
import { Woods } from "./Woods";

const DPR_RANGE: Record<Quality, [number, number]> = {
  low: [0.75, 1],
  mid: [1, 1.5],
  high: [1, 2],
};

export function FireScene() {
  const quality = useFireStore((s) => s.quality);
  const [minDpr, maxDpr] = DPR_RANGE[quality];
  const [dpr, setDpr] = useState(maxDpr);

  useEffect(() => {
    setDpr(maxDpr);
  }, [maxDpr]);

  return (
    <Canvas
      style={{ position: "absolute", inset: 0 }}
      dpr={dpr}
      gl={{ antialias: quality !== "low", powerPreference: "high-performance" }}
      camera={{ position: [1.9, 1.35, 2.3], fov: 50, near: 0.05, far: 60 }}
    >
      <PerformanceMonitor
        onDecline={() => setDpr(minDpr)}
        onIncline={() => setDpr(maxDpr)}
      />
      <Atmosphere />
      <Ground />
      <Woods />
      <Flames />
      <Particles />
      <Interactions />
      <CameraRig />
      {quality !== "low" && (
        <EffectComposer multisampling={quality === "high" ? 4 : 0}>
          <Bloom
            intensity={0.85}
            luminanceThreshold={1}
            luminanceSmoothing={0.35}
            mipmapBlur
          />
          <ToneMapping />
        </EffectComposer>
      )}
    </Canvas>
  );
}
