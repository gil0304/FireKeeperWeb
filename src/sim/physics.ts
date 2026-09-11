import type RAPIER from "@dimforge/rapier3d-compat";
import * as THREE from "three";
import { FIRE_AREA_RADIUS, WOOD_PROPS } from "../constants";
import type { Vec3, WoodObject, WoodType } from "../types";

/**
 * Rigid-body layer. Physics owns each wood's position and rotation; the
 * burning simulation and the renderer just read them back off WoodObject,
 * so nothing downstream had to change.
 *
 * Loaded lazily because rapier is WebAssembly — until it is ready the game
 * falls back to the analytic resting-height placement in geometry.ts.
 */

let R: typeof RAPIER | null = null;
let world: RAPIER.World | null = null;
let loading: Promise<void> | null = null;

interface Body {
  body: RAPIER.RigidBody;
  collider: RAPIER.Collider;
  type: WoodType;
  /** collider currently sized for ash rather than a whole log */
  ashed: boolean;
}

const bodies = new Map<string, Body>();

const _q = new THREE.Quaternion();
const _e = new THREE.Euler(0, 0, 0, "XYZ");

/**
 * Split firewood is squarish in section, not a smooth cylinder, so the
 * colliders are rounded boxes along the piece's own +Y (matching the meshes).
 * A capsule would be neutrally balanced about its axis and roll forever.
 */
function boxHalf(type: WoodType): { hx: number; hy: number; round: number } {
  const p = WOOD_PROPS[type];
  const r = p.hitRadius ?? p.radius;
  const round = r * 0.3;
  return {
    hx: Math.max(r - round, 0.002),
    hy: Math.max(p.length / 2 - round, 0.004),
    round,
  };
}

function colliderDesc(type: WoodType, scale = 1): RAPIER.ColliderDesc {
  const b = boxHalf(type);
  return R!.ColliderDesc.roundCuboid(
    b.hx * scale,
    b.hy,
    b.hx * scale,
    b.round * scale
  );
}

function quatFromEuler(rot: Vec3): { x: number; y: number; z: number; w: number } {
  _e.set(rot.x, rot.y, rot.z, "XYZ");
  _q.setFromEuler(_e);
  return { x: _q.x, y: _q.y, z: _q.z, w: _q.w };
}

export function physicsReady(): boolean {
  return world !== null;
}

export async function initPhysics(): Promise<void> {
  if (world) return;
  if (!loading) {
    loading = import("@dimforge/rapier3d-compat").then(async (mod) => {
      await mod.init();
      R = mod;
      world = new mod.World({ x: 0, y: -9.81, z: 0 });
      world.timestep = 1 / 60;
      // ground
      const ground = world.createRigidBody(mod.RigidBodyDesc.fixed());
      const gc = mod.ColliderDesc.cuboid(6, 0.5, 6).setTranslation(0, -0.5, 0);
      world.createCollider(gc, ground).setFriction(1.1);
      // a shallow lip around the pit so pieces do not roll away forever
      const ringSegments = 24;
      for (let i = 0; i < ringSegments; i++) {
        const a = (i / ringSegments) * Math.PI * 2;
        const rb = world.createRigidBody(
          mod.RigidBodyDesc.fixed().setTranslation(
            Math.cos(a) * (FIRE_AREA_RADIUS + 0.1),
            0.04,
            Math.sin(a) * (FIRE_AREA_RADIUS + 0.1)
          )
        );
        world.createCollider(mod.ColliderDesc.ball(0.14), rb).setFriction(0.9);
      }
    });
  }
  return loading;
}

export function addBody(w: WoodObject): void {
  if (!world || !R) return;
  if (bodies.has(w.id)) return;
  const p = WOOD_PROPS[w.type];
  const desc = R.RigidBodyDesc.dynamic()
    .setTranslation(w.position.x, w.position.y, w.position.z)
    .setRotation(quatFromEuler(w.rotation))
    // wood in a fire pit is not bouncy and comes to rest quickly
    .setLinearDamping(0.4)
    .setAngularDamping(0.7)
    .setCcdEnabled(false);
  const body = world.createRigidBody(desc);
  const cd = colliderDesc(w.type)
    // bark on bark barely slides, which is what lets a teepee stand up
    .setFriction(1.6)
    .setFrictionCombineRule(R.CoefficientCombineRule.Max)
    .setRestitution(0)
    .setMass(p.mass);
  const collider = world.createCollider(cd, body);
  bodies.set(w.id, { body, collider, type: w.type, ashed: false });
}

export function removeBody(id: string): void {
  const b = bodies.get(id);
  if (!b || !world) return;
  world.removeRigidBody(b.body);
  bodies.delete(id);
}

export function clearBodies(): void {
  if (!world) return;
  for (const b of bodies.values()) world.removeRigidBody(b.body);
  bodies.clear();
}

/** Sync the body set to the wood list (after loads, presets, deletes). */
export function syncBodies(woods: WoodObject[]): void {
  if (!world) return;
  const live = new Set<string>();
  for (const w of woods) {
    live.add(w.id);
    if (!bodies.has(w.id)) addBody(w);
  }
  for (const id of [...bodies.keys()]) {
    if (!live.has(id)) removeBody(id);
  }
}

