import * as THREE from "three";
import type { ChapelModel, HeightField, Site } from "../data/types";
import { at, frameOf, gateLayout, gateTop, type Frame, type Opening } from "../core/landmarks";
import { MeshBuilder, toThree, type Vec3 } from "./geometry";

/**
 * Portes romaines d'Autun d'après photo (D137 ; modèle par défaut de D95), à pans nets : corps percé des arches (passages voûtés sur toute
 * l'épaisseur), archivoltes à claveaux en relief, impostes, corniche, attique, galerie à arcades sur pilastres à chapiteaux, entablement,
 * bloc sommital, dessus ruiné en gradins, blocage de moellons là où le parement est perdu, assises. La nuit, chaque pan est doublé dans le
 * maillage éclairé en dégradé chaud du pied vers le haut (projecteurs au sol, photo de nuit de la porte d'Arroux).
 */

const C = (hex: string): THREE.Color => new THREE.Color(hex);
const shade = (c: THREE.Color, k: number): THREE.Color => c.clone().multiplyScalar(k);
/** Calcaire gris clair des portes (photos). */
const ARROUX_STONE = C("#cdc6b5");
/** Blocage de moellons ocre-brun (parement perdu). */
const RUBBLE = C("#a5845f");
/** Tour de moellons bruns de la porte Saint-André (photos), tuiles de son chapeau et du toit de la galerie. */
const TOWER = C("#8f7a63"), TILES = C("#b4613d");
const JOINT = 0.06;
const FLOOD_LOW = C("#ffcf86"), FLOOD_HIGH = C("#b98a58");

type S3 = [number, number, number];

class GateDraw {
  constructor(readonly mb: MeshBuilder, readonly glow: MeshBuilder | null, readonly f: Frame, readonly g: number, readonly span: number) {}

  P(s: number, t: number, z: number): Vec3 {
    const [x, y] = at(this.f, s, t);
    return toThree(x, y, z);
  }

  /** Normale horizontale (us le long de s, vt le long de t), ou verticale. */
  N(us: number, vt: number, up = 0): Vec3 {
    const f = this.f;
    return toThree(f.ux * us + f.vx * vt, f.uy * us + f.vy * vt, up);
  }

  flood(z: number, k: number): THREE.Color {
    const v = Math.min(1, Math.max(0, (z - this.g) / this.span));
    return FLOOD_LOW.clone().lerp(FLOOD_HIGH, Math.sqrt(v)).multiplyScalar(k);
  }

  /** Quad (a, b en bas, c, d en haut), et son double éclairé la nuit (la teinte de la pierre module la lumière). */
  quad(a: S3, b: S3, c: S3, d: S3, n: Vec3, col: THREE.Color): void {
    this.mb.quad(this.P(...a), this.P(...b), this.P(...c), this.P(...d), n, col);
    if (!this.glow) return;
    const k = 0.55 + 0.45 * Math.min(1.15, (col.r + col.g + col.b) / (ARROUX_STONE.r + ARROUX_STONE.g + ARROUX_STONE.b));
    this.glow.quadGradient(this.P(...a), this.P(...b), this.P(...c), this.P(...d), n, this.flood((a[2] + b[2]) / 2, k), this.flood((c[2] + d[2]) / 2, k));
  }

  /** Pavé : s0..s1, t0..t1, z0..z1 (quatre côtés et dessus). */
  box(s0: number, s1: number, t0: number, t1: number, z0: number, z1: number, col: THREE.Color, top: THREE.Color = shade(col, 1.06)): void {
    this.quad([s0, t0, z0], [s1, t0, z0], [s1, t0, z1], [s0, t0, z1], this.N(0, -1), col);
    this.quad([s1, t1, z0], [s0, t1, z0], [s0, t1, z1], [s1, t1, z1], this.N(0, 1), col);
    this.quad([s0, t1, z0], [s0, t0, z0], [s0, t0, z1], [s0, t1, z1], this.N(-1, 0), shade(col, 0.92));
    this.quad([s1, t0, z0], [s1, t1, z0], [s1, t1, z1], [s1, t0, z1], this.N(1, 0), shade(col, 0.92));
    this.quad([s0, t0, z1], [s1, t0, z1], [s1, t1, z1], [s0, t1, z1], [0, 1, 0], top);
  }
}

