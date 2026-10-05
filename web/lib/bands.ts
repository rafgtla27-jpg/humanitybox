/**
 * Établissements humains sur le globe — logique de village procédurale (sprites S2).
 *
 * Tout découle des données simulées de chaque cellule (population, part d'agriculteurs, climat) :
 *  - chasseurs-cueilleurs → CAMPEMENTS : un feu au centre, quelques abris en cercle (tentes de peaux
 *    s'il fait froid, huttes sinon), des gens autour ;
 *  - agriculteurs → VILLAGES qui « poussent » depuis une graine : place centrale et puits, maisons
 *    disposées en spirale (dense au centre, lâche en périphérie, comme les villages réels),
 *    greniers et enclos en lisière, chemins rayonnants, champs en parcelles autour.
 * Un village garde la même graine d'une image à l'autre : il grandit (maison k toujours au même
 * endroit) ou rétrécit au lieu de se redessiner au hasard.
 * Échelle « god game » : bâtiments et personnages sont exagérés (une maison ≈ 20 km) pour rester
 * lisibles ; ils n'apparaissent qu'en vue rapprochée.
 */
import * as THREE from "three";
import type { RunData } from "./paint";
import { COLS, FIRE, GRANARY, HOUSE, HUT, LONGHOUSE, PEN, PX, ROWS, TENT, TOTEM, WELL, makeGroundTextures, makePixelAtlas } from "./pixelart";

const R_SPRITE = 1.0016;
const R_DECAL = 1.0007;
const KM = 1 / 6371;
const MAX_BB = 24000;
const MAX_FIELDS = 9000, MAX_PLAZA = 900, MAX_PATH = 4000;
const PERSON_KM = 8.5;
const NICE = [5, 10, 25, 50, 100, 200, 500, 1000, 2000, 5000, 10000];

// Teintures des vêtements, par grande région (annonce des peuples de la piste G3)
const DYES = ["#c0392b", "#2e86c1", "#8e44ad", "#d35400", "#16a085", "#b7950b", "#a93226", "#1f618d", "#6c3483", "#117864"]
  .map((h) => new THREE.Color(h));
const ARCHAIC_CLOTH = new THREE.Color("#7a6a50");
const CROPS = ["#e2c55a", "#d9b84a", "#8bbf55", "#a2774a", "#c8d06a"].map((h) => new THREE.Color(h));

