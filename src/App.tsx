import { useEffect } from "react";
import { SIM_DT } from "./constants";
import { initPhysics, syncBodies } from "./sim/physics";
import { useFireStore } from "./store";
import { FireScene } from "./three/Scene";
import { HUD } from "./ui/HUD";
import { useAudio } from "./audio/useAudio";

export default function App() {
  useAudio();

  // rapier is WebAssembly, so it loads while the title screen is up
  useEffect(() => {
    let cancelled = false;
    initPhysics().then(() => {
      if (!cancelled) syncBodies(useFireStore.getState().woods);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // fixed-step sim driver (independent of render loop)
  useEffect(() => {
    let last = performance.now();
    let acc = 0;
    const iv = setInterval(() => {
      const now = performance.now();
      let dt = (now - last) / 1000;
      last = now;
      if (dt > 0.25) dt = 0.25;
      const s = useFireStore.getState();
      if (s.paused || s.screen !== "play") {
        acc = 0;
        return;
      }
      acc += dt * s.speed;
      let steps = 0;
      while (acc >= SIM_DT && steps < 10) {
        s.tick(SIM_DT);
        acc -= SIM_DT;
        steps++;
      }
      if (steps >= 10) acc = 0;
    }, 33);
    return () => clearInterval(iv);
  }, []);

  // autosave in free mode
  useEffect(() => {
    const iv = setInterval(() => {
      const s = useFireStore.getState();
      if (s.screen === "play" && s.mode === "free") s.persist();
    }, 10000);
    return () => clearInterval(iv);
  }, []);

  // delete key removes selected wood
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Delete" || e.key === "Backspace") {
        const s = useFireStore.getState();
        if (s.selectedId) s.deleteWood(s.selectedId);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="app">
      <FireScene />
      <HUD />
    </div>
  );
}
