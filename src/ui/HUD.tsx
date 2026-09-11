import "./hud.css";
import { useFireStore } from "../store";
import { PlayHUD } from "./PlayHUD";
import { ResultScreen } from "./ResultScreen";
import { TitleScreen } from "./TitleScreen";

export function HUD() {
  const screen = useFireStore((s) => s.screen);
  return (
    <div className="hud-root">
      {screen === "title" && <TitleScreen />}
      {screen === "play" && <PlayHUD />}
      {screen === "result" && <ResultScreen />}
    </div>
  );
}
