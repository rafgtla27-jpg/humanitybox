/**
 * WORLD_SIM — moteur EN DIRECT (piste G1), portage TypeScript de la partie « humains » du moteur
 * Python (scénario E : dispersion, compétition avec les archaïques, culture, froid, navigation
 * d'archipel, agriculture). L'environnement est pré-calculé (env.bin.gz) ; ici on ne simule que les
 * humains, assez vite pour qu'un dieu puisse intervenir pendant que le monde tourne.
 *
 * Simplifications assumées par rapport au moteur de référence : pas de sauts de pionniers
 * lointains ; réseaux sociaux recalculés tous les 100 ans ; climat interpolé entre tranches.
 */
export const NY = 180, NX = 360, NC = NY * NX;
const DIRS: [number, number][] = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]];
const DIAG = [0.7, 1, 0.7, 1, 1, 0.7, 1, 0.7];

export type Env = { years: number[]; sea: number[]; data: Uint8Array; rough: Uint8Array; kLog: [number, number] };
export type Power = "drought" | "bless" | "plague" | "spawn" | "cold" | "boats";

const P = {
  r: 0.005, mBase: 0.0004, mPress: 0.006, pSea: 0.04, tMin: -12, tOk: 2, coldDelta: 22,
  coldGain: 1 / 8000, coldLoss: 1 / 4000, coldNcrit: 500, n0: 817, span: 40, tauGain: 2000, tauLoss: 6000,
  adv: 0.316, archC: 0.1, neanderC: 0.242, seaRef: 0.131, boatS: 0.219, seaTauGain: 3000, seaTauLoss: 6000,
  farmDensity: 2, agriRate: 1e-6, agriTau: 1500, agriLearn: 1 / 2000, noise: 0.06, alleeNet: 150, pExt: 0.004, sigma: 3,
};

function cellArea(i: number) { return 111.2 * 111.2 * Math.cos(((90 - (i + 0.5)) * Math.PI) / 180); }
const AREA = Float32Array.from({ length: NC }, (_, k) => cellArea(Math.floor(k / NX)));

/** Générateur pseudo-aléatoire rapide (xorshift), déterministe par graine. */
function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}

/** Flou gaussien séparable, longitude périodique : population d'un réseau social (× 2πσ²). */
function makeBlur(sigma: number) {
  const R = Math.ceil(3 * sigma);
  const w = Array.from({ length: 2 * R + 1 }, (_, i) => Math.exp(-((i - R) ** 2) / (2 * sigma * sigma)));
  const norm = w.reduce((a, b) => a + b, 0);
  const kern = w.map((x) => x / norm);
  const tmp = new Float32Array(NC);
  const gain = 2 * Math.PI * sigma * sigma;
  return (src: Float32Array, out: Float32Array) => {
    for (let i = 0; i < NY; i++) {
      const row = i * NX;
      for (let j = 0; j < NX; j++) {
        let s = 0;
        for (let t = -R; t <= R; t++) s += src[row + ((j + t + NX) % NX)] * kern[t + R];
        tmp[row + j] = s;
      }
    }
    for (let i = 0; i < NY; i++) for (let j = 0; j < NX; j++) {
      let s = 0;
      for (let t = -R; t <= R; t++) { const ii = i + t; if (ii >= 0 && ii < NY) s += tmp[ii * NX + j] * kern[t + R]; }
      out[i * NX + j] = s * gain;
    }
  };
}

type Effect = { kind: Power; lat: number; lon: number; radiusDeg: number; until: number; factor: number };

export class LiveEngine {
  year = -120_000;
  N = new Float32Array(NC);   // sapiens
  A = new Float32Array(NC);   // archaïques
  c = new Float32Array(NC);   // adaptation au froid
  C = new Float32Array(NC);   // complexité culturelle (sapiens)
  CA = new Float32Array(NC);  // complexité des archaïques
  S = new Float32Array(NC);   // savoir maritime
  Ag = new Float32Array(NC);  // agriculture
  // environnement interpolé
  K = new Float32Array(NC); T = new Float32Array(NC); pot = new Float32Array(NC); lf = new Float32Array(NC);
  flags = new Uint8Array(NC); conn = new Uint8Array(NC); arch = new Float32Array(NC);
  kmul = new Float32Array(NC).fill(1);
  private ceilA = new Float32Array(NC);
  private rangeA = new Uint8Array(NC);
  private net = { N: new Float32Array(NC), NC: new Float32Array(NC), Nc: new Float32Array(NC), NS: new Float32Array(NC), NAg: new Float32Array(NC), A: new Float32Array(NC), ACA: new Float32Array(NC) };
  private blur = makeBlur(P.sigma);
  private rand: () => number;
  private steps = 0;
  private effects: Effect[] = [];
  private envSlice = -1;
  events: { year: number; text: string }[] = [];

