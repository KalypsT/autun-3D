import * as THREE from "three";
import type { HeightField, StationModel } from "../data/types";
import { at, stationFrame } from "../core/landmarks";
import { toThree, type Vec3 } from "./geometry";
import type { LandmarkSinks } from "./landmarks";
import { Draw, up, wallOf, type PWall, type ST } from "./playhouse";
import { T } from "./style";

/**
 * Gare d'Autun (D228), d'après les photos de l'utilisateur et le relevé LiDAR : ailes basses enduites de crème, à croupes, le long des
 * voies, aile en retour vers le parvis au bout est (toits unis : noue à l'angle) ; pavillon central à deux niveaux en pierre claire, toit à
 * croupes, frontons sur le parvis (horloge) et sur les voies (œil-de-bœuf). Façade sur le parvis : cinq arcades vitrées au rez-de-chaussée du
 * pavillon (allèges blanches), bandeau à l'inscription « GARE D'AUTUN », cinq fenêtres à balconnets à l'étage, chaînes d'angle et bandes de
 * l'avant-corps, corniche ; ailes à baies cintrées dans des tables entre pilastres plats, soubassement de pierre, corniche et chéneau de zinc.
 * Côté voies, pignons et retour : baies d'après les vues des quais et du parking est ; cartouche « AUTUN » sur les deux pignons du corps.
 */

const C = (hex: string): THREE.Color => new THREE.Color(hex);
const shade = (c: THREE.Color, k: number): THREE.Color => c.clone().multiplyScalar(k);
const STONE = C("#e8dcbf"), STONE_LOW = C("#cbbd9c"), RENDER = C("#efe2c2"), TRIM = C("#f5edd9"), JOINERY = C("#f3f2ec");
const ZINC = C("#8d9597"), BRICK = C("#b0533a"), IRON = C("#2a2d2e"), GLOW_LO = C("#ffb04a"), GLOW_HI = C("#fff0b0");
/** Débord des toits des ailes, du toit du pavillon au-delà des murs, saillie de la corniche du pavillon. */
const OVERHANG = 0.35, PAV_OVER = 0.25, CORNICE = 0.35;

/** Plan de toit z = A·s + B·t + C. */
type Plane = [number, number, number];
/** Toit à pans : le plus bas de ses plans (croupes, long-pans) ; plusieurs toits accolés : le plus haut d'entre eux (noues). */
type Piece = Plane[];

const zOf = (p: Plane, s: number, t: number): number => p[0] * s + p[1] * t + p[2];

/** Polygone convexe (s, t) coupé par le demi-plan a·s + b·t + c ≤ 0 (Sutherland-Hodgman). */
function clip(poly: ST[], a: number, b: number, c: number): ST[] {
  const out: ST[] = [];
  const f = (p: ST): number => a * p[0] + b * p[1] + c;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i]!, q = poly[(i + 1) % poly.length]!, fp = f(p), fq = f(q);
    if (fp <= 0) out.push(p);
    if ((fp < 0 && fq > 0) || (fp > 0 && fq < 0)) {
      const k = fp / (fp - fq);
      out.push([p[0] + (q[0] - p[0]) * k, p[1] + (q[1] - p[1]) * k]);
    }
  }
  return out;
}

/** Aire (s, t) d'un polygone. */
const polyArea = (p: ST[]): number => {
  let a = 0;
  for (let i = 0; i < p.length; i++) a += p[i]![0] * p[(i + 1) % p.length]![1] - p[(i + 1) % p.length]![0] * p[i]![1];
  return Math.abs(a) / 2;
};

/**
 * Toit d'une cellule convexe où sont actifs les toits `pieces` : z = max des toits, chacun le min de ses plans. La cellule est découpée en
 * morceaux convexes où un seul plan l'emporte (choix du plan le plus bas de chaque toit, puis du toit le plus haut), chacun dessiné à plat.
 */
