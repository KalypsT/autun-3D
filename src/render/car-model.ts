import * as THREE from "three";
import { vehicleDef } from "../core/vehicle-catalog";
import type { VehicleState } from "../core/vehicle";
import { bodyDetailGeometry, bodyPaintGeometry, carLayout, carWheelGeometry, chimneyTop, vendorSpot, type CarBodyParams } from "./car-body";
import { merge, sharedMaterial, type VehicleModel } from "./vehicle-model";
import { CITADINE } from "./car-citadine";
import { COMPACTE } from "./car-compacte";
import { BERLINE } from "./car-berline";
import { BREAK } from "./car-break";
import { PETIT_SUV } from "./car-petit-suv";
import { SUPERCAR } from "./car-supercar";
import { Crumpler, type CrumpleFrame } from "./car-damage";
import type { Zone } from "../core/damage";

/**
 * Voitures aux couleurs de l'affiche, générées d'après leurs mesures et leur style (`car-body.ts`) : chaque modèle a sa silhouette, ses phares, sa calandre,
 * ses feux et ses jantes, pour qu'on le reconnaisse de loin (D107).
 * Repère local : avant vers −z, haut +y, origine au centre de gravité (au sol).
 * Deux usages : la voiture conduite (caisse + quatre roues, celles de devant braquent) et les voitures garées,
 * dessinées par instances (`parked-models.ts`, une géométrie au repos par modèle, tous les exemplaires d'un modèle en un seul maillage).
 */