  constructor(private env: Env, seed = 1) {
    this.rand = rng(seed);
    for (let i = 0; i < NY; i++) for (let j = 0; j < NX; j++) {
      const k = i * NX + j, lat = 90 - (i + 0.5), lon = -180 + (j + 0.5);
      const africa = lat >= -35 && lat <= 12 && lon >= -18 && lon <= 52;
      const eurasia = lat >= -11 && lat <= 55 && lon >= -12 && lon <= 145 && !(lon >= 129.5 && lon <= 146) && !africa && !(lat <= 33 && lon >= -20 && lon <= 33);
      this.rangeA[k] = eurasia ? 1 : 0;
      this.ceilA[k] = lat >= 30 && lon < 90 ? P.neanderC : P.archC;
    }
    this.loadEnv();
    for (let k = 0; k < NC; k++) {
      const i = Math.floor(k / NX), j = k % NX, lat = 90 - (i + 0.5), lon = -180 + (j + 0.5);
      if (lat >= -35 && lat <= 12 && lon >= -18 && lon <= 52) this.N[k] = 0.5 * this.K[k];
      if (this.rangeA[k]) this.A[k] = 0.6 * this.K[k];
    }
    this.networks();
    for (let k = 0; k < NC; k++) {
      this.C[k] = this.N[k] > 0 ? this.cxTarget(this.net.N[k], 1) : 0;
      this.CA[k] = this.A[k] > 0 ? this.cxTarget(this.net.A[k], this.ceilA[k]) : 0;
    }
  }

  private cxTarget(n: number, ceil: number) {
    return ceil * Math.min(1, Math.max(0, Math.log(Math.max(n, 1) / P.n0) / Math.log(P.span)));
  }

  /** Environnement interpolé entre deux tranches cuites. */
  private loadEnv() {
    const ys = this.env.years;
    let s = 0;
    while (s < ys.length - 2 && this.year > ys[s + 1]) s++;
    const w = Math.min(1, Math.max(0, (this.year - ys[s]) / (ys[s + 1] - ys[s])));
    const F = 9, d = this.env.data, [kLo, kSpan] = this.env.kLog;
    const at = (slice: number, f: number, k: number) => d[(slice * F + f) * NC + k];
    const deK = (q: number) => (q ? 10 ** (kLo + ((q - 1) / 254) * kSpan) : 0);
    for (let k = 0; k < NC; k++) {
      this.K[k] = deK(at(s, 0, k)) * (1 - w) + deK(at(s + 1, 0, k)) * w;
      const t0 = at(s, 1, k), t1 = at(s + 1, 1, k);
      this.T[k] = t0 && t1 ? -40 + (75 * ((t0 * (1 - w) + t1 * w) - 1)) / 254 : -30;
      this.pot[k] = (at(s, 4, k) * (1 - w) + at(s + 1, 4, k) * w) / 255;
      this.lf[k] = (at(s, 5, k) * (1 - w) + at(s + 1, 5, k) * w) / 255;
    }
    const near = w < 0.5 ? s : s + 1;
    if (near !== this.envSlice) {
      this.envSlice = near;
      this.flags.set(d.subarray((near * F + 6) * NC, (near * F + 7) * NC));
      this.conn.set(d.subarray((near * F + 7) * NC, (near * F + 8) * NC));
      this.archipelago();
    }
  }

  /** Indice d'archipel régional : liens maritimes autour de soi, moyennés sur la portée du réseau. */
  private archipelago() {
    const raw = new Float32Array(NC), landm = new Float32Array(NC);
    for (let i = 0; i < NY; i++) for (let j = 0; j < NX; j++) {
      const k = i * NX + j;
      if (!(this.flags[k] & 1)) continue;
      landm[k] = 1;
      let v = 0;
      DIRS.forEach(([di, dj], b) => {
        const ii = i + di; if (ii < 0 || ii >= NY) return;
        const kk = ii * NX + ((j + dj + NX) % NX);
        if (this.flags[kk] & 1 && !((this.conn[k] >> b) & 1)) v += 1;
        const i2 = i + 2 * di; if (i2 < 0 || i2 >= NY) return;
        const k2 = i2 * NX + ((j + 2 * dj + NX) % NX);
        if (!(this.flags[kk] & 1) && this.flags[k2] & 1) v += 0.5;
      });
      raw[k] = v / 8;
    }
    const a = new Float32Array(NC), b = new Float32Array(NC);
    for (let k = 0; k < NC; k++) raw[k] *= landm[k];
    this.blur(raw, a); this.blur(landm, b);
    for (let k = 0; k < NC; k++) this.arch[k] = b[k] > 1e-6 ? a[k] / b[k] : 0;
  }

