import { useFrame, type ThreeEvent } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { WOOD_PROPS } from "../constants";
import { woodAxis } from "../sim/geometry";
import { useFireStore } from "../store";
import type { WoodObject, WoodType } from "../types";
import { beginWoodDrag, endWoodDrag, sceneState } from "./sceneState";
import { flicker, hashStr } from "./utils";

type WoodKind = "log" | "tinder" | "leaves";

interface WoodVisual {
  group: THREE.Group;
  mats: THREE.MeshStandardMaterial[];
  phase: number;
  base: THREE.Color;
  kind: WoodKind;
}

/** The ash mound left behind by a burned wood — a ground-level sibling of
 *  the log meshes, so it never inherits the log's roll. */
interface AshVisual {
  mesh: THREE.Mesh;
  mat: THREE.MeshStandardMaterial;
  /** 0 → 1 grow-in, mirrors the log's collapse */
  grow: number;
  phase: number;
}

const dragPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const tmpHit = new THREE.Vector3();
const tmpAxis = new THREE.Vector3();
const tmpColor = new THREE.Color();
const EMBER = new THREE.Color("#ff3c08");
const GLOW = new THREE.Color("#ff7722");
const ASH = new THREE.Color("#8d867c");
const ASH_PALE = new THREE.Color("#9a938a");
const CHAR = new THREE.Color("#151210");
const SELECT = new THREE.Color("#4d8fe0");

/** one crumbly blob shared by every ash mound; unit diameter so the mesh
 *  scale reads directly as the mound's full size */
const ASH_GEO = new THREE.IcosahedronGeometry(0.5, 1);
function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function updateWoodVisual(
  w: WoodObject,
  v: WoodVisual,
  t: number,
  selected: boolean,
  k: number
): void {
  const g = v.group;
  g.position.set(w.position.x, w.position.y, w.position.z);
  g.rotation.set(w.rotation.x, w.rotation.y, w.rotation.z);

  // burned collapse: the piece crumbles away over ~a second while the ash
  // mound grows in underneath it. Light stuff (tinder/leaves) goes faster.
  // The ash mound takes over picking, so the log can vanish completely.
  const burned = w.state === "burned";
  const target = burned ? 0 : 1;
  const rate = burned && v.kind !== "log" ? Math.min(1, k * 1.6) : k;
  g.scale.x += (target - g.scale.x) * rate;
  g.scale.y += (target - g.scale.y) * rate;
  g.scale.z += (target - g.scale.z) * rate;
  g.visible = g.scale.y > 0.02;

  // emissive glow
  let e = 0;
  if (w.temperature > 250) e = Math.min(0.45, (w.temperature - 250) / 900);
  if (w.state === "ignited") {
    e = 0.55 + flicker(t * 1.8, v.phase) * 0.18;
  } else if (w.state === "burning") {
    e = 0.95 + flicker(t * 1.5, v.phase) * 0.3;
  } else if (w.state === "charred") {
    // ember pulse
    const pulse = 0.5 + 0.5 * Math.sin(t * 2.2 + v.phase * 2.7);
    const glow = w.temperature > 200 ? 1 : w.temperature > 120 ? 0.45 : 0.12;
    e = (0.25 + pulse * 0.45 + flicker(t * 3.1, v.phase) * 0.1) * glow;
  } else if (burned) {
    e = 0;
  }

  // body color: char toward black, ash when burned
  if (burned) {
    tmpColor.copy(ASH);
  } else {
    tmpColor.copy(v.base);
    const char =
      w.state === "charred"
        ? 0.85
        : w.state === "burning"
          ? Math.min(0.6, (1 - w.fuel) * 0.8)
          : 0;
    if (char > 0) tmpColor.lerp(CHAR, char);
  }

  for (const m of v.mats) {
    m.color.copy(tmpColor);
    m.emissive.copy(w.state === "charred" ? EMBER : GLOW);
    m.emissiveIntensity = Math.max(0, e);
    if (selected) {
      m.emissive.lerp(SELECT, 0.55);
      m.emissiveIntensity = Math.max(m.emissiveIntensity, 0.35);
    }
  }
}

