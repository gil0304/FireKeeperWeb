import { useMemo } from "react";
import { CAMPSITES, FIRE_AREA_RADIUS } from "../constants";
import { useFireStore } from "../store";

interface Stone {
  pos: [number, number, number];
  rot: [number, number, number];
  scale: [number, number, number];
  color: string;
}

const STONE_COUNT = 10;
const STONE_SHADES = ["#5c5b58", "#6a6763", "#4e4d4b", "#63615c"];

// deterministic pseudo-random so stones don't jump between mounts
function pr(i: number, k: number): number {
  const v = Math.sin(i * 127.1 + k * 311.7) * 43758.5453;
  return v - Math.floor(v);
}

export function Ground() {
  const campsite = useFireStore((s) => s.campsite);
  const groundColor =
    CAMPSITES.find((c) => c.id === campsite)?.groundColor ?? "#3d4a2e";

  const stones = useMemo<Stone[]>(
    () =>
      Array.from({ length: STONE_COUNT }, (_, i) => {
        const a = (i / STONE_COUNT) * Math.PI * 2 + pr(i, 1) * 0.35;
        const r = 0.53 + pr(i, 2) * 0.06;
        const s = 0.05 + pr(i, 3) * 0.03;
        return {
          pos: [Math.cos(a) * r, s * 0.55, Math.sin(a) * r],
          rot: [pr(i, 4) * Math.PI, pr(i, 5) * Math.PI, pr(i, 6) * Math.PI],
          scale: [s * (0.9 + pr(i, 7) * 0.5), s * 0.75, s * (0.9 + pr(i, 8) * 0.5)],
          color: STONE_SHADES[i % STONE_SHADES.length],
        };
      }),
    []
  );

  return (
    <group>
      {/* ground disc */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]}>
        <circleGeometry args={[14, 48]} />
        <meshStandardMaterial color={groundColor} roughness={0.96} metalness={0} />
      </mesh>
      {/* scorched fire-pit dirt */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.002, 0]}>
        <circleGeometry args={[0.5, 32]} />
        <meshStandardMaterial color="#211a14" roughness={1} metalness={0} />
      </mesh>
      {/* stone ring */}
      {stones.map((s, i) => (
        <mesh key={i} position={s.pos} rotation={s.rot} scale={s.scale}>
          <dodecahedronGeometry args={[1, 0]} />
          <meshStandardMaterial color={s.color} roughness={0.9} metalness={0.05} />
        </mesh>
      ))}
      {/* faint placement boundary */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.006, 0]}>
        <ringGeometry args={[FIRE_AREA_RADIUS - 0.012, FIRE_AREA_RADIUS + 0.012, 72]} />
        <meshBasicMaterial
          color="#8fa3c8"
          transparent
          opacity={0.13}
          depthWrite={false}
        />
      </mesh>
    </group>
  );
}
