import * as THREE from "three";
import type { GendarmerieBlock, GendarmerieModel, HeightField } from "../data/types";
import { at } from "../core/landmarks";
import { GENDARMERIE_FENCE_H, GENDARMERIE_FLAG_POLE, gendarmerieFrame } from "../core/gendarmerie";
import type { LandmarkSinks } from "./landmarks";
import { Draw, wallOf, type PWall, type ST } from "./playhouse";
import { glassDoor, rectWalls, serviceDoor, textQuad, wallText } from "./roadside";
import { T } from "./style";

/**
 * Gendarmerie de l'avenue André Frenaud (D238), d'après les photos de l'utilisateur (Google Street View de juillet 2026 : le portail sur
 * l'avenue, le long côté sud depuis la rue Lazare Carnot, le collectif de logements ; vue du sud-ouest) et le relevé LiDAR
 * (tools/data/survey_gendarmerie.py). Tous les volumes ont un toit plat derrière un acrotère.
 * - Bâtiment principal : accueil à un niveau à l'ouest (côté avenue), corps à deux niveaux, aile est à un niveau ; enduit beige,
 *   soubassement gris, bandeau d'étage et acrotère en enduit brique, fenêtres à menuiseries blanches, hublot au bout ouest de l'étage ;
 *   « GENDARMERIE NATIONALE » en lettres bleu marine sur l'acrotère du long côté sud ; porte vitrée de l'accueil sur la cour ;
 *   garde-corps métalliques sur les toits de l'accueil et de l'aile est (photo du portail).
 * - Annexe au nord de la cour (trois toits de 3,2 à 3,7 m) : mêmes enduits, portes sectionnelles grises sur la cour.
 * - Collectif de logements au sud : deux niveaux, hublots entre les fenêtres, garde-corps sur le toit-terrasse (photo de la rue Lazare Carnot).
 * - Abords : clôture de panneaux soudés verts, portail coulissant fermé et borne d'appel sur l'avenue, mât au drapeau, pylône d'antennes.
 */

const C = (hex: string): THREE.Color => new THREE.Color(hex);
const shade = (c: THREE.Color, k: number): THREE.Color => c.clone().multiplyScalar(k);
const GLOW_LO = C("#ffb04a"), GLOW_HI = C("#fff0b0");
// Enduit beige, enduit brique des bandeaux, soubassement gris, toit en membrane, couvertine claire, menuiseries blanches, métal gris.
const RENDER = C("#e3cfad"), BRICK = C("#b9623f"), PLINTH = C("#8f877c"), MEMBRANE = C("#7f7c77"), COPING = C("#e9e3d6");
const FRAME = C("#f1f0eb"), METAL = C("#5a5f63"), DOOR = C("#8b9096"), FENCE_GREEN = C("#2f5e41"), NAVY = "#1d2b5a";
/** Soubassement, hauteur de l'acrotère en brique, épaisseur de l'acrotère, hauteur d'un niveau (photos). */
const PLINTH_H = 0.45, PARAPET_BAND = 0.75, PARAPET_T = 0.25, STOREY = 3.0;
/** Pas, largeur et hauteur des fenêtres ; marge aux coins. */
const PITCH = 2.7, WIN_W = 1.15, WIN_H = 1.3, MARGIN = 1.3;

