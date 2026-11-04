import * as THREE from "three";
import type { BowlingModel, HeightField, McdoModel, MeasuredPiece } from "../data/types";
import { at, bowlingFrame, bowlingHallWalls, bowlingPosts, MCDO_MENU, MCDO_POT, MCDO_TOTEM, mcdoFrame, ROADSIDE_HEDGE_H, TERRACE_RAIL_H } from "../core/landmarks";
import type { LandmarkSinks } from "./landmarks";
import { Draw, up, wallOf, type PWall, type ST, type STZ } from "./playhouse";
import type { Vec3 } from "./geometry";
import { T } from "./style";

/**
 * McDonald's et bowling Strike Bowl de la route de Chalon (D234), d'après les photos de l'utilisateur (Google Street View de juillet 2026,
 * photo du bowling) et le relevé LiDAR. Étape 1, les volumes :
 * - McDonald's : corps principal au bardage brun-orangé sur soubassement gris, ceint d'une mansarde brune (pans à 42° autour d'un toit
 *   plat gris, édicules techniques) ; véranda vitrée en L côté route et côté ouest, toit de zinc à croupes, pan coupé vers le drive ;
 * - bowling : halle à deux pans de tôle rouge, pignons à bardage rouge sur la route (en auvent sur deux poteaux, mur vitré en retrait)
 *   et sur le parking ; aile ouest en L et aile est basses à toit plat derrière un acrotère gris clair ; bande basse le long du mur est ;
 *   pergola blanche au sud-est.
 * Étape 2, les façades (D235) :
 * - McDonald's : lames du bardage, sur le long côté du parking les bandes blanches de la mansarde, ses deux M jaunes et la partie à
 *   persiennes entre eux ; entrée vitrée et fenêtres côté parking, deux guichets du drive côté est, portes de service au nord ;
 *   « McDonald's » en lettres blanches sur le zinc de la véranda côté route ; totem M près de l'entrée, portique de 2,75 m et panneaux
 *   du menu sur la voie du drive ;
 * - bowling : logo rond « STRIKE BOWL » sur panneau noir (pignon ouest de l'aile, côté McDonald's) et dans le pignon rouge de la route ;
 *   peinture « CAVE À BIÈRE » au bout ouest et bandeau « BOWLING · BAR · CAVE À BIÈRE » le long de la route ; store gris sur le mur
 *   vitré de la terrasse, portes vitrées au milieu ; côté parking, portes « bowling » et « bar restaurant » ; issues de secours.
 * Étape 3, les abords (D236 ; les marquages des parkings sont dans les sols des tuiles, build_parking.py) :
 * - McDonald's : terrasse devant la véranda, quatre parasols carrés vert sombre, garde-corps gris à barreaux, lanternes sur poteaux ;
 *   gros pot rouge planté et panneau « DRIVE → » sur l'îlot de l'entrée ;
 * - bowling : haie taillée le long de la D680 et devant l'aile ouest, terrasse du pignon de la route (garde-corps noir, jardinières de
 *   béton, tables et chaises), panneau rouge et noir « BOWLING ← CAVE À BIÈRE » au coin ouest de la haie.
 */

const C = (hex: string): THREE.Color => new THREE.Color(hex);
const shade = (c: THREE.Color, k: number): THREE.Color => c.clone().multiplyScalar(k);
const GLOW_LO = C("#ffb04a"), GLOW_HI = C("#fff0b0");
// McDonald's : bardage façon bois, soubassement gris, mansarde brune, toit plat gris, zinc, menuiseries gris anthracite.
const CLAD = C("#a4623b"), PLINTH = C("#7b7f82"), MANSARD = C("#7c4330"), FLAT = C("#8c8e8c"), ZINC = C("#8d9295"), FRAME = C("#3e4448");
const UNIT = C("#b9bcbc"), WHITE = C("#f1f0ea");
// Bowling : panneaux gris clair, enduit beige de la halle, bardage et tôle rouges, pergola blanche.
const PANEL = C("#d9d6cc"), RENDER = C("#d7c2a6"), RED = C("#a2372d"), RED_ROOF = C("#a4474a"), MEMBRANE = C("#77736f"), POST = C("#55595c");
// Façades (D235) : jaune des M, noir des panneaux, gris des portes et du store, lettres.
const YELLOW = C("#f4bf1c"), BLACK = C("#202224"), DOOR_GREY = C("#8a8f93"), AWNING = C("#6c6f72"), MURAL = C("#3a3b3c"), TOTEM_BOX = C("#1f2b25");
const LOGO_RED = "#c8302c", INK = "#222426", CREAM = "#efe3c8";
// Abords (D236) : vert des parasols, gris du garde-corps, rouge du pot, vert de la haie, béton des jardinières, noir de la terrasse.
const PARASOL = C("#2f4a36"), RAIL_GREY = C("#9aa0a3"), POT_RED = C("#b3352c"), LEAF = C("#4f7a3a"), HEDGE = C("#3d6a3a");
const PLANTER = C("#d4d0c6"), IRON = C("#26292b"), TABLE = C("#3b3e40"), SIGN_GREEN = C("#21342b");

