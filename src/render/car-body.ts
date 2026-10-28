import * as THREE from "three";
import { box, merge, paint, tube } from "./vehicle-model";

/**
 * Générateur de carrosserie (D52) : une voiture est décrite par quelques mesures (longueur, hauteur, capot, pare-brise, toit, lunette, coffre),
 * pas par des boîtes à la main. Analogie : le patron d'un couturier, qui donne une robe différente à chaque mesure.
 * Repère local : avant vers −z, haut +y, origine au centre de gravité (au sol), x vers la droite du véhicule.
 *
 * La caisse est faite de « tranches » (des sections trapézoïdales posées le long de l'axe) reliées par des faces planes : le bas de caisse
 * (capot, flancs, coffre) et l'habitacle (verre), plus le toit, les montants, les pare-chocs, les feux et les roues en volumes simples (style « affiche »).
 */

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
/** Distance du nez (ou de la queue) à la face de la caisse, où se posent phares, feux et plaque (en saillie de 1,5 cm). */
const FACE = 0.035;
const TRIM = "#2c2c33";
const LIGHT = "#f5ecd2";
const TAIL = "#e0442c";
const PLATE = "#f1e6c8";

/** Positions des éléments, d'après les mesures et les distances du centre de gravité aux essieux. */
export function carLayout(p: CarBodyParams, front: number, rear: number): CarLayout {
  const noseZ = -(front + p.overhangFront);
  const tailZ = noseZ + p.length;
  const windshieldBaseZ = noseZ + p.hood;
  const roofFrontZ = windshieldBaseZ + p.windshield;
  const roofRearZ = roofFrontZ + p.roof;
  const rearBaseZ = roofRearZ + p.rearGlass;
  const track = p.width / 2 - 0.13;
  return {
    noseZ, tailZ, windshieldBaseZ, roofFrontZ, roofRearZ, rearBaseZ,
    wheels: [[track, -front], [-track, -front], [track, rear], [-track, rear]],
  };
}

interface Station {
  z: number;
  y0: number;
  y1: number;
  /** Demi-largeurs en bas et en haut de la section. */
  w0: number;
  w1: number;
}

const ZERO_UV = new Float32Array(2);

/**
 * Volume délimité par des sections trapézoïdales successives (de l'avant vers l'arrière), faces planes, normales vers l'extérieur.
 * Chaque face est orientée par rapport au centre du volume : les profils de carrosserie sont à peu près convexes, cela suffit.
 */
