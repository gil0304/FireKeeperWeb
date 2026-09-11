import { WOOD_PROPS } from "../constants";
import type {
  EnvState,
  Metrics,
  Puff,
  RunStats,
  Vec3,
  WoodObject,
} from "../types";
import { emptySeg, segDist, woodSegment, type Seg } from "./geometry";

const AMBIENT = 20;

export function fireCentroid(woods: WoodObject[]): Vec3 {
  let x = 0, y = 0, z = 0, n = 0;
  for (const w of woods) {
    if (w.output > 0) {
      x += w.position.x * w.output;
      y += w.position.y * w.output;
      z += w.position.z * w.output;
      n += w.output;
    }
  }
  if (n === 0) return { x: 0, y: 0, z: 0 };
  return { x: x / n, y: y / n, z: z / n };
}

export interface SimResult {
  metrics: Metrics;
  scattered: string[];
}

export function stepSim(
  woods: WoodObject[],
  env: EnvState,
  puffs: Puff[],
  stats: RunStats,
  dt: number
): SimResult {
  env.time += dt;
  const t = env.time;
  env.windSpeed = Math.max(
    0,
    env.baseWind *
      (0.7 + 0.35 * Math.sin(t * 0.31) + 0.25 * Math.sin(t * 0.83 + 2)) +
      (env.baseWind > 4 ? Math.max(0, Math.sin(t * 1.7)) * 1.5 : 0)
  );
  env.windDir += (Math.sin(t * 0.11) + Math.sin(t * 0.047 + 1)) * 0.15 * dt;

  for (let i = puffs.length - 1; i >= 0; i--) {
    puffs[i].t -= dt;
    if (puffs[i].t <= 0) puffs.splice(i, 1);
  }

  const n = woods.length;
  const segs: Seg[] = new Array(n);
  for (let i = 0; i < n; i++) segs[i] = woodSegment(woods[i], emptySeg());

  const dist: number[][] = new Array(n);
  for (let i = 0; i < n; i++) {
    dist[i] = new Array(n).fill(0);
    for (let j = 0; j < i; j++) {
      const d = segDist(segs[i], segs[j]);
      dist[i][j] = d;
      dist[j][i] = d;
    }
  }

  // per-wood local oxygen from crowding, and how much the pile blocks wind
  const shelter: number[] = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    const w = woods[i];
    let crowd = 0;
    for (let j = 0; j < n; j++) {
      if (j === i) continue;
      const other = woods[j];
      const gap = dist[i][j] - segs[i].r - segs[j].r;
      // thin pieces barely block airflow; fat logs smother; ash lies flat
      const bulk =
        other.state === "burned"
          ? 0.1
          : other.type === "tinder"
            ? 0.4
            : Math.min(1, WOOD_PROPS[other.type].radius / 0.05);
      if (gap < 0.015) crowd += bulk;
      else if (gap < 0.05) crowd += bulk * 0.4;
    }
    // Packing wood tightly trades oxygen for shelter from the wind. The ring
    // of stones round the pit shelters anything sitting low in it too, which
    // is what makes it possible to get a fire going at all on a windy day.
    const pitShelter = w.position.y < 0.09 ? 0.55 : 0;
    shelter[i] = Math.max(pitShelter, Math.min(0.85, crowd * 0.22));
    let oxy = 1.12 - Math.max(0, crowd - 2.5) * 0.18;
    oxy += Math.min(env.windSpeed * 0.025, 0.2);
    if (w.position.y > 0.12) oxy += 0.05;
    for (const p of puffs) {
      const dx = w.position.x - p.x;
      const dy = w.position.y - p.y;
      const dz = w.position.z - p.z;
      if (dx * dx + dy * dy + dz * dz < 0.09) {
        oxy += 0.45 * Math.min(1, p.t);
        // fanning embers heats them up
        if (w.state === "charred" || w.state === "burning" || w.state === "ignited")
          w.temperature += 160 * dt * Math.min(1, p.t);
      }
    }
    w.oxygen = Math.max(0.1, Math.min(1, oxy));
  }

  // total power of the previous tick — small fires are fragile in wind
  let prevPower = 0;
  for (let i = 0; i < n; i++) prevPower += woods[i].output;
  prevPower *= 0.45;

  // heat exchange
  const heatIn: number[] = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    const wi = woods[i];
    if (wi.output <= 0) continue;
    for (let j = 0; j < n; j++) {
      if (j === i) continue;
      const wj = woods[j];
      const gap =
        dist[i][j] - segs[i].r - segs[j].r;
      if (gap > 0.3) continue;
      let k = gap <= 0.01 ? 1 : Math.pow(1 - gap / 0.3, 2);
      if (wj.position.y > wi.position.y + 0.02) k *= 1.6;
      // wind carries heat downwind
      const dwx = Math.cos(env.windDir);
      const dwz = Math.sin(env.windDir);
      const rx = wj.position.x - wi.position.x;
      const rz = wj.position.z - wi.position.z;
      const len = Math.sqrt(rx * rx + rz * rz) || 1;
      const align = (rx * dwx + rz * dwz) / len;
      k *= 1 + align * Math.min(env.windSpeed * 0.06, 0.5);
      heatIn[j] += wi.output * k * 3.4;
      // cold wet wood drains heat back out of the burner
      if (wj.moisture > 0.25 && wj.output <= 0)
        heatIn[i] -= wi.output * k * wj.moisture * 3.0;
    }
  }

  let firePower = 0;
  let smoke = 0;
  let fuelSeconds = 0;
  let oxySum = 0;
  let oxyCount = 0;
  const scattered: string[] = [];

  for (let i = 0; i < n; i++) {
    const w = woods[i];
    const p = WOOD_PROPS[w.type];

    // ground moisture chills anything lying low
    let cooling = (w.temperature - AMBIENT) * 0.35;
    if (w.position.y < 0.06)
      cooling += env.groundMoisture * 14 * (w.temperature > AMBIENT ? 1 : 0);
    // wind chills everything while the fire is still weak — unless the piece
    // is tucked inside the pile
    if (prevPower < 30)
      cooling +=
        env.windSpeed * 1.6 * (1 - shelter[i]) * (w.temperature > 60 ? 1 : 0);

    let gain = heatIn[i] + w.output * 5; // incl. self-heating while burning
    // evaporation: wet wood soaks heat, makes smoke
    if (w.moisture > 0.03 && w.temperature > 70) {
      const evap = Math.min(w.moisture, (gain * 0.00007 + 0.002) * dt);
      w.moisture -= evap;
      gain *= 0.45;
      smoke += evap * 800;
      if (w.state === "burning" || w.state === "ignited") smoke += w.moisture * 12;
    }

    const thermalMass = Math.max(0.6, Math.pow(p.mass, 0.6));
    w.temperature += (gain / thermalMass - cooling) * dt;
    if (w.temperature < AMBIENT) w.temperature = AMBIENT;
    if (w.temperature > 1200) w.temperature = 1200;

    const dry = 1 - w.moisture * 0.75;
    const oxyCorr = 0.25 + 0.75 * w.oxygen;

    switch (w.state) {
      case "idle":
      case "heating": {
        w.state = w.temperature > p.ignTemp * 0.45 ? "heating" : "idle";
        const score =
          (w.temperature / (p.ignTemp * (1 + w.moisture * 1.6))) *
          dry *
          (0.45 + 0.55 * w.oxygen);
        if (score > 1) {
          const delay = 1.2 + (100 - p.ignitability) / 28;
          w.ignition += dt / delay;
          if (w.ignition >= 1) {
            w.state = "ignited";
            w.ignition = 1;
          }
        } else {
          w.ignition = Math.max(0, w.ignition - dt * 0.25);
        }
        if (w.state === "heating" && w.temperature > 130)
          smoke += 0.6 * (1 - dry);
        break;
      }
      case "ignited": {
        w.ignition += dt / 1.4;
        const ramp = Math.min(1, w.ignition - 1);
        w.output = p.heat * 0.4 * ramp * oxyCorr * dry;
        w.fuel -= (dt / p.burnTime) * 0.5;
        if (w.ignition >= 2) w.state = "burning";
        break;
      }
      case "burning":
      case "charred": {
        const windCorr = 1 + Math.min(env.windSpeed * 0.05, 0.4);
        const burnSpeed =
          (0.55 + 0.65 * w.oxygen) * (1 + env.windSpeed * 0.055);
        const phase = w.fuel > 0.25 ? 1 : Math.max(0.25, w.fuel / 0.25);
        const ember = w.state === "charred";
        if (ember) {
          // smolder: needs residual temperature; bellows can revive it
          const glow = w.temperature > 200 ? 1 : w.temperature > 120 ? 0.4 : 0;
          // a cold char is inert — it must keep its fuel to be re-lightable
          w.fuel -= (dt / p.burnTime) * burnSpeed * glow * 0.5;
          w.output = p.heat * 0.22 * glow * oxyCorr;
          if (w.oxygen > 0.9 && w.temperature > 380 && w.fuel > 0.05) {
            w.state = "burning"; // re-flare
          }
          smoke += glow * 0.8;
        } else {
          w.fuel -= (dt / p.burnTime) * burnSpeed;
          w.output = p.heat * phase * oxyCorr * dry * windCorr;
          smoke += 0.35 + (1 - w.oxygen) * 7 + w.moisture * 9;
          if (w.fuel < 0.22) w.state = "charred";
          // choke out
          if (w.oxygen < 0.16) {
            w.ignition -= dt * 0.5;
            if (w.ignition < 0.3) {
              w.state = "charred";
              w.temperature = Math.min(w.temperature, 260);
            }
          } else if (
            env.windSpeed > 5 &&
            prevPower < 30 &&
            p.mass < 0.6 &&
            shelter[i] < 0.5
          ) {
            // gusts blow out small exposed flames
            if (Math.sin(env.time * 3.1 + i) > 0.93) {
              w.state = "charred";
              w.temperature = Math.min(w.temperature, 200);
            }
          } else if (w.temperature < p.ignTemp * 0.5) {
            w.state = "charred";
          }
        }
        if (w.fuel <= 0) {
          w.fuel = 0;
          w.state = "burned";
          w.output = 0;
        }
        break;
      }
      case "burned":
        w.output = 0;
        w.temperature = Math.max(AMBIENT, w.temperature - 40 * dt);
        break;
    }

    if (w.state !== "burning" && w.state !== "ignited" && w.state !== "charred")
      w.output = 0;

    firePower += w.output;
    fuelSeconds += w.fuel * p.burnTime;
    if (w.state !== "idle" && w.state !== "burned") {
      oxySum += w.oxygen;
      oxyCount++;
    }
  }

  // bellows overuse scatters light pieces
  if (puffs.length >= 4) {
    const last = puffs[puffs.length - 1];
    if (last.t > 1.45) {
      for (const w of woods) {
        const pr = WOOD_PROPS[w.type];
        if (pr.mass > 0.25) continue;
        const dx = w.position.x - last.x;
        const dz = w.position.z - last.z;
        const d2 = dx * dx + dz * dz;
        if (d2 < 0.06) {
          const d = Math.sqrt(d2) || 0.05;
          w.position.x += (dx / d) * 0.12;
          w.position.z += (dz / d) * 0.12;
          scattered.push(w.id);
        }
      }
    }
  }

  const power = Math.min(120, firePower * 0.45);
  const oxygen = oxyCount > 0 ? oxySum / oxyCount : 1;
  smoke = Math.min(100, smoke);

  // stats
  stats.time += dt;
  if (power > 8 && stats.ignitedAt === null) stats.ignitedAt = stats.time;
  if (power > stats.maxPower) stats.maxPower = power;
  stats.powerSum += power;
  stats.powerSamples++;
  stats.smokeSum += smoke * dt;
  if (stats.time > 5 && smoke > stats.peakSmoke) stats.peakSmoke = smoke;
  if (power > 5) stats.aliveTime += dt;
  // a flameout after the fire was properly going counts against stability
  // (hysteresis, so the ramp-up wobble is not mistaken for going out)
  if (stats.wasAlive) {
    if (power < 4) {
      stats.dips++;
      stats.wasAlive = false;
    }
  } else if (power > 20) {
    stats.wasAlive = true;
  }

  return {
    metrics: {
      firePower: power,
      temperature: Math.round(AMBIENT + power * 6),
      oxygen,
      smoke,
      fuel: fuelSeconds,
    },
    scattered,
  };
}

export function igniteAt(w: WoodObject): boolean {
  const p = WOOD_PROPS[w.type];
  if (w.state === "burned") return false;
  if (p.ignitability >= 85 && w.moisture < 0.3) {
    w.state = "ignited";
    w.ignition = 1;
    w.temperature = Math.max(w.temperature, p.ignTemp + 50);
    return true;
  }
  // lighter warms harder wood a little
  w.temperature += 60;
  return false;
}