function roofCell(d: Draw, cell: ST[], pieces: Piece[], col: THREE.Color): void {
  const choose = (k: number, picked: number[]): void => {
    if (k < pieces.length) {
      for (let i = 0; i < pieces[k]!.length; i++) choose(k + 1, [...picked, i]);
      return;
    }
    for (let w = 0; w < pieces.length; w++) {
      let poly = cell;
      for (let p = 0; p < pieces.length && poly.length >= 3; p++) {
        const me = pieces[p]![picked[p]!]!;
        // Ce plan est le plus bas de son toit…
        for (let l = 0; l < pieces[p]!.length && poly.length >= 3; l++) {
          if (l === picked[p]) continue;
          const o = pieces[p]![l]!;
          poly = clip(poly, me[0] - o[0], me[1] - o[1], me[2] - o[2]);
        }
        // … et le toit gagnant est le plus haut.
        if (p !== w && poly.length >= 3) {
          const win = pieces[w]![picked[w]!]!;
          poly = clip(poly, me[0] - win[0], me[1] - win[1], me[2] - win[2]);
        }
      }
      if (poly.length < 3 || polyArea(poly) < 1e-3) continue;
      const pl = pieces[w]![picked[w]!]!;
      const P = poly.map(([s, t]) => d.P(s, t, zOf(pl, s, t)));
      for (let i = 1; i + 1 < P.length; i++) d.mb.tri(P[0]!, P[i]!, P[i + 1]!, up(P[0]!, P[i]!, P[i + 1]!), col);
    }
  };
  choose(0, []);
}

const rect = (s0: number, s1: number, t0: number, t1: number): ST[] => [[s0, t0], [s1, t0], [s1, t1], [s0, t1]];

/** Petit nombre pseudo-aléatoire stable dans [0, 1). */
function rnd(k: number): number {
  const x = Math.sin(k * 91.7 + 47.3) * 43758.5453;
  return x - Math.floor(x);
}