/** Haut de l'ouverture en s (arc en plein cintre au-dessus de la naissance), ou null hors de l'ouverture. */
function openingTop(o: Opening, s: number): number | null {
  if (s <= o.s0 || s >= o.s1) return null;
  const r = (o.s1 - o.s0) / 2, c = (o.s0 + o.s1) / 2;
  return o.spring + Math.sqrt(Math.max(0, r * r - (s - c) ** 2));
}

/** Colonnes [s0, s1] entre les coupes ; celles qui tombent dans une ouverture sont redivisées tous les 25 cm (arcs). */
function columns(cuts: number[], arcs: Opening[]): [number, number][] {
  const e = [...new Set(cuts.map((v) => Math.round(v * 1000) / 1000))].sort((a, b) => a - b);
  const out: [number, number][] = [];
  for (let i = 0; i + 1 < e.length; i++) {
    const a = e[i]!, b = e[i + 1]!;
    if (b - a < 1e-3) continue;
    const m = (a + b) / 2;
    const n = arcs.some((o) => m > o.s0 && m < o.s1) ? Math.max(1, Math.ceil((b - a) / 0.25)) : 1;
    for (let k = 0; k < n; k++) out.push([a + ((b - a) * k) / n, a + ((b - a) * (k + 1)) / n]);
  }
  return out;
}

/** Bandes de couleur d'un pan vertical entre `lo` et `hi` (altitudes aux deux bords), découpées aux limites des zones de blocage. */
function bands(d: GateDraw, s0: number, s1: number, t: number, n: Vec3, lo: [number, number], hi: [number, number], zones: [number, number][], col: THREE.Color, rub: THREE.Color): void {
  const cuts = [-Infinity, ...zones.flat(), Infinity].sort((a, b) => a - b);
  for (let i = 0; i + 1 < cuts.length; i++) {
    const h0 = cuts[i]!, h1 = cuts[i + 1]!;
    const mid = h0 === -Infinity ? h1 - 1 : h1 === Infinity ? h0 + 1 : (h0 + h1) / 2;
    const inRub = zones.some(([a, b]) => mid > a && mid < b);
    const cl = (h: number, k: 0 | 1): number => Math.min(Math.max(h, lo[k]), hi[k]);
    const a0 = cl(h0, 0), b0 = cl(h0, 1), a1 = cl(h1, 0), b1 = cl(h1, 1);
    if (a1 - a0 < 1e-3 && b1 - b0 < 1e-3) continue;
    const c = inRub ? rub : col;
    d.quad([s0, t, a0], [s1, t, b0], [s1, t, b1], [s0, t, a1], n, c);
  }
}

/**
 * Porte romaine : `glow` reçoit l'éclairage de nuit (modèle `light`), sinon null. Les obstacles (piles) sont dans `landmarkRings`.
 */