/** Petit nombre pseudo-aléatoire stable dans [0, 1). */
function rnd(k: number): number {
  const x = Math.sin(k * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

export function buildGendarmerie(sinks: LandmarkSinks, m: GendarmerieModel, terrain: HeightField): void {
  const f = gendarmerieFrame(m);
  const ground = (s: number, t: number): number => terrain.heightAt(...at(f, s, t));
  const d = new Draw(sinks.solid, sinks.glow, f, ground);
  const glassLo = C(T.glass[0]), glassHi = C(T.glass[1]);
  let serial = 0;

  /** Un autre volume couvre-t-il le point (s, t) jusqu'à l'altitude z ? (murs mitoyens : ni fenêtre ni porte). */
  const covered = (self: GendarmerieBlock, p: ST, z: number): boolean =>
    m.blocks.some((o) => o !== self && p[0] > o.r[0] - 0.05 && p[0] < o.r[1] + 0.05 && p[1] > o.r[2] - 0.05 && p[1] < o.r[3] + 0.05 && o.z > z);

  /** Fenêtre de largeur wd centrée en u, de z0 à z1 : tableau blanc, vitre, meneau ; une sur trois environ s'allume la nuit. */
  const win = (w: PWall, u: number, wd: number, z0: number, z1: number): void => {
    const h = wd / 2;
    d.plate(w, u - h - 0.08, u + h + 0.08, z0 - 0.08, z1 + 0.08, 0, 0.04, FRAME, true);
    d.plate(w, u - h - 0.12, u + h + 0.12, z0 - 0.14, z0 - 0.06, 0, 0.09, shade(COPING, 0.95));
    d.shape(d.mb, w, u, h - 0.04, z0, z1, false, 0.05, glassLo, glassHi);
    d.plate(w, u - 0.03, u + 0.03, z0, z1, 0.05, 0.06, FRAME, true);
    if (rnd(++serial) < 0.33) d.shape(sinks.glow, w, u, h - 0.06, z0 + 0.03, z1 - 0.03, false, 0.065, GLOW_LO, GLOW_HI);
  };

  /** Hublot (photos du portail et des logements) : cercle de rayon r, bague blanche, vitre. */
  const porthole = (w: PWall, u: number, zc: number, r: number): void => {
    d.oval(w, u, zc, r + 0.09, r + 0.09, 0.04, FRAME, 16);
    d.oval(w, u, zc, r, r, 0.05, glassLo, 16);
    if (rnd(++serial) < 0.4) d.shape(sinks.glow, w, u, r * 0.68, zc - r * 0.68, zc + r * 0.68, false, 0.06, GLOW_LO, GLOW_HI);
  };

  /** Garde-corps métallique en retrait de 0,4 m du bord du toit (poteaux tous les 1,5 m, lisse haute et basse). */
  const roofRail = (b: GendarmerieBlock, z: number): void => {
    const [s0, s1, t0, t1] = b.r, k = 0.4;
    const pts: ST[] = [[s0 + k, t0 + k], [s1 - k, t0 + k], [s1 - k, t1 - k], [s0 + k, t1 - k], [s0 + k, t0 + k]];
    for (let i = 0; i + 1 < pts.length; i++) {
      const a = pts[i]!, c = pts[i + 1]!, len = Math.hypot(c[0] - a[0], c[1] - a[1]), n = Math.max(1, Math.round(len / 1.5));
      for (let j = 0; j < n; j++) {
        const p: ST = [a[0] + ((c[0] - a[0]) * j) / n, a[1] + ((c[1] - a[1]) * j) / n];
        if (!covered(b, p, z + 1)) d.bar([p[0], p[1], z], [p[0], p[1], z + 1.0], 0.025, METAL);
      }
      d.bar([a[0], a[1], z + 1.0], [c[0], c[1], z + 1.0], 0.03, METAL);
      d.bar([a[0], a[1], z + 0.5], [c[0], c[1], z + 0.5], 0.015, METAL);
    }
  };

  for (const b of m.blocks) {
    const [s0, s1, t0, t1] = b.r, top = b.z;
    const walls = rectWalls(s0, s1, t0, t1);
    for (const w of walls) {
      const gw = Math.max(ground(...w.a), ground(...w.b));
      const floor = Math.min(ground(...w.a), ground(...w.b));
      // Bandes d'enduit : soubassement gris, enduit beige, bandeau d'étage en brique (bâtiments à deux niveaux), acrotère en brique.
      const bands: [number, THREE.Color][] = [[floor + PLINTH_H, PLINTH]];
      if (b.levels > 1) bands.push([gw + STOREY - 0.15, RENDER], [gw + STOREY + 0.3, BRICK]);
      bands.push([top - PARAPET_BAND, RENDER], [Infinity, BRICK]);
      d.face(w, top, bands);
      // Couvertine de l'acrotère, en saillie.
      d.plate(w, -0.04, w.len + 0.04, top - 0.06, top + 0.04, -PARAPET_T, 0.05, COPING);
      // Fenêtres par niveau, sur les parties de mur libres (pas contre un volume voisin).
      const n = Math.floor((w.len - 2 * MARGIN) / PITCH);
      if (n < 1) continue;
      const pad = (w.len - n * PITCH) / 2;
      for (let lv = 0; lv < b.levels; lv++) {
        const z0 = gw + 0.95 + lv * STOREY, z1 = z0 + WIN_H;
        if (z1 > top - PARAPET_BAND - 0.1) break;
        for (let i = 0; i < n; i++) {
          const u = pad + PITCH * (i + 0.5), p = d.on(w, u, 0.3);
          if (covered(b, p, z1)) continue;
          // Logements : un hublot entre deux fenêtres sur trois (photo de la rue Lazare Carnot) ; annexe : peu de fenêtres, hautes.
          if (b.role === "flats" && i % 3 === 1) porthole(w, u, (z0 + z1) / 2 + 0.1, 0.42);
          else if (b.role === "annex") {
            if (i % 2 === 0) win(w, u, 1.0, z0 + 0.6, z1);
          } else win(w, u, WIN_W, z0, z1);
        }
      }
    }
    // Toit en membrane sous l'acrotère, épaisseur intérieure de l'acrotère.
    d.pan([s0 + PARAPET_T, t0 + PARAPET_T, top - 0.45], [s1 - PARAPET_T, t0 + PARAPET_T, top - 0.45], [s1 - PARAPET_T, t1 - PARAPET_T, top - 0.45], [s0 + PARAPET_T, t1 - PARAPET_T, top - 0.45], MEMBRANE);
    for (const w of walls) d.plate(w, PARAPET_T, w.len - PARAPET_T, top - 0.46, top - 0.06, -PARAPET_T - 0.01, -PARAPET_T, shade(BRICK, 0.85), true);
  }

  const block = (n: string): GendarmerieBlock | undefined => m.blocks.find((b) => b.n === n);
  const accueil = block("accueil"), corps = block("corps"), est = block("aile-est"), garages = block("garages");

  // --- Bâtiment principal : hublot, inscription, entrée de l'accueil, garde-corps des toits bas ------------------------------------
  if (corps) {
    const [s0, s1, t0] = corps.r, gw = ground(s0, t0);
    // Hublot au bout ouest de l'étage, au-dessus du toit de l'accueil (photo du portail).
    const west = wallOf([s0, corps.r[3]], [s0, t0]);
    porthole(west, west.len * 0.35, gw + STOREY + 1.45, 0.45);
    // « GENDARMERIE NATIONALE » sur l'acrotère du long côté sud (photos du sud-ouest et de la rue Lazare Carnot).
    const south = wallOf([s0, t0], [s1, t0]);
    // Case de 9 × 0,55 m (lettres à peu près au tiers de la longueur du mur, comme sur la photo du sud-ouest).
    const zc = corps.z - PARAPET_BAND / 2, a = d.on(south, south.len / 2 - 4.5, 0.07), c = d.on(south, south.len / 2 + 4.5, 0.07);
    textQuad(sinks, "GENDARMERIE NATIONALE", NAVY, d.P(...a, zc - 0.28), d.P(...c, zc - 0.28), d.P(...c, zc + 0.28), d.P(...a, zc + 0.28), d.N(...south.out));
  }
  if (accueil) {
    // Entrée de l'accueil sur la cour (côté nord, près du portail) : porte vitrée à deux battants, plaque bleue au-dessus.
    const [s0, s1, , t1] = accueil.r, w = wallOf([s1, t1], [s0, t1]);
    glassDoor(sinks, d, w, w.len / 2, 1.8, 2.3, true);
    const g0 = ground(...d.on(w, w.len / 2, 0));
    d.plate(w, w.len / 2 - 1.3, w.len / 2 + 1.3, g0 + 2.5, g0 + 2.85, 0.04, 0.08, C("#24407a"));
    wallText(sinks, d, w, "ACCUEIL", w.len / 2, g0 + 2.675, 0.3, "#f4f4f2", 0.09);
    roofRail(accueil, accueil.z);
  }
  if (est) {
    roofRail(est, est.z);
    // Porte de service au bout est.
    const w = wallOf([est.r[1], est.r[2]], [est.r[1], est.r[3]]);
    serviceDoor(d, w, w.len * 0.7);
  }
  // --- Annexe : portes sectionnelles grises sur la cour ---------------------------------------------------------------------------
  if (garages) {
    const [s0, s1, t0] = garages.r, w = wallOf([s0, t0], [s1, t0]);
    const n = Math.max(1, Math.floor((w.len - 2) / 4.2));
    for (let i = 0; i < n; i++) {
      const u = 1 + 4.2 * (i + 0.5) + (w.len - 2 - n * 4.2) / 2, g0 = ground(...d.on(w, u, 0));
      d.plate(w, u - 1.6, u + 1.6, g0, g0 + 2.6, 0, 0.04, shade(DOOR, 0.85), true);
      d.plate(w, u - 1.5, u + 1.5, g0, g0 + 2.5, 0.04, 0.06, DOOR, true);
      for (let k = 1; k < 5; k++) d.plate(w, u - 1.5, u + 1.5, g0 + k * 0.5 - 0.015, g0 + k * 0.5 + 0.015, 0.06, 0.07, shade(DOOR, 0.8), true);
    }
  }
  // --- Logements : porte d'entrée de chaque cage côté nord, garde-corps du toit-terrasse ----------------------------------------------
  for (const b of m.blocks.filter((q) => q.role === "flats")) {
    const w = wallOf([b.r[1], b.r[3]], [b.r[0], b.r[3]]);
    glassDoor(sinks, d, w, w.len * 0.5, 1.2, 2.2, false);
    roofRail(b, b.z);
  }

  // --- Abords ------------------------------------------------------------------------------------------------------------------
  const site = m.site;
  if (!site) return;
  /** Panneaux soudés vert sombre (deux faces) : poteaux tous les 2,5 m, lisses, fils verticaux tous les 0,5 m. */
  const fence = (pts: readonly ST[], h: number): void => {
    for (let i = 0; i + 1 < pts.length; i++) {
      const w = wallOf(pts[i]!, pts[i + 1]!), back = wallOf(pts[i + 1]!, pts[i]!);
      const zAt = (u: number): number => ground(...d.on(w, u, 0));
      const n = Math.max(1, Math.round(w.len / 2.5));
      for (let k = 0; k <= n; k++) {
        const u = (w.len * k) / n, q = d.on(w, u, 0), z = zAt(u);
        if (k > 0 || i === 0) d.bar([q[0], q[1], z - 0.2], [q[0], q[1], z + h + 0.05], 0.035, FENCE_GREEN);
      }
      for (let k = 0; k < n; k++) {
        const u0 = (w.len * k) / n, u1 = (w.len * (k + 1)) / n, z0 = zAt(u0), z1 = zAt(u1);
        for (const hh of [0.05, 0.65, 1.3, h - 0.03]) {
          d.plate(w, u0, u1, z0 + hh - 0.025, z0 + hh + 0.025, -0.015, 0.015, FENCE_GREEN);
        }
        for (let u = u0 + 0.25; u < u1 - 0.1; u += 0.5) {
          const z = z0 + ((z1 - z0) * (u - u0)) / (u1 - u0);
          d.plate(w, u - 0.012, u + 0.012, z, z + h, 0, 0.005, FENCE_GREEN, true);
          d.plate(back, w.len - u - 0.012, w.len - u + 0.012, z, z + h, 0, 0.005, FENCE_GREEN, true);
        }
      }
    }
  };
  for (const pl of site.fences) fence(pl, GENDARMERIE_FENCE_H);
  // Portail coulissant fermé (photo du portail) : cadre vert, barreaux verticaux tous les 12 cm, écharpe en diagonale ; piliers.
  for (const g of site.gates) {
    const w = wallOf(g.a, g.b), back = wallOf(g.b, g.a), z0 = Math.min(ground(...g.a), ground(...g.b)) + 0.08, h = GENDARMERIE_FENCE_H;
    for (const p of [g.a, g.b]) d.bar([p[0], p[1], ground(...p) - 0.2], [p[0], p[1], ground(...p) + h + 0.15], 0.1, FENCE_GREEN);
    for (const zz of [z0, z0 + h / 2, z0 + h]) d.plate(w, 0.1, w.len - 0.1, zz - 0.04, zz + 0.04, -0.03, 0.03, FENCE_GREEN);
    for (let u = 0.22; u < w.len - 0.15; u += 0.12) {
      d.plate(w, u - 0.015, u + 0.015, z0, z0 + h, 0, 0.012, FENCE_GREEN, true);
      d.plate(back, w.len - u - 0.015, w.len - u + 0.015, z0, z0 + h, 0, 0.012, FENCE_GREEN, true);
    }
    // Panneau rond « stationnement interdit » sur le portail (photo).
    d.oval(w, w.len * 0.55, z0 + h * 0.62, 0.32, 0.32, 0.04, C("#c8302c"), 16);
    d.oval(w, w.len * 0.55, z0 + h * 0.62, 0.25, 0.25, 0.05, C("#2a56a8"), 16);
  }
  // Borne d'appel (photo du portail) : guérite grise à hublot bleu, le « G » de la gendarmerie.
  {
    const [s, t] = site.borne, g0 = ground(s, t);
    const w = wallOf([s - 0.35, t - 0.35], [s - 0.35, t + 0.35]);
    for (const ww of rectWalls(s - 0.35, s + 0.35, t - 0.35, t + 0.35)) d.plate(ww, 0, ww.len, g0 - 0.1, g0 + 2.1, -0.02, 0, C("#c9ccce"), true);
    d.pan([s - 0.4, t - 0.4, g0 + 2.15], [s + 0.4, t - 0.4, g0 + 2.15], [s + 0.4, t + 0.4, g0 + 2.15], [s - 0.4, t + 0.4, g0 + 2.15], C("#9fa4a8"));
    d.plate(w, 0.1, w.len - 0.1, g0 + 0.9, g0 + 1.9, 0.0, 0.03, C(T.glass[0]), true);
    d.oval(w, w.len / 2, g0 + 1.6, 0.18, 0.18, 0.04, C("#24407a"), 12);
    wallText(sinks, d, w, "G", w.len / 2, g0 + 1.6, 0.25, "#f4f4f2", 0.05);
  }
  // Mât au drapeau tricolore (photo du portail) : fût blanc de 8 m.
  {
    const [s, t] = site.flag, g0 = ground(s, t), top = g0 + 8;
    d.bar([s, t, g0 - 0.3], [s, t, top], GENDARMERIE_FLAG_POLE, C("#efefea"));
    const w = wallOf([s + 0.07, t], [s + 1.57, t]), back = wallOf([s + 1.57, t], [s + 0.07, t]);
    const cols = [C("#1f3f8f"), C("#f4f4f2"), C("#d8323a")];
    cols.forEach((c, i) => {
      d.plate(w, i * 0.5, (i + 1) * 0.5, top - 1.15, top - 0.15, 0.01, 0.01, c, true);
      d.plate(back, 1.5 - (i + 1) * 0.5, 1.5 - i * 0.5, top - 1.15, top - 0.15, 0.01, 0.01, c, true);
    });
  }
  // Pylône d'antennes en treillis (photos : derrière l'aile est) : trois montants, entretoises, antennes au sommet. Position approchée.
  {
    const [s, t, h] = site.mast, g0 = ground(s, t), r = 0.55;
    const feet: ST[] = [0, 1, 2].map((k) => [s + Math.cos((k * 2 * Math.PI) / 3) * r, t + Math.sin((k * 2 * Math.PI) / 3) * r]);
    const top = (p: ST): ST => [s + (p[0] - s) * 0.4, t + (p[1] - t) * 0.4];
    for (const p of feet) d.bar([p[0], p[1], g0 - 0.2], [top(p)[0], top(p)[1], g0 + h], 0.04, C("#b8bcbe"));
    for (let z = 1.5; z < h; z += 2.5) {
      const k = 1 - (0.6 * z) / h;
      for (let i = 0; i < 3; i++) {
        const a = feet[i]!, b = feet[(i + 1) % 3]!;
        d.bar([s + (a[0] - s) * k, t + (a[1] - t) * k, g0 + z], [s + (b[0] - s) * k, t + (b[1] - t) * k, g0 + z], 0.015, C("#b8bcbe"));
      }
    }
    for (let i = 0; i < 3; i++) {
      const p = top(feet[i]!), dir: ST = [(p[0] - s) * 3, (p[1] - t) * 3];
      d.bar([p[0] + dir[0] * 0.1, p[1] + dir[1] * 0.1, g0 + h - 2.2], [p[0] + dir[0] * 0.1, p[1] + dir[1] * 0.1, g0 + h - 0.2], 0.09, C("#e4e6e6"));
    }
    d.bar([s, t, g0 + h], [s, t, g0 + h + 2.5], 0.03, C("#b8bcbe"));
  }
}
