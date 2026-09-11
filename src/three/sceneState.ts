import * as THREE from "three";
import { useFireStore } from "../store";

// Mutable cross-component scene state (not React state — read per frame).
export const sceneState = {
  /** true while a wood is being dragged — CameraRig disables OrbitControls */
  draggingWood: false,
  /** active wood drag bookkeeping (single pointer) */
  drag: {
    id: null as string | null,
    moved: false,
    planeY: 0,
    startX: 0,
    startZ: 0,
    /** where the piece's centre sits relative to the point that was grabbed */
    grabOffsetX: 0,
    grabOffsetZ: 0,
  },
  /** transient lighter flare shown at the click point */
  lighter: {
    pos: new THREE.Vector3(),
    t: 0,
  },
  /** live OrbitControls instance, so drags can suppress it on pointerdown */
  controls: null as { enabled: boolean } | null,
};

export function beginWoodDrag(
  id: string,
  planeY: number,
  x: number,
  z: number,
  grabX: number,
  grabZ: number
): void {
  sceneState.drag.id = id;
  sceneState.drag.moved = false;
  sceneState.drag.planeY = planeY;
  sceneState.drag.startX = grabX;
  sceneState.drag.startZ = grabZ;
  // grabbing a log near one end must not snap its centre to the cursor
  sceneState.drag.grabOffsetX = x - grabX;
  sceneState.drag.grabOffsetZ = z - grabZ;
  sceneState.draggingWood = true;
  // disable now, not next frame: OrbitControls has already seen this pointerdown
  if (sceneState.controls) sceneState.controls.enabled = false;
}

export function endWoodDrag(): void {
  const id = sceneState.drag.id;
  sceneState.drag.id = null;
  sceneState.drag.moved = false;
  sceneState.draggingWood = false;
  // hand the piece back to gravity wherever the player let go
  if (id) useFireStore.getState().setDragging(id, false);
}
