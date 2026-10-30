import * as THREE from "three";
import { box, merge, paint, ringLoft, tiltedBox, tube, type Ring } from "./vehicle-model";

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
  /** Capote en toile de cette couleur à la place du toit et des vitres, avec un pare-brise droit et de petites fenêtres (jeep, D114). */
  softTop?: string;
  /** Roue de secours accrochée à la face arrière (D114). */
  spareWheel?: boolean;
}

/**
 * Caisse d'un camion-restaurant (D115) : une ouverture de service sur le flanc droit (côté trottoir ; le gauche si `left`), de `from` à `to` m après le pied de la caisse
 * et de `bottom` à `top` m de haut, avec son comptoir, son auvent relevé (rayé si `stripe`), le fond de la caisse (`interior`), un lettrage en blocs,
 * et soit la cheminée d'un four à bois, soit les broches d'une rôtisserie.
 */
export interface FoodTruck {
  from: number;
  to: number;
  bottom: number;
  top: number;
  interior: string;
  counter: string;
  awning: string;
  stripe?: string;
  /** Lettrage sur le flanc de l'ouverture : vertical entre la cabine et l'ouverture, ou horizontal au-dessus de l'ouverture. */
  lettering: { text: string; color: string; vertical: boolean };
  /** Ouverture sur le flanc gauche (tout l'aménagement en miroir, lettrage compris, qui reste lisible) : pour servir un parking placé à gauche. */
  left?: boolean;
  oven?: boolean;
  spits?: boolean;
}

/**
 * Grumier (D116) : derrière la cabine avancée, un châssis nu à `bed` m (dessus des longerons), une grue de chargement repliée, une ridelle qui
 * protège la cabine, des bancs à ranchers et deux piles de grumes (écorce `bark`, bouts `wood`), une barre de feux arrière, des garde-boue sur le
 * tandem, un pare-cycliste et un réservoir sur chaque flanc, un échappement vertical.
 */
