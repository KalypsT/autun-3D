import * as THREE from "three";
import { box, merge, paint, tube } from "./vehicle-model";

/**
 * Générateur de carrosserie (D52, refait en D107) : une voiture est décrite par quelques mesures (longueur, hauteur, capot, pare-brise, toit, lunette, coffre)
 * et un style (forme des phares, de la calandre, des feux, jantes, accessoires), pas par des boîtes à la main.
 * Analogie : le patron d'un couturier, qui donne une robe différente à chaque mesure ; le style, ce sont les boutons, le col et les poches,
 * ce qui fait qu'on reconnaît la robe de loin.
 * Repère local : avant vers −z, haut +y, origine au centre de gravité (au sol), x vers la droite du véhicule.
 *
 * La caisse est faite de « sections » à huit coins (un octogone aplati : flancs, épaules et bas de caisse chanfreinés) posées le long de l'axe et reliées
 * par des faces planes : le bas de caisse (nez arrondi, capot bombé, flancs, coffre) et l'habitacle (verre), plus le toit, les montants, les passages de roue,
 * les pare-chocs, les feux et les roues en volumes simples (style « affiche », D17). Les parties sont rangées en deux lots : la peinture (en `color`,
 * teintée par instance quand elle est blanche) et les détails, de couleurs fixes, jamais blanc pur (D56).
 */

export type HeadlightShape = "round" | "rect" | "almond" | "strip";
export type GrilleShape = "slim" | "tall" | "chrome" | "sport";
export type TaillightShape = "horizontal" | "vertical" | "bar" | "round";

/** Ce qui distingue un modèle d'un autre au premier coup d'œil, au-delà de ses mesures. */
export interface CarStyle {
  headlights: HeadlightShape;
  grille: GrilleShape;
  taillights: TaillightShape;
  /** Pare-chocs : plastique noir, couleur de caisse ou chromés. */
  bumpers: "trim" | "paint" | "chrome";
  /** Couleur des jantes (jamais blanc pur : elle ne doit pas prendre la teinte de la caisse). */
  rim: string;
  /** Portes de chaque côté : 1 (trois portes, longue portière) ou 2 (cinq portes). */
  doors: 1 | 2;
  /** Arrondi des formes, de 0 (anguleux) à 1 (tout en rondeurs) : chanfreins des épaules et du bas de caisse, nez et queue. */
  roundness: number;
  /** Toit d'une autre couleur que la caisse (toit noir), montants compris. */
  roof?: string;
  /** Montants centraux noirs (vitrage d'un seul tenant). */
  blackPillars?: boolean;
  /** Baguette chromée sous les vitres. */
  chromeTrim?: boolean;
  roofRails?: boolean;
  /** Becquet au bout du toit, ou aileron sur le coffre. */
  spoiler?: "roof" | "wing";
  /** Protections noires (passages de roue, bas de caisse) : SUV. */
  cladding?: boolean;
  /** Baguette de protection noire le long des portières. */
  sideStrip?: boolean;
  hoodScoop?: boolean;
  /** Sorties d'échappement visibles sous le pare-chocs arrière. */
  exhaust?: 1 | 2;
  /** Ailes séparées et arrondies au-dessus des roues, marchepied entre elles : voiture ancienne. */
  fenders?: boolean;
  /** Prise d'air sous la calandre, dans le pare-chocs. */
  intake?: boolean;
  /** Portes arrière battantes (camionnette). */
  rearDoors?: boolean;
}

export interface CarBodyParams {
  /** Hors tout (m) : du nez à la queue, pare-chocs compris. */
  length: number;
  width: number;
  /** Haut du toit. */
  height: number;
  /** Distance du nez au premier essieu (le second est déduit de la longueur). */
  overhangFront: number;
  /** Garde au sol, ligne de ceinture (haut des flancs, bas des vitres), hauteur du nez et de la queue (haut des faces avant et arrière). */
  clearance: number;
  belt: number;
  noseHeight: number;
  tailHeight: number;
  /** Du nez au pied du pare-brise ; longueur horizontale du pare-brise, du toit, de la lunette. Le reste est le coffre. */
  hood: number;
  windshield: number;
  roof: number;
  rearGlass: number;
  /** Largeur du toit rapportée à celle de la caisse (les flancs de l'habitacle rentrent). */
  roofTaper: number;
  wheelRadius: number;
  tyreWidth: number;
  /** Camionnette : derrière le toit de la cabine, une caisse pleine hauteur, en peinture, sans vitre (la lunette est alors de longueur nulle). */
  cargo?: boolean;
  /** Couleur de verre (reflets plus ou moins sombres). */
  glass?: string;
  style: CarStyle;
  /** Livrée (police, J4) : une bande claire et un filet de couleur le long des flancs, une barre de gyrophares sur le toit. */
  livery?: { stripe: string; accent: string; lightBar: boolean };
}

