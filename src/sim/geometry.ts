import { WOOD_PROPS } from "../constants";
import type { Vec3, WoodObject, WoodType } from "../types";

/** A wood is a capsule: a line segment with a radius. */
export interface Seg {
  ax: number;
  ay: number;
  az: number;
  bx: number;
  by: number;
  bz: number;
  r: number;
}

/** Long axis of a wood — the three.js euler XYZ matrix applied to (0,1,0). */
export function woodAxis(rot: Vec3, out: Vec3): Vec3 {
  const cx = Math.cos(rot.x), sx = Math.sin(rot.x);
  const cy = Math.cos(rot.y), sy = Math.sin(rot.y);
  const cz = Math.cos(rot.z), sz = Math.sin(rot.z);
  out.x = -cy * sz;
  out.y = cx * cz - sx * sy * sz;
  out.z = sx * cz + cx * sy * sz;
  return out;
}

const axis: Vec3 = { x: 0, y: 0, z: 0 };

/** tinder and leaves are modelled as flat pads, not sticks */
const FLAT: Partial<Record<WoodType, true>> = { tinder: true, leaves: true };

/**
 * Collision axis of a wood. Flat pieces always lie on the ground along their
 * yaw, whatever their mesh rotation is; sticks follow their euler.
 */
export function axisFor(type: WoodType, rot: Vec3, out: Vec3): Vec3 {
  if (FLAT[type]) {
    out.x = -Math.cos(rot.y);
    out.y = 0;
    out.z = Math.sin(rot.y);
    return out;
  }
  return woodAxis(rot, out);
}

export function hitRadius(type: WoodType): number {
  const p = WOOD_PROPS[type];
  return p.hitRadius ?? p.radius;
}

/** Ash lies flat, so a burned wood barely holds anything up. */
export function effRadius(w: WoodObject): number {
  const r = hitRadius(w.type);
  return w.state === "burned" ? r * 0.3 : r;
}

export function segmentOf(
  type: WoodType,
  position: Vec3,
  rotation: Vec3,
  radius: number,
  out: Seg
): Seg {
  const h = WOOD_PROPS[type].length / 2;
  axisFor(type, rotation, axis);
  out.ax = position.x - axis.x * h;
  out.ay = position.y - axis.y * h;
  out.az = position.z - axis.z * h;
  out.bx = position.x + axis.x * h;
  out.by = position.y + axis.y * h;
  out.bz = position.z + axis.z * h;
  out.r = radius;
  return out;
}

export function woodSegment(w: WoodObject, out: Seg): Seg {
  return segmentOf(w.type, w.position, w.rotation, effRadius(w), out);
}

export function emptySeg(): Seg {
  return { ax: 0, ay: 0, az: 0, bx: 0, by: 0, bz: 0, r: 0 };
}

/** results of closestParams — reused, this sits in the innermost loop */
let paramS = 0;
let paramT = 0;