export interface LogTruck {
  bed: number;
  bark: string;
  wood: string;
  crane: string;
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
  /** Haut du toit de la cabine, s'il est plus bas que la caisse (camion-restaurant, D115) ; défaut : `height`. */
  cabHeight?: number;
  /** Camion-restaurant (D115) : la caisse est creuse, ouverte sur un flanc pour le service (voir `FoodTruck`). */
  foodTruck?: FoodTruck;
  /** Tandem arrière (D116) : deux essieux arrière, écartés de tant (m) de part et d'autre de l'essieu arrière de la fiche (le milieu du tandem). */
  tandem?: number;
  /** Grumier (D116) : plateau à grumes derrière la cabine (voir `LogTruck`) ; avec `cargo`, la cabine est seule à prendre la peinture. */
  logTruck?: LogTruck;
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
  /** Centres des roues : [x, z], avant droit, avant gauche, arrière droit, arrière gauche (puis le second essieu arrière d'un tandem). */
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
  const track = wheelTrack(p), t = (p.tandem ?? 0) / 2;
  return {
    noseZ, tailZ, windshieldBaseZ, roofFrontZ, roofRearZ, rearBaseZ,
    wheels: t
      ? [[track, -front], [-track, -front], [track, rear - t], [-track, rear - t], [track, rear + t], [-track, rear + t]]
      : [[track, -front], [-track, -front], [track, rear], [-track, rear]],
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
  if (p.cargo && p.foodTruck) return [sectionLoft([...front, sec(L.rearBaseZ, p.belt)], color), ...hollowBox(p, f, color)];
  if (p.cargo && p.logTruck) {
    // Grumier : la cabine seule, fermée derrière par sa paroi pleine (le plateau est dans les détails).
    const top = (p.cabHeight ?? p.height) - 0.02;
    return [sectionLoft([...front, sec(L.rearBaseZ, p.belt)], color), sectionLoft([sec(L.roofRearZ - 0.05, top), sec(L.rearBaseZ, top)], color)];
  }
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
  const top = p.cabHeight ?? p.height, roofColor = st.softTop ?? st.roof ?? color;
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
    // Montant A : celui du toit ; sous une capote, c'est le cadre du pare-brise, de la couleur de la caisse.
    parts.push(tube(at(shoulder - 0.01, p.belt, L.windshieldBaseZ + 0.02), at(roofW, top - 0.04, L.roofFrontZ), 0.035, st.softTop ? color : roofColor, 4, false));
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
  if (st.spareWheel) {
    // Roue de secours sur la face arrière, axe dans la longueur.
    const w = carWheelGeometry(p.wheelRadius, p.tyreWidth, 12, st.rim);
    w.rotateY(Math.PI / 2);
    w.translate(0, Math.max(p.belt - 0.05, p.wheelRadius + p.clearance), L.tailZ + p.tyreWidth / 2 - 0.01);
    parts.push(w);
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
    // Derrière la cabine d'un grumier, pas de flanc : des garde-boue (dans `logTruckParts`).
    if (st.fenders || (p.logTruck && z > L.rearBaseZ)) continue;
    // Passage de roue : une demi-ellipse sombre contre le flanc, derrière la face du pneu ; cerclée de plastique sur un SUV.
    if (st.cladding) parts.push(arch(s * (side - 0.01), s * (W - 0.027), p.wheelRadius, z, archR + 0.07, archR + 0.09, CLAD));
    parts.push(arch(s * (side - 0.02), s * (W - 0.021), p.wheelRadius, z, archR, archR + 0.02, DARK));
  }
  const lineTop = p.belt - ct - 0.015, lineBottom = p.clearance + 0.12;
  // Cabine avancée d'un grumier : la porte est au-dessus de la roue avant, de la longueur d'une porte de camion.
  const doorFront = p.logTruck ? L.windshieldBaseZ + 0.1 : Math.max(L.windshieldBaseZ + 0.06, front + archR + 0.08);
  const doorRear = p.logTruck ? doorFront + 1.2 : p.cargo ? L.rearBaseZ - 0.04 : st.doors === 2 ? Math.min(L.rearBaseZ - 0.08, rear - archR - 0.06) : bZ;
  const lines = st.doors === 2 && !p.cargo ? [doorFront, bZ, doorRear] : [doorFront, doorRear];
  // Porte coulissante d'une camionnette (pas sur un camion-restaurant : son flanc est l'ouverture de service).
  const sliding = p.cargo && !p.foodTruck && !p.logTruck;
  if (sliding) lines.push(L.rearBaseZ + 0.95);
  const handles = st.doors === 2 && !p.cargo ? [bZ - 0.18, doorRear - 0.16] : [doorRear - 0.18];
  if (sliding) handles.push(L.rearBaseZ + 0.85);
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
    if (sliding) {
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
  const top = p.cabHeight ?? p.height;
  const cabinW = roofW - 0.005;
  const glassEnd = p.cargo ? L.roofRearZ - 0.02 : L.rearBaseZ;
  const parts: THREE.BufferGeometry[] = [
    ...softTopParts(p, f),
    ...foodTruckParts(p, f),
    ...logTruckParts(p, f),
    // Habitacle en verre : du pied du pare-brise à celui de la lunette, posé sur l'épaule de la caisse, sous le toit.
    loft([
      { z: L.windshieldBaseZ, y0: p.belt - 0.01, y1: p.belt, w0: shoulder - 0.01, w1: shoulder - 0.02 },
      { z: L.roofFrontZ, y0: p.belt - 0.01, y1: top - 0.04, w0: shoulder - 0.005, w1: cabinW },
      { z: p.cargo ? glassEnd : L.roofRearZ, y0: p.belt - 0.01, y1: top - 0.04, w0: shoulder - 0.005, w1: cabinW },
      ...(p.cargo ? [] : [{ z: L.rearBaseZ, y0: p.belt - 0.01, y1: p.belt, w0: shoulder - 0.01, w1: shoulder - 0.02 }]),
    ], st.softTop ?? glass),
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

/**
 * Caisse creuse d'un camion-restaurant (D115) : sous l'ouverture, au-dessus, devant et derrière elle, en peinture ; le flanc opposé, plein. L'intérieur
 * (fond, comptoir) est dans les détails. Le vendeur se tient dedans, visible par l'ouverture.
 */
function hollowBox(p: CarBodyParams, f: Frame, color: string): THREE.BufferGeometry[] {
  const { L, side, tail } = f, t = p.foodTruck!, z0 = L.rearBaseZ - 0.01, h0 = L.rearBaseZ + t.from, h1 = L.rearBaseZ + t.to, top = p.height - 0.02;
  // Pavé de xa à xb, de y0 à y1, de za à zb ; `ct` : chanfrein des deux arêtes du haut.
  const block = (za: number, zb: number, y0: number, y1: number, xa: number, xb: number, ct = 0): THREE.BufferGeometry => {
    const v = (x: number, y: number, z: number): THREE.Vector3 => new THREE.Vector3(x, y, z);
    const ring = (z: number): Ring => (ct > 0
      ? [v(xa, y0, z), v(xb, y0, z), v(xb, y1 - ct, z), v(xb - ct, y1, z), v(xa + ct, y1, z), v(xa, y1 - ct, z)]
      : [v(xa, y0, z), v(xb, y0, z), v(xb, y1, z), v(xa, y1, z)]);
    return ringLoft([ring(za), ring(zb)], color);
  };
  return [
    block(z0, tail, p.clearance, t.bottom, -side, side),
    block(z0, tail, t.top, top, -side, side, 0.08),
    block(z0, h0, t.bottom, t.top, -side, side),
    block(h1, tail, t.bottom, t.top, -side, side),
    t.left ? block(h0, h1, t.bottom, t.top, side - 0.05, side) : block(h0, h1, t.bottom, t.top, -side, -side + 0.05),
  ];
}

/** Pixels (3 × 5) des lettres du lettrage des camions-restaurants, ligne par ligne du haut, colonne de gauche d'abord. */
const BLOCK_FONT: Record<string, readonly string[]> = {
  A: ["010", "101", "111", "101", "101"], E: ["111", "100", "110", "100", "111"], I: ["111", "010", "010", "010", "111"],
  O: ["111", "101", "101", "101", "111"], P: ["111", "101", "111", "100", "100"], R: ["110", "101", "110", "101", "101"],
  S: ["111", "100", "111", "001", "111"], T: ["111", "010", "010", "010", "010"], Z: ["111", "001", "010", "100", "111"],
  U: ["101", "101", "101", "101", "111"], N: ["101", "111", "111", "101", "101"],
};

/**
 * Lettrage en blocs sur un flanc (x = `x`), vu de l'extérieur : les colonnes d'une lettre vont vers `dir` (−1 : vers l'avant, lu sur le flanc droit ;
 * +1 : vers l'arrière, lu sur le flanc gauche). Chaque suite de pixels d'une ligne est une seule boîte. `z` : bord de départ de la première lettre ;
 * `y` : haut de la première lettre ; `px` : taille d'un pixel.
 */
export function blockLetters(text: string, x: number, z: number, y: number, px: number, vertical: boolean, color: string, dir: number): THREE.BufferGeometry[] {
  const parts: THREE.BufferGeometry[] = [];
  [...text].forEach((ch, i) => {
    const glyph = BLOCK_FONT[ch];
    if (!glyph) return;
    const lz = vertical ? z : z + dir * i * 4 * px, ly = vertical ? y - i * 6.5 * px : y;
    glyph.forEach((row, r) => {
      for (let c = 0; c < 3; c++) {
        if (row[c] !== "1") continue;
        let n = 1;
        while (c + n < 3 && row[c + n] === "1") n++;
        parts.push(box(0.012, px, n * px, x, ly - (r + 0.5) * px, lz + dir * (c + n / 2) * px, color));
        c += n - 1;
      }
    });
  });
  return parts;
}

/** Intérieur et équipement d'un camion-restaurant (D115) : fond, comptoir, auvent, lettrage, cheminée du four ou broches de la rôtisserie. */
function foodTruckParts(p: CarBodyParams, f: Frame): THREE.BufferGeometry[] {
  const t = p.foodTruck;
  if (!t) return [];
  const { L, side } = f, h0 = L.rearBaseZ + t.from, h1 = L.rearBaseZ + t.to, zm = (h0 + h1) / 2, len = h1 - h0;
  // s : flanc de l'ouverture (1 à droite, −1 à gauche) ; tout s'écrit pour le flanc droit, en x multiplié par s.
  const s = t.left ? -1 : 1, x = s * side;
  const parts: THREE.BufferGeometry[] = [
    // Fond de la caisse, plafond et plancher de l'ouverture (vus par elle).
    box(0.02, t.top - t.bottom, len, s * (-side + 0.06), (t.top + t.bottom) / 2, zm, t.interior),
    box(2 * side - 0.1, 0.02, len, 0, t.top - 0.012, zm, t.interior),
    // Comptoir qui dépasse dehors.
    box(0.42, 0.05, len - 0.1, x + s * 0.06, t.bottom + 0.025, zm, t.counter),
  ];
  // Auvent relevé au-dessus de l'ouverture : il part du haut de l'ouverture vers l'extérieur, en montant un peu (bandes de deux couleurs si rayé).
  const bands = t.stripe ? 8 : 1, reach = 0.95;
  for (let k = 0; k < bands; k++) {
    const g = new THREE.BoxGeometry(0.03, reach, len / bands + 0.002);
    g.translate(0, reach / 2, 0);
    g.rotateZ(-s * (Math.PI / 2 - 0.3));
    g.translate(x + s * 0.02, t.top + 0.03, h0 + (k + 0.5) * (len / bands));
    parts.push(paint(g, k % 2 && t.stripe ? t.stripe : t.awning));
  }
  // Lettrage : à droite, il part de son bord arrière vers l'avant ; à gauche, de son bord avant vers l'arrière (même place, lisible des deux côtés).
  const L0 = t.lettering, lx = x + s * 0.006;
  if (L0.vertical) parts.push(...blockLetters(L0.text, lx, h0 - 0.16 - (s < 0 ? 3 * 0.065 : 0), p.height - 0.4, 0.065, true, L0.color, -s));
  else parts.push(...blockLetters(L0.text, lx, h1 - 0.05 - (s < 0 ? (4 * L0.text.length - 1) * 0.07 : 0), p.height - 0.12, 0.07, false, L0.color, -s));
  if (t.oven) {
    // Four à bois au fond : sa bouche rougeoie ; cheminée noire sur le toit.
    parts.push(box(0.5, 0.75, 0.9, s * (-side + 0.32), t.bottom + 0.375, h1 - 0.55, "#7a6a5c"), box(0.02, 0.28, 0.4, s * (-side + 0.58), t.bottom + 0.3, h1 - 0.55, "#f08a2c"));
    parts.push(...chimney(p, f));
  }
  if (t.spits) {
    // Rôtissoire : trois broches de poulets dorés devant un fond rougeoyant.
    parts.push(box(0.02, 0.9, len - 0.3, s * (-side + 0.08), t.bottom + 0.55, zm, "#e8641e"));
    for (const y of [0.3, 0.6, 0.9]) {
      parts.push(tube(new THREE.Vector3(s * (-side + 0.35), t.bottom + y, h0 + 0.1), new THREE.Vector3(s * (-side + 0.35), t.bottom + y, h1 - 0.1), 0.012, "#c9ccd0", 5, false));
      for (let k = 0; k < 5; k++) parts.push(box(0.16, 0.13, 0.18, s * (-side + 0.35), t.bottom + y, h0 + 0.25 + k * ((len - 0.5) / 4), "#b4692f"));
    }
  }
  return parts;
}

/** Grumier (D116) : tout ce qui est derrière la cabine, en couleurs fixes (voir `LogTruck`). */
function logTruckParts(p: CarBodyParams, f: Frame): THREE.BufferGeometry[] {
  const t = p.logTruck;
  if (!t) return [];
  const { L, side } = f, parts: THREE.BufferGeometry[] = [];
  const z0 = L.rearBaseZ, z1 = L.tailZ - 0.05, bed = t.bed, r = 0.21;
  // Châssis : deux longerons de la cabine à la queue.
  for (const s of [-1, 1]) parts.push(box(0.16, 0.3, z1 - z0 + 0.6, s * 0.45, bed - 0.15, (z0 - 0.6 + z1) / 2, DARK));
  // Pare-cycliste (deux lisses) et réservoir, entre la roue avant et le tandem.
  const g0 = L.wheels[0]![1] + p.wheelRadius + 0.25, g1 = L.wheels[2]![1] - p.wheelRadius - 0.2;
  for (const s of [-1, 1]) {
    for (const y of [p.clearance + 0.2, p.clearance + 0.5]) parts.push(box(0.03, 0.07, g1 - g0, s * (side - 0.03), y, (g0 + g1) / 2, TRIM));
  }
  parts.push(box(0.5, 0.5, 1.1, -(side - 0.33), p.clearance + 0.4, Math.max(g0, z0) + 0.65, CHROME));
  // Garde-boue au-dessus du tandem.
  const ra = L.wheels[2]![1], rb = L.wheels[L.wheels.length - 1]![1], track = wheelTrack(p);
  for (const s of [-1, 1]) parts.push(box(p.tyreWidth + 0.02, 0.04, rb - ra + 2 * p.wheelRadius + 0.15, s * track, 2 * p.wheelRadius + 0.1, (ra + rb) / 2, DARK));
  // Barre des feux arrière, sous le plateau (les feux sont posés dessus, `tailParts`).
  parts.push(box(2 * side - 0.1, 0.16, 0.08, 0, p.clearance + 0.62, L.tailZ - FACE - 0.05, DARK));
  // Échappement vertical, contre la paroi arrière de la cabine.
  parts.push(tube(new THREE.Vector3(side - 0.2, bed - 0.2, z0 + 0.12), new THREE.Vector3(side - 0.2, (p.cabHeight ?? p.height) + 0.3, z0 + 0.12), 0.06, CHROME, 8, false));
  // Hauteur des grumes empilées en trois rangs (5, 4, 3), sur des bancs de 12 cm.
  const rise = 2 * r * Math.sin(Math.PI / 3), logTop = bed + 0.12 + 2 * r + 2 * rise;
  // Grue repliée, juste derrière la cabine : colonne, flèche couchée sur les grumes, bras replié dessus, grappin posé sur la pile.
  const cz = z0 + 0.4;
  parts.push(box(0.8, 0.3, 0.6, 0, bed + 0.15, cz, t.crane), box(2 * side - 0.1, 0.16, 0.22, 0, bed - 0.12, cz, t.crane));
  parts.push(tube(new THREE.Vector3(0, bed + 0.3, cz), new THREE.Vector3(0, logTop + 0.62, cz), 0.16, t.crane, 8));
  parts.push(box(0.22, 0.26, 3.5, 0.3, logTop + 0.25, cz + 1.75, t.crane), box(0.18, 0.2, 2.6, 0.3, logTop + 0.48, cz + 1.4, t.crane));
  parts.push(box(0.36, 0.3, 0.4, 0.3, logTop + 0.15, cz + 3.35, DARK));
  // Ridelle avant : deux montants et trois lisses, entre la grue et les grumes.
  const hz = cz + 0.4;
  for (const s of [-1, 1]) parts.push(box(0.1, logTop - bed + 0.15, 0.1, s * (side - 0.08), (bed + logTop + 0.15) / 2, hz, DARK));
  for (const y of [bed + 0.35, (bed + logTop) / 2 + 0.1, logTop + 0.05]) parts.push(box(2 * side - 0.12, 0.08, 0.08, 0, y, hz, DARK));
  // Deux piles de grumes, chacune sur deux bancs à ranchers.
  const zs = hz + 0.12, gap = 0.25, len = (z1 - 0.02 - zs - gap) / 2;
  for (let k = 0; k < 2; k++) {
    const a = zs + k * (len + gap), zm = a + len / 2;
    for (const zb of [a + 0.45, a + len - 0.45]) {
      parts.push(box(2 * side - 0.04, 0.12, 0.18, 0, bed + 0.06, zb, DARK));
      for (const s of [-1, 1]) parts.push(box(0.09, logTop - bed - 0.1, 0.09, s * (side - 0.06), (bed + logTop - 0.1) / 2, zb, DARK));
    }
    [5, 4, 3].forEach((n, j) => {
      for (let i = 0; i < n; i++) {
        // Diamètres et longueurs un peu inégaux (tirés de la place de la grume) : un chargement de bois, pas des tubes.
        const h = (i * 7 + j * 3 + k * 5) % 5, rr = r * (0.84 + 0.04 * h), ll = len - 0.05 * ((i + j + k) % 3);
        const x = (i - (n - 1) / 2) * 2 * r, y = bed + 0.12 + r + j * rise, z = zm + 0.04 * ((h % 3) - 1);
        const g = new THREE.CylinderGeometry(rr, rr, ll, 7, 1, true);
        g.rotateX(Math.PI / 2);
        g.translate(x, y, z);
        parts.push(paint(g, t.bark));
        for (const e of [-1, 1]) {
          const c = new THREE.CircleGeometry(rr * 0.97, 7);
          if (e < 0) c.rotateY(Math.PI);
          c.translate(x, y, z + e * (ll / 2 + 0.002));
          parts.push(paint(c, t.wood));
        }
      }
    });
  }
  return parts;
}

/** Position (repère du véhicule) du haut de la cheminée d'un camion à four à bois, pour sa fumée ; null sans four. */
export function chimneyTop(p: CarBodyParams, front: number, rear: number): [number, number, number] | null {
  if (!p.foodTruck?.oven) return null;
  const L = carLayout(p, front, rear);
  return [(p.foodTruck.left ? -1 : 1) * (p.width / 2 - 0.55), p.height + 0.6, L.rearBaseZ + p.foodTruck.to - 0.55];
}

function chimney(p: CarBodyParams, f: Frame): THREE.BufferGeometry[] {
  const [x, y, z] = chimneyTop(p, f.front, f.rear)!;
  const g = new THREE.CylinderGeometry(0.09, 0.09, 0.6, 8);
  g.translate(x, y - 0.3, z);
  const cap = new THREE.CylinderGeometry(0.16, 0.12, 0.08, 8);
  cap.translate(x, y + 0.02, z);
  return [paint(g, "#1d1f24"), paint(cap, "#1d1f24")];
}

/**
 * Où se tient le vendeur d'un camion-restaurant (repère du véhicule : pieds au plancher, face à l'ouverture), et le flanc de l'ouverture (`side` : 1 à
 * droite, −1 à gauche) ; null pour un autre véhicule.
 */
export function vendorSpot(p: CarBodyParams, front: number, rear: number): { x: number; y: number; z: number; side: number } | null {
  const t = p.foodTruck;
  if (!t) return null;
  const L = carLayout(p, front, rear), side = t.left ? -1 : 1;
  return { x: side * (p.width / 2 - 0.75), y: t.bottom - 0.95, z: L.rearBaseZ + t.from + 0.6, side };
}

/** Sous une capote (D114) : pare-brise droit dans son cadre, deux fenêtres souples de chaque côté, une à l'arrière. */
function softTopParts(p: CarBodyParams, f: Frame): THREE.BufferGeometry[] {
  if (!p.style.softTop) return [];
  const { L, shoulder, roofW } = f, glass = p.glass ?? "#2b3a4c", top = p.height;
  const rise = top - 0.05 - p.belt, run = L.roofFrontZ - L.windshieldBaseZ, tilt = Math.atan2(run, rise), h = Math.hypot(rise, run);
  const yc = p.belt + rise / 2, zc = (L.windshieldBaseZ + L.roofFrontZ) / 2 - 0.014 * Math.cos(tilt);
  const parts = [tiltedBox(2 * Math.min(shoulder, roofW) - 0.1, h - 0.06, 0.02, 0, yc, zc, tilt, glass)];
  for (const s of [-1, 1]) {
    for (const z of [L.roofFrontZ + 0.4, L.roofRearZ - 0.5]) parts.push(box(0.012, 0.32, 0.55, s * (roofW + 0.004), p.belt + (top - p.belt) * 0.55, z, glass));
  }
  parts.push(box(0.8, 0.28, 0.012, 0, p.belt + (top - p.belt) * 0.55, L.rearBaseZ + 0.004, glass));
  return parts;
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
