import * as THREE from "three";
import type { Devanture } from "../data/types";
import { MeshBuilder, toThree, UvMeshBuilder, type Vec3 } from "./geometry";
import type { SignAtlas } from "./sign-atlas";

/**
 * Devanture en applique d'après photo (D141), dessinée telle quelle sur le mur d'entrée : panneau de fond, pilastres à base de pierre et
 * chapiteau, porte d'immeuble pleine à panneaux et imposte, vitrines sur soubassements de pierre à grecque, porte vitrée du magasin, frise,
 * corniche, bandeau haut, enseigne peinte, inscription sur la vitrine, numéro sur un pilastre ; vêtements en aplats derrière les vitres.
 * La nuit, vitrines et porte du magasin s'allument (maillage des vitres allumées).
 */

/** Repère : point du début du mur au niveau du trottoir, tangente (tx, ty) et normale sortante (nx, ny). */
export interface DevantureFrame {
  x: number;
  y: number;
  z: number;
  tx: number;
  ty: number;
  nx: number;
  ny: number;
}

const C = (hex: string): THREE.Color => new THREE.Color(hex);
const shade = (c: THREE.Color, k: number): THREE.Color => c.clone().multiplyScalar(k);
const GLASS_LO = C("#26313a"), GLASS_HI = C("#4a5a66"), GLOW_LO = C("#ffcf86"), GLOW_HI = C("#fff3d6"), BRASS = C("#c9a24a"), STAND = C("#3a3029");
/**
 * Vêtements de la photo [couleur, position dans la vitrine (0 à 1), largeur, longueur] : rayon de gauche (robe fleurie, pantalon rose, haut
 * blanc, jupe blanche), mannequins de droite devant un fond vert (robe à pois, chemise bleu ciel, robe corail).
 */
const CLOTHES: [string, number, number, number][][] = [
  [["#c8505a", 0.14, 0.34, 0.95], ["#e79bb8", 0.36, 0.3, 0.9], ["#f1efe9", 0.56, 0.3, 0.55], ["#ece9e2", 0.8, 0.22, 0.85]],
  [["#33343a", 0.16, 0.27, 0.95], ["#a9c4e8", 0.5, 0.25, 0.8], ["#d0564c", 0.84, 0.27, 1.0]],
];
const BACKDROP = ["", "#7ea04a"];