/** Closest-point parameters between two segments (Ericson, Real-Time CD). */
function closestParams(s1: Seg, s2: Seg, flat: boolean): void {
  const d1x = s1.bx - s1.ax;
  const d1y = flat ? 0 : s1.by - s1.ay;
  const d1z = s1.bz - s1.az;
  const d2x = s2.bx - s2.ax;
  const d2y = flat ? 0 : s2.by - s2.ay;
  const d2z = s2.bz - s2.az;
  const rx = s1.ax - s2.ax;
  const ry = flat ? 0 : s1.ay - s2.ay;
  const rz = s1.az - s2.az;
  const a = d1x * d1x + d1y * d1y + d1z * d1z;
  const e = d2x * d2x + d2y * d2y + d2z * d2z;
  const f = d2x * rx + d2y * ry + d2z * rz;
  let s = 0;
  let t = 0;
  if (a <= 1e-9 && e <= 1e-9) {
    paramS = 0;
    paramT = 0;
    return;
  }
  if (a <= 1e-9) {
    t = clamp01(f / e);
  } else {
    const c = d1x * rx + d1y * ry + d1z * rz;
    if (e <= 1e-9) {
      s = clamp01(-c / a);
    } else {
      const b = d1x * d2x + d1y * d2y + d1z * d2z;
      const denom = a * e - b * b;
      if (denom > 1e-9) s = clamp01((b * f - c * e) / denom);
      t = (b * s + f) / e;
      if (t < 0) {
        t = 0;
        s = clamp01(-c / a);
      } else if (t > 1) {
        t = 1;
        s = clamp01((b - c) / a);
      }
    }
  }
  paramS = s;
  paramT = t;
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** Distance between the two capsule axes in 3D. */
export function segDist(s1: Seg, s2: Seg): number {
  closestParams(s1, s2, false);
  const s = paramS;
  const t = paramT;
  const cx1 = s1.ax + (s1.bx - s1.ax) * s;
  const cy1 = s1.ay + (s1.by - s1.ay) * s;
  const cz1 = s1.az + (s1.bz - s1.az) * s;
  const cx2 = s2.ax + (s2.bx - s2.ax) * t;
  const cy2 = s2.ay + (s2.by - s2.ay) * t;
  const cz2 = s2.az + (s2.bz - s2.az) * t;
  const dx = cx1 - cx2;
  const dy = cy1 - cy2;
  const dz = cz1 - cz2;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

export interface FlatHit {
  /** horizontal distance between the axes */
  d: number;
  /** height of this segment at the closest point */
  selfY: number;
  /** height of the other segment at the closest point */
  otherY: number;
}

/**
 * Distance between the two axes seen from above, plus the height of the
 * support segment where they cross. This is what stacking needs: how far
 * apart the logs are on the ground plane, and how high the lower one is
 * at the point of contact.
 */
export function segDistFlat(s1: Seg, s2: Seg, out: FlatHit): FlatHit {
  closestParams(s1, s2, true);
  const s = paramS;
  const t = paramT;
  const cx1 = s1.ax + (s1.bx - s1.ax) * s;
  const cz1 = s1.az + (s1.bz - s1.az) * s;
  const cx2 = s2.ax + (s2.bx - s2.ax) * t;
  const cz2 = s2.az + (s2.bz - s2.az) * t;
  const dx = cx1 - cx2;
  const dz = cz1 - cz2;
  out.d = Math.sqrt(dx * dx + dz * dz);
  out.selfY = s1.ay + (s1.by - s1.ay) * s;
  out.otherY = s2.ay + (s2.by - s2.ay) * t;
  return out;
}

const candSeg = emptySeg();
const otherSeg = emptySeg();
const hit: FlatHit = { d: 0, selfY: 0, otherY: 0 };

/**
 * Plan-view distance from a point to a segment, plus the segment's height
 * there. Used to test a wood against another one at several points along its
 * length — a single closest-point test misses the binding contact when the
 * pieces are tilted.
 */
function pointSegFlat(px: number, pz: number, s: Seg, out: FlatHit): FlatHit {
  const dx = s.bx - s.ax;
  const dz = s.bz - s.az;
  const len2 = dx * dx + dz * dz;
  const t =
    len2 <= 1e-9 ? 0 : clamp01(((px - s.ax) * dx + (pz - s.az) * dz) / len2);
  const cx = s.ax + dx * t;
  const cz = s.az + dz * t;
  const ex = px - cx;
  const ez = pz - cz;
  out.d = Math.sqrt(ex * ex + ez * ez);
  out.otherY = s.ay + (s.by - s.ay) * t;
  return out;
}

/** how many points along a wood are tested for contact */
const SAMPLES = 7;

/**
 * Height at which a piece lowered from above comes to rest — on the ground,
 * or on top of everything it overlaps. Returns the centre height.
 *
 * Gravity and collapse are rapier's job (see physics.ts). This is used for
 * the placement preview and to seat a new piece the instant it is created,
 * before rapier's broad phase has seen it, so the two must agree.
 *
 * The plan-view closest point gives a lower bound (contact heights move
 * exactly with the piece under vertical motion); sampling along the piece
 * tightens it for tilted logs, then a bisection on the true 3D distance
 * lands on the contact.
 */
export function restingY(
  woods: WoodObject[],
  type: WoodType,
  position: Vec3,
  rotation: Vec3,
  skipId: string | null
): number {
  const p = WOOD_PROPS[type];
  axisFor(type, rotation, axis);
  // how far the capsule's lowest point sits below its centre
  const rad = hitRadius(type);
  const halfDrop = Math.abs(axis.y) * (p.length / 2) + rad;
  let best = halfDrop + 0.004;

  segmentOf(type, position, rotation, rad, candSeg);
  // vertical offsets of the capsule ends relative to the centre
  const offA = candSeg.ay - position.y;
  const offB = candSeg.by - position.y;

  for (const w of woods) {
    if (w.id === skipId) continue;
    const rr = rad + effRadius(w);
    woodSegment(w, otherSeg);

    // plan-view distance is a lower bound on the real distance: if the axes
    // are farther apart than this from above, no height can make them touch
    segDistFlat(candSeg, otherSeg, hit);
    if (hit.d >= rr) continue;

    // cheap lower bound on the contact height: the crossing point, plus
    // points along the piece (tilted logs touch away from the crossing)
    let lo = liftFor(hit, hit.selfY, rr, position.y);
    for (let k = 0; k < SAMPLES; k++) {
      const u = k / (SAMPLES - 1);
      const px = candSeg.ax + (candSeg.bx - candSeg.ax) * u;
      const pz = candSeg.az + (candSeg.bz - candSeg.az) * u;
      const selfY = candSeg.ay + (candSeg.by - candSeg.ay) * u;
      pointSegFlat(px, pz, otherSeg, hit);
      lo = Math.max(lo, liftFor(hit, selfY, rr, position.y));
    }
    // lo only ever under-estimates, so it cannot be compared against best
    // before refining
    best = Math.max(best, exactContactY(lo, offA, offB, rr));
  }
  return best;
}

const trialSeg = emptySeg();

/** distance from the candidate — centre at y — to otherSeg */
function candDistAt(y: number, offA: number, offB: number): number {
  trialSeg.ax = candSeg.ax;
  trialSeg.az = candSeg.az;
  trialSeg.bx = candSeg.bx;
  trialSeg.bz = candSeg.bz;
  trialSeg.ay = y + offA;
  trialSeg.by = y + offB;
  return segDist(trialSeg, otherSeg);
}

/**
 * Refine the sampled lower bound into the height where the two capsules
 * actually touch. `lo` never over-estimates, so we only ever search upward.
 */
function exactContactY(
  lo: number,
  offA: number,
  offB: number,
  rr: number
): number {
  const tol = 1e-4;
  if (candDistAt(lo, offA, offB) >= rr - tol) return lo;
  // grow the bracket until the piece is clear; give up rather than return a
  // height that was never actually verified
  let hi = lo + 0.02;
  let clear = false;
  for (let i = 0; i < 10; i++) {
    if (candDistAt(hi, offA, offB) >= rr) {
      clear = true;
      break;
    }
    hi = lo + (hi - lo) * 2;
  }
  if (!clear) return hi;
  for (let i = 0; i < 14; i++) {
    const mid = (lo + hi) / 2;
    if (candDistAt(mid, offA, offB) < rr) lo = mid;
    else hi = mid;
  }
  return hi;
}

function liftFor(
  h: FlatHit,
  selfY: number,
  rr: number,
  centreY: number
): number {
  if (h.d >= rr) return -Infinity;
  // vertical gap that leaves the capsules just touching
  const clear = Math.sqrt(rr * rr - h.d * h.d);
  return h.otherY + clear - (selfY - centreY);
}
