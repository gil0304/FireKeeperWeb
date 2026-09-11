import type { CampsiteDef, ChallengeDef, Vec3, WoodType } from "./types";

export interface WoodProps {
  icon: string;
  ignitability: number;
  burnTime: number;
  heat: number;
  ignTemp: number;
  moisture: number;
  radius: number;
  /** collision radius, when the mesh is not a cylinder of `radius` */
  hitRadius?: number;
  length: number;
  color: string;
  mass: number;
}

export const WOOD_PROPS: Record<WoodType, WoodProps> = {
  tinder: {
    icon: "🔥",
    ignitability: 100,
    burnTime: 8,
    heat: 20,
    ignTemp: 80,
    moisture: 0.02,
    radius: 0.05,
    hitRadius: 0.038, // it is a flat wad, not a ball
    length: 0.09,
    color: "#d9c9a3",
    mass: 0.1,
  },
  leaves: {
    icon: "🍂",
    ignitability: 95,
    burnTime: 5,
    heat: 15,
    ignTemp: 100,
    moisture: 0.08,
    radius: 0.07,
    hitRadius: 0.02, // a few overlapping leaves, barely any thickness
    length: 0.05,
    color: "#a0722e",
    mass: 0.05,
  },
  twig: {
    icon: "🌿",
    ignitability: 85,
    burnTime: 20,
    heat: 35,
    // 仕様の「必要温度: 低い」。着火剤が燃えている 8 秒のあいだに確実に
    // 火が移る必要があるので、着火剤の到達温度に対して余裕を持たせる
    ignTemp: 110,
    moisture: 0.1,
    radius: 0.013,
    length: 0.34,
    color: "#8a6a48",
    mass: 0.2,
  },
  thin: {
    icon: "🥢",
    ignitability: 65,
    burnTime: 50,
    heat: 55,
    ignTemp: 240,
    moisture: 0.12,
    radius: 0.028,
    length: 0.46,
    color: "#96703f",
    mass: 0.5,
  },
  normal: {
    icon: "🪵",
    ignitability: 40,
    burnTime: 100,
    heat: 80,
    ignTemp: 330,
    moisture: 0.14,
    radius: 0.048,
    length: 0.55,
    color: "#7d5732",
    mass: 1.2,
  },
  thick: {
    icon: "🪵",
    ignitability: 20,
    burnTime: 180,
    heat: 100,
    ignTemp: 430,
    moisture: 0.15,
    radius: 0.075,
    length: 0.6,
    color: "#6b4726",
    mass: 2.5,
  },
  wet: {
    icon: "💧",
    ignitability: 25,
    burnTime: 110,
    heat: 70,
    ignTemp: 360,
    moisture: 0.85,
    radius: 0.048,
    length: 0.55,
    color: "#4e3d2c",
    mass: 1.5,
  },
};

export const PALETTE_ORDER: WoodType[] = [
  "tinder",
  "leaves",
  "twig",
  "thin",
  "normal",
  "thick",
  "wet",
];

export const CAMPSITES: CampsiteDef[] = [
  {
    id: "forest",
    icon: "🌲",
    label: "森",
    groundMoisture: 0.3,
    baseWind: 1.2,
    groundColor: "#3d4a2e",
  },
  {
    id: "river",
    icon: "🏞️",
    label: "河原",
    groundMoisture: 0.5,
    baseWind: 2.2,
    groundColor: "#5a5a52",
  },
  {
    id: "highland",
    icon: "⛰️",
    label: "高原",
    groundMoisture: 0.15,
    baseWind: 3.5,
    groundColor: "#6e6242",
  },
];

export const CHALLENGES: ChallengeDef[] = [
  {
    id: "sprint",
    icon: "⚡",
    label: "60秒で火力80",
    timeLimit: 60,
    baseWind: 1.5,
    groundMoisture: 0.2,
    targetPower: 80,
  },
  {
    id: "wet",
    icon: "💧",
    label: "湿った薪で90秒",
    timeLimit: 210,
    baseWind: 1.2,
    groundMoisture: 0.4,
    holdTarget: 90,
  },
  {
    id: "storm",
    icon: "🌪️",
    label: "強風で3分維持",
    timeLimit: 260,
    baseWind: 6.5,
    groundMoisture: 0.2,
    holdTarget: 180,
  },
  {
    id: "minimal",
    icon: "🎯",
    label: "薪8本で火力60",
    timeLimit: 120,
    baseWind: 1.5,
    groundMoisture: 0.2,
    targetPower: 60,
    maxWoods: 8,
  },
  {
    id: "clean",
    icon: "🌫️",
    label: "煙を抑えて2分",
    timeLimit: 175,
    baseWind: 1.8,
    groundMoisture: 0.25,
    holdTarget: 120,
  },
];

