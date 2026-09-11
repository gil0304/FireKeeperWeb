import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { CHALLENGES, PALETTE_ORDER, PRESETS, WOOD_PROPS } from "../constants";
import { useFireStore } from "../store";
import type { CameraMode, Quality, Tool, WoodType } from "../types";
import { useSlowMetrics, useSlowMoisture, useSlowProgress } from "./hooks";
import { LighterIcon } from "./icons";

const WOOD_LABELS: Record<WoodType, string> = {
  tinder: "火口",
  leaves: "枯葉",
  twig: "小枝",
  thin: "細枝",
  normal: "薪",
  thick: "太薪",
  wet: "湿薪",
};

const CAM_NEXT: Record<CameraMode, CameraMode> = {
  orbit: "fixed",
  fixed: "close",
  close: "cinema",
  cinema: "orbit",
};
const CAM_GLYPH: Record<CameraMode, string> = {
  orbit: "回",
  fixed: "固",
  close: "寄",
  cinema: "映",
};

const Q_NEXT: Record<Quality, Quality> = { low: "mid", mid: "high", high: "low" };
const Q_GLYPH: Record<Quality, string> = { low: "L", mid: "M", high: "H" };

/* ── left palette ── */

function ToolButton({
  tool,
  current,
  title,
  children,
}: {
  tool: Tool;
  current: Tool;
  title: string;
  children: ReactNode;
}) {
  const setTool = useFireStore((s) => s.setTool);
  const active = current === tool;
  return (
    <button
      className={`pal-btn${active ? " active" : ""}`}
      title={title}
      onClick={() => setTool(active ? null : tool)}
    >
      {children}
    </button>
  );
}

function Palette() {
  const tool = useFireStore((s) => s.tool);
  const applyPreset = useFireStore((s) => s.applyPreset);
  const clearWoods = useFireStore((s) => s.clearWoods);

  return (
    <div className="palette glass">
      <div className="pal-group">
        {PALETTE_ORDER.map((t) => {
          const p = WOOD_PROPS[t];
          return (
            <ToolButton key={t} tool={t} current={tool} title={WOOD_LABELS[t]}>
              <span
                className="pal-icon"
                style={{ fontSize: 13 + p.radius * 150 }}
              >
                {p.icon}
              </span>
              <span className="pal-label">{WOOD_LABELS[t]}</span>
            </ToolButton>
          );
        })}
      </div>

      <div className="pal-sep" />

      <div className="pal-group">
        <ToolButton tool="lighter" current={tool} title="点火">
          <span className="pal-icon">
            <LighterIcon size={20} />
          </span>
          <span className="pal-label">点火</span>
        </ToolButton>
        <ToolButton tool="bellows" current={tool} title="送風">
          <span className="pal-icon" style={{ fontSize: 18 }}>
            💨
          </span>
          <span className="pal-label">送風</span>
        </ToolButton>
      </div>

      <div className="pal-sep" />

      <div className="pal-grid">
        {Object.entries(PRESETS).map(([name, p]) => (
          <button
            key={name}
            className="pal-btn"
            title={p.label}
            onClick={() => applyPreset(name)}
          >
            <span className="pal-icon">{p.icon}</span>
            <span className="pal-label">{p.label}</span>
          </button>
        ))}
        <button className="pal-btn danger" title="全消去" onClick={clearWoods}>
          <span className="pal-icon" style={{ fontSize: 15 }}>
            🗑
          </span>
        </button>
      </div>
    </div>
  );
}

/* ── right gauges ── */

function GaugeRow({
  icon,
  o2,
  pct,
  num,
  unit,
  color,
}: {
  icon: string;
  o2?: boolean;
  pct: number;
  num: number;
  unit?: string;
  color: string;
}) {
  const w = Math.max(0, Math.min(1, pct)) * 100;
  return (
    <div className="grow">
      <span className={`grow-icon${o2 ? " o2" : ""}`}>{icon}</span>
      <div className="gbar">
        <div
          className="gbar-fill"
          style={{ width: `${w}%`, background: color }}
        />
      </div>
      <span className="grow-num">
        {num}
        {unit && <i>{unit}</i>}
      </span>
    </div>
  );
}

