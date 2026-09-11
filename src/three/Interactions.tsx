import { useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import * as THREE from "three";
import { FIRE_AREA_RADIUS, WOOD_PROPS } from "../constants";
import { useFireStore } from "../store";
import type { Tool, Vec3, WoodType } from "../types";
import { endWoodDrag } from "./sceneState";

function isWoodType(t: Tool): t is WoodType {
  return t !== null && t !== "lighter" && t !== "bellows";
}

const GHOST_OK = new THREE.Color("#9fb47a");
const GHOST_NG = new THREE.Color("#d8524a");
const ghostPos: Vec3 = { x: 0, y: 0, z: 0 };

export function Interactions() {
  const tool = useFireStore((s) => s.tool);
  const gl = useThree((s) => s.gl);

  const ghostRef = useRef<THREE.Group>(null);
  const ghostMatRef = useRef<THREE.MeshStandardMaterial>(null);
  const hover = useRef({ x: 0, z: 0, seen: false });

  // wheel turns the piece: the selected one, or the one about to be placed
  // (Shift = tilt it up instead of turning it)
  useEffect(() => {
    const el = gl.domElement;
    const onWheel = (e: WheelEvent) => {
      const st = useFireStore.getState();
      if (st.screen !== "play" || st.mode === "watch") return;
      const raw = e.deltaY !== 0 ? e.deltaY : e.deltaX; // shift swaps axes on mac
      // Firefox reports lines (1) or pages (2) instead of pixels (0)
      const scale = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
      const d = raw * scale;
      if (isWoodType(st.tool)) {
        if (e.shiftKey) st.adjustPlaceRotation(0, -d * 0.004);
        else st.adjustPlaceRotation(d * 0.005, 0);
      } else if (st.tool === null && st.selectedId) {
        st.rotateWood(st.selectedId, d * 0.005, e.shiftKey);
      }
    };
    el.addEventListener("wheel", onWheel, { passive: true });
    return () => el.removeEventListener("wheel", onWheel);
  }, [gl]);

  // forget the last hover point when the tool changes or the pointer leaves,
  // so the ghost never reappears at a stale spot
  useEffect(() => {
    hover.current.seen = false;
  }, [tool]);

  useEffect(() => {
    const el = gl.domElement;
    const forget = () => {
      hover.current.seen = false;
    };
    el.addEventListener("pointerleave", forget);
    return () => el.removeEventListener("pointerleave", forget);
  }, [gl]);

  // safety net: never leave a drag stuck if pointerup lands outside the canvas
  useEffect(() => {
    const clear = () => endWoodDrag();
    window.addEventListener("pointerup", clear);
    window.addEventListener("pointercancel", clear);
    return () => {
      window.removeEventListener("pointerup", clear);
      window.removeEventListener("pointercancel", clear);
    };
  }, []);

  // tool cursor
  useEffect(() => {
    const el = gl.domElement;
    el.style.cursor =
      tool === "lighter"
        ? "crosshair"
        : tool === "bellows"
          ? "pointer"
          : tool !== null
            ? "copy"
            : "default";
    return () => {
      el.style.cursor = "default";
    };
  }, [tool, gl]);

  const onPointerMove = (e: ThreeEvent<PointerEvent>) => {
    hover.current.x = e.point.x;
    hover.current.z = e.point.z;
    hover.current.seen = true;
  };

  // the ghost follows the pointer, the pending orientation, and the pile —
  // driven per frame so turning the wheel updates it without moving the mouse
  useFrame(() => {
    const g = ghostRef.current;
    if (!g) return;
    const st = useFireStore.getState();
    // no preview when the click would be refused anyway
    if (
      !isWoodType(st.tool) ||
      !hover.current.seen ||
      st.screen !== "play" ||
      st.paused
    ) {
      g.visible = false;
      return;
    }
    g.visible = true;
    ghostPos.x = hover.current.x;
    ghostPos.z = hover.current.z;
    ghostPos.y = 0;
    const rot = st.placeRotation(st.tool);
    ghostPos.y = st.dropY(st.tool, ghostPos, rot);
    g.position.set(ghostPos.x, ghostPos.y, ghostPos.z);
    g.rotation.set(rot.x, rot.y, rot.z);
    const mat = ghostMatRef.current;
    if (mat) {
      const outside = Math.hypot(ghostPos.x, ghostPos.z) > FIRE_AREA_RADIUS;
      mat.color.copy(outside ? GHOST_NG : GHOST_OK);
    }
  });

  const onClick = (e: ThreeEvent<MouseEvent>) => {
    const st = useFireStore.getState();
    if (st.screen !== "play") return;
    if (e.delta > 6) return; // it was a camera drag, not a click
    const t = st.tool;
    if (t === null) {
      st.selectWood(null);
    } else if (st.paused) {
      return; // tools are inert while paused
    } else if (t === "bellows") {
      const r = Math.hypot(e.point.x, e.point.z);
      if (r <= FIRE_AREA_RADIUS + 0.4) {
        st.useBellows({ x: e.point.x, y: 0.08, z: e.point.z });
      }
    } else if (t !== "lighter") {
      st.placeWood(t, { x: e.point.x, y: 0, z: e.point.z });
    }
  };

  const onContextMenu = (e: ThreeEvent<MouseEvent>) => {
    const st = useFireStore.getState();
    if (st.screen !== "play") return;
    e.stopPropagation();
    e.nativeEvent.preventDefault(); // right-click means "deselect" in-app
    st.selectWood(null);
  };

  const woodTool = isWoodType(tool) ? tool : null;
  const wp = woodTool ? WOOD_PROPS[woodTool] : null;

  return (
    <group>
      {/* invisible interaction plane */}
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, 0.001, 0]}
        onPointerMove={onPointerMove}
        onClick={onClick}
        onContextMenu={onContextMenu}
      >
        <circleGeometry args={[14, 24]} />
        <meshBasicMaterial visible={false} />
      </mesh>

      {/* translucent placement ghost — shows the exact pose it will land in */}
      {woodTool && wp && (
        <group ref={ghostRef} position={[0, -2, 0]}>
          <mesh raycast={() => null}>
            {woodTool === "tinder" ? (
              <boxGeometry
                args={[wp.length * 1.5, wp.radius * 1.5, wp.length * 1.1]}
              />
            ) : woodTool === "leaves" ? (
              <cylinderGeometry args={[wp.radius, wp.radius, 0.008, 12]} />
            ) : (
              <cylinderGeometry args={[wp.radius, wp.radius, wp.length, 10]} />
            )}
            <meshStandardMaterial
              ref={ghostMatRef}
              color="#9fb47a"
              transparent
              opacity={0.38}
              depthWrite={false}
              emissive="#3b4a63"
              emissiveIntensity={0.35}
            />
          </mesh>
        </group>
      )}
    </group>
  );
}
