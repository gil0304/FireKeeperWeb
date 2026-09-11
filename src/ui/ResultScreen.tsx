import { CHALLENGES } from "../constants";
import { useFireStore } from "../store";
import { useCountUp } from "./hooks";

type RowKey =
  | "ignitionSpeed"
  | "stability"
  | "lowSmoke"
  | "woodEconomy"
  | "maxPower"
  | "upTime";

const ROWS: { icon: string; key: RowKey; max: number }[] = [
  { icon: "⚡", key: "ignitionSpeed", max: 20 },
  { icon: "⚖️", key: "stability", max: 25 },
  { icon: "🌫", key: "lowSmoke", max: 15 },
  { icon: "🪵", key: "woodEconomy", max: 15 },
  { icon: "🔥", key: "maxPower", max: 10 },
  { icon: "⏱", key: "upTime", max: 15 },
];

export function ResultScreen() {
  const result = useFireStore((s) => s.result);
  const challengeId = useFireStore((s) => s.challengeId);
  const progress = useFireStore((s) => s.challengeProgress);
  const restart = useFireStore((s) => s.restart);
  const toTitle = useFireStore((s) => s.toTitle);
  const total = useCountUp(result?.total ?? 0);

  if (!result) return null;
  const def = CHALLENGES.find((c) => c.id === challengeId);
  const ok = progress?.status === "success";

  return (
    <div className="screen">
      <div className="result-card glass">
        {def && (
          <div className={`result-status ${ok ? "ok" : "ng"}`}>
            <span>{def.icon}</span>
            <span>{ok ? "成功" : "失敗"}</span>
          </div>
        )}

        <div className="result-total">
          <span className="rt-num">{total}</span>
          <span className="rt-max">/100</span>
        </div>
        <div className="result-title">{result.title}</div>

        <div className="result-rows">
          {ROWS.map((r) => (
            <div key={r.key} className="rrow">
              <span className="rrow-icon">{r.icon}</span>
              <div className="rrow-bar">
                <div
                  className="rrow-fill"
                  style={{ width: `${(result[r.key] / r.max) * 100}%` }}
                />
              </div>
              <span className="rrow-num">{result[r.key]}</span>
            </div>
          ))}
        </div>

        <div className="result-btns">
          <button className="side-btn" title="再挑戦" onClick={restart}>
            🔄
          </button>
          <button className="side-btn" title="終了" onClick={toTitle}>
            🏠
          </button>
        </div>
      </div>
    </div>
  );
}