/** Garde-corps le long de la polyligne `pts` (s, t), haut de h : poteaux tous les 1,5 m, main courante, lisse basse, barreaux tous les `pitch` m. */
function railing(d: Draw, pts: ST[], h: number, col: THREE.Color, pitch: number): void {
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i]!, b = pts[i + 1]!, len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const n = Math.max(1, Math.round(len / 1.5));
    const P = (k: number): ST => [a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n];
    for (let k = 0; k < n; k++) {
      const p = P(k), q = P(k + 1), zp = d.ground(...p), zq = d.ground(...q);
      if (k > 0 || i === 0) d.bar([p[0], p[1], zp - 0.1], [p[0], p[1], zp + h], 0.035, col);
      d.bar([p[0], p[1], zp + h], [q[0], q[1], zq + h], 0.03, col);
      d.bar([p[0], p[1], zp + 0.12], [q[0], q[1], zq + 0.12], 0.02, col);
      const seg = Math.hypot(q[0] - p[0], q[1] - p[1]), m = Math.floor(seg / pitch);
      for (let j = 1; j < m; j++) {
        const u = j / m, x = p[0] + (q[0] - p[0]) * u, y = p[1] + (q[1] - p[1]) * u, z = zp + (zq - zp) * u;
        d.bar([x, y, z + 0.12], [x, y, z + h], 0.012, col);
      }
    }
    d.bar([b[0], b[1], d.ground(...b) - 0.1], [b[0], b[1], d.ground(...b) + h], 0.035, col);
  }
}

/** Haie taillée le long de la polyligne `pts`, haute de h au-dessus du sol, large de w : blocs de 2,5 m au plus qui suivent le relief. */
function hedgeAlong(d: Draw, pts: ST[], h: number, w: number): void {
  let k = 0;
  for (let i = 0; i + 1 < pts.length; i++) {
    const wl = wallOf(pts[i]!, pts[i + 1]!);
    const n = Math.max(1, Math.ceil(wl.len / 2.5));
    for (let j = 0; j < n; j++) {
      const u0 = (wl.len * j) / n, u1 = (wl.len * (j + 1)) / n;
      const za = d.ground(...d.on(wl, u0, 0)), zb = d.ground(...d.on(wl, u1, 0)), zm = d.ground(...d.on(wl, (u0 + u1) / 2, 0));
      const top = (za + zb + 2 * zm) / 4 + h, g0 = Math.min(za, zb) - 0.3;
      d.plate(wl, u0 - (j === 0 ? w / 2 : 0), u1 + (j === n - 1 ? w / 2 : 0.01), g0, top, -w / 2, w / 2, k++ % 2 ? HEDGE : shade(HEDGE, 0.95));
    }
  }
}
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

/** Texte de l'atlas posé sur le quadrilatère a, b, c, d (bas gauche, bas droite, haut droite, haut gauche), lu de face. */
function textQuad(sinks: LandmarkSinks, str: string, color: string, a: Vec3, b: Vec3, c: Vec3, dd: Vec3, n: Vec3): void {
  const label = sinks.atlas.get(str, color);
  sinks.names.quad(a, b, c, dd, n, [label.u0, label.v0], [label.u1, label.v0], [label.u1, label.v1], [label.u0, label.v1], new THREE.Color(1, 1, 1));
}

/** Texte de l'atlas sur le mur, centré en (u, zc), de hauteur de case th (largeur 6,4 th), à `off` devant le mur. */
function wallText(sinks: LandmarkSinks, d: Draw, w: PWall, str: string, u: number, zc: number, th: number, color: string, off = 0.06): void {
  const tw = th * 6.4, a = d.on(w, u - tw / 2, off), b = d.on(w, u + tw / 2, off);
  textQuad(sinks, str, color, d.P(...a, zc - th / 2), d.P(...b, zc - th / 2), d.P(...b, zc + th / 2), d.P(...a, zc + th / 2), d.N(...w.out));
}