/** Barre de gyrophares : hauteur du socle, et ses deux feux (centre x, y, z et taille), dans le repère du véhicule. */
const BAR_HEIGHT = 0.1;
export function beaconBoxes(p: CarBodyParams, front: number, rear: number): { x: number; y: number; z: number; size: [number, number, number] }[] {
  if (!p.livery?.lightBar) return [];
  const L = carLayout(p, front, rear);
  const z = L.roofFrontZ + p.roof * 0.35, y = p.height + BAR_HEIGHT / 2 + 0.01;
  return [-1, 1].map((side) => ({ x: side * 0.3, y, z, size: [0.42, BAR_HEIGHT * 0.9, 0.2] as [number, number, number] }));
}

/** Positions utiles d'une carrosserie, dans le repère du véhicule. */
export interface CarLayout {
  noseZ: number;
  tailZ: number;
  windshieldBaseZ: number;
  roofFrontZ: number;
  roofRearZ: number;
  rearBaseZ: number;
  /** Centres des quatre roues : [x, z], avant droit, avant gauche, arrière droit, arrière gauche. */
  wheels: readonly (readonly [number, number])[];
}

const BUMPER = 0.12;
/** Retrait du pare-chocs derrière le nez (la plaque d'immatriculation dépasse devant lui, au nez exact). */
const BUMPER_SET = 0.015;
/** Retrait des faces avant et arrière de la caisse derrière le nez et la queue. */
const FACE = 0.04;
const TRIM = "#2c2c33";
const DARK = "#1d1f24";
const CLAD = "#3a3b40";
const CHROME = "#c9ccd0";
const LIGHT = "#f5ecd2";
const AMBER = "#f1a03a";
const TAIL = "#e0442c";
const TAIL_DARK = "#9c2a1c";
const PLATE = "#f1e6c8";

/** Écart du flanc au bord hors tout (les passages de roue et les roues dépassent du flanc). */
const SIDE_INSET = 0.035;
/** Écart de la face extérieure du pneu au bord hors tout. */
const TYRE_INSET = 0.012;

/** Demi-voie (m) : centre des roues, d'après la largeur et la largeur des pneus (les pneus affleurent le bord hors tout). */
export function wheelTrack(p: CarBodyParams): number {
  return p.width / 2 - TYRE_INSET - p.tyreWidth / 2;
}

/** Positions des éléments, d'après les mesures et les distances du centre de gravité aux essieux. */
export function carLayout(p: CarBodyParams, front: number, rear: number): CarLayout {
  const noseZ = -(front + p.overhangFront);
  const tailZ = noseZ + p.length;
  const windshieldBaseZ = noseZ + p.hood;
  const roofFrontZ = windshieldBaseZ + p.windshield;
  const roofRearZ = roofFrontZ + p.roof;
  const rearBaseZ = roofRearZ + p.rearGlass;
  const track = wheelTrack(p);
  return {
    noseZ, tailZ, windshieldBaseZ, roofFrontZ, roofRearZ, rearBaseZ,
    wheels: [[track, -front], [-track, -front], [track, rear], [-track, rear]],
  };
}

/** Section de carrosserie : octogone aplati, symétrique (demi-largeurs au bas, aux flancs, au haut ; hauteurs des chanfreins du bas et du haut). */
interface Section {
  z: number;
  y0: number;
  y1: number;
  /** Demi-largeur des flancs, du bas et du haut. */
  w: number;
  wb: number;
  wt: number;
  /** Hauteur des chanfreins du bas et du haut. */
  cb: number;
  ct: number;
}

/** Ancienne forme de section (trapèze), gardée pour les volumes simples. */
interface Station {
  z: number;
  y0: number;
  y1: number;
  /** Demi-largeurs en bas et en haut de la section. */
  w0: number;
  w1: number;
}

type Ring = THREE.Vector3[];

const ZERO_UV = [0, 0];

function centroid(points: readonly THREE.Vector3[]): THREE.Vector3 {
  const c = new THREE.Vector3();
  for (const p of points) c.add(p);
  return c.divideScalar(points.length);
}

/**
 * Volume délimité par des anneaux successifs de même nombre de coins (chacun un polygone convexe), faces planes, normales vers l'extérieur.
 * Chaque face latérale est orientée par rapport à l'axe du tronçon (centre de ses deux anneaux), chaque bouchon par rapport à l'anneau voisin :
 * cela suffit pour des sections convexes, même le long d'un profil qui ne l'est pas (capot qui monte, coffre qui redescend).
 */
