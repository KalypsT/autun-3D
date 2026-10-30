import * as THREE from "three";
import type { CarPose, TrainCar } from "../core/tourist-train";
import { recipeFromSeed } from "../core/character";
import { solveRide, type RideAnchors } from "../core/character-pose";
import { CharacterBatch } from "./crowd/character-batch";
import { CrowdRigs } from "./crowd/crowd-common";
import { blockLetters, carWheelGeometry } from "./car-body";
import { box, marker, merge, paint, sharedMaterial, tube, type VehicleModel } from "./vehicle-model";

/**
 * Petit train touristique (D117) : une fausse locomotive à vapeur (chaudière verte cerclée de laiton, cheminée noire, chasse-pierres rouge,
 * cabine ouverte au toit rouge, « AUTUN » en lettres dorées) et des wagons ouverts à bancs, toit vert à lambrequin rouge et blanc.
 * Repère de chaque voiture : avant vers −z, haut +y, x à droite, origine au sol entre les deux essieux. Une géométrie par sorte de voiture
 * (couleurs fixes, aucune teinte), quatre roues qui tournent.
 */

const GREEN = "#2f6b4f";
const CREAM = "#efe3c8";
const RED = "#c0392b";
const GOLD = "#d8b45a";
const BLACK = "#1d1f24";
const WOOD = "#a8743f";
const GLASS = "#2b3a4c";
const LAMP = "#f5ecd2";

/** Hauteur du plancher, du toit, et rayon des roues, par sorte de voiture (m). */
export const TRAIN_BODY = {
  loco: { floor: 0.62, roof: 2.5, wheel: 0.34 },
  wagon: { floor: 0.58, roof: 2.25, wheel: 0.28 },
} as const;

/** Cylindre d'axe z (chaudière, cerclages), de z0 à z1. */
function barrel(r: number, z0: number, z1: number, y: number, color: string, segments = 14): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(r, r, z1 - z0, segments);
  g.rotateX(Math.PI / 2);
  g.translate(0, y, (z0 + z1) / 2);
  return paint(g, color);
}