export function buildGate(mb: MeshBuilder, glow: MeshBuilder | null, site: Extract<Site, { t: "gate" }>, terrain: HeightField): void {
  const lay = gateLayout(site, terrain.heightAt(site.x, site.y));
  const { frame: f, m, g } = lay;
  const hw = f.hw, hl = f.hl;
  const d = new GateDraw(mb, m.light ? glow : null, f, g, lay.height * 1.1);
  const Z = (h: number): number => g + h;
  const foot = (s: number, t: number): number => { const [x, y] = at(f, s, t); return terrain.heightAt(x, y) - 0.4; };
  const top = (s: number): number => Z(gateTop(m, s));
  const ASHLAR = m.stone ? C(m.stone) : ARROUX_STONE;
  const inner = shade(ASHLAR, 0.72);
  const ground = lay.openings.filter((o) => o.zb < 0);
  const arcades = lay.openings.filter((o) => o.zb >= 0);
  const rubbleAt = (s: number): [number, number][] => m.rubble.filter(([a, b]) => s > a && s < b).map(([, , z0, z1]) => [Z(z0), Z(z1)]);

  // --- Corps : faces, intrados des passages, dessus -----------------------------------------------------------------------------------
  const cuts = [-hl, hl, ...ground.flatMap((o) => [o.s0, o.s1]), ...m.top.map((p) => p[0]), ...m.rubble.flatMap((r) => [r[0], r[1]])].filter((v) => v >= -hl && v <= hl);
  const cols = columns(cuts, ground);
  for (const [s0, s1] of cols) {
    const sm = (s0 + s1) / 2, ta = top(s0 + 1e-4), tb = top(s1 - 1e-4);
    const hole = ground.find((o) => sm > o.s0 && sm < o.s1);
    const zones = rubbleAt(sm);
    for (const side of [1, -1]) {
      const t = side * hw;
      let lo: [number, number] = [foot(s0, t), foot(s1, t)];
      if (hole) lo = [Z(openingTop(hole, s0) ?? hole.spring), Z(openingTop(hole, s1) ?? hole.spring)];
      if (ta - lo[0] < 1e-3 && tb - lo[1] < 1e-3) continue;
      bands(d, s0, s1, t, d.N(0, side), lo, [ta, tb], zones, ASHLAR, RUBBLE);
    }
    if (hole) {
      const za = Z(openingTop(hole, s0) ?? hole.spring), zb = Z(openingTop(hole, s1) ?? hole.spring);
      d.quad([s0, hw, za], [s1, hw, zb], [s1, -hw, zb], [s0, -hw, za], [0, -1, 0], inner);
    }
    const broken = gateTop(m, sm) < m.attic - 0.05 || zones.some(([, z1]) => z1 >= Z(gateTop(m, sm)) - 0.05);
    d.quad([s0, -hw, ta], [s1, -hw, tb], [s1, hw, tb], [s0, hw, ta], [0, 1, 0], broken ? shade(RUBBLE, 1.08) : shade(ASHLAR, 1.06));
  }
  // Piédroits des passages, du sol à la naissance.
  for (const o of ground) {
    for (const [s, dir] of [[o.s0, 1], [o.s1, -1]] as const) {
      const za = foot(s, -hw), zb = foot(s, hw);
      d.quad(dir > 0 ? [s, -hw, za] : [s, hw, zb], dir > 0 ? [s, hw, zb] : [s, -hw, za], dir > 0 ? [s, hw, Z(o.spring)] : [s, -hw, Z(o.spring)], dir > 0 ? [s, -hw, Z(o.spring)] : [s, hw, Z(o.spring)], d.N(dir, 0), inner);
    }
  }
  // Marches du profil ruiné et bouts.
  for (let i = 0; i + 1 < m.top.length; i++) {
    const [sa, za] = m.top[i]!, [sb, zb] = m.top[i + 1]!;
    if (Math.abs(sb - sa) > 1e-6 || Math.abs(zb - za) < 1e-3) continue;
    const dir = zb < za ? 1 : -1, z0 = Z(Math.min(za, zb)), z1 = Z(Math.max(za, zb));
    const col = shade(RUBBLE, 0.92);
    if (dir > 0) d.quad([sa, -hw, z0], [sa, hw, z0], [sa, hw, z1], [sa, -hw, z1], d.N(1, 0), col);
    else d.quad([sa, hw, z0], [sa, -hw, z0], [sa, -hw, z1], [sa, hw, z1], d.N(-1, 0), col);
  }
  for (const side of [1, -1]) {
    const s = side * hl, z1 = top(s - side * 1e-4);
    const za = foot(s, side * hw), zb = foot(s, -side * hw);
    d.quad([s, side * hw, za], [s, -side * hw, zb], [s, -side * hw, z1], [s, side * hw, z1], d.N(side, 0), shade(ASHLAR, 0.9));
  }

  // --- Assises : joints sombres du grand appareil (tous les 62 cm) et lits des moellons (tous les 45 cm), en bandes continues ---------
  const joints = (s0: number, s1: number, z: number, rubble: boolean): boolean => {
    const sm = (s0 + s1) / 2;
    if (Math.min(top(s0 + 1e-4), top(s1 - 1e-4)) < z + JOINT + 0.05) return false;
    const hole = ground.find((o) => sm > o.s0 - 0.02 && sm < o.s1 + 0.02);
    if (hole && Z(hole.spring + (hole.s1 - hole.s0) / 2 + m.band) > z - 0.05) return false;
    if (rubble !== rubbleAt(sm).some(([a, b]) => z > a && z < b)) return false;
    return Math.min(foot(s0, hw), foot(s0, -hw)) < z - 0.2;
  };
  const lines: [number, boolean][] = [];
  for (let h = 0.62; h < lay.height; h += 0.62) lines.push([Z(h), false]);
  for (const [, , z0, z1] of m.rubble) for (let h = z0 + 0.45; h < z1 - 0.1; h += 0.45) lines.push([Z(h), true]);
  for (const [z, rubble] of lines) {
    let run: number | null = null;
    const flush = (end: number): void => {
      if (run === null) return;
      for (const side of [1, -1]) {
        const t = side * (hw + 0.01);
        const col = rubble ? shade(RUBBLE, 0.72) : shade(ASHLAR, 0.86);
        if (side > 0) d.quad([end, t, z], [run, t, z], [run, t, z + JOINT], [end, t, z + JOINT], d.N(0, 1), col);
        else d.quad([run, t, z], [end, t, z], [end, t, z + JOINT], [run, t, z + JOINT], d.N(0, -1), col);
      }
      run = null;
    };
    for (const [s0, s1] of cols) {
      if (joints(s0, s1, z, rubble)) run ??= s0;
      else flush(s0);
      if (run !== null && s1 >= hl - 1e-6) flush(s1);
    }
  }

  // --- Archivoltes (claveaux en relief, nuancés un sur deux) et impostes ----------------------------------------------------------------
  for (const o of ground) {
    const r0 = (o.s1 - o.s0) / 2, r1 = r0 + m.band, cs = (o.s0 + o.s1) / 2, zc = Z(o.spring);
    const n = r0 > 1.2 ? 11 : 7, e = 0.1;
    for (const side of [1, -1]) {
      const tf = side * hw, to = side * (hw + e);
      for (let j = 0; j < n; j++) {
        const a0 = (Math.PI * j) / n, a1 = (Math.PI * (j + 1)) / n, am = (a0 + a1) / 2;
        const pt = (r: number, a: number, t: number): S3 => [cs + Math.cos(a) * r, t, zc + Math.sin(a) * r];
        const col = shade(ASHLAR, j % 2 ? 0.95 : 1.03);
        if (Math.min(gateTop(m, cs + Math.cos(am) * r1), lay.height) < o.spring + Math.sin(am) * r1 - 0.05) continue;
        if (side > 0) d.quad(pt(r0, a1, to), pt(r0, a0, to), pt(r1, a0, to), pt(r1, a1, to), d.N(0, 1), col);
        else d.quad(pt(r0, a0, to), pt(r0, a1, to), pt(r1, a1, to), pt(r1, a0, to), d.N(0, -1), col);
        const ro = d.N(Math.cos(am), 0, Math.sin(am)), ri = d.N(-Math.cos(am), 0, -Math.sin(am));
        d.quad(pt(r1, a0, tf), pt(r1, a1, tf), pt(r1, a1, to), pt(r1, a0, to), ro, shade(col, 0.9));
        d.quad(pt(r0, a1, tf), pt(r0, a0, tf), pt(r0, a0, to), pt(r0, a1, to), ri, shade(col, 0.8));
      }
      for (const [a, b] of [[o.s0 - 0.35, o.s0], [o.s1, o.s1 + 0.35]] as const) {
        d.box(a, b, side > 0 ? hw : -hw - 0.14, side > 0 ? hw + 0.14 : -hw, zc - 0.28, zc, shade(ASHLAR, 1.04));
      }
    }
  }

  // --- Corniche au-dessus des arches (interrompue là où le parement est perdu) ---------------------------------------------------------
  const [c0, c1] = m.cornice;
  let cr: number | null = null;
  const corn = (end: number): void => {
    if (cr !== null && end - cr > 0.3) d.box(cr, end, -hw - 0.22, hw + 0.22, Z(c0), Z(c1), shade(ASHLAR, 1.05));
    cr = null;
  };
  for (const [s0, s1] of cols) {
    const sm = (s0 + s1) / 2;
    const ok = gateTop(m, sm) >= c1 && !m.rubble.some(([a, b, z0, z1]) => sm > a && sm < b && z0 < c1 && z1 > c0);
    if (ok) cr ??= s0;
    else corn(s0);
    if (s1 >= hl - 1e-6) corn(s1);
  }

  // --- Galerie : un mur à arcades sur une face (Arroux) ou sur chaque face, couloir entre les deux sous le toit (Saint-André) -----------
  const gal = lay.gallery;
  if (gal) {
    const [e0, e1] = m.gal.ent;
    const gcols = columns([gal.s0, gal.s1, ...arcades.flatMap((o) => [o.s0, o.s1])], arcades);
    const outer = (gt0: number, gt1: number): number[] => (gal.walls.length === 1 ? [1, -1] : [gt0 + gt1 > 0 ? 1 : -1]);
    for (const [gt0, gt1] of gal.walls) {
      for (const [s0, s1] of gcols) {
        const sm = (s0 + s1) / 2;
        const hole = arcades.find((o) => sm > o.s0 && sm < o.s1);
        const lo: [number, number] = hole ? [Z(openingTop(hole, s0) ?? hole.spring), Z(openingTop(hole, s1) ?? hole.spring)] : [Z(m.attic), Z(m.attic)];
        for (const [t, side] of [[gt1, 1], [gt0, -1]] as const) d.quad([s0, t, lo[0]], [s1, t, lo[1]], [s1, t, Z(e0)], [s0, t, Z(e0)], d.N(0, side), ASHLAR);
        if (hole) d.quad([s0, gt1, lo[0]], [s1, gt1, lo[1]], [s1, gt0, lo[1]], [s0, gt0, lo[0]], [0, -1, 0], inner);
      }
      for (const o of arcades) {
        for (const [s, dir] of [[o.s0, 1], [o.s1, -1]] as const) {
          d.quad([s, gt0, Z(m.attic)], [s, gt1, Z(m.attic)], [s, gt1, Z(o.spring)], [s, gt0, Z(o.spring)], d.N(dir, 0), inner);
        }
      }
      // Pilastres à base et chapiteau, sur la face extérieure (les deux faces d'un mur seul).
      for (const s of gal.pilasters) {
        for (const side of outer(gt0, gt1)) {
          const t = side > 0 ? gt1 : gt0;
          const span = (a: number): [number, number] => (side > 0 ? [t, t + a] : [t - a, t]);
          d.box(s - 0.24, s + 0.24, ...span(0.1), Z(m.attic), Z(e0 - 0.35), shade(ASHLAR, 1.03));
          d.box(s - 0.3, s + 0.3, ...span(0.14), Z(m.attic), Z(m.attic + 0.25), shade(ASHLAR, 0.98));
          d.box(s - 0.34, s + 0.34, ...span(0.18), Z(e0 - 0.35), Z(e0), shade(ASHLAR, 1.08));
        }
      }
      d.box(gal.s0 - 0.12, gal.s1 + 0.12, gt0 - (outer(gt0, gt1).includes(-1) ? 0.15 : 0), gt1 + (outer(gt0, gt1).includes(1) ? 0.15 : 0), Z(e0), Z(e1), shade(ASHLAR, 1.04));
    }
    // Bouts de la galerie : murs pleins sur toute l'épaisseur des murs (et du couloir).
    const tA = gal.walls[0]![0], tB = gal.walls[gal.walls.length - 1]![1];
    for (const [s, dir] of [[gal.s0, -1], [gal.s1, 1]] as const) {
      d.quad([s, tA, Z(m.attic)], [s, tB, Z(m.attic)], [s, tB, Z(e0)], [s, tA, Z(e0)], d.N(dir, 0), shade(ASHLAR, 0.9));
    }
    if (m.block) d.box(m.block[0], m.block[1], tA, tB, Z(e1), Z(m.block[2]), ASHLAR);
  }

  // --- Toit de tuiles à croupes (Saint-André) : de la tour (ou du bout) à l'autre bout, débord de 30 cm ------------------------------------
  if (m.roof) {
    const [ze, zr] = [Z(m.roof[0]), Z(m.roof[1])];
    let r0 = -hl - 0.3, r1 = hl + 0.3;
    if (m.tower) {
      if (m.tower[0] <= -hl + 0.01) r0 = m.tower[1];
      else r1 = m.tower[0];
    }
    const T = hw + 0.3, k = (zr - ze) / T;
    const a0 = Math.min(r0 + T, (r0 + r1) / 2), a1 = Math.max(r1 - T, (r0 + r1) / 2);
    const nl = Math.hypot(1, k);
    for (const side of [1, -1]) {
      d.quad([r0, side * T, ze], [r1, side * T, ze], [a1, 0, zr], [a0, 0, zr], d.N(0, side / nl, 1 / nl), shade(TILES, side > 0 ? 1 : 0.9));
    }
    for (const [s, a, dir] of [[r0, a0, -1], [r1, a1, 1]] as const) {
      const n = d.N(dir / nl, 0, 1 / nl);
      d.mb.tri(d.P(s, -T, ze), d.P(s, T, ze), d.P(a, 0, zr), n, shade(TILES, 0.95));
      if (d.glow) d.glow.tri(d.P(s, -T, ze), d.P(s, T, ze), d.P(a, 0, zr), n, d.flood(ze, 0.5));
    }
    d.quad([r0, -T, ze - 0.12], [r1, -T, ze - 0.12], [r1, T, ze - 0.12], [r0, T, ze - 0.12], [0, -1, 0], shade(TILES, 0.55));
  }

  // --- Tour de moellons à un bout, chapeau de tuiles (Saint-André) --------------------------------------------------------------------
  if (m.tower) {
    const [s0, s1, t0, t1, zt] = m.tower;
    const zb = Math.min(foot(s0, t0), foot(s1, t0), foot(s0, t1), foot(s1, t1));
    d.box(s0, s1, t0, t1, zb, Z(zt), TOWER, shade(TOWER, 1.1));
    for (let h = 0.45; h < zt - 0.2; h += 0.45) {
      const z = Z(h);
      if (z < zb + 0.6) continue;
      const jc = shade(TOWER, 0.75);
      d.quad([s0, t0 - 0.01, z], [s1, t0 - 0.01, z], [s1, t0 - 0.01, z + JOINT], [s0, t0 - 0.01, z + JOINT], d.N(0, -1), jc);
      d.quad([s0, t1 + 0.01, z], [s1, t1 + 0.01, z], [s1, t1 + 0.01, z + JOINT], [s0, t1 + 0.01, z + JOINT], d.N(0, 1), jc);
      const se = s0 <= -hl + 0.01 ? s0 - 0.01 : s1 + 0.01;
      d.quad([se, t0, z], [se, t1, z], [se, t1, z + JOINT], [se, t0, z + JOINT], d.N(se < 0 ? -1 : 1, 0), jc);
    }
    const cs = (s0 + s1) / 2, ct = (t0 + t1) / 2, apex = d.P(cs, ct, Z(zt) + 0.6);
    const corners: [number, number][] = [[s0 - 0.15, t0 - 0.15], [s1 + 0.15, t0 - 0.15], [s1 + 0.15, t1 + 0.15], [s0 - 0.15, t1 + 0.15]];
    for (let i = 0; i < 4; i++) {
      const [pa, pb] = [corners[i]!, corners[(i + 1) % 4]!];
      const mx = (pa[0] + pb[0]) / 2 - cs, my = (pa[1] + pb[1]) / 2 - ct, ml = Math.hypot(mx, my);
      const n = d.N(mx / ml, my / ml, 1.5);
      d.mb.tri(d.P(pa[0], pa[1], Z(zt)), d.P(pb[0], pb[1], Z(zt)), apex, n, shade(TILES, 0.9 + (i % 2) * 0.1));
      if (d.glow) d.glow.tri(d.P(pa[0], pa[1], Z(zt)), d.P(pb[0], pb[1], Z(zt)), apex, n, d.flood(Z(zt), 0.5));
    }
  }
}