export function buildDevanture(mb: MeshBuilder, glow: MeshBuilder | null, text: { mb: UvMeshBuilder; atlas: SignAtlas } | null, f: DevantureFrame, d: Devanture, color: string): void {
  const at = (s: number, z: number, off: number): Vec3 => toThree(f.x + f.tx * s + f.nx * off, f.y + f.ty * s + f.ny * off, f.z + z);
  const front = toThree(f.nx, f.ny, 0);
  const panel = (target: MeshBuilder, s0: number, s1: number, z0: number, z1: number, off: number, lo: THREE.Color, hi: THREE.Color = lo): void => {
    if (lo === hi) target.quad(at(s0, z0, off), at(s1, z0, off), at(s1, z1, off), at(s0, z1, off), front, lo);
    else target.quadGradient(at(s0, z0, off), at(s1, z0, off), at(s1, z1, off), at(s0, z1, off), front, lo, hi);
  };
  /** Pavé en saillie : face avant, côtés, dessus et dessous (de off0 à off1 devant le mur). */
  const slab = (s0: number, s1: number, z0: number, z1: number, off0: number, off1: number, col: THREE.Color): void => {
    panel(mb, s0, s1, z0, z1, off1, col);
    const side = shade(col, 0.82);
    mb.quad(at(s0, z0, off0), at(s0, z0, off1), at(s0, z1, off1), at(s0, z1, off0), toThree(-f.tx, -f.ty, 0), side);
    mb.quad(at(s1, z0, off1), at(s1, z0, off0), at(s1, z1, off0), at(s1, z1, off1), toThree(f.tx, f.ty, 0), side);
    mb.quad(at(s0, z1, off0), at(s1, z1, off0), at(s1, z1, off1), at(s0, z1, off1), [0, 1, 0], shade(col, 1.08));
    mb.quad(at(s0, z0, off0), at(s1, z0, off0), at(s1, z0, off1), at(s0, z0, off1), [0, -1, 0], shade(col, 0.6));
  };
  const words = (s: string, sc: number, zc: number, h: number, off: number, col: string, script = false): void => {
    if (!text) return;
    const r = text.atlas.get(s, col, script), w = h * 6.4;
    text.mb.quad(at(sc - w / 2, zc - h / 2, off), at(sc + w / 2, zc - h / 2, off), at(sc + w / 2, zc + h / 2, off), at(sc - w / 2, zc + h / 2, off), front,
      [r.u0, r.v0], [r.u1, r.v0], [r.u1, r.v1], [r.u0, r.v1], C("#ffffff"));
  };

  const BLUE = C(color), DEEP = shade(BLUE, 0.78), STONE = C(d.stone), KEY = shade(STONE, 0.62);
  const width = d.bays.reduce((a, q) => a + q[1], 0);
  const S0 = d.s0, S1 = d.s0 + width, [f0, f1] = d.frieze;

  // Panneau de fond, frise, corniche moulurée, bandeau haut.
  panel(mb, S0, S1, -0.3, d.h, 0.05, BLUE);
  slab(S0 - 0.04, S1 + 0.04, f0, f1, 0.05, 0.16, BLUE);
  slab(S0 - 0.12, S1 + 0.12, f1, d.cornice, 0.05, 0.3, shade(BLUE, 1.1));
  slab(S0 - 0.04, S1 + 0.04, d.cornice, d.h, 0.05, 0.1, BLUE);

  let s = S0;
  const lit = (s0: number, s1: number, z0: number, z1: number, off: number): void => {
    panel(mb, s0, s1, z0, z1, off, GLASS_LO, GLASS_HI);
    if (glow) panel(glow, s0, s1, z0, z1, off + 0.006, GLOW_LO, GLOW_HI);
  };
  let windows = 0;
  d.bays.forEach(([kind, w], bi) => {
    const a = s, b = s + w, m = (a + b) / 2;
    s = b;
    if (kind === "pilaster") {
      // Base de pierre (le soubassement continue sous les pilastres), fût, chapiteau et console sous la frise.
      slab(a, b, -0.3, d.sill, 0.05, 0.2, STONE);
      slab(a + 0.03, b - 0.03, d.sill, d.top, 0.05, 0.17, BLUE);
      panel(mb, a + 0.1, b - 0.1, d.sill + 0.15, d.top - 0.15, 0.175, DEEP);
      slab(a - 0.03, b + 0.03, d.top, f0 + 0.04, 0.05, 0.22, shade(BLUE, 1.12));
      if (d.number?.[0] === bi) words(d.number[1], m, 1.85, 0.3, 0.18, "#2c3150");
      return;
    }
    if (kind === "door") {
      // Porte d'immeuble pleine à deux vantaux, panneaux en creux, imposte vitrée ; seuil de pierre.
      const zt = d.top + 0.1, zi = zt - 0.46;
      slab(a, b, -0.3, 0.06, 0.05, 0.12, STONE);
      panel(mb, a + 0.05, b - 0.05, 0.06, zt, 0.07, DEEP);
      for (const [l0, l1] of [[a + 0.08, m - 0.02], [m + 0.02, b - 0.08]] as const) {
        panel(mb, l0, l1, 0.06, zi - 0.05, 0.09, BLUE);
        panel(mb, l0 + 0.08, l1 - 0.08, 0.2, 0.75, 0.1, DEEP);
        panel(mb, l0 + 0.08, l1 - 0.08, 0.95, zi - 0.2, 0.1, DEEP);
      }
      panel(mb, a + 0.1, b - 0.1, zi, zt - 0.06, 0.09, GLASS_LO, GLASS_HI);
      panel(mb, m - 0.2, m - 0.12, 1.05, 1.13, 0.11, BRASS);
      return;
    }
    if (kind === "shopdoor") {
      // Porte vitrée du magasin : cadre bleu, bas plein, vitre, imposte ; marche de pierre.
      slab(a, b, -0.3, 0.12, 0.05, 0.14, STONE);
      panel(mb, a, b, 0.12, d.top, 0.07, BLUE);
      panel(mb, a + 0.08, b - 0.08, 0.2, 0.62, 0.085, DEEP);
      lit(a + 0.1, b - 0.1, 0.7, d.top - 0.5, 0.085);
      lit(a + 0.1, b - 0.1, d.top - 0.42, d.top - 0.08, 0.085);
      panel(mb, a + 0.1, a + 0.14, 1.0, 1.2, 0.1, BRASS);
      return;
    }
    // Vitrine sur soubassement de pierre à grecque.
    slab(a, b, -0.3, d.sill, 0.05, 0.13, STONE);
    const zk0 = 0.18, zk1 = d.sill - 0.16, unit = 0.32;
    const n = Math.max(1, Math.floor((w - 0.2) / unit)), k0 = m - (n * unit) / 2;
    panel(mb, k0, k0 + n * unit, zk0, zk0 + 0.03, 0.135, KEY);
    panel(mb, k0, k0 + n * unit, zk1 - 0.03, zk1, 0.135, KEY);
    for (let i = 0; i < n; i++) {
      // Motif de la grecque : un crochet par module (montant, traverse, retour).
      const u = k0 + i * unit;
      panel(mb, u + 0.04, u + 0.07, zk0, zk1 - 0.08, 0.135, KEY);
      panel(mb, u + 0.04, u + 0.24, zk1 - 0.11, zk1 - 0.08, 0.135, KEY);
      panel(mb, u + 0.21, u + 0.24, zk0 + 0.1, zk1 - 0.08, 0.135, KEY);
      panel(mb, u + 0.13, u + 0.24, zk0 + 0.1, zk0 + 0.13, 0.135, KEY);
    }
    panel(mb, a, b, d.sill, d.top, 0.07, BLUE);
    lit(a + 0.07, b - 0.07, d.sill + 0.07, d.top - 0.07, 0.08);
    // Vêtements en aplats derrière la vitre : sur un rayon (première vitrine) ou des mannequins devant un fond (seconde).
    const set = CLOTHES[windows % CLOTHES.length]!, back = BACKDROP[windows % BACKDROP.length]!;
    const top = Math.min(d.sill + 1.3, d.top - 0.62), inner = w - 0.3;
    // Devant la lumière de nuit de la vitre (0,086), pour rester visibles le soir.
    if (back) panel(mb, a + inner * 0.55, b - 0.1, d.sill + 0.25, top + 0.25, 0.09, C(back));
    for (const [hex, u, ww, hh] of set) {
      const c = a + 0.15 + inner * u;
      panel(mb, c - ww / 2, c + ww / 2, top - hh, top, 0.093, C(hex));
      if (hex === "#33343a") for (let k = 0; k < 9; k++) panel(mb, c - ww / 3 + (k % 3) * ww / 3 - 0.02, c - ww / 3 + (k % 3) * ww / 3 + 0.02, top - 0.2 - Math.floor(k / 3) * 0.25, top - 0.16 - Math.floor(k / 3) * 0.25, 0.094, C("#f1efe9"));
      if (back) {
        panel(mb, c - 0.015, c + 0.015, d.sill + 0.07, top - hh, 0.092, STAND);
        panel(mb, c - 0.07, c + 0.07, top, top + 0.12, 0.092, C("#d9c7b0"));
      }
    }
    if (!back) panel(mb, a + 0.12, b - 0.12, top + 0.04, top + 0.08, 0.094, STAND);
    if (d.label?.[0] === bi) words(d.label[1], m, d.top - 0.42, 0.28, 0.095, "#ffffff");
    windows++;
  });

  // Enseigne peinte : panneau rouge en avant de la corniche, nom en italique blanc.
  const { s: [ss0, ss1], z: [sz0, sz1] } = d.sign;
  slab(ss0, ss1, sz0, sz1, 0.05, 0.32, C(d.sign.bg));
  words(d.sign.text, (ss0 + ss1) / 2, (sz0 + sz1) / 2, Math.min(sz1 - sz0 - 0.12, (ss1 - ss0 - 0.1) / 6.4) * 1.0, 0.325, d.sign.fg, true);
}
