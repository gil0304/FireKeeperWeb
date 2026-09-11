import { create } from "zustand";
import {
  CAMPSITES,
  CHALLENGES,
  FIRE_AREA_RADIUS,
  HOLD_POWER,
  PRESETS,
  WOOD_PROPS,
} from "./constants";
import { evalChallenge, computeScore, getChallenge } from "./game/challenges";
import { clearSave, loadGame, saveGame } from "./game/save";
import { restingY } from "./sim/geometry";
import {
  addBody,
  blowAt,
  clearBodies,
  collapseToAsh,
  dropHeight,
  physicsReady,
  removeBody,
  setBodyPose,
  setDragging,
  stepPhysics,
  strayIds,
  syncBodies,
  wakeAll,
} from "./sim/physics";
import { fireCentroid, igniteAt, stepSim } from "./sim/simulation";
import type {
  CameraMode,
  ChallengeProgress,
  EnvState,
  GameMode,
  Metrics,
  Puff,
  Quality,
  RunStats,
  ScoreBreakdown,
  Screen,
  Tool,
  Vec3,
  WoodObject,
  WoodType,
} from "./types";

let nextId = 1;
const genId = () => `w${nextId++}`;

/** settings + save slot as they were on page load */
const BOOT = loadGame();

/** flat pieces just lie down; logs lie along the yaw, tilted up by placeTilt */
export function placeRotationFor(
  type: WoodType,
  yaw: number,
  tilt: number
): Vec3 {
  if (type === "tinder" || type === "leaves")
    return { x: 0, y: yaw, z: 0 };
  return { x: 0, y: yaw, z: Math.PI / 2 - tilt };
}

function freshStats(): RunStats {
  return {
    time: 0,
    ignitedAt: null,
    woodsUsed: 0,
    maxPower: 0,
    powerSum: 0,
    powerSamples: 0,
    dips: 0,
    wasAlive: false,
    smokeSum: 0,
    aliveTime: 0,
    peakSmoke: 0,
  };
}

function makeWood(
  type: WoodType,
  position: Vec3,
  rotation: Vec3 = { x: 0, y: 0, z: 0 }
): WoodObject {
  const p = WOOD_PROPS[type];
  return {
    id: genId(),
    type,
    state: "idle",
    position,
    rotation,
    temperature: 20,
    fuel: 1,
    moisture: p.moisture,
    ignition: 0,
    oxygen: 1,
    output: 0,
  };
}

export interface FireStore {
  // sim data (mutated in place each tick — read via getState() in useFrame)
  woods: WoodObject[];
  env: EnvState;
  puffs: Puff[];
  metrics: Metrics;
  stats: RunStats;
  structureVersion: number; // bumps on add/remove/preset — subscribe for lists
  scatterEvent: number; // bumps when bellows scatters pieces
  lighterEvent: number; // bumps on lighter use (for sounds)
  bellowsEvent: number; // bumps on bellows puff (for sounds)
  placeEvent: number; // bumps on each wood placed (for sounds)

  // ui state
  screen: Screen;
  mode: GameMode;
  campsite: string;
  challengeId: string | null;
  challengeProgress: ChallengeProgress | null;
  holdTime: number;
  result: ScoreBreakdown | null;
  tool: Tool;
  selectedId: string | null;
  /** orientation applied to the next placed wood */
  placeYaw: number;
  placeTilt: number;
  paused: boolean;
  speed: number;
  cameraMode: CameraMode;
  quality: Quality;
  volume: number;
  hasSave: boolean;

  highScores: Record<string, number>;
  cleared: string[];

  // actions
  tick: (dt: number) => void;
  setTool: (t: Tool) => void;
  placeRotation: (type: WoodType) => Vec3;
  adjustPlaceRotation: (dYaw: number, dTilt: number) => void;
  /** height at which this piece would come to rest here */
  dropY: (type: WoodType, pos: Vec3, rot: Vec3) => number;
  placeWood: (type: WoodType, pos: Vec3) => void;
  moveWood: (id: string, pos: Vec3) => void;
  setDragging: (id: string, dragging: boolean) => void;
  rotateWood: (id: string, dy: number, alt?: boolean) => void;
  deleteWood: (id: string) => void;
  selectWood: (id: string | null) => void;
  useLighter: (id: string) => boolean;
  useBellows: (pos: Vec3) => void;
  applyPreset: (name: string) => void;
  clearWoods: () => void;
  setPaused: (p: boolean) => void;
  cycleSpeed: () => void;
  setCameraMode: (m: CameraMode) => void;
  setQuality: (q: Quality) => void;
  setVolume: (v: number) => void;
  startGame: (mode: GameMode, campsiteOrChallenge?: string) => void;
  resumeSave: () => void;
  restart: () => void;
  toTitle: () => void;
  persist: () => void;
}