/** Porte vitrée (un ou deux battants) de largeur wd centrée en u, haute de h depuis le sol : cadre, vitre, montant, lueur la nuit. */
function glassDoor(sinks: LandmarkSinks, d: Draw, w: PWall, u: number, wd: number, h: number, double: boolean): void {
  const g0 = d.ground(...d.on(w, u, 0));
  const lo = C(T.glass[0]), hi = C(T.glass[1]);
  d.plate(w, u - wd / 2 - 0.08, u + wd / 2 + 0.08, g0, g0 + h + 0.08, 0, 0.05, FRAME, true);
  d.shape(d.mb, w, u, wd / 2 - 0.02, g0 + 0.05, g0 + h, false, 0.06, lo, hi);
  if (double) d.plate(w, u - 0.03, u + 0.03, g0, g0 + h, 0.06, 0.09, FRAME, true);
  d.shape(sinks.glow, w, u, wd / 2 - 0.1, g0 + 0.1, g0 + h - 0.1, false, 0.07, GLOW_LO, GLOW_HI);
}

/** Porte de service pleine (gris clair) de largeur wd centrée en u. */
function serviceDoor(d: Draw, w: PWall, u: number, wd = 1.0, h = 2.15): void {
  const g0 = d.ground(...d.on(w, u, 0));
  d.plate(w, u - wd / 2 - 0.06, u + wd / 2 + 0.06, g0, g0 + h + 0.06, 0, 0.03, shade(DOOR_GREY, 0.8), true);
  d.plate(w, u - wd / 2, u + wd / 2, g0, g0 + h, 0.03, 0.05, DOOR_GREY, true);
}

/**
 * Logo rond « STRIKE BOWL » (photos) centré en (u, zc) sur le mur, de rayon r : disque blanc cerclé de rouge, « BOWLING » en haut,
 * « STRIKE » en grand et « BOWL » en rouge, « CAVE À BIÈRE » en bas.
 */
function strikeLogo(sinks: LandmarkSinks, d: Draw, w: PWall, u: number, zc: number, r: number, off = 0.05): void {
  d.oval(w, u, zc, r, r, off, C("#f4f2ec"), 24);
  d.oval(w, u, zc, r * 0.9, r * 0.9, off + 0.01, C(LOGO_RED), 24);
  d.oval(w, u, zc, r * 0.8, r * 0.8, off + 0.02, C("#f4f2ec"), 24);
  wallText(sinks, d, w, "BOWLING", u, zc + r * 0.52, r * 0.2, INK, off + 0.03);
  wallText(sinks, d, w, "STRIKE", u, zc + r * 0.1, r * 0.4, LOGO_RED, off + 0.03);
  wallText(sinks, d, w, "BOWL", u, zc - r * 0.28, r * 0.26, LOGO_RED, off + 0.03);
  wallText(sinks, d, w, "CAVE À BIÈRE", u, zc - r * 0.58, r * 0.16, INK, off + 0.03);
}

/**
 * Tracé du M (deux hautes arches) dans un repère de glyphe x ∈ [−1, 1], y ∈ [−1, 1] : segments (x0, y0, x1, y1). Les jambes montent
 * droit jusqu'à la naissance des arches (y = −0,2), les arches en demi-ellipses étirées culminent en haut, le creux du milieu descend
 * jusqu'à y = −0,45.
 */
