/**
 * G4 — Établissements, territoires et échelons politiques (monde vivant).
 *
 * Un VILLAGE est une entité durable (identifiant, nom, date de fondation, peuple) qui naît là où des
 * agriculteurs sont assez nombreux et loin d'un village existant, grandit ou décline avec sa
 * population, et peut être abandonné. Chaque parcelle de 0,5° habitée appartient au village le plus
 * proche : c'est son territoire.
 * Les villages se regroupent ensuite en ÉCHELONS, dont la nature dépend de l'ÂGE atteint (taille,
 * densité, ancienneté) : chefferie → cité-État → comté → département ; confédération → royaume →
 * pays. L'âge détermine aussi l'architecture affichée.
 */
import { peopleName } from "./engine";

export const AGES = ["Paléolithique", "Néolithique", "Âge des cités", "Âge des royaumes", "Âge moderne"];
// Noms des échelons [niveau 1 (lieu), niveau 2, niveau 3] selon l'âge
export const LEVEL_NAMES: [string, string, string][] = [
  ["campement", "clan", "tribu"],
  ["village", "chefferie", "confédération"],
  ["ville", "cité-État", "royaume"],
  ["ville", "comté", "royaume"],
  ["commune", "département", "pays"],
];
export const PX_NX = 720, PX_NY = 360, PX_N = PX_NX * PX_NY;

export type Settlement = {
  id: number; name: string; k: number; lat: number; lon: number; pop: number; people: number;
  founded: number; color: [number, number, number]; group: number; realm: number; age: number; kind: string; alive: boolean;
};
export type Polity = { id: number; level: 2 | 3; name: string; title: string; capital: number; pop: number; age: number; color: [number, number, number]; lat: number; lon: number };

function hash(a: number, b: number) { let h = (a * 374761393 + b * 668265263) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }
function shade(c: [number, number, number], seed: number): [number, number, number] {
  const f = 0.7 + 0.6 * hash(seed, 7), g = hash(seed, 11) * 40 - 20;
  return [Math.min(255, Math.max(0, c[0] * f + g)), Math.min(255, Math.max(0, c[1] * f - g / 2)), Math.min(255, Math.max(0, c[2] * f))] as [number, number, number];
}
const dist2 = (a: Settlement, b: { lat: number; lon: number }) => {
  const dlon = ((b.lon - a.lon + 540) % 360) - 180;
  return (a.lat - b.lat) ** 2 + (dlon * Math.cos((a.lat * Math.PI) / 180)) ** 2;
};

export class Settlements {
  list: Settlement[] = [];
  polities: Polity[] = [];
  owner = new Uint16Array(PX_N);   // index (1-based) du village propriétaire de chaque parcelle de 0,5°
  private nextId = 1;
  events: { year: number; text: string; settlement?: number }[] = [];

