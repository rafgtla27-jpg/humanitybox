/**
 * Rendu détaillé du globe (« la carte doit ressembler à quelque chose »).
 *
 * La simulation tourne sur une grille de 1° (≈ 110 km). Pour l'affichage, on superpose ses
 * résultats à un relief réel 6 fois plus fin (15′ ≈ 28 km, ETOPO1) :
 *  - côtes recalculées à chaque image depuis le niveau marin de la simulation ;
 *  - océan teinté selon la profondeur, terres ombrées par le relief ;
 *  - biomes naturels tirés du climat simulé (désert, steppe, forêt, toundra), glaces ;
 *  - champs cultivés, fleuves et présence humaine en lavis doux (interpolés, plus de gros pixels).
 */
import type { Layer, RunData } from "./paint";
import { RAMPS } from "./paint";

export const W = 1440;
export const H = 720;

export type Relief = { elev: Int16Array; shade: Float32Array };

let cache: Promise<Relief> | null = null;

export function loadRelief(): Promise<Relief> {
  if (!cache) {
    cache = (async () => {
      const res = await fetch("/relief/etopo_1440x720.i16.gz");
      if (!res.ok) throw new Error("relief introuvable");
      let bytes = new Uint8Array(await res.arrayBuffer());
      if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
        const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
        bytes = new Uint8Array(await new Response(stream).arrayBuffer());
      }
      const elev = new Int16Array(bytes.buffer, bytes.byteOffset, W * H);
      return { elev, shade: hillshade(elev) };
    })();
  }
  return cache;
}

/** Ombrage du relief, soleil au nord-ouest, relief exagéré pour rester lisible depuis l'espace. */
function hillshade(elev: Int16Array): Float32Array {
  const out = new Float32Array(W * H);
  const az = (315 * Math.PI) / 180;
  const alt = (40 * Math.PI) / 180;
  const zen = Math.PI / 2 - alt;
  const cellM = (0.25 * Math.PI * 6371000) / 180;
  const exaggeration = 25;
  for (let y = 0; y < H; y++) {
    const lat = 90 - (y + 0.5) * 0.25;
    const dx = cellM * Math.max(0.05, Math.cos((lat * Math.PI) / 180));
    const up = Math.max(0, y - 1), dn = Math.min(H - 1, y + 1);
    for (let x = 0; x < W; x++) {
      const l = (x + W - 1) % W, r = (x + 1) % W;
      const e = (v: number) => Math.max(0, v) * exaggeration;
      const dzdx = (e(elev[y * W + r]) - e(elev[y * W + l])) / (2 * dx);
      const dzdy = (e(elev[dn * W + x]) - e(elev[up * W + x])) / (2 * cellM);
      const slope = Math.atan(Math.hypot(dzdx, dzdy));
      const aspect = Math.atan2(dzdy, -dzdx);
      const s = Math.cos(zen) * Math.cos(slope) + Math.sin(zen) * Math.sin(slope) * Math.cos(az - aspect);
      out[y * W + x] = Math.min(1.25, Math.max(0.5, 0.45 + 0.75 * s));
    }
  }
  return out;
}

type RGB = [number, number, number];
const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const hex = (h: string): RGB => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

const SAND = hex("#d2b98a"), STEPPE = hex("#b3ad6a"), GRASS = hex("#7f9d4f"), FOREST = hex("#3f6a36");
const RAINFOREST = hex("#2c5a2d"), TUNDRA = hex("#8f9682"), TAIGA = hex("#4f6347"), ICE = hex("#eef4f7");
const FARM = hex("#c9c06a"), RIVER = hex("#5aa3cf"), GLOW = hex("#e8b060"), ARCH = hex("#b9d8a0");
const SHALLOW = hex("#3d8fb0"), MID = hex("#1d5b82"), DEEP = hex("#0b2a45");

export function seaLevelAt(data: RunData, year: number): number {
  const f = data.manifest.forcing;
  const xs = f.years, ys = f.sea_level;
  if (year <= xs[0]) return ys[0];
  for (let i = 1; i < xs.length; i++) if (year <= xs[i]) return ys[i - 1] + ((year - xs[i - 1]) / (xs[i] - xs[i - 1])) * (ys[i] - ys[i - 1]);
  return ys[ys.length - 1];
}