function WindRow() {
  const rotRef = useRef<SVGGElement | null>(null);
  const sclRef = useRef<SVGGElement | null>(null);
  const numRef = useRef<HTMLSpanElement | null>(null);

  useEffect(() => {
    let raf = 0;
    let lastDeg = -9999;
    let lastScl = -1;
    let lastTxt = "";
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const env = useFireStore.getState().env;
      const deg = (env.windDir * 180) / Math.PI;
      if (rotRef.current && Math.abs(deg - lastDeg) > 0.15) {
        lastDeg = deg;
        rotRef.current.setAttribute(
          "transform",
          `rotate(${deg.toFixed(1)} 24 24)`
        );
      }
      const scl = 0.55 + Math.min(env.windSpeed, 9) * 0.08;
      if (sclRef.current && Math.abs(scl - lastScl) > 0.008) {
        lastScl = scl;
        sclRef.current.setAttribute(
          "transform",
          `translate(24 24) scale(${scl.toFixed(3)}) translate(-24 -24)`
        );
      }
      const txt = env.windSpeed.toFixed(1);
      if (numRef.current && txt !== lastTxt) {
        lastTxt = txt;
        numRef.current.textContent = txt;
      }
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div className="wind-row">
      <svg viewBox="0 0 48 48" width="40" height="40" aria-hidden="true">
        <circle
          cx="24"
          cy="24"
          r="21"
          fill="rgba(255,255,255,0.03)"
          stroke="rgba(255,255,255,0.14)"
          strokeWidth="1.5"
        />
        <circle cx="24" cy="4.5" r="1.3" fill="rgba(255,255,255,0.3)" />
        <circle cx="24" cy="43.5" r="1" fill="rgba(255,255,255,0.18)" />
        <circle cx="4.5" cy="24" r="1" fill="rgba(255,255,255,0.18)" />
        <circle cx="43.5" cy="24" r="1" fill="rgba(255,255,255,0.18)" />
        <g ref={rotRef}>
          <g ref={sclRef}>
            <line
              x1="24"
              y1="37"
              x2="24"
              y2="15"
              stroke="#9fd7ff"
              strokeWidth="3"
              strokeLinecap="round"
            />
            <path d="M24 6 L30 17 L18 17 Z" fill="#9fd7ff" />
          </g>
        </g>
      </svg>
      <span ref={numRef} className="wind-num">
        0.0
      </span>
      <span className="wind-unit">m/s</span>
    </div>
  );
}

function powerColor(p: number): string {
  const hue = Math.max(0, 48 - Math.min(p, 100) * 0.48);
  return `hsl(${hue.toFixed(0)} 100% 55%)`;
}

function Gauges() {
  const m = useSlowMetrics(200);
  const moist = useSlowMoisture(400);
  return (
    <div className="gauges glass">
      <GaugeRow
        icon="🔥"
        pct={m.firePower / 100}
        num={Math.round(m.firePower)}
        color={powerColor(m.firePower)}
      />
      <GaugeRow
        icon="🌡"
        pct={(m.temperature - 20) / 780}
        num={Math.round(m.temperature)}
        unit="°"
        color="#ff7847"
      />
      <GaugeRow
        icon="O₂"
        o2
        pct={m.oxygen}
        num={Math.round(m.oxygen * 100)}
        unit="%"
        color="#7fd4ff"
      />
      <GaugeRow
        icon="💨"
        pct={m.smoke / 100}
        num={Math.round(m.smoke)}
        color="#aab2bd"
      />
      <GaugeRow
        icon="🪵"
        pct={m.fuel / 300}
        num={Math.round(m.fuel)}
        unit="s"
        color="#d9a05b"
      />
      <WindRow />
      <GaugeRow
        icon="💧"
        pct={moist}
        num={Math.round(moist * 100)}
        unit="%"
        color="#6fb3ff"
      />
    </div>
  );
}

/* ── bottom bar ── */

function BottomBar() {
  const paused = useFireStore((s) => s.paused);
  const speed = useFireStore((s) => s.speed);
  const cameraMode = useFireStore((s) => s.cameraMode);
  const quality = useFireStore((s) => s.quality);
  const volume = useFireStore((s) => s.volume);
  const setPaused = useFireStore((s) => s.setPaused);
  const cycleSpeed = useFireStore((s) => s.cycleSpeed);
  const restart = useFireStore((s) => s.restart);
  const setCameraMode = useFireStore((s) => s.setCameraMode);
  const setQuality = useFireStore((s) => s.setQuality);
  const setVolume = useFireStore((s) => s.setVolume);
  const toTitle = useFireStore((s) => s.toTitle);

  return (
    <div className="bottombar glass">
      <button
        className="bb-btn"
        title={paused ? "再生" : "停止"}
        onClick={() => setPaused(!paused)}
      >
        {paused ? "▶" : "⏸"}
      </button>
      <button className="bb-btn" title="速度" onClick={cycleSpeed}>
        <span className="bb-speed">×{speed}</span>
      </button>
      <button className="bb-btn" title="再挑戦" onClick={restart}>
        🔄
      </button>
      <button
        className="bb-btn"
        title="視点"
        onClick={() => setCameraMode(CAM_NEXT[cameraMode])}
      >
        📷
        <span className="bb-glyph">{CAM_GLYPH[cameraMode]}</span>
      </button>
      <button className="bb-btn" title="終了" onClick={toTitle}>
        🏠
      </button>

      <div className="bb-sep" />

      <div className="bb-vol" title="音量">
        <span style={{ fontSize: 13 }}>{volume === 0 ? "🔇" : "🔊"}</span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={volume}
          onChange={(e) => setVolume(Number(e.currentTarget.value))}
        />
      </div>

      <button
        className="bb-btn"
        title="画質"
        onClick={() => setQuality(Q_NEXT[quality])}
      >
        ⚙<span className="bb-glyph">{Q_GLYPH[quality]}</span>
      </button>
    </div>
  );
}

/* ── challenge strip ── */

function fmtTime(sec: number): string {
  const s = Math.max(0, Math.ceil(sec));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, "0")}`;
}

function ChallengeStrip() {
  const challengeId = useFireStore((s) => s.challengeId);
  const prog = useSlowProgress(100);
  const def = CHALLENGES.find((c) => c.id === challengeId);
  if (!def || !prog) return null;
  const danger = prog.remaining < 10;
  return (
    <div className={`challenge-strip glass${danger ? " danger" : ""}`}>
      <span className="cs-icon">{def.icon}</span>
      <span className="cs-time">{fmtTime(prog.remaining)}</span>
      <div className="cs-bar">
        <div
          className="cs-fill"
          style={{ width: `${Math.min(1, prog.progress) * 100}%` }}
        />
      </div>
    </div>
  );
}

/* ── selected wood chip ── */

function SelectedChip() {
  const selectedId = useFireStore((s) => s.selectedId);
  const deleteWood = useFireStore((s) => s.deleteWood);
  if (selectedId === null) return null;
  return (
    <div className="sel-chip glass">
      <span className="sel-hint">
        ⟳<small>🖱</small>
      </span>
      <span className="sel-hint">
        ↕<small>⇧🖱</small>
      </span>
      <button
        className="sel-del"
        title="削除"
        onClick={() => deleteWood(selectedId)}
      >
        🗑<small>⌫</small>
      </button>
    </div>
  );
}

/* ── placement pose chip: how the next piece will be laid down ── */

function PlaceChip() {
  const tool = useFireStore((s) => s.tool);
  const yaw = useFireStore((s) => s.placeYaw);
  const tilt = useFireStore((s) => s.placeTilt);
  if (tool === null || tool === "lighter" || tool === "bellows") return null;
  const deg = Math.round((tilt * 180) / Math.PI);
  return (
    <div className="sel-chip glass">
      <span className="sel-hint" title="向き">
        <svg width="16" height="16" viewBox="-8 -8 16 16" aria-hidden>
          <line
            x1={-6 * Math.cos(yaw)}
            y1={6 * Math.sin(yaw)}
            x2={6 * Math.cos(yaw)}
            y2={-6 * Math.sin(yaw)}
            stroke="currentColor"
            strokeWidth="3"
            strokeLinecap="round"
          />
        </svg>
        <small>🖱</small>
      </span>
      <span className="sel-hint" title="傾き">
        ↕<small>{deg}°</small>
      </span>
    </div>
  );
}

/* ── watch mode ── */

function WatchOverlay() {
  const toTitle = useFireStore((s) => s.toTitle);
  const [awake, setAwake] = useState(true);

  useEffect(() => {
    let t = 0;
    const wake = () => {
      setAwake(true);
      window.clearTimeout(t);
      t = window.setTimeout(() => setAwake(false), 3000);
    };
    wake();
    window.addEventListener("pointermove", wake);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener("pointermove", wake);
    };
  }, []);

  return (
    <button
      className={`watch-home glass${awake ? " awake" : ""}`}
      title="終了"
      onClick={toTitle}
    >
      🏠
    </button>
  );
}

/* ── root ── */

export function PlayHUD() {
  const mode = useFireStore((s) => s.mode);

  if (mode === "watch") return <WatchOverlay />;

  return (
    <>
      <Palette />
      <Gauges />
      <BottomBar />
      {mode === "challenge" && <ChallengeStrip />}
      <SelectedChip />
      <PlaceChip />
    </>
  );
}
