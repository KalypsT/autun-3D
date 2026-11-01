import * as THREE from "three";
import type { HeightField, VallonFace, VallonModel, VallonSide } from "../data/types";
import { toThree } from "./geometry";
import { Draw, type Frame } from "./hexagone-facade";
import type { LandmarkSinks } from "./landmarks";
import { rectCorners, vallonFrame, VALLON_PARAPET, type VallonFrame } from "./vallon";

/**
 * Façades du collège du Vallon (D173, lot 2 de docs/plans/college-vallon.md), d'après les photos 3 (cour ouest) et 8 (cour est) :
 * béton clair à bandes de fenêtres et lignes d'étage (barre de quatre niveaux, blocs de deux niveaux), mur-rideau à panneaux bleu-vert sur les deux grandes faces
 * de l'aile ouest (dont la façade d'entrée, à l'ouest), mur aveugle à joints au bout du bloc nord, bardage bleu-gris du noyau d'escalier, escalier extérieur
 * en béton à l'est de la barre, bande verticale orangée et caméra sur la face ouest de la barre.
 */

const C = (hex: string): THREE.Color => new THREE.Color(hex);
const shade = (c: THREE.Color, k: number): THREE.Color => c.clone().multiplyScalar(k);

export const SIDES: VallonSide[] = ["s", "e", "n", "w"];
const COL = {
  line: C("#e3dccb"), sill: C("#cfc7b3"), glass: C("#46606b"), panel: C("#4f9c9a"), clad: C("#6f8296"), orange: C("#d98b4f"), stair: C("#cdc6b4"),
  frame: C("#e9e6dc"), joint: C("#b9b19f"), dark: C("#2b2f31"), steel: C("#4a5560"),
};
/** Hauteur d'étage visée des bandes de fenêtres (m). */
const FLOOR = 3.5;

export interface FaceGeom {
  frame: Frame;
  /** Longueur de la face (m). */
  len: number;
}

/** Repère d'une face d'aile : t vers l'extérieur, s vers la droite vu de l'extérieur, origine au début de la face. */
export function faceGeom(f: VallonFrame, r: [number, number, number, number], side: VallonSide): FaceGeom {
  const o0 = f.pt(0, 0), ux = f.pt(1, 0)[0] - o0[0], uy = f.pt(1, 0)[1] - o0[1], vx = f.pt(0, 1)[0] - o0[0], vy = f.pt(0, 1)[1] - o0[1];
  const [u0, u1, v0, v1] = r;
  const spec: Record<VallonSide, { o: [number, number]; n: [number, number]; len: number }> = {
    s: { o: f.pt(u0, v0), n: [-vx, -vy], len: u1 - u0 },
    e: { o: f.pt(u1, v0), n: [ux, uy], len: v1 - v0 },
    n: { o: f.pt(u1, v1), n: [vx, vy], len: u1 - u0 },
    w: { o: f.pt(u0, v1), n: [-ux, -uy], len: v1 - v0 },
  };
  const { o, n, len } = spec[side];
  const u: [number, number] = [-n[1], n[0]];
  return {
    len,
    frame: {
      n, u, o,
      pt: (s, t) => [o[0] + u[0] * s + n[0] * t, o[1] + u[1] * s + n[1] * t],
      st: (p) => [(p[0] - o[0]) * u[0] + (p[1] - o[1]) * u[1], (p[0] - o[0]) * n[0] + (p[1] - o[1]) * n[1]],
    },
  };
}

/** Intervalles d'une face cachés par un volume voisin collé contre elle : [s0, s1, altitude du dessus du voisin]. */
export function buriedParts(m: VallonModel, wingName: string, side: VallonSide): [number, number, number][] {
  const f = vallonFrame(m);
  const self = m.wings!.find((w) => w.n === wingName)!;
  const { frame, len } = faceGeom(f, self.r, side);
  const others: { r: [number, number, number, number]; z: number }[] = [...m.wings!.filter((w) => w.n !== wingName), ...(m.bury ?? [])];
  const out: [number, number, number][] = [];
  for (const x of others) {
    const st = rectCorners(f, x.r).map((p) => frame.st(p));
    const t0 = Math.min(...st.map((q) => q[1])), t1 = Math.max(...st.map((q) => q[1]));
    const a = Math.max(0, Math.min(...st.map((q) => q[0]))), b = Math.min(len, Math.max(...st.map((q) => q[0])));
    // Collé contre la face : il la touche (à 0,8 m près) et s'étend vers l'extérieur.
    if (t0 <= 0.8 && t1 >= 0.8 && b - a > 0.3) out.push([a, b, x.z + VALLON_PARAPET]);
  }
  return out;
}

