import * as THREE from "three";
import type { HeightField, NautiqueBlock, NautiqueModel } from "../data/types";
import { at } from "../core/landmarks";
import { NAUTIQUE_BARRIER_H, NAUTIQUE_FLAG_POLE, nautiqueFrame, roofAt } from "../core/nautique";
import type { LandmarkSinks } from "./landmarks";
import { Draw, wallOf, type PWall, type ST, type STZ } from "./playhouse";
import { glassDoor, rectWalls, serviceDoor, textQuad, wallText } from "./roadside";
import { T } from "./style";

/**
 * Base nautique du plan d'eau du Vallon (D245), d'après les photos de l'utilisateur (Google Street View de juillet 2026 depuis la route de
 * Chalon et devant les toilettes) et le relevé LiDAR (tools/data/survey_nautique.py) :
 * - neuf volumes à un niveau, enduit beige sur soubassement gris, toits en bac acier gris (plats, à un pan, à deux pans, en pavillon), débords
 *   de 35 cm sur les toits en pente ; bandeaux de fenêtres hautes ;
 * - hangar du sud (pavillon) : deux portes de hangar sur le lac ; porche vitré de l'entrée ;
 * - côté nord, vers la darse : baies ouvertes sur poteaux carrés, kayaks rangés dedans ; banderole « COMMUNE SPORTIVE
 *   BOURGOGNE-FRANCHE-COMTÉ » sur le bloc nord-est ;
 * - abords : bloc de toilettes en béton gravillonné, mât au drapeau, barrière levante blanche, potelets en bois, rochers posés, panneau
 *   d'information. Positions des abords approchées (photos et orthophotographie).
 */

const C = (hex: string): THREE.Color => new THREE.Color(hex);
const shade = (c: THREE.Color, k: number): THREE.Color => c.clone().multiplyScalar(k);
const GLOW_LO = C("#ffb04a"), GLOW_HI = C("#fff0b0");
// Enduit beige, soubassement gris, bac acier gris, rive, menuiseries, portes de hangar, béton gravillonné, bois des potelets.
const RENDER = C("#e2cda4"), PLINTH = C("#948c80"), STEEL = C("#8c9295"), FASCIA = C("#6f7579"), FRAME = C("#f1f0eb");
const HANGAR = C("#9aa3a8"), GRAVEL = C("#a7a196"), WOOD = C("#8a6a48"), DARK = C("#2c2b2a"), NAVY = "#1f3a7a";
const KAYAKS = ["#e0412e", "#f2b12a", "#2f8fc4", "#4fae4a", "#e86aa0"].map(C);
const PLINTH_H = 0.4, EAVE = 0.35;

