import { OrbitControls } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { useRef, type ComponentRef } from "react";
import * as THREE from "three";
import { useFireStore } from "../store";
import { sceneState } from "./sceneState";
import { centroidInto } from "./utils";

type Ctrl = ComponentRef<typeof OrbitControls>;

const tmpCentroid = new THREE.Vector3();
const tmpTarget = new THREE.Vector3();
const tmpPos = new THREE.Vector3();

export function CameraRig() {
  const mode = useFireStore((s) => s.cameraMode);
  const controls = useRef<Ctrl>(null);
  const camera = useThree((s) => s.camera);
  const cinemaAngle = useRef(Math.random() * Math.PI * 2);

  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.1);
    const st = useFireStore.getState();
    const k = 1 - Math.exp(-dt * 3);
    centroidInto(st.woods, tmpCentroid);

    if (mode === "orbit" || mode === "close") {
      const c = controls.current;
      if (!c) return;
      c.enabled = !sceneState.draggingWood;
      // the wheel turns the wood being placed or selected, so it must not
      // also zoom the camera
      const turning =
        st.selectedId !== null ||
        (st.tool !== null && st.tool !== "lighter" && st.tool !== "bellows");
      c.enableZoom = !turning;
      if (mode === "orbit") {
        tmpTarget.set(0, 0.25, 0);
      } else {
        tmpTarget.set(tmpCentroid.x, 0.3, tmpCentroid.z);
      }
      c.target.lerp(tmpTarget, k);
      const targetMin = mode === "close" ? 0.5 : 0.8;
      const targetMax = mode === "close" ? 1.2 : 6;
      c.minDistance += (targetMin - c.minDistance) * k;
      c.maxDistance += (targetMax - c.maxDistance) * k;
      c.update();
    } else if (mode === "fixed") {
      tmpPos.set(0, 0.9, 2.6);
      camera.position.lerp(tmpPos, k);
      tmpTarget.set(0, 0.3, 0);
      camera.lookAt(tmpTarget);
    } else {
      // cinema: slow circular dolly, drifting height
      cinemaAngle.current += dt * 0.14;
      const a = cinemaAngle.current;
      const h = 1.0 + 0.4 * Math.sin(a * 0.43);
      tmpPos.set(Math.cos(a) * 2, h, Math.sin(a) * 2);
      camera.position.lerp(tmpPos, Math.min(1, k * 2.2));
      tmpTarget.set(tmpCentroid.x, 0.35, tmpCentroid.z);
      camera.lookAt(tmpTarget);
    }
  });

  if (mode !== "orbit" && mode !== "close") {
    sceneState.controls = null;
    return null;
  }
  return (
    <OrbitControls
      ref={(c) => {
        controls.current = c;
        sceneState.controls = c;
      }}
      makeDefault
      target={[0, 0.25, 0]}
      minDistance={0.8}
      maxDistance={6}
      maxPolarAngle={Math.PI / 2 - 0.08}
      enablePan={false}
      enableDamping
      dampingFactor={0.12}
    />
  );
}
