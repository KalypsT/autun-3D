import * as THREE from "three";
import type { Devanture } from "../data/types";
import type { DevantureFrame } from "./devanture";
import { MeshBuilder, toThree, UvMeshBuilder, type Vec3 } from "./geometry";
import { crossFlag } from "./shopfront";
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
const ALU = C("#8b9298"), ALU_DARK = C("#5d646a"), DOOR = C("#8e9296"), PLINTH = C("#7d7a73"), SPOT = C("#f3f1ea");
/** Pas d'un caractère du texte d'enseigne, en fraction de la hauteur de ligne (cases de 256 × 40 px : lettres de 0,82 de la hauteur). */
const ADVANCE = 0.51;

export function buildModernFront(mb: MeshBuilder, glow: MeshBuilder | null, text: { mb: UvMeshBuilder; atlas: SignAtlas } | null, f: DevantureFrame, d: Devanture, color: string): void {
  const m = d.modern!;
  const at = (s: number, z: number, off: number): Vec3 => toThree(f.x + f.tx * s + f.nx * off, f.y + f.ty * s + f.ny * off, f.z + z);
  const front = toThree(f.nx, f.ny, 0);
  const panel = (target: MeshBuilder, s0: number, s1: number, z0: number, z1: number, off: number, lo: THREE.Color, hi: THREE.Color = lo): void => {
    if (lo === hi) target.quad(at(s0, z0, off), at(s1, z0, off), at(s1, z1, off), at(s0, z1, off), front, lo);
    else target.quadGradient(at(s0, z0, off), at(s1, z0, off), at(s1, z1, off), at(s0, z1, off), front, lo, hi);
  };
  /** Pavé en saillie : face avant, côtés, dessus. */
  const slab = (s0: number, s1: number, z0: number, z1: number, off0: number, off1: number, col: THREE.Color): void => {
    panel(mb, s0, s1, z0, z1, off1, col);
    const side = shade(col, 0.82);
    mb.quad(at(s0, z0, off0), at(s0, z0, off1), at(s0, z1, off1), at(s0, z1, off0), toThree(-f.tx, -f.ty, 0), side);
    mb.quad(at(s1, z0, off1), at(s1, z0, off0), at(s1, z1, off0), at(s1, z1, off1), toThree(f.tx, f.ty, 0), side);
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

  // Projecteurs blancs au-dessus des lettres.
  for (const ss of m.spots?.s ?? []) slab(ss - 0.07, ss + 0.07, (m.spots?.z ?? 3.4) - 0.05, (m.spots?.z ?? 3.4) + 0.05, 0.05, 0.27, SPOT);

  // Croix verte en drapeau, perpendiculaire au mur.
  if (m.cross) {
    crossFlag(mb, f.x + f.tx * m.cross.s, f.y + f.ty * m.cross.s, f.nx, f.ny, f.z + m.cross.z, m.cross.size, glow);
  }
}