function envFor(campsiteId: string, challengeId?: string | null): EnvState {
  const ch = challengeId ? getChallenge(challengeId) : null;
  const site = CAMPSITES.find((c) => c.id === campsiteId) ?? CAMPSITES[0];
  return {
    windDir: Math.random() * Math.PI * 2,
    windSpeed: ch ? ch.baseWind : site.baseWind,
    baseWind: ch ? ch.baseWind : site.baseWind,
    groundMoisture: ch ? ch.groundMoisture : site.groundMoisture,
    time: 0,
  };
}

export const useFireStore = create<FireStore>((set, get) => ({
  woods: [],
  env: envFor("forest"),
  puffs: [],
  metrics: { firePower: 0, temperature: 20, oxygen: 1, smoke: 0, fuel: 0 },
  stats: freshStats(),
  structureVersion: 0,
  scatterEvent: 0,
  lighterEvent: 0,
  bellowsEvent: 0,
  placeEvent: 0,

  screen: "title",
  mode: "free",
  campsite: "forest",
  challengeId: null,
  challengeProgress: null,
  holdTime: 0,
  result: null,
  tool: null,
  selectedId: null,
  placeYaw: 0,
  placeTilt: 0,
  paused: false,
  speed: 1,
  cameraMode: "orbit",
  quality: BOOT?.quality ?? "high",
  volume: BOOT?.volume ?? 0.7,
  hasSave: (BOOT?.woods.length ?? 0) > 0,

  highScores: BOOT?.highScores ?? {},
  cleared: BOOT?.cleared ?? [],

  tick: (dt) => {
    const s = get();
    if (s.paused || s.screen !== "play") return;

    // gravity first, so the burning model sees where things actually are
    stepPhysics(s.woods, dt);
    let structureChanged = false;
    // a log that rolled out of the pit is out of the game
    for (const id of strayIds(s.woods)) {
      const i = s.woods.findIndex((w) => w.id === id);
      if (i >= 0) {
        s.woods.splice(i, 1);
        removeBody(id);
        structureChanged = true;
      }
    }

    const { metrics, scattered } = stepSim(
      s.woods,
      s.env,
      s.puffs,
      s.stats,
      dt
    );
    // burned-out logs stop holding up the pile
    for (const w of s.woods) {
      if (w.state === "burned") collapseToAsh(w);
    }
    let holdTime = s.holdTime;
    const def = s.challengeId ? getChallenge(s.challengeId) : null;
    let progress: ChallengeProgress | null = s.challengeProgress;
    if (def) {
      if (def.holdTarget !== undefined) {
        let holding = metrics.firePower >= HOLD_POWER;
        // 湿った薪チャレンジは、湿った薪が実際に燃えている間だけ加算する
        if (def.id === "wet")
          holding =
            holding &&
            s.woods.some(
              (w) =>
                w.type === "wet" &&
                (w.state === "burning" || w.state === "charred")
            );
        // 火を落とすと進捗が巻き戻る（維持＝連続性）
        holdTime = holding
          ? holdTime + dt
          : Math.max(0, holdTime - dt * 2);
      }
      progress = evalChallenge({
        def,
        stats: s.stats,
        metrics,
        holdTime,
      });
    }
    set({
      metrics,
      holdTime,
      challengeProgress: progress,
      ...(structureChanged
        ? { structureVersion: s.structureVersion + 1 }
        : null),
      ...(scattered.length > 0 ? { scatterEvent: s.scatterEvent + 1 } : null),
    });
    if (progress && progress.status !== "ongoing") {
      const success = progress.status === "success";
      const score = computeScore(s.stats, success);
      const hs = { ...s.highScores };
      const cleared = [...s.cleared];
      if (s.challengeId) {
        if (success && !cleared.includes(s.challengeId))
          cleared.push(s.challengeId);
        if (score.total > (hs[s.challengeId] ?? 0))
          hs[s.challengeId] = score.total;
      }
      set({
        screen: "result",
        result: score,
        highScores: hs,
        cleared,
      });
      get().persist();
    }
  },

  setTool: (t) => set({ tool: t, selectedId: null }),

  placeRotation: (type) => placeRotationFor(type, get().placeYaw, get().placeTilt),

  adjustPlaceRotation: (dYaw, dTilt) =>
    set((s) => ({
      placeYaw: s.placeYaw + dYaw,
      placeTilt: Math.max(0, Math.min(Math.PI / 2, s.placeTilt + dTilt)),
    })),

  dropY: (type, pos, rot) => {
    // The shape cast is authoritative for pieces that physics has moved, but
    // a body only enters rapier's broad phase on the next step — so anything
    // placed a moment ago is invisible to it. The analytic solve covers those.
    const analytic = restingY(get().woods, type, pos, rot, null);
    const cast = dropHeight(type, rot, pos.x, pos.z);
    return cast === null ? analytic : Math.max(cast, analytic);
  },

  placeWood: (type, pos) => {
    const s = get();
    const r = Math.sqrt(pos.x * pos.x + pos.z * pos.z);
    if (r > FIRE_AREA_RADIUS) return;
    const rot = placeRotationFor(type, s.placeYaw, s.placeTilt);
    // set it down on the pile rather than dropping it through
    const y = s.dropY(type, pos, rot);
    const wood = makeWood(type, { x: pos.x, y, z: pos.z }, rot);
    s.woods.push(wood);
    addBody(wood);
    wakeAll(); // the pile may no longer be balanced
    s.stats.woodsUsed++;
    set({
      structureVersion: s.structureVersion + 1,
      placeEvent: s.placeEvent + 1,
      // vary the next piece slightly so a stack of logs does not look printed
      placeYaw: s.placeYaw + 0.18,
    });
  },

  moveWood: (id, pos) => {
    const s = get();
    const w = s.woods.find((w) => w.id === id);
    if (!w) return;
    const r = Math.sqrt(pos.x * pos.x + pos.z * pos.z);
    if (r > FIRE_AREA_RADIUS) return;
    w.position.x = pos.x;
    w.position.z = pos.z;
    w.position.y = physicsReady()
      ? Math.max(pos.y, s.dropY(w.type, pos, w.rotation))
      : restingY(s.woods, w.type, w.position, w.rotation, id);
    setBodyPose(id, w.position, w.rotation);
  },

  rotateWood: (id, dy, alt) => {
    const s = get();
    const w = s.woods.find((w) => w.id === id);
    if (!w) return;
    if (alt) w.rotation.z = Math.max(0, Math.min(Math.PI / 2, w.rotation.z + dy));
    else w.rotation.y += dy;
    // rotating can push it into a neighbour — let it settle again
    if (!physicsReady())
      w.position.y = restingY(s.woods, w.type, w.position, w.rotation, id);
    setBodyPose(id, w.position, w.rotation);
    wakeAll();
  },

  setDragging: (id, dragging) => setDragging(id, dragging),

  deleteWood: (id) => {
    const s = get();
    const i = s.woods.findIndex((w) => w.id === id);
    if (i < 0) return;
    s.woods.splice(i, 1);
    removeBody(id);
    wakeAll();
    set({
      structureVersion: s.structureVersion + 1,
      selectedId: s.selectedId === id ? null : s.selectedId,
    });
  },

  selectWood: (id) => set({ selectedId: id }),

  useLighter: (id) => {
    const w = get().woods.find((w) => w.id === id);
    if (!w) return false;
    set((s) => ({ lighterEvent: s.lighterEvent + 1 }));
    return igniteAt(w);
  },

  useBellows: (pos) => {
    const s = get();
    s.puffs.push({ x: pos.x, y: pos.y, z: pos.z, t: 1.5 });
    // a strong puff physically shifts light pieces around
    blowAt(pos, 1);
    set({ bellowsEvent: s.bellowsEvent + 1 });
  },

  applyPreset: (name) => {
    const preset = PRESETS[name];
    if (!preset) return;
    const s = get();
    for (const piece of preset.pieces) {
      const rot = { ...piece.rotation };
      const pos = { ...piece.position };
      // An interlocking build (the teepee) only stands as a finished shape, so
      // it goes in exactly as authored and gravity judges it. Everything else
      // is laid piece by piece, each one dropped onto what is already there.
      if (!preset.interlocking) {
        pos.y = s.dropY(piece.type, pos, rot);
      } else if (!physicsReady()) {
        pos.y = restingY(s.woods, piece.type, pos, rot, null);
      }
      const wood = makeWood(piece.type, pos, rot);
      s.woods.push(wood);
      addBody(wood);
      s.stats.woodsUsed++;
    }
    wakeAll();
    set({ structureVersion: s.structureVersion + 1, placeEvent: s.placeEvent + 1 });
  },

  clearWoods: () => {
    const s = get();
    s.woods.length = 0;
    s.puffs.length = 0;
    clearBodies();
    set({
      structureVersion: s.structureVersion + 1,
      selectedId: null,
      stats: freshStats(),
      metrics: { firePower: 0, temperature: 20, oxygen: 1, smoke: 0, fuel: 0 },
      holdTime: 0,
    });
  },

  setPaused: (p) => set({ paused: p }),
  cycleSpeed: () => {
    const s = get().speed;
    set({ speed: s >= 4 ? 1 : s * 2 });
  },
  setCameraMode: (m) => set({ cameraMode: m }),
  setQuality: (q) => {
    set({ quality: q });
    get().persist();
  },
  setVolume: (v) => {
    set({ volume: v });
    get().persist();
  },

  startGame: (mode, arg) => {
    const s = get();
    const isChallenge = mode === "challenge";
    const challengeId = isChallenge ? (arg ?? CHALLENGES[0].id) : null;
    const campsite = !isChallenge && arg ? arg : s.campsite;
    s.woods.length = 0;
    s.puffs.length = 0;
    clearBodies();
    set({
      screen: "play",
      mode,
      campsite,
      challengeId,
      challengeProgress: null,
      holdTime: 0,
      result: null,
      env: envFor(campsite, challengeId),
      stats: freshStats(),
      metrics: { firePower: 0, temperature: 20, oxygen: 1, smoke: 0, fuel: 0 },
      structureVersion: s.structureVersion + 1,
      tool: null,
      selectedId: null,
      paused: false,
      speed: 1,
      cameraMode: mode === "watch" ? "cinema" : "orbit",
    });
  },

  resumeSave: () => {
    const data = loadGame();
    if (!data || data.woods.length === 0) return;
    const s = get();
    s.woods.length = 0;
    s.puffs.length = 0;
    clearBodies();
    for (const w of data.woods) {
      s.woods.push({ ...w, id: genId() });
    }
    syncBodies(s.woods);
    set({
      screen: "play",
      mode: "free",
      campsite: data.campsite,
      challengeId: null,
      challengeProgress: null,
      holdTime: 0,
      result: null,
      env: { ...data.env },
      stats: freshStats(),
      metrics: { firePower: 0, temperature: 20, oxygen: 1, smoke: 0, fuel: 0 },
      structureVersion: s.structureVersion + 1,
      volume: data.volume ?? 0.7,
      quality: data.quality ?? "high",
      tool: null,
      selectedId: null,
      speed: 1,
      cameraMode: "orbit",
      paused: false,
    });
  },

  restart: () => {
    const s = get();
    s.startGame(s.mode, s.challengeId ?? s.campsite);
  },

  toTitle: () => {
    get().persist();
    set({ screen: "title", paused: false });
  },

  persist: () => {
    const s = get();
    // 焚き火のスナップショットはフリーモードのものだけ。チャレンジや鑑賞
    // モードから保存しても、続きから遊べる焚き火を上書きしない。
    const prev = loadGame();
    const keepFire = s.mode === "free" && s.screen === "play";
    saveGame({
      woods: keepFire ? s.woods.map((w) => ({ ...w })) : (prev?.woods ?? []),
      env: keepFire ? { ...s.env } : (prev?.env ?? s.env),
      campsite: keepFire ? s.campsite : (prev?.campsite ?? s.campsite),
      highScores: s.highScores,
      cleared: s.cleared,
      volume: s.volume,
      quality: s.quality,
    });
    set({ hasSave: (keepFire ? s.woods.length : (prev?.woods.length ?? 0)) > 0 });
  },
}));

export { fireCentroid, clearSave };

if (import.meta.env.DEV) {
  (window as unknown as { fireStore: typeof useFireStore }).fireStore =
    useFireStore;
}
