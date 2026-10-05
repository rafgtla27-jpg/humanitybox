/**
 * Personnages et habitations sur le globe (piste sprites S1–S2), générés procéduralement.
 *
 * Échelle : un personnage mesure une taille fixe EN KILOMÈTRES sur le globe (≈ 15 km), pas en
 * pixels. Vu de l'espace il est invisible (la présence humaine se lit alors comme un lavis sur la
 * carte) ; il apparaît quand on descend vers le sol, et grandit à mesure qu'on s'approche.
 * Chaque figure représente un nombre réel de personnes simulées ; le mouvement de marche sur place
 * reste décoratif tant que la simulation ne suit pas d'individus (S3).
 */
import * as THREE from "three";
import type { RunData } from "./paint";

export const MAX_SPRITES = 30000;
const MAX_PER_CELL = 120;
const RADIUS = 1.0015;
const NICE = [25, 50, 100, 200, 500, 1000, 2000, 5000, 10000];
const KM_PER_DEG = 111.2;
const WORLD_SIZE = 15 / 6371; // ≈ 15 km, en rayons terrestres
const COLS = 8;
const ROWS = 3;
const CELL = 64;

const SAPIENS = new THREE.Color("#ffbf5e");
const ARCHAIC = new THREE.Color("#c8e0b0");
const WHITE = new THREE.Color("#ffffff");

