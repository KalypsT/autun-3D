import * as THREE from "three";
import type { EduenModel, HeightField } from "../data/types";
import { at, EDUEN_CANOPY_H, eduenArc, eduenCanopy, eduenEdge, eduenFrame, eduenMasts } from "../core/landmarks";
import type { LandmarkSinks } from "./landmarks";
import { Draw, up, wallOf, type PWall, type ST } from "./playhouse";
import { T } from "./style";

/**
 * Parc des expositions l'Eduen (D231, D232), d'après les photos de l'utilisateur et le relevé LiDAR. Étape 1, les volumes : grande salle au
 * bardage rouge-orange (soubassement gris clair, couvertine blanche), toit plat gris à lanterneaux ; blocs bas en béton contre les deux
 * grands côtés, édicules techniques sur leurs toits, auvent bas de l'entrée côté parking ; hall en quart de cercle contre le petit côté
 * sud-est, sous un toit-auvent courbe qui déborde de 3 m (rive blanche, sous-face claire), mur de béton surmonté d'un bandeau vitré ;
 * annexe plus basse au nord du hall, à dalle débordante. Étape 2, les façades (D232) : logo « l'éduen » sur le grand côté de la route et
 * sur le pignon, projecteurs, portes sectionnelles grises et portes de service côté parking, entrée vitrée sous l'auvent à rive sombre
 * « ENTRÉE », panneaux d'affichage côté route ; brise-soleil à lames de l'auvent courbe, mur-rideau et portes de l'entrée du hall, grilles
 * de ventilation basses ; bardage blanc à bande violine entre la salle et l'annexe, portes et bouche ronde de l'annexe ; trois mâts à drapeaux.
 */

const C = (hex: string): THREE.Color => new THREE.Color(hex);
const shade = (c: THREE.Color, k: number): THREE.Color => c.clone().multiplyScalar(k);
const CLAD = C("#c35a33"), CLAD_LOW = C("#c9c6bf"), COPING = C("#eeede8"), MEMBRANE = C("#6d7276"), SKY = C("#dfe8ec");
const CONCRETE = C("#d5d1c8"), CONCRETE_ROOF = C("#a9a7a1"), METAL = C("#b0b4b6"), WHITE = C("#f2f1ec"), MULLION = C("#5c6266");
const GLOW_LO = C("#ffb04a"), GLOW_HI = C("#fff0b0");
const DOOR_GREY = C("#7f8489"), PANEL = C("#e6e5e1"), VIOLET = C("#6d5a78"), FASCIA = C("#3b4047"), BOARD = C("#4a4f55"), PROJ = C("#3a3e42");
/** Gris ardoise du logo. */
const INK_HEX = "#3d4553", INK = C(INK_HEX);
/** Côté du logo, pas des lames de brise-soleil, hauteur des mâts. */
const LOGO = 3.6, LOUVRE_PITCH = 0.45, MAST = 10;
/** Part de l'arc (depuis la salle) en mur-rideau toute hauteur : l'entrée du hall. */
const ENTRY = [0.5, 0.85] as const;
/**
 * Panneaux d'affichage côté route (s0, s1, fond, lettres, texte), d'après la vue Street View de juillet 2025 : deux sur le bloc du milieu,
 * un sur le bloc est ; affiches simplifiées (un titre).
 */
const BILLBOARDS: readonly [number, number, string, string, string][] = [
  [26.5, 30.5, "#f3efe4", "#2b5aa8", "SALON DE LA MAISON"],
  [31.0, 35.0, "#5fa8c8", "#ffffff", "AUTUN"],
  [44.0, 48.0, "#f4f1e8", "#c8322f", "ITINÉRANCE CULTURELLE"],
];
/** Drapeaux des trois mâts : le parc, la France, l'Europe. */
const FLAGS = ["parc", "fr", "eu"] as const;
/** Soubassement gris clair de la salle, couvertine, épaisseur de l'acrotère, retrait du toit sous l'acrotère. */
const BASE_H = 1.3, COPING_H = 0.3, PARAPET = 0.3, ROOF_DROP = 0.25;
/** Épaisseur du toit-auvent du hall (sous-face au-dessous du toit), hauteur du bandeau vitré sous l'auvent, pas des montants. */
const CANOPY_T = 0.55, HALL_GLASS = 2.7, MULLION_PITCH = 1.6;