export function buildStation(sinks: LandmarkSinks, m: StationModel, terrain: HeightField): void {
  const f = stationFrame(m);
  const d = new Draw(sinks.solid, sinks.glow, f, (s, t) => terrain.heightAt(...at(f, s, t)));
  const { l: L, d: D, g, eave, ridge } = m;
  const [p0, p1, q0, q1] = m.pav, [r0, rt] = m.ret;
  const [zCorn, zRidge, rs0, rs1] = m.pv, [hw, zPed] = m.ped;
  const lv = m.levels.map((v) => g + v) as [number, number, number, number, number, number, number];
  const [zBase, zArch, zBandLo, zBandHi, zSill, zWin, zCornLo] = lv;
  const pm = (p0 + p1) / 2, pw = p1 - p0;
  const tile = C(T.roofs.tuile_mecanique).lerp(C("#8a4a35"), 0.25);
  let k = 0;
  const lit = (): boolean => rnd(++k) < 0.3;

  // --- Murs -----------------------------------------------------------------------------------------------------------------------
  // Corps et retour (contour trigonométrique : la normale sortante est à droite).
  const wWest = wallOf([0, 0], [p0, 0]), wEast = wallOf([p1, 0], [r0, 0]);
  const rWest = wallOf([r0, 0], [r0, rt]), rSouth = wallOf([r0, rt], [L, rt]), rEast = wallOf([L, rt], [L, D]);
  const bEast = wallOf([L, D], [p1, D]), bWest = wallOf([p0, D], [0, D]), gWest = wallOf([0, D], [0, 0]);
  const low = [wWest, wEast, rWest, rSouth, rEast, bEast, bWest, gWest];
  const plinth = g + 0.75;
  for (const w of low) d.face(w, eave, [[plinth, STONE_LOW], [Infinity, RENDER]]);
  // Pavillon : quatre murs entiers (les ailes cachent le bas des côtés).
  const pFront = wallOf([p0, q0], [p1, q0]), pBack = wallOf([p1, q1], [p0, q1]);
  const pSideE = wallOf([p1, q0], [p1, q1]), pSideW = wallOf([p0, q1], [p0, q0]);
  const pav = [pFront, pBack, pSideE, pSideW];
  for (const w of pav) d.face(w, zCorn, [[g + 0.55, STONE_LOW], [Infinity, STONE]]);

  // --- Corniches, bandeaux, chaînes ----------------------------------------------------------------------------------------------
  for (const w of low) {
    d.course(w, plinth - 0.06, plinth + 0.04, 0.04, shade(STONE_LOW, 1.05));
    d.course(w, eave - 0.32, eave - 0.12, 0.12, TRIM);
    d.course(w, eave - 0.12, eave, 0.22, TRIM);
  }
  for (const w of pav) {
    d.course(w, zBandLo, zBandHi, 0.12, TRIM);
    d.course(w, zCornLo, zCornLo + 0.15, 0.12, TRIM);
    d.course(w, zCornLo + 0.15, zCorn, CORNICE, shade(TRIM, 0.97));
  }
  // Chaînes d'angle en harpe (pierres alternativement longues et courtes) aux coins du pavillon et de l'avant-corps.
  const harpe = (w: PWall, u: number, dir: number, z0: number, z1: number, off = 0.06): void => {
    let i = 0;
    for (let z = z0; z < z1 - 0.05; z += 0.42, i++) {
      const wd = i % 2 === 0 ? 0.62 : 0.42, ze = Math.min(z + 0.38, z1);
      const a = dir > 0 ? u : u - wd, b = dir > 0 ? u + wd : u;
      d.plate(w, a, b, z, ze, 0, off, shade(STONE, 1.04));
    }
  };
  for (const w of [pFront, pBack]) {
    harpe(w, 0, 1, g + 0.55, zCornLo);
    harpe(w, w.len, -1, g + 0.55, zCornLo);
    // Bandes de l'avant-corps de trois travées, du soubassement à la corniche.
    for (const u of [pw / 2 - 0.26 * pw, pw / 2 + 0.26 * pw]) d.plate(w, u - 0.28, u + 0.28, g + 0.55, zCornLo, 0, 0.07, shade(STONE, 1.03));
  }
  for (const w of [pSideE, pSideW]) {
    harpe(w, 0, 1, eave, zCornLo);
    harpe(w, w.len, -1, eave, zCornLo);
  }

  // --- Baies ----------------------------------------------------------------------------------------------------------------------
  /**
   * Baie à `u` mètres du début du mur, de largeur `wd`, du bas z0 au haut z1 (plein cintre si `arched`) : encadrement clair, menuiserie
   * blanche à petits bois, allège pleine jusqu'à `panel` (porte : plus haute), vitre ; une sur trois environ s'allume la nuit.
   */
  const bay = (w: PWall, u: number, wd: number, z0: number, z1: number, arched: boolean, panel: number): void => {
    const h = wd / 2;
    d.shape(d.mb, w, u, h + 0.16, z0, z1 + 0.16, arched, 0.02, TRIM, TRIM);
    d.shape(d.mb, w, u, h, z0, z1, arched, 0.032, JOINERY, JOINERY);
    d.shape(d.mb, w, u, h - 0.08, panel + 0.06, z1 - 0.08, arched, 0.042, C(T.glass[0]), C(T.glass[1]));
    if (panel > z0 + 0.1) {
      d.plate(w, u - h + 0.08, u + h - 0.08, z0 + 0.06, panel, 0.032, 0.05, JOINERY, true);
      d.plate(w, u - 0.02, u + 0.02, z0 + 0.06, panel, 0.05, 0.055, shade(JOINERY, 0.82), true);
    }
    // Petits bois : meneau, traverse à la naissance de l'arc, deux traverses dans la partie droite.
    const spring = arched ? z1 - h : z1;
    d.plate(w, u - 0.03, u + 0.03, panel, z1 - 0.06, 0.042, 0.052, JOINERY, true);
    d.plate(w, u - h + 0.06, u + h - 0.06, spring - 0.03, spring + 0.03, 0.042, 0.052, JOINERY, true);
    for (const fz of [1 / 3, 2 / 3]) {
      const zt = panel + (spring - panel) * fz;
      d.plate(w, u - h + 0.06, u + h - 0.06, zt - 0.02, zt + 0.02, 0.042, 0.05, JOINERY, true);
    }
    if (lit()) d.shape(sinks.glow, w, u, h - 0.1, panel + 0.08, z1 - 0.1, arched, 0.058, GLOW_LO, GLOW_HI);
  };
  /** Balconnet de fer devant une fenêtre de l'étage : main courante, barreaux, sous la baie. */
  const balconnet = (w: PWall, u: number, wd: number, z: number): void => {
    const a = d.on(w, u - wd / 2 - 0.05, 0.12), b = d.on(w, u + wd / 2 + 0.05, 0.12), top = z + 0.55;
    d.bar([a[0], a[1], top], [b[0], b[1], top], 0.02, IRON);
    d.bar([a[0], a[1], z + 0.08], [b[0], b[1], z + 0.08], 0.015, IRON);
    for (let i = 0; i <= 6; i++) {
      const p = d.on(w, u - wd / 2 - 0.05 + ((wd + 0.1) * i) / 6, 0.12);
      d.bar([p[0], p[1], z + 0.08], [p[0], p[1], top], 0.012, IRON);
    }
  };

  // Pavillon, parvis et voies : cinq travées ; rez-de-chaussée à arcades vitrées (la porte au milieu côté parvis), étage à balconnets.
  const axes = [-0.36, -0.155, 0, 0.155, 0.36].map((x) => pw / 2 + x * pw);
  for (const w of [pFront, pBack]) {
    axes.forEach((u, i) => {
      bay(w, u, 1.55, zBase, zArch, true, i === 2 ? zBase + 2.2 : zBase + 0.95);
      d.keystone(w, u, zArch + 0.22, 0.3, 0.42);
      bay(w, u, 1.15, zSill, zWin, false, zSill);
      d.plate(w, u - 0.75, u + 0.75, zSill - 0.12, zSill, 0, 0.14, TRIM);
      d.plate(w, u - 0.78, u + 0.78, zWin + 0.16, zWin + 0.3, 0, 0.12, TRIM);
      balconnet(w, u, 1.15, zSill);
    });
  }

  // Ailes sur le parvis : tables entre pilastres plats, une baie cintrée par table ; à l'ouest, la plus proche du pavillon est une porte.
  const zTop = eave - 0.32;
  const tables = (w: PWall, n: number, door: number): void => {
    const step = w.len / n;
    for (let i = 0; i <= n; i++) d.plate(w, Math.max(0, i * step - 0.3), Math.min(w.len, i * step + 0.3), plinth, zTop, 0, 0.08, shade(RENDER, 1.03));
    for (let i = 0; i < n; i++) {
      const u = step * (i + 0.5);
      d.plate(w, u - step / 2 + 0.3, u + step / 2 - 0.3, plinth + 0.04, zTop, 0, 0.01, shade(RENDER, 0.95), true);
      bay(w, u, 1.3, zBase, zArch, true, i === door ? zBase + 2.2 : zBase + 1.05);
      d.keystone(w, u, zArch + 0.2, 0.26, 0.36);
    }
  };
  tables(wWest, m.bays[0], m.bays[0] - 1);
  tables(wEast, m.bays[1], -1);
  // Retour : face ouest sur le parvis, bout sur l'avenue (mêmes tables) ; face est (photo du parking en gravier) : une porte, deux grandes
  // baies, trois petites.
  tables(rWest, Math.max(1, Math.round(rWest.len / 3.6)), -1);
  tables(rSouth, 2, -1);
  const eastBays: [number, number, number, boolean][] = [[0.07, 1.1, zArch, true], [0.22, 1.5, zArch, false], [0.37, 1.5, zArch, false],
    [0.53, 1.1, zArch - 0.5, false], [0.68, 1.1, zArch - 0.5, false], [0.83, 1.1, zArch - 0.5, false]];
  for (const [fr, wd, z1, door] of eastBays) {
    const u = rEast.len * fr;
    bay(rEast, u, wd, door ? zBase : zBase + 0.9, z1, true, door ? zBase + 2.2 : zBase + 1.6);
  }
  // Côté voies : portes et grandes fenêtres alternées tous les 3,5 m environ (vues des quais).
  for (const w of [bWest, bEast]) {
    const n = Math.max(1, Math.round(w.len / 3.5));
    for (let i = 0; i < n; i++) {
      const u = (w.len * (i + 0.5)) / n, door = i % 3 === 1;
      bay(w, u, door ? 1.2 : 1.4, zBase, zArch, true, door ? zBase + 2.2 : zBase + 1.0);
    }
  }
  // Pignon ouest : deux baies cintrées et le cartouche « AUTUN » ; le pignon est (au bout du corps, dans la face est) porte le même.
  for (const fr of [0.27, 0.73]) bay(gWest, gWest.len * fr, 1.3, zBase, zArch, true, zBase + 1.05);
  const cartouche = (w: PWall, u: number): void => {
    const zc = zTop - 0.55;
    d.plate(w, u - 0.95, u + 0.95, zc - 0.22, zc + 0.22, 0, 0.05, TRIM);
    const label = sinks.atlas.get("AUTUN", "#8a8270");
    const th = 0.3, tw = Math.min(1.7, th * 6.4);
    const [ax, ay] = at(f, ...d.on(w, u - tw / 2, 0.06)), [bx, by] = at(f, ...d.on(w, u + tw / 2, 0.06));
    sinks.names.quad(toThree(ax, ay, zc - th / 2), toThree(bx, by, zc - th / 2), toThree(bx, by, zc + th / 2), toThree(ax, ay, zc + th / 2), d.N(...w.out),
      [label.u0, label.v0], [label.u1, label.v0], [label.u1, label.v1], [label.u0, label.v1], new THREE.Color(1, 1, 1));
  };
  cartouche(gWest, gWest.len / 2);
  cartouche(rEast, rEast.len - D / 2);

  // Inscription sur le bandeau, au-dessus de la porte : panneau blanc, lettres bleu nuit.
  {
    const zs = (zBandLo + zBandHi) / 2, th = 0.3, tw = th * 6.4;
    d.plate(pFront, pw / 2 - 1.25, pw / 2 + 1.25, zs - 0.24, zs + 0.24, 0.12, 0.17, C("#f7f6f1"));
    const label = sinks.atlas.get("GARE D'AUTUN", "#22325a");
    const [ax, ay] = at(f, ...d.on(pFront, pw / 2 - tw / 2, 0.18)), [bx, by] = at(f, ...d.on(pFront, pw / 2 + tw / 2, 0.18));
    sinks.names.quad(toThree(ax, ay, zs - th / 2), toThree(bx, by, zs - th / 2), toThree(bx, by, zs + th / 2), toThree(ax, ay, zs + th / 2), d.N(0, -1),
      [label.u0, label.v0], [label.u1, label.v0], [label.u1, label.v1], [label.u0, label.v1], new THREE.Color(1, 1, 1));
  }

  // --- Toits ----------------------------------------------------------------------------------------------------------------------
  // Ailes et retour : croupes, noue à l'angle (le plus haut des deux toits), même pente.
  const kW = (ridge - eave) / (D / 2);
  const body: Piece = [[0, kW, eave], [0, -kW, eave + kW * D], [kW, 0, eave], [-kW, 0, eave + kW * L]];
  const wing: Piece = [[kW, 0, eave - kW * r0], [-kW, 0, eave + kW * L], [0, kW, eave - kW * rt], [0, -kW, eave + kW * D]];
  const o = OVERHANG;
  roofCell(d, rect(-o, r0 - o, -o, D + o), [body], tile);
  roofCell(d, rect(r0 - o, L + o, -o, D + o), [body, wing], tile);
  roofCell(d, rect(r0 - o, L + o, rt - o, -o), [wing], tile);
  // Chéneau de zinc au bord des toits bas.
  const zEdge = eave - kW * o;
  const rim: ST[] = [[-o, -o], [r0 - o, -o], [r0 - o, rt - o], [L + o, rt - o], [L + o, D + o], [-o, D + o]];
  for (let i = 0; i < rim.length; i++) {
    const a = rim[i]!, b = rim[(i + 1) % rim.length]!, len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const n = d.N((b[1] - a[1]) / len, -(b[0] - a[0]) / len);
    d.mb.quad(d.P(...a, zEdge - 0.22), d.P(...b, zEdge - 0.22), d.P(...b, zEdge + 0.02), d.P(...a, zEdge + 0.02), n, ZINC);
  }
  // Sous-face du débord (vue d'en bas, du quai et du parvis).
  for (let i = 0; i < rim.length; i++) {
    const a = rim[i]!, b = rim[(i + 1) % rim.length]!, len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const ox = (b[1] - a[1]) / len, oy = -(b[0] - a[0]) / len;
    const a1: ST = [a[0] - ox * o, a[1] - oy * o], b1: ST = [b[0] - ox * o, b[1] - oy * o];
    d.mb.quad(d.P(...a, zEdge - 0.22), d.P(...b, zEdge - 0.22), d.P(...b1, eave - 0.2), d.P(...a1, eave - 0.2), [0, -1, 0], shade(RENDER, 0.8));
  }

  // Pavillon : croupes, frontons sur les deux faces (le toit du fronton meurt dans les croupes).
  const v = PAV_OVER, ps0 = p0 - v, ps1 = p1 + v, pt0 = q0 - v, pt1 = q1 + v;
  const kT = (zRidge - zCorn) / ((pt1 - pt0) / 2), kS0 = (zRidge - zCorn) / Math.max(0.5, rs0 - ps0), kS1 = (zRidge - zCorn) / Math.max(0.5, ps1 - rs1);
  const hip: Piece = [[0, kT, zCorn - kT * pt0], [0, -kT, zCorn + kT * pt1], [kS0, 0, zCorn - kS0 * ps0], [-kS1, 0, zCorn + kS1 * ps1]];
  const kP = (zPed - zCorn) / hw;
  const gable: Piece = [[kP, 0, zPed - kP * pm], [-kP, 0, zPed + kP * pm]];
  roofCell(d, rect(ps0, pm - hw, pt0, pt1), [hip], tile);
  roofCell(d, rect(pm - hw, pm + hw, pt0, pt1), [hip, gable], tile);
  roofCell(d, rect(pm + hw, ps1, pt0, pt1), [hip], tile);
  // Frontons : tympan de pierre, corniches rampantes, horloge sur le parvis, œil-de-bœuf côté voies.
  for (const [t, dir] of [[q0, -1], [q1, 1]] as const) {
    const n = d.N(0, dir);
    sinks.solid.tri(d.P(pm - hw, t, zCorn), d.P(pm + hw, t, zCorn), d.P(pm, t, zPed), n, STONE);
    for (const side of [-1, 1]) {
      const a: ST = [pm + side * (hw + 0.2), t + dir * 0.3], b: ST = [pm, t + dir * 0.3];
      const za = zCorn - 0.05, zb = zPed + 0.12;
      sinks.solid.quad(d.P(...a, za - 0.3), d.P(...b, zb - 0.3), d.P(...b, zb), d.P(...a, za), n, TRIM);
      const ai: ST = [a[0], t], bi: ST = [b[0], t];
      sinks.solid.quad(d.P(...a, za), d.P(...b, zb), d.P(...bi, zb), d.P(...ai, za), up(d.P(...a, za), d.P(...b, zb), d.P(...bi, zb)), shade(TRIM, 1.03));
      sinks.solid.quad(d.P(...a, za - 0.3), d.P(...b, zb - 0.3), d.P(...bi, zb - 0.3), d.P(...ai, za - 0.3), [0, -1, 0], shade(TRIM, 0.8));
    }
    const w = dir < 0 ? pFront : pBack, u = dir < 0 ? pm - p0 : p1 - pm;
    const zc = zCorn + (zPed - zCorn) * 0.4, r = Math.min(0.75, (zPed - zCorn) * 0.32);
    d.oval(w, u, zc, r + 0.14, r + 0.14, 0.05, shade(TRIM, 0.95), 18);
    if (dir < 0) {
      d.oval(w, u, zc, r, r, 0.08, C("#f4f1e6"), 18);
      d.oval(w, u, zc, r * 0.9, r * 0.9, 0.085, C("#30425e"), 18);
      d.oval(w, u, zc, r * 0.82, r * 0.82, 0.09, C("#f4f1e6"), 18);
      // Aiguilles : petite vers 10 h, grande vers 2 h (l'heure de la photo).
      for (const [ang, len, wd] of [[Math.PI * 0.83, 0.45, 0.05], [Math.PI * 0.17, 0.68, 0.035]] as const) {
        const tip: [number, number] = [Math.cos(ang) * r * len, Math.sin(ang) * r * len];
        const nx = -Math.sin(ang) * wd, nz = Math.cos(ang) * wd;
        const p = (du: number, dz: number): Vec3 => d.P(...d.on(w, u + du, 0.1), zc + dz);
        sinks.solid.quad(p(nx, nz), p(-nx, -nz), p(tip[0] - nx, tip[1] - nz), p(tip[0] + nx, tip[1] + nz), d.N(...w.out), IRON);
      }
    } else {
      d.oval(w, u, zc, r * 0.8, r * 0.8, 0.08, C(T.glass[0]), 18);
    }
  }
  // Épis aux bouts du faîtage, souches de cheminée de brique sur les croupes.
  for (const s of [rs0, rs1]) {
    const tm = (pt0 + pt1) / 2;
    d.bar([s, tm, zRidge], [s, tm, zRidge + 0.9], 0.05, C("#b5533c"));
    d.bar([s, tm, zRidge + 0.5], [s, tm, zRidge + 0.75], 0.11, C("#b5533c"));
  }
  for (const [s, t] of [[p0 + 1.3, q0 + (q1 - q0) * 0.42], [p0 + 1.3, q0 + (q1 - q0) * 0.58], [p1 - 1.3, q0 + (q1 - q0) * 0.5]] as const) {
    const zr = Math.min(...hip.map((pl) => zOf(pl, s, t)));
    box(d, s - 0.3, s + 0.3, t - 0.35, t + 0.35, zr - 0.5, zRidge + 1.1, BRICK);
    box(d, s - 0.36, s + 0.36, t - 0.41, t + 0.41, zRidge + 1.1, zRidge + 1.25, shade(BRICK, 0.85));
  }
}

/** Pavé (s0..s1, t0..t1, z0..z1) aux faces verticales et au dessus. */
function box(d: Draw, s0: number, s1: number, t0: number, t1: number, z0: number, z1: number, col: THREE.Color): void {
  const q = rect(s0, s1, t0, t1);
  for (let i = 0; i < 4; i++) {
    const a = q[i]!, b = q[(i + 1) % 4]!, len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    d.mb.quad(d.P(...a, z0), d.P(...b, z0), d.P(...b, z1), d.P(...a, z1), d.N((b[1] - a[1]) / len, -(b[0] - a[0]) / len), shade(col, i % 2 ? 0.92 : 1));
  }
  d.mb.quad(d.P(s0, t0, z1), d.P(s1, t0, z1), d.P(s1, t1, z1), d.P(s0, t1, z1), [0, 1, 0], shade(col, 1.05));
}