export function ringLoft(rings: readonly Ring[], color: string): THREE.BufferGeometry {
  const pos: number[] = [], nor: number[] = [], uv: number[] = [];
  const ab = new THREE.Vector3(), ac = new THREE.Vector3(), n = new THREE.Vector3();
  const tri = (u: THREE.Vector3, v: THREE.Vector3, w: THREE.Vector3, inside: THREE.Vector3): void => {
    n.copy(ab.subVectors(v, u)).cross(ac.subVectors(w, u));
    if (n.lengthSq() < 1e-12) return;
    // La normale doit regarder à l'opposé du point intérieur.
    const mid = ab.copy(u).add(v).add(w).divideScalar(3).sub(inside);
    if (n.dot(mid) < 0) [v, w] = [w, v];
    n.copy(ab.subVectors(v, u)).cross(ac.subVectors(w, u)).normalize();
    for (const p of [u, v, w]) {
      pos.push(p.x, p.y, p.z);
      nor.push(n.x, n.y, n.z);
      uv.push(ZERO_UV[0]!, ZERO_UV[1]!);
    }
  };
  const centers = rings.map(centroid);
  for (let i = 0; i + 1 < rings.length; i++) {
    const a = rings[i]!, b = rings[i + 1]!, inside = centers[i]!.clone().add(centers[i + 1]!).multiplyScalar(0.5);
    for (let k = 0; k < a.length; k++) {
      const k1 = (k + 1) % a.length;
      tri(a[k]!, a[k1]!, b[k1]!, inside);
      tri(a[k]!, b[k1]!, b[k]!, inside);
    }
  }
  // Bouchons : éventail depuis le premier coin, orienté à l'opposé de l'anneau voisin.
  for (const [cap, next] of [[0, 1], [rings.length - 1, rings.length - 2]] as const) {
    const r = rings[cap]!, inside = centers[cap]!.clone().lerp(centers[next]!, 0.5);
    for (let k = 1; k + 1 < r.length; k++) tri(r[0]!, r[k]!, r[k + 1]!, inside);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  return paint(g, color);
}

/** Volume fait de sections trapézoïdales successives (de l'avant vers l'arrière). */
export function loft(stations: readonly Station[], color: string): THREE.BufferGeometry {
  return ringLoft(stations.map((s) => [
    new THREE.Vector3(-s.w0, s.y0, s.z), new THREE.Vector3(s.w0, s.y0, s.z), new THREE.Vector3(s.w1, s.y1, s.z), new THREE.Vector3(-s.w1, s.y1, s.z),
  ]), color);
}

function octagon(s: Section): Ring {
  const ct = Math.min(s.ct, (s.y1 - s.y0) * 0.45), cb = Math.min(s.cb, (s.y1 - s.y0) * 0.3);
  return [
    new THREE.Vector3(-s.wb, s.y0, s.z), new THREE.Vector3(s.wb, s.y0, s.z),
    new THREE.Vector3(s.w, s.y0 + cb, s.z), new THREE.Vector3(s.w, s.y1 - ct, s.z),
    new THREE.Vector3(s.wt, s.y1, s.z), new THREE.Vector3(-s.wt, s.y1, s.z),
    new THREE.Vector3(-s.w, s.y1 - ct, s.z), new THREE.Vector3(-s.w, s.y0 + cb, s.z),
  ];
}

/** Sections reliées, de l'avant vers l'arrière ; une section trop proche de la précédente est sautée. */
function sectionLoft(sections: Section[], color: string): THREE.BufferGeometry {
  const kept: Section[] = [];
  for (const s of sections) if (!kept.length || s.z > kept[kept.length - 1]!.z + 0.02) kept.push(s);
  return ringLoft(kept.map(octagon), color);
}

/**
 * Plaque en demi-ellipse posée à plat contre le flanc (passage de roue, aile) : de x0 à x1 (du même côté), centrée en (yc, zc),
 * demi-hauteur ry et demi-longueur rz, le bord droit en bas.
 */
function arch(x0: number, x1: number, yc: number, zc: number, ry: number, rz: number, color: string, steps = 6): THREE.BufferGeometry {
  const ring = (x: number): Ring => {
    const out: Ring = [];
    for (let i = 0; i <= steps; i++) {
      const a = (Math.PI * i) / steps;
      out.push(new THREE.Vector3(x, yc + ry * Math.sin(a), zc + rz * Math.cos(a)));
    }
    return out;
  };
  return ringLoft([ring(x0), ring(x1)], color);
}

/** Cylindre d'axe z (phares et feux ronds, échappements), centré en (x, y, z). */
function disc(r: number, depth: number, x: number, y: number, z: number, color: string, segments = 10): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(r, r, depth, segments);
  g.rotateX(Math.PI / 2);
  g.translate(x, y, z);
  return paint(g, color);
}

/** Boîte tournée d'un angle `roll` autour de l'axe z (phares en amande). */
function rolledBox(w: number, h: number, d: number, x: number, y: number, z: number, roll: number, color: string): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d);
  g.rotateZ(roll);
  g.translate(x, y, z);
  return paint(g, color);
}

