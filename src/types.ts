export type WoodType =
  | "tinder"
  | "leaves"
  | "twig"
  | "thin"
  | "normal"
  | "thick"
  | "wet";

export type WoodState =
  | "idle"
  | "heating"
  | "ignited"
  | "burning"
  | "charred"
  | "burned";

export type Tool = WoodType | "lighter" | "bellows" | null;

export type CameraMode = "orbit" | "fixed" | "close" | "cinema";
export type GameMode = "free" | "challenge" | "watch";
export type Screen = "title" | "play" | "result";
export type Quality = "low" | "mid" | "high";

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface WoodObject {
  id: string;
  type: WoodType;
  state: WoodState;
  position: Vec3;
  rotation: Vec3;
  temperature: number;
  fuel: number;
  moisture: number;
  ignition: number;
  oxygen: number;
  output: number;
}

export interface EnvState {
  windDir: number;
  windSpeed: number;
  baseWind: number;
  groundMoisture: number;
  time: number;
}

export interface Metrics {
  firePower: number;
  temperature: number;
  oxygen: number;
  smoke: number;
  fuel: number;
}

export interface Puff {
  x: number;
  y: number;
  z: number;
  t: number;
}

export interface RunStats {
  time: number;
  ignitedAt: number | null;
  woodsUsed: number;
  maxPower: number;
  powerSum: number;
  powerSamples: number;
  dips: number;
  wasAlive: boolean;
  smokeSum: number;
  aliveTime: number;
  peakSmoke: number;
}

export interface ScoreBreakdown {
  ignitionSpeed: number;
  stability: number;
  lowSmoke: number;
  woodEconomy: number;
  maxPower: number;
  upTime: number;
  total: number;
  title: string;
}

export interface CampsiteDef {
  id: string;
  icon: string;
  label: string;
  groundMoisture: number;
  baseWind: number;
  groundColor: string;
}

export interface ChallengeDef {
  id: string;
  icon: string;
  label: string;
  timeLimit: number;
  baseWind: number;
  groundMoisture: number;
  /** target power to reach (goal challenges) */
  targetPower?: number;
  /** seconds the fire must be held (endurance challenges) */
  holdTarget?: number;
  maxWoods?: number;
}

export interface ChallengeProgress {
  status: "ongoing" | "success" | "fail";
  progress: number;
  remaining: number;
}

export interface SaveData {
  woods: WoodObject[];
  env: EnvState;
  campsite: string;
  highScores: Record<string, number>;
  cleared: string[];
  volume: number;
  quality: Quality;
}