/**
 * Ash mound: sits where the piece actually is — which may be part way up the
 * pile, not on the ground — elongated along whichever way it was lying and
 * rotated about Y only. Fed the same smoothing factor as the log so the
 * collapse and the grow-in stay in lockstep.
 */
function updateAshVisual(w: WoodObject, a: AshVisual, t: number, k: number): void {
  const goal = w.state === "burned" ? 1 : 0;
  a.grow += (goal - a.grow) * k;
  const mesh = a.mesh;
  if (a.grow < 0.004) {
    mesh.visible = false;
    return;
  }
  mesh.visible = true;

  const p = WOOD_PROPS[w.type];
  const axis = woodAxis(w.rotation, tmpAxis);
  // 1 for a log lying flat, 0 for one standing on end
  const horiz = clamp01(Math.hypot(axis.x, axis.z));
  // a lying piece leaves a streak, an upright one a round heap — ash spreads
  // out and settles low, so it stays wider than the log but very shallow
  const round = p.radius * 2.1;
  const long = round + (p.length * 0.5 - round) * horiz;
  // thicker wood leaves a slightly deeper bed
  const tall = 0.008 + Math.min(0.007, p.radius * 0.1);

  const g = a.grow;
  const h = tall * g;
  mesh.scale.set(round * g, h, long * g);
  // ash left by a log resting up on the pile stays up there — sit the mound
  // just under the piece's own centre, floored just clear of the ground
  mesh.position.set(
    w.position.x,
    Math.max(w.position.y - p.radius + h * 0.5, h * 0.5 + 0.003),
    w.position.z
  );
  // yaw only: the mound must stay flat whatever the log's roll was
  mesh.rotation.y = Math.atan2(axis.x, axis.z);

  // residual embers, fading as the sim cools the ash back toward ambient
  const heat = clamp01((w.temperature - 20) / 200);
  const mat = a.mat;
  mat.color.copy(ASH_PALE);
  if (heat > 0) {
    mat.color.lerp(EMBER, heat * 0.18);
    mat.emissiveIntensity =
      heat * heat * 0.85 * g * (0.8 + flicker(t * 2.2, a.phase) * 0.2);
  } else {
    mat.emissiveIntensity = 0;
  }
}

interface AshMeshProps {
  id: string;
  refs: Map<string, AshVisual>;
}

function AshMesh({ id, refs }: AshMeshProps) {
  const meshRef = useRef<THREE.Mesh>(null);

  useEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    mesh.scale.setScalar(0);
    mesh.visible = false;
    refs.set(id, {
      mesh,
      mat: mesh.material as THREE.MeshStandardMaterial,
      grow: 0,
      phase: hashStr(id) + 3.7,
    });
    return () => {
      refs.delete(id);
    };
  }, [id, refs]);

  // the burned log itself is a sliver by now, so the mound is what the player
  // clicks to select (and then delete) the ash — but only in select mode, so
  // placing a new wood on top of ash still works
  const onPointerDown = (e: ThreeEvent<PointerEvent>) => {
    const st = useFireStore.getState();
    if (st.screen !== "play" || st.tool !== null || e.button !== 0) return;
    e.stopPropagation();
    st.selectWood(id);
  };

  const onClick = (e: ThreeEvent<MouseEvent>) => {
    if (useFireStore.getState().tool === null) e.stopPropagation();
  };

  return (
    <mesh
      ref={meshRef}
      geometry={ASH_GEO}
      scale={0}
      visible={false}
      onPointerDown={onPointerDown}
      onClick={onClick}
    >
      <meshStandardMaterial
        color="#9a938a"
        emissive="#ff3c08"
        emissiveIntensity={0}
        roughness={1}
        metalness={0}
      />
    </mesh>
  );
}