/** Mesures dérivées, communes à la peinture et aux détails. */
function frame(p: CarBodyParams, front: number, rear: number) {
  const L = carLayout(p, front, rear), W = p.width / 2, st = p.style, r = st.roundness;
  /** Flanc : plus rentré sous des ailes séparées. */
  const side = st.fenders ? W - 0.15 : W - SIDE_INSET;
  const ct = 0.05 + 0.1 * r, cb = 0.05 + 0.06 * r;
  /** Demi-largeur du haut de caisse à la ceinture (où se pose le vitrage). */
  const shoulder = side - ct;
  const roofW = (W - 0.08) * p.roofTaper;
  const nose = L.noseZ + FACE, tail = L.tailZ - FACE;
  const archR = p.wheelRadius + 0.06;
  /** Montant central : au milieu d'une berline à cinq portes, plus en arrière sur une trois-portes (longue portière). */
  const bZ = L.roofFrontZ + p.roof * (st.doors === 1 ? 0.62 : 0.45);
  const sec = (z: number, y1: number, scale = 1, y0 = p.clearance): Section => {
    const w = side * scale;
    return { z, y0, y1, w, wb: w - cb * 0.7, wt: w - ct, cb, ct };
  };
  return { L, W, st, r, side, ct, cb, shoulder, roofW, nose, tail, archR, bZ, sec, front, rear };
}

type Frame = ReturnType<typeof frame>;

/** Bas de caisse : nez arrondi, capot bombé, flancs, coffre (ou caisse de camionnette). */
function lowerBody(p: CarBodyParams, f: Frame, color: string): THREE.BufferGeometry[] {
  const { L, r, nose, tail, sec } = f;
  const round = 0.1 + 0.14 * r;
  const hoodMid = (nose + L.windshieldBaseZ) / 2;
  const front = [
    sec(nose, p.noseHeight - 0.03 - 0.05 * r, 0.93 - 0.07 * r, p.clearance + 0.04),
    sec(nose + round, p.noseHeight),
    sec(hoodMid, (p.noseHeight + p.belt) / 2 + 0.015 + 0.025 * r),
    sec(L.windshieldBaseZ, p.belt),
  ];
  if (p.cargo) {
    return [
      sectionLoft([...front, sec(L.rearBaseZ, p.belt)], color),
      sectionLoft([
        { ...sec(L.rearBaseZ - 0.01, p.height - 0.02), ct: 0.08 },
        { ...sec(tail - 0.05, p.height - 0.02), ct: 0.08 },
        { ...sec(tail, p.height - 0.06, 0.97), ct: 0.06 },
      ], color),
    ];
  }
  return [sectionLoft([
    ...front,
    sec(L.rearBaseZ, p.belt),
    sec(tail - round, p.tailHeight),
    sec(tail, p.tailHeight - 0.03 - 0.04 * r, 0.93 - 0.07 * r, p.clearance + 0.04),
  ], color)];
}

/** Toit, montants, ailes séparées, pare-chocs et rétroviseurs couleur caisse, becquets : tout ce qui prend la peinture. */
function paintParts(p: CarBodyParams, front: number, rear: number, color: string): THREE.BufferGeometry[] {
  const f = frame(p, front, rear), { L, W, st, side, shoulder, roofW, bZ } = f;
  const top = p.height, roofColor = st.roof ?? color;
  const parts = lowerBody(p, f, color);
  // Toit : une dalle aux bords chanfreinés, un peu plus longue que le verre qu'elle couvre.
  const roofZ0 = L.roofFrontZ - 0.05, roofZ1 = L.roofRearZ + (p.cargo ? 0 : 0.06);
  const slab = (z: number): Section => ({ z, y0: top - 0.065, y1: top, w: roofW + 0.02, wb: roofW, wt: roofW - 0.02, cb: 0.01, ct: 0.03 });
  if (!p.cargo) parts.push(sectionLoft([slab(roofZ0), slab(roofZ1)], roofColor));
  else parts.push(sectionLoft([slab(roofZ0), slab(L.rearBaseZ + 0.02)], roofColor));
  // Montants : A (le long du pare-brise) et C (le long de la lunette) de la couleur du toit ; B (et D sur un long toit), de la caisse ou noirs.
  const pillar = st.blackPillars ? DARK : roofColor;
  for (const s of [-1, 1]) {
    const at = (x: number, y: number, z: number): THREE.Vector3 => new THREE.Vector3(s * x, y, z);
    parts.push(tube(at(shoulder - 0.01, p.belt, L.windshieldBaseZ + 0.02), at(roofW, top - 0.04, L.roofFrontZ), 0.035, roofColor, 4, false));
    if (!p.cargo) parts.push(tube(at(shoulder - 0.01, p.belt, L.rearBaseZ - 0.02), at(roofW, top - 0.04, L.roofRearZ), 0.045, roofColor, 4, false));
    if (!st.blackPillars) {
      parts.push(tube(at(shoulder - 0.005, p.belt, bZ), at(roofW + 0.015, top - 0.04, bZ), 0.045, pillar, 4, false));
      if (p.roof > 1.6) parts.push(tube(at(shoulder - 0.005, p.belt, L.roofRearZ - 0.5), at(roofW + 0.015, top - 0.04, L.roofRearZ - 0.5), 0.04, pillar, 4, false));
    }
  }
  // Ailes séparées (voiture ancienne) : demi-ellipses bombées au-dessus des roues, débordant du flanc rentré.
  if (st.fenders) {
    for (const [x, z] of L.wheels) {
      const s = Math.sign(x);
      parts.push(arch(s * (side - 0.03), s * (W - 0.006), p.wheelRadius * 1.1, z, p.wheelRadius * 0.95, p.wheelRadius * 1.75, color));
    }
  }
  // Pare-chocs couleur caisse.
  if (st.bumpers === "paint") parts.push(...bumpers(p, f, color));
  // Rétroviseurs couleur caisse (sinon noirs, avec les détails).
  if (st.bumpers !== "trim") parts.push(...mirrors(p, f, color));
  if (st.hoodScoop) {
    const z = (L.noseZ + L.windshieldBaseZ) / 2 + 0.1, y = (p.noseHeight + p.belt) / 2 + 0.05;
    parts.push(box(0.42, 0.05, 0.4, 0, y, z, color));
  }
  if (st.spoiler === "roof") parts.push(box(roofW * 2, 0.035, 0.2, 0, top - 0.02, L.roofRearZ + 0.1, roofColor));
  return parts;
}