/** A dragged wood is moved by the pointer, not by gravity. */
export function setDragging(id: string, dragging: boolean): void {
  const b = bodies.get(id);
  if (!b || !R) return;
  b.body.setBodyType(
    dragging ? R.RigidBodyType.KinematicPositionBased : R.RigidBodyType.Dynamic,
    true
  );
  if (!dragging) {
    b.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    b.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
  }
}

export function setBodyPose(id: string, pos: Vec3, rot: Vec3): void {
  const b = bodies.get(id);
  if (!b) return;
  b.body.setTranslation({ x: pos.x, y: pos.y, z: pos.z }, true);
  b.body.setRotation(quatFromEuler(rot), true);
  b.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
  b.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
}

/** Nudge every body awake — used when the pile needs to re-evaluate itself. */
export function wakeAll(): void {
  for (const b of bodies.values()) b.body.wakeUp();
}

/**
 * A burned-out log becomes a flat bed of ash: light, low, and no longer able
 * to hold up whatever was resting on it, so the pile above settles down.
 */
export function collapseToAsh(w: WoodObject): void {
  const b = bodies.get(w.id);
  if (!b || !world || !R || b.ashed) return;
  const p = WOOD_PROPS[w.type];
  world.removeCollider(b.collider, true);
  const cd = colliderDesc(w.type, 0.3)
    .setFriction(1.2)
    .setRestitution(0)
    .setMass(p.mass * 0.12);
  b.collider = world.createCollider(cd, b.body);
  b.ashed = true;
  // ash lies down instead of standing on end
  b.body.setAngularDamping(4);
  wakeAll();
}

export interface StepResult {
  /** ids whose transform changed enough to matter this step */
  moved: number;
}

/**
 * Advance the world and write the results back into the woods.
 * `dt` is the sim step; rapier runs its own fixed sub-steps.
 */
export function stepPhysics(woods: WoodObject[], dt: number): StepResult {
  if (!world) return { moved: 0 };
  let acc = dt;
  let guard = 0;
  while (acc > 1e-4 && guard < 4) {
    world.timestep = Math.min(acc, 1 / 60);
    world.step();
    acc -= world.timestep;
    guard++;
  }

  let moved = 0;
  for (const w of woods) {
    const b = bodies.get(w.id);
    if (!b) continue;
    const t = b.body.translation();
    const r = b.body.rotation();
    if (
      Math.abs(t.x - w.position.x) > 1e-4 ||
      Math.abs(t.y - w.position.y) > 1e-4 ||
      Math.abs(t.z - w.position.z) > 1e-4
    ) {
      moved++;
    }
    w.position.x = t.x;
    w.position.y = t.y;
    w.position.z = t.z;
    _q.set(r.x, r.y, r.z, r.w);
    _e.setFromQuaternion(_q, "XYZ");
    w.rotation.x = _e.x;
    w.rotation.y = _e.y;
    w.rotation.z = _e.z;
  }
  return { moved };
}

/**
 * Where a piece would come to rest if dropped here — used for the placement
 * preview and to spawn new wood without it visibly falling through the pile.
 * Returns null when physics is not up yet, so callers fall back to geometry.
 */
export function dropHeight(
  type: WoodType,
  rotation: Vec3,
  x: number,
  z: number
): number | null {
  if (!world || !R) return null;
  const b = boxHalf(type);
  const shape = new R.RoundCuboid(b.hx, b.hy, b.hx, b.round);
  const from = { x, y: 3, z };
  const hit = world.castShape(
    from,
    quatFromEuler(rotation),
    { x: 0, y: -1, z: 0 },
    shape,
    0,
    6,
    true
  );
  if (!hit) return WOOD_PROPS[type].radius + 0.004;
  return 3 - hit.time_of_impact + 0.002;
}

/** Push pieces away from a bellows blast, as a real gust would. */
export function blowAt(pos: Vec3, strength: number): string[] {
  const scattered: string[] = [];
  if (!world) return scattered;
  for (const [id, b] of bodies) {
    const t = b.body.translation();
    const dx = t.x - pos.x;
    const dy = t.y - pos.y;
    const dz = t.z - pos.z;
    const d2 = dx * dx + dy * dy + dz * dz;
    if (d2 > 0.09) continue;
    const d = Math.sqrt(d2) || 0.02;
    const mass = WOOD_PROPS[b.type].mass;
    // only light pieces actually move
    const push = (strength * 0.02) / Math.max(mass, 0.05);
    b.body.applyImpulse(
      { x: (dx / d) * push, y: push * 0.35, z: (dz / d) * push },
      true
    );
    if (mass <= 0.25) scattered.push(id);
  }
  return scattered;
}

/** Anything that fell outside the pit or through the floor is gone. */
export function strayIds(woods: WoodObject[]): string[] {
  const out: string[] = [];
  for (const w of woods) {
    const r = Math.hypot(w.position.x, w.position.z);
    if (r > FIRE_AREA_RADIUS + 1.2 || w.position.y < -0.5) out.push(w.id);
  }
  return out;
}

export function bodyCount(): number {
  return bodies.size;
}

export function isAsleep(id: string): boolean {
  const b = bodies.get(id);
  return b ? b.body.isSleeping() : true;
}