/** Caisse de la locomotive (sans roues). */
export function locoGeometry(c: TrainCar): THREE.BufferGeometry {
  const half = c.wheelbase / 2 + c.overhang, w = c.halfWidth, b = TRAIN_BODY.loco, parts: THREE.BufferGeometry[] = [];
  const nose = -half, tail = half, cab0 = 0.15, by = 1.2, br = 0.52;
  // Châssis et plancher, traverses avant et arrière rouges.
  parts.push(box(2 * w - 0.3, 0.26, 2 * half - 0.1, 0, b.floor - 0.13, 0, BLACK));
  parts.push(box(2 * w - 0.1, 0.2, 0.14, 0, b.floor - 0.1, nose + 0.12, RED), box(2 * w - 0.1, 0.2, 0.14, 0, b.floor - 0.1, tail - 0.07, RED));
  // Chasse-pierres : un coin rouge sous la traverse avant.
  const cow = new THREE.BoxGeometry(2 * w - 0.4, 0.34, 0.5);
  cow.rotateX(-0.5);
  cow.translate(0, 0.3, nose + 0.12);
  parts.push(paint(cow, RED));
  // Chaudière, boîte à fumée noire à l'avant, trois cerclages de laiton.
  parts.push(barrel(br, nose + 0.35, cab0, by, GREEN), barrel(br + 0.01, nose + 0.2, nose + 0.38, by, BLACK));
  for (const z of [nose + 0.75, -0.75, cab0 - 0.2]) parts.push(barrel(br + 0.025, z - 0.04, z + 0.04, by, GOLD));
  // Support de la chaudière, et caisses à eau de chaque côté.
  parts.push(box(0.6, by - b.floor, cab0 - nose - 0.4, 0, (by + b.floor) / 2, (nose + 0.35 + cab0) / 2, BLACK));
  for (const s of [-1, 1]) parts.push(box(0.32, 0.5, cab0 - nose - 0.9, s * (w - 0.2), b.floor + 0.25, (nose + 0.7 + cab0) / 2, GREEN));
  // Cheminée évasée, dôme de laiton, sifflet.
  const chimneyZ = nose + 0.65;
  parts.push(tube(new THREE.Vector3(0, by + br - 0.05, chimneyZ), new THREE.Vector3(0, b.roof - 0.1, chimneyZ), 0.14, BLACK, 10));
  const flare = new THREE.CylinderGeometry(0.24, 0.15, 0.22, 10);
  flare.translate(0, b.roof - 0.02, chimneyZ);
  parts.push(paint(flare, BLACK));
  parts.push(tube(new THREE.Vector3(0, by + br - 0.05, -0.55), new THREE.Vector3(0, by + br + 0.2, -0.55), 0.18, GOLD, 10));
  parts.push(tube(new THREE.Vector3(0, by + br - 0.05, cab0 - 0.4), new THREE.Vector3(0, by + br + 0.32, cab0 - 0.4), 0.04, GOLD, 6));
  // Fanal sur la boîte à fumée.
  parts.push(barrel(0.11, nose + 0.12, nose + 0.2, by + br + 0.05, LAMP, 10), barrel(0.13, nose + 0.15, nose + 0.24, by + br + 0.05, GOLD, 10));
  // Cabine : murets verts, montants dorés, toit rouge débordant, paroi avant vitrée, dos plein.
  const cz = (cab0 + tail) / 2, clen = tail - cab0 - 0.05, sill = b.floor + 0.75;
  for (const s of [-1, 1]) {
    parts.push(box(0.06, sill - b.floor, clen, s * (w - 0.03), (sill + b.floor) / 2, cz, GREEN));
    parts.push(box(0.065, 0.06, clen, s * (w - 0.03), sill, cz, GOLD));
    for (const z of [cab0 + 0.05, tail - 0.1]) parts.push(box(0.08, b.roof - sill, 0.08, s * (w - 0.06), (b.roof + sill) / 2, z, GOLD));
  }
  parts.push(box(2 * w, b.roof - b.floor, 0.06, 0, (b.roof + b.floor) / 2, tail - 0.06, GREEN));
  parts.push(box(2 * w - 0.1, sill - b.floor + 0.3, 0.06, 0, (sill + 0.3 + b.floor) / 2, cab0 + 0.05, GREEN));
  for (const s of [-1, 1]) parts.push(box(w - 0.35, 0.55, 0.03, s * (w / 2 + 0.1), sill + 0.6, cab0 + 0.05, GLASS));
  parts.push(box(2 * w + 0.2, 0.08, clen + 0.35, 0, b.roof + 0.04, cz, RED));
  // « AUTUN » en lettres dorées sur chaque flanc de la cabine, lisible des deux côtés.
  const px = 0.07, word = "AUTUN", span = (4 * word.length - 1) * px, ly = sill - 0.12;
  parts.push(...blockLetters(word, w + 0.004, cz + span / 2, ly, px, false, GOLD, -1));
  parts.push(...blockLetters(word, -(w + 0.004), cz - span / 2, ly, px, false, GOLD, 1));
  // Feux arrière.
  for (const s of [-1, 1]) parts.push(box(0.12, 0.1, 0.03, s * (w - 0.2), b.floor + 0.1, tail + 0.01, "#e0442c"));
  return merge(parts);
}

/** Bancs d'un wagon : quatre rangs tournés vers l'avant, trois places chacun ; z du milieu de chaque rang, x de chaque place, hauteur de l'assise. */
export const BENCH = { rows: 4, seats: [-0.55, 0, 0.55] as const, seat: 0.45 } as const;

function benchZ(c: TrainCar, k: number): number {
  const half = c.wheelbase / 2 + c.overhang, pitch = (2 * half - 0.4) / BENCH.rows;
  return -half + 0.2 + pitch * (k + 0.5);
}