function bumpers(p: CarBodyParams, f: Frame, color: string): THREE.BufferGeometry[] {
  const { L } = f;
  const h = p.style.bumpers === "chrome" ? 0.08 : 0.16, d = p.style.bumpers === "chrome" ? 0.08 : BUMPER;
  const y = p.clearance + (p.style.bumpers === "chrome" ? 0.1 : 0.09);
  return [
    box(p.width - 0.02, h, d, 0, y, L.noseZ + BUMPER_SET + d / 2, color),
    box(p.width - 0.02, h, d, 0, y, L.tailZ - BUMPER_SET - d / 2, color),
  ];
}

function mirrors(p: CarBodyParams, f: Frame, color: string): THREE.BufferGeometry[] {
  const { L, W } = f;
  return [-1, 1].map((s) => box(0.1, 0.09, 0.13, s * (W - 0.07), p.belt + 0.1, L.windshieldBaseZ + 0.2, color));
}

/** Phares et feux arrière : positions de leurs centres (deux de chaque), selon leur forme. */
export function lampSpots(p: CarBodyParams, front: number, rear: number): { head: [number, number, number][]; tail: [number, number, number][] } {
  const f = frame(p, front, rear), { L, W, side } = f, st = p.style;
  const hx = st.headlights === "round" ? W * 0.64 : st.headlights === "strip" ? W * 0.7 : W * 0.66;
  const hy = p.noseHeight - (st.headlights === "strip" ? 0.09 : 0.13) - 0.03 * st.roundness;
  const hz = L.noseZ + FACE - 0.01;
  const tx = st.taillights === "vertical" ? side * 0.84 : st.taillights === "bar" ? W * 0.72 : W * 0.66;
  const ty = p.cargo ? p.clearance + 0.62 : p.tailHeight - (st.taillights === "vertical" ? 0.2 : 0.15) - 0.03 * st.roundness;
  const tz = L.tailZ - FACE + 0.01;
  return {
    head: [[hx, hy, hz], [-hx, hy, hz]],
    tail: [[tx, ty, tz], [-tx, ty, tz]],
  };
}