const faceStyle = (m: VallonModel, wing: string, side: VallonSide): VallonFace | undefined =>
  m.faces?.find((q) => q.w === wing && q.f === side) ?? m.faces?.find((q) => q.w === wing && q.f === "*");

export function buildVallonFacades(sinks: LandmarkSinks, m: VallonModel, terrain: HeightField): void {
  const f = vallonFrame(m);
  for (const w of m.wings ?? []) {
    for (const side of SIDES) {
      const st = faceStyle(m, w.n, side);
      const { frame, len } = faceGeom(f, w.r, side);
      const d = new Draw(frame, sinks, terrain);
      const buried = buriedParts(m, w.n, side);
      const k = st?.k ?? (w.n === "cage-est" ? "plain" : "bands");
      const g = Math.min(d.ground(0), d.ground(len / 2), d.ground(len)) + 0.1;
      if (k === "bands") bands(d, st, len, g, w.z, buried);
      else if (k === "curtain") curtain(d, st, len, g, w.z, buried);
      else if (k === "blank") blank(d, len, g, w.z, buried);
      else if (k === "clad") clad(d, len, g, w.z, buried);
      else if (k === "stairs") stairs(d, len, g, w.z);
    }
  }
}

/** Le tronçon [a, b] de la bande de hauteurs [z0, z1] est-il en partie masqué par un voisin ? */
const hidden = (buried: [number, number, number][], a: number, b: number, z1: number): boolean => buried.some(([s0, s1, top]) => a < s1 && b > s0 && z1 <= top + 0.05);

/** Bandes de fenêtres par étage, lignes d'étage clairement saillantes ; bande verticale et caméra en option. */
function bands(d: Draw, st: VallonFace | undefined, len: number, g: number, top: number, buried: [number, number, number][]): void {
  const floors = st?.floors ?? Math.max(1, Math.round((top - g) / FLOOR));
  const fh = (top - g) / floors;
  const strip = st?.strip;
  const bay = 2.4, margin = 1.0;
  const n = Math.max(1, Math.round((len - 2 * margin) / bay)), bw = (len - 2 * margin) / n;
  for (let i = 0; i < floors; i++) {
    const zf = g + i * fh;
    // Ligne d'étage saillante.
    if (i > 0) d.box(0, len, 0, 0.16, zf - 0.14, zf + 0.12, COL.line);
    const z0 = zf + Math.min(0.95, fh * 0.28), z1 = zf + Math.min(2.45, fh - 0.55);
    for (let j = 0; j < n; j++) {
      const a = margin + j * bw + 0.1, b = margin + (j + 1) * bw - 0.1;
      if (hidden(buried, a, b, z1)) continue;
      if (strip && b > strip[0] - strip[1] / 2 - 0.1 && a < strip[0] + strip[1] / 2 + 0.1) continue;
      d.glass(a, b, z0, z1, 0.05, shade(COL.glass, 0.8), COL.glass, 0.3);
      d.box(a - 0.05, b + 0.05, 0, 0.1, z0 - 0.1, z0, COL.sill);
    }
  }
  // Acrotère : bandeau saillant sous le toit.
  if (!hidden(buried, 0, len, top)) d.box(0, len, 0, 0.1, top - 0.35, top + VALLON_PARAPET, shade(COL.line, 0.97));
  if (strip) d.plate(strip[0] - strip[1] / 2, strip[0] + strip[1] / 2, null, top, 0.06, COL.orange);
  if (st?.cam !== undefined) {
    const s = st.cam, z = g + 3.3;
    d.box(s - 0.14, s + 0.14, 0.05, 0.55, z, z + 0.28, COL.dark);
  }
}