/** Mesures de chaque voiture du catalogue (même identifiants que `src/core/vehicle-catalog.ts`). */
export const CAR_BODIES: Record<string, CarBodyParams> = {
  // Citadine (D271, D272) : caisse sculptée d'après photos (`car-citadine.ts`) ; le style ci-dessous ne sert plus qu'à sa signature et à ses jantes.
  citadine: {
    length: 4.06, width: 1.73, height: 1.45, overhangFront: 0.8,
    clearance: 0.22, belt: 0.88, noseHeight: 0.71, tailHeight: 0.98,
    hood: 1.12, windshield: 0.86, roof: 1.12, rearGlass: 0.62, roofTaper: 0.84,
    beltRise: 0.1, roofDrop: 0.07,
    wheelRadius: 0.32, tyreWidth: 0.2, glass: "#222a35", sculpt: CITADINE,
    style: {
      headlights: "swept", grille: "band", taillights: "wrap", bumpers: "blend", rim: "#c3c6cb", doors: 2, roundness: 0.8,
      blackPillars: true, spoiler: "roof", lowerGrille: true, hiddenRearHandles: true, doorBlade: true, tailChrome: true, diffuser: true, spokes: 5,
    },
  },
  // Compacte (D273) : caisse sculptée d'après photos (`car-compacte.ts`) ; les mesures servent aux essieux, à la caméra et à la fumée.
  compacte: {
    length: 4.37, width: 1.85, height: 1.44, overhangFront: 0.894,
    clearance: 0.2, belt: 0.9, noseHeight: 0.7, tailHeight: 0.98,
    hood: 1.32, windshield: 0.83, roof: 1.55, rearGlass: 0.36, roofTaper: 0.86,
    wheelRadius: 0.325, tyreWidth: 0.22, glass: "#1f2731", sculpt: COMPACTE,
    style: { headlights: "almond", grille: "slim", taillights: "horizontal", bumpers: "paint", rim: "#5d6168", doors: 2, roundness: 0.6, spoiler: "roof", intake: true, spokes: 6 },
  },
  // Berline (D274) : caisse sculptée d'après photos (`car-berline.ts`) ; les mesures servent aux essieux, à la caméra et à la fumée.
  berline: {
    length: 4.72, width: 1.85, height: 1.44, overhangFront: 0.86,
    clearance: 0.2, belt: 0.86, noseHeight: 0.62, tailHeight: 0.98,
    hood: 1.3, windshield: 1.05, roof: 1.05, rearGlass: 0.85, roofTaper: 0.86,
    wheelRadius: 0.335, tyreWidth: 0.23, glass: "#1c232c", sculpt: BERLINE,
    style: { headlights: "rect", grille: "chrome", taillights: "horizontal", bumpers: "paint", rim: "#8d9198", doors: 2, roundness: 0.35, chromeTrim: true, exhaust: 1, spokes: 7 },
  },
  // Break (D274) : caisse sculptée d'après photos (`car-break.ts`) ; les mesures servent aux essieux, à la caméra et à la fumée.
  break: {
    length: 4.83, width: 1.86, height: 1.45, overhangFront: 0.93,
    clearance: 0.2, belt: 0.9, noseHeight: 0.66, tailHeight: 0.98,
    hood: 1.45, windshield: 0.85, roof: 2.2, rearGlass: 0.16, roofTaper: 0.86,
    wheelRadius: 0.345, tyreWidth: 0.23, glass: "#1c232c", sculpt: BREAK,
    style: { headlights: "rect", grille: "tall", taillights: "vertical", bumpers: "paint", rim: "#b3b6bb", doors: 2, roundness: 0.5, roofRails: true, spokes: 10 },
  },

  // Petit SUV (D275) : caisse sculptée d'après photos (`car-petit-suv.ts`) ; les mesures servent aux essieux, à la caméra et à la fumée.
  "petit-suv": {
    length: 4.59, width: 1.89, height: 1.62, overhangFront: 0.93,
    clearance: 0.24, belt: 1.12, noseHeight: 0.95, tailHeight: 1.1,
    hood: 1.38, windshield: 0.66, roof: 1.95, rearGlass: 0.25, roofTaper: 0.9,
    wheelRadius: 0.36, tyreWidth: 0.24, glass: "#1c232c", sculpt: PETIT_SUV,
    style: { headlights: "strip", grille: "tall", taillights: "bar", bumpers: "trim", rim: "#6b6f76", doors: 2, roundness: 0.6, roof: "#24262b", cladding: true, roofRails: true, blackPillars: true, spokes: 8 },
  },
  camionnette: {
    length: 4.9, width: 1.95, height: 1.95, overhangFront: 0.9,
    clearance: 0.26, belt: 1.05, noseHeight: 0.95, tailHeight: 1.9,
    hood: 1.0, windshield: 0.75, roof: 1.1, rearGlass: 0, roofTaper: 0.94,
    wheelRadius: 0.33, tyreWidth: 0.22, cargo: true,
    style: { headlights: "rect", grille: "slim", taillights: "vertical", bumpers: "trim", rim: "#7d7f84", doors: 1, roundness: 0.45, rearDoors: true },
  },
  "vieille-voiture": {
    length: 4.1, width: 1.68, height: 1.4, overhangFront: 0.78,
    clearance: 0.24, belt: 0.86, noseHeight: 0.78, tailHeight: 0.92,
    hood: 1.2, windshield: 0.5, roof: 1.3, rearGlass: 0.35, roofTaper: 0.92,
    wheelRadius: 0.29, tyreWidth: 0.17, glass: "#3a4a5a",
    style: { headlights: "round", grille: "chrome", taillights: "round", bumpers: "chrome", rim: "#e6dcc4", doors: 1, roundness: 1, fenders: true },
  },
  // Gendarmerie (J4, D72) : la caisse de la compacte, bleu nuit, bandes claires sur les flancs, barre de gyrophares sur le toit.
  gendarmerie: {
    length: 4.25, width: 1.8, height: 1.46, overhangFront: 0.85,
    clearance: 0.27, belt: 0.9, noseHeight: 0.82, tailHeight: 0.95,
    hood: 1.2, windshield: 0.62, roof: 1.3, rearGlass: 0.78, roofTaper: 0.9,
    wheelRadius: 0.31, tyreWidth: 0.2,
    livery: { stripe: "#eef1f4", accent: "#4a8fd8", lightBar: true },
    style: { headlights: "almond", grille: "slim", taillights: "horizontal", bumpers: "trim", rim: "#7d7f84", doors: 2, roundness: 0.6, intake: true },
  },
  // Jeep militaire (D114) : courte, carrée, haute, capote en toile, roue de secours, phares ronds, pare-chocs noirs, grandes roues tout-terrain.
  "jeep-militaire": {
    length: 3.85, width: 1.84, height: 1.88, overhangFront: 0.6,
    clearance: 0.4, belt: 1.12, noseHeight: 1.06, tailHeight: 1.1,
    hood: 1.05, windshield: 0.12, roof: 2.05, rearGlass: 0.06, roofTaper: 0.97,
    wheelRadius: 0.38, tyreWidth: 0.27,
    style: { headlights: "round", grille: "tall", taillights: "round", bumpers: "trim", rim: "#3f4a2e", doors: 1, roundness: 0.05, softTop: "#6e6a48", spareWheel: true },
  },
  // Camions-restaurants (D115) : cabine d'utilitaire, caisse haute et creuse ouverte sur un flanc pour le service (à gauche pour la pizza : sa place
  // la met dos à la route, le parking à sa gauche).
  "pizza-du-vallon": {
    length: 6, width: 2.2, height: 3, cabHeight: 2.45, overhangFront: 0.85,
    clearance: 0.32, belt: 1.18, noseHeight: 1.05, tailHeight: 2.95,
    hood: 0.75, windshield: 0.65, roof: 0.75, rearGlass: 0, roofTaper: 0.94,
    wheelRadius: 0.37, tyreWidth: 0.24, cargo: true,
    style: { headlights: "rect", grille: "slim", taillights: "vertical", bumpers: "trim", rim: "#c9ccd0", doors: 1, roundness: 0.45, cladding: true },
    foodTruck: {
      from: 0.65, to: 2.85, bottom: 1.25, top: 2.35, interior: "#5a1f2a", counter: "#8fd14f", awning: "#6fb532",
      lettering: { text: "PIZZA", color: "#d9472b", vertical: true }, oven: true, left: true,
    },
  },
  "rotisserie-champ-de-mars": {
    length: 6, width: 2.2, height: 2.9, cabHeight: 2.4, overhangFront: 0.85,
    clearance: 0.32, belt: 1.18, noseHeight: 1.05, tailHeight: 2.85,
    hood: 0.75, windshield: 0.65, roof: 0.75, rearGlass: 0, roofTaper: 0.94,
    wheelRadius: 0.37, tyreWidth: 0.24, cargo: true,
    style: { headlights: "rect", grille: "slim", taillights: "vertical", bumpers: "trim", rim: "#b9b4a8", doors: 1, roundness: 0.45, cladding: true },
    foodTruck: {
      from: 0.45, to: 3.0, bottom: 1.2, top: 2.2, interior: "#3b3d42", counter: "#c9ccd0", awning: "#d9472b", stripe: "#efe9df",
      lettering: { text: "ROTISSERIE", color: "#d9472b", vertical: false }, spits: true,
    },
  },
  sportive: {
    length: 4.45, width: 1.88, height: 1.25, overhangFront: 0.92,
    clearance: 0.12, belt: 0.78, noseHeight: 0.6, tailHeight: 0.84,
    hood: 1.55, windshield: 0.85, roof: 0.75, rearGlass: 0.7, roofTaper: 0.84,
    wheelRadius: 0.33, tyreWidth: 0.26, glass: "#1b2733",
    style: { headlights: "almond", grille: "sport", taillights: "bar", bumpers: "paint", rim: "#2e3035", doors: 1, roundness: 0.7, roof: "#1b1d22", spoiler: "wing", hoodScoop: true, exhaust: 2, blackPillars: true },
  },
  // Supercar (D276, véhicule unique) : caisse sculptée d'après photos (`car-supercar.ts`) ; les mesures servent aux essieux, à la caméra et à la fumée.
  supercar: {
    length: 4.94, width: 2.03, height: 1.14, overhangFront: 1.1,
    clearance: 0.11, belt: 0.82, noseHeight: 0.42, tailHeight: 0.92,
    hood: 1.2, windshield: 0.66, roof: 0.75, rearGlass: 0.6, roofTaper: 0.62,
    wheelRadius: 0.34, tyreWidth: 0.3, glass: "#1b2330", sculpt: SUPERCAR,
    style: { headlights: "almond", grille: "sport", taillights: "bar", bumpers: "paint", rim: "#6a6e76", doors: 1, roundness: 0.5, spoiler: "wing", exhaust: 2, blackPillars: true, spokes: 5 },
  },
  // Bus urbain (D204) : caisse longue et haute d'un seul tenant, pare-brise presque vertical, grandes vitres, deux tons (bleu, bas crème).
  "bus-urbain": {
    length: 9.2, width: 2.5, height: 3.1, cabHeight: 3.1, overhangFront: 1.4,
    clearance: 0.32, belt: 1.15, noseHeight: 1.2, tailHeight: 3.0,
    hood: 0.1, windshield: 0.35, roof: 7.6, rearGlass: 0.2, roofTaper: 0.98,
    wheelRadius: 0.48, tyreWidth: 0.3, glass: "#2a3a48",
    livery: { stripe: "#e8e4da", accent: "#f1b24a", lightBar: false },
    style: { headlights: "strip", grille: "slim", taillights: "bar", bumpers: "paint", rim: "#e8e4da", doors: 2, roundness: 0.2 },
  },
  // Camion poubelle (D204) : cabine avancée, benne haute et carrée derrière.
  "benne-ordures": {
    length: 9.2, width: 2.5, height: 3.3, cabHeight: 2.95, overhangFront: 1.3,
    clearance: 0.42, belt: 1.75, noseHeight: 1.25, tailHeight: 3.2,
    hood: 0.2, windshield: 0.3, roof: 1.55, rearGlass: 0.12, roofTaper: 0.95,
    wheelRadius: 0.5, tyreWidth: 0.34, cargo: true,
    livery: { stripe: "#3f7d4e", accent: "#f1b24a", lightBar: false },
    style: { headlights: "round", grille: "tall", taillights: "vertical", bumpers: "chrome", rim: "#3f7d4e", doors: 1, roundness: 0.25 },
  },
  // Grumier du Morvan (D116) : cabine avancée rouge, porteur à trois essieux (tandem arrière), deux piles de grumes, grue jaune repliée.
  "grumier-morvan": {
    length: 9.2, width: 2.5, height: 3.33, cabHeight: 3.05, overhangFront: 1.3,
    clearance: 0.45, belt: 1.85, noseHeight: 1.25, tailHeight: 1.1,
    hood: 0.2, windshield: 0.3, roof: 1.65, rearGlass: 0.15, roofTaper: 0.95,
    wheelRadius: 0.5, tyreWidth: 0.34, cargo: true, tandem: 1.36,
    style: { headlights: "rect", grille: "tall", taillights: "horizontal", bumpers: "trim", rim: "#c9ccd0", doors: 1, roundness: 0.25 },
    logTruck: { bed: 1.25, bark: "#5a4632", wood: "#d9b98a", crane: "#d9a21b" },
  },
};

