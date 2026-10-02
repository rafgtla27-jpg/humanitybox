/**
 * Silhouettes de groupes humains sur le globe (piste sprites, étape S1).
 *
 * Ce que c'est : une représentation fidèle des densités simulées. Une silhouette = S personnes
 * (S choisi pour ne jamais dépasser MAX_SPRITES), placée de façon stable dans sa cellule : quand
 * la population d'une cellule grandit, des silhouettes apparaissent ; quand elle décline, elles
 * disparaissent.
 * Ce que ce n'est pas (encore) : des individus simulés. Le petit mouvement sur place est
 * décoratif. Les vrais agents arrivent avec la résolution adaptative (V0.6+, étape S3).
 */
import * as THREE from "three";
import type { RunData } from "./paint";

export const MAX_SPRITES = 30000;
const MAX_PER_CELL = 40;
const RADIUS = 1.004;
const NICE = [25, 50, 100, 200, 500, 1000, 2000, 5000, 10000];
const KM_PER_DEG = 111.2;

const SAPIENS = new THREE.Color("#ffb54a");
const ARCHAIC = new THREE.Color("#c4dcae");

/** Hachage déterministe → [0, 1) : même cellule, même rang = même position à chaque frame. */
function hash(a: number, b: number, c: number) {
  let h = (a * 374761393 + b * 668265263 + c * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function silhouetteTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d")!;
  const figure = (grow: number) => {
    g.beginPath();
    g.arc(30, 13, 7.5 + grow, 0, Math.PI * 2); // tête
    g.fill();
    g.beginPath();
    g.roundRect(21 - grow, 23 - grow, 18 + 2 * grow, 21 + 2 * grow, 7); // torse
    g.fill();
    g.fillRect(22.5 - grow, 40, 6.5 + 2 * grow, 19 + grow); // jambes
    g.fillRect(31 - grow, 40, 6.5 + 2 * grow, 19 + grow);
    g.save(); // bâton
    g.translate(45, 8);
    g.rotate(0.16);
    g.fillRect(-grow, -grow, 3.5 + 2 * grow, 52 + 2 * grow);
    g.restore();
  };
  g.fillStyle = "#1a1408"; // contour sombre : lisible sur n'importe quel sol
  figure(2.6);
  g.fillStyle = "#ffffff"; // partie teintée par la couleur de la population
  figure(0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const vertexShader = /* glsl */ `
  attribute vec3 color;
  attribute float seed;
  uniform float uTime;
  uniform float uSize;
  uniform float uPixelRatio;
  varying vec3 vColor;
  varying float vFacing;
  void main() {
    vec3 n = normalize(position);
    vec3 up = abs(n.y) > 0.98 ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 1.0, 0.0);
    vec3 t1 = normalize(cross(n, up));
    vec3 t2 = cross(n, t1);
    float a = uTime * (0.35 + 0.3 * fract(seed * 7.13)) + seed * 6.2831;
    vec3 p = position + (t1 * sin(a) + t2 * cos(a * 0.8)) * 0.0011;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    vFacing = dot(normalize(normalMatrix * n), normalize(-mv.xyz));
    vColor = color;
    gl_PointSize = uSize * uPixelRatio;
    gl_Position = projectionMatrix * mv;
  }
`;

const fragmentShader = /* glsl */ `
  uniform sampler2D uMap;
  uniform float uOpacity;
  varying vec3 vColor;
  varying float vFacing;
  void main() {
    if (vFacing < 0.05) discard;               // face cachée du globe
    vec4 tex = texture2D(uMap, gl_PointCoord);
    if (tex.a < 0.35) discard;
    float rim = smoothstep(0.05, 0.35, vFacing); // s'estompe vers l'horizon
    gl_FragColor = vec4(vColor * tex.rgb, tex.a * uOpacity * rim);
  }
`;

export class Bands {
  readonly points: THREE.Points;
  private geometry = new THREE.BufferGeometry();
  private material: THREE.ShaderMaterial;
  private positions = new Float32Array(MAX_SPRITES * 3);
  private colors = new Float32Array(MAX_SPRITES * 3);
  private seeds = new Float32Array(MAX_SPRITES);
  peoplePerSprite = 25;

  constructor(pixelRatio: number) {
    this.geometry.setAttribute("position", new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setAttribute("color", new THREE.BufferAttribute(this.colors, 3).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setAttribute("seed", new THREE.BufferAttribute(this.seeds, 1).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setDrawRange(0, 0);
    this.material = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      transparent: true,
      depthWrite: false,
      uniforms: {
        uMap: { value: silhouetteTexture() },
        uTime: { value: 0 },
        uSize: { value: 26 },
        uPixelRatio: { value: pixelRatio },
        uOpacity: { value: 1 },
      },
    });
    this.points = new THREE.Points(this.geometry, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 2;
  }

  /** Recalcule les silhouettes pour une frame. Renvoie le nombre de personnes par silhouette. */
  update(data: RunData, frame: number): number {
    const { ny, nx, res } = data.manifest.grid;
    const plane = ny * nx;
    const off = frame * 3 * plane;
    const base = data.frames.subarray(off, off + plane);
    const layers = [data.frames.subarray(off + plane, off + 2 * plane), data.frames.subarray(off + 2 * plane, off + 3 * plane)];
    const { density_lo: lo, density_hi: hi } = data.manifest.frames;
    const llo = Math.log10(lo);
    const span = Math.log10(hi) - llo;

    // Effectifs par cellule (densité déquantifiée × surface)
    const people: Float32Array[] = layers.map(() => new Float32Array(plane));
    let total = 0;
    for (let i = 0; i < ny; i++) {
      const lat = 90 - res * (i + 0.5);
      const area = (KM_PER_DEG * res) ** 2 * Math.cos((lat * Math.PI) / 180);
      for (let j = 0; j < nx; j++) {
        const k = i * nx + j;
        if (!(base[k] & 1) || base[k] & 2) continue;
        for (let L = 0; L < 2; L++) {
          const q = layers[L][k];
          if (!q) continue;
          const n = 10 ** (llo + ((q - 1) / 254) * span) * area;
          people[L][k] = n;
          total += n;
        }
      }
    }
    const target = total / (MAX_SPRITES * 0.85);
    const S = NICE.find((v) => v >= target) ?? NICE[NICE.length - 1];
    this.peoplePerSprite = S;

    let count = 0;
    outer: for (let i = 0; i < ny; i++) {
      const lat0 = 90 - res * (i + 0.5);
      for (let j = 0; j < nx; j++) {
        const k = i * nx + j;
        for (let L = 0; L < 2; L++) {
          const n = people[L][k];
          if (!n) continue;
          // Arrondi stochastique mais stable : la fraction restante décide d'une silhouette de plus
          const exact = n / S;
          const m = Math.min(MAX_PER_CELL, Math.floor(exact) + (hash(i, j, 999 + L) < exact % 1 ? 1 : 0));
          for (let s = 0; s < m; s++) {
            if (count >= MAX_SPRITES) break outer;
            const lat = lat0 + (hash(i, j, s * 2 + L * 101) - 0.5) * res * 0.95;
            const lon = -180 + res * (j + 0.5) + (hash(j, i, s * 2 + 1 + L * 101) - 0.5) * res * 0.95;
            const la = (lat * Math.PI) / 180;
            const lo2 = (lon * Math.PI) / 180;
            // Même convention que la texture du globe : longitude 0 sur +X, 90°E vers −Z
            this.positions[count * 3] = RADIUS * Math.cos(la) * Math.cos(lo2);
            this.positions[count * 3 + 1] = RADIUS * Math.sin(la);
            this.positions[count * 3 + 2] = -RADIUS * Math.cos(la) * Math.sin(lo2);
            const col = L === 0 ? SAPIENS : ARCHAIC;
            this.colors[count * 3] = col.r;
            this.colors[count * 3 + 1] = col.g;
            this.colors[count * 3 + 2] = col.b;
            this.seeds[count] = hash(i, j, s + 7);
            count++;
          }
        }
      }
    }
    this.geometry.setDrawRange(0, count);
    for (const name of ["position", "color", "seed"]) (this.geometry.getAttribute(name) as THREE.BufferAttribute).needsUpdate = true;
    return S;
  }

  /** À appeler à chaque image : animation d'attente et apparition selon le zoom. */
  tick(seconds: number, cameraDistance: number, visible: boolean, animate: boolean) {
    if (animate) this.material.uniforms.uTime.value = seconds;
    // Discrètes vues de loin, nettes quand on s'approche de la surface
    const zoom = Math.min(1, Math.max(0, (4.6 - cameraDistance) / 3.0));
    // Invisibles en vue d'ensemble (la couleur du sol montre déjà la densité), nettes de près
    this.material.uniforms.uOpacity.value = visible ? Math.min(1, Math.max(0, (zoom - 0.12) * 2.2)) : 0;
    this.material.uniforms.uSize.value = 3.5 + 16 * zoom * zoom;
    this.points.visible = visible;
  }

  dispose() {
    this.geometry.dispose();
    (this.material.uniforms.uMap.value as THREE.Texture).dispose();
    this.material.dispose();
  }
}
