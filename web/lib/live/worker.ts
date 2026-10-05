/// <reference lib="webworker" />
/**
 * Le monde tourne ici, en arrière-plan : la page reste fluide pendant que le moteur calcule.
 * Messages reçus : play / pause / speed / power. Messages envoyés : snapshot (≈ 6 par seconde).
 */
import { LiveEngine, NC, type Env, type Power } from "./engine";
import { NT, TECHS } from "./techs";

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
  const frames = new Uint8Array(3 * NC), climate = new Uint8Array(3 * NC), extra = new Uint8Array(8 * NC);
  // Savoirs : niveau par cellule, part de l'humanité qui maîtrise chacun, savoirs de chaque village
  const share = new Float64Array(NT);
  let total = 0;
  const agriT = TECHS.findIndex((t) => t.id === "agri");
  for (let k = 0; k < NC; k++) {
    if (e.N[k] < 1) continue;
    total += e.N[k];
    let n = 0;
    for (let t = 0; t < NT; t++) {
      const v = t === agriT ? Math.min(1, e.Ag[k] / 0.35) : e.tech[t * NC + k];
      if (v >= 0.5) { n++; share[t] += e.N[k]; }
    }
    extra[7 * NC + k] = 1 + Math.round((254 * n) / NT);
  }
  const techStatus = TECHS.map((t, i) => ({ id: t.id, first: e.techFirst[i], share: total ? share[i] / total : 0 }));
  // âge de chaque cellule = âge du village qui la possède (pour l'architecture)
  const st = e.settlements;
  for (let y = 0; y < 360; y++) for (let x = 0; x < 720; x++) {
    const o = st.owner[y * 720 + x];
    if (!o) continue;
    const sAge = st.list[o - 1]?.age ?? 0;
    const k = Math.floor(y / 2) * 360 + Math.floor(x / 2);
    if (sAge > extra[6 * NC + k]) extra[6 * NC + k] = sAge;
  }
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
    extra[5 * NC + k] = e.peopleIdx[k];
  }
  const events = e.events.slice(sentEvents);
  sentEvents = e.events.length;
  const t = e.totals();
  (self as unknown as Worker).postMessage(
    { type: "snapshot", year: e.year, sea: e.seaLevel(), frames, climate, extra, totals: t, events, playing, yearsPerSecond, peoples: e.peoples,
      owner: st.owner.slice(), polities: st.polities, techStatus,
      settlements: st.list.map((x) => ({ ...x, techs: x.alive ? TECHS.filter((t, i) => (t.id === "agri" ? Math.min(1, e.Ag[x.k] / 0.35) : e.tech[i * NC + x.k]) >= 0.5).map((t) => t.id) : [] })) },
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
    engine = new LiveEngine(env, m.seed ?? Math.floor(Math.random() * 1e9), m.startYear ?? -120_000);
    engine.identifyPeoples();
    (self as unknown as Worker).postMessage({ type: "ready" });
    loop();
  } else if (m.type === "play") playing = true;
  else if (m.type === "pause") playing = false;
  else if (m.type === "speed") yearsPerSecond = m.value;
  else if (m.type === "power" && engine) { engine.applyPower(m.kind as Power, m.lat, m.lon); snapshot(); }
  else if (m.type === "reset" && env) { engine = new LiveEngine(env, Math.floor(Math.random() * 1e9), m.startYear ?? -120_000); engine.identifyPeoples(); sentEvents = 0; }
};
