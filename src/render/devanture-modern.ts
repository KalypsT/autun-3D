import * as THREE from "three";
import type { Devanture } from "../data/types";
import type { DevantureFrame } from "./devanture";
import { MeshBuilder, toThree, UvMeshBuilder, type Vec3 } from "./geometry";
import { crossFlag, tobaccoSign } from "./shopfront";
import type { SignAtlas } from "./sign-atlas";

/**
 * Façade moderne d'après photo (D159), pour la Grande Pharmacie Bonaparte et La Poste : un mur plein d'enduit ocre au rez-de-chaussée, des baies à
 * cadre d'aluminium gris (vitrines, portes vitrées, bandeaux clairs « MATÉRIEL MÉDICAL » et « ORTHOPÉDIE »), une porte pleine grise, des lettres blanches
 * posées sur le mur dont « PHARMACIE » en vert, la sous-enseigne du réseau, une rangée de projecteurs blancs, et la croix verte en drapeau. La nuit,
 * les vitres et la croix s'allument (maillage des vitres allumées). Les mêmes conventions de repère que `buildDevanture` (D141).
 */

const C = (hex: string): THREE.Color => new THREE.Color(hex);
const shade = (c: THREE.Color, k: number): THREE.Color => c.clone().multiplyScalar(k);
const GLASS_LO = C("#26313a"), GLASS_HI = C("#4f6270"), GLOW_LO = C("#ffcf86"), GLOW_HI = C("#fff3d6");
const ALU_GREY = C("#8b9298"), ALU_DARK = C("#5d646a"), DOOR_GREY = C("#8e9296"), PLINTH = C("#7d7a73"), SPOT = C("#f3f1ea");
/** Pas d'un caractère du texte d'enseigne, en fraction de la hauteur de ligne (cases de 256 × 40 px : lettres de 0,82 de la hauteur). */
const ADVANCE = 0.51;