function hash(a: number, b: number, c: number) {
  let h = (a * 374761393 + b * 668265263 + c * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function rng(seed: number) {
  let s = seed * 9301 + 49297;
  return () => ((s = (s * 9301 + 49297) % 233280) / 233280);
}

/** Atlas procédural : lignes 0–1 = 8 silhouettes × 2 pas de marche ; ligne 2 = habitations et feux. */
function makeAtlas(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = COLS * CELL;
  c.height = ROWS * CELL;
  const g = c.getContext("2d")!;
  const OUT = "#1b140a";

  // --- Personnages (niveaux de gris, teintés ensuite par la couleur du peuple)
  for (let v = 0; v < 8; v++) {
    const r = rng(v + 11);
    const h = 40 + r() * 12;
    const head = 5 + r() * 2;
    const body = 9 + r() * 6;
    const skirt = v % 2 === 1;
    const item = v % 4; // 0 lance, 1 panier sur la tête, 2 enfant, 3 bâton
    for (let f = 0; f < 2; f++) {
      const idx = v * 2 + f;
      const ox = (idx % COLS) * CELL, oy = Math.floor(idx / COLS) * CELL;
      const cx = ox + 30, top = oy + CELL - 4 - h;
      const step = f === 0 ? 4 : -4;
      const draw = (grow: number, skin: string, cloth: string, wood: string) => {
        g.fillStyle = skin;
        g.save(); g.translate(cx - 3, top + h * 0.62); g.rotate((step * Math.PI) / 90);
        g.fillRect(-2.2 - grow, 0, 4.4 + 2 * grow, h * 0.38 + grow); g.restore();
        g.save(); g.translate(cx + 3, top + h * 0.62); g.rotate((-step * Math.PI) / 90);
        g.fillRect(-2.2 - grow, 0, 4.4 + 2 * grow, h * 0.38 + grow); g.restore();
        g.fillStyle = cloth;
        g.beginPath();
        if (skirt) {
          g.moveTo(cx - body / 2 - grow, top + head * 2 + 2 - grow);
          g.lineTo(cx + body / 2 + grow, top + head * 2 + 2 - grow);
          g.lineTo(cx + body / 2 + 4 + grow, top + h * 0.72 + grow);
          g.lineTo(cx - body / 2 - 4 - grow, top + h * 0.72 + grow);
          g.closePath();
        } else {
          g.roundRect(cx - body / 2 - grow, top + head * 2 + 2 - grow, body + 2 * grow, h * 0.45 + 2 * grow, 4);
        }
        g.fill();
        g.fillStyle = skin;
        g.save(); g.translate(cx - body / 2, top + head * 2 + 5); g.rotate((-step * Math.PI) / 60);
        g.fillRect(-2 - grow, 0, 3.6 + 2 * grow, h * 0.32 + grow); g.restore();
        g.beginPath(); g.arc(cx, top + head, head + grow, 0, Math.PI * 2); g.fill();
        g.fillStyle = cloth;
        g.beginPath(); g.arc(cx, top + head - 1.5, head * 0.9 + grow, Math.PI, 0); g.fill();
        g.fillStyle = wood;
        if (item === 0) { g.save(); g.translate(cx + body / 2 + 3, top - 6); g.rotate(0.12); g.fillRect(-1.5 - grow, -grow, 3 + 2 * grow, h + 6 + grow); g.restore(); }
        if (item === 1) { g.beginPath(); g.ellipse(cx, top - 3, 8 + grow, 4 + grow, 0, 0, Math.PI * 2); g.fill(); }
        if (item === 2) { g.beginPath(); g.arc(cx + body / 2 + 6, top + h * 0.55, 3.2 + grow, 0, Math.PI * 2); g.fill(); g.fillRect(cx + body / 2 + 4 - grow, top + h * 0.6, 4 + 2 * grow, h * 0.3 + grow); }
        if (item === 3) { g.save(); g.translate(cx - body / 2 - 4, top + 6); g.rotate(-0.08); g.fillRect(-1.2 - grow, -grow, 2.4 + 2 * grow, h - 4 + grow); g.restore(); }
      };
      draw(2.2, OUT, OUT, OUT);
      draw(0, "#f2f2f2", "#a9a9a9", "#6f6f6f");
    }
  }

  // --- Habitations et feux (couleurs naturelles, non teintées)
  const row = 2 * CELL;
  const cell = (i: number, fn: () => void) => { g.save(); g.translate(i * CELL, row); fn(); g.restore(); };
  cell(0, () => { // tente de peaux (climat froid)
    g.fillStyle = OUT; g.beginPath(); g.moveTo(32, 4); g.lineTo(58, 60); g.lineTo(6, 60); g.closePath(); g.fill();
    g.fillStyle = "#b89a72"; g.beginPath(); g.moveTo(32, 9); g.lineTo(54, 57); g.lineTo(10, 57); g.closePath(); g.fill();
    g.strokeStyle = OUT; g.lineWidth = 2; g.beginPath(); g.moveTo(26, 2); g.lineTo(36, 14); g.moveTo(38, 2); g.lineTo(28, 14); g.stroke();
    g.fillStyle = "#3a2a18"; g.beginPath(); g.moveTo(32, 36); g.lineTo(40, 57); g.lineTo(24, 57); g.closePath(); g.fill();
  });
  cell(1, () => { // hutte ronde au toit de chaume (tempéré/chaud)
    g.fillStyle = OUT; g.fillRect(9, 32, 46, 28); g.beginPath(); g.moveTo(32, 4); g.lineTo(62, 36); g.lineTo(2, 36); g.closePath(); g.fill();
    g.fillStyle = "#a8774a"; g.fillRect(12, 34, 40, 24);
    g.fillStyle = "#d8b45e"; g.beginPath(); g.moveTo(32, 8); g.lineTo(58, 35); g.lineTo(6, 35); g.closePath(); g.fill();
    g.fillStyle = "#3a2a18"; g.fillRect(27, 42, 10, 16);
  });
  cell(2, () => { // maison longue d'agriculteurs
    g.fillStyle = OUT; g.fillRect(3, 30, 58, 30); g.beginPath(); g.moveTo(1, 32); g.lineTo(14, 12); g.lineTo(50, 12); g.lineTo(63, 32); g.closePath(); g.fill();
    g.fillStyle = "#9c6b42"; g.fillRect(6, 32, 52, 26);
    g.fillStyle = "#cfa95a"; g.beginPath(); g.moveTo(5, 31); g.lineTo(16, 15); g.lineTo(48, 15); g.lineTo(59, 31); g.closePath(); g.fill();
    g.fillStyle = "#3a2a18"; g.fillRect(28, 42, 9, 16);
  });
  cell(3, () => { // grenier sur pilotis
    g.fillStyle = OUT; g.fillRect(16, 46, 4, 14); g.fillRect(44, 46, 4, 14); g.fillRect(12, 24, 40, 24);
    g.beginPath(); g.moveTo(32, 6); g.lineTo(56, 26); g.lineTo(8, 26); g.closePath(); g.fill();
    g.fillStyle = "#b08050"; g.fillRect(15, 27, 34, 19);
    g.fillStyle = "#dcb862"; g.beginPath(); g.moveTo(32, 10); g.lineTo(52, 25); g.lineTo(12, 25); g.closePath(); g.fill();
  });
  for (const [i, k] of [[4, 0], [5, 1]] as const) {
    cell(i, () => { // feu de camp, deux images
      g.fillStyle = "#3a2414"; g.save(); g.translate(32, 54); g.rotate(0.35); g.fillRect(-14, -3, 28, 6); g.rotate(-0.7); g.fillRect(-14, -3, 28, 6); g.restore();
      const grd = g.createRadialGradient(32, 44, 2, 32, 44, 26);
      grd.addColorStop(0, "rgba(255,200,90,0.55)"); grd.addColorStop(1, "rgba(255,120,30,0)");
      g.fillStyle = grd; g.beginPath(); g.arc(32, 44, 26, 0, Math.PI * 2); g.fill();
      g.fillStyle = "#ff8a1e"; g.beginPath(); g.moveTo(32, k ? 20 : 26); g.quadraticCurveTo(46, 44, 32, 54); g.quadraticCurveTo(18, 44, 32, k ? 20 : 26); g.fill();
      g.fillStyle = "#ffd36a"; g.beginPath(); g.moveTo(32, k ? 34 : 30); g.quadraticCurveTo(39, 46, 32, 53); g.quadraticCurveTo(25, 46, 32, k ? 34 : 30); g.fill();
    });
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  return t;
}

const vertexShader = /* glsl */ `
  attribute vec3 color;
  attribute float seed;
  attribute float variant;   // 0–7 personnage ; 16 tente ; 17 hutte ; 18 maison longue ; 19 grenier ; 20 feu
  uniform float uTime;
  uniform float uScale;
  uniform float uWorldSize;
  uniform float uAnimate;
  varying vec3 vColor;
  varying float vFacing;
  varying vec2 vCell;
  varying float vFade;
  void main() {
    vec3 n = normalize(position);
    vec3 up = abs(n.y) > 0.98 ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 1.0, 0.0);
    vec3 t1 = normalize(cross(n, up));
    vec3 t2 = cross(n, t1);
    bool walker = variant < 8.0;
    float a = uTime * (0.25 + 0.2 * fract(seed * 7.13)) + seed * 6.2831;
    vec3 p = position + (walker ? (t1 * sin(a) + t2 * cos(a * 0.8)) * 0.0006 * uAnimate : vec3(0.0));
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    vFacing = dot(normalize(normalMatrix * n), normalize(-mv.xyz));
    float size = uWorldSize * (walker ? 1.0 : 1.5) * uScale / -mv.z;
    vFade = smoothstep(4.0, 10.0, size);
    gl_PointSize = clamp(size, 0.0, 110.0);
    float idx;
    if (walker) {
      idx = variant * 2.0 + mod(floor(uTime * 3.0 * uAnimate + seed * 10.0), 2.0);
    } else if (variant >= 20.0) {
      idx = 20.0 + mod(floor(uTime * 6.0 * uAnimate + seed * 10.0), 2.0);
    } else {
      idx = variant;
    }
    vCell = vec2(mod(idx, ${COLS}.0), floor(idx / ${COLS}.0));
    vColor = color;
    gl_Position = projectionMatrix * mv;
  }
`;

const fragmentShader = /* glsl */ `
  uniform sampler2D uMap;
  varying vec3 vColor;
  varying float vFacing;
  varying vec2 vCell;
  varying float vFade;
  void main() {
    if (vFacing < 0.05 || vFade < 0.01) discard;
    vec2 uv = (vCell + gl_PointCoord) / vec2(${COLS}.0, ${ROWS}.0);
    uv.y = 1.0 - uv.y;
    vec4 tex = texture2D(uMap, uv);
    if (tex.a < 0.3) discard;
    float rim = smoothstep(0.05, 0.3, vFacing);
    gl_FragColor = vec4(tex.rgb * vColor, tex.a * rim * vFade);
  }
`;

export class Bands {
  readonly points: THREE.Points;
  private geometry = new THREE.BufferGeometry();
  private material: THREE.ShaderMaterial;
  private positions = new Float32Array(MAX_SPRITES * 3);
  private colors = new Float32Array(MAX_SPRITES * 3);
  private seeds = new Float32Array(MAX_SPRITES);
  private variants = new Float32Array(MAX_SPRITES);
  peoplePerSprite = 25;

  constructor(pixelRatio: number) {
    const attrs: [string, Float32Array, number][] = [["position", this.positions, 3], ["color", this.colors, 3], ["seed", this.seeds, 1], ["variant", this.variants, 1]];
    for (const [name, arr, size] of attrs) {
      this.geometry.setAttribute(name, new THREE.BufferAttribute(arr, size).setUsage(THREE.DynamicDrawUsage));
    }
    this.geometry.setDrawRange(0, 0);
    this.material = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      transparent: true,
      depthWrite: false,
      uniforms: {
        uMap: { value: makeAtlas() },
        uTime: { value: 0 },
        uScale: { value: 800 * pixelRatio },
        uWorldSize: { value: WORLD_SIZE },
        uAnimate: { value: 1 },
      },
    });
    this.points = new THREE.Points(this.geometry, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 2;
  }

  /** Échelle de projection : pixels par unité de distance, d'après la hauteur d'écran et le champ de vision. */
  setViewport(heightPx: number, fovDeg: number, pixelRatio: number) {
    this.material.uniforms.uScale.value = (heightPx * pixelRatio) / (2 * Math.tan((fovDeg * Math.PI) / 360));
  }

  /** focus : en vue rapprochée, on ne garnit que la région regardée, avec plus de figures par
   *  personne réelle (même données, représentation plus fine). */
  update(data: RunData, frame: number, focus?: { lat: number; lon: number; radiusDeg: number }): number {
    const { ny, nx, res } = data.manifest.grid;
    const plane = ny * nx;
    const off = frame * 3 * plane;
    const base = data.frames.subarray(off, off + plane);
    const layers = [data.frames.subarray(off + plane, off + 2 * plane), data.frames.subarray(off + 2 * plane, off + 3 * plane)];
    const temp = data.climate ? data.climate.subarray(off, off + plane) : null;
    const { density_lo: lo, density_hi: hi } = data.manifest.frames;
    const llo = Math.log10(lo);
    const span = Math.log10(hi) - llo;
    const nExtra = data.manifest.extra?.layers.length ?? 0;
    const agriIdx = data.manifest.extra?.layers.findIndex((l) => l.id === "agri") ?? -1;
    const agri = agriIdx >= 0 && data.extra ? data.extra.subarray(frame * nExtra * plane + agriIdx * plane, frame * nExtra * plane + (agriIdx + 1) * plane) : null;

    const people: Float32Array[] = layers.map(() => new Float32Array(plane));
    let total = 0;
    const cosR = focus ? Math.cos((focus.radiusDeg * Math.PI) / 180) : -2;
    const fla = focus ? (focus.lat * Math.PI) / 180 : 0, flo = focus ? (focus.lon * Math.PI) / 180 : 0;
    for (let i = 0; i < ny; i++) {
      const lat = 90 - res * (i + 0.5);
      const area = (KM_PER_DEG * res) ** 2 * Math.cos((lat * Math.PI) / 180);
      const la = (lat * Math.PI) / 180;
      for (let j = 0; j < nx; j++) {
        const k = i * nx + j;
        if (!(base[k] & 1) || base[k] & 2) continue;
        if (focus) {
          const lo = ((-180 + res * (j + 0.5)) * Math.PI) / 180;
          const cosd = Math.sin(fla) * Math.sin(la) + Math.cos(fla) * Math.cos(la) * Math.cos(lo - flo);
          if (cosd < cosR) continue;
        }
        for (let L = 0; L < 2; L++) {
          const q = layers[L][k];
          if (!q) continue;
          const n = 10 ** (llo + ((q - 1) / 254) * span) * area;
          people[L][k] = n;
          total += n;
        }
      }
    }
    const S = (focus ? [5, 10, ...NICE] : NICE).find((v) => v >= total / (MAX_SPRITES * 0.8)) ?? NICE[NICE.length - 1];
    this.peoplePerSprite = S;

    let count = 0;
    const put = (lat: number, lon: number, col: THREE.Color, seed: number, variant: number) => {
      const la = (lat * Math.PI) / 180, lo2 = (lon * Math.PI) / 180;
      this.positions.set([RADIUS * Math.cos(la) * Math.cos(lo2), RADIUS * Math.sin(la), -RADIUS * Math.cos(la) * Math.sin(lo2)], count * 3);
      this.colors.set([col.r, col.g, col.b], count * 3);
      this.seeds[count] = seed;
      this.variants[count] = variant;
      count++;
    };
    outer: for (let i = 0; i < ny; i++) {
      const lat0 = 90 - res * (i + 0.5);
      for (let j = 0; j < nx; j++) {
        const k = i * nx + j;
        const T = temp && temp[k] ? -40 + (75 * (temp[k] - 1)) / 254 : 15;
        for (let L = 0; L < 2; L++) {
          const n = people[L][k];
          if (!n) continue;
          const exact = n / S;
          const m = Math.min(MAX_PER_CELL, Math.floor(exact) + (hash(i, j, 999 + L) < exact % 1 ? 1 : 0));
          const farm = L === 0 && agri && agri[k] ? (agri[k] - 1) / 254 : 0;
          for (let s = 0; s < m; s++) {
            if (count >= MAX_SPRITES - 2) break outer;
            const lat = lat0 + (hash(i, j, s * 2 + L * 101) - 0.5) * res * 0.95;
            const lon = -180 + res * (j + 0.5) + (hash(j, i, s * 2 + 1 + L * 101) - 0.5) * res * 0.95;
            const seed = hash(i, j, s + 7);
            const roll = hash(i, j, s + 555);
            if (farm > 0.3 && roll < farm * 0.45) {
              put(lat, lon, WHITE, seed, roll < farm * 0.12 ? 19 : 18); // village : maisons longues, greniers
            } else if (roll > 0.82) {
              put(lat, lon, WHITE, seed, 20); // campement : un feu et un abri adapté au climat
              put(lat + 0.04, lon + 0.05, WHITE, seed, T < 5 ? 16 : 17);
            } else {
              put(lat, lon, L === 0 ? SAPIENS : ARCHAIC, seed, Math.floor(seed * 8));
            }
          }
        }
      }
    }
    this.geometry.setDrawRange(0, count);
    for (const name of ["position", "color", "seed", "variant"]) (this.geometry.getAttribute(name) as THREE.BufferAttribute).needsUpdate = true;
    return S;
  }

  tick(seconds: number, _cameraDistance: number, visible: boolean, animate: boolean) {
    this.material.uniforms.uTime.value = seconds;
    this.material.uniforms.uAnimate.value = animate ? 1 : 0;
    this.points.visible = visible;
  }

  dispose() {
    this.geometry.dispose();
    (this.material.uniforms.uMap.value as THREE.Texture).dispose();
    this.material.dispose();
  }
}