/** Phares, clignotants et calandre. */
function faceParts(p: CarBodyParams, f: Frame, front: number, rear: number): THREE.BufferGeometry[] {
  const { L, W } = f, st = p.style, parts: THREE.BufferGeometry[] = [];
  const { head } = lampSpots(p, front, rear);
  for (const [x, y, z] of head) {
    const s = Math.sign(x);
    switch (st.headlights) {
      case "round":
        parts.push(disc(0.1, 0.03, x, y, z + 0.012, CHROME), disc(0.082, 0.05, x, y, z, LIGHT));
        parts.push(box(0.07, 0.045, 0.04, x + s * 0.03, y - 0.15, z, AMBER));
        break;
      case "rect":
        parts.push(box(0.27, 0.13, 0.05, x, y, z, LIGHT), box(0.07, 0.13, 0.05, x + s * 0.17, y, z, AMBER));
        break;
      case "almond":
        parts.push(rolledBox(0.34, 0.09, 0.05, x, y, z, s * 0.22, LIGHT), box(0.06, 0.04, 0.05, x + s * 0.2, y - 0.02, z, AMBER));
        break;
      case "strip":
        parts.push(box(0.3, 0.065, 0.05, x, y, z, LIGHT), box(0.06, 0.065, 0.05, x + s * 0.18, y, z, AMBER));
        break;
    }
  }
  const [hx, hy, hz] = head[0]!;
  const between = 2 * (hx - 0.15) - 0.04;
  switch (st.grille) {
    case "slim":
      parts.push(box(between, 0.07, 0.04, 0, hy - 0.02, hz, TRIM));
      break;
    case "tall":
      parts.push(box(between * 0.85, 0.22, 0.04, 0, hy - 0.06, hz, DARK), box(between * 0.85 + 0.03, 0.025, 0.045, 0, hy + 0.05, hz, CHROME));
      break;
    case "chrome":
      parts.push(box(between * 0.8, 0.17, 0.04, 0, hy - 0.04, hz, DARK));
      for (const dy of [0.03, -0.03, -0.09]) parts.push(box(between * 0.82, 0.022, 0.05, 0, hy + dy, hz, CHROME));
      break;
    case "sport":
      parts.push(box(between * 0.6, 0.04, 0.04, 0, hy - 0.02, hz, DARK));
      break;
  }
  // Prise d'air dans le pare-chocs (sportive : grande, sous toute la face).
  if (st.intake || st.grille === "sport") {
    const w = st.grille === "sport" ? W * 1.3 : W * 0.85;
    parts.push(box(w, 0.1, 0.016, 0, p.clearance + 0.09, L.noseZ + 0.012, DARK));
  }
  return parts;
}

/** Feux arrière, plaques, échappements, portes arrière de camionnette. */
function tailParts(p: CarBodyParams, f: Frame, front: number, rear: number): THREE.BufferGeometry[] {
  const { L, W } = f, st = p.style, parts: THREE.BufferGeometry[] = [];
  const { tail } = lampSpots(p, front, rear);
  for (const [x, y, z] of tail) {
    switch (st.taillights) {
      case "horizontal":
        parts.push(box(0.32, 0.11, 0.05, x, y, z, TAIL), box(0.1, 0.11, 0.051, x - Math.sign(x) * 0.12, y, z, AMBER));
        break;
      case "vertical":
        parts.push(box(0.12, 0.3, 0.05, x, y, z, TAIL), box(0.12, 0.07, 0.051, x, y - 0.1, z, AMBER));
        break;
      case "bar":
        parts.push(box(0.24, 0.1, 0.05, x, y, z, TAIL));
        break;
      case "round":
        parts.push(disc(0.075, 0.05, x, y, z, TAIL), disc(0.05, 0.05, x - Math.sign(x) * 0.17, y, z, AMBER, 8));
        break;
    }
  }
  if (st.taillights === "bar") {
    const [x, y, z] = tail[0]!;
    parts.push(box(2 * x - 0.2, 0.05, 0.045, 0, y, z, TAIL_DARK));
  }
  // Plaques : sur le pare-chocs, dépassant devant lui (nez et queue exacts).
  parts.push(box(0.44, 0.11, 0.02, 0, p.clearance + 0.1, L.noseZ + 0.01, PLATE));
  parts.push(box(0.44, 0.11, 0.02, 0, p.clearance + 0.1, L.tailZ - 0.01, PLATE));
  if (st.exhaust) {
    const xs = st.exhaust === 2 ? [W * 0.5, -W * 0.5] : [W * 0.5];
    for (const x of xs) parts.push(disc(0.04, 0.1, x, p.clearance - 0.01, L.tailZ - 0.06, st.exhaust === 2 ? CHROME : DARK, 8));
  }
  if (st.rearDoors) {
    const z = L.tailZ - FACE + 0.004, y0 = p.clearance + 0.2, y1 = p.height - 0.1;
    parts.push(box(0.014, y1 - y0, 0.012, 0, (y0 + y1) / 2, z, DARK));
    for (const s of [-1, 1]) {
      parts.push(box(0.5, 0.36, 0.014, s * 0.32, p.height - 0.42, z, p.glass ?? "#2b3a4c"));
      parts.push(box(0.04, 0.12, 0.02, s * 0.06, p.belt - 0.02, z - 0.004, DARK));
    }
  }
  return parts;
}

