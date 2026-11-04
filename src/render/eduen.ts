import * as THREE from "three";
import type { EduenModel, HeightField } from "../data/types";
import { at, EDUEN_CANOPY_H, eduenArc, eduenCanopy, eduenEdge, eduenFrame } from "../core/landmarks";
import type { LandmarkSinks } from "./landmarks";
import { Draw, up, wallOf, type PWall, type ST } from "./playhouse";
import { T } from "./style";

/**
 * Parc des expositions l'Eduen (D231), d'après les photos de l'utilisateur et le relevé LiDAR. Étape 1, les volumes : grande salle au
 * bardage rouge-orange (soubassement gris clair, couvertine blanche), toit plat gris à lanterneaux ; blocs bas en béton contre les deux
 * grands côtés, édicules techniques sur leurs toits, auvent bas de l'entrée côté parking ; hall en quart de cercle contre le petit côté
 * sud-est, sous un toit-auvent courbe qui déborde de 3 m (rive blanche, sous-face claire), mur de béton surmonté d'un bandeau vitré ;
 * annexe plus basse au nord du hall, à dalle débordante.
 */

const C = (hex: string): THREE.Color => new THREE.Color(hex);
const shade = (c: THREE.Color, k: number): THREE.Color => c.clone().multiplyScalar(k);
const CLAD = C("#c35a33"), CLAD_LOW = C("#c9c6bf"), COPING = C("#eeede8"), MEMBRANE = C("#6d7276"), SKY = C("#dfe8ec");
const CONCRETE = C("#d5d1c8"), CONCRETE_ROOF = C("#a9a7a1"), METAL = C("#b0b4b6"), WHITE = C("#f2f1ec"), MULLION = C("#5c6266");
const GLOW_LO = C("#ffb04a"), GLOW_HI = C("#fff0b0");
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
  const glazed = (w: PWall, top: number): void => {
    const gz = top - HALL_GLASS;
    d.face(w, top, [[gz, CONCRETE], [gz + 0.12, shade(CONCRETE, 0.9)], [Infinity, MULLION]]);
    d.plate(w, 0, w.len, gz + 0.12, top - 0.05, 0.01, 0.02, glassLo, true);
    d.shape(d.mb, w, w.len / 2, w.len / 2, gz + 0.12, top - 0.05, false, 0.025, glassLo, glassHi);
    const n = Math.max(1, Math.round(w.len / MULLION_PITCH));
    for (let i = 0; i <= n; i++) d.plate(w, (w.len * i) / n - 0.04, (w.len * i) / n + 0.04, gz + 0.12, top - 0.05, 0.02, 0.07, MULLION, true);
    if (rnd(++seed) < 0.5) d.shape(sinks.glow, w, w.len / 2, w.len / 2 - 0.1, gz + 0.3, top - 0.2, false, 0.03, GLOW_LO, GLOW_HI);
  };
  for (let i = 0; i + 1 < arc.length; i++) glazed(wallOf(arc[i]!, arc[i + 1]!), zUnder);
  // Mur nord-est : vitré sous l'auvent jusqu'au bout de l'annexe, puis l'annexe en béton (sa dalle déborde de 1 m).
  const end = arc[arc.length - 1]!, tw = (s: number): number => k * s + wallEdge.b;
  glazed(wallOf(end, [sA, tw(sA)]), zUnder);
  const annexNorth = wallOf([sA, tw(sA)], [L, tw(L)]), annexWest = wallOf([L, tw(L)], [L, tA]);
  for (const w of [annexNorth, annexWest]) d.face(w, zA - 0.3, [[Infinity, CONCRETE]]);
  // Bout du hall entre la salle et l'annexe, vers l'auvent de l'entrée.
  d.face(wallOf([L, tA], [L, D]), zUnder, [[Infinity, CONCRETE]]);
  slab([[L - 1, tA], [sA, tA], [sA, tw(sA) + 1], [L - 1, tw(L) + 1]], zA - 0.3, zA, CONCRETE_ROOF, WHITE);
  // Ressauts entre le toit de l'annexe et celui du hall (bout est et bord sud de l'annexe).
  d.face(wallOf([sA, tw(sA)], [sA, tA]), r.roof, [[Infinity, CONCRETE]]);
  d.face(wallOf([sA, tA], [L, tA]), r.roof, [[Infinity, CONCRETE]]);
  // Toit-auvent : membrane grise, rive blanche relevée jusqu'à `fascia`, sous-face claire.
  const canopy = eduenCanopy(m);
  slab(canopy, zUnder, r.roof, shade(MEMBRANE, 1.25), WHITE, shade(WHITE, 0.9));
  const rim = canopy.slice(0, canopy.length - 2);
  for (let i = 0; i + 1 < rim.length; i++) {
    const w = wallOf(rim[i]!, rim[i + 1]!);
    d.plate(w, 0, w.len, zUnder, Math.max(r.fascia, r.roof + 0.15), 0, 0.12, WHITE);
  }
}
