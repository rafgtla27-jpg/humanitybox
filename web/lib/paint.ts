import type { Manifest } from "./data";

export type Layer = "humans" | "temperature" | "precipitation" | "npp";

export const LAYERS: { id: Layer; label: string }[] = [
  { id: "humans", label: "Humains" },
  { id: "temperature", label: "Température" },
  { id: "precipitation", label: "Précipitations" },
  { id: "npp", label: "Productivité végétale" },
];

type RGB = [number, number, number];
export const COLORS: Record<string, RGB> = {
  ocean: [18, 51, 74],
  land: [124, 114, 98],
  ice: [233, 241, 243],
  sapiens: [227, 161, 59],
  archaic: [183, 207, 162],
};

// Rampes de couleur : positions 0..1 → couleur
export const RAMPS: Record<Exclude<Layer, "humans">, [number, string][]> = {
  temperature: [[0, "#2f4f86"], [0.35, "#6f9cc4"], [0.55, "#cfd8d2"], [0.72, "#e8c27a"], [0.86, "#e3a13b"], [1, "#b4442c"]],
  precipitation: [[0, "#d9c79b"], [0.35, "#c9c27d"], [0.6, "#7fae6e"], [0.82, "#3f8a83"], [1, "#2a5f93"]],
  npp: [[0, "#6e6250"], [0.3, "#9a9a5c"], [0.65, "#79a453"], [1, "#2f6e35"]],
};

const hex = (h: string): RGB => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

function buildLut(stops: [number, string][]): Uint8ClampedArray {
  const lut = new Uint8ClampedArray(256 * 3);
  const s = stops.map(([p, c]) => [p, hex(c)] as const);
  for (let q = 1; q < 256; q++) {
    const t = (q - 1) / 254;
    let k = 1;
    while (k < s.length - 1 && t > s[k][0]) k++;
    const [p0, c0] = s[k - 1];
    const [p1, c1] = s[k];
    const w = Math.min(1, Math.max(0, (t - p0) / (p1 - p0 || 1)));
    for (let i = 0; i < 3; i++) lut[q * 3 + i] = c0[i] + w * (c1[i] - c0[i]);
  }
  return lut;
}
const LUTS = Object.fromEntries(Object.entries(RAMPS).map(([k, v]) => [k, buildLut(v)])) as Record<Exclude<Layer, "humans">, Uint8ClampedArray>;

export type RunData = { manifest: Manifest; frames: Uint8Array; climate: Uint8Array | null };

/** Peint la frame dans `out` (RGBA, nx * nRows pixels) à partir de la ligne `row0` de la grille. */
export function paintFrame(data: RunData, frame: number, layer: Layer, out: Uint8ClampedArray, row0 = 0, nRows?: number) {
  const { ny, nx } = data.manifest.grid;
  const rows = nRows ?? ny;
  const plane = ny * nx;
  const off = frame * 3 * plane;
  const base = data.frames.subarray(off, off + plane);
  const sap = data.frames.subarray(off + plane, off + 2 * plane);
  const arc = data.frames.subarray(off + 2 * plane, off + 3 * plane);

  const climateIdx = layer === "humans" ? -1 : ["temperature", "precipitation", "npp"].indexOf(layer);
  const clim = climateIdx >= 0 && data.climate ? data.climate.subarray(off + climateIdx * plane, off + (climateIdx + 1) * plane) : null;
  const lut = layer !== "humans" ? LUTS[layer] : null;

  const { density_lo: lo, density_hi: hi } = data.manifest.frames;
  const llo = Math.log10(lo);
  const span = Math.log10(hi) - llo;
  const deq = (q: number) => (q ? 10 ** (llo + ((q - 1) / 254) * span) : 0);

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < nx; c++) {
      const i = (r + row0) * nx + c;
      const b = base[i];
      let R: number, G: number, B: number;
      if (b & 2) [R, G, B] = COLORS.ice;
      else if (!(b & 1)) [R, G, B] = COLORS.ocean;
      else if (clim && lut) {
        const q = clim[i];
        if (q) {
          R = lut[q * 3];
          G = lut[q * 3 + 1];
          B = lut[q * 3 + 2];
        } else [R, G, B] = COLORS.land;
      } else {
        [R, G, B] = COLORS.land;
        const ds = deq(sap[i]);
        const da = deq(arc[i]);
        const tot = ds + da;
        if (tot > 0) {
          // Teinte = qui domine localement ; opacité = densité totale
          const share = ds / tot;
          const qTot = Math.min(255, 1 + Math.max(0, Math.round((254 * (Math.log10(tot) - llo)) / span)));
          const a = 0.25 + 0.7 * (qTot / 255);
          const tr = COLORS.archaic[0] + share * (COLORS.sapiens[0] - COLORS.archaic[0]);
          const tg = COLORS.archaic[1] + share * (COLORS.sapiens[1] - COLORS.archaic[1]);
          const tb = COLORS.archaic[2] + share * (COLORS.sapiens[2] - COLORS.archaic[2]);
          R = R * (1 - a) + tr * a;
          G = G * (1 - a) + tg * a;
          B = B * (1 - a) + tb * a;
        }
      }
      const o = (r * nx + c) * 4;
      out[o] = R;
      out[o + 1] = G;
      out[o + 2] = B;
      out[o + 3] = 255;
    }
  }
}

/** Libellés de légende pour un calque climatique. */
export function legendFor(m: Manifest, layer: Exclude<Layer, "humans">): { min: string; max: string; unit: string } {
  const spec = m.climate?.[layer];
  if (!spec) return { min: "", max: "", unit: "" };
  return { min: String(spec.min), max: String(spec.max), unit: spec.unit };
}
