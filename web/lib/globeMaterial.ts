/**
 * Rendu du globe sur la carte graphique (0.7.0).
 *
 * Avant : un million de pixels recalculés en JavaScript à chaque image → gros ralentissements.
 * Maintenant : le relief (15′) est envoyé UNE fois ; à chaque image on n'envoie que trois petites
 * textures de 360×180 (climat, populations, cultures). Le shader fait tout le reste : côtes selon
 * le niveau marin, profondeur de l'océan, biomes, ombrage, champs, fleuves, lavis humain.
 * L'interpolation bilinéaire des données à 1° est faite gratuitement par la carte graphique.
 */
import * as THREE from "three";
import type { Layer, RunData } from "./paint";
import { RAMPS } from "./paint";
import { H, W, type Relief } from "./relief";

export const LAYER_INDEX: Record<Layer, number> = {
  humans: 0, temperature: 1, precipitation: 2, npp: 3, cold: 4, complexity: 5, sea: 6, agri: 7, tech: 8, peoples: 10,
  villages: 11, groups: 11, realms: 11,
};
const RAMP_ORDER: Exclude<Layer, "humans" | "peoples" | "villages" | "groups" | "realms">[] = ["temperature", "precipitation", "npp", "cold", "complexity", "sea", "agri", "tech"];

export type FrameTextures = { sim1: Uint8Array; sim2: Uint8Array; sim3: Uint8Array; seaLevel: number; people?: Uint8Array; palette?: Uint8Array };

function reliefTexture(relief: Relief): THREE.DataTexture {
  const d = new Uint8Array(W * H * 4);
  for (let i = 0; i < W * H; i++) {
    const e = Math.max(0, Math.min(65535, relief.elev[i] + 11000));
    d[i * 4] = e >> 8;
    d[i * 4 + 1] = e & 255;
    d[i * 4 + 2] = Math.round(relief.shade[i] * 200);
    d[i * 4 + 3] = 255;
  }
  const t = new THREE.DataTexture(d, W, H, THREE.RGBAFormat);
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.wrapS = THREE.RepeatWrapping;
  t.needsUpdate = true;
  return t;
}

function rampTexture(): THREE.DataTexture {
  const rows = RAMP_ORDER.length;
  const d = new Uint8Array(256 * rows * 4);
  RAMP_ORDER.forEach((name, r) => {
    const stops = RAMPS[name].map(([p, h]) => [p, parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)] as const);
    for (let x = 0; x < 256; x++) {
      const t = x / 255;
      let k = 1;
      while (k < stops.length - 1 && t > stops[k][0]) k++;
      const a = stops[k - 1], b = stops[k];
      const w = Math.min(1, Math.max(0, (t - a[0]) / (b[0] - a[0] || 1)));
      const o = (r * 256 + x) * 4;
      d[o] = a[1] + (b[1] - a[1]) * w; d[o + 1] = a[2] + (b[2] - a[2]) * w; d[o + 2] = a[3] + (b[3] - a[3]) * w; d[o + 3] = 255;
    }
  });
  const t = new THREE.DataTexture(d, 256, rows, THREE.RGBAFormat);
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  return t;
}

function simTexture(): THREE.DataTexture {
  const t = new THREE.DataTexture(new Uint8Array(360 * 180 * 4), 360, 180, THREE.RGBAFormat);
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearFilter;
  t.wrapS = THREE.RepeatWrapping;
  t.needsUpdate = true;
  return t;
}

const vertexShader = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vNormal;
  varying vec3 vView;
  void main() {
    vUv = uv;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vNormal = normalize(normalMatrix * normal);
    vView = normalize(-mv.xyz);
    gl_Position = projectionMatrix * mv;
  }