  private networks() {
    const tmp = new Float32Array(NC);
    this.blur(this.N, this.net.N);
    for (const [key, X] of [["NC", this.C], ["Nc", this.c], ["NS", this.S], ["NAg", this.Ag]] as const) {
      for (let k = 0; k < NC; k++) tmp[k] = this.N[k] * X[k];
      this.blur(tmp, this.net[key]);
    }
    this.blur(this.A, this.net.A);
    for (let k = 0; k < NC; k++) tmp[k] = this.A[k] * this.CA[k];
    this.blur(tmp, this.net.ACA);
  }

  private carried(X: Float32Array, net: Float32Array, k: number) {
    const n = this.net.N[k];
    return Math.max(X[k], n > 1e-6 ? net[k] / n : 0);
  }

  /** Pouvoirs divins : ils agissent sur les CAUSES du modèle (ressources, survie, savoir). */
  applyPower(kind: Power, lat: number, lon: number) {
    const radiusDeg = kind === "spawn" ? 2 : 6;
    const dur = { drought: 400, bless: 600, plague: 0, spawn: 0, cold: 500, boats: 0 }[kind];
    const factor = { drought: 0.25, bless: 1.8, plague: 0.35, spawn: 0, cold: 1, boats: 0 }[kind];
    if (dur > 0) this.effects.push({ kind, lat, lon, radiusDeg, until: this.year + dur, factor });
    this.forEachInRadius(lat, lon, radiusDeg, (k, w) => {
      if (kind === "plague") { this.N[k] *= 1 - (1 - factor) * w; this.A[k] *= 1 - (1 - factor) * w; }
      if (kind === "spawn" && this.flags[k] & 1) {
        const add = 1500 * w;
        const tot = this.N[k] + add;
        this.C[k] = (this.C[k] * this.N[k] + 0.85 * add) / tot;
        this.c[k] = (this.c[k] * this.N[k] + 0.5 * add) / tot;
        this.N[k] = tot;
      }
      if (kind === "boats") this.S[k] = Math.max(this.S[k], 0.8 * w);
    });
    const names: Record<Power, string> = { drought: "Sécheresse", bless: "Bénédiction de fertilité", plague: "Épidémie", spawn: "Naissance d'un peuple", cold: "Grand froid", boats: "Don des embarcations" };
    this.events.push({ year: this.year, text: `${names[kind]} (${lat.toFixed(0)}°, ${lon.toFixed(0)}°)` });
  }

  private forEachInRadius(lat: number, lon: number, rDeg: number, fn: (k: number, w: number) => void) {
    const la = (lat * Math.PI) / 180, lo = (lon * Math.PI) / 180, cosR = Math.cos((rDeg * Math.PI) / 180);
    const i0 = Math.max(0, Math.floor(90 - lat - rDeg - 1)), i1 = Math.min(NY - 1, Math.ceil(90 - lat + rDeg + 1));
    for (let i = i0; i <= i1; i++) {
      const cla = ((90 - (i + 0.5)) * Math.PI) / 180;
      for (let j = 0; j < NX; j++) {
        const clo = ((-180 + (j + 0.5)) * Math.PI) / 180;
        const cosd = Math.sin(la) * Math.sin(cla) + Math.cos(la) * Math.cos(cla) * Math.cos(clo - lo);
        if (cosd < cosR) continue;
        const d = Math.acos(Math.min(1, cosd)) / ((rDeg * Math.PI) / 180);
        fn(i * NX + j, 1 - 0.5 * d * d);
      }
    }
  }

  private applyEffects() {
    this.kmul.fill(1);
    this.effects = this.effects.filter((e) => e.until > this.year);
    for (const e of this.effects) {
      this.forEachInRadius(e.lat, e.lon, e.radiusDeg, (k, w) => {
        if (e.kind === "cold") this.T[k] -= 8 * w; else this.kmul[k] *= 1 + (e.factor - 1) * w;
      });
    }
  }

