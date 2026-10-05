/// <reference lib="webworker" />
/**
 * Le monde tourne ici, en arrière-plan : la page reste fluide pendant que le moteur calcule.
 * Messages reçus : play / pause / speed / power. Messages envoyés : snapshot (≈ 6 par seconde).
 */
import { LiveEngine, NC, type Env, type Power } from "./engine";

let engine: LiveEngine | null = null;
let env: Env | null = null;
let playing = true;
let yearsPerSecond = 600;
let lastPost = 0;
let sentEvents = 0;

async function gunzip(url: string): Promise<Uint8Array> {
  const res = await fetch(url);
  const buf = new Uint8Array(await res.arrayBuffer());
  if (buf[0] === 0x1f && buf[1] === 0x8b) {
    const stream = new Blob([buf]).stream().pipeThrough(new DecompressionStream("gzip"));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }
  return buf;
}

const LO = Math.log10(1e-3), SPAN = Math.log10(0.5) - LO;
const qDensity = (people: number, area: number) => {
  if (people < 1 || area <= 0) return 0;
  const t = (Math.log10(people / area) - LO) / SPAN;
  return t < -0.05 ? 0 : 1 + Math.round(254 * Math.min(1, Math.max(0, t)));
};

function snapshot() {
  if (!engine || !env) return;
  const e = engine, F = 9;
  const ys = env.years;
  let s = 0;
  while (s < ys.length - 1 && e.year > (ys[s] + (ys[s + 1] ?? ys[s])) / 2) s++;
  const frames = new Uint8Array(3 * NC), climate = new Uint8Array(3 * NC), extra = new Uint8Array(5 * NC);
  for (let k = 0; k < NC; k++) {
    const i = Math.floor(k / 360);
    const area = 111.2 * 111.2 * Math.cos(((90 - (i + 0.5)) * Math.PI) / 180) * Math.max(e.lf[k], 1e-3);
    frames[k] = (e.lf[k] > 0.3 ? 1 : 0) | (e.flags[k] & 2);
    frames[NC + k] = qDensity(e.N[k], area);
    frames[2 * NC + k] = qDensity(e.A[k], area);
    climate[k] = env.data[(s * F + 1) * NC + k];
    climate[NC + k] = env.data[(s * F + 2) * NC + k];
    climate[2 * NC + k] = env.data[(s * F + 3) * NC + k];
    extra[k] = env.data[(s * F + 8) * NC + k];
    const has = e.N[k] >= 1;
    extra[NC + k] = has ? 1 + Math.round(254 * e.c[k]) : 0;
    extra[2 * NC + k] = has ? 1 + Math.round(254 * e.C[k]) : 0;
    extra[3 * NC + k] = has ? 1 + Math.round(254 * e.S[k]) : 0;
    extra[4 * NC + k] = has ? 1 + Math.round(254 * e.Ag[k]) : 0;
  }
  const events = e.events.slice(sentEvents);
  sentEvents = e.events.length;
  const t = e.totals();
  (self as unknown as Worker).postMessage(
    { type: "snapshot", year: e.year, sea: e.seaLevel(), frames, climate, extra, totals: t, events, playing, yearsPerSecond },
    [frames.buffer, climate.buffer, extra.buffer],
  );
}

function loop() {
  if (engine && playing && engine.year < 0) {
    const t0 = performance.now();
    const target = (yearsPerSecond * 50) / 1000; // années à simuler pendant ce tic de 50 ms
    let done = 0;
    while (done < target && performance.now() - t0 < 40 && engine.year < 0) { engine.step(20); done += 20; }
  }
  if (performance.now() - lastPost > 160) { lastPost = performance.now(); snapshot(); }
  setTimeout(loop, 50);
}

self.onmessage = async (ev: MessageEvent) => {
  const m = ev.data;
  if (m.type === "init") {
    const meta = await (await fetch("/live/env.json")).json();
    const [data, rough] = await Promise.all([gunzip("/live/env.bin.gz"), gunzip("/live/rough.bin.gz")]);
    env = { years: meta.years, sea: meta.sea_level, data, rough, kLog: meta.K_log };
    engine = new LiveEngine(env, m.seed ?? Math.floor(Math.random() * 1e9));
    (self as unknown as Worker).postMessage({ type: "ready" });
    loop();
  } else if (m.type === "play") playing = true;
  else if (m.type === "pause") playing = false;
  else if (m.type === "speed") yearsPerSecond = m.value;
  else if (m.type === "power" && engine) { engine.applyPower(m.kind as Power, m.lat, m.lon); snapshot(); }
  else if (m.type === "reset" && env) { engine = new LiveEngine(env, Math.floor(Math.random() * 1e9)); sentEvents = 0; }
};