function rnd(k: number): number {
  const x = Math.sin(k * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

export function buildNautique(sinks: LandmarkSinks, m: NautiqueModel, terrain: HeightField): void {
  const f = nautiqueFrame(m);
  const ground = (s: number, t: number): number => terrain.heightAt(...at(f, s, t));
  const d = new Draw(sinks.solid, sinks.glow, f, ground);
  const glassLo = C(T.glass[0]), glassHi = C(T.glass[1]);
  let serial = 0;

  /** Un autre volume couvre-t-il le point (s, t) jusqu'à l'altitude z ? */
  const covered = (self: NautiqueBlock, p: ST, z: number): boolean =>
    m.blocks.some((o) => o !== self && p[0] > o.r[0] - 0.05 && p[0] < o.r[1] + 0.05 && p[1] > o.r[2] - 0.05 && p[1] < o.r[3] + 0.05 && roofAt(o, p[0], p[1]) > z);

  /** Mur du volume jusqu'à son toit (pignons et murs sous un pan compris), par morceaux de 1,5 m : soubassement, enduit. */
  const wall = (b: NautiqueBlock, w: PWall): void => {
    const n = d.N(...w.out), pieces = Math.max(1, Math.ceil(w.len / 1.5));
    for (let i = 0; i < pieces; i++) {
      const u0 = (w.len * i) / pieces, u1 = (w.len * (i + 1)) / pieces;
      // Pièce de pignon : on coupe au faîtage pour garder une arête nette.
      const p0 = d.on(w, u0, 0), p1 = d.on(w, u1, 0);
      const g0 = ground(...p0) - 0.4, g1 = ground(...p1) - 0.4;
      const z0 = roofAt(b, ...p0), z1 = roofAt(b, ...p1);
      const k0 = Math.min(ground(...p0) + PLINTH_H, z0), k1 = Math.min(ground(...p1) + PLINTH_H, z1);
      d.mb.quad(d.P(...p0, g0), d.P(...p1, g1), d.P(...p1, k1), d.P(...p0, k0), n, PLINTH);
      d.mb.quad(d.P(...p0, k0), d.P(...p1, k1), d.P(...p1, z1), d.P(...p0, z0), n, RENDER);
    }
  };

  /** Fenêtre haute (bandeau) : tableau blanc, vitre ; une sur trois s'allume la nuit. */
  const win = (w: PWall, u: number, wd: number, z0: number, z1: number): void => {
    const h = wd / 2;
    d.plate(w, u - h - 0.07, u + h + 0.07, z0 - 0.07, z1 + 0.07, 0, 0.04, FRAME, true);
    d.shape(d.mb, w, u, h - 0.03, z0, z1, false, 0.05, glassLo, glassHi);
    if (rnd(++serial) < 0.33) d.shape(sinks.glow, w, u, h - 0.05, z0 + 0.03, z1 - 0.03, false, 0.065, GLOW_LO, GLOW_HI);
  };

  /** Toit : pans en bac acier avec débord (toits en pente), ou dalle et rive (toit plat). */
  const roof = (b: NautiqueBlock): void => {
    const [s0, s1, t0, t1] = b.r;
    const e = b.roof === "flat" ? 0.08 : EAVE;
    const P = (s: number, t: number): STZ => [s, t, roofAt(b, Math.min(Math.max(s, s0), s1), Math.min(Math.max(t, t0), t1)) - (s < s0 || s > s1 || t < t0 || t > t1 ? 0.12 : 0) + 0.06];
    const S0 = s0 - e, S1 = s1 + e, T0 = t0 - e, T1 = t1 + e;
    const ribs = (a: STZ, bb: STZ, c: STZ, dd: STZ | null): void => d.pan(a, bb, c, dd, shade(STEEL, 0.96 + rnd(++serial) * 0.08));
    if (b.roof === "flat" || b.roof === "mono") ribs(P(S0, T0), P(S1, T0), P(S1, T1), P(S0, T1));
    else if (b.roof === "gable") {
      const c = b.at ?? ((b.axis ?? "s") === "s" ? (t0 + t1) / 2 : (s0 + s1) / 2);
      if ((b.axis ?? "s") === "s") {
        ribs(P(S0, T0), P(S1, T0), P(S1, c), P(S0, c));
        ribs(P(S0, c), P(S1, c), P(S1, T1), P(S0, T1));
      } else {
        ribs(P(S0, T0), P(c, T0), P(c, T1), P(S0, T1));
        ribs(P(c, T0), P(S1, T0), P(S1, T1), P(c, T1));
      }
    } else {
      const cs = (s0 + s1) / 2, ct = (t0 + t1) / 2, top: STZ = [cs, ct, (b.ridge ?? b.z) + 0.06];
      ribs(P(S0, T0), P(S1, T0), top, null);
      ribs(P(S1, T0), P(S1, T1), top, null);
      ribs(P(S1, T1), P(S0, T1), top, null);
      ribs(P(S0, T1), P(S0, T0), top, null);
    }
    // Rive : bande sombre sous le bord du toit, sur les quatre côtés.
    for (const w of rectWalls(S0, S1, T0, T1)) {
      const pieces = Math.max(1, Math.ceil(w.len / 3));
      for (let i = 0; i < pieces; i++) {
        const a = d.on(w, (w.len * i) / pieces, 0), c = d.on(w, (w.len * (i + 1)) / pieces, 0);
        const za = P(...a)[2], zc = P(...c)[2];
        d.mb.quad(d.P(...a, za - 0.2), d.P(...c, zc - 0.2), d.P(...c, zc), d.P(...a, za), d.N(...w.out), FASCIA);
      }
    }
  };

  for (const b of m.blocks) {
    const walls = rectWalls(...b.r);
    for (const w of walls) {
      wall(b, w);
      // Bandeau de fenêtres hautes sur les parties libres (pas contre un volume voisin), sauf le hangar et le bloc nord-est (photos).
      if (b.n === "hangar" || b.n === "nord-est" || b.n === "porche") continue;
      // Côté nord de la remise : les baies ouvertes, pas de fenêtres.
      if ((b.n === "centre-nord" || b.n === "liaison") && w.a[1] === b.r[3] && w.b[1] === b.r[3]) continue;
      const n = Math.floor((w.len - 2) / 2.4);
      for (let i = 0; i < n; i++) {
        const u = (w.len - n * 2.4) / 2 + 2.4 * (i + 0.5), p = d.on(w, u, 0.3), g0 = ground(...d.on(w, u, 0));
        const z0 = g0 + 1.4, z1 = Math.min(g0 + 2.4, roofAt(b, ...d.on(w, u, 0)) - 0.35);
        if (z1 - z0 < 0.5 || covered(b, p, z1)) continue;
        win(w, u, 1.4, z0, z1);
      }
    }
    roof(b);
  }

  const block = (n: string): NautiqueBlock | undefined => m.blocks.find((b) => b.n === n);
  // Hangar du sud : deux portes de hangar sur le lac (côté ouest), grises à lames.
  const hangar = block("hangar");
  if (hangar) {
    const [s0, , t0, t1] = hangar.r, w = wallOf([s0, t1], [s0, t0]);
    for (const u of [w.len * 0.28, w.len * 0.72]) {
      const g0 = ground(...d.on(w, u, 0)), h = Math.min(2.6, hangar.z - g0 - 0.3);
      d.plate(w, u - 1.6, u + 1.6, g0, g0 + h + 0.08, 0, 0.04, shade(HANGAR, 0.8), true);
      d.plate(w, u - 1.5, u + 1.5, g0, g0 + h, 0.04, 0.06, HANGAR, true);
      for (let k = 1; k * 0.45 < h; k++) d.plate(w, u - 1.5, u + 1.5, g0 + k * 0.45 - 0.012, g0 + k * 0.45 + 0.012, 0.06, 0.07, shade(HANGAR, 0.78), true);
    }
    // Porte de service sur le côté sud.
    const south = wallOf([hangar.r[0], t0], [hangar.r[1], t0]);
    serviceDoor(d, south, south.len * 0.7);
  }
  // Porche de l'entrée : porte vitrée à deux battants, côté ouest.
  const porche = block("porche");
  if (porche) {
    const [s0, , t0, t1] = porche.r, w = wallOf([s0, t1], [s0, t0]);
    glassDoor(sinks, d, w, w.len / 2, 1.8, 2.25, true);
  }
  // Côté nord (darse) : baies ouvertes sur poteaux carrés, kayaks rangés dedans (photo des toilettes).
  for (const b of m.blocks.filter((q) => q.n === "centre-nord" || q.n === "liaison")) {
    const w = wallOf([b.r[1], b.r[3]], [b.r[0], b.r[3]]);
    const bays = Math.max(1, Math.round(w.len / 3.2)), step = w.len / bays;
    for (let i = 0; i < bays; i++) {
      const u0 = step * i + 0.2, u1 = step * (i + 1) - 0.2, g0 = ground(...d.on(w, (u0 + u1) / 2, 0));
      const top = Math.min(g0 + 2.7, roofAt(b, ...d.on(w, (u0 + u1) / 2, 0)) - 0.3);
      d.plate(w, u0, u1, g0, top, 0.01, 0.02, DARK, true);
      // Kayaks posés sur un râtelier, de profil, l'un au-dessus de l'autre.
      for (let k = 0; k < 3; k++) {
        const c = KAYAKS[(i * 3 + k) % KAYAKS.length]!, z = g0 + 0.5 + k * 0.6;
        if (z + 0.3 > top) break;
        d.plate(w, u0 + 0.2, u1 - 0.2, z, z + 0.24, 0.03, 0.12, c);
        d.plate(w, u0 + 0.05, u0 + 0.2, z + 0.06, z + 0.18, 0.05, 0.1, c);
        d.plate(w, u1 - 0.2, u1 - 0.05, z + 0.06, z + 0.18, 0.05, 0.1, c);
      }
    }
    for (let i = 0; i <= bays; i++) {
      const u = Math.min(Math.max(step * i, 0.12), w.len - 0.12), g0 = ground(...d.on(w, u, 0));
      d.plate(w, u - 0.12, u + 0.12, g0 - 0.2, roofAt(b, ...d.on(w, u, 0)), 0, 0.24, shade(RENDER, 0.95));
    }
  }
  // Banderole du bloc nord-est (photo des toilettes), sur sa face nord.
  const ne = block("nord-est");
  if (ne) {
    const w = wallOf([ne.r[1], ne.r[3]], [ne.r[0], ne.r[3]]), u = w.len / 2, g0 = ground(...d.on(w, u, 0));
    d.plate(w, u - 2.6, u + 2.6, g0 + 1.55, g0 + 2.75, 0.02, 0.04, C("#f7f6f2"), true);
    d.plate(w, u - 2.6, u + 2.6, g0 + 1.55, g0 + 1.62, 0.04, 0.045, C("#d8323a"), true);
    const line = (str: string, half: number, z0: number, z1: number): void => {
      const a = d.on(w, u - half, 0.05), c = d.on(w, u + half, 0.05);
      textQuad(sinks, str, NAVY, d.P(...a, z0), d.P(...c, z0), d.P(...c, z1), d.P(...a, z1), d.N(...w.out));
    };
    line("COMMUNE SPORTIVE", 2.2, g0 + 2.12, g0 + 2.68);
    line("BOURGOGNE-FRANCHE-COMTÉ", 2.45, g0 + 1.7, g0 + 2.08);
    serviceDoor(d, w, w.len * 0.2, 1.0, 2.15);
    const east = wallOf([ne.r[1], ne.r[2]], [ne.r[1], ne.r[3]]);
    serviceDoor(d, east, east.len * 0.5, 2.6, 2.5);
  }

  // --- Abords ---------------------------------------------------------------------------------------------------------------------
  const site = m.site;
  if (!site) return;
  // Bloc de toilettes en béton gravillonné (photo) : caisson gris, toit plat débordant, deux portes, plaque « Toilettes ».
  {
    const [s, t, ls, lt, h] = site.wc, g0 = ground(s, t);
    const r: [number, number, number, number] = [s - ls / 2, s + ls / 2, t - lt / 2, t + lt / 2];
    for (const w of rectWalls(...r)) d.plate(w, 0, w.len, g0 - 0.3, g0 + h, -0.02, 0, shade(GRAVEL, 0.95 + rnd(++serial) * 0.08), true);
    d.slab([[r[0] - 0.15, r[2] - 0.15], [r[1] + 0.15, r[2] - 0.15], [r[1] + 0.15, r[3] + 0.15], [r[0] - 0.15, r[3] + 0.15]], g0 + h, g0 + h + 0.15);
    const front = wallOf([r[1], r[3]], [r[0], r[3]]);
    for (const u of [front.len * 0.3, front.len * 0.72]) {
      d.plate(front, u - 0.45, u + 0.45, g0, g0 + 2.05, 0, 0.03, C("#b9bcbc"), true);
      d.plate(front, u + 0.25, u + 0.35, g0 + 0.95, g0 + 1.05, 0.03, 0.05, C("#6b6f71"), true);
    }
    d.plate(front, front.len * 0.5 - 0.5, front.len * 0.5 + 0.5, g0 + 2.15, g0 + 2.4, 0.01, 0.03, C("#f4f4f2"), true);
    wallText(sinks, d, front, "Toilettes", front.len * 0.5, g0 + 2.275, 0.15, "#333333", 0.04);
  }
  // Mât au drapeau tricolore (photo de la route de Chalon) : fût blanc de 8 m.
  {
    const [s, t] = site.mast, g0 = ground(s, t), top = g0 + 8;
    d.bar([s, t, g0 - 0.3], [s, t, top], NAUTIQUE_FLAG_POLE, C("#efefea"));
    const w = wallOf([s + 0.07, t], [s + 1.57, t]), back = wallOf([s + 1.57, t], [s + 0.07, t]);
    [C("#1f3f8f"), C("#f4f4f2"), C("#d8323a")].forEach((c, i) => {
      d.plate(w, i * 0.5, (i + 1) * 0.5, top - 1.15, top - 0.15, 0.01, 0.01, c, true);
      d.plate(back, 1.5 - (i + 1) * 0.5, 1.5 - i * 0.5, top - 1.15, top - 0.15, 0.01, 0.01, c, true);
    });
  }
  // Barrière levante baissée (photo des toilettes) : poteau, lisse blanche à bandes rouges.
  {
    const { a, b } = site.barrier, ga = ground(...a), z = ga + NAUTIQUE_BARRIER_H;
    d.bar([a[0], a[1], ga - 0.2], [a[0], a[1], z + 0.15], 0.12, C("#e9e9e4"));
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.max(2, Math.round(len / 0.5));
    for (let i = 0; i < n; i++) {
      const p = (k: number): STZ => [a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n, z];
      d.bar(p(i), p(i + 1), 0.04, i % 2 === 0 ? C("#f4f4f2") : C("#d8323a"));
    }
    d.bar([b[0], b[1], ground(...b) - 0.1], [b[0], b[1], z], 0.04, C("#e9e9e4"));
  }
  // Potelets en bois.
  for (const [s, t] of site.bollards) {
    const g0 = ground(s, t);
    d.bar([s, t, g0 - 0.2], [s, t, g0 + 0.8], 0.07, shade(WOOD, 0.9 + rnd(++serial) * 0.2));
  }
  // Rochers posés en bordure de pelouse : blocs polyédriques irréguliers.
  for (const [s, t, r] of site.rocks) {
    const g0 = ground(s, t);
    const ring: STZ[] = [];
    for (let k = 0; k < 7; k++) {
      const ang = (k / 7) * Math.PI * 2 + rnd(++serial), rr = r * (0.75 + rnd(++serial) * 0.4);
      ring.push([s + Math.cos(ang) * rr, t + Math.sin(ang) * rr * 0.8, g0 + r * (0.15 + rnd(++serial) * 0.35)]);
    }
    const top: STZ = [s + (rnd(++serial) - 0.5) * r * 0.3, t, g0 + r * 1.1];
    const col = shade(C("#8f8a7c"), 0.85 + rnd(++serial) * 0.3);
    for (let k = 0; k < ring.length; k++) {
      const p = ring[k]!, q = ring[(k + 1) % ring.length]!;
      d.pan(p, q, top, null, col);
      d.pan([p[0], p[1], g0 - 0.1], [q[0], q[1], g0 - 0.1], q, p, shade(col, 0.85));
    }
  }
  // Panneau d'information sur deux pieds (photo de la route de Chalon).
  {
    const [s, t] = site.board, g0 = ground(s, t);
    const w = wallOf([s - 0.6, t], [s + 0.6, t]), back = wallOf([s + 0.6, t], [s - 0.6, t]);
    for (const ds of [-0.55, 0.55]) d.bar([s + ds, t, g0 - 0.2], [s + ds, t, g0 + 2.1], 0.05, C("#4b3a2c"));
    d.plate(w, 0, 1.2, g0 + 0.9, g0 + 2.0, -0.04, 0.04, C("#4b3a2c"));
    d.plate(w, 0.06, 1.14, g0 + 0.96, g0 + 1.94, 0.04, 0.05, C("#e8e2cf"), true);
    d.plate(back, 0.06, 1.14, g0 + 0.96, g0 + 1.94, 0.04, 0.05, C("#3d6f9c"), true);
  }
}
