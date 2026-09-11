import { useEffect, useState } from "react";
import { useFireStore } from "../store";
import type { ChallengeProgress, Metrics } from "../types";

// Sim data is replaced/mutated at 30Hz — these hooks poll getState() on a
// slow interval instead of subscribing React to every tick.

const readMetrics = (): Metrics => useFireStore.getState().metrics;
const readProgress = (): ChallengeProgress | null =>
  useFireStore.getState().challengeProgress;
const readGroundMoisture = (): number =>
  useFireStore.getState().env.groundMoisture;

export function useSlowValue<T>(read: () => T, ms: number): T {
  const [v, setV] = useState<T>(read);
  useEffect(() => {
    const iv = window.setInterval(() => setV(read()), ms);
    return () => window.clearInterval(iv);
  }, [read, ms]);
  return v;
}

export function useSlowMetrics(ms = 200): Metrics {
  return useSlowValue(readMetrics, ms);
}

export function useSlowProgress(ms = 100): ChallengeProgress | null {
  return useSlowValue(readProgress, ms);
}

export function useSlowMoisture(ms = 400): number {
  return useSlowValue(readGroundMoisture, ms);
}

export function useCountUp(target: number, dur = 900): number {
  const [v, setV] = useState(0);
  useEffect(() => {
    let raf = 0;
    const t0 = performance.now();
    const loop = (t: number) => {
      const k = Math.min(1, (t - t0) / dur);
      const e = 1 - (1 - k) ** 3;
      setV(Math.round(target * e));
      if (k < 1) raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [target, dur]);
  return v;
}