/** Petit nombre pseudo-aléatoire stable dans [0, 1). */
function rnd(k: number): number {
  const x = Math.sin(k * 91.7 + 47.3) * 43758.5453;
  return x - Math.floor(x);
}

export function buildEduen(sinks: LandmarkSinks, m: EduenModel, terrain: HeightField): void {
  const f = eduenFrame(m);
  const ground = (s: number, t: number): number => terrain.heightAt(...at(f, s, t));
  const d = new Draw(sinks.solid, sinks.glow, f, ground);
  const { l: L, d: D } = m;

  /** Dalle horizontale de contour `pts` (s, t, quelconque), dessus à z1, dessous à z0, chants vers l'extérieur. */
  const slab = (pts: ST[], z0: number, z1: number, top: THREE.Color, edge: THREE.Color, under: THREE.Color = shade(edge, 0.8)): void => {
    const tris = THREE.ShapeUtils.triangulateShape(pts.map(([s, t]) => new THREE.Vector2(s, t)), []);
    for (const tri of tris) {
      const a = pts[tri[0]!]!, b = pts[tri[1]!]!, c = pts[tri[2]!]!;
      const A = d.P(...a, z1), B = d.P(...b, z1), Cc = d.P(...c, z1);
      d.mb.tri(A, B, Cc, up(A, B, Cc), top);
      d.mb.tri(d.P(...a, z0), d.P(...b, z0), d.P(...c, z0), [0, -1, 0], under);
    }
    const ccw = THREE.ShapeUtils.isClockWise(pts.map(([s, t]) => new THREE.Vector2(s, t))) ? -1 : 1;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i]!, b = pts[(i + 1) % pts.length]!, l = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (l < 1e-3) continue;
      const n = d.N((ccw * (b[1] - a[1])) / l, (-ccw * (b[0] - a[0])) / l);
      d.mb.quad(d.P(...a, z0), d.P(...b, z0), d.P(...b, z1), d.P(...a, z1), n, edge);
    }
  };
  /** Boîte (s0, s1, t0, t1) du sol (ou de z0) jusqu'à z1 : quatre murs et un toit. */
  const box = (s0: number, s1: number, t0: number, t1: number, z1: number, wall: THREE.Color, roof: THREE.Color, z0?: number): void => {
    const ws = [wallOf([s0, t0], [s1, t0]), wallOf([s1, t0], [s1, t1]), wallOf([s1, t1], [s0, t1]), wallOf([s0, t1], [s0, t0])];
    if (z0 === undefined) for (const w of ws) d.face(w, z1, [[Infinity, wall]]);
    else for (const w of ws) d.plate(w, 0, w.len, z0, z1, -0.001, 0, wall, true);
    slab([[s0, t0], [s1, t0], [s1, t1], [s0, t1]], z1 - 0.05, z1, roof, wall);
  };

  // --- Grande salle -------------------------------------------------------------------------------------------------------------
  const hall = [wallOf([0, 0], [L, 0]), wallOf([L, 0], [L, D]), wallOf([L, D], [0, D]), wallOf([0, D], [0, 0])];
  for (const w of hall) {
    // Bardage rouge-orange sur un soubassement gris clair (qui suit le sol), couvertine blanche saillante.
    const base = Math.max(ground(...d.on(w, 0, 0)), ground(...d.on(w, w.len, 0))) + BASE_H;
    d.face(w, m.top, [[base, CLAD_LOW], [m.top - COPING_H, CLAD], [Infinity, COPING]]);
    d.course(w, m.top - COPING_H, m.top, 0.06, COPING);
    // Joints verticaux des panneaux de bardage, tous les 3 m environ.
    const n = Math.round(w.len / 3);
    for (let i = 1; i < n; i++) d.plate(w, (w.len * i) / n - 0.02, (w.len * i) / n + 0.02, base, m.top - COPING_H, 0, 0.012, shade(CLAD, 0.82), true);
  }
  // Toit : membrane grise sous l'acrotère (faces intérieures de l'acrotère), lanterneaux en caissons clairs.
  const zr = Math.min(m.roof, m.top - ROOF_DROP);
  slab([[PARAPET, PARAPET], [L - PARAPET, PARAPET], [L - PARAPET, D - PARAPET], [PARAPET, D - PARAPET]], zr - 0.1, zr, MEMBRANE, MEMBRANE);
  const inner = [wallOf([PARAPET, D - PARAPET], [L - PARAPET, D - PARAPET]), wallOf([L - PARAPET, D - PARAPET], [L - PARAPET, PARAPET]),
    wallOf([L - PARAPET, PARAPET], [PARAPET, PARAPET]), wallOf([PARAPET, PARAPET], [PARAPET, D - PARAPET])];
  for (const w of inner) d.plate(w, 0, w.len, zr, m.top, -0.001, 0, shade(COPING, 0.9), true);
  slab([[0, 0], [L, 0], [L, PARAPET], [0, PARAPET]], m.top - 0.02, m.top, COPING, COPING);
  slab([[0, D - PARAPET], [L, D - PARAPET], [L, D], [0, D]], m.top - 0.02, m.top, COPING, COPING);
  slab([[0, PARAPET], [PARAPET, PARAPET], [PARAPET, D - PARAPET], [0, D - PARAPET]], m.top - 0.02, m.top, COPING, COPING);
  slab([[L - PARAPET, PARAPET], [L, PARAPET], [L, D - PARAPET], [L - PARAPET, D - PARAPET]], m.top - 0.02, m.top, COPING, COPING);
  const h = m.skyW / 2;
  for (const [s, t] of m.sky) {
    box(s - h, s + h, t - h, t + h, zr + 0.35, WHITE, SKY, zr);
    // Bulle bombée au milieu du caisson.
    slab([[s - h + 0.2, t - h + 0.2], [s + h - 0.2, t - h + 0.2], [s + h - 0.2, t + h - 0.2], [s - h + 0.2, t + h - 0.2]], zr + 0.35, zr + 0.5, shade(SKY, 1.04), SKY);
  }

  // --- Blocs bas, édicules, auvent de l'entrée ----------------------------------------------------------------------------------
  for (const [s0, s1, t0, t1, z] of m.blocks) {
    if (z - m.g >= EDUEN_CANOPY_H) {
      box(s0, s1, t0, t1, z, CONCRETE, CONCRETE_ROOF);
      // Acrotère : couvertine claire en bord de toit.
      const out = t0 < 0 ? [wallOf([s0, t0], [s1, t0]), wallOf([s1, t0], [s1, t1]), wallOf([s0, t1], [s0, t0])]
        : [wallOf([s1, t0], [s1, t1]), wallOf([s1, t1], [s0, t1]), wallOf([s0, t1], [s0, t0])];
      for (const w of out) d.plate(w, -0.04, w.len + 0.04, z - 0.12, z + 0.05, 0, 0.04, WHITE);
      continue;
    }
    // Auvent bas de l'entrée (côté parking) : dalle de 35 cm sur deux poteaux à ses coins extérieurs.
    const far = t0 < 0 ? t0 : t1;
    slab([[s0, t0], [s1, t0], [s1, t1], [s0, t1]], z - 0.35, z, CONCRETE_ROOF, WHITE, shade(WHITE, 0.85));
    for (const s of [s0 + 0.3, s1 - 0.3]) {
      const p = [s, far - Math.sign(far - (t0 + t1) / 2) * 0.3] as ST;
      const g0 = ground(...p) - 0.2;
      d.bar([p[0], p[1], g0], [p[0], p[1], z - 0.35], 0.09, MULLION);
    }
  }
  for (const [s0, s1, t0, t1, z] of m.units) {
    const host = m.blocks.find((b) => s0 >= b[0] - 0.01 && s1 <= b[1] + 0.01 && t0 >= Math.min(b[2], b[3]) - 0.01 && t1 <= Math.max(b[2], b[3]) + 0.01);
    box(s0, s1, t0, t1, z, METAL, shade(METAL, 0.92), host ? host[4] : z - 1);
  }

  // --- Hall courbe ---------------------------------------------------------------------------------------------------------------
  const r = m.rot, [sA, tA, zA] = r.ann, k = r.ne[0];
  const wallEdge = eduenEdge(m, r.ov);
  const arc = eduenArc(m, wallEdge);
  const zUnder = r.roof - CANOPY_T;
  const glassLo = C(T.glass[0]), glassHi = C(T.glass[1]);
  let seed = 0;
  /** Mur du hall : béton, puis bandeau vitré horizontal (photo) sur les `HALL_GLASS` mètres sous l'auvent, montants tous les 1,6 m. */
  const glazed = (w: PWall, top: number, full = false): void => {
    const lo = Math.min(ground(...d.on(w, 0, 0)), ground(...d.on(w, w.len, 0)));
    const gz = full ? lo + 0.15 : top - HALL_GLASS;
    d.face(w, top, [[gz, CONCRETE], [gz + 0.12, shade(CONCRETE, 0.9)], [Infinity, MULLION]]);
    d.shape(d.mb, w, w.len / 2, w.len / 2, gz + 0.12, top - 0.05, false, 0.025, glassLo, glassHi);
    const n = Math.max(1, Math.round(w.len / MULLION_PITCH));
    for (let i = 0; i <= n; i++) d.plate(w, (w.len * i) / n - 0.04, (w.len * i) / n + 0.04, gz + 0.12, top - 0.05, 0.02, 0.07, MULLION, true);
    // Mur-rideau de l'entrée : traverse à 2,6 m ; ailleurs, grilles de ventilation basses dans le béton (photo de l'avenue).
    if (full) d.plate(w, 0, w.len, gz + 2.6, gz + 2.7, 0.02, 0.07, MULLION, true);
    else d.plate(w, w.len * 0.15, w.len * 0.85, lo + 0.45, lo + 0.85, 0, 0.02, shade(MULLION, 0.8), true);
    if (full || rnd(++seed) < 0.5) d.shape(sinks.glow, w, w.len / 2, w.len / 2 - 0.1, gz + 0.3, top - 0.2, false, 0.03, GLOW_LO, GLOW_HI);
  };
  // Le long de l'arc : bandeau vitré au-dessus du béton côté salle, mur-rideau toute hauteur vers le bout nord-est (l'entrée, ses portes
  // au milieu), comme sur la vue de l'avenue André Frenaud et la vue de drone.
  const nA = arc.length - 1;
  const entry = (i: number): boolean => i >= Math.round(nA * ENTRY[0]) && i < Math.round(nA * ENTRY[1]);
  const doorSeg = Math.round(nA * (ENTRY[0] + ENTRY[1]) / 2);
  for (let i = 0; i < nA; i++) {
    const w = wallOf(arc[i]!, arc[i + 1]!);
    glazed(w, zUnder, entry(i));
    if (i === doorSeg) {
      // Portes vitrées à deux battants, cadre sombre, sas éclairé la nuit.
      const z0 = Math.min(ground(...d.on(w, 0, 0)), ground(...d.on(w, w.len, 0))) + 0.15;
      d.plate(w, w.len / 2 - 1.3, w.len / 2 + 1.3, z0, z0 + 2.45, 0.07, 0.13, MULLION, true);
      d.shape(d.mb, w, w.len / 2, 1.2, z0 + 0.05, z0 + 2.35, false, 0.14, glassLo, glassHi);
      d.plate(w, w.len / 2 - 0.04, w.len / 2 + 0.04, z0, z0 + 2.4, 0.14, 0.17, MULLION, true);
      d.shape(sinks.glow, w, w.len / 2, 1.15, z0 + 0.1, z0 + 2.3, false, 0.16, GLOW_LO, GLOW_HI);
    }
  }
  // Mur nord-est : vitré sous l'auvent jusqu'au bout de l'annexe, puis l'annexe en béton (sa dalle déborde de 1 m).
  const end = arc[nA]!, tw = (s: number): number => k * s + wallEdge.b;
  glazed(wallOf(end, [sA, tw(sA)]), zUnder);
  const annexNorth = wallOf([sA, tw(sA)], [L, tw(L)]), annexWest = wallOf([L, tw(L)], [L, tA]);
  for (const w of [annexNorth, annexWest]) d.face(w, zA - 0.3, [[Infinity, CONCRETE]]);
  // Annexe : porte de service et bouche ronde (vue du parking) sur le mur ouest, porte sur le mur nord.
  {
    const gw = ground(...d.on(annexWest, annexWest.len / 2, 0));
    d.plate(annexWest, annexWest.len * 0.3 - 0.5, annexWest.len * 0.3 + 0.5, gw, gw + 2.2, 0, 0.05, DOOR_GREY, true);
    d.oval(annexWest, annexWest.len * 0.62, gw + 2.6, 0.45, 0.45, 0.04, shade(CONCRETE, 0.72), 14);
    const gn = ground(...d.on(annexNorth, annexNorth.len * 0.4, 0));
    d.plate(annexNorth, annexNorth.len * 0.4 - 0.5, annexNorth.len * 0.4 + 0.5, gn, gn + 2.2, 0, 0.05, DOOR_GREY, true);
  }
  // Bout du hall entre la salle et l'annexe, vers l'auvent de l'entrée : bardage blanc à bande violine (vue du parking).
  {
    const w = wallOf([L, tA], [L, D]);
    const gb = Math.max(ground(...d.on(w, 0, 0)), ground(...d.on(w, w.len, 0)));
    d.face(w, zUnder, [[gb + 3.3, PANEL], [gb + 3.9, VIOLET], [Infinity, PANEL]]);
    for (let u = 1.2; u < w.len - 0.5; u += 1.2) d.plate(w, u - 0.015, u + 0.015, gb + 0.3, zUnder - 0.1, 0, 0.01, shade(PANEL, 0.88), true);
  }
  slab([[L - 1, tA], [sA, tA], [sA, tw(sA) + 1], [L - 1, tw(L) + 1]], zA - 0.3, zA, CONCRETE_ROOF, WHITE);
  // Ressauts entre le toit de l'annexe et celui du hall (bout est et bord sud de l'annexe).
  d.face(wallOf([sA, tw(sA)], [sA, tA]), r.roof, [[Infinity, CONCRETE]]);
  d.face(wallOf([sA, tA], [L, tA]), r.roof, [[Infinity, CONCRETE]]);
  // Toit-auvent : toit plein (membrane grise) jusqu'à 50 cm devant le mur, puis brise-soleil à lames blanches jusqu'à la rive (vue de
  // drone), poutre de rive blanche relevée jusqu'à `fascia`.
  const solid = r.ov - 0.5;
  slab(eduenCanopy(m, solid), zUnder, r.roof, shade(MEMBRANE, 1.25), WHITE, shade(WHITE, 0.9));
  const zl0 = r.roof - 0.42, zl1 = r.roof - 0.05;
  const [cs, ct] = r.c, eIn = eduenEdge(m, solid), eOut = eduenEdge(m, 0);
  const nArc = Math.floor(((eOut.a1 - eOut.a0) * r.r) / LOUVRE_PITCH);
  for (let i = 1; i < nArc; i++) {
    const a = eOut.a0 + ((eOut.a1 - eOut.a0) * i) / nArc;
    if (cs + eIn.r * Math.cos(a) < L + 0.1) continue;
    louvre([cs + eIn.r * Math.cos(a), ct + eIn.r * Math.sin(a)], [cs + (r.r - 0.1) * Math.cos(a), ct + (r.r - 0.1) * Math.sin(a)], zl0, zl1);
  }
  // Le long du bord nord-est, lames perpendiculaires au bord, de la fin de l'arc au bout de l'annexe.
  const sEnd = cs + r.r * Math.cos(eOut.a1), nx = -k / Math.hypot(1, k), ny = 1 / Math.hypot(1, k);
  const dIn = (eOut.b - eIn.b) / Math.hypot(1, k);
  for (let sv = sEnd - LOUVRE_PITCH; sv > sA + 0.2; sv -= LOUVRE_PITCH) {
    const o: ST = [sv, k * sv + eOut.b];
    louvre([o[0] - nx * dIn, o[1] - ny * dIn], [o[0] - nx * 0.1, o[1] - ny * 0.1], zl0, zl1);
  }
  const rim = eduenCanopy(m).slice(0, -2);
  for (let i = 0; i + 1 < rim.length; i++) {
    const w = wallOf(rim[i]!, rim[i + 1]!);
    d.plate(w, 0, w.len, zUnder + 0.1, Math.max(r.fascia, r.roof + 0.15), 0, 0.12, WHITE);
  }

  // --- Façades de la salle -------------------------------------------------------------------------------------------------------
  const [hSW, hSE, hNE] = hall;
  // Logo « parc des expos de l'Autunois – l'éduen » à 1,2 m du coin sud, 1 m sous la couvertine, sur le grand côté de la route de Chalon
  // (Street View 2019 et 2025). La vue de drone, plus ancienne, le montre aussi sur le pignon : il n'y est plus en juillet 2026.
  logo(hSW!, L - LOGO / 2 - 1.2, m.top - 1.0);
  // Projecteurs en haut des murs côté parking et sur le pignon (vue du parking, vue de l'avenue).
  for (const [w, n] of [[hNE!, 5], [hSE!, 2]] as const) {
    for (let i = 0; i < n; i++) {
      const u = (w.len * (i + 0.5)) / n;
      d.plate(w, u - 0.2, u + 0.2, m.top - 0.75, m.top - 0.45, 0, 0.35, PROJ);
    }
  }
  // Côté parking (vue de face) : deux portes grises sectionnelles entre les blocs, une porte près du coin nord, l'entrée vitrée sous l'auvent.
  const uNE = (sv: number): number => L - sv;
  const gAt = (w: PWall, u: number): number => ground(...d.on(w, u, 0));
  for (const [a, b] of gaps(m.blocks.filter((q) => q[2] >= D - 0.01))) {
    if (b - a < 3) continue;
    const uc = uNE((a + b) / 2), g0 = gAt(hNE!, uc), wd = Math.min(3.6, b - a - 0.8);
    d.plate(hNE!, uc - wd / 2 - 0.15, uc + wd / 2 + 0.15, g0, g0 + 4.35, 0, 0.04, shade(DOOR_GREY, 0.8), true);
    d.plate(hNE!, uc - wd / 2, uc + wd / 2, g0, g0 + 4.2, 0.04, 0.07, DOOR_GREY, true);
    for (let z = g0 + 0.5; z < g0 + 4.1; z += 0.5) d.plate(hNE!, uc - wd / 2, uc + wd / 2, z - 0.02, z + 0.02, 0.07, 0.08, shade(DOOR_GREY, 0.82), true);
  }
  {
    const uc = uNE(3.2), g0 = gAt(hNE!, uc);
    d.plate(hNE!, uc - 0.55, uc + 0.55, g0, g0 + 2.2, 0, 0.05, DOOR_GREY, true);
  }
  const ent = m.blocks.find((q) => q[4] - m.g < EDUEN_CANOPY_H && q[2] >= D - 0.01);
  if (ent) {
    const [s0, s1, , t1, z] = ent, uc = uNE((s0 + s1) / 2), g0 = gAt(hNE!, uc);
    d.plate(hNE!, uc - 1.5, uc + 1.5, g0, g0 + 2.6, 0, 0.06, MULLION, true);
    d.shape(d.mb, hNE!, uc, 1.4, g0 + 0.05, g0 + 2.5, false, 0.07, glassLo, glassHi);
    d.plate(hNE!, uc - 0.04, uc + 0.04, g0, g0 + 2.55, 0.07, 0.1, MULLION, true);
    d.shape(sinks.glow, hNE!, uc, 1.35, g0 + 0.1, g0 + 2.45, false, 0.09, GLOW_LO, GLOW_HI);
    // Rive sombre de l'auvent et son inscription « ENTRÉE ».
    const fw = wallOf([s1, t1], [s0, t1]);
    d.plate(fw, -0.02, fw.len + 0.02, z - 0.38, z + 0.02, 0, 0.04, FASCIA);
    text(fw, "ENTRÉE", fw.len / 2, z - 0.18, 0.3, "#f2f1ec", 0.06);
  }
  // Blocs côté parking : une porte de service par bloc, deux petites fenêtres hautes sur le bloc près de l'entrée.
  for (const [s0, s1, t0, t1, z] of m.blocks) {
    if (z - m.g < EDUEN_CANOPY_H || t0 < D - 0.01) continue;
    const fw = wallOf([s1, t1], [s0, t1]), g0 = gAt(fw, fw.len * 0.25);
    d.plate(fw, fw.len * 0.25 - 0.5, fw.len * 0.25 + 0.5, g0, g0 + 2.2, 0, 0.05, DOOR_GREY, true);
    if (s1 > L * 0.75) for (const u of [fw.len - 1.4, fw.len - 2.9]) d.plate(fw, u - 0.45, u + 0.45, z - 1.0, z - 0.45, 0, 0.03, MULLION, true);
  }
  // Côté route : panneaux d'affichage sur deux poteaux devant les blocs (vue Street View de la route de Chalon).
  for (const [s0, s1, bg, fg, txt] of BILLBOARDS) {
    const host = m.blocks.find((q) => q[3] <= 0.01 && (s0 + s1) / 2 > q[0] && (s0 + s1) / 2 < q[1]);
    if (!host) continue;
    const w = wallOf([0, host[2] - 0.35], [L, host[2] - 0.35]);
    const g0 = Math.max(gAt(w, s0), gAt(w, s1)), zb = g0 + 2.0, zt = g0 + 5.0;
    for (const sv of [s0 + 0.6, s1 - 0.6]) d.bar([sv, host[2] - 0.2, g0 - 0.2], [sv, host[2] - 0.2, zt - 0.2], 0.07, MULLION);
    d.plate(w, s0 - 0.1, s1 + 0.1, zb - 0.1, zt + 0.1, -0.15, 0, BOARD);
    d.plate(w, s0, s1, zb, zt, 0, 0.02, C(bg), true);
    text(w, txt, (s0 + s1) / 2, (zb + zt) / 2 + 0.55, Math.min(0.55, (s1 - s0) / 6.6), fg, 0.03);
    d.plate(w, s0 + 0.3, s1 - 0.3, zb + 0.35, zb + 1.2, 0.02, 0.03, shade(C(bg), 0.8), true);
  }

  // --- Mâts et drapeaux devant le hall --------------------------------------------------------------------------------------------
  // Trois mâts blancs sur le gazon au-delà du bout nord-est du hall (vues de drone et de l'avenue) : drapeau du parc, France, Europe.
  eduenMasts(m).forEach((p, i) => {
    const g0 = ground(...p), kind = FLAGS[i]!;
    d.bar([p[0], p[1], g0 - 0.3], [p[0], p[1], g0 + MAST], 0.06, WHITE);
    flag(p, g0 + MAST - 0.15, kind);
  });

  /** Lame de brise-soleil de a à b (s, t), de z0 à z1 : deux faces, dessous. */
  function louvre(a: ST, b: ST, z0: number, z1: number): void {
    const w = wallOf(a, b);
    d.plate(w, 0, w.len, z0, z1, -0.03, 0.03, WHITE);
    d.plate(wallOf(b, a), 0, w.len, z0, z1, 0.029, 0.03, WHITE, true);
  }

  /** Texte de l'atlas sur le mur, centré en (u, zc), de hauteur de case th, à `off` devant le mur. */
  function text(w: PWall, str: string, u: number, zc: number, th: number, color: string, off = 0.06): void {
    const label = sinks.atlas.get(str, color), tw = th * 6.4;
    const a = d.on(w, u - tw / 2, off), b = d.on(w, u + tw / 2, off);
    sinks.names.quad(d.P(...a, zc - th / 2), d.P(...b, zc - th / 2), d.P(...b, zc + th / 2), d.P(...a, zc + th / 2), d.N(...w.out),
      [label.u0, label.v0], [label.u1, label.v0], [label.u1, label.v1], [label.u0, label.v1], new THREE.Color(1, 1, 1));
  }

  /** Trait plat sur le mur, de (u0, z0) à (u1, z1), d'épaisseur th. */
  function stroke(w: PWall, u0: number, z0: number, u1: number, z1: number, th: number, col: THREE.Color, off = 0.04): void {
    const l = Math.hypot(u1 - u0, z1 - z0) || 1, pu = (-(z1 - z0) / l) * (th / 2), pz = ((u1 - u0) / l) * (th / 2);
    const Q = (u: number, z: number): ReturnType<typeof d.P> => d.P(...d.on(w, u, off), z);
    d.mb.quad(Q(u0 + pu, z0 + pz), Q(u1 + pu, z1 + pz), Q(u1 - pu, z1 - pz), Q(u0 - pu, z0 - pz), d.N(...w.out), col);
  }

  /**
   * Logo du parc (photo de septembre 2019), carré de LOGO mètres centré en u, son haut à zTop : cadre en équerre ouvert, cadre intérieur
   * décalé vers la droite, arc, crochet, quatre rayons, « parc des / expos / de l'Autunois » et « l'éduen » en lettres gris ardoise.
   */
  function logo(w: PWall, uc: number, zTop: number): void {
    const S = LOGO, th = 0.035 * S;
    const U = (x: number): number => uc + (x - 0.5) * S, V = (y: number): number => zTop - (1 - y) * S;
    const line = (x0: number, y0: number, x1: number, y1: number, k = 1): void => stroke(w, U(x0), V(y0), U(x1), V(y1), th * k, INK);
    line(0, -0.02, 0, 1.02); line(-0.02, 0, 1.02, 0); line(-0.02, 1, 0.84, 1); line(0.83, 1.02, 0.83, 0.93);
    line(0.28, 0.9, 1.02, 0.9); line(1, 0.92, 1, -0.02); line(0.3, 0.92, 0.3, 0.44);
    line(-0.02, 0.36, 0.22, 0.36); line(0.83, 0.4, 0.83, 0.56); line(0.82, 0.55, 1, 0.55); line(0.82, 0.41, 1, 0.41);
    for (let i = 0; i < 8; i++) {
      const a0 = (Math.PI / 2) * (i / 8), a1 = (Math.PI / 2) * ((i + 1) / 8);
      line(0.3 - 0.3 * Math.cos(a0), 0.36 + 0.42 * Math.sin(a0), 0.3 - 0.3 * Math.cos(a1), 0.36 + 0.42 * Math.sin(a1));
    }
    for (const [x, y, deg] of [[0.24, 0.4, 140], [0.42, 0.5, 100], [0.6, 0.5, 80], [0.77, 0.4, 40]] as const) {
      const ux = Math.cos((deg * Math.PI) / 180) * 0.05, uy = Math.sin((deg * Math.PI) / 180) * 0.05;
      line(x - ux, y - uy, x + ux, y + uy, 1.8);
    }
    text(w, "parc des", U(0.65), V(0.825), 0.12 * S, INK_HEX);
    text(w, "expos", U(0.63), V(0.735), 0.15 * S, INK_HEX);
    text(w, "de l'Autunois", U(0.65), V(0.645), 0.1 * S, INK_HEX);
    text(w, "l'éduen", U(0.5), V(0.16), 0.26 * S, INK_HEX);
  }

  /** Drapeau de 1,5 × 1 m flottant le long de s depuis le mât en p, son haut à zTop : deux faces. */
  function flag(p: ST, zTop: number, kind: string): void {
    const w = wallOf([p[0] + 0.07, p[1]], [p[0] + 1.57, p[1]]), back = wallOf([p[0] + 1.57, p[1]], [p[0] + 0.07, p[1]]);
    const z0 = zTop - 1;
    const band = (u0: number, u1: number, y0: number, y1: number, col: THREE.Color, off = 0.01): void => {
      d.plate(w, u0, u1, z0 + y0, z0 + y1, off, off, col, true);
      d.plate(back, 1.5 - u1, 1.5 - u0, z0 + y0, z0 + y1, off, off, col, true);
    };
    if (kind === "fr") {
      band(0, 0.5, 0, 1, C("#1f3f8f")); band(0.5, 1, 0, 1, C("#f4f4f2")); band(1, 1.5, 0, 1, C("#d8323a"));
    } else if (kind === "eu") {
      band(0, 1.5, 0, 1, C("#1f3f8f"));
      for (let i = 0; i < 12; i++) {
        const a = (Math.PI * 2 * i) / 12, x = 0.75 + Math.cos(a) * 0.3, y = 0.5 + Math.sin(a) * 0.3;
        band(x - 0.035, x + 0.035, y - 0.035, y + 0.035, C("#f2c230"), 0.02);
      }
    } else {
      band(0, 1.5, 0, 1, C("#f4f4f2"));
      band(0.45, 0.62, 0.35, 0.65, C("#c0306a"), 0.02); band(0.66, 0.83, 0.35, 0.65, C("#e08a2a"), 0.02); band(0.87, 1.04, 0.35, 0.65, C("#3a7fc0"), 0.02);
    }
  }
}

/** Intervalles (s) libres entre des blocs triés le long d'un même côté. */
function gaps(blocks: readonly (readonly number[])[]): [number, number][] {
  const b = [...blocks].sort((x, y) => x[0]! - y[0]!);
  const out: [number, number][] = [];
  for (let i = 0; i + 1 < b.length; i++) if (b[i + 1]![0]! - b[i]![1]! > 0.5) out.push([b[i]![1]!, b[i + 1]![0]!]);
  return out;
}