/** Mur-rideau à deux niveaux : vitrage sombre à meneaux, panneaux bleu-vert en haut, portes doubles. */
function curtain(d: Draw, st: VallonFace | undefined, len: number, g: number, top: number, buried: [number, number, number][]): void {
  const mid = g + (top - g) * 0.5, panelFrom = top - 1.1;
  const bay = 1.5, n = Math.max(1, Math.round(len / bay)), bw = len / n;
  for (let j = 0; j < n; j++) {
    const a = j * bw, b = (j + 1) * bw;
    if (!hidden(buried, a, b, mid)) d.glass(a + 0.03, b - 0.03, g, mid - 0.2, 0.05, shade(COL.glass, 0.75), COL.glass, 0.6);
    if (!hidden(buried, a, b, panelFrom)) d.glass(a + 0.03, b - 0.03, mid + 0.15, panelFrom, 0.05, shade(COL.glass, 0.75), COL.glass, 0.4);
    d.plate(a + 0.03, b - 0.03, panelFrom, top, 0.05, COL.panel, shade(COL.panel, 1.12));
    d.plate(b - 0.04, b + 0.04, g, top, 0.07, COL.frame);
  }
  d.box(0, len, 0, 0.16, mid - 0.2, mid + 0.15, COL.line);
  d.box(0, len, 0, 0.18, top - 0.1, top + VALLON_PARAPET, COL.line);
  for (const s of st?.door ?? []) d.door(s, 2.4, 2.4, 0.04, COL.frame, COL.glass, 0.8);
}

/** Mur aveugle : joints verticaux de panneaux tous les 3,6 m et joints d'étage. */
function blank(d: Draw, len: number, g: number, top: number, buried: [number, number, number][]): void {
  for (let s = 3.6; s < len - 0.5; s += 3.6) if (!hidden(buried, s - 0.1, s + 0.1, top)) d.plate(s - 0.03, s + 0.03, null, top, 0.03, COL.joint);
  const mid = g + (top - g) / 2;
  d.plate(0, len, mid - 0.03, mid + 0.03, 0.03, COL.joint);
  d.box(0, len, 0, 0.1, top - 0.3, top + VALLON_PARAPET, shade(COL.line, 0.97));
}

/** Bardage bleu-gris à lames verticales alternées et quelques fenêtres étroites. */
function clad(d: Draw, len: number, g: number, top: number, buried: [number, number, number][]): void {
  let i = 0;
  for (let s = 0; s < len - 0.01; s += 0.9, i++) {
    const e = Math.min(s + 0.9, len);
    if (hidden(buried, s, e, top)) continue;
    d.plate(s, e, null, top, 0.05, shade(COL.clad, i % 2 ? 0.92 : 1.04));
  }
  const z = (top - g) / 2;
  for (const s of [len * 0.3, len * 0.7]) if (!hidden(buried, s - 0.5, s + 0.5, g + z + 2)) d.glass(s - 0.4, s + 0.4, g + z - 0.6, g + z + 1.7, 0.08, shade(COL.glass, 0.8), COL.glass, 0.3);
  d.box(0, len, 0, 0.1, top - 0.25, top + VALLON_PARAPET, shade(COL.line, 0.9));
}

/** Escalier extérieur en béton : paliers saillants et deux volées en Z sur la face est. */
function stairs(d: Draw, len: number, g: number, top: number): void {
  const levels = Math.max(2, Math.round((top - g) / 3));
  const h = (top - g) / levels, depth = 1.5;
  d.plate(0, len, null, top, 0.03, COL.stair);
  for (let k = 1; k <= levels; k++) d.box(0, len, 0, depth, g + k * h - 0.22, g + k * h, COL.stair);
  for (let k = 0; k < levels; k++) {
    const z0 = g + k * h, z1 = z0 + h, up = k % 2 === 0;
    const s0 = up ? 0.1 : len - 0.1, s1 = up ? len - 0.1 : 0.1;
    // Volée : plan incliné de 1,1 m de large, sous-face plus sombre, garde-corps.
    const a = d.P(s0, 0.3, z0), b = d.P(s1, 0.3, z1), c = d.P(s1, 1.4, z1), e = d.P(s0, 1.4, z0);
    d.mb.quad(a, b, c, e, toThree(0, 0, 1), shade(COL.stair, 1.05));
    d.mb.quad(a, b, d.P(s1, 0.3, z1 - 0.28), d.P(s0, 0.3, z0 - 0.28), d.N(0, 1), shade(COL.stair, 0.9));
    d.mb.quad(d.P(s0, 1.4, z0), d.P(s1, 1.4, z1), d.P(s1, 1.4, z1 + 0.9), d.P(s0, 1.4, z0 + 0.9), d.N(0, 1), shade(COL.steel, 1.2));
  }
}
