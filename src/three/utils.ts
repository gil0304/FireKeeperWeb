import type * as THREE from "three";
import type { WoodObject } from "../types";

/**
 * Output-weighted centroid of the fire, written into `out` (no allocation).
 * Returns false (and a sensible default) when nothing is burning.
 */
export function centroidInto(
  woods: WoodObject[],
  out: THREE.Vector3
): boolean {
  let x = 0;
  let y = 0;
  let z = 0;
  let n = 0;
  for (const w of woods) {
    if (w.output > 0) {
      x += w.position.x * w.output;
      y += w.position.y * w.output;
      z += w.position.z * w.output;
      n += w.output;
    }
  }
  if (n === 0) {
    out.set(0, 0.12, 0);
    return false;
  }
  out.set(x / n, y / n, z / n);
  return true;
}

/** Cheap layered-sine flicker in roughly [-1, 1]. */
export function flicker(t: number, seed: number): number {
  return (
    Math.sin(t * 13.7 + seed) * 0.45 +
    Math.sin(t * 7.3 + seed * 2.1 + 1.3) * 0.35 +
    Math.sin(t * 29.1 + seed * 0.7) * 0.2
  );
}

/** Stable small hash of an id string → [0, 10) used as a phase offset. */
export function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 9973;
  return (h / 9973) * 10;
}