// --- Église Saint-André (D138) ------------------------------------------------------------------------------------------------------

const CH_WALL = C("#cbab86"), CH_BRICK = C("#b07a5c"), CH_ROUND = C("#a28d74"), CH_DOOR = C("#e6e0d4"), CH_BAY = C("#2b2f3a"), CH_SILL = C("#dacfb8");

/**
 * Église accolée à la porte Saint-André, d'après photo et mesures : nef à pignons en moellons à lits de brique, toit de tuiles à deux
 * pans, tour ronde de moellons à toit conique, porte claire au pignon d'entrée, baies hautes en plein cintre. Éclairée la nuit comme la porte.
 */
export function buildChapel(mb: MeshBuilder, glow: MeshBuilder | null, m: ChapelModel, terrain: HeightField): void {
  const f = frameOf(m.o[0], m.o[1], m.a, 1, 1);
  const d = new GateDraw(mb, m.light ? glow : null, f, m.g, m.ridge * 1.1);
  const Z = (h: number): number => m.g + h;
  const foot = (s: number, t: number): number => { const [x, y] = at(f, s, t); return terrain.heightAt(x, y) - 0.4; };
  const [s0, s1, t0, t1] = m.nave, sm = (s0 + s1) / 2;
  const [ze, zr] = [Z(m.eave), Z(m.ridge)];
  // Murs de la nef, en pans de 4 m au plus pour suivre le sol ; lits de brique tous les 1,1 m.
  const wall = (a: [number, number], b: [number, number], n: [number, number]): void => {
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]), k = Math.max(1, Math.ceil(len / 4));
    let low = Infinity;
    for (let i = 0; i < k; i++) {
      const p = (j: number): [number, number] => [a[0] + ((b[0] - a[0]) * j) / k, a[1] + ((b[1] - a[1]) * j) / k];
      const [pa, pb] = [p(i), p(i + 1)];
      d.quad([pa[0], pa[1], foot(...pa)], [pb[0], pb[1], foot(...pb)], [pb[0], pb[1], ze], [pa[0], pa[1], ze], d.N(n[0], n[1]), CH_WALL);
      low = Math.min(low, foot(...pa), foot(...pb));
    }
    const o: [number, number] = [n[0] * 0.01, n[1] * 0.01];
    for (let z = Math.ceil((low + 0.8 - m.g) / 1.1) * 1.1 + m.g; z < ze - 0.3; z += 1.1) {
      d.quad([a[0] + o[0], a[1] + o[1], z], [b[0] + o[0], b[1] + o[1], z], [b[0] + o[0], b[1] + o[1], z + 0.07], [a[0] + o[0], a[1] + o[1], z + 0.07], d.N(n[0], n[1]), CH_BRICK);
    }
  };
  wall([s0, t1], [s0, t0], [-1, 0]);
  wall([s1, t0], [s1, t1], [1, 0]);
  wall([s0, t1], [s1, t1], [0, 1]);
  wall([s1, t0], [s0, t0], [0, -1]);
  // Pignons et toit à deux pans (débord de 30 cm).
  for (const [t, dir] of [[t0, -1], [t1, 1]] as const) {
    const n = d.N(0, dir);
    d.mb.tri(d.P(s0, t, ze), d.P(s1, t, ze), d.P(sm, t, zr), n, CH_WALL);
    if (d.glow) d.glow.tri(d.P(s0, t, ze), d.P(s1, t, ze), d.P(sm, t, zr), n, d.flood(zr, 1));
  }
  const ov = 0.3, slope = (zr - ze) / ((s1 - s0) / 2), zo = ze - ov * slope, nl = Math.hypot(1, slope);
  for (const [se, dir] of [[s0 - ov, -1], [s1 + ov, 1]] as const) {
    d.quad([se, t0 - ov, zo], [se, t1 + ov, zo], [sm, t1 + ov, zr], [sm, t0 - ov, zr], d.N(dir * slope / nl, 0, 1 / nl), shade(TILES, dir > 0 ? 1 : 0.9));
    d.quad([se, t0 - ov, zo - 0.1], [se, t1 + ov, zo - 0.1], [se + (sm - se) * 0.25, t1 + ov, zo - 0.1 + (zr - zo) * 0.25], [se + (sm - se) * 0.25, t0 - ov, zo - 0.1 + (zr - zo) * 0.25], d.N(0, 0, -1), shade(TILES, 0.5));
  }
  // Tour ronde et toit conique.
  const [sc, tc, r, rez, rap] = m.round;
  const N = 18, ro = r + 0.25;
  for (let i = 0; i < N; i++) {
    const a0 = (2 * Math.PI * i) / N, a1 = (2 * Math.PI * (i + 1)) / N, am = (a0 + a1) / 2;
    const p = (a: number, rr: number): [number, number] => [sc + Math.cos(a) * rr, tc + Math.sin(a) * rr];
    const [pa, pb] = [p(a0, r), p(a1, r)];
    d.quad([pa[0], pa[1], foot(...pa)], [pb[0], pb[1], foot(...pb)], [pb[0], pb[1], Z(rez)], [pa[0], pa[1], Z(rez)], d.N(Math.cos(am), Math.sin(am)), shade(CH_ROUND, 0.94 + (i % 2) * 0.06));
    const [qa, qb] = [p(a0, ro), p(a1, ro)], k = (rap - rez) / ro, cl = Math.hypot(1, k);
    const n = d.N(Math.cos(am) * k / cl, Math.sin(am) * k / cl, 1 / cl);
    const zo2 = Z(rez) - 0.25 * k;
    d.mb.tri(d.P(qa[0], qa[1], zo2), d.P(qb[0], qb[1], zo2), d.P(sc, tc, Z(rap)), n, shade(TILES, 0.9 + (i % 2) * 0.08));
    if (d.glow) d.glow.tri(d.P(qa[0], qa[1], zo2), d.P(qb[0], qb[1], zo2), d.P(sc, tc, Z(rap)), n, d.flood(Z(rap), 0.5));
  }
  // Porte claire au pignon d'entrée et baies en plein cintre (encadrement de pierre claire).
  const [doff, dw, dh] = m.door, ds = sm + doff, df = foot(ds, t1) + 0.4;
  d.quad([ds - dw / 2 - 0.15, t1 + 0.02, df], [ds + dw / 2 + 0.15, t1 + 0.02, df], [ds + dw / 2 + 0.15, t1 + 0.02, df + dh + 0.2], [ds - dw / 2 - 0.15, t1 + 0.02, df + dh + 0.2], d.N(0, 1), CH_SILL);
  d.quad([ds - dw / 2, t1 + 0.04, df], [ds + dw / 2, t1 + 0.04, df], [ds + dw / 2, t1 + 0.04, df + dh], [ds - dw / 2, t1 + 0.04, df + dh], d.N(0, 1), CH_DOOR);
  for (const [side, dist, w, sill, h] of m.windows) {
    const s = side < 0 ? s0 : s1, t = t1 - dist;
    for (const [off, ww, col] of [[0.02, w + 0.3, CH_SILL], [0.04, w, CH_BAY]] as const) {
      const sp = s + side * off, zb = Z(sill) - (ww - w) / 2, zs = Z(sill + h) - w / 2, rr = ww / 2;
      d.quad([sp, t - rr, zb], [sp, t + rr, zb], [sp, t + rr, zs], [sp, t - rr, zs], d.N(side, 0), col);
      for (let i = 0; i < 6; i++) {
        const a0 = (Math.PI * i) / 6, a1 = (Math.PI * (i + 1)) / 6;
        const n = d.N(side, 0);
        d.mb.tri(d.P(sp, t, zs), d.P(sp, t + Math.cos(a0) * rr, zs + Math.sin(a0) * rr), d.P(sp, t + Math.cos(a1) * rr, zs + Math.sin(a1) * rr), n, col);
      }
    }
  }
}