function hash(a: number, b: number, c: number) {
  let h = (a * 374761393 + b * 668265263 + c * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

const vertexShader = /* glsl */ `
  attribute vec3 color;
  attribute float seed;
  attribute float variant;
  attribute float size;
  attribute float anim;      // 0 fixe, 1 marcheur, 2 feu
  uniform float uTime;
  uniform float uScale;
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
    float a = uTime * (0.15 + 0.1 * fract(seed * 7.13)) + seed * 6.2831;
    vec3 p = position + (anim == 1.0 ? (t1 * sin(a) + t2 * cos(a * 0.7)) * 0.0009 * uAnimate : vec3(0.0));
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    vFacing = dot(normalize(normalMatrix * n), normalize(-mv.xyz));
    float px = size * uScale / -mv.z;
    vFade = smoothstep(5.0, 12.0, px);
    gl_PointSize = clamp(px, 0.0, 160.0);
    float idx = variant;
    if (anim == 1.0) idx = variant + mod(floor(uTime * 4.0 * uAnimate + seed * 10.0), 2.0);
    if (anim == 2.0) idx = variant + mod(floor(uTime * 7.0 * uAnimate + seed * 10.0), 2.0);
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
    if (tex.a < 0.5) discard;
    vec3 c = tex.rgb;
    // Clé magenta = vêtements : couleur du peuple, ombrage conservé
    if (c.r > 0.55 && c.b > 0.55 && c.g < 0.25) c = vColor * (0.55 + 0.45 * c.r);
    gl_FragColor = vec4(c, vFade * smoothstep(0.05, 0.3, vFacing));
  }
`;

type Focus = { lat: number; lon: number; radiusDeg: number; isLand?: (lat: number, lon: number) => boolean };

class Decals {
  readonly mesh: THREE.InstancedMesh;
  count = 0;
  private m = new THREE.Matrix4();
  constructor(tex: THREE.Texture, max: number, transparent: boolean, order: number) {
    const mat = new THREE.MeshLambertMaterial({ map: tex, transparent, alphaTest: transparent ? 0.5 : 0, polygonOffset: true, polygonOffsetFactor: -order, polygonOffsetUnits: -order * 2 });
    this.mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), mat, max);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.renderOrder = order;
  }
  reset() { this.count = 0; }
  add(lat: number, lon: number, yaw: number, wKm: number, hKm: number, color: THREE.Color) {
    if (this.count >= this.mesh.instanceMatrix.count) return;
    const la = (lat * Math.PI) / 180, lo = (lon * Math.PI) / 180;
    const n = new THREE.Vector3(Math.cos(la) * Math.cos(lo), Math.sin(la), -Math.cos(la) * Math.sin(lo));
    const east = new THREE.Vector3(-Math.sin(lo), 0, -Math.cos(lo));
    const north = new THREE.Vector3().crossVectors(n, east);
    const ax = east.clone().multiplyScalar(Math.cos(yaw)).addScaledVector(north, Math.sin(yaw)).multiplyScalar(wKm * KM);
    const ay = east.clone().multiplyScalar(-Math.sin(yaw)).addScaledVector(north, Math.cos(yaw)).multiplyScalar(hKm * KM);
    this.m.makeBasis(ax, ay, n);
    this.m.setPosition(n.multiplyScalar(R_DECAL));
    this.mesh.setMatrixAt(this.count, this.m);
    this.mesh.setColorAt(this.count, color);
    this.count++;
  }
  commit() {
    this.mesh.count = this.count;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
  dispose() { this.mesh.geometry.dispose(); (this.mesh.material as THREE.MeshLambertMaterial).map?.dispose(); (this.mesh.material as THREE.Material).dispose(); }
}

export class Bands {
  readonly points: THREE.Points;
  readonly group = new THREE.Group();
  private geometry = new THREE.BufferGeometry();
  private material: THREE.ShaderMaterial;
  private pos = new Float32Array(MAX_BB * 3);
  private col = new Float32Array(MAX_BB * 3);
  private seed = new Float32Array(MAX_BB);
  private variant = new Float32Array(MAX_BB);
  private size = new Float32Array(MAX_BB);
  private anim = new Float32Array(MAX_BB);
  private fields: Decals;
  private plazas: Decals;
  private paths: Decals;
  private n = 0;
  peoplePerSprite = 25;

  constructor(pixelRatio: number) {
    const attrs: [string, Float32Array, number][] = [["position", this.pos, 3], ["color", this.col, 3], ["seed", this.seed, 1], ["variant", this.variant, 1], ["size", this.size, 1], ["anim", this.anim, 1]];
    for (const [name, arr, k] of attrs) this.geometry.setAttribute(name, new THREE.BufferAttribute(arr, k).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setDrawRange(0, 0);
    this.material = new THREE.ShaderMaterial({
      vertexShader, fragmentShader, transparent: true, depthWrite: false,
      uniforms: { uMap: { value: makePixelAtlas() }, uTime: { value: 0 }, uScale: { value: 800 * pixelRatio }, uAnimate: { value: 1 } },
    });
    this.points = new THREE.Points(this.geometry, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 3;
    const tex = makeGroundTextures();
    this.fields = new Decals(tex.field, MAX_FIELDS, false, 1);
    this.plazas = new Decals(tex.plaza, MAX_PLAZA, true, 2);
    this.paths = new Decals(tex.path, MAX_PATH, true, 2);
    this.group.add(this.fields.mesh, this.paths.mesh, this.plazas.mesh, this.points);
  }

  setViewport(heightPx: number, fovDeg: number, pixelRatio: number) {
    this.material.uniforms.uScale.value = (heightPx * pixelRatio) / (2 * Math.tan((fovDeg * Math.PI) / 360));
  }

  private bb(lat: number, lon: number, variant: number, sizeKm: number, color: THREE.Color, seed: number, anim: number) {
    if (this.n >= MAX_BB) return;
    const la = (lat * Math.PI) / 180, lo = (lon * Math.PI) / 180, i = this.n;
    this.pos[i * 3] = R_SPRITE * Math.cos(la) * Math.cos(lo);
    this.pos[i * 3 + 1] = R_SPRITE * Math.sin(la);
    this.pos[i * 3 + 2] = -R_SPRITE * Math.cos(la) * Math.sin(lo);
    this.col[i * 3] = color.r; this.col[i * 3 + 1] = color.g; this.col[i * 3 + 2] = color.b;
    this.seed[i] = seed; this.variant[i] = variant; this.size[i] = sizeKm * KM; this.anim[i] = anim;
    this.n++;
  }

  update(data: RunData, frame: number, focus?: Focus): number {
    this.n = 0;
    this.fields.reset(); this.plazas.reset(); this.paths.reset();
    if (!focus) return this.finish();
    const { ny, nx, res } = data.manifest.grid;
    const plane = ny * nx, off = frame * 3 * plane;
    const base = data.frames.subarray(off, off + plane);
    const sap = data.frames.subarray(off + plane, off + 2 * plane);
    const arc = data.frames.subarray(off + 2 * plane, off + 3 * plane);
    const temp = data.climate ? data.climate.subarray(off, off + plane) : null;
    const { density_lo: lo, density_hi: hi } = data.manifest.frames;
    const llo = Math.log10(lo), span = Math.log10(hi) - llo;
    const nExtra = data.manifest.extra?.layers.length ?? 0;
    const ai = data.manifest.extra?.layers.findIndex((l) => l.id === "agri") ?? -1;
    const agri = ai >= 0 && data.extra ? data.extra.subarray(frame * nExtra * plane + ai * plane, frame * nExtra * plane + (ai + 1) * plane) : null;
    const pi = data.manifest.extra?.layers.findIndex((l) => l.id === "people") ?? -1;
    const peopleIdx = pi >= 0 && data.extra ? data.extra.subarray(frame * nExtra * plane + pi * plane, frame * nExtra * plane + (pi + 1) * plane) : null;
    const peopleCol = (data.manifest.peoples ?? []).map((p) => new THREE.Color(`rgb(${p.color[0]},${p.color[1]},${p.color[2]})`));
    const deq = (q: number) => (q ? 10 ** (llo + ((q - 1) / 254) * span) : 0);

    // Cellules regardées et population visible → combien de personnes par figure
    const cosR = Math.cos((focus.radiusDeg * Math.PI) / 180);
    const fla = (focus.lat * Math.PI) / 180, flo = (focus.lon * Math.PI) / 180;
    const cells: number[] = [];
    let total = 0;
    for (let i = 0; i < ny; i++) {
      const lat = 90 - res * (i + 0.5), la = (lat * Math.PI) / 180;
      const area = (111.2 * res) ** 2 * Math.cos(la);
      for (let j = 0; j < nx; j++) {
        const k = i * nx + j;
        if (!(base[k] & 1) || base[k] & 2 || (!sap[k] && !arc[k])) continue;
        const lo2 = ((-180 + res * (j + 0.5)) * Math.PI) / 180;
        if (Math.sin(fla) * Math.sin(la) + Math.cos(fla) * Math.cos(la) * Math.cos(lo2 - flo) < cosR) continue;
        cells.push(k);
        total += (deq(sap[k]) + deq(arc[k])) * area;
      }
    }
    const u = NICE.find((v) => v >= total / 9000) ?? NICE[NICE.length - 1];
    this.peoplePerSprite = u;

    const land = focus.isLand ?? (() => true);
    for (const k of cells) {
      const i = Math.floor(k / nx), j = k % nx;
      const lat0 = 90 - res * (i + 0.5), lon0 = -180 + res * (j + 0.5);
      const area = (111.2 * res) ** 2 * Math.cos((lat0 * Math.PI) / 180);
      const Ns = deq(sap[k]) * area, Na = deq(arc[k]) * area;
      const a = agri && agri[k] ? (agri[k] - 1) / 254 : 0;
      const T = temp && temp[k] ? -40 + (75 * (temp[k] - 1)) / 254 : 15;
      const farmers = a > 0.3 ? Ns * a : 0;
      // Vêtements aux couleurs du peuple de la cellule (sinon, teinture régionale par défaut)
      const pid = peopleIdx ? peopleIdx[k] : 0;
      const dye = pid && peopleCol[pid - 1] ? peopleCol[pid - 1] : DYES[Math.floor(hash(Math.floor(lat0 / 15), Math.floor(lon0 / 15), 3) * DYES.length)];
      const kmToDeg = (east: number, north: number, la0: number, lo0: number): [number, number] =>
        [la0 + north / 111.2, lo0 + east / (111.2 * Math.max(0.15, Math.cos((la0 * Math.PI) / 180)))];

      // --- Villages d'agriculteurs
      const fFig = farmers / u;
      const nVil = Math.min(3, Math.ceil(fFig / 45));
      for (let v = 0; v < nVil; v++) {
        const [cla, clo] = kmToDeg((hash(i, j, 40 + v) - 0.5) * 70, (hash(j, i, 50 + v) - 0.5) * 70, lat0, lon0);
        if (!land(cla, clo)) continue;
        const figs = fFig / nVil;
        const houses = Math.max(3, Math.min(36, Math.round(figs / 3)));
        // place, puits, totem
        this.plazas.add(cla, clo, 0, 14, 14, new THREE.Color("#ffffff"));
        this.bb(cla, clo, WELL, 18, dye, 0, 0);
        if (houses > 12) { const [ta, to] = kmToDeg(5, 4, cla, clo); this.bb(ta, to, TOTEM, 20, dye, 0, 0); }
        // maisons en spirale (angle d'or) : denses au centre, lâches en périphérie
        let rMax = 0;
        for (let h = 0; h < houses; h++) {
          const r = 9 + 5.2 * Math.sqrt(h + 1) + (hash(i * 7 + v, j, h) - 0.5) * 2.5;
          const ang = h * 2.39996 + hash(j, i * 7 + v, h) * 0.5;
          rMax = Math.max(rMax, r);
          const [ha, ho] = kmToDeg(Math.cos(ang) * r, Math.sin(ang) * r, cla, clo);
          if (!land(ha, ho)) continue;
          const outskirts = r > 9 + 5.2 * Math.sqrt(houses * 0.6);
          const kind = outskirts ? (h % 5 === 0 ? GRANARY : h % 7 === 0 ? PEN : HOUSE) : (h % 3 === 0 ? LONGHOUSE : HOUSE);
          this.bb(ha, ho, kind, kind === LONGHOUSE ? 24 : 20, dye, hash(i, j, h), 0);
        }
        // chemins rayonnants
        const nPaths = 3 + Math.floor(hash(i, j, 60 + v) * 3);
        for (let pth = 0; pth < nPaths; pth++) {
          const ang = (pth / nPaths) * Math.PI * 2 + hash(i, j, 70 + v) * 6.28;
          const len = rMax + 18;
          const [pa, po] = kmToDeg((Math.cos(ang) * len) / 2, (Math.sin(ang) * len) / 2, cla, clo);
          this.paths.add(pa, po, ang + Math.PI / 2, 3.2, len, new THREE.Color("#ffffff"));
        }
        // champs en parcelles autour
        const nFields = Math.min(60, Math.round(houses * 1.4));
        for (let f = 0; f < nFields; f++) {
          const ang = f * 2.39996 * 1.3 + hash(i, j, 300 + f) * 0.4;
          const r = rMax + 12 + hash(j, i, 400 + f) * 22 + (f % 3) * 6;
          const [fa, fo] = kmToDeg(Math.cos(ang) * r, Math.sin(ang) * r, cla, clo);
          if (!land(fa, fo)) continue;
          const crop = CROPS[Math.floor(hash(i + v, j, 500 + f) * CROPS.length)];
          this.fields.add(fa, fo, ang + (hash(i, j, 600 + f) - 0.5) * 0.4, 10 + hash(i, j, 700 + f) * 7, 7 + hash(j, i, 800 + f) * 5, crop);
        }
        // habitants : autour des maisons et dans les champs
        const people = Math.min(18, Math.round(figs * 0.6));
        for (let pp = 0; pp < people; pp++) {
          const inField = pp % 3 === 2;
          // dans les champs, sur la place, ou dans les ruelles entre deux rangées de maisons
          const r = inField ? rMax + 14 + hash(i, j, 900 + pp) * 20 : pp % 3 === 0 ? hash(i, j, 900 + pp) * 6 : 9 + 5.2 * Math.sqrt(1 + hash(i, j, 910 + pp) * houses) + 2.6;
          const ang = hash(j, i, 950 + pp) * 6.283;
          const [qa, qo] = kmToDeg(Math.cos(ang) * r, Math.sin(ang) * r, cla, clo);
          if (!land(qa, qo)) continue;
          this.bb(qa, qo, Math.floor(hash(i, j, 990 + pp) * 8) * 2, PERSON_KM, dye, hash(j, i, 990 + pp), 1);
        }
      }

      // --- Campements de chasseurs-cueilleurs (et des archaïques)
      for (const [N, cloth] of [[Ns - farmers, dye], [Na, ARCHAIC_CLOTH]] as const) {
        const figs = N / u;
        if (figs < 0.5) continue;
        const nCamps = Math.min(8, Math.max(1, Math.round(figs / 7)));
        for (let c = 0; c < nCamps; c++) {
          const [ca, co] = kmToDeg((hash(i, j, 100 + c) - 0.5) * 95, (hash(j, i, 110 + c) - 0.5) * 95, lat0, lon0);
          if (!land(ca, co)) continue;
          this.bb(ca, co, FIRE, 13, cloth, hash(i, j, c), 2);
          const shelters = 2 + Math.floor(hash(i, j, 120 + c) * 3);
          for (let s = 0; s < shelters; s++) {
            const ang = (s / shelters) * 6.283 + hash(i, j, 130 + c);
            const [sa, so] = kmToDeg(Math.cos(ang) * 9, Math.sin(ang) * 9, ca, co);
            this.bb(sa, so, T < 5 ? TENT : HUT, 18, cloth, 0, 0);
          }
          const people = Math.min(9, Math.max(1, Math.round(figs / nCamps)));
          for (let pp = 0; pp < people; pp++) {
            const ang = hash(i, j, 140 + c * 13 + pp) * 6.283, r = 4 + hash(j, i, 150 + pp) * 10;
            const [qa, qo] = kmToDeg(Math.cos(ang) * r, Math.sin(ang) * r, ca, co);
            this.bb(qa, qo, Math.floor(hash(i, j, 160 + pp + c) * 8) * 2, PERSON_KM, cloth, hash(j, i, 170 + pp + c), 1);
          }
        }
      }
    }
    return this.finish();
  }

  private finish() {
    this.geometry.setDrawRange(0, this.n);
    for (const name of ["position", "color", "seed", "variant", "size", "anim"]) (this.geometry.getAttribute(name) as THREE.BufferAttribute).needsUpdate = true;
    this.fields.commit(); this.plazas.commit(); this.paths.commit();
    return this.peoplePerSprite;
  }

  tick(seconds: number, _d: number, visible: boolean, animate: boolean) {
    this.material.uniforms.uTime.value = seconds;
    this.material.uniforms.uAnimate.value = animate ? 1 : 0;
    this.group.visible = visible;
  }

  dispose() {
    this.geometry.dispose();
    (this.material.uniforms.uMap.value as THREE.Texture).dispose();
    this.material.dispose();
    this.fields.dispose(); this.plazas.dispose(); this.paths.dispose();
  }
}
export const PIXEL = PX;