/** Petit hachage entier (places occupées et apparences des passagers, reproductibles). */
function hash(n: number): number {
  let h = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

/** Part des places occupées. */
const OCCUPANCY = 0.55;

/**
 * Passagers d'un wagon (D119) : des touristes assis sur les bancs, à peu près une place sur deux, tirés de `seed`. Leur pose ne change pas :
 * elle est calculée une fois, dans le repère du wagon, et le lot (un appel de dessin) suit le wagon. Null : aucune place prise.
 */
export function passengerBatch(c: TrainCar, seed: number): CharacterBatch | null {
  const floor = TRAIN_BODY.wagon.floor, places: { x: number; z: number; recipe: number }[] = [];
  for (let k = 0; k < BENCH.rows; k++) {
    BENCH.seats.forEach((x, j) => {
      const h = hash(seed * 31 + k * 7 + j);
      if (h % 1000 < OCCUPANCY * 1000) places.push({ x, z: benchZ(c, k), recipe: h });
    });
  }
  if (places.length === 0) return null;
  const rigs = new CrowdRigs(places.map((p) => recipeFromSeed(p.recipe)));
  const batch = new CharacterBatch(0, places.length);
  batch.mesh.castShadow = true;
  places.forEach((p, i) => {
    const y = floor + BENCH.seat;
    // Assis au fond du banc, pieds à plat devant, mains sur les cuisses ; tournés vers l'avant (−z).
    const anchors: RideAnchors = {
      seat: [p.x, y, p.z + 0.02],
      grips: [[p.x - 0.16, y + 0.17, p.z - 0.2], [p.x + 0.16, y + 0.17, p.z - 0.2]],
      feet: [[p.x - 0.12, floor + 0.03, p.z - 0.42], [p.x + 0.12, floor + 0.03, p.z - 0.42]],
    };
    solveRide(rigs.render, rigs.world, rigs.offsets[i]!, rigs.scales[i]!, rigs.dims[i]!, "seat", anchors, rigs.pose);
    batch.push(rigs.render, rigs.colors[i]!, rigs.masks[i]!);
  });
  batch.flush();
  return batch;
}

/** Caisse d'un wagon (sans roues) : plancher, murets crème filetés de vert, quatre bancs, montants dorés, toit vert à lambrequin. */
export function wagonGeometry(c: TrainCar): THREE.BufferGeometry {
  const half = c.wheelbase / 2 + c.overhang, w = c.halfWidth, b = TRAIN_BODY.wagon, parts: THREE.BufferGeometry[] = [];
  const sill = b.floor + 0.5;
  parts.push(box(2 * w - 0.3, 0.22, 2 * half - 0.2, 0, b.floor - 0.11, 0, BLACK));
  parts.push(box(2 * w, 0.06, 2 * half, 0, b.floor, 0, WOOD));
  // Timon d'attelage vers la voiture de devant.
  parts.push(box(0.1, 0.08, 0.7, 0, b.floor - 0.2, -half - 0.2, BLACK));
  for (const s of [-1, 1]) {
    parts.push(box(0.05, sill - b.floor, 2 * half, s * (w - 0.025), (sill + b.floor) / 2, 0, CREAM));
    parts.push(box(0.055, 0.06, 2 * half, s * (w - 0.025), sill - 0.1, 0, GREEN));
    for (const z of [-half + 0.06, 0, half - 0.06]) parts.push(box(0.06, b.roof - sill, 0.06, s * (w - 0.05), (b.roof + sill) / 2, z, GOLD));
  }
  for (const z of [-half + 0.025, half - 0.025]) parts.push(box(2 * w, sill - b.floor, 0.05, 0, (sill + b.floor) / 2, z, CREAM));
  // Bancs tournés vers l'avant : assise et dossier.
  for (let k = 0; k < BENCH.rows; k++) {
    const z = benchZ(c, k);
    parts.push(box(2 * w - 0.2, 0.06, 0.42, 0, b.floor + 0.42, z - 0.05, WOOD), box(2 * w - 0.2, 0.42, 0.05, 0, b.floor + 0.66, z + 0.18, WOOD));
    parts.push(box(2 * w - 0.3, 0.4, 0.06, 0, b.floor + 0.21, z - 0.05, BLACK));
  }
  // Toit et lambrequin : bandes alternées rouges et blanches tout autour.
  parts.push(box(2 * w + 0.16, 0.08, 2 * half + 0.2, 0, b.roof + 0.04, 0, GREEN));
  const bands = 10;
  for (let k = 0; k < bands; k++) {
    const z = -half - 0.1 + ((2 * half + 0.2) / bands) * (k + 0.5), color = k % 2 ? CREAM : RED;
    for (const s of [-1, 1]) parts.push(box(0.03, 0.16, (2 * half + 0.2) / bands, s * (w + 0.08), b.roof - 0.06, z, color));
  }
  for (const z of [-half - 0.1, half + 0.1]) parts.push(box(2 * w + 0.16, 0.16, 0.03, 0, b.roof - 0.06, z, RED));
  for (const s of [-1, 1]) parts.push(box(0.12, 0.08, 0.03, s * (w - 0.2), b.floor - 0.05, half + 0.01, "#e0442c"));
  return merge(parts);
}

/** Le train dessiné : une caisse par voiture, quatre roues chacune, tenues à jour d'après les poses (`carPoses`). */
export class TrainModel {
  readonly group = new THREE.Group();
  private readonly cars: { root: THREE.Group; wheels: THREE.Mesh[]; radius: number; wheelbase: number }[] = [];
  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly passengers: CharacterBatch[] = [];

  constructor(cars: readonly TrainCar[]) {
    const mat = sharedMaterial();
    const shared = new Map<string, THREE.BufferGeometry>();
    for (const c of cars) {
      const key = `${c.kind}:${c.wheelbase}:${c.overhang}:${c.halfWidth}`;
      let geo = shared.get(key);
      if (!geo) {
        geo = c.kind === "loco" ? locoGeometry(c) : wagonGeometry(c);
        shared.set(key, geo);
        this.geometries.push(geo);
      }
      const radius = TRAIN_BODY[c.kind].wheel;
      const wheelGeo = carWheelGeometry(radius, 0.18, 12, c.kind === "loco" ? RED : GREEN);
      this.geometries.push(wheelGeo);
      const root = new THREE.Group();
      root.rotation.order = "YXZ";
      const body = new THREE.Mesh(geo, mat);
      body.castShadow = body.receiveShadow = true;
      root.add(body);
      if (c.kind === "wagon") {
        const p = passengerBatch(c, this.cars.length + 1);
        if (p) {
          root.add(p.mesh);
          this.passengers.push(p);
        }
      }
      const wheels: THREE.Mesh[] = [];
      for (const z of [-c.wheelbase / 2, c.wheelbase / 2]) {
        for (const s of [-1, 1]) {
          const m = new THREE.Mesh(wheelGeo, mat);
          m.castShadow = true;
          m.position.set(s * (c.halfWidth - 0.15), radius, z);
          root.add(m);
          wheels.push(m);
        }
      }
      this.group.add(root);
      this.cars.push({ root, wheels, radius, wheelbase: c.wheelbase });
    }
  }

  /** Place chaque voiture sur le relief (hauteur et tangage entre ses essieux) ; `wheel` : chemin parcouru (m), pour faire tourner les roues. */
  update(poses: readonly CarPose[], heightAt: (x: number, y: number) => number, wheel: number): void {
    this.cars.forEach((c, i) => {
      const p = poses[i];
      if (!p) return;
      const zf = heightAt(p.front.x, p.front.y), zr = heightAt(p.rear.x, p.rear.y);
      c.root.position.set(p.x, (zf + zr) / 2, -p.y);
      c.root.rotation.set(Math.atan2(zf - zr, c.wheelbase), -p.heading, 0);
      for (const w of c.wheels) w.rotation.x = -wheel / c.radius;
    });
  }

  /** Les passagers sont-ils à bord ? (Ils descendent quand on vole le train.) */
  setPassengers(on: boolean): void {
    for (const p of this.passengers) p.mesh.visible = on && p.count > 0;
  }

  dispose(): void {
    for (const g of this.geometries) g.dispose();
    for (const p of this.passengers) p.dispose();
  }
}

/**
 * La locomotive comme véhicule conduit (D118) : un groupe sans maillage (le train la dessine, avec ses wagons), qui ne porte que les points
 * d'appui du joueur debout dans la cabine, les mains sur la barre de commande.
 */
export function createLocoRideModel(): VehicleModel {
  const group = new THREE.Group();
  group.rotation.order = "YXZ";
  const f = TRAIN_BODY.loco.floor;
  const anchors = {
    gripL: marker(group, -0.22, f + 1.0, 0.55), gripR: marker(group, 0.22, f + 1.0, 0.55),
    footL: marker(group, -0.14, f, 1.0), footR: marker(group, 0.14, f, 1.1),
  };
  return {
    group,
    seat: new THREE.Vector3(0, f, 1.05),
    pose: "stand",
    anchors,
    update(s) {
      group.position.set(s.x, s.z, -s.y);
      group.rotation.set(s.pitch, -s.heading, 0);
    },
    dispose() {},
  };
}

/** Géométrie « garée » de la locomotive pour le dessin par instances : un triangle nul (le train la dessine lui-même). */
export function locoRestGeometry(): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(new Float32Array(9), 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0]), 3));
  g.setAttribute("color", new THREE.Float32BufferAttribute(new Float32Array(9), 3));
  return g;
}