`;

const fragmentShader = /* glsl */ `
  uniform sampler2D uRelief;
  uniform sampler2D uSim1;   // r température, g pluie, b productivité, a glace
  uniform sampler2D uSim2;   // r sapiens, g archaïques, b agriculture, a fleuves
  uniform sampler2D uSim3;   // r froid, g complexité, b savoir maritime
  uniform sampler2D uRamp;
  uniform sampler2D uPeople;   // index du peuple (0 = aucun)
  uniform sampler2D uPalette;  // couleur de chaque peuple
  uniform sampler2D uTerr;     // territoires à 0,5° : identifiant sur deux octets
  uniform sampler2D uTerrPal;  // couleur de chaque territoire
  uniform float uSea;
  uniform int uLayer;
  varying vec2 vUv;
  varying vec3 vNormal;
  varying vec3 vView;

  vec3 mixc(vec3 a, vec3 b, float t) { return mix(a, b, clamp(t, 0.0, 1.0)); }

  void main() {
    vec2 uv = vec2(vUv.x, 1.0 - vUv.y);
    vec4 rel = texture2D(uRelief, uv);
    float elev = (rel.r * 255.0 * 256.0 + rel.g * 255.0) - 11000.0;
    float shade = rel.b * 255.0 / 200.0;
    vec4 s1 = texture2D(uSim1, uv);
    vec4 s2 = texture2D(uSim2, uv);
    vec4 s3 = texture2D(uSim3, uv);
    vec3 col;
    if (elev <= uSea && s1.a < 0.5) {
      float d = uSea - elev;
      col = d < 400.0 ? mixc(vec3(0.24, 0.56, 0.69), vec3(0.11, 0.36, 0.51), d / 400.0)
                      : mixc(vec3(0.11, 0.36, 0.51), vec3(0.04, 0.16, 0.27), (d - 400.0) / 3600.0);
    } else if (s1.a >= 0.5) {
      col = vec3(0.93, 0.96, 0.97) * shade;
    } else {
      float q;
      if (uLayer == 0 || uLayer == 10 || uLayer == 11) {
        float T = -40.0 + 75.0 * (s1.r * 255.0 - 1.0) / 254.0;
        float P = pow(10.0, 1.0 + ((s1.g * 255.0 - 1.0) / 254.0) * (log(4000.0) / log(10.0) - 1.0));
        float npp = 3000.0 * pow((s1.b * 255.0 - 1.0) / 254.0, 2.0);
        col = mixc(vec3(0.82, 0.73, 0.54), vec3(0.70, 0.68, 0.42), (P - 120.0) / 300.0);
        col = mixc(col, vec3(0.50, 0.62, 0.31), (P - 400.0) / 500.0);
        col = mixc(col, T > 20.0 ? vec3(0.17, 0.35, 0.18) : vec3(0.25, 0.42, 0.21), (npp - 700.0) / 900.0);
        col = mixc(col, vec3(0.31, 0.39, 0.28), clamp((8.0 - T) / 10.0, 0.0, 1.0) * clamp((npp - 200.0) / 500.0, 0.0, 1.0));
        col = mixc(col, vec3(0.56, 0.59, 0.51), (-2.0 - T) / 10.0);
        // champs en damier
        float farm = clamp((s2.b - 0.15) / 0.6, 0.0, 1.0);
        if (farm > 0.0) {
          vec2 tile = floor(uv * vec2(${W}.0, ${H}.0) * 2.0);
          float checker = mod(tile.x + tile.y, 2.0) > 0.5 ? 0.9 : 1.05;
          col = mix(col, vec3(0.79, 0.75, 0.42) * checker, 0.32 * farm);
        }
        if (uLayer == 11) {
          // voile transparent aux couleurs de chaque territoire, frontières soulignées
          vec4 tt = texture2D(uTerr, uv);
          float id = floor(tt.r * 255.0 + 0.5) * 256.0 + floor(tt.g * 255.0 + 0.5);
          if (id > 0.5) {
            vec3 tc = texture2D(uTerrPal, vec2((mod(id, 2048.0) + 0.5) / 2048.0, 0.5)).rgb;
            col = mix(col, tc, 0.42);
            vec2 px = vec2(1.0 / 720.0, 1.0 / 360.0);
            vec4 ta = texture2D(uTerr, uv + vec2(px.x, 0.0)), tb = texture2D(uTerr, uv + vec2(0.0, px.y));
            float ia = floor(ta.r * 255.0 + 0.5) * 256.0 + floor(ta.g * 255.0 + 0.5);
            float ib = floor(tb.r * 255.0 + 0.5) * 256.0 + floor(tb.g * 255.0 + 0.5);
            vec2 f = fract(uv / px);
            if ((ia != id && f.x > 0.75) || (ib != id && f.y > 0.75)) col = mix(col, tc * 0.5, 0.8);
          }
        }
        if (uLayer == 10) {
          float id = floor(texture2D(uPeople, uv).r * 255.0 + 0.5);
          if (id > 0.5) {
            vec3 pc = texture2D(uPalette, vec2((id + 0.5) / 256.0, 0.5)).rgb;
            col = mix(col, pc, 0.62);
            // frontières : un autre peuple dans la cellule voisine
            vec2 px = vec2(1.0 / 360.0, 1.0 / 180.0);
            float a = floor(texture2D(uPeople, uv + vec2(px.x, 0.0)).r * 255.0 + 0.5);
            float b = floor(texture2D(uPeople, uv + vec2(0.0, px.y)).r * 255.0 + 0.5);
            vec2 f = fract(uv / px);
            if ((a != id && f.x > 0.8) || (b != id && f.y > 0.8)) col *= 0.45;
          }
        }
      } else {
        int row = uLayer - 1;
        if (row <= 2) q = row == 0 ? s1.r : row == 1 ? s1.g : s1.b;
        else if (row == 3) q = s3.r; else if (row == 4) q = s3.g; else if (row == 5) q = s3.b; else if (row == 6) q = s2.b; else q = s3.a;
        col = q > 0.003 ? texture2D(uRamp, vec2(q, (float(row) + 0.5) / 8.0)).rgb : vec3(0.36, 0.33, 0.29);
      }
      col *= shade;
      if (s2.a > 0.43) col = mix(col, vec3(0.35, 0.64, 0.81), 0.35 + 0.4 * clamp((s2.a - 0.43) / 0.5, 0.0, 1.0));
      if (uLayer == 0) {
        float glow = max(s2.r, s2.g);
        if (glow > 0.02) {
          float share = s2.r / max(1e-3, s2.r + s2.g);
          vec3 tint = mix(vec3(0.73, 0.85, 0.63), vec3(0.91, 0.69, 0.38), share);
          col = mix(col, tint, 0.1 + 0.38 * glow);
        }
      }
    }
    float ndv = clamp(dot(vNormal, vView), 0.0, 1.0);
    col *= 0.72 + 0.28 * ndv;
    gl_FragColor = vec4(col, 1.0);
  }
