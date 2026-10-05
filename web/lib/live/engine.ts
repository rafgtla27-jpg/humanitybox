/**
 * WORLD_SIM — moteur EN DIRECT (piste G1), portage TypeScript de la partie « humains » du moteur
 * Python (scénario E : dispersion, compétition avec les archaïques, culture, froid, navigation
 * d'archipel, agriculture). L'environnement est pré-calculé (env.bin.gz) ; ici on ne simule que les
 * humains, assez vite pour qu'un dieu puisse intervenir pendant que le monde tourne.
 *
 * Simplifications assumées par rapport au moteur de référence : pas de sauts de pionniers
 * lointains ; réseaux sociaux recalculés tous les 100 ans ; climat interpolé entre tranches.
 */
import { Settlements } from "./settlements";
import { NT, TECHS, TECH_INDEX, type Ctx } from "./techs";
export const NY = 180, NX = 360, NC = NY * NX;
/** Décalage de chaque savoir dans le tableau `tech` (évite des recherches dans la boucle chaude). */
const TO = Object.fromEntries(TECHS.map((t, i) => [t.id, i * 180 * 360])) as Record<string, number>;
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

export type People = {
  id: number; name: string; color: [number, number, number]; pop: number; cells: number;
  lat: number; lon: number; agri: number; sea: number; C: number; parent: number | null; born: number; alive: boolean;
  peak: number;
};