  step(dt = 20) {
    this.loadEnv();
    this.applyEffects();
    if (this.steps % 5 === 0) this.networks();
    this.steps++;
    const { N, A } = this;
    const Ks = new Float32Array(NC), Ka = new Float32Array(NC), loadS = new Float32Array(NC), loadA = new Float32Array(NC);
    const cE = new Float32Array(NC), CE = new Float32Array(NC), SE = new Float32Array(NC), AgE = new Float32Array(NC);
    for (let k = 0; k < NC; k++) {
      cE[k] = this.carried(this.c, this.net.Nc, k);
      CE[k] = this.carried(this.C, this.net.NC, k);
      SE[k] = this.carried(this.S, this.net.NS, k);
      AgE[k] = this.carried(this.Ag, this.net.NAg, k);
      const nA = this.net.A[k], CAe = Math.max(this.CA[k], nA > 1e-6 ? this.net.ACA[k] / nA : 0);
      const base = this.K[k] * this.kmul[k];
      const cold = (c: number) => { const tmin = P.tMin - P.coldDelta * c; return Math.min(1, Math.max(0, (this.T[k] - tmin) / (P.tOk - tmin))); };
      Ks[k] = base * cold(cE[k]) + P.farmDensity * AREA[k] * this.lf[k] * this.pot[k] * AgE[k] * this.kmul[k];
      Ka[k] = base * cold(0.4);
      const adv = Math.max(-0.5, Math.min(0.5, P.adv * (CE[k] - CAe)));
      loadS[k] = N[k] + (1 - adv) * A[k];
      loadA[k] = A[k] + (1 + adv) * N[k];
    }
    // 1. croissance
    for (let k = 0; k < NC; k++) {
      N[k] = Ks[k] > 0 ? N[k] * Math.exp(Math.max(-3, Math.min(1, P.r * dt * (1 - loadS[k] / Ks[k])))) : N[k] * 0.5;
      A[k] = Ka[k] > 0 ? A[k] * Math.exp(Math.max(-3, Math.min(1, P.r * dt * (1 - loadA[k] / Ka[k])))) : A[k] * 0.5;
    }
    // 2. migration (sapiens : à pied, détroits et sauts d'une cellule d'eau si savoir maritime)
    this.migrate(N, Ks, loadS, true, [this.c, this.C, this.S, this.Ag], SE, dt);
    this.migrate(A, Ka, loadA, false, [this.CA], null, dt);
    // 3. hasard démographique et extinction des réseaux trop petits
    const pDie = 1 - (1 - P.pExt) ** dt;
    for (let k = 0; k < NC; k++) {
      if (N[k] > 0) {
        const g = Math.sqrt(-2 * Math.log(this.rand() + 1e-12)) * Math.cos(2 * Math.PI * this.rand());
        N[k] = Math.max(0, N[k] + Math.sqrt(N[k] * P.noise * dt) * g);
        if ((this.net.N[k] < P.alleeNet && this.rand() < pDie) || N[k] < 1) N[k] = 0;
      }
      if (A[k] > 0 && ((this.net.A[k] < P.alleeNet && this.rand() < pDie) || A[k] < 1)) A[k] = 0;
    }
    // 4. cultures
    const kg = 1 - Math.exp(-dt / P.tauGain), kl = 1 - Math.exp(-dt / P.tauLoss);
    const sg = 1 - Math.exp(-dt / P.seaTauGain), sl = 1 - Math.exp(-dt / P.seaTauLoss);
    const ag = 1 - Math.exp(-dt / P.agriTau), al = 1 - Math.exp(-dt * P.agriLearn);
    for (let k = 0; k < NC; k++) {
      if (N[k] <= 0) { this.C[k] = this.c[k] = this.S[k] = this.Ag[k] = 0; } else {
        const net = this.net.N[k];
        const tC = this.cxTarget(net, 1);
        this.C[k] += (tC - this.C[k]) * (tC > this.C[k] ? kg : kl);
        const big = net >= P.coldNcrit;
        if (big && this.T[k] < P.tOk + 5) this.c[k] += P.coldGain * this.C[k] * dt * (1 - this.c[k]);
        if (!big) this.c[k] -= P.coldLoss * dt * this.c[k];
        const tS = Math.min(1, this.arch[k] / P.seaRef) * this.C[k];
        this.S[k] += (tS - this.S[k]) * (tS > this.S[k] ? sg : sl);
        // agriculture : invention rare, développement, apprentissage auprès des voisins
        const pr = Math.min(1.5, N[k] / Math.max(Ks[k], 1e-9));
        if (this.Ag[k] < 0.05 && N[k] > 50 && this.C[k] > 0.6 && this.rand() < P.agriRate * dt * this.pot[k] * this.C[k] * pr) {
          this.Ag[k] = 0.15;
          const i = Math.floor(k / NX), j = k % NX;
          this.events.push({ year: this.year, text: `Naissance de l'agriculture (${(90 - i - 0.5).toFixed(0)}°, ${(-180 + j + 0.5).toFixed(0)}°)` });
        }
        const tA = this.pot[k] * this.C[k];
        if (this.Ag[k] > 0 && tA > this.Ag[k]) this.Ag[k] += (tA - this.Ag[k]) * ag;
        const nb = net > 1e-6 ? this.net.NAg[k] / net : 0;
        if (nb > this.Ag[k] && this.pot[k] > 0.1) this.Ag[k] += Math.max(0, Math.min(nb, this.pot[k]) - this.Ag[k]) * al;
      }
      if (A[k] <= 0) this.CA[k] = 0; else {
        const tCA = this.cxTarget(this.net.A[k], this.ceilA[k]);
        this.CA[k] += (tCA - this.CA[k]) * (tCA > this.CA[k] ? kg : kl);
      }
    }
    this.year += dt;
  }

