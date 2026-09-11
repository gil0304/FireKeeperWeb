import { useEffect } from "react";
import { useFireStore } from "../store";
import { AudioEngine } from "./engine";

const UPDATE_MS = 100; // ~10Hz sim-state polling

/**
 * Wires the zustand store to the procedural AudioEngine.
 * Call once in App. The AudioContext is created lazily on the first user
 * gesture (pointerdown/keydown) to satisfy autoplay policies.
 */
export function useAudio(): void {
  useEffect(() => {
    let engine: AudioEngine | null = null;

    const ensureEngine = () => {
      if (!engine) {
        engine = new AudioEngine();
        engine.setVolume(useFireStore.getState().volume);
      }
      engine.resume(); // no-op if already running
    };

    // keep listeners installed: also re-resumes if the browser suspends us
    window.addEventListener("pointerdown", ensureEngine);
    window.addEventListener("keydown", ensureEngine);

    // volume + one-shot event counters
    const unsubscribe = useFireStore.subscribe((s, prev) => {
      if (!engine) return;
      if (s.volume !== prev.volume) engine.setVolume(s.volume);
      if (s.placeEvent !== prev.placeEvent) engine.trigger("knock");
      if (s.lighterEvent !== prev.lighterEvent) engine.trigger("lighter");
      if (s.bellowsEvent !== prev.bellowsEvent) engine.trigger("bellows");
      if (s.scatterEvent !== prev.scatterEvent) engine.trigger("scatter");
    });

    // continuous layers follow sim state (read outside React, ~10Hz)
    let lastTick = performance.now();
    const interval = window.setInterval(() => {
      if (!engine) return;
      const now = performance.now();
      // background tabs coalesce timers — use measured time, capped so a long
      // stall does not schedule a burst storm on return
      const dt = Math.min((now - lastTick) / 1000, 1);
      lastTick = now;
      const s = useFireStore.getState();
      const inPlay = s.screen === "play";
      // duck to near-silence outside play; keep context running while paused
      engine.setDuck(inPlay ? (s.paused ? 0.05 : 1) : 0.02);
      engine.update(
        dt,
        s.metrics.firePower,
        s.env.windSpeed,
        s.speed,
        inPlay && !s.paused
      );
    }, UPDATE_MS);

    return () => {
      window.removeEventListener("pointerdown", ensureEngine);
      window.removeEventListener("keydown", ensureEngine);
      window.clearInterval(interval);
      unsubscribe();
      engine?.dispose();
      engine = null;
    };
  }, []);
}