const SYL_A = ["ka", "ta", "ma", "na", "ra", "sa", "lo", "ki", "mu", "te", "zu", "ya", "be", "do", "ha", "ni", "so", "ru", "ve", "an", "el", "or", "ish", "ul"];
const SYL_B = ["", "n", "r", "k", "sh", "m", "l", "t"];
export function peopleName(id: number) {
  const r = rng(id * 7919 + 13);
  const n = 2 + Math.floor(r() * 2);
  let w = "";
  for (let i = 0; i < n; i++) {
    const syl = SYL_A[Math.floor(r() * SYL_A.length)];
    // pas de grappe imprononçable : une finale seulement après une voyelle
    w += syl + (i === n - 1 && /[aeiou]$/.test(syl) ? SYL_B[Math.floor(r() * SYL_B.length)] : "");
  }
  return w.charAt(0).toUpperCase() + w.slice(1);
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const f = (n: number) => { const k = (n + h * 12) % 12; const a = s * Math.min(l, 1 - l); return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)))); };
  return [f(0), f(8), f(4)];
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
  // G3 : marqueurs culturels neutres (langue, style) → peuples émergents
  M0 = new Float32Array(NC); M1 = new Float32Array(NC); M2 = new Float32Array(NC);
  peopleIdx = new Uint8Array(NC);
  peoples: People[] = [];
  settlements = new Settlements();
  // Graphe des savoirs : maîtrise de chaque savoir, par cellule (TECHS[t] → tech[t * NC + k])
  tech = new Float32Array(NT * NC);
  techFirst: ({ year: number; where: string } | null)[] = TECHS.map(() => null);
  ore = new Float32Array(NC);
  Pr = new Float32Array(NC);
  river = new Float32Array(NC);
  private nextPeopleId = 1;
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
  events: { year: number; text: string; people?: number; settlement?: number }[] = [];

  constructor(private env: Env, seed = 1, startYear = -120_000) {
    this.rand = rng(seed);
    this.year = startYear;
    for (let i = 0; i < NY; i++) for (let j = 0; j < NX; j++) {
      const k = i * NX + j, lat = 90 - (i + 0.5), lon = -180 + (j + 0.5);
      const africa = lat >= -35 && lat <= 12 && lon >= -18 && lon <= 52;
      const eurasia = lat >= -11 && lat <= 55 && lon >= -12 && lon <= 145 && !(lon >= 129.5 && lon <= 146) && !africa && !(lat <= 33 && lon >= -20 && lon <= 33);
      this.rangeA[k] = eurasia ? 1 : 0;
      this.ceilA[k] = lat >= 30 && lon < 90 ? P.neanderC : P.archC;
    }
    this.loadEnv();
    // Minerais : surtout dans les reliefs tourmentés (montagnes), répartis par un hasard fixe
    for (let k = 0; k < NC; k++) {
      const rough = -700 * Math.log(Math.max(1e-3, this.env.rough[k] / 255));
      const h = ((Math.imul(k ^ 0x9e3779b9, 2654435761) >>> 0) % 1000) / 1000;
      this.ore[k] = h < Math.min(0.6, rough / 900) ? 1 : h < 0.04 ? 0.6 : 0;
    }
    const fire = TECH_INDEX.get("fire")!, stone = TECH_INDEX.get("stone")!;
    this.tech.fill(1, fire * NC, (fire + 1) * NC);
    this.tech.fill(1, stone * NC, (stone + 1) * NC);
    for (let k = 0; k < NC; k++) {
      const i = Math.floor(k / NX), j = k % NX, lat = 90 - (i + 0.5), lon = -180 + (j + 0.5);
      if (startYear > -70_000) {
        // Partie commencée plus tard : le monde est déjà peuplé là où l'on peut vivre
        this.N[k] = 0.5 * this.K[k];
        if (startYear > -40_000) continue;
      } else if (lat >= -35 && lat <= 12 && lon >= -18 && lon <= 52) this.N[k] = 0.5 * this.K[k];
      if (this.rangeA[k]) this.A[k] = 0.6 * this.K[k];
    }
    // Structure ancienne de l'Afrique : des marqueurs qui varient doucement d'une région à l'autre
    const phase = this.rand() * 6.28;
    for (let k = 0; k < NC; k++) {
      const i = Math.floor(k / NX), j = k % NX, lat = 90 - (i + 0.5), lon = -180 + (j + 0.5);
      this.M0[k] = 0.5 + 0.38 * Math.sin(lat / 6 + phase);
      this.M1[k] = 0.5 + 0.38 * Math.cos(lon / 7 + phase * 0.7);
      this.M2[k] = 0.5 + 0.3 * Math.sin((lat + lon) / 9);
    }
    this.networks();
    for (let k = 0; k < NC; k++) {
      if (startYear > -70_000 && this.N[k] > 0) { this.c[k] = 0.8; this.S[k] = Math.min(1, this.arch[k] / P.seaRef) * 0.8; }
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
      for (let k = 0; k < NC; k++) {
        const q = d[(near * F + 2) * NC + k];
        this.Pr[k] = q ? 10 ** (1 + ((q - 1) / 254) * (Math.log10(4000) - 1)) : 0;
        const r = d[(near * F + 8) * NC + k];
        this.river[k] = r >= 109 ? Math.min(1, (r - 109) / 120) : 0;
      }
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
      const tg = (id: string) => this.tech[TO[id] + k];
      const wild = 1 + 0.15 * tg("bow") + 0.3 * tg("fishing") * Math.max(this.river[k], this.arch[k] > 0 ? 1 : 0)
        + 0.5 * tg("herding") * this.steppe(k);
      const farmBoost = 1 + 0.6 * tg("irrigation") * this.river[k] * Math.min(1, Math.max(0, (700 - this.Pr[k]) / 500))
        + 0.4 * tg("plough") + 0.2 * tg("iron") + 0.3 * tg("mill") + 0.5 * tg("steam") + 0.5 * tg("electricity");
      Ks[k] = base * wild * cold(cE[k]) + P.farmDensity * AREA[k] * this.lf[k] * this.pot[k] * AgE[k] * this.kmul[k] * farmBoost;
      Ka[k] = base * cold(0.4);
      const adv = Math.max(-0.5, Math.min(0.5, P.adv * (CE[k] - CAe)));
      loadS[k] = N[k] + (1 - adv) * A[k];
      loadA[k] = A[k] + (1 + adv) * N[k];
    }
    // 1. croissance
    for (let k = 0; k < NC; k++) {
      const storage = this.tech[TO.storage + k], med = this.tech[TO.medicine + k];
      N[k] = Ks[k] > 0 ? N[k] * Math.exp(Math.max(-3 * (1 - 0.7 * storage), Math.min(1, P.r * (1 + med) * dt * (1 - loadS[k] / Ks[k])))) : N[k] * 0.5;
      A[k] = Ka[k] > 0 ? A[k] * Math.exp(Math.max(-3, Math.min(1, P.r * dt * (1 - loadA[k] / Ka[k])))) : A[k] * 0.5;
    }
    // 2. migration (sapiens : à pied, détroits et sauts d'une cellule d'eau si savoir maritime)
    const wasEmpty = new Uint8Array(NC);
    for (let k = 0; k < NC; k++) wasEmpty[k] = N[k] < 1 ? 1 : 0;
    this.migrate(N, Ks, loadS, true, [this.c, this.C, this.S, this.Ag, this.M0, this.M1, this.M2], SE, dt);
    // Dérive culturelle : effet fondateur (un petit groupe qui s'installe s'écarte de ses ancêtres)
    // et dérive lente des petites populations. Les barrières (mer, désert) laissent les écarts grandir.
    for (let k = 0; k < NC; k++) {
      if (N[k] < 1) continue;
      const amp = (wasEmpty[k] ? 0.035 : 0.004 * Math.sqrt(dt / 20)) / (1 + Math.log10(1 + N[k] / 500));
      this.M0[k] = Math.min(1, Math.max(0, this.M0[k] + amp * (this.rand() * 2 - 1)));
      this.M1[k] = Math.min(1, Math.max(0, this.M1[k] + amp * (this.rand() * 2 - 1)));
      this.M2[k] = Math.min(1, Math.max(0, this.M2[k] + amp * (this.rand() * 2 - 1)));
    }
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
        if (big && this.T[k] < P.tOk + 5) this.c[k] += P.coldGain * this.C[k] * (1 + 2 * this.tech[TO.sewing + k]) * dt * (1 - this.c[k]);
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
    if (this.steps % 5 === 0) this.updateTechs(100);
    if (this.steps % 25 === 1) { this.identifyPeoples(); this.updateSettlements(); }
  }

  steppe(k: number) {
    const p = this.Pr[k];
    return this.T[k] > -2 && p > 200 && p < 750 ? Math.min(1, (p - 200) / 150, (750 - p) / 150) : 0;
  }

  /** Savoirs : invention là où tout s'y prête, développement, diffusion entre voisins, oubli. */
  updateTechs(dt: number) {
    const agriIdx = TECH_INDEX.get("agri")!;
    const sci = TECH_INDEX.get("science")!, print = TECH_INDEX.get("printing")!;
    // maîtrise de l'agriculture : rapportée à ce que permet le milieu (0,35 ≈ pleinement agricole)
    const m = (t: number, k: number) => (t === agriIdx ? Math.min(1, this.Ag[k] / 0.35) : this.tech[t * NC + k]);
    const pre = TECHS.map((t) => t.pre.map((id) => TECH_INDEX.get(id)!));
    const next = this.tech.slice();
    for (let k = 0; k < NC; k++) {
      const N = this.N[k];
      if (N < 30) { for (let t = 0; t < NT; t++) next[t * NC + k] = 0; continue; }
      const i = Math.floor(k / NX), j = k % NX;
      const area = AREA[k] * Math.max(this.lf[k], 1e-3);
      const ctx: Ctx = {
        T: this.T[k], P: this.Pr[k], river: this.river[k], arch: this.arch[k], coast: this.lf[k] < 0.98 && this.lf[k] > 0.02,
        ore: this.ore[k], steppe: this.steppe(k), density: N / area, net: this.net.N[k], C: this.C[k], agri: this.Ag[k], pop: N,
      };
      const speed = (1 + m(sci, k)) * (1 + m(print, k));
      for (let t = 0; t < NT; t++) {
        const tech = TECHS[t];
        if (t === agriIdx || tech.rate === 0) continue;
        const cur = this.tech[t * NC + k];
        let ok = 1;
        for (const q of pre[t]) ok = Math.min(ok, m(q, k));
        let v = cur;
        // 1. invention : préalables maîtrisés × opportunité × savoir-faire × taille du réseau
        if (cur < 0.05 && ok >= 0.4) {
          const pr = tech.rate * [1, 6, 3, 2.5, 3][tech.era] * dt * speed * tech.cond(ctx) * this.C[k] * Math.min(1, ctx.net / Math.max(1, tech.minNet));
          if (this.rand() < pr) {
            v = 0.2;
            if (!this.techFirst[t]) {
              const ppl = this.peoples[this.peopleIdx[k] - 1];
              this.techFirst[t] = { year: this.year, where: ppl ? `les ${ppl.name}` : `${(90 - i - 0.5).toFixed(0)}°, ${(-180 + j + 0.5).toFixed(0)}°` };
              this.events.push({ year: this.year, text: `Invention : ${tech.name.toLowerCase()} (${this.techFirst[t]!.where})` });
            }
          }
        }
        // 2. diffusion : on apprend d'un voisin qui maîtrise mieux, si on en a les préalables
        if (ok >= 0.3) {
          let best = 0;
          for (const [di, dj, b] of [[-1, 0, 1], [1, 0, 6], [0, -1, 3], [0, 1, 4]] as const) {
            const ii = i + di; if (ii < 0 || ii >= NY || !((this.conn[k] >> b) & 1)) continue;
            const kk = ii * NX + ((j + dj + NX) % NX);
            if (this.N[kk] >= 30) best = Math.max(best, this.tech[t * NC + kk]);
          }
          if (best > v) v += (best - v) * Math.min(1, (dt / 300) * speed);
        }
        // 3. développement local, ou oubli si le réseau est trop petit pour entretenir le savoir
        if (v > 0) {
          const need = tech.minNet;
          if (ctx.net >= need) v += (1 - v) * Math.min(1, (0.3 * dt) / 100);
          else v -= v * Math.min(1, ((0.25 * dt) / 100) * (1 - ctx.net / Math.max(1, need)));
        }
        next[t * NC + k] = Math.max(0, Math.min(1, v));
      }
    }
    this.tech = next;
  }

  /** Âge atteint par une cellule, d'après ses savoirs (et non plus d'après sa taille). */
  ageOf(k: number) {
    const g = (id: string) => this.tech[TECH_INDEX.get(id)! * NC + k];
    if (g("steam") >= 0.5 || g("electricity") >= 0.5) return 4;
    if (g("iron") >= 0.5 && g("law") >= 0.5) return 3;
    if (g("writing") >= 0.5) return 2;
    return this.Ag[k] > 0.15 ? 1 : 0;
  }

  /** G4 : villages, territoires et échelons politiques, à partir des agriculteurs simulés. */
  updateSettlements() {
    const farmers = new Float32Array(NC);
    for (let k = 0; k < NC; k++) farmers[k] = this.Ag[k] > 0.3 ? this.N[k] * this.Ag[k] : 0;
    this.settlements.update(this.year, farmers, this.peopleIdx,
      (idx) => (idx ? this.peoples[idx - 1]?.color ?? null : null),
      (idx) => (idx ? this.peoples[idx - 1]?.id ?? 0 : 0), farmers,
      (k) => this.ageOf(k),
      (k) => 1 + 0.5 * (this.tech[TECH_INDEX.get("wheel")! * NC + k] + this.tech[TECH_INDEX.get("roads")! * NC + k] + this.tech[TECH_INDEX.get("law")! * NC + k]));
    for (const e of this.settlements.events.splice(0)) this.events.push({ year: e.year, text: e.text, settlement: e.settlement });
  }

  /** Regroupe les cellules voisines aux marqueurs proches en peuples, et suit leur identité dans le temps
   *  (scission → nouveau peuple « issu de », disparition → chronique). */
  identifyPeoples() {
    const parent = new Int32Array(NC).map((_, i) => i);
    const find = (x: number): number => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
    const ok = (k: number) => this.N[k] >= 30;
    for (let i = 0; i < NY; i++) for (let j = 0; j < NX; j++) {
      const k = i * NX + j;
      if (!ok(k)) continue;
      for (const [di, dj, b] of [[0, 1, 4], [1, 0, 6], [1, 1, 7], [1, -1, 5]] as const) {
        const ii = i + di; if (ii >= NY) continue;
        const kk = ii * NX + ((j + dj + NX) % NX);
        if (!ok(kk) || !((this.conn[k] >> b) & 1)) continue;
        const d = Math.abs(this.M0[k] - this.M0[kk]) + Math.abs(this.M1[k] - this.M1[kk]) + Math.abs(this.M2[k] - this.M2[kk]);
        if (d < 0.045) { const a = find(k), c = find(kk); if (a !== c) parent[a] = c; }
      }
    }
    const comp = new Map<number, { cells: number[]; pop: number }>();
    for (let k = 0; k < NC; k++) {
      if (!ok(k)) continue;
      const r = find(k);
      let e = comp.get(r); if (!e) { e = { cells: [], pop: 0 }; comp.set(r, e); }
      e.cells.push(k); e.pop += this.N[k];
    }
    const comps = [...comp.values()].filter((c) => c.pop >= 3000).sort((a, b) => b.pop - a.pop).slice(0, 250);
    const prev = this.peopleIdx;
    const byId = new Map(this.peoples.map((p) => [p.id, p]));
    const slotOf = new Map(this.peoples.map((p, i) => [p.id, i + 1]));
    const taken = new Set<number>();
    const next: People[] = [];
    const idx = new Uint8Array(NC);
    for (const c of comps) {
      // identité : le peuple précédent qui occupait la plus grande partie de ce territoire
      const overlap = new Map<number, number>();
      for (const k of c.cells) if (prev[k]) {
        const old = this.peoples[prev[k] - 1];
        if (old) overlap.set(old.id, (overlap.get(old.id) ?? 0) + this.N[k]);
      }
      let bestId = -1, best = 0;
      for (const [id, v] of overlap) if (v > best && !taken.has(id)) { best = v; bestId = id; }
      let p: People;
      let lat = 0, lon = 0, x = 0, y = 0, agri = 0, sea = 0, C = 0, m0 = 0, m1 = 0, m2 = 0;
      for (const k of c.cells) {
        const w = this.N[k], i = Math.floor(k / NX), j = k % NX;
        lat += (90 - (i + 0.5)) * w;
        x += Math.cos(((-180 + j + 0.5) * Math.PI) / 180) * w; y += Math.sin(((-180 + j + 0.5) * Math.PI) / 180) * w;
        agri += this.Ag[k] * w; sea += this.S[k] * w; C += this.C[k] * w;
        m0 += this.M0[k] * w; m1 += this.M1[k] * w; m2 += this.M2[k] * w;
      }
      lat /= c.pop; lon = (Math.atan2(y, x) * 180) / Math.PI;
      if (bestId >= 0) {
        p = { ...byId.get(bestId)! };
        taken.add(bestId);
      } else {
        const id = this.nextPeopleId++;
        const parentId = overlap.size ? [...overlap.entries()].sort((a, b) => b[1] - a[1])[0][0] : null;
        const hue = (Math.atan2(m1 / c.pop - 0.5, m0 / c.pop - 0.5) / (2 * Math.PI) + 1 + id * 0.137) % 1;
        p = { id, name: peopleName(id), color: hslToRgb(hue, 0.6, 0.48 + 0.12 * (m2 / c.pop - 0.5)), pop: 0, cells: 0, lat, lon, agri: 0, sea: 0, C: 0,
          parent: parentId, born: this.year, alive: true, peak: 0 };
        const par = parentId !== null ? byId.get(parentId) : null;
        this.events.push({ year: this.year, text: par ? `Les ${p.name} se séparent des ${par.name}` : `Naissance du peuple ${p.name}`, people: id });
      }
      const oldPop = p.pop;
      p.pop = c.pop; p.cells = c.cells.length; p.lat = lat; p.lon = lon; p.agri = agri / c.pop; p.sea = sea / c.pop; p.C = C / c.pop;
      if (oldPop > 0 && p.pop < 0.6 * p.peak) this.events.push({ year: this.year, text: `Les ${p.name} déclinent (${Math.round(p.pop).toLocaleString("fr-FR")} personnes)`, people: p.id });
      if (p.agri > 0.3 && (byId.get(p.id)?.agri ?? 0) <= 0.3 && oldPop > 0) this.events.push({ year: this.year, text: `Les ${p.name} deviennent agriculteurs`, people: p.id });
      p.peak = Math.max(p.peak, p.pop);
      next.push(p);
      for (const k of c.cells) idx[k] = next.length;
    }
    for (const old of this.peoples) if (!taken.has(old.id) && !next.some((p) => p.id === old.id)) {
      this.events.push({ year: this.year, text: `Les ${old.name} disparaissent ou se fondent dans leurs voisins`, people: old.id });
    }
    void slotOf;
    this.peoples = next;
    this.peopleIdx = idx;
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
      const tb = (id: string) => this.tech[TO[id] + k];
      const boats = sea ? Math.max(Math.min(1, Math.max(0, (sea[k] - P.boatS) / (1 - P.boatS))), 0.6 * tb("canoe"), 0.85 * tb("sail"), tb("compass")) : 0;
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
      const move = sea ? 1 + 0.3 * this.tech[TO.wheel + k] + 0.3 * this.tech[TO.roads + k] : 1;
      const out = X[k] * Math.min(0.5, (P.mBase + P.mPress * pressure) * dt * move);
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
