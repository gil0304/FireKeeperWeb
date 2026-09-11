import { CHALLENGES, SMOKE_LIMIT, TITLES } from "../constants";
import type {
  ChallengeDef,
  ChallengeProgress,
  Metrics,
  RunStats,
  ScoreBreakdown,
} from "../types";

export function getChallenge(id: string): ChallengeDef | undefined {
  return CHALLENGES.find((c) => c.id === id);
}

interface EvalCtx {
  def: ChallengeDef;
  stats: RunStats;
  metrics: Metrics;
  holdTime: number;
}

export function evalChallenge(ctx: EvalCtx): ChallengeProgress {
  const { def, stats, metrics, holdTime } = ctx;
  const remaining = Math.max(0, def.timeLimit - stats.time);

  // per-challenge disqualifiers
  if (def.maxWoods !== undefined && stats.woodsUsed > def.maxWoods)
    return { status: "fail", progress: 0, remaining };
  if (def.id === "clean" && stats.peakSmoke > SMOKE_LIMIT)
    return { status: "fail", progress: 0, remaining };

  const progress =
    def.targetPower !== undefined
      ? metrics.firePower / def.targetPower
      : def.holdTarget !== undefined
        ? holdTime / def.holdTarget
        : 0;
  const p = Math.max(0, Math.min(1, progress));

  if (progress >= 1) return { status: "success", progress: 1, remaining };
  if (remaining <= 0) return { status: "fail", progress: p, remaining: 0 };
  return { status: "ongoing", progress: p, remaining };
}

export function computeScore(stats: RunStats, success: boolean): ScoreBreakdown {
  const clamp = (v: number, max: number) =>
    Math.round(Math.max(0, Math.min(max, v)));

  // 着火までの速さ 20
  const ign =
    stats.ignitedAt === null
      ? 0
      : clamp(20 * (1 - Math.min(stats.ignitedAt, 90) / 90), 20);
  // 火の安定性 25
  const avg =
    stats.powerSamples > 0 ? stats.powerSum / stats.powerSamples : 0;
  const aliveRatio = stats.time > 0 ? stats.aliveTime / stats.time : 0;
  const steady = Math.max(0, 1 - stats.dips * 0.2); // each flameout costs 20%
  const stability = clamp(25 * aliveRatio * Math.min(1, avg / 40) * steady, 25);
  // 煙の少なさ 15
  const avgSmoke = stats.time > 0 ? stats.smokeSum / stats.time : 0;
  const lowSmoke = clamp(15 * (1 - Math.min(avgSmoke, 50) / 50), 15);
  // 薪の使用量 15
  const economy = clamp(
    15 * (1 - Math.max(0, stats.woodsUsed - 6) / 14),
    15
  );
  // 最大火力 10
  const maxPower = clamp((stats.maxPower / 100) * 10, 10);
  // 維持時間 15
  const upTime = clamp((stats.aliveTime / 120) * 15, 15);

  let total = ign + stability + lowSmoke + economy + maxPower + upTime;
  if (!success) total = Math.round(total * 0.5);
  const title = TITLES.find(([min]) => total >= min)?.[1] ?? TITLES[4][1];
  return {
    ignitionSpeed: ign,
    stability,
    lowSmoke,
    woodEconomy: economy,
    maxPower,
    upTime,
    total,
    title,
  };
}