function mGlyph(): [number, number, number, number][] {
  const spring = -0.2, rise = 1.2;
  const out: [number, number, number, number][] = [[-0.95, -1, -0.95, spring], [0.95, spring, 0.95, -1], [0, spring, 0, -0.45]];
  for (const cx of [-0.475, 0.475]) {
    for (let i = 0; i < 10; i++) {
      const a0 = Math.PI * (1 - i / 10), a1 = Math.PI * (1 - (i + 1) / 10);
      out.push([cx + 0.475 * Math.cos(a0), spring + rise * Math.sin(a0), cx + 0.475 * Math.cos(a1), spring + rise * Math.sin(a1)]);
    }
  }
  return out;
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

  // --- Façades (D235) --------------------------------------------------------------------------------------------------------------
  const [wS, wE, wN, wW] = rectWalls(0, L, 0, D);
  // Lames du bardage façon bois : joints sombres tous les 1,2 m au-dessus du soubassement.
  for (const w of [wS!, wE!, wN!, wW!]) {
    const g0 = Math.max(ground(...w.a), ground(...w.b)) + PLINTH_H;
    const n = Math.round(w.len / 1.2);
    for (let i = 1; i < n; i++) d.plate(w, (w.len * i) / n - 0.025, (w.len * i) / n + 0.025, g0, m.eave - 0.1, 0, 0.015, shade(CLAD, 0.78), true);
  }
  // Côté parking (ouest ; u depuis le nord) : entrée vitrée sous un auvent sombre, deux fenêtres (photos depuis le parking).
  const uW = (t: number): number => D - t;
  glassDoor(sinks, d, wW!, uW(13.2), 2.4, 2.45, true);
  {
    const g0 = ground(...d.on(wW!, uW(13.2), 0));
    d.plate(wW!, uW(13.2) - 1.8, uW(13.2) + 1.8, g0 + 2.7, g0 + 2.95, 0, 1.1, FRAME);
  }
  for (const t of [18.5, 23.5]) {
    const u = uW(t), g0 = ground(...d.on(wW!, u, 0));
    d.plate(wW!, u - 1.25, u + 1.25, g0 + 0.85, g0 + 2.35, 0, 0.04, FRAME, true);
    d.shape(d.mb, wW!, u, 1.15, g0 + 0.95, g0 + 2.25, false, 0.05, glassLo, glassHi);
    d.shape(sinks.glow, wW!, u, 1.05, g0 + 1.0, g0 + 2.2, false, 0.06, GLOW_LO, GLOW_HI);
  }
  // Côté drive (est ; u depuis le sud) : deux guichets vitrés sous de petits auvents (payer, retirer).
  for (const t of [8.0, 14.5]) {
    const g0 = ground(...d.on(wE!, t, 0));
    d.plate(wE!, t - 0.95, t + 0.95, g0 + 0.85, g0 + 2.25, 0, 0.05, FRAME, true);
    d.shape(d.mb, wE!, t, 0.85, g0 + 0.95, g0 + 2.15, false, 0.06, glassLo, glassHi);
    d.shape(sinks.glow, wE!, t, 0.8, g0 + 1.0, g0 + 2.1, false, 0.07, GLOW_LO, GLOW_HI);
    d.plate(wE!, t - 0.95, t + 0.95, g0 + 0.75, g0 + 0.85, 0, 0.35, shade(UNIT, 0.9));
    d.plate(wE!, t - 1.2, t + 1.2, g0 + 2.45, g0 + 2.6, 0, 0.9, FRAME);
  }
  // Nord : deux portes de service.
  for (const sv of [4.0, 12.5]) serviceDoor(d, wN!, L - sv);
  // Mansarde côté parking (photos) : bandes blanches de l'égout au faîte, deux M jaunes, persiennes entre eux. Repère du pan : u le long
  // de t, v en mètres le long de la pente depuis l'égout.
  {
    const run = b + o, rise = m.crest - zE, len = Math.hypot(run, rise);
    const P = (u: number, vm: number): Vec3 => d.P(-o + (run * vm) / len - 0.03 * (rise / len), u, zE + (rise * vm) / len + 0.03 * (run / len));
    const n = up(P(0, 0), P(1, 0), P(0, 1));
    const quad = (u0: number, v0: number, u1: number, v1: number, col: THREE.Color): void => sinks.solid.quad(P(u0, v0), P(u1, v0), P(u1, v1), P(u0, v1), n, col);
    const seg = (u0: number, v0: number, u1: number, v1: number, th: number, col: THREE.Color): void => {
      const l = Math.hypot(u1 - u0, v1 - v0) || 1, pu = (-(v1 - v0) / l) * (th / 2), pv = ((u1 - u0) / l) * (th / 2);
      sinks.solid.quad(P(u0 + pu, v0 + pv), P(u1 + pu, v1 + pv), P(u1 - pu, v1 - pv), P(u0 - pu, v0 - pv), n, col);
    };
    const v0 = 0.15, v1 = len - 0.1;
    const Ms = [8.5, 20.0];
    for (const tc of Ms) {
      for (const k of [-1, 1]) quad(tc + k * 1.75 - 0.3, v0, tc + k * 1.75 + 0.3, v1, WHITE);
      // M jaune (u vers le nord à gauche pour qui regarde depuis l'ouest : le glyphe est symétrique).
      const sc = 1.15, vc = len * 0.5;
      for (const [x0, y0, x1, y1] of mGlyph()) seg(tc + x0 * sc, vc + y0 * sc * 1.1, tc + x1 * sc, vc + y1 * sc * 1.1, 0.34, YELLOW);
    }
    // Persiennes entre les deux M : lames plus sombres le long de la pente, tous les 35 cm.
    const pa = Ms[0]! + 2.15, pb = Ms[1]! - 2.15;
    for (let u = pa; u < pb - 0.1; u += 0.35) quad(u, v0 + 0.1, u + 0.14, v1 - 0.1, shade(MANSARD, 0.72));
  }
  // « McDonald's » en lettres blanches sur le pan du zinc côté route (photos de l'entrée et du drive).
  {
    const k = 1, O0 = v.o[k]!, O1 = v.o[k + 1]!, R0 = v.r[k]!;
    if (Math.abs(O1[1] - O0[1]) < 0.05) {
      const dt = R0[1] - O0[1], dz = v.ridge - v.eave, len = Math.hypot(dt, dz);
      const Q = (sv: number, vm: number): Vec3 => d.P(sv, O0[1] + (dt * vm) / len, v.eave + (dz * vm) / len + 0.04);
      const sc = (O0[0] + O1[0]) / 2, th = Math.min(0.95, len * 0.55), tw = th * 6.4, vc = len * 0.48;
      const nq = up(Q(0, 0), Q(1, 0), Q(0, 1));
      textQuad(sinks, "McDonald's", "#ffffff", Q(sc - tw / 2, vc - th / 2), Q(sc + tw / 2, vc - th / 2), Q(sc + tw / 2, vc + th / 2), Q(sc - tw / 2, vc + th / 2), nq);
    }
  }

  // --- Abords des façades (D235) : totem M, portique du drive, panneaux du menu ------------------------------------------------------
  const site = m.site;
  if (site) {
    // Totem : fût habillé de bardage brun-orangé, caisson sombre à M jaune sur ses deux faces (vers la route et vers le restaurant).
    const [ts, tt] = site.totem, h = MCDO_TOTEM / 2, g0 = ground(ts, tt);
    for (const w of rectWalls(ts - h, ts + h, tt - h, tt + h)) d.plate(w, 0, w.len, g0 - 0.3, g0 + 6.0, 0, 0, CLAD, true);
    const bw = 1.1, top = g0 + 8.0, bot = g0 + 6.0;
    for (const w of rectWalls(ts - bw, ts + bw, tt - 0.3, tt + 0.3)) d.plate(w, 0, w.len, bot, top, 0, 0, TOTEM_BOX, true);
    slab(d, [[ts - bw, tt - 0.3], [ts + bw, tt - 0.3], [ts + bw, tt + 0.3], [ts - bw, tt + 0.3]], top - 0.05, top, shade(TOTEM_BOX, 1.1), TOTEM_BOX);
    for (const w of [wallOf([ts - bw, tt - 0.3], [ts + bw, tt - 0.3]), wallOf([ts + bw, tt + 0.3], [ts - bw, tt + 0.3])]) {
      for (const [x0, y0, x1, y1] of mGlyph()) {
        const u0 = bw + x0 * 0.85, u1 = bw + x1 * 0.85, z0 = (top + bot) / 2 + y0 * 0.8, z1 = (top + bot) / 2 + y1 * 0.8;
        const l = Math.hypot(u1 - u0, z1 - z0) || 1, pu = (-(z1 - z0) / l) * 0.14, pz = ((u1 - u0) / l) * 0.14;
        const Pq = (u: number, z: number): Vec3 => d.P(...d.on(w, u, 0.02), z);
        sinks.solid.quad(Pq(u0 + pu, z0 + pz), Pq(u1 + pu, z1 + pz), Pq(u1 - pu, z1 - pz), Pq(u0 - pu, z0 - pz), d.N(...w.out), YELLOW);
      }
    }
    // Portique de 2,75 m : poteau gris à l'ouest, montant habillé de bois à l'est, poutre rayée noir et blanc, panneau « 2.75 ».
    const [g0s, g1s, gt] = site.gantry, gz = Math.min(ground(g0s, gt), ground(g1s, gt));
    d.bar([g0s, gt, gz - 0.2], [g0s, gt, gz + 3.15], 0.08, POST);
    for (const w of rectWalls(g1s - 0.25, g1s + 0.25, gt - 0.15, gt + 0.15)) d.plate(w, 0, w.len, gz - 0.2, gz + 4.2, 0, 0, CLAD, true);
    slab(d, [[g1s - 0.25, gt - 0.15], [g1s + 0.25, gt - 0.15], [g1s + 0.25, gt + 0.15], [g1s - 0.25, gt + 0.15]], gz + 4.15, gz + 4.2, CLAD, CLAD);
    const beam = wallOf([g0s, gt], [g1s, gt]);
    for (let u = 0, i = 0; u < beam.len - 0.25; u += 0.4, i++) {
      d.plate(beam, u, Math.min(beam.len - 0.25, u + 0.4), gz + 2.75, gz + 3.05, -0.08, 0.08, i % 2 ? WHITE : BLACK);
    }
    const um = beam.len * 0.62;
    d.plate(beam, um - 0.45, um + 0.45, gz + 3.05, gz + 3.45, -0.04, 0.06, TOTEM_BOX);
    wallText(sinks, d, beam, "2.75", um, gz + 3.25, 0.3, "#ffffff", 0.07);
    // Panneaux du menu, tournés vers la voie (ouest) : pied, cadre sombre, affiche lumineuse.
    for (const [ms, mt] of site.menus) {
      const w = wallOf([ms - MCDO_MENU[1] / 2, mt + MCDO_MENU[0]], [ms - MCDO_MENU[1] / 2, mt - MCDO_MENU[0]]);
      const z0 = ground(ms, mt);
      d.plate(w, 0, w.len, z0 - 0.2, z0 + 2.4, 0, -MCDO_MENU[1], TOTEM_BOX);
      d.plate(w, 0.1, w.len - 0.1, z0 + 0.6, z0 + 2.3, 0, 0.02, C("#f3e7c6"), true);
      for (const [za, zb, col] of [[1.75, 2.2, "#c8302c"], [1.2, 1.65, "#f4bf1c"], [0.7, 1.1, "#6a8f3c"]] as const) {
        d.plate(w, 0.2, w.len - 0.2, z0 + za, z0 + zb, 0.02, 0.03, C(col), true);
      }
      d.shape(sinks.glow, w, w.len / 2, w.len / 2 - 0.15, z0 + 0.65, z0 + 2.25, false, 0.035, GLOW_LO, GLOW_HI);
    }

    // --- Abords (D236) : terrasse, pot et panneau de l'entrée ----------------------------------------------------------------------
    // Parasols carrés de 3,6 m : mât gris, toile vert sombre en pyramide basse, bavolet.
    for (const [ps, pt] of site.parasols ?? []) {
      const z0 = ground(ps, pt), h = 1.8, zb = z0 + 2.35, zt = z0 + 2.95;
      d.bar([ps, pt, z0 - 0.1], [ps, pt, zt + 0.1], 0.04, RAIL_GREY);
      const c: ST[] = [[ps - h, pt - h], [ps + h, pt - h], [ps + h, pt + h], [ps - h, pt + h]];
      for (let k = 0; k < 4; k++) {
        const a = c[k]!, b = c[(k + 1) % 4]!;
        d.pan([...a, zb], [...b, zb], [ps, pt, zt], null, k % 2 ? PARASOL : shade(PARASOL, 0.92));
        d.plate(wallOf(a, b), 0, 2 * h, zb - 0.22, zb, -0.01, 0.01, shade(PARASOL, 0.85));
      }
    }
    for (const r of site.rails ?? []) railing(d, r, TERRACE_RAIL_H, RAIL_GREY, 0.3);
    // Lanternes sur poteaux aux coins de la terrasse, allumées la nuit.
    for (const [ls, lt] of site.lamps ?? []) {
      const z0 = ground(ls, lt);
      d.bar([ls, lt, z0 - 0.1], [ls, lt, z0 + 2.5], 0.05, FRAME);
      for (const w of rectWalls(ls - 0.17, ls + 0.17, lt - 0.17, lt + 0.17)) {
        d.plate(w, 0, w.len, z0 + 2.5, z0 + 2.95, 0, 0, FRAME, true);
        d.shape(sinks.glow, w, w.len / 2, w.len / 2 - 0.05, z0 + 2.55, z0 + 2.9, false, 0.01, GLOW_LO, GLOW_HI);
      }
      slab(d, [[ls - 0.22, lt - 0.22], [ls + 0.22, lt - 0.22], [ls + 0.22, lt + 0.22], [ls - 0.22, lt + 0.22]], z0 + 2.95, z0 + 3.05, FRAME, FRAME);
    }
    // Gros pot rouge carré, arbre taillé en boule.
    if (site.pot) {
      const [ps, pt] = site.pot, z0 = ground(ps, pt), h = MCDO_POT;
      for (const w of rectWalls(ps - h, ps + h, pt - h, pt + h)) d.plate(w, 0, w.len, z0 - 0.1, z0 + 1.0, 0, 0, POT_RED, true);
      slab(d, [[ps - h, pt - h], [ps + h, pt - h], [ps + h, pt + h], [ps - h, pt + h]], z0 + 0.92, z0 + 1.0, shade(POT_RED, 0.8), POT_RED);
      d.bar([ps, pt, z0 + 0.9], [ps, pt, z0 + 2.0], 0.07, C("#5a4030"));
      for (const [r, z, k] of [[1.0, 2.0, 1], [1.2, 2.5, 0.94], [0.8, 3.1, 1.06]] as const) {
        for (const w of rectWalls(ps - r, ps + r, pt - r, pt + r)) d.plate(w, 0, w.len, z0 + z, z0 + z + 0.6, 0, 0, shade(LEAF, k), true);
        slab(d, [[ps - r, pt - r], [ps + r, pt - r], [ps + r, pt + r], [ps - r, pt + r]], z0 + z + 0.55, z0 + z + 0.6, shade(LEAF, k * 1.05), shade(LEAF, k));
      }
    }
    // Panneau « DRIVE → » tourné vers l'entrée (la route, −t) : deux poteaux, caisson vert sombre.
    if (site.sign) {
      const [ss, st] = site.sign, z0 = ground(ss, st);
      for (const k of [-1, 1]) d.bar([ss + k * 0.6, st, z0 - 0.1], [ss + k * 0.6, st, z0 + 1.9], 0.05, RAIL_GREY);
      const w = wallOf([ss - 0.85, st - 0.06], [ss + 0.85, st - 0.06]);
      d.plate(w, 0, w.len, z0 + 1.0, z0 + 1.95, 0, 0.12, SIGN_GREEN);
      wallText(sinks, d, w, "DRIVE →", w.len / 2, z0 + 1.48, 0.42, "#ffffff", 0.13);
    }
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

  // --- Façades (D235) --------------------------------------------------------------------------------------------------------------
  const wingA = m.wing[0], wingB = m.wing[m.wing.length - 1];
  if (wingA && wingB) {
    const [a0, a1, at0, at1, , aTop] = wingA;
    // Pignon ouest de l'aile (vers le McDonald's) : panneau noir carré au logo rond « STRIKE BOWL » ; issue de secours.
    const west = wallOf([a0, at1], [a0, at0]);
    const uc = west.len / 2, zc = aTop - 2.2;
    d.plate(west, uc - 1.6, uc + 1.6, zc - 1.6, zc + 1.6, 0, 0.06, BLACK);
    strikeLogo(sinks, d, west, uc, zc, 1.3, 0.07);
    serviceDoor(d, west, west.len * 0.8, 1.6);
    // Bout ouest du long côté de la route : peinture « CAVE À BIÈRE » (lettres crème sur fond gris sombre).
    const southA = wallOf([a0, at0], [a1, at0]);
    d.plate(southA, 0.6, 4.8, aTop - 3.7, aTop - 0.4, 0, 0.03, MURAL, true);
    wallText(sinks, d, southA, "CAVE À", 2.7, aTop - 1.35, 0.95, CREAM, 0.04);
    wallText(sinks, d, southA, "BIÈRE", 2.7, aTop - 2.45, 1.05, CREAM, 0.04);
    d.plate(southA, 2.2, 3.2, aTop - 3.55, aTop - 3.05, 0.03, 0.04, C("#d9a23a"), true);
    // Bandeau « BOWLING · BAR · CAVE À BIÈRE » le long de la route, sur l'aile en L jusqu'à la halle (photos de la route et de la terrasse).
    const [b0, , bt0, bt1, , bTop] = wingB;
    const southB = wallOf([b0, bt0], [0, bt0]);
    const u0 = 1.0, u1 = southB.len - 0.8, zb0 = bTop - 1.55, zb1 = bTop - 0.35;
    d.plate(southB, u0, u1, zb0, zb1, 0, 0.06, MURAL);
    wallText(sinks, d, southB, "BOWLING · BAR · CAVE À BIÈRE", (u0 + u1) / 2, (zb0 + zb1) / 2, (u1 - u0) / 6.4, "#f4f2ec", 0.07);
    // Côté parking de l'aile : issue de secours.
    const northB = wallOf([0, bt1], [b0, bt1]);
    serviceDoor(d, northB, northB.len * 0.3, 1.6);
  }
  // Pignon de la route : logo rond dans le triangle rouge ; store gris sur le mur vitré ; portes vitrées au milieu.
  {
    const gw = wallOf([0, 0], [W, 0]);
    strikeLogo(sinks, d, gw, W / 2, zE + (zR - zE) * 0.42, Math.min(0.95, (zR - zE) * 0.42), 0.04);
    const wall = wallOf([hs0, ht0], [hs1, ht0]);
    const lo = Math.max(ground(...wall.a), ground(...wall.b));
    glassDoor(sinks, d, wall, wall.len / 2, 2.0, 2.4, true);
    const tOut = Math.max(0.6, ht0 - 1.6), zIn = lo + 3.35, zOut = lo + 2.8;
    d.pan([2.4, ht0 - 0.05, zIn], [W - 2.4, ht0 - 0.05, zIn], [W - 2.4, tOut, zOut], [2.4, tOut, zOut], AWNING);
    const valance = wallOf([2.4, tOut], [W - 2.4, tOut]);
    d.plate(valance, 0, valance.len, zOut - 0.25, zOut, 0, 0.02, shade(AWNING, 0.85), true);
  }
  // Pignon du parking : portes « bowling » (à l'est) et « bar restaurant » (à l'ouest), plaques blanches au-dessus.
  {
    const nw = wallOf([hs1, ht1], [hs0, ht1]);
    for (const [sv, label] of [[W * 0.7, "bowling"], [W * 0.32, "bar restaurant"]] as const) {
      const u = W - sv, g0 = ground(...d.on(nw, u, 0));
      glassDoor(sinks, d, nw, u, 1.9, 2.3, true);
      d.plate(nw, u - 0.9, u + 0.9, g0 + 2.55, g0 + 2.95, 0, 0.04, C("#f4f2ec"), true);
      wallText(sinks, d, nw, label, u, g0 + 2.75, 0.26, INK, 0.05);
    }
  }

  // --- Abords (D236) : haie de la D680, terrasse du pignon de la route, panneau du coin ouest ---------------------------------------------
  const site = m.site;
  if (site) {
    hedgeAlong(d, site.hedge, ROADSIDE_HEDGE_H, 1.4);
    for (const r of site.rails) railing(d, r, TERRACE_RAIL_H, IRON, 0.5);
    // Jardinières de béton au pied du garde-corps, devant la terrasse (photo de la terrasse).
    for (const r of site.rails) {
      for (let i = 0; i + 1 < r.length; i++) {
        const w = wallOf(r[i]!, r[i + 1]!);
        if (Math.abs(r[i]![1] - r[i + 1]![1]) > 0.05) continue;
        for (let u = 0.35; u < w.len - 0.3; u += 0.65) {
          const [ps, pt] = d.on(w, u, 0.45), z0 = ground(ps, pt);
          for (const ww of rectWalls(ps - 0.25, ps + 0.25, pt - 0.25, pt + 0.25)) d.plate(ww, 0, ww.len, z0 - 0.1, z0 + 0.45, 0, 0, PLANTER, true);
          slab(d, [[ps - 0.25, pt - 0.25], [ps + 0.25, pt - 0.25], [ps + 0.25, pt + 0.25], [ps - 0.25, pt + 0.25]], z0 + 0.4, z0 + 0.45, shade(LEAF, 0.9), PLANTER);
        }
      }
    }
    // Tables carrées à pied central, deux chaises de part et d'autre.
    for (const [ts, tt] of site.tables) {
      const z0 = ground(ts, tt);
      d.bar([ts, tt, z0], [ts, tt, z0 + 0.72], 0.03, IRON);
      slab(d, [[ts - 0.4, tt - 0.4], [ts + 0.4, tt - 0.4], [ts + 0.4, tt + 0.4], [ts - 0.4, tt + 0.4]], z0 + 0.72, z0 + 0.75, TABLE, TABLE);
      for (const k of [-1, 1]) {
        const cs = ts + k * 0.75;
        slab(d, [[cs - 0.22, tt - 0.22], [cs + 0.22, tt - 0.22], [cs + 0.22, tt + 0.22], [cs - 0.22, tt + 0.22]], z0 + 0.42, z0 + 0.46, TABLE, TABLE);
        const back = cs + k * 0.22;
        d.bar([back, tt - 0.2, z0], [back, tt - 0.2, z0 + 0.9], 0.012, IRON);
        d.bar([back, tt + 0.2, z0], [back, tt + 0.2, z0 + 0.9], 0.012, IRON);
        d.bar([back, tt - 0.2, z0 + 0.88], [back, tt + 0.2, z0 + 0.88], 0.02, IRON);
      }
    }
    // Panneau « BOWLING ← CAVE À BIÈRE » tourné vers le McDonald's (ouest, −s) : haut noir, bas rouge, deux poteaux.
    {
      const [ss, st] = site.sign, z0 = ground(ss, st);
      for (const k of [-1, 1]) d.bar([ss, st + k * 0.8, z0 - 0.1], [ss, st + k * 0.8, z0 + 2.4], 0.05, RAIL_GREY);
      const w = wallOf([ss - 0.06, st + 1.0], [ss - 0.06, st - 1.0]);
      d.plate(w, 0, w.len, z0 + 1.75, z0 + 2.45, 0, 0.1, BLACK);
      d.plate(w, 0, w.len, z0 + 1.0, z0 + 1.75, 0, 0.1, C(LOGO_RED));
      wallText(sinks, d, w, "BOWLING ←", w.len / 2, z0 + 2.1, 0.32, "#ffffff", 0.11);
      wallText(sinks, d, w, "CAVE À BIÈRE", w.len / 2, z0 + 1.38, 0.3, "#ffffff", 0.11);
    }
  }
}