/** Passages de roue, lignes de portières, poignées, baguettes, protections, marchepieds. */
function sideParts(p: CarBodyParams, f: Frame): THREE.BufferGeometry[] {
  const { L, W, st, side, ct, archR, bZ } = f, parts: THREE.BufferGeometry[] = [];
  const front = L.wheels[0]![1], rear = L.wheels[2]![1];
  for (const [x, z] of L.wheels) {
    const s = Math.sign(x);
    if (st.fenders) continue;
    // Passage de roue : une demi-ellipse sombre contre le flanc, derrière la face du pneu ; cerclée de plastique sur un SUV.
    if (st.cladding) parts.push(arch(s * (side - 0.01), s * (W - 0.027), p.wheelRadius, z, archR + 0.07, archR + 0.09, CLAD));
    parts.push(arch(s * (side - 0.02), s * (W - 0.021), p.wheelRadius, z, archR, archR + 0.02, DARK));
  }
  const lineTop = p.belt - ct - 0.015, lineBottom = p.clearance + 0.12;
  const doorFront = Math.max(L.windshieldBaseZ + 0.06, front + archR + 0.08);
  const doorRear = p.cargo ? L.rearBaseZ - 0.04 : st.doors === 2 ? Math.min(L.rearBaseZ - 0.08, rear - archR - 0.06) : bZ;
  const lines = st.doors === 2 && !p.cargo ? [doorFront, bZ, doorRear] : [doorFront, doorRear];
  if (p.cargo) lines.push(L.rearBaseZ + 0.95);
  const handles = st.doors === 2 && !p.cargo ? [bZ - 0.18, doorRear - 0.16] : [doorRear - 0.18];
  if (p.cargo) handles.push(L.rearBaseZ + 0.85);
  for (const s of [-1, 1]) {
    const x = s * (side + 0.003);
    for (const z of lines) parts.push(box(0.008, lineTop - lineBottom, 0.012, x, (lineTop + lineBottom) / 2, z, DARK));
    for (const z of handles) parts.push(box(0.016, 0.035, 0.13, s * (side + 0.006), lineTop - 0.06, z, st.chromeTrim ? CHROME : DARK));
    // Rebord sous les vitres : sépare nettement la caisse du verre.
    const sillZ0 = L.windshieldBaseZ + 0.12, sillZ1 = p.cargo ? L.rearBaseZ - 0.02 : L.rearBaseZ - 0.08;
    parts.push(box(0.03, 0.025, sillZ1 - sillZ0, s * (f.shoulder + 0.005), p.belt + 0.01, (sillZ0 + sillZ1) / 2, st.chromeTrim ? CHROME : TRIM));
    if (st.sideStrip) parts.push(box(0.012, 0.05, rear - front - 2 * archR - 0.2, s * (side + 0.006), (p.clearance + p.belt) / 2, (front + rear) / 2, TRIM));
    if (st.cladding) {
      const len = rear - front - 2 * archR - 0.2;
      parts.push(box(0.012, 0.13, len, s * (side + 0.004), p.clearance + 0.07, (front + rear) / 2, CLAD));
    }
    if (st.fenders) {
      const len = rear - front - p.wheelRadius * 3.6;
      parts.push(box(W - side + 0.02, 0.04, len, s * (side + W - 0.03) / 2, p.clearance + 0.06, (front + rear) / 2, TRIM));
    }
    if (p.cargo) {
      // Rail de la porte coulissante.
      const z0 = L.rearBaseZ + 0.05, z1 = L.rearBaseZ + 1.0;
      parts.push(box(0.012, 0.025, z1 - z0, s * (side + 0.004), p.belt + 0.25, (z0 + z1) / 2, DARK));
    }
  }
  return parts;
}