export function buildModernFront(mb: MeshBuilder, glow: MeshBuilder | null, text: { mb: UvMeshBuilder; atlas: SignAtlas } | null, f: DevantureFrame, d: Devanture, color: string): void {
  const m = d.modern!;
  /** Cadres et porte pleine : gris par défaut, ou la couleur lue sur photo (D178). */
  const ALU = m.frame ? C(m.frame) : ALU_GREY, DOOR = m.doorColor ? C(m.doorColor) : DOOR_GREY;
  const at = (s: number, z: number, off: number): Vec3 => toThree(f.x + f.tx * s + f.nx * off, f.y + f.ty * s + f.ny * off, f.z + z);
  const front = toThree(f.nx, f.ny, 0);
  const panel = (target: MeshBuilder, s0: number, s1: number, z0: number, z1: number, off: number, lo: THREE.Color, hi: THREE.Color = lo): void => {
    if (lo === hi) target.quad(at(s0, z0, off), at(s1, z0, off), at(s1, z1, off), at(s0, z1, off), front, lo);
    else target.quadGradient(at(s0, z0, off), at(s1, z0, off), at(s1, z1, off), at(s0, z1, off), front, lo, hi);
  };
  /** Pavé en saillie : face avant, côtés, dessus. */
  const slab = (s0: number, s1: number, z0: number, z1: number, off0: number, off1: number, col: THREE.Color): void => {
    panel(mb, s0, s1, z0, z1, off1, col);
    const flank = shade(col, 0.82);
    mb.quad(at(s0, z0, off0), at(s0, z0, off1), at(s0, z1, off1), at(s0, z1, off0), toThree(-f.tx, -f.ty, 0), flank);
    mb.quad(at(s1, z0, off1), at(s1, z0, off0), at(s1, z1, off0), at(s1, z1, off1), toThree(f.tx, f.ty, 0), flank);
    mb.quad(at(s0, z1, off0), at(s1, z1, off0), at(s1, z1, off1), at(s0, z1, off1), [0, 1, 0], shade(col, 1.1));
  };
  const words = (s: string, sc: number, zc: number, h: number, off: number, col: string): void => {
    if (!text || !s) return;
    const r = text.atlas.get(s, col, false), w = h * 6.4;
    text.mb.quad(at(sc - w / 2, zc - h / 2, off), at(sc + w / 2, zc - h / 2, off), at(sc + w / 2, zc + h / 2, off), at(sc - w / 2, zc + h / 2, off), front,
      [r.u0, r.v0], [r.u1, r.v0], [r.u1, r.v1], [r.u0, r.v1], C("#ffffff"));
  };
  const disc = (s: number, z: number, r: number, off: number, col: THREE.Color): void => {
    const n = 14;
    for (let k = 0; k < n; k++) {
      const a0 = (k / n) * Math.PI * 2, a1 = ((k + 1) / n) * Math.PI * 2;
      mb.tri(at(s, z, off), at(s + Math.cos(a0) * r, z + Math.sin(a0) * r, off), at(s + Math.cos(a1) * r, z + Math.sin(a1) * r, off), front, col);
    }
  };

  const WALL = C(color);
  const width = d.bays.reduce((a, q) => a + q[1], 0);
  const S0 = d.s0, S1 = d.s0 + width;

  // Mur du rez-de-chaussée, soubassement, petite corniche sous l'étage.
  panel(mb, S0, S1, -0.3, d.h, 0.05, WALL);
  slab(S0, S1, -0.3, 0.15, 0.05, 0.09, PLINTH);
  slab(S0 - 0.03, S1 + 0.03, d.h - 0.14, d.h, 0.05, 0.2, shade(WALL, 1.12));
  for (const [t0, t1, col] of m.tint ?? []) panel(mb, t0, t1, -0.3, d.h - 0.14, 0.06, C(col));

  const lit = (s0: number, s1: number, z0: number, z1: number, off: number): void => {
    panel(mb, s0, s1, z0, z1, off, GLASS_LO, GLASS_HI);
    if (glow) panel(glow, s0, s1, z0, z1, off + 0.006, GLOW_LO, GLOW_HI);
  };
  let s = S0;
  d.bays.forEach(([kind, w], bi) => {
    const a = s, b = s + w;
    s = b;
    if (kind === "pilaster") return;
    if (kind === "door") {
      // Porte pleine grise à deux vantaux, seuil, poignées.
      panel(mb, a + 0.04, b - 0.04, 0.0, d.top - 0.1, 0.07, DOOR);
      panel(mb, (a + b) / 2 - 0.015, (a + b) / 2 + 0.015, 0.0, d.top - 0.1, 0.075, ALU_DARK);
      panel(mb, (a + b) / 2 - 0.09, (a + b) / 2 - 0.06, 0.9, 1.15, 0.08, ALU);
      panel(mb, (a + b) / 2 + 0.06, (a + b) / 2 + 0.09, 0.9, 1.15, 0.08, ALU);
      return;
    }
    if (kind === "passage") {
      // Passage couvert : ouverture sombre, encadrement de pierre, linteau.
      panel(mb, a, b, 0.0, d.top + 0.5, 0.07, C("#1b1d20"), C("#2a2d31"));
      slab(a - 0.12, a, 0.0, d.top + 0.62, 0.05, 0.12, PLINTH);
      slab(b, b + 0.12, 0.0, d.top + 0.62, 0.05, 0.12, PLINTH);
      slab(a - 0.12, b + 0.12, d.top + 0.5, d.top + 0.62, 0.05, 0.12, PLINTH);
      return;
    }
    // Baie (vitrine ou porte vitrée) : cadre d'aluminium, vitre, montants tous les mètres environ ; la porte a un montant central et des poignées.
    const door = kind === "shopdoor";
    panel(mb, a, b, door ? 0.0 : d.sill, d.top, 0.07, ALU);
    lit(a + 0.06, b - 0.06, (door ? 0.0 : d.sill) + 0.06, d.top - 0.06, 0.085);
    const n = door ? 2 : Math.max(1, Math.round(w / 0.95));
    for (let k = 1; k < n; k++) {
      const u = a + (w * k) / n;
      panel(mb, u - 0.025, u + 0.025, (door ? 0.0 : d.sill) + 0.06, d.top - 0.06, 0.09, ALU);
    }
    if (door) {
      for (const sg of [-1, 1]) panel(mb, (a + b) / 2 + sg * 0.1 - 0.015, (a + b) / 2 + sg * 0.1 + 0.015, 0.95, 1.3, 0.095, ALU_DARK);
    }
    // Bandeau clair en haut de la baie.
    const ban = m.banners?.find((q) => q[0] === bi);
    if (ban) {
      panel(mb, a + 0.06, b - 0.06, d.top - 0.33, d.top - 0.06, 0.095, C("#c6d0da"));
      words(ban[1], (a + b) / 2, d.top - 0.195, 0.2, 0.1, "#3c4852");
    }
  });

  // Pied des vitrines : bande rouge visible derrière la vitre (la moquette de la photo).
  if (m.base) panel(mb, m.base[0], m.base[1], d.sill + 0.06, d.sill + 0.06 + m.base[2], 0.1, C(m.base[3]));

  // Plaques (horaires, interphone), logos, textes posés.
  for (const [sc, z0, z1, hw, col] of m.plates ?? []) slab(sc - hw, sc + hw, z0, z1, 0.05, 0.1, C(col));
  for (const [sc, z, r, col, letter, lcol] of m.logos ?? []) {
    disc(sc, z, r, 0.105, C(col));
    words(letter, sc, z, r * 1.1, 0.11, lcol);
  }
  for (const [sc, z, h, t, col] of m.texts ?? []) words(t, sc, z, h, 0.115, col);

  // Enseigne : lettres posées sur le mur, mots de couleurs différentes côte à côte.
  const { parts, at: sc, z, h } = m.words;
  const total = parts.reduce((a, [t]) => a + t.length, 0) + (parts.length - 1);
  let cursor = sc - (total * h * ADVANCE) / 2;
  for (const [t, col] of parts) {
    const len = t.length * h * ADVANCE;
    words(t, cursor + len / 2, z, h, 0.075, col);
    cursor += len + h * ADVANCE;
  }
  if (m.sub) words(m.sub.text, m.sub.at, m.sub.z, m.sub.h, 0.075, m.sub.color);

  // Auvent d'entrée : dalle de béton clair en saillie, poteaux fins sur le parvis.
  if (m.canopy) {
    const c = m.canopy, slabCol = C("#e2dfd6"), post = C("#d4d1c8");
    slab(c.s[0], c.s[1], c.z, c.z + 0.22, 0.05, c.depth, slabCol);
    for (const ps of c.pillars) slab(ps - 0.07, ps + 0.07, 0.0, c.z, c.depth - 0.25, c.depth - 0.11, post);
  }

  // Emblème du Centre hospitalier : croissant rouge ouvert vers la droite, H bleu, sur un panneau blanc.
  if (m.emblem) {
    const e = m.emblem, red = C("#cf2e2e"), blue = C("#1d4f9c");
    slab(e.s - e.w / 2, e.s + e.w / 2, e.z - e.h / 2, e.z + e.h / 2, 0.05, 0.1, C("#f3f1ea"));
    const r = e.w * 0.36, cx = e.s - e.w * 0.08;
    disc(cx, e.z, r, 0.12, red);
    disc(cx + r * 0.32, e.z, r * 0.84, 0.125, C("#f3f1ea"));
    const hx = e.s + e.w * 0.13, hh = e.h * 0.3, hw = e.w * 0.17, tk = e.w * 0.06;
    panel(mb, hx - hw, hx - hw + tk, e.z - hh, e.z + hh, 0.13, blue);
    panel(mb, hx + hw - tk, hx + hw, e.z - hh, e.z + hh, 0.13, blue);
    panel(mb, hx - hw, hx + hw, e.z - tk / 2, e.z + tk / 2, 0.13, blue);
  }

  // Mur-rideau des étages : ossature d'aluminium, allège claire au pied de chaque niveau, bandeaux vitrés entre les montants.
  if (m.curtain) {
    const k = m.curtain, FR = C(k.frame), SP = C(k.spandrel);
    const [CG0, CG1] = k.glass ? [C(k.glass[0]), C(k.glass[1])] : [GLASS_LO, GLASS_HI];
    const [c0, c1] = k.s, [z0, z1] = k.z;
    panel(mb, c0, c1, z0, z1, 0.14, FR);
    const level = (z1 - z0) / k.rows;
    const cols = Math.max(1, Math.round((c1 - c0) / k.mullion));
    for (let r = 0; r < k.rows; r++) {
      const b0 = z0 + r * level, b1 = b0 + level;
      panel(mb, c0 + 0.04, c1 - 0.04, b0 + 0.03, b0 + level * 0.36, 0.16, SP);
      for (let q = 0; q < cols; q++) {
        const u0 = c0 + ((c1 - c0) * q) / cols + 0.045, u1 = c0 + ((c1 - c0) * (q + 1)) / cols - 0.045;
        panel(mb, u0, u1, b0 + level * 0.4, b1 - 0.06, 0.16, CG0, CG1);
        if (glow) panel(glow, u0, u1, b0 + level * 0.4, b1 - 0.06, 0.166, GLOW_LO, GLOW_HI);
      }
    }
    slab(c0 - 0.05, c1 + 0.05, z1 - 0.02, z1 + 0.14, 0.14, 0.28, shade(FR, 0.8));
  }

  // Projecteurs blancs au-dessus des lettres.
  for (const ss of m.spots?.s ?? []) slab(ss - 0.07, ss + 0.07, (m.spots?.z ?? 3.4) - 0.05, (m.spots?.z ?? 3.4) + 0.05, 0.05, 0.27, SPOT);

  // Losange en drapeau (« PRESSE », tabac) : posé par `tobaccoSign` à 0,45 m à gauche du milieu de sa devanture, d'où une devanture de largeur nulle décalée.
  if (m.lozenge) {
    const lz = m.lozenge;
    tobaccoSign(mb, { x: f.x + f.tx * (lz.s + 0.45), y: f.y + f.ty * (lz.s + 0.45), tx: f.tx, ty: f.ty, nx: f.nx, ny: f.ny, width: 0, zTop: 0, zSign: f.z + lz.z - 0.5, key: "lozenge" }, C(lz.color));
  }

  // Croix verte en drapeau, perpendiculaire au mur.
  if (m.cross) {
    crossFlag(mb, f.x + f.tx * m.cross.s, f.y + f.ty * m.cross.s, f.nx, f.ny, f.z + m.cross.z, m.cross.size, glow);
  }
}