/** Peint la frame dans `out` (RGBA, W×H). */
export function paintRelief(relief: Relief, data: RunData, frame: number, layer: Layer, out: Uint8ClampedArray) {
  const { ny, nx } = data.manifest.grid;
  const plane = ny * nx;
  const off = frame * 3 * plane;
  const base = data.frames.subarray(off, off + plane);
  const sap = data.frames.subarray(off + plane, off + 2 * plane);
  const arc = data.frames.subarray(off + 2 * plane, off + 3 * plane);
  const clim = data.climate ? data.climate.subarray(off, off + 3 * plane) : null;
  const nExtra = data.manifest.extra?.layers.length ?? 0;
  const extraPlane = (id: string) => {
    const k = data.manifest.extra?.layers.findIndex((l) => l.id === id) ?? -1;
    if (k < 0 || !data.extra) return null;
    const o = frame * nExtra * plane + k * plane;
    return data.extra.subarray(o, o + plane);
  };
  const rivers = extraPlane("rivers"), agri = extraPlane("agri");
  const layerPlane = layer === "humans" ? null
    : ["temperature", "precipitation", "npp"].includes(layer) && clim
      ? clim.subarray(["temperature", "precipitation", "npp"].indexOf(layer) * plane, (["temperature", "precipitation", "npp"].indexOf(layer) + 1) * plane)
      : extraPlane(layer);
  const ramp = layer !== "humans" && layer !== "peoples" ? RAMPS[layer as Exclude<Layer, "humans" | "peoples">] : null;

  // 1. Grandeurs à 1° (couleur du sol, glace, champs, fleuves, présence humaine)
  const colR = new Float32Array(plane), colG = new Float32Array(plane), colB = new Float32Array(plane);
  const has = new Uint8Array(plane);
  const ice = new Float32Array(plane), farm = new Float32Array(plane), riv = new Float32Array(plane);
  const glow = new Float32Array(plane), share = new Float32Array(plane);
  const { density_lo: lo, density_hi: hi } = data.manifest.frames;
  const llo = Math.log10(lo), span = Math.log10(hi) - llo;
  for (let k = 0; k < plane; k++) {
    ice[k] = base[k] & 2 ? 1 : 0;
    if (!(base[k] & 1) && !(base[k] & 2)) continue;
    let c: RGB;
    if (ramp && layerPlane) {
      const q = layerPlane[k];
      if (q) {
        const t = (q - 1) / 254;
        let i = 1;
        while (i < ramp.length - 1 && t > ramp[i][0]) i++;
        const [p0, c0] = ramp[i - 1], [p1, c1] = ramp[i];
        c = mix(hex(c0), hex(c1), clamp01((t - p0) / (p1 - p0 || 1)));
      } else c = TUNDRA;
    } else if (clim) {
      const T = -40 + (75 * (clim[k] - 1)) / 254;
      const P = 10 ** (1 + ((clim[plane + k] - 1) / 254) * (Math.log10(4000) - 1));
      const npp = 3000 * ((clim[2 * plane + k] - 1) / 254) ** 2;
      c = mix(SAND, STEPPE, clamp01((P - 120) / 300));
      c = mix(c, GRASS, clamp01((P - 400) / 500));
      c = mix(c, T > 20 ? RAINFOREST : FOREST, clamp01((npp - 700) / 900));
      c = mix(c, TAIGA, clamp01((8 - T) / 10) * clamp01((npp - 200) / 500));
      c = mix(c, TUNDRA, clamp01((-2 - T) / 10));
    } else c = GRASS;
    colR[k] = c[0]; colG[k] = c[1]; colB[k] = c[2]; has[k] = 1;
    if (agri && agri[k]) farm[k] = clamp01(((agri[k] - 1) / 254 - 0.15) / 0.6);
    if (rivers && rivers[k] >= 109) riv[k] = clamp01((rivers[k] - 109) / 120);
    if (layer === "humans") {
      const ds = sap[k] ? 10 ** (llo + ((sap[k] - 1) / 254) * span) : 0;
      const da = arc[k] ? 10 ** (llo + ((arc[k] - 1) / 254) * span) : 0;
      const tot = ds + da;
      if (tot > 0) {
        glow[k] = clamp01((Math.log10(tot) - llo) / span);
        share[k] = ds / tot;
      }
    }
  }
  // Prolonge la couleur des terres sur la mer voisine : les côtes fines n'héritent pas du bleu
  for (let pass = 0; pass < 3; pass++) {
    const copy = has.slice();
    for (let i = 0; i < ny; i++) for (let j = 0; j < nx; j++) {
      const k = i * nx + j;
      if (copy[k]) continue;
      let r = 0, g = 0, b = 0, n = 0;
      for (const [di, dj] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
        const ii = i + di;
        if (ii < 0 || ii >= ny) continue;
        const kk = ii * nx + ((j + dj + nx) % nx);
        if (copy[kk]) { r += colR[kk]; g += colG[kk]; b += colB[kk]; n++; }
      }
      if (n) { colR[k] = r / n; colG[k] = g / n; colB[k] = b / n; has[k] = 1; }
    }
  }

  // 2. Pixel par pixel à 15′, interpolation bilinéaire des grandeurs à 1°
  const sea = seaLevelAt(data, data.manifest.frames.years[frame]);
  const { elev, shade } = relief;
  const sample = (a: Float32Array, i0: number, i1: number, j0: number, j1: number, wy: number, wx: number) =>
    (a[i0 * nx + j0] * (1 - wx) + a[i0 * nx + j1] * wx) * (1 - wy) + (a[i1 * nx + j0] * (1 - wx) + a[i1 * nx + j1] * wx) * wy;
  for (let y = 0; y < H; y++) {
    const gy = (y + 0.5) * 0.25 - 0.5;
    const i0 = Math.max(0, Math.min(ny - 1, Math.floor(gy))), i1 = Math.min(ny - 1, i0 + 1);
    const wy = clamp01(gy - Math.floor(gy));
    for (let x = 0; x < W; x++) {
      const p = y * W + x, o = p * 4;
      const e = elev[p];
      const gx = (x + 0.5) * 0.25 - 0.5;
      const jf = Math.floor(gx);
      const j0 = (jf + nx) % nx, j1 = (jf + 1) % nx;
      const wx = gx - jf;
      const iceV = sample(ice, i0, i1, j0, j1, wy, wx);
      let R: number, G: number, B: number;
      if (e <= sea && iceV < 0.5) {
        const d = sea - e;
        const c = d < 400 ? mix(SHALLOW, MID, d / 400) : mix(MID, DEEP, clamp01((d - 400) / 3600));
        [R, G, B] = c;
      } else {
        const h = shade[p];
        if (iceV >= 0.5) {
          [R, G, B] = [ICE[0] * h, ICE[1] * h, ICE[2] * Math.min(1.1, h + 0.05)];
        } else {
          R = sample(colR, i0, i1, j0, j1, wy, wx);
          G = sample(colG, i0, i1, j0, j1, wy, wx);
          B = sample(colB, i0, i1, j0, j1, wy, wx);
          const f = layer === "humans" ? sample(farm, i0, i1, j0, j1, wy, wx) : 0;
          if (f > 0) {
            // Champs : damier de parcelles, plus marqué là où l'on cultive le plus
            const checker = ((x >> 1) + (y >> 1)) & 1 ? 0.9 : 1.05;
            const t = 0.32 * f;
            R = R + (FARM[0] * checker - R) * t; G = G + (FARM[1] * checker - G) * t; B = B + (FARM[2] * checker - B) * t;
          }
          R *= h; G *= h; B *= h;
          const rv = sample(riv, i0, i1, j0, j1, wy, wx);
          if (rv > 0.35) {
            const t = 0.35 + 0.4 * rv;
            R = R + (RIVER[0] - R) * t; G = G + (RIVER[1] - G) * t; B = B + (RIVER[2] - B) * t;
          }
          if (layer === "humans") {
            const gl = sample(glow, i0, i1, j0, j1, wy, wx);
            if (gl > 0.02) {
              const sh = sample(share, i0, i1, j0, j1, wy, wx);
              const tint = mix(ARCH, GLOW, sh);
              const t = 0.05 + 0.22 * gl;
              R = R + (tint[0] - R) * t; G = G + (tint[1] - G) * t; B = B + (tint[2] - B) * t;
            }
          }
        }
      }
      out[o] = R; out[o + 1] = G; out[o + 2] = B; out[o + 3] = 255;
    }
  }
}