/** Verre, pare-chocs noirs ou chromés, phares, feux, plaques, rétroviseurs noirs, passages de roue, accessoires : couleurs fixes. */
export function bodyDetailGeometry(p: CarBodyParams, front: number, rear: number): THREE.BufferGeometry {
  const f = frame(p, front, rear), { L, W, st, shoulder, roofW } = f;
  const glass = p.glass ?? "#2b3a4c";
  const top = p.height;
  const cabinW = roofW - 0.005;
  const glassEnd = p.cargo ? L.roofRearZ - 0.02 : L.rearBaseZ;
  const parts: THREE.BufferGeometry[] = [
    // Habitacle en verre : du pied du pare-brise à celui de la lunette, posé sur l'épaule de la caisse, sous le toit.
    loft([
      { z: L.windshieldBaseZ, y0: p.belt - 0.01, y1: p.belt, w0: shoulder - 0.01, w1: shoulder - 0.02 },
      { z: L.roofFrontZ, y0: p.belt - 0.01, y1: top - 0.04, w0: shoulder - 0.005, w1: cabinW },
      { z: p.cargo ? glassEnd : L.roofRearZ, y0: p.belt - 0.01, y1: top - 0.04, w0: shoulder - 0.005, w1: cabinW },
      ...(p.cargo ? [] : [{ z: L.rearBaseZ, y0: p.belt - 0.01, y1: p.belt, w0: shoulder - 0.01, w1: shoulder - 0.02 }]),
    ], glass),
    ...faceParts(p, f, front, rear),
    ...tailParts(p, f, front, rear),
    ...sideParts(p, f),
    ...liveryParts(p, f),
  ];
  if (st.bumpers !== "paint") parts.push(...bumpers(p, f, st.bumpers === "chrome" ? CHROME : TRIM));
  if (st.bumpers === "trim") parts.push(...mirrors(p, f, TRIM));
  if (st.bumpers === "chrome") {
    // Sous le pare-chocs chromé, la jupe de caisse : sombre.
    parts.push(box(p.width - 0.3, 0.06, 0.04, 0, p.clearance + 0.03, L.noseZ + FACE + 0.02, TRIM));
  }
  if (st.blackPillars) {
    for (const s of [-1, 1]) parts.push(tube(new THREE.Vector3(s * (shoulder - 0.005), p.belt, f.bZ), new THREE.Vector3(s * (roofW + 0.012), top - 0.04, f.bZ), 0.04, DARK, 4, false));
  }
  if (st.roofRails) {
    const z0 = L.roofFrontZ + 0.05, z1 = L.roofRearZ - 0.02;
    for (const s of [-1, 1]) parts.push(box(0.035, 0.035, z1 - z0, s * roofW * 0.82, top + 0.018, (z0 + z1) / 2, TRIM));
  }
  if (st.spoiler === "wing") {
    const z = L.tailZ - 0.24, y = p.tailHeight + 0.13;
    parts.push(box(W * 1.7, 0.03, 0.24, 0, y, z, DARK));
    for (const s of [-1, 1]) parts.push(box(0.04, 0.13, 0.08, s * W * 0.6, y - 0.07, z, DARK));
  }
  return merge(parts);
}

/** Bandes des flancs et barre de gyrophares (éteinte : les feux allumés sont des instances à part, `beaconBoxes`). */
function liveryParts(p: CarBodyParams, f: Frame): THREE.BufferGeometry[] {
  const lv = p.livery;
  if (!lv) return [];
  const { L, side } = f;
  const z0 = L.noseZ + 0.35, z1 = L.tailZ - 0.3, mid = (p.clearance + p.belt) / 2;
  const parts = [-1, 1].flatMap((s) => [
    box(0.02, 0.16, z1 - z0, s * (side + 0.008), mid + 0.04, (z0 + z1) / 2, lv.stripe),
    box(0.02, 0.04, z1 - z0, s * (side + 0.008), mid - 0.08, (z0 + z1) / 2, lv.accent),
  ]);
  if (lv.lightBar) {
    const z = L.roofFrontZ + p.roof * 0.35;
    parts.push(box(1.0, BAR_HEIGHT * 0.5, 0.24, 0, p.height + BAR_HEIGHT * 0.25, z, "#d9dde2"));
    for (const b of beaconBoxes(p, f.front, f.rear)) parts.push(box(b.size[0] - 0.02, b.size[1] - 0.01, b.size[2] - 0.02, b.x, b.y, b.z, "#3d6fc4"));
  }
  return parts;
}

/** Caisse peinte (en blanc : la couleur vient de l'instance ou de `color`). */
export function bodyPaintGeometry(p: CarBodyParams, front: number, rear: number, color: string): THREE.BufferGeometry {
  return merge(paintParts(p, front, rear, color));
}

/**
 * Roue : pneu, jante de la couleur donnée (en blanc : teintée par instance, pour la circulation) et quatre rayons sombres en croix (la rotation se voit).
 * `segments` : facettes du pneu.
 */
export function carWheelGeometry(radius: number, width: number, segments: number, rim = "#ffffff"): THREE.BufferGeometry {
  const tyre = new THREE.CylinderGeometry(radius, radius, width, segments);
  tyre.rotateZ(Math.PI / 2);
  const cap = new THREE.CylinderGeometry(radius * 0.64, radius * 0.64, width + 0.01, Math.max(8, segments - 2));
  cap.rotateZ(Math.PI / 2);
  return merge([
    paint(tyre, "#24242a"), paint(cap, rim),
    box(width + 0.018, radius * 1.1, radius * 0.15, 0, 0, 0, "#5e5b55"),
    box(width + 0.018, radius * 0.15, radius * 1.1, 0, 0, 0, "#5e5b55"),
  ]);
}

/** Détails et quatre roues dans une seule géométrie : voitures garées (instances). */
export function parkedDetailGeometry(p: CarBodyParams, front: number, rear: number): THREE.BufferGeometry {
  const parts = [bodyDetailGeometry(p, front, rear)];
  for (const [x, z] of carLayout(p, front, rear).wheels) {
    const w = carWheelGeometry(p.wheelRadius, p.tyreWidth, 10, p.style.rim);
    w.translate(x, p.wheelRadius, z);
    parts.push(w);
  }
  return merge(parts);
}