interface WoodMeshProps {
  id: string;
  type: WoodType;
  refs: Map<string, WoodVisual>;
}

function WoodMesh({ id, type, refs }: WoodMeshProps) {
  const groupRef = useRef<THREE.Group>(null);
  const p = WOOD_PROPS[type];

  useEffect(() => {
    const group = groupRef.current;
    if (!group) return;
    const mats: THREE.MeshStandardMaterial[] = [];
    group.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh) mats.push(mesh.material as THREE.MeshStandardMaterial);
    });
    const w = useFireStore.getState().woods.find((x) => x.id === id);
    if (w) {
      group.position.set(w.position.x, w.position.y, w.position.z);
      group.rotation.set(w.rotation.x, w.rotation.y, w.rotation.z);
    }
    refs.set(id, {
      group,
      mats,
      phase: hashStr(id),
      base: new THREE.Color(WOOD_PROPS[type].color),
      kind: type === "tinder" ? "tinder" : type === "leaves" ? "leaves" : "log",
    });
    return () => {
      refs.delete(id);
    };
  }, [id, type, refs]);

  const onPointerDown = (e: ThreeEvent<PointerEvent>) => {
    const st = useFireStore.getState();
    if (st.screen !== "play") return;
    if (st.mode === "watch") return; // 鑑賞モードでは触らせない
    if (e.button !== 0) return; // right/middle click is not a drag
    const tool = st.tool;
    if (tool === null) {
      e.stopPropagation();
      const w = st.woods.find((x) => x.id === id);
      if (!w) return;
      beginWoodDrag(
        id,
        w.position.y,
        w.position.x,
        w.position.z,
        e.point.x,
        e.point.z
      );
      st.setDragging(id, true); // held by the pointer, not by gravity
      st.selectWood(id);
      (e.target as Element).setPointerCapture?.(e.pointerId);
    } else if (tool === "lighter") {
      e.stopPropagation();
      if (st.paused) return;
      st.useLighter(id);
      sceneState.lighter.pos.copy(e.point);
      sceneState.lighter.t = 0.5;
    }
    // wood-type / bellows tools: let the event reach the ground plane
  };

  const onPointerMove = (e: ThreeEvent<PointerEvent>) => {
    if (sceneState.drag.id !== id) return;
    const st = useFireStore.getState();
    dragPlane.constant = -sceneState.drag.planeY;
    if (!e.ray.intersectPlane(dragPlane, tmpHit)) return;
    if (!sceneState.drag.moved) {
      const dx = tmpHit.x - sceneState.drag.startX;
      const dz = tmpHit.z - sceneState.drag.startZ;
      if (dx * dx + dz * dz < 0.0003) return; // click jitter tolerance
      sceneState.drag.moved = true;
    }
    st.moveWood(id, {
      x: tmpHit.x + sceneState.drag.grabOffsetX,
      y: sceneState.drag.planeY,
      z: tmpHit.z + sceneState.drag.grabOffsetZ,
    });
  };

  const onPointerUp = (e: ThreeEvent<PointerEvent>) => {
    if (sceneState.drag.id !== id) return;
    e.stopPropagation();
    (e.target as Element).releasePointerCapture?.(e.pointerId);
    endWoodDrag();
  };

  const onClick = (e: ThreeEvent<MouseEvent>) => {
    const tool = useFireStore.getState().tool;
    // selection/lighter clicks must not fall through to the ground plane
    if (tool === null || tool === "lighter") e.stopPropagation();
  };

  // pose it correctly on the very first render — the effect below runs a
  // frame later, and until then the piece would flash at the world origin
  const initial = useFireStore.getState().woods.find((x) => x.id === id);

  return (
    <group
      ref={groupRef}
      position={
        initial ? [initial.position.x, initial.position.y, initial.position.z] : undefined
      }
      rotation={
        initial ? [initial.rotation.x, initial.rotation.y, initial.rotation.z] : undefined
      }
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onClick={onClick}
    >
      {type === "tinder" ? (
        <>
          <mesh>
            <boxGeometry args={[p.length * 1.5, p.radius * 1.5, p.length * 1.1]} />
            <meshStandardMaterial color={p.color} roughness={0.95} />
          </mesh>
          <mesh rotation={[0.3, 0.9, 0.18]} position={[0.012, 0.014, -0.008]}>
            <boxGeometry args={[p.length * 1.1, p.radius * 1.2, p.length * 0.85]} />
            <meshStandardMaterial color={p.color} roughness={0.95} />
          </mesh>
        </>
      ) : type === "leaves" ? (
        <>
          <mesh rotation={[-Math.PI / 2 + 0.15, 0, 0.3]}>
            <circleGeometry args={[p.radius, 8]} />
            <meshStandardMaterial color={p.color} roughness={0.95} side={THREE.DoubleSide} />
          </mesh>
          <mesh rotation={[-Math.PI / 2 - 0.12, 0.4, 0]} position={[0.02, 0.006, 0.015]}>
            <circleGeometry args={[p.radius * 0.85, 8]} />
            <meshStandardMaterial color={p.color} roughness={0.95} side={THREE.DoubleSide} />
          </mesh>
          <mesh rotation={[-Math.PI / 2 + 0.08, -0.5, 0.1]} position={[-0.02, 0.011, -0.012]}>
            <circleGeometry args={[p.radius * 0.75, 8]} />
            <meshStandardMaterial color={p.color} roughness={0.95} side={THREE.DoubleSide} />
          </mesh>
        </>
      ) : (
        <mesh>
          <cylinderGeometry args={[p.radius, p.radius * 0.92, p.length, 8]} />
          <meshStandardMaterial
            color={p.color}
            roughness={type === "wet" ? 0.45 : 0.9}
            metalness={type === "wet" ? 0.12 : 0}
          />
        </mesh>
      )}
    </group>
  );
}