export function loft(stations: readonly Station[], color: string): THREE.BufferGeometry {
  const corners = (s: Station): THREE.Vector3[] => [
    new THREE.Vector3(-s.w0, s.y0, s.z), new THREE.Vector3(s.w0, s.y0, s.z), new THREE.Vector3(s.w1, s.y1, s.z), new THREE.Vector3(-s.w1, s.y1, s.z),
  ];
  const rings = stations.map(corners);
  const center = new THREE.Vector3();
  for (const r of rings) for (const c of r) center.add(c);
  center.divideScalar(rings.length * 4);
  const quads: THREE.Vector3[][] = [rings[0]!.slice().reverse(), rings[rings.length - 1]!.slice()];
  for (let i = 0; i + 1 < rings.length; i++) {
    const a = rings[i]!, b = rings[i + 1]!;
    for (let k = 0; k < 4; k++) quads.push([a[k]!, a[(k + 1) % 4]!, b[(k + 1) % 4]!, b[k]!]);
  }
  const pos: number[] = [], nor: number[] = [], uv: number[] = [];
  const ab = new THREE.Vector3(), ac = new THREE.Vector3(), n = new THREE.Vector3(), mid = new THREE.Vector3();
  for (const q of quads) {
    // Orientation : la normale de la face (a, b, c) doit regarder à l'opposé du centre du volume.
    const a = q[0]!, b = q[1]!, c = q[2]!, d = q[3]!;
    n.copy(ab.subVectors(b, a)).cross(ac.subVectors(c, a));
    mid.copy(a).add(b).add(c).add(d).multiplyScalar(0.25).sub(center);
    const flip = n.dot(mid) < 0;
    const tris = flip ? [[a, c, b], [a, d, c]] : [[a, b, c], [a, c, d]];
    for (const [u, v, w] of tris) {
      n.copy(ab.subVectors(v!, u!)).cross(ac.subVectors(w!, u!));
      if (n.lengthSq() < 1e-12) continue;
      n.normalize();
      for (const p of [u!, v!, w!]) {
        pos.push(p.x, p.y, p.z);
        nor.push(n.x, n.y, n.z);
        uv.push(ZERO_UV[0]!, ZERO_UV[1]!);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  return paint(g, color);
}

/** Caisse peinte (en blanc : la couleur vient de l'instance ou de `color`). */
export function bodyPaintGeometry(p: CarBodyParams, front: number, rear: number, color: string): THREE.BufferGeometry {
  const L = carLayout(p, front, rear), W = p.width / 2;
  const nose = L.noseZ + 0.04, tail = L.tailZ - 0.04;
  const roofW = (W - 0.08) * p.roofTaper;
  const top = p.height;
  const parts = [
    // Bas de caisse : capot qui monte vers le pare-brise, flancs à hauteur de ceinture, coffre.
    loft([
      { z: nose, y0: p.clearance, y1: p.noseHeight, w0: W - 0.04, w1: W - 0.1 },
      { z: L.windshieldBaseZ, y0: p.clearance, y1: p.belt, w0: W - 0.03, w1: W - 0.05 },
      { z: L.rearBaseZ, y0: p.clearance, y1: p.belt, w0: W - 0.03, w1: W - 0.05 },
      ...(p.cargo ? [] : [{ z: tail, y0: p.clearance, y1: p.tailHeight, w0: W - 0.04, w1: W - 0.08 }]),
    ], color),
    // Caisse de camionnette : de la cabine à la queue, toute la hauteur.
    ...(p.cargo ? [loft([
      { z: L.rearBaseZ, y0: p.clearance, y1: top - 0.02, w0: W - 0.03, w1: W - 0.05 },
      { z: tail, y0: p.clearance, y1: top - 0.02, w0: W - 0.04, w1: W - 0.06 },
    ], color)] : []),
    // Ailes au-dessus des roues : elles débordent un peu de la caisse.
    box(p.width, 0.16, p.wheelRadius * 3.1, 0, p.belt - 0.1, L.wheels[0]![1], color),
    box(p.width, 0.16, p.wheelRadius * 3.1, 0, p.belt - 0.1, L.wheels[2]![1], color),
    // Toit, un peu plus long que le verre qu'il couvre.
    box(roofW * 2, 0.05, p.roof + 0.1, 0, top - 0.025, (L.roofFrontZ + L.roofRearZ) / 2, color),
    // Montants, de chaque côté : A (le long du pare-brise), B (vertical, au milieu du toit), C (le long de la lunette).
    ...[-1, 1].flatMap((side) => {
      const at = (x: number, y: number, z: number): THREE.Vector3 => new THREE.Vector3(side * x, y, z);
      const midZ = (L.roofFrontZ + L.roofRearZ) / 2;
      return [
        tube(at(W - 0.07, p.belt, L.windshieldBaseZ), at(roofW, top - 0.03, L.roofFrontZ), 0.03, color, 4, false),
        tube(at(W - 0.06, p.belt, midZ), at(roofW + 0.04, top - 0.03, midZ), 0.03, color, 4, false),
        tube(at(W - 0.07, p.belt, L.rearBaseZ), at(roofW, top - 0.03, L.roofRearZ), 0.03, color, 4, false),
      ];
    }),
  ];
  return merge(parts);
}

/** Verre, pare-chocs, phares, feux, plaques, rétroviseurs : couleurs fixes. */
export function bodyDetailGeometry(p: CarBodyParams, front: number, rear: number): THREE.BufferGeometry {
  const L = carLayout(p, front, rear), W = p.width / 2;
  const glass = p.glass ?? "#2b3a4c";
  const top = p.height;
  const cabinW = (W - 0.08) * p.roofTaper;
  return merge([
    // Habitacle en verre : du pied du pare-brise à celui de la lunette.
    loft([
      { z: L.windshieldBaseZ, y0: p.belt, y1: p.belt + 0.01, w0: W - 0.07, w1: W - 0.08 },
      { z: L.roofFrontZ, y0: p.belt, y1: top - 0.02, w0: W - 0.06, w1: cabinW },
      { z: L.roofRearZ, y0: p.belt, y1: top - 0.02, w0: W - 0.06, w1: cabinW },
      { z: L.rearBaseZ, y0: p.belt, y1: p.belt + 0.01, w0: W - 0.07, w1: W - 0.08 },
    ], glass),
    // Pare-chocs avant et arrière (dépassent d'un peu de la caisse, nez et queue exacts).
    box(p.width - 0.02, 0.14, BUMPER, 0, p.clearance + 0.1, L.noseZ + BUMPER / 2, TRIM),
    box(p.width - 0.02, 0.14, BUMPER, 0, p.clearance + 0.1, L.tailZ - BUMPER / 2, TRIM),
    // Phares, calandre, feux, plaque.
    box(0.26, 0.14, 0.04, W * 0.68, p.noseHeight - 0.14, L.noseZ + FACE, LIGHT),
    box(0.26, 0.14, 0.04, -W * 0.68, p.noseHeight - 0.14, L.noseZ + FACE, LIGHT),
    box(W * 0.8, 0.08, 0.04, 0, p.noseHeight - 0.2, L.noseZ + FACE, TRIM),
    box(0.24, 0.12, 0.04, W * 0.7, p.tailHeight - 0.18, L.tailZ - FACE, TAIL),
    box(0.24, 0.12, 0.04, -W * 0.7, p.tailHeight - 0.18, L.tailZ - FACE, TAIL),
    box(0.4, 0.1, 0.03, 0, p.clearance + 0.22, L.tailZ - FACE, PLATE),
    // Rétroviseurs, dans la largeur hors tout.
    box(0.1, 0.08, 0.12, W - 0.07, p.belt + 0.1, L.windshieldBaseZ + 0.2, TRIM),
    box(0.1, 0.08, 0.12, -(W - 0.07), p.belt + 0.1, L.windshieldBaseZ + 0.2, TRIM),
    ...liveryParts(p, front, rear),
  ]);
}

/** Bandes des flancs et barre de gyrophares (éteinte : les feux allumés sont des instances à part, `beaconBoxes`). */
function liveryParts(p: CarBodyParams, front: number, rear: number): THREE.BufferGeometry[] {
  const lv = p.livery;
  if (!lv) return [];
  const L = carLayout(p, front, rear), W = p.width / 2;
  const z0 = L.noseZ + 0.35, z1 = L.tailZ - 0.3, mid = (p.clearance + p.belt) / 2;
  const parts = [-1, 1].flatMap((side) => [
    box(0.02, 0.16, z1 - z0, side * (W - 0.025), mid + 0.04, (z0 + z1) / 2, lv.stripe),
    box(0.02, 0.04, z1 - z0, side * (W - 0.025), mid - 0.08, (z0 + z1) / 2, lv.accent),
  ]);
  if (lv.lightBar) {
    const z = L.roofFrontZ + p.roof * 0.35;
    parts.push(box(1.0, BAR_HEIGHT * 0.5, 0.24, 0, p.height + BAR_HEIGHT * 0.25, z, "#d9dde2"));
    for (const b of beaconBoxes(p, front, rear)) parts.push(box(b.size[0] - 0.02, b.size[1] - 0.01, b.size[2] - 0.02, b.x, b.y, b.z, "#3d6fc4"));
  }
  return parts;
}

/** Roue : pneu, enjoliveur clair et un rayon plus clair encore (la rotation se voit). `segments` : facettes du pneu. */
export function carWheelGeometry(radius: number, width: number, segments: number): THREE.BufferGeometry {
  const tyre = new THREE.CylinderGeometry(radius, radius, width, segments);
  tyre.rotateZ(Math.PI / 2);
  const cap = new THREE.CylinderGeometry(radius * 0.55, radius * 0.55, width + 0.01, Math.max(8, segments - 4));
  cap.rotateZ(Math.PI / 2);
  return merge([paint(tyre, "#24242a"), paint(cap, "#cfc8b8"), box(width + 0.012, radius * 1.05, 0.06, 0, 0, 0, "#8a8478")]);
}

/** Détails et quatre roues dans une seule géométrie : voitures garées (instances). */
export function parkedDetailGeometry(p: CarBodyParams, front: number, rear: number): THREE.BufferGeometry {
  const parts = [bodyDetailGeometry(p, front, rear)];
  for (const [x, z] of carLayout(p, front, rear).wheels) {
    const w = carWheelGeometry(p.wheelRadius, p.tyreWidth, 10);
    w.translate(x, p.wheelRadius, z);
    parts.push(w);
  }
  return merge(parts);
}
