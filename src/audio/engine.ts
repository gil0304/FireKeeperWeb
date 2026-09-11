// Procedural audio engine for Fire Keeper Web.
// Everything is synthesized with the raw Web Audio API — no samples, no deps.
//
// Graph:  [layers & one-shots] -> bus (duck) -> master (volume) -> compressor -> out
//
// Continuous layers (gains driven from sim state via update()):
//   - fire bed rumble : brown noise -> lowpass 400Hz, breathing LFO
//   - fire midband    : pink noise -> bandpass ~950Hz, opens above power ~40
//   - wind            : pink noise -> wandering bandpass 300-900Hz, undulating LFO
// Stochastic layers (scheduled from update()):
//   - crackle/pops, ember sparkle ticks
// One-shots: knock (wood placed), lighter flint, bellows whoosh, scatter rustle.

export type OneShot = "knock" | "lighter" | "bellows" | "scatter";

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

function makeNoiseBuffer(
  ctx: AudioContext,
  seconds: number,
  kind: "white" | "pink" | "brown"
): AudioBuffer {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  if (kind === "white") {
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  } else if (kind === "brown") {
    let last = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      last = (last + 0.02 * w) / 1.02;
      data[i] = last * 3.5;
    }
  } else {
    // pink noise, Paul Kellet approximation
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + w * 0.0555179;
      b1 = 0.99332 * b1 + w * 0.0750759;
      b2 = 0.969 * b2 + w * 0.153852;
      b3 = 0.8665 * b3 + w * 0.3104856;
      b4 = 0.55 * b4 + w * 0.5329522;
      b5 = -0.7616 * b5 - w * 0.016898;
      data[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
      b6 = w * 0.115926;
    }
  }
  return buf;
}

export class AudioEngine {
  private readonly ctx: AudioContext;
  private readonly bus: GainNode; // duck stage (screen / pause)
  private readonly master: GainNode; // user volume

  private readonly whiteBuf: AudioBuffer;

  private readonly rumbleGain: GainNode;
  private readonly rumbleLfoDepth: GainNode;
  private readonly midGain: GainNode;
  private readonly windGain: GainNode;
  private readonly windLfoDepth: GainNode;
  private readonly windFilter: BiquadFilterNode;

  // long-lived sources/oscillators, stopped on dispose
  private readonly running: (AudioBufferSourceNode | OscillatorNode)[] = [];

  private windFreq = 550; // wandering bandpass center
  private disposed = false;

  constructor() {
    const ctx = new AudioContext();
    this.ctx = ctx;

    this.bus = ctx.createGain();
    this.bus.gain.value = 0;
    this.master = ctx.createGain();
    this.master.gain.value = 0;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.knee.value = 20;
    comp.ratio.value = 6;
    this.bus.connect(this.master);
    this.master.connect(comp);
    comp.connect(ctx.destination);

    this.whiteBuf = makeNoiseBuffer(ctx, 1.8, "white");
    const pinkBuf = makeNoiseBuffer(ctx, 2.7, "pink");
    const brownBuf = makeNoiseBuffer(ctx, 2.3, "brown");

    // --- fire bed rumble: brown noise -> lowpass 400 ---
    const rumbleSrc = this.loopSource(brownBuf);
    const rumbleLp = ctx.createBiquadFilter();
    rumbleLp.type = "lowpass";
    rumbleLp.frequency.value = 400;
    this.rumbleGain = ctx.createGain();
    this.rumbleGain.gain.value = 0;
    rumbleSrc.connect(rumbleLp).connect(this.rumbleGain).connect(this.bus);
    // slow LFO so the bed "breathes"
    const rumbleLfo = ctx.createOscillator();
    rumbleLfo.frequency.value = 0.13;
    this.rumbleLfoDepth = ctx.createGain();
    this.rumbleLfoDepth.gain.value = 0;
    rumbleLfo.connect(this.rumbleLfoDepth).connect(this.rumbleGain.gain);
    rumbleLfo.start();
    this.running.push(rumbleLfo);

    // --- fire midband: pink noise -> bandpass, opens above power ~40 ---
    const midSrc = this.loopSource(pinkBuf);
    const midBp = ctx.createBiquadFilter();
    midBp.type = "bandpass";
    midBp.frequency.value = 950;
    midBp.Q.value = 0.7;
    this.midGain = ctx.createGain();
    this.midGain.gain.value = 0;
    midSrc.connect(midBp).connect(this.midGain).connect(this.bus);

    // --- wind: pink noise -> wandering bandpass ---
    const windSrc = this.loopSource(pinkBuf);
    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = "bandpass";
    this.windFilter.frequency.value = this.windFreq;
    this.windFilter.Q.value = 1;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0;
    windSrc.connect(this.windFilter).connect(this.windGain).connect(this.bus);
    const windLfo = ctx.createOscillator();
    windLfo.frequency.value = 0.06;
    this.windLfoDepth = ctx.createGain();
    this.windLfoDepth.gain.value = 0;
    windLfo.connect(this.windLfoDepth).connect(this.windGain.gain);
    windLfo.start();
    this.running.push(windLfo);
  }