`;

export class GlobeMaterial {
  readonly material: THREE.ShaderMaterial;
  private sim1 = simTexture();
  private sim2 = simTexture();
  private sim3 = simTexture();
  private people = (() => { const t = simTexture(); t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter; return t; })();
  private terr = (() => { const t = new THREE.DataTexture(new Uint8Array(720 * 360 * 4), 720, 360, THREE.RGBAFormat); t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter; t.wrapS = THREE.RepeatWrapping; t.needsUpdate = true; return t; })();
  private terrPal = (() => { const t = new THREE.DataTexture(new Uint8Array(2048 * 4), 2048, 1, THREE.RGBAFormat); t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter; t.needsUpdate = true; return t; })();
  private palette = (() => { const t = new THREE.DataTexture(new Uint8Array(256 * 4), 256, 1, THREE.RGBAFormat); t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter; t.needsUpdate = true; return t; })();

  constructor(relief: Relief) {
    this.material = new THREE.ShaderMaterial({
      vertexShader, fragmentShader,
      uniforms: {
        uRelief: { value: reliefTexture(relief) }, uRamp: { value: rampTexture() },
        uSim1: { value: this.sim1 }, uSim2: { value: this.sim2 }, uSim3: { value: this.sim3 },
        uSea: { value: 0 }, uLayer: { value: 0 }, uPeople: { value: this.people }, uPalette: { value: this.palette }, uTerr: { value: this.terr }, uTerrPal: { value: this.terrPal },
      },
    });
  }

  /** Envoie une image de simulation (déjà au format des textures) et choisit le calque. */
  set(frame: FrameTextures, layer: Layer) {
    (this.sim1.image.data as Uint8Array).set(frame.sim1);
    (this.sim2.image.data as Uint8Array).set(frame.sim2);
    (this.sim3.image.data as Uint8Array).set(frame.sim3);
    this.sim1.needsUpdate = this.sim2.needsUpdate = this.sim3.needsUpdate = true;
    if (frame.people) {
      const d = this.people.image.data as Uint8Array;
      for (let k = 0; k < frame.people.length; k++) d[k * 4] = frame.people[k];
      this.people.needsUpdate = true;
    }
    if (frame.palette) { (this.palette.image.data as Uint8Array).set(frame.palette); this.palette.needsUpdate = true; }
    this.material.uniforms.uSea.value = frame.seaLevel;
    this.material.uniforms.uLayer.value = LAYER_INDEX[layer];
  }

  /** Territoires de l'échelon affiché : identifiant par parcelle de 0,5° et palette. */
  setTerritory(index: Uint16Array, palette: Uint8Array) {
    const d = this.terr.image.data as Uint8Array;
    for (let k = 0; k < index.length; k++) { d[k * 4] = index[k] >> 8; d[k * 4 + 1] = index[k] & 255; }
    this.terr.needsUpdate = true;
    (this.terrPal.image.data as Uint8Array).set(palette.subarray(0, 2048 * 4));
    this.terrPal.needsUpdate = true;
  }

  dispose() {
    for (const t of [this.sim1, this.sim2, this.sim3, this.material.uniforms.uRelief.value, this.material.uniforms.uRamp.value]) t.dispose();
    this.material.dispose();
  }
}

/** Construit les trois textures d'une image d'un run rejoué (format manifest/frames). */
export function frameTexturesFromRun(data: RunData, frame: number, seaLevel: number): FrameTextures {
  const { ny, nx } = data.manifest.grid;
  const plane = ny * nx, off = frame * 3 * plane;
  const base = data.frames.subarray(off, off + plane);
  const clim = data.climate ? data.climate.subarray(off, off + 3 * plane) : null;
  const nExtra = data.manifest.extra?.layers.length ?? 0;
  const ex = (id: string) => {
    const k = data.manifest.extra?.layers.findIndex((l) => l.id === id) ?? -1;
    return k >= 0 && data.extra ? data.extra.subarray(frame * nExtra * plane + k * plane, frame * nExtra * plane + (k + 1) * plane) : null;
  };
  const sim1 = new Uint8Array(plane * 4), sim2 = new Uint8Array(plane * 4), sim3 = new Uint8Array(plane * 4);
  const agri = ex("agri"), riv = ex("rivers"), cold = ex("cold"), cx = ex("complexity"), sea = ex("sea"), tech = ex("tech");
  for (let k = 0; k < plane; k++) {
    if (clim) { sim1[k * 4] = clim[k]; sim1[k * 4 + 1] = clim[plane + k]; sim1[k * 4 + 2] = clim[2 * plane + k]; }
    sim1[k * 4 + 3] = base[k] & 2 ? 255 : 0;
    sim2[k * 4] = data.frames[off + plane + k];
    sim2[k * 4 + 1] = data.frames[off + 2 * plane + k];
    if (agri) sim2[k * 4 + 2] = agri[k];
    if (riv) sim2[k * 4 + 3] = riv[k];
    if (cold) sim3[k * 4] = cold[k];
    if (cx) sim3[k * 4 + 1] = cx[k];
    if (sea) sim3[k * 4 + 2] = sea[k];
    if (tech) sim3[k * 4 + 3] = tech[k];
  }
  dilateClimate(sim1, nx, ny);
  const people = ex("people") ?? undefined;
  let palette: Uint8Array | undefined;
  if (people && data.manifest.peoples) {
    palette = new Uint8Array(256 * 4);
    data.manifest.peoples.forEach((p, i) => { palette!.set([p.color[0], p.color[1], p.color[2], 255], (i + 1) * 4); });
  }
  return { sim1, sim2, sim3, seaLevel, people, palette };
}

/** Prolonge le climat des terres sur la mer voisine : à 15′ la côte est plus fine que la grille. */
export function dilateClimate(sim1: Uint8Array, nx: number, ny: number) {
  for (let pass = 0; pass < 3; pass++) {
    const src = sim1.slice();
    for (let i = 0; i < ny; i++) for (let j = 0; j < nx; j++) {
      const k = i * nx + j;
      if (src[k * 4]) continue;
      let r = 0, g = 0, b = 0, n = 0;
      for (const [di, dj] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
        const ii = i + di;
        if (ii < 0 || ii >= ny) continue;
        const kk = ii * nx + ((j + dj + nx) % nx);
        if (src[kk * 4]) { r += src[kk * 4]; g += src[kk * 4 + 1]; b += src[kk * 4 + 2]; n++; }
      }
      if (n) { sim1[k * 4] = r / n; sim1[k * 4 + 1] = g / n; sim1[k * 4 + 2] = b / n; }
    }
  }
}
