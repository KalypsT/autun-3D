import * as THREE from "three";
import type { BowlingModel, HeightField, McdoModel, MeasuredPiece } from "../data/types";
import { at, bowlingFrame, bowlingHallWalls, bowlingPosts, mcdoFrame } from "../core/landmarks";
import type { LandmarkSinks } from "./landmarks";
import { Draw, up, wallOf, type PWall, type ST, type STZ } from "./playhouse";
import { T } from "./style";

/**
 * McDonald's et bowling Strike Bowl de la route de Chalon (D234), d'après les photos de l'utilisateur (Google Street View de juillet 2026,
 * photo du bowling) et le relevé LiDAR. Étape 1, les volumes :
 * - McDonald's : corps principal au bardage brun-orangé sur soubassement gris, ceint d'une mansarde brune (pans à 42° autour d'un toit
 *   plat gris, édicules techniques) ; véranda vitrée en L côté route et côté ouest, toit de zinc à croupes, pan coupé vers le drive ;
 * - bowling : halle à deux pans de tôle rouge, pignons à bardage rouge sur la route (en auvent sur deux poteaux, mur vitré en retrait)
 *   et sur le parking ; aile ouest en L et aile est basses à toit plat derrière un acrotère gris clair ; bande basse le long du mur est ;
 *   pergola blanche au sud-est.
 */

const C = (hex: string): THREE.Color => new THREE.Color(hex);
const shade = (c: THREE.Color, k: number): THREE.Color => c.clone().multiplyScalar(k);
const GLOW_LO = C("#ffb04a"), GLOW_HI = C("#fff0b0");
// McDonald's : bardage façon bois, soubassement gris, mansarde brune, toit plat gris, zinc, menuiseries gris anthracite.
const CLAD = C("#a4623b"), PLINTH = C("#7b7f82"), MANSARD = C("#7c4330"), FLAT = C("#8c8e8c"), ZINC = C("#a6abae"), FRAME = C("#3e4448");
const UNIT = C("#b9bcbc"), WHITE = C("#f1f0ea");
// Bowling : panneaux gris clair, enduit beige de la halle, bardage et tôle rouges, pergola blanche.
const PANEL = C("#d9d6cc"), RENDER = C("#d7c2a6"), RED = C("#a2372d"), RED_ROOF = C("#a4474a"), MEMBRANE = C("#77736f"), POST = C("#55595c");
/** Soubassement du McDonald's, épaisseur de l'acrotère des ailes du bowling, débord des pans de la halle, épaisseur de la rive. */
const PLINTH_H = 0.5, PARAPET = 0.3, EAVE_OVER = 0.0, FASCIA = 0.25;

/** Dalle horizontale de contour `pts` (s, t), dessus à z1, dessous à z0, chants vers l'extérieur. */
function slab(d: Draw, pts: ST[], z0: number, z1: number, top: THREE.Color, edge: THREE.Color, under: THREE.Color = shade(edge, 0.8)): void {
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
}

/** Les quatre murs d'un rectangle (s0, s1, t0, t1), sens trigonométrique (normales sortantes). */
function rectWalls(s0: number, s1: number, t0: number, t1: number): PWall[] {
  return [wallOf([s0, t0], [s1, t0]), wallOf([s1, t0], [s1, t1]), wallOf([s1, t1], [s0, t1]), wallOf([s0, t1], [s0, t0])];
}

/** Pan de toit triangulaire ou quadrangulaire, sans les côtés dégénérés (points confondus). */
function panOf(d: Draw, pts: STZ[], col: THREE.Color): void {
  const q = pts.filter((p, k) => {
    const n = pts[(k + 1) % pts.length]!;
    return Math.hypot(p[0] - n[0], p[1] - n[1]) > 0.02 || Math.abs(p[2] - n[2]) > 0.02;
  });
  if (q.length === 3) d.pan(q[0]!, q[1]!, q[2]!, null, col);
  else if (q.length === 4) d.pan(q[0]!, q[1]!, q[2]!, q[3]!, col);
}