/** fire power that counts as "維持できている" for endurance challenges */
export const HOLD_POWER = 15;
/** smoke ceiling for the clean-burn challenge */
export const SMOKE_LIMIT = 45;

export const TITLES: [number, string][] = [
  [90, "伝説の火守り"],
  [75, "キャンプマスター"],
  [60, "炎の管理人"],
  [40, "焚き火見習い"],
  [0, "はじめての火守り"],
];

export interface PresetPiece {
  type: WoodType;
  position: Vec3;
  rotation: Vec3;
}

const HPI = Math.PI / 2;

function lay(
  type: WoodType,
  x: number,
  y: number,
  z: number,
  yaw: number,
  tilt = 0
): PresetPiece {
  return {
    type,
    position: { x, y, z },
    rotation: { x: tilt, y: yaw, z: HPI },
  };
}

export interface PresetDef {
  icon: string;
  label: string;
  pieces: PresetPiece[];
  /**
   * True when the pieces only hold together as a finished structure and must
   * be created in the exact pose given (a teepee). Otherwise each piece is
   * dropped onto the pile in order, the way it would really be laid.
   */
  interlocking?: boolean;
}

export const PRESETS: Record<string, PresetDef> = {
  igeta: {
    icon: "🏗️",
    label: "井桁",
    pieces: [
      { type: "tinder", position: { x: 0, y: 0.05, z: 0 }, rotation: { x: 0, y: 0, z: 0 } },
      // kindling laid straight across the tinder, so the fire always has
      // something to catch on when the tinder burns out after 8 seconds
      lay("twig", 0, 0.12, 0, 0.3),
      lay("twig", 0.01, 0.14, 0.01, 1.2),
      lay("twig", -0.01, 0.16, 0.02, 2.2),
      lay("thin", 0, 0.03, 0.16, 0),
      lay("thin", 0, 0.03, -0.16, 0),
      lay("normal", 0.16, 0.1, 0, HPI),
      lay("normal", -0.16, 0.1, 0, HPI),
      lay("normal", 0, 0.2, 0.16, 0),
      lay("normal", 0, 0.2, -0.16, 0),
    ],
  },
  teepee: {
    icon: "⛺",
    label: "ティピー",
    interlocking: true,
    pieces: [
      { type: "tinder", position: { x: 0, y: 0.045, z: 0 }, rotation: { x: 0, y: 0, z: 0 } },
      { type: "leaves", position: { x: 0.04, y: 0.055, z: 0.03 }, rotation: { x: 0, y: 0.6, z: 0 } },
      // Kindling laid out over the tinder like the spokes of a wheel. The
      // poles' feet stand well clear of the middle, so without this bridge
      // the fire in the centre never reaches the standing wood.
      ...[0, 1, 2].map((i) => {
        const a = (i / 3) * Math.PI * 2 + 0.4;
        const tiltZ = HPI - 0.35;
        const r = (WOOD_PROPS.twig.length / 2) * Math.sin(tiltZ) * 0.6;
        return {
          type: "twig" as WoodType,
          position: { x: Math.cos(a) * r, y: 0.075, z: Math.sin(a) * r },
          rotation: { x: 0, y: -a, z: tiltZ },
        };
      }),
      // Four poles leaning in on a radial yaw (-a), with their tops crossing
      // past the middle so opposite pairs brace each other. Under gravity a
      // three- or five-pole ring shoves itself apart; four interlocks.
      ...[0, 1, 2, 3].map((i) => {
        const a = (i / 4) * Math.PI * 2;
        const tiltZ = 0.58;
        const type = (i % 2 === 0 ? "thin" : "twig") as WoodType;
        const p = WOOD_PROPS[type];
        const half = p.length / 2;
        const r = half * Math.sin(tiltZ) * 1.15;
        return {
          type,
          // the foot rests on the ground, the top leans over the centre
          position: {
            x: Math.cos(a) * r,
            y: p.radius + Math.cos(tiltZ) * half,
            z: Math.sin(a) * r,
          },
          rotation: { x: 0, y: -a, z: tiltZ },
        };
      }),
    ],
  },
  parallel: {
    icon: "🛤️",
    label: "並列",
    // a raft of logs on the ground with the fire built on top and a couple
    // laid across it — every piece rests on something broad, so it holds
    pieces: [
      lay("normal", 0, 0.05, 0.11, 0),
      lay("normal", 0, 0.05, -0.11, 0),
      { type: "tinder", position: { x: 0, y: 0.14, z: 0 }, rotation: { x: 0, y: 0, z: 0 } },
      lay("twig", 0.02, 0.2, 0.01, 0.25),
      lay("twig", -0.03, 0.2, -0.02, -0.25),
      lay("thin", 0.05, 0.26, 0, HPI),
      lay("normal", -0.06, 0.3, 0, HPI),
    ],
  },
};

export const SIM_DT = 1 / 30;
export const FIRE_AREA_RADIUS = 1.4;
