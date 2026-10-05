/**
 * Atlas de pixel art généré par le code (style « god game » à la WorldBox : petites figures nettes,
 * contour sombre d'un pixel, palette limitée). Rien n'est dessiné à la main : chaque figure sort de
 * règles (carrure, coiffure, objet porté, pas de marche) et d'un générateur pseudo-aléatoire.
 *
 * Les pixels de vêtements sont peints en MAGENTA : le shader les remplace par la couleur du peuple
 * (avec leur ombrage). Peau, cheveux, bois et chaume gardent leurs couleurs naturelles.
 */
import * as THREE from "three";

export const PX = 16;          // taille d'une case en pixels
export const COLS = 8;
export const ROWS = 4;
// Index des cases
export const PEOPLE = 0;       // 0–15 : 8 personnages × 2 pas
export const TENT = 16, HUT = 17, LONGHOUSE = 18, GRANARY = 19, WELL = 20, FIRE = 21; // FIRE et FIRE+1 : flammes
export const HOUSE = 24, PEN = 25, TOTEM = 26;

const SKIN = ["#f1c9a5", "#d9a277", "#a8714a", "#6e4528"];
const HAIR = ["#2a1c12", "#4a2e1a", "#7a4b23", "#1b1b1b", "#b88a4a"];
const OUT = "#1a120a";
const CLOTH = "#ff00ff", CLOTH_D = "#b000b0"; // clés de couleur remplacées par le peuple