  private migrate(X: Float32Array, K: Float32Array, load: Float32Array, sapiens: boolean, traits: Float32Array[], sea: Float32Array | null, dt: number) {
    const room = new Float32Array(NC);
    for (let k = 0; k < NC; k++) {
      if (K[k] <= 0 || !(this.flags[k] & 1) || (!sapiens && !this.rangeA[k])) continue;
      room[k] = Math.max(0, Math.min(1, 1 - load[k] / K[k])) * (this.env.rough[k] / 255);
    }
    const dX = new Float32Array(NC);
    const dT = traits.map(() => new Float32Array(NC));
    const wts = new Float32Array(24), dest = new Int32Array(24);
    for (let i = 0; i < NY; i++) for (let j = 0; j < NX; j++) {
      const k = i * NX + j;
      if (X[k] <= 0) continue;
      const boats = sea ? Math.min(1, Math.max(0, (sea[k] - P.boatS) / (1 - P.boatS))) : 0;
      let W = 0, n = 0;
      for (let b = 0; b < 8; b++) {
        const [di, dj] = DIRS[b];
        const ii = i + di; if (ii < 0 || ii >= NY) continue;
        const kk = ii * NX + ((j + dj + NX) % NX);
        const linked = (this.conn[k] >> b) & 1;
        let w = room[kk] * DIAG[b] * (linked ? 1 : sapiens ? P.pSea * boats : 0);
        if (w > 0) { wts[n] = w; dest[n] = kk; n++; W += w; }
        if (sapiens && boats > 0 && !(this.flags[kk] & 1)) {
          const i2 = i + 2 * di; if (i2 < 0 || i2 >= NY) continue;
          const k2 = i2 * NX + ((j + 2 * dj + NX) % NX);
          w = room[k2] * DIAG[b] * P.pSea * boats;
          if (w > 0) { wts[n] = w; dest[n] = k2; n++; W += w; }
        }
      }
      if (W <= 0) continue;
      const pressure = K[k] > 0 ? Math.min(3, load[k] / K[k]) : 3;
      const out = X[k] * Math.min(0.5, (P.mBase + P.mPress * pressure) * dt);
      dX[k] -= out;
      traits.forEach((Tr, t) => { dT[t][k] -= out * Tr[k]; });
      for (let q = 0; q < n; q++) {
        const f = (out * wts[q]) / W;
        dX[dest[q]] += f;
        traits.forEach((Tr, t) => { dT[t][dest[q]] += f * Tr[k]; });
      }
    }
    for (let k = 0; k < NC; k++) {
      if (dX[k] === 0) continue;
      const before = X[k];
      const after = Math.max(0, before + dX[k]);
      traits.forEach((Tr, t) => { Tr[k] = after > 1e-9 ? Math.min(1, Math.max(0, (Tr[k] * before + dT[t][k]) / after)) : 0; });
      X[k] = after;
    }
  }

  totals() {
    let s = 0, a = 0;
    for (let k = 0; k < NC; k++) { s += this.N[k]; a += this.A[k]; }
    return { sapiens: s, archaic: a };
  }

  seaLevel() {
    const ys = this.env.years, sl = this.env.sea;
    let s = 0;
    while (s < ys.length - 2 && this.year > ys[s + 1]) s++;
    const w = Math.min(1, Math.max(0, (this.year - ys[s]) / (ys[s + 1] - ys[s])));
    return sl[s] * (1 - w) + sl[s + 1] * w;
  }
}