  private loopSource(buf: AudioBuffer): AudioBufferSourceNode {
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    src.start(0, Math.random() * buf.duration);
    this.running.push(src);
    return src;
  }

  resume(): void {
    if (this.disposed) return;
    if (this.ctx.state === "suspended") {
      void this.ctx.resume().catch(() => {});
    }
  }

  setVolume(v: number): void {
    if (this.disposed) return;
    const g = clamp01(v);
    this.master.gain.setTargetAtTime(g * g, this.ctx.currentTime, 0.04);
  }

  /** Duck factor: 1 in play, ~0.05 paused, ~0.02 on title/result. */
  setDuck(factor: number): void {
    if (this.disposed) return;
    this.bus.gain.setTargetAtTime(clamp01(factor), this.ctx.currentTime, 0.12);
  }

  /**
   * Drive continuous layers + schedule stochastic bursts.
   * Call at ~10Hz with dt in seconds.
   */
  update(
    dt: number,
    firePower: number,
    windSpeed: number,
    speed: number,
    playing: boolean
  ): void {
    if (this.disposed || this.ctx.state !== "running") return;
    const now = this.ctx.currentTime;

    // fire bed: saturating curve of firePower (0..120)
    const p = clamp01(firePower / 120);
    const rumble = 0.6 * (1 - Math.exp(-p * 4));
    this.rumbleGain.gain.setTargetAtTime(rumble, now, 0.25);
    this.rumbleLfoDepth.gain.setTargetAtTime(rumble * 0.28, now, 0.3);

    // midband opens above power ~40
    const m = clamp01((firePower - 40) / 80);
    this.midGain.gain.setTargetAtTime(0.22 * Math.pow(m, 0.8), now, 0.3);

    // wind: audible above ~1.5, howls at 6+
    const wn = clamp01((windSpeed - 1.0) / 6);
    const wind = 0.55 * Math.pow(wn, 1.3);
    this.windGain.gain.setTargetAtTime(wind, now, 0.4);
    this.windLfoDepth.gain.setTargetAtTime(wind * 0.35, now, 0.5);
    // slowly wandering center frequency, pushed up when it howls
    this.windFreq = Math.min(
      900,
      Math.max(300, this.windFreq + (Math.random() - 0.5) * 60)
    );
    this.windFilter.frequency.setTargetAtTime(
      this.windFreq + windSpeed * 25,
      now,
      0.6
    );
    this.windFilter.Q.setTargetAtTime(1 + wn * 1.8, now, 0.6);

    if (!playing) return;

    // crackle scheduling (Poisson-ish); speed>1 raises rate subtly
    const speedMul = 1 + Math.min(Math.max(speed - 1, 0), 3) * 0.12;
    const rate =
      firePower <= 1 ? 0 : Math.min(8, Math.pow(p, 0.7) * 9) * speedMul;
    let expected = rate * dt;
    while (expected > 0) {
      if (Math.random() < expected) this.crackle(now + Math.random() * dt);
      expected -= 1;
    }

    // ember sparkle: high wind over a live fire
    if (windSpeed > 2.2 && firePower > 20) {
      const emberRate = Math.min(6, (windSpeed - 2.2) * 1.4);
      let e = emberRate * dt;
      while (e > 0) {
        if (Math.random() < e) this.emberTick(now + Math.random() * dt);
        e -= 1;
      }
    }
  }