function specOf(id: string): { front: number; rear: number } {
  const def = vehicleDef(id);
  if (!def) throw new Error(`voiture inconnue : ${id}`);
  return def.spec;
}

/** Pour une voiture du catalogue : mesures, distances aux essieux et agencement. */
function bodyOf(id: string): { p: CarBodyParams; front: number; rear: number } {
  const p = CAR_BODIES[id];
  if (!p) throw new Error(`pas de carrosserie pour ${id}`);
  return { p, ...specOf(id) };
}

/** Maillage d'une caisse prête à l'emploi : peinture (de la couleur donnée) et détails (verre, pare-chocs, feux…). */
export function createCarModel(id: string, color: string): VehicleModel {
  const { p, front, rear } = bodyOf(id);
  const layout = carLayout(p, front, rear);
  const bodyGeo = bodyPaintGeometry(p, front, rear, color);
  const detailGeo = bodyDetailGeometry(p, front, rear);
  const wheelGeo = carWheelGeometry(p.wheelRadius, p.tyreWidth, 14, p.style.rim, p.style.spokes);
  // Dégâts (D110) : préparés à la première bosse seulement (copie des positions et des couleurs d'origine).
  const frame = crumpleFrame(p, front, rear);
  let crumplers: Crumpler[] | null = null;
  const mat = sharedMaterial();
  const mesh = (g: THREE.BufferGeometry): THREE.Mesh => {
    const m = new THREE.Mesh(g, mat);
    m.castShadow = true;
    m.receiveShadow = true;
    return m;
  };
  const group = new THREE.Group();
  group.rotation.order = "YXZ";
  // Caisse suspendue : elle prend le roulis, les roues restent au sol.
  const body = new THREE.Group();
  body.add(mesh(bodyGeo), mesh(detailGeo));
  group.add(body);
  const wheels = layout.wheels.map(([x, z]) => {
    const pivot = new THREE.Group();
    pivot.position.set(x, p.wheelRadius, z);
    const w = mesh(wheelGeo);
    w.rotation.order = "YXZ";
    pivot.add(w);
    group.add(pivot);
    return w;
  });
  return {
    group,
    seat: new THREE.Vector3(0.38, 0.45, 0.4),
    pose: "hidden",
    update(s: VehicleState) {
      group.position.set(s.x, s.z, -s.y);
      group.rotation.set(s.pitch, -s.heading, 0);
      body.rotation.z = -s.lean;
      wheels.forEach((w, i) => {
        w.rotation.y = i < 2 ? -s.steer : 0;
        w.rotation.x = -s.wheel;
      });
    },
    setDamage(zones) {
      crumplers ??= [new Crumpler(bodyGeo, frame, true), new Crumpler(detailGeo, frame, false)];
      const broken = crumplers[0]!.apply(zones);
      crumplers[1]!.apply(zones);
      return broken;
    },
    dispose() {
      bodyGeo.dispose();
      detailGeo.dispose();
      wheelGeo.dispose();
    },
  };
}