export function buildMcdo(sinks: LandmarkSinks, m: McdoModel, terrain: HeightField): void {
  const f = mcdoFrame(m);
  const ground = (s: number, t: number): number => terrain.heightAt(...at(f, s, t));
  const d = new Draw(sinks.solid, sinks.glow, f, ground);
  const { l: L, d: D, band: b } = m;
  const glassLo = C(T.glass[0]), glassHi = C(T.glass[1]);

  // --- Corps principal : bardage sur soubassement, mansarde, toit plat ----------------------------------------------------------
  for (const w of rectWalls(0, L, 0, D)) {
    const base = Math.max(ground(...w.a), ground(...w.b)) + PLINTH_H;
    d.face(w, m.eave, [[base, PLINTH], [Infinity, CLAD]]);
  }
  // Mansarde : quatre pans trapézoïdaux de l'égout (au droit des murs, débord de 30 cm) au faîte, arêtiers aux coins.
  const o = 0.3, zE = m.eave - 0.08;
  const outer: ST[] = [[-o, -o], [L + o, -o], [L + o, D + o], [-o, D + o]];
  const inner: ST[] = [[b, b], [L - b, b], [L - b, D - b], [b, D - b]];
  for (let k = 0; k < 4; k++) {
    const a = outer[k]!, c = outer[(k + 1) % 4]!, ic = inner[(k + 1) % 4]!, ia = inner[k]!;
    d.pan([...a, zE], [...c, zE], [...ic, m.crest], [...ia, m.crest], MANSARD);
    // Sous-face du débord.
    const ws = wallOf(a, c);
    d.plate(ws, 0, ws.len, zE - 0.12, zE, 0, 0.02, shade(MANSARD, 0.75), true);
  }
  // Faces intérieures de la mansarde, du faîte au toit plat (invisibles du sol, fermées pour la vue haute), et toit plat.
  const zr = Math.min(m.roof, m.crest - 0.4);
  for (const w of rectWalls(b, L - b, b, D - b)) d.plate(wallOf(w.b, w.a), 0, w.len, zr, m.crest, 0, 0, shade(MANSARD, 0.85), true);
  slab(d, inner, zr - 0.1, zr, FLAT, FLAT);
  for (const [s0, s1, t0, t1, z] of m.units) {
    for (const w of rectWalls(s0, s1, t0, t1)) d.plate(w, 0, w.len, zr, z, 0, 0, UNIT, true);
    slab(d, [[s0, t0], [s1, t0], [s1, t1], [s0, t1]], z - 0.05, z, shade(UNIT, 1.05), UNIT);
  }

  // --- Véranda : murs vitrés le long du bord extérieur, toit de zinc à croupes -----------------------------------------------------
  const v = m.ver;
  const same = (p: ST, q: ST): boolean => Math.hypot(p[0] - q[0], p[1] - q[1]) < 0.05;
  const zO = v.eave, zR = (k: number): number => (same(v.r[k]!, v.o[k]!) ? v.eave : v.ridge), zI = (k: number): number => (same(v.i[k]!, v.o[k]!) ? v.eave : v.gut);
  const walls: PWall[] = [];
  // Mur du bout nord du bras ouest (du coin vers le corps), puis le bord extérieur.
  if (!same(v.o[0]!, v.i[0]!)) walls.push(wallOf(v.i[0]!, v.o[0]!));
  for (let k = 0; k + 1 < v.o.length; k++) walls.push(wallOf(v.o[k]!, v.o[k + 1]!));
  for (const w of walls) {
    if (w.len < 0.2) continue;
    const lo = Math.min(ground(...w.a), ground(...w.b));
    const top = zO - 0.05;
    d.face(w, top, [[lo + 0.35, FRAME], [top - 0.25, FRAME], [Infinity, shade(ZINC, 0.9)]]);
    d.shape(d.mb, w, w.len / 2, w.len / 2 - 0.05, lo + 0.4, top - 0.3, false, 0.02, glassLo, glassHi);
    d.shape(sinks.glow, w, w.len / 2, w.len / 2 - 0.15, lo + 0.5, top - 0.4, false, 0.025, GLOW_LO, GLOW_HI);
    const n = Math.max(1, Math.round(w.len / 1.5));
    for (let i = 0; i <= n; i++) d.plate(w, (w.len * i) / n - 0.04, (w.len * i) / n + 0.04, lo + 0.35, top - 0.25, 0.02, 0.07, FRAME, true);
  }
  // Pans : du bord extérieur au faîtage, du faîtage au pied contre le corps ; croupe du bout nord du bras ouest.
  for (let k = 0; k + 1 < v.o.length; k++) {
    panOf(d, [[...v.o[k]!, zO], [...v.o[k + 1]!, zO], [...v.r[k + 1]!, zR(k + 1)], [...v.r[k]!, zR(k)]], ZINC);
    panOf(d, [[...v.r[k]!, zR(k)], [...v.r[k + 1]!, zR(k + 1)], [...v.i[k + 1]!, zI(k + 1)], [...v.i[k]!, zI(k)]], shade(ZINC, 0.96));
  }
  panOf(d, [[...v.i[0]!, zI(0)], [...v.o[0]!, zO], [...v.r[0]!, zR(0)]], ZINC);
  // Rive de l'égout : bandeau de zinc le long du bord extérieur.
  for (let k = 0; k + 1 < v.o.length; k++) {
    const w = wallOf(v.o[k]!, v.o[k + 1]!);
    if (w.len > 0.2) d.plate(w, -0.05, w.len + 0.05, zO - 0.2, zO + 0.02, 0, 0.08, shade(ZINC, 0.85));
  }
  // Le mur du bout nord monte de l'égout jusqu'à la noue (triangle sous la croupe).
  if (!same(v.o[0]!, v.i[0]!) && zI(0) > zO) {
    const w = wallOf(v.i[0]!, v.o[0]!);
    const n = d.N(...w.out);
    sinks.solid.tri(d.P(...w.a, zO), d.P(...w.b, zO), d.P(...w.a, zI(0)), n, shade(ZINC, 0.9));
  }
}

