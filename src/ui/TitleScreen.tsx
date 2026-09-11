import { useState } from "react";
import { CAMPSITES, CHALLENGES } from "../constants";
import { useFireStore } from "../store";

export function TitleScreen() {
  const hasSave = useFireStore((s) => s.hasSave);
  const highScores = useFireStore((s) => s.highScores);
  const cleared = useFireStore((s) => s.cleared);
  const startGame = useFireStore((s) => s.startGame);
  const resumeSave = useFireStore((s) => s.resumeSave);
  const [site, setSite] = useState<string>(
    () => useFireStore.getState().campsite
  );

  return (
    <div className="screen">
      <div className="title-box">
        <div className="logo">
          <span className="logo-fire">🔥</span>
          <span className="logo-text">Fire Keeper</span>
        </div>

        <div className="site-row">
          {CAMPSITES.map((c) => (
            <button
              key={c.id}
              className={`site-btn glass${site === c.id ? " active" : ""}`}
              onClick={() => setSite(c.id)}
            >
              <span className="site-icon">{c.icon}</span>
              <span className="site-label">{c.label}</span>
            </button>
          ))}
        </div>

        <div className="start-row">
          <button
            className="start-btn"
            title="開始"
            onClick={() => startGame("free", site)}
          >
            ▶
          </button>
          <button
            className="side-btn glass"
            title="観賞"
            onClick={() => startGame("watch", site)}
          >
            👁
          </button>
          {hasSave && (
            <button className="side-btn glass" title="再開" onClick={resumeSave}>
              🔁
            </button>
          )}
        </div>

        <div className="chal-list">
          {CHALLENGES.map((c) => {
            const best = highScores[c.id];
            const done = cleared.includes(c.id);
            return (
              <button
                key={c.id}
                className={`chal-chip glass${done ? " done" : ""}`}
                onClick={() => startGame("challenge", c.id)}
              >
                <span className="chal-icon">{c.icon}</span>
                <span className="chal-label">{c.label}</span>
                {done && <span className="chal-check">✓</span>}
                {best !== undefined && (
                  <span className="chal-best">{best}</span>
                )}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