function crumpleFrame(p: CarBodyParams, front: number, rear: number): CrumpleFrame {
  const layout = carLayout(p, front, rear);
  return {
    noseZ: layout.noseZ, tailZ: layout.tailZ, halfWidth: p.width / 2, belt: p.belt,
    light: ["#f5ecd2", "#f1a03a"], tail: ["#e0442c", "#9c2a1c"], glass: p.glass ?? "#2b3a4c",
  };
}

/**
 * Forme « abîmée » d'un modèle (D112), commune à tous ses exemplaires cabossés dessinés par instances (garés, circulation) : un avant bien enfoncé,
 * l'arrière et les flancs touchés, un phare cassé, le pare-brise fêlé. Les bosses exactes d'une voiture n'existent que sur celle qu'on conduit.
 */
export const DENT: Readonly<Record<Zone, number>> = { front: 0.6, rear: 0.3, left: 0.35, right: 0.15 };
/** Suffixe des modèles dessinés sous leur forme abîmée (`citadine#dent`). */
export const DENTED = "#dent";

/** Identifiant du modèle sans le suffixe de la forme abîmée. */
export function baseModel(id: string): string {
  const i = id.indexOf("#");
  return i < 0 ? id : id.slice(0, i);
}

/** Caisse peinte (en blanc) et détails d'une voiture, abîmés si l'identifiant porte le suffixe `#dent`. */
function bodyParts(id: string): { paint: THREE.BufferGeometry; detail: THREE.BufferGeometry; p: CarBodyParams; front: number; rear: number } {
  const { p, front, rear } = bodyOf(baseModel(id));
  const paint = bodyPaintGeometry(p, front, rear, "#ffffff"), detail = bodyDetailGeometry(p, front, rear);
  if (id.endsWith(DENTED)) {
    const frame = crumpleFrame(p, front, rear);
    new Crumpler(paint, frame, true, false).apply(DENT);
    new Crumpler(detail, frame, false).apply(DENT);
  }
  return { paint, detail, p, front, rear };
}