export function Woods() {
  const version = useFireStore((s) => s.structureVersion);
  const refs = useRef(new Map<string, WoodVisual>());
  const ashRefs = useRef(new Map<string, AshVisual>());
  const ringRef = useRef<THREE.Mesh>(null);

  const list = useMemo(() => {
    void version; // structureVersion bump is the rebuild trigger
    return useFireStore.getState().woods.map((w) => ({ id: w.id, type: w.type }));
  }, [version]);

  useFrame((state, delta) => {
    const st = useFireStore.getState();
    const t = state.clock.elapsedTime;
    // frame-rate independent smoothing
    const k = 1 - Math.exp(-Math.min(delta, 0.1) * 3);
    let sel: WoodObject | null = null;
    for (const w of st.woods) {
      const a = ashRefs.current.get(w.id);
      if (a) updateAshVisual(w, a, t, k);
      const v = refs.current.get(w.id);
      if (!v) continue;
      const isSel = w.id === st.selectedId;
      if (isSel) sel = w;
      updateWoodVisual(w, v, t, isSel, k);
    }
    const ring = ringRef.current;
    if (ring) {
      ring.visible = sel !== null;
      if (sel) ring.position.set(sel.position.x, 0.01, sel.position.z);
    }
  });

  return (
    <group>
      {list.map((w) => (
        <WoodMesh key={w.id} id={w.id} type={w.type} refs={refs.current} />
      ))}
      {/* ash mounds: siblings of the logs, so the log's roll never tips them.
          Keyed apart from the logs — the two lists share this parent. */}
      {list.map((w) => (
        <AshMesh key={`ash-${w.id}`} id={w.id} refs={ashRefs.current} />
      ))}
      {/* selection ring on the ground */}
      <mesh ref={ringRef} rotation={[-Math.PI / 2, 0, 0]} visible={false}>
        <ringGeometry args={[0.12, 0.15, 32]} />
        <meshBasicMaterial
          color="#4d8fe0"
          transparent
          opacity={0.5}
          depthWrite={false}
        />
      </mesh>
    </group>
  );
}