function rng(seed: number) {
  let s = (seed * 2654435761) >>> 0;
  return () => {
    s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

type Pix = (x: number, y: number, c: string) => void;

function outline(g: CanvasRenderingContext2D, ox: number, oy: number) {
  // Contour d'un pixel autour de tout ce qui est opaque dans la case
  const img = g.getImageData(ox, oy, PX, PX);
  const a = (x: number, y: number) => x >= 0 && y >= 0 && x < PX && y < PX && img.data[(y * PX + x) * 4 + 3] > 0;
  const add: [number, number][] = [];
  for (let y = 0; y < PX; y++) for (let x = 0; x < PX; x++) {
    if (a(x, y)) continue;
    if (a(x - 1, y) || a(x + 1, y) || a(x, y - 1) || a(x, y + 1)) add.push([x, y]);
  }
  g.fillStyle = OUT;
  for (const [x, y] of add) g.fillRect(ox + x, oy + y, 1, 1);
}

function person(p: Pix, v: number, frame: number) {
  const r = rng(v * 97 + 13);
  const skin = SKIN[Math.floor(r() * SKIN.length)];
  const hair = HAIR[Math.floor(r() * HAIR.length)];
  const tall = r() > 0.5 ? 1 : 0;           // une ligne de plus
  const wide = r() > 0.6;                    // carrure
  const robe = v % 2 === 1;                  // robe longue / tunique courte
  const item = v % 4;                        // 0 lance, 1 panier, 2 bâton, 3 rien (enfant au bras ? non : mains libres)
  const longHair = r() > 0.5;
  const top = 3 - tall;
  // tête (3×3) et cheveux
  for (let y = 0; y < 3; y++) for (let x = 6; x < 9; x++) p(x, top + y, skin);
  for (let x = 6; x < 9; x++) p(x, top - 1, hair);
  p(5, top, hair); p(9, top, hair);
  if (longHair) { p(5, top + 1, hair); p(9, top + 1, hair); p(9, top + 2, hair); }
  p(7, top + 1, OUT); // regard
  // corps
  const bx0 = wide ? 5 : 6, bx1 = wide ? 10 : 9;
  for (let y = top + 3; y < top + 7; y++) for (let x = bx0; x < bx1; x++) p(x, y, x === bx0 ? CLOTH_D : CLOTH);
  if (robe) for (let x = bx0 - 1; x < bx1 + 1; x++) { p(x, top + 7, CLOTH_D); p(x, top + 8, CLOTH); }
  // bras qui balancent
  const sw = frame === 0 ? 0 : 1;
  p(bx0 - 1, top + 3 + sw, skin); p(bx0 - 1, top + 4 + sw, skin);
  p(bx1, top + 4 - sw, skin); p(bx1, top + 5 - sw, skin);
  // jambes (deux images de marche)
  const ly = top + (robe ? 9 : 7);
  const legs = frame === 0 ? [[6, 0], [8, 0]] : [[5, 1], [9, -1]];
  for (const [lx, d] of legs) for (let y = ly; y < 15; y++) p(lx + (y > ly + 1 ? d : 0), y, skin);
  // objet porté
  if (item === 0) for (let y = top - 3; y < 15; y++) p(bx1 + 1, y, "#7a5230"); // lance
  if (item === 0) { p(bx1 + 1, top - 4, "#c8c8c8"); }
  if (item === 1) for (let x = 5; x < 10; x++) { p(x, top - 2, "#c69a52"); p(x, top - 3, x % 2 ? "#a77a3a" : "#c69a52"); } // panier
  if (item === 2) for (let y = top; y < 15; y++) p(bx0 - 2, y, "#8a6238"); // bâton
}

function building(p: Pix, kind: number) {
  const thatch = ["#d8b45e", "#c49a48", "#e0c070"];
  const wood = ["#8a5a36", "#a06a40", "#6e4426"];
  if (kind === TENT) {
    for (let y = 2; y < 15; y++) { const w = Math.floor((y - 2) * 0.55); for (let x = 7 - w; x <= 8 + w; x++) p(x, y, (x + y) % 5 === 0 ? "#9a7c56" : "#bfa07a"); }
    for (let y = 9; y < 15; y++) { p(7, y, "#3a2a18"); p(8, y, "#3a2a18"); }
    p(6, 1, "#7a5230"); p(9, 1, "#7a5230"); p(5, 0, "#7a5230"); p(10, 0, "#7a5230");
  }
  if (kind === HUT) {
    for (let y = 9; y < 15; y++) for (let x = 3; x < 13; x++) p(x, y, x % 3 === 0 ? wood[2] : wood[0]);
    for (let y = 2; y < 10; y++) { const w = y - 2; for (let x = 7 - w; x <= 8 + w; x++) if (x > 0 && x < 15) p(x, y, thatch[(x + y) % 3]); }
    for (let y = 11; y < 15; y++) { p(7, y, "#2a1c10"); p(8, y, "#2a1c10"); }
  }
  if (kind === LONGHOUSE || kind === HOUSE) {
    const x0 = kind === LONGHOUSE ? 1 : 3, x1 = kind === LONGHOUSE ? 15 : 13;
    for (let y = 8; y < 15; y++) for (let x = x0; x < x1; x++) p(x, y, (x + (y >> 1)) % 4 === 0 ? wood[1] : wood[0]);
    for (let y = 3; y < 8; y++) for (let x = x0 - 1 + (7 - y) * 0 ; x < x1 + 1; x++) {
      const inset = 7 - y; if (x >= x0 - 1 + Math.max(0, inset - 3) && x < x1 + 1 - Math.max(0, inset - 3)) p(x, y, thatch[(x + y) % 3]);
    }
    for (let y = 10; y < 15; y++) { p(7, y, "#2a1c10"); p(8, y, "#2a1c10"); }
    if (kind === HOUSE) { p(4, 10, "#f0d080"); p(11, 10, "#f0d080"); } // fenêtres éclairées
  }
  if (kind === GRANARY) {
    for (const x of [5, 10]) for (let y = 11; y < 15; y++) p(x, y, wood[2]);
    for (let y = 6; y < 11; y++) for (let x = 4; x < 12; x++) p(x, y, wood[1]);
    for (let y = 1; y < 6; y++) { const w = y + 1; for (let x = 8 - w; x < 8 + w; x++) p(x, y, thatch[(x + y) % 3]); }
  }
  if (kind === WELL) {
    for (let y = 9; y < 14; y++) for (let x = 4; x < 12; x++) p(x, y, (x + y) % 2 ? "#8c8c84" : "#a3a39a");
    for (let x = 5; x < 11; x++) p(x, 9, "#3a5f7a");
    for (let y = 3; y < 9; y++) { p(4, y, wood[2]); p(11, y, wood[2]); }
    for (let x = 3; x < 13; x++) p(x, 3, wood[0]);
  }
  if (kind === PEN) {
    for (let x = 1; x < 15; x++) { p(x, 9, wood[0]); p(x, 12, wood[0]); }
    for (let x = 1; x < 15; x += 3) for (let y = 8; y < 15; y++) p(x, y, wood[2]);
    p(6, 10, "#f0f0e8"); p(7, 10, "#f0f0e8"); p(9, 11, "#e8e8e0"); p(10, 11, "#e8e8e0"); // moutons
  }
  if (kind === TOTEM) {
    for (let y = 2; y < 15; y++) for (let x = 7; x < 9; x++) p(x, y, y % 4 === 0 ? "#b04a2a" : wood[0]);
    p(6, 4, "#e0c070"); p(9, 4, "#e0c070"); p(6, 8, "#3a6a8a"); p(9, 8, "#3a6a8a");
  }
}

function fire(p: Pix, frame: number) {
  for (let x = 3; x < 13; x++) p(x, 14, x % 2 ? "#5a3a20" : "#3a2414");
  const flame = frame === 0 ? [[7, 6], [8, 7], [6, 9], [9, 9]] : [[8, 5], [7, 7], [9, 8], [6, 10]];
  for (let y = 8; y < 14; y++) for (let x = 5; x < 11; x++) if (Math.abs(x - 7.5) < (14 - y) * 0.45) p(x, y, "#ff8a1e");
  for (let y = 10; y < 14; y++) for (let x = 6; x < 10; x++) if (Math.abs(x - 7.5) < (14 - y) * 0.3) p(x, y, "#ffd36a");
  for (const [x, y] of flame) p(x, y, "#ffb040");
}

export function makePixelAtlas(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = COLS * PX;
  c.height = ROWS * PX;
  const g = c.getContext("2d")!;
  const at = (idx: number) => {
    const ox = (idx % COLS) * PX, oy = Math.floor(idx / COLS) * PX;
    const p: Pix = (x, y, col) => { if (x >= 0 && y >= 0 && x < PX && y < PX) { g.fillStyle = col; g.fillRect(ox + x, oy + y, 1, 1); } };
    return { p, ox, oy };
  };
  for (let v = 0; v < 8; v++) for (let f = 0; f < 2; f++) { const { p, ox, oy } = at(PEOPLE + v * 2 + f); person(p, v, f); outline(g, ox, oy); }
  for (const k of [TENT, HUT, LONGHOUSE, GRANARY, WELL, HOUSE, PEN, TOTEM]) { const { p, ox, oy } = at(k); building(p, k); outline(g, ox, oy); }
  for (let f = 0; f < 2; f++) { const { p, ox, oy } = at(FIRE + f); fire(p, f); outline(g, ox, oy); }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = THREE.NearestFilter; // pixels nets, comme dans un god game
  t.minFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  return t;
}

/** Textures de sol (décalques à plat) : champ en sillons, terre battue de la place, chemin. */
export function makeGroundTextures() {
  const mk = (draw: (g: CanvasRenderingContext2D) => void) => {
    const c = document.createElement("canvas");
    c.width = c.height = 32;
    draw(c.getContext("2d")!);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.magFilter = THREE.NearestFilter;
    t.minFilter = THREE.NearestFilter;
    t.generateMipmaps = false;
    return t;
  };
  return {
    field: mk((g) => { // sillons blancs (teintés par la culture : blé, orge, jachère)
      for (let y = 0; y < 32; y++) { g.fillStyle = y % 4 < 2 ? "#ffffff" : "#d4d4d4"; g.fillRect(0, y, 32, 1); }
      g.fillStyle = "#9a9a9a"; g.fillRect(0, 0, 32, 1); g.fillRect(0, 31, 32, 1); g.fillRect(0, 0, 1, 32); g.fillRect(31, 0, 1, 32);
    }),
    plaza: mk((g) => {
      g.fillStyle = "rgba(0,0,0,0)"; g.fillRect(0, 0, 32, 32);
      for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
        const d = Math.hypot(x - 15.5, y - 15.5);
        if (d < 15) { g.fillStyle = (x * 7 + y * 13) % 5 === 0 ? "#a88a62" : "#bf9f74"; g.fillRect(x, y, 1, 1); }
      }
    }),
    path: mk((g) => {
      g.fillStyle = "rgba(0,0,0,0)"; g.fillRect(0, 0, 32, 32);
      for (let y = 0; y < 32; y++) for (let x = 10; x < 22; x++) { g.fillStyle = (x + y * 3) % 6 === 0 ? "#9c7f58" : "#b39570"; g.fillRect(x, y, 1, 1); }
    }),
  };
}