/** Caisse sans roues (circulation, D65) : peinture blanche et détails ; `citadine#dent` : la forme abîmée. */
export function carBodyGeometry(id: string): THREE.BufferGeometry {
  const { paint, detail } = bodyParts(id);
  return merge([paint, detail]);
}

/** Géométrie au repos d'une voiture garée : caisse (peinture blanche), détails et roues dans une seule géométrie ; `citadine#dent` : la forme abîmée. */
export function carRestGeometry(id: string): THREE.BufferGeometry {
  const { paint, detail, p, front, rear } = bodyParts(id);
  const parts = [paint, detail];
  for (const [x, z] of carLayout(p, front, rear).wheels) {
    const w = carWheelGeometry(p.wheelRadius, p.tyreWidth, 10, p.style.rim, p.style.spokes, Math.sign(x));
    w.translate(x, p.wheelRadius, z);
    parts.push(w);
  }
  return merge(parts);
}

/** Camion-restaurant (D115) : où se tient le vendeur (repère du véhicule), ou null pour un autre modèle. */
export function vendorOf(id: string): { x: number; y: number; z: number; side: number } | null {
  const p = CAR_BODIES[id], def = vehicleDef(id);
  return p && def ? vendorSpot(p, def.spec.front, def.spec.rear) : null;
}

/** Camion à four à bois (D115) : haut de la cheminée (repère du véhicule), ou null. */
export function chimneyOf(id: string): [number, number, number] | null {
  const p = CAR_BODIES[id], def = vehicleDef(id);
  return p && def ? chimneyTop(p, def.spec.front, def.spec.rear) : null;
}