  /** Short noise burst through a filter with an exponential decay envelope. */
  private burst(
    at: number,
    dur: number,
    peak: number,
    type: BiquadFilterType,
    freq: number,
    q: number
  ): void {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.whiteBuf;
    const filt = ctx.createBiquadFilter();
    filt.type = type;
    filt.frequency.value = freq;
    filt.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(peak, at);
    g.gain.exponentialRampToValueAtTime(0.0005, at + dur);
    src.connect(filt).connect(g).connect(this.bus);
    const maxOff = Math.max(0, this.whiteBuf.duration - dur - 0.05);
    src.start(at, Math.random() * maxOff, dur + 0.05);
  }

  private crackle(at: number): void {
    if (Math.random() < 0.14) {
      // occasional louder low pop
      this.burst(
        at,
        0.08 + Math.random() * 0.07,
        0.35 + Math.random() * 0.3,
        "bandpass",
        250 + Math.random() * 350,
        1.8
      );
    } else {
      this.burst(
        at,
        0.005 + Math.random() * 0.025,
        0.1 + Math.random() * 0.18,
        "bandpass",
        1500 + Math.random() * 2500,
        4 + Math.random() * 4
      );
    }
  }

  private emberTick(at: number): void {
    this.burst(
      at,
      0.003 + Math.random() * 0.007,
      0.04 + Math.random() * 0.07,
      "bandpass",
      5000 + Math.random() * 4000,
      3
    );
  }

  trigger(name: OneShot): void {
    if (this.disposed || this.ctx.state !== "running") return;
    const t = this.ctx.currentTime + 0.01;
    switch (name) {
      case "knock": {
        // wood placement: low thump + tiny click
        this.burst(t, 0.06, 0.7, "lowpass", 200, 0.8);
        this.burst(t, 0.012, 0.12, "bandpass", 2200, 5);
        break;
      }
      case "lighter": {
        // two quick metallic ticks + brief hiss
        this.flintTick(t);
        this.flintTick(t + 0.07);
        this.burst(t + 0.05, 0.18, 0.05, "highpass", 4000, 0.7);
        break;
      }
      case "bellows": {
        this.whoosh(t);
        break;
      }
      case "scatter": {
        // burst of tiny ticks
        for (let i = 0; i < 8; i++) {
          this.burst(
            t + Math.random() * 0.35,
            0.005 + Math.random() * 0.01,
            0.05 + Math.random() * 0.06,
            "bandpass",
            2500 + Math.random() * 3500,
            4
          );
        }
        break;
      }
    }
  }

  private flintTick(at: number): void {
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    osc.type = "square";
    osc.frequency.value = 2300 + Math.random() * 900;
    const hp = ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 1200;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.1, at);
    g.gain.exponentialRampToValueAtTime(0.0005, at + 0.018);
    osc.connect(hp).connect(g).connect(this.bus);
    osc.start(at);
    osc.stop(at + 0.03);
  }

  private whoosh(at: number): void {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.whiteBuf;
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.Q.value = 1.2;
    bp.frequency.setValueAtTime(300, at);
    bp.frequency.exponentialRampToValueAtTime(1200, at + 0.5);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0005, at);
    g.gain.linearRampToValueAtTime(0.45, at + 0.12);
    g.gain.exponentialRampToValueAtTime(0.0005, at + 0.6);
    src.connect(bp).connect(g).connect(this.bus);
    const maxOff = Math.max(0, this.whiteBuf.duration - 0.7);
    src.start(at, Math.random() * maxOff, 0.65);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const node of this.running) {
      try {
        node.stop();
      } catch {
        // already stopped
      }
    }
    this.running.length = 0;
    try {
      this.master.disconnect();
      this.bus.disconnect();
    } catch {
      // ignore
    }
    void this.ctx.close().catch(() => {});
  }
}