  update(year: number, farmers: Float32Array, peopleIdx: Uint8Array, peopleColor: (idx: number) => [number, number, number] | null,
         peopleId: (idx: number) => number, density: Float32Array,
         ageOfCell: (k: number) => number = () => 1, reachOfCell: (k: number) => number = () => 1) {
    const NX = 360, NY = 180;
    const alive = this.list.filter((s) => s.alive);
    // 1. population des villages existants (cellule + voisines qu'ils dominent) ; abandons
    const byCell = new Map<number, Settlement[]>();
    for (const s of alive) { const a = byCell.get(s.k) ?? []; a.push(s); byCell.set(s.k, a); }
    for (const s of alive) {
      const share = byCell.get(s.k)!.length;
      s.pop = farmers[s.k] / share;
      if (s.pop < 100) {
        s.alive = false;
        this.events.push({ year, text: `${s.name} est abandonné`, settlement: s.id });
      }
    }
    // 2. fondations : cellules d'agriculteurs loin de tout village
    const occupied = new Uint8Array(NX * NY);
    for (const s of this.list) if (s.alive) {
      const i = Math.floor(s.k / NX), j = s.k % NX;
      for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) { const ii = i + di; if (ii >= 0 && ii < NY) occupied[ii * NX + ((j + dj + NX) % NX)] = 1; }
    }
    const cands: number[] = [];
    for (let k = 0; k < NX * NY; k++) if (farmers[k] >= 600 && !occupied[k]) cands.push(k);
    cands.sort((a, b) => farmers[b] - farmers[a]);
    for (const k of cands) {
      if (occupied[k] || this.list.filter((s) => s.alive).length >= 1500) continue;
      const i = Math.floor(k / NX), j = k % NX, id = this.nextId++;
      const col = peopleColor(peopleIdx[k]) ?? [200, 170, 110];
      const s: Settlement = {
        id, name: peopleName(id * 31 + 7), k, lat: 90 - (i + 0.2 + 0.6 * hash(id, 1)), lon: -180 + (j + 0.2 + 0.6 * hash(id, 2)),
        pop: farmers[k], people: peopleId(peopleIdx[k]), founded: year, color: shade(col, id), group: 0, realm: 0, age: 1, kind: "village", alive: true,
      };
      this.list.push(s);
      this.events.push({ year, text: `Fondation de ${s.name}`, settlement: id });
      for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) { const ii = i + di; if (ii >= 0 && ii < NY) occupied[ii * NX + ((j + dj + NX) % NX)] = 1; }
    }
    if (this.list.length > 4000) this.list = this.list.filter((s) => s.alive);
    const live = this.list.filter((s) => s.alive);

    // 3. territoires à 0,5° : parcelle habitée → village le plus proche (≤ 2,5°)
    const grid = new Map<number, number[]>();
    live.forEach((s, n) => { const key = Math.floor((90 - s.lat) / 5) * 100 + Math.floor((s.lon + 180) / 5); const a = grid.get(key) ?? []; a.push(n); grid.set(key, a); });
    const index = new Map(this.list.map((s, n) => [s.id, n + 1]));
    this.owner.fill(0);
    for (let y = 0; y < PX_NY; y++) for (let x = 0; x < PX_NX; x++) {
      const k1 = Math.floor(y / 2) * NX + Math.floor(x / 2);
      if (density[k1] <= 0) continue;
      const lat = 90 - (y + 0.5) * 0.5, lon = -180 + (x + 0.5) * 0.5;
      const gy = Math.floor((90 - lat) / 5), gx = Math.floor((lon + 180) / 5);
      let best = -1, bd = 2.5 * 2.5;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        for (const n of grid.get((gy + dy) * 100 + ((gx + dx + 72) % 72)) ?? []) {
          const d = dist2(live[n], { lat, lon });
          if (d < bd) { bd = d; best = n; }
        }
      }
      if (best >= 0) this.owner[y * PX_NX + x] = index.get(live[best].id)!;
    }

    // 4. échelons : regroupement glouton autour des plus grands, au sein d'un même peuple
    // La portée d'un ensemble dépend des savoirs de son centre (roue, routes, administration)
    const groupOf = (members: Settlement[], radiusDeg: number) => {
      const sorted = [...members].sort((a, b) => b.pop - a.pop);
      const out: { capital: Settlement; members: Settlement[] }[] = [];
      const done = new Set<number>();
      for (const c of sorted) {
        if (done.has(c.id)) continue;
        const g = { capital: c, members: [] as Settlement[] };
        const r = radiusDeg * reachOfCell(c.k);
        for (const s of sorted) if (!done.has(s.id) && s.people === c.people && dist2(s, c) <= r * r) { g.members.push(s); done.add(s.id); }
        out.push(g);
      }
      return out;
    };
    const polities: Polity[] = [];
    const groups = groupOf(live, 4);
    for (const g of groups) {
      const pop = g.members.reduce((a, s) => a + s.pop, 0);
      polities.push({ id: g.capital.id * 10 + 2, level: 2, name: g.capital.name, title: "", capital: g.capital.id, pop, age: 1, color: shade(g.capital.color, g.capital.id + 3), lat: g.capital.lat, lon: g.capital.lon });
      for (const s of g.members) s.group = g.capital.id * 10 + 2;
    }
    const capitals = groups.map((g) => g.capital);
    const realms = groupOf(capitals, 11);
    for (const r of realms) {
      const memberGroups = groups.filter((g) => r.members.some((c) => c.id === g.capital.id));
      const all = memberGroups.flatMap((g) => g.members);
      const pop = all.reduce((a, s) => a + s.pop, 0);
      const oldest = Math.min(...all.map((s) => s.founded));
      const biggest = Math.max(...all.map((s) => s.pop));
      // Âge atteint : taille, plus grande ville, ancienneté (pas de date imposée)
      // Âge = savoirs maîtrisés par la capitale (écriture → cités ; fer + droit → royaumes ; vapeur → moderne)
      void oldest; void biggest;
      const age = Math.max(1, ageOfCell(r.capital.k));
      const id = r.capital.id * 10 + 3;
      polities.push({ id, level: 3, name: r.capital.name, title: "", capital: r.capital.id, pop, age, color: shade(r.capital.color, r.capital.id + 5), lat: r.capital.lat, lon: r.capital.lon });
      for (const s of all) { s.realm = id; s.age = Math.max(1, ageOfCell(s.k)); }
      for (const g of memberGroups) { const p = polities.find((q) => q.id === g.capital.id * 10 + 2)!; p.age = age; }
    }
    for (const p of polities) p.title = LEVEL_NAMES[p.age][p.level - 1];
    for (const s of live) {
      const names = LEVEL_NAMES[s.age];
      s.kind = s.age >= 2 && s.pop >= 4000 ? (s.age === 4 && s.pop >= 60_000 ? "métropole" : "ville") : s.pop < 400 ? "hameau" : s.age === 4 ? "commune" : s.pop >= 1500 && s.age >= 2 ? "bourg" : "village";
    }
    const prevAges = new Map(this.polities.filter((p) => p.level === 3).map((p) => [p.id, p.age]));
    for (const p of polities) if (p.level === 3 && (prevAges.get(p.id) ?? p.age) < p.age) this.events.push({ year, text: `${p.name} entre dans l'${AGES[p.age].toLowerCase()} (${p.title})`, settlement: p.capital });
    this.polities = polities;
  }
}