export function buildBowling(sinks: LandmarkSinks, m: BowlingModel, terrain: HeightField): void {
  const f = bowlingFrame(m);
  const ground = (s: number, t: number): number => terrain.heightAt(...at(f, s, t));
  const d = new Draw(sinks.solid, sinks.glow, f, ground);
  const { w: W, l: Lh } = m;
  const glassLo = C(T.glass[0]), glassHi = C(T.glass[1]);

  // --- Halle : murs en retrait aux pignons, deux pans rouges, pignons à bardage rouge ----------------------------------------------
  const [hs0, hs1, ht0, ht1] = bowlingHallWalls(m);
  const zE = m.eave, zR = m.ridge, sm = W / 2;
  for (const w of rectWalls(hs0, hs1, ht0, ht1)) d.face(w, zE, [[Infinity, RENDER]]);
  // Mur vitré du pignon sud (sous l'auvent) : baies sur toute la largeur, éclairées la nuit (photo de la terrasse).
  {
    const w = wallOf([hs0, ht0], [hs1, ht0]);
    const lo = Math.max(ground(...w.a), ground(...w.b));
    d.shape(d.mb, w, w.len / 2, w.len / 2 - 2.5, lo + 0.15, lo + 3.0, false, 0.03, glassLo, glassHi);
    d.shape(sinks.glow, w, w.len / 2, w.len / 2 - 2.6, lo + 0.25, lo + 2.9, false, 0.04, GLOW_LO, GLOW_HI);
    const n = Math.round((w.len - 5) / 1.6);
    for (let i = 0; i <= n; i++) {
      const u = 2.5 + ((w.len - 5) * i) / n;
      d.plate(w, u - 0.04, u + 0.04, lo + 0.15, lo + 3.0, 0.03, 0.08, POST, true);
    }
    d.plate(w, 2.45, w.len - 2.45, lo + 3.0, lo + 3.12, 0.03, 0.08, POST, true);
  }
  // Pans de tôle rouge, rives blanches (débord le long des côtés), faîtage.
  const ov = EAVE_OVER;
  d.pan([-ov, 0, zE], [-ov, Lh, zE], [sm, Lh, zR], [sm, 0, zR], RED_ROOF);
  d.pan([sm, 0, zR], [sm, Lh, zR], [W + ov, Lh, zE], [W + ov, 0, zE], shade(RED_ROOF, 0.97));
  for (const [a, c] of [[[-ov, Lh], [-ov, 0]], [[W + ov, 0], [W + ov, Lh]]] as [ST, ST][]) {
    const w = wallOf(a, c);
    d.plate(w, 0, w.len, zE - FASCIA, zE + 0.02, 0, 0.06, WHITE);
  }
  d.bar([sm, 0, zR + 0.05], [sm, Lh, zR + 0.05], 0.08, shade(RED_ROOF, 0.85));
  // Pignons : triangle de bardage rouge à t = 0 (auvent) et t = l, rives blanches le long des rampants, poutre sous l'auvent.
  for (const [t, outward] of [[0, -1], [Lh, 1]] as const) {
    const n = d.N(0, outward);
    const A = d.P(-ov, t, zE), B = d.P(W + ov, t, zE), Cc = d.P(sm, t, zR);
    if (outward < 0) sinks.solid.tri(A, B, Cc, n, RED);
    else sinks.solid.tri(B, A, Cc, n, RED);
    const back = d.N(0, -outward);
    if (outward < 0) sinks.solid.tri(B, A, Cc, back, shade(RED, 0.7));
    else sinks.solid.tri(A, B, Cc, back, shade(RED, 0.7));
    // Joints verticaux du bardage, tous les 50 cm.
    const gw = outward < 0 ? wallOf([W + ov, t], [-ov, t]) : wallOf([-ov, t], [W + ov, t]);
    for (let u = 0.5; u < gw.len - 0.3; u += 0.5) {
      const sc = outward < 0 ? W + ov - u : -ov + u;
      const zt = zE + (zR - zE) * (1 - Math.abs(sc - sm) / (sm + ov)) - 0.05;
      if (zt > zE + 0.1) d.plate(gw, u - 0.015, u + 0.015, zE, zt, 0.0, 0.015, shade(RED, 0.8), true);
    }
    // Rives des rampants (blanches) et poutre de rive.
    for (const [p, q] of [[[-ov, t, zE], [sm, t, zR]], [[sm, t, zR], [W + ov, t, zE]]] as [STZ, STZ][]) {
      d.bar([p[0], t + outward * 0.04, p[2] + 0.05], [q[0], t + outward * 0.04, q[2] + 0.05], 0.1, WHITE);
    }
    d.plate(gw, -0.05, gw.len + 0.05, zE - 0.6, zE, 0, 0.12, WHITE);
  }
  // Sous-face de l'auvent du pignon sud et poteaux.
  if (m.porch[0] > 0.05) slab(d, [[0, 0], [W, 0], [W, m.porch[0]], [0, m.porch[0]]], zE - 0.62, zE - 0.6, WHITE, WHITE, shade(WHITE, 0.82));
  for (const [s, t] of bowlingPosts(m).slice(0, m.porch[0] > 0.5 ? 2 : 0)) d.bar([s, t, ground(s, t) - 0.2], [s, t, zE - 0.6], 0.1, POST);

  // --- Ailes, bande basse : panneaux gris clair (ou enduit beige), acrotère, toit en membrane -----------------------------------------
  const flatBox = ([s0, s1, t0, t1, , top, low]: MeasuredPiece, wall: THREE.Color, roof: THREE.Color, parapet: boolean): void => {
    for (const w of rectWalls(s0, s1, t0, t1)) {
      d.face(w, top, [[Infinity, wall]]);
      // Joints verticaux des panneaux, tous les 2,5 m.
      const n = Math.round(w.len / 2.5);
      const g0 = Math.max(ground(...w.a), ground(...w.b));
      for (let i = 1; i < n; i++) d.plate(w, (w.len * i) / n - 0.015, (w.len * i) / n + 0.015, g0, top - 0.1, 0, 0.01, shade(wall, 0.86), true);
      d.plate(w, -0.04, w.len + 0.04, top - 0.1, top + 0.03, 0, 0.04, shade(wall, 1.05));
    }
    if (!parapet || top - low < 0.25) {
      slab(d, [[s0, t0], [s1, t0], [s1, t1], [s0, t1]], top - 0.05, top, roof, wall);
      return;
    }
    const p = PARAPET, zr = Math.max(low, top - 1.0);
    slab(d, [[s0 + p, t0 + p], [s1 - p, t0 + p], [s1 - p, t1 - p], [s0 + p, t1 - p]], zr - 0.1, zr, roof, roof);
    for (const w of rectWalls(s0 + p, s1 - p, t0 + p, t1 - p)) d.plate(wallOf(w.b, w.a), 0, w.len, zr, top, 0, 0, shade(wall, 0.9), true);
    slab(d, [[s0, t0], [s1, t0], [s1, t0 + p], [s0, t0 + p]], top - 0.02, top, shade(wall, 1.05), wall);
    slab(d, [[s0, t1 - p], [s1, t1 - p], [s1, t1], [s0, t1]], top - 0.02, top, shade(wall, 1.05), wall);
    slab(d, [[s0, t0 + p], [s0 + p, t0 + p], [s0 + p, t1 - p], [s0, t1 - p]], top - 0.02, top, shade(wall, 1.05), wall);
    slab(d, [[s1 - p, t0 + p], [s1, t0 + p], [s1, t1 - p], [s1 - p, t1 - p]], top - 0.02, top, shade(wall, 1.05), wall);
  };
  for (const q of m.wing) flatBox(q, PANEL, MEMBRANE, true);
  for (const q of m.east) flatBox(q, RENDER, MEMBRANE, true);
  for (const q of m.low) flatBox(q, RENDER, RED_ROOF, false);

  // --- Pergola : poteaux gris, toile blanche tendue --------------------------------------------------------------------------------
  const posts = bowlingPosts(m).slice(m.porch[0] > 0.5 ? 2 : 0);
  for (const [s0, s1, t0, t1, , top] of m.pergola) {
    slab(d, [[s0, t0], [s1, t0], [s1, t1], [s0, t1]], top - 0.12, top, WHITE, shade(WHITE, 0.92), shade(WHITE, 0.85));
    for (const w of rectWalls(s0, s1, t0, t1)) d.plate(w, 0, w.len, top - 0.35, top - 0.12, -0.08, 0, POST);
    for (const [s, t] of posts) d.bar([s, t, ground(s, t) - 0.2], [s, t, top - 0.12], 0.06, POST);
  }
}
