import * as THREE from "three";
import { vehicleDef } from "../core/vehicle-catalog";
import { beaconBoxes, carLayout, carWheelGeometry, lampSpots } from "./car-body";
import { baseModel, CAR_BODIES, carBodyGeometry } from "./car-model";
import { tintPaintOnly } from "./parked-models";

/**
 * Voitures qui roulent (J3-5, D65), dessinées par instances comme les voitures garées (D56), mais avec des roues qui tournent et braquent :
 * - **un maillage instancié par modèle présent** pour la caisse (peinture blanche teintée par l'instance, verre, pare-chocs, feux : sans les roues),
 *   qui prend le tangage, le cap et le roulis de la voiture ;
 * - **un seul maillage de roues** pour tous les modèles : une roue unitaire (rayon 1, largeur 1) mise à l'échelle de chaque modèle, quatre instances par voiture,
 *   qui tournent (rotation de la roue) et braquent (les deux de devant) ;
 * - **un seul maillage de feux** : phares et feux arrière allumés la nuit, sans éclairage (même mécanique que les fenêtres, D19 : l'opacité suit la nuit) ;
 * - **un seul maillage de gyrophares** (J4, D72) : les feux bleus des voitures de police en poursuite, qui clignotent, jour et nuit, sans ombre
 *   (aucun appel de dessin sans gyrophare allumé).
 * Coût en appels de dessin : au plus (modèles présents + 2) × 2 avec l'ombre, quel que soit le nombre de voitures, contre 12 par voiture avec un modèle
 * articulé (6 maillages × 2).
 */

/** Une voiture à dessiner. */
export interface TrafficItem {
  /** Identifiant du modèle du catalogue. */
  model: string;
  x: number;
  y: number;
  z: number;
  heading: number;
  pitch: number;
  /** Roulis de la caisse (rad, `VehicleState.lean`). */
  lean: number;
  /** Braquage des roues avant (rad) et rotation des roues (rad, `VehicleState.wheel`). */
  steer: number;
  wheel: number;
  color: string;
  /** Gyrophares allumés (voiture de police en poursuite, J4) : temps (s) qui règle le clignotement ; absent, éteints. */
  beacon?: number;
}

interface Slot {
  mesh: THREE.InstancedMesh;
  n: number;
}

/** Rayon de la roue unitaire et facettes de son pneu. */
const WHEEL_SEGMENTS = 12;
/** Exemplaires d'un même modèle, et de voitures en tout (les roues et les feux en prennent 4 par voiture). */
const PER_MODEL = 64;
const MAX_CARS = 128;
/** Feux de gyrophare allumés au plus (deux par voiture de police). */
const MAX_BEACONS = 32;

interface Layout {
  wheels: readonly (readonly [number, number])[];
  radius: number;
  width: number;
  lamps: ReturnType<typeof lampBoxes>;
  rim: THREE.Color;
  beacons: ReturnType<typeof beaconBoxes>;
}

/** Géométrie d'un modèle sans ses roues : peinture en blanc (teintée par instance) et détails ; `citadine#dent` : sa forme abîmée (D112). */
export function bodyOnlyGeometry(id: string): THREE.BufferGeometry {
  if (!CAR_BODIES[baseModel(id)] || !vehicleDef(baseModel(id))) throw new Error(`voiture inconnue : ${id}`);
  return carBodyGeometry(id);
}

/** Phares et feux arrière d'un modèle, dans son repère : [x, y, z, largeur, hauteur, profondeur], les deux premiers devant. */
export function lampBoxes(id: string): { head: [number, number, number][]; tail: [number, number, number][] } {
  const p = CAR_BODIES[id], def = vehicleDef(id);
  if (!p || !def) throw new Error(`voiture inconnue : ${id}`);
  const l = lampSpots(p, def.spec.front, def.spec.rear);
  // Un peu en avant des phares et en arrière des feux : la plaque lumineuse les recouvre.
  return { head: l.head.map(([x, y, z]) => [x, y, z - 0.01]), tail: l.tail.map(([x, y, z]) => [x, y, z + 0.01]) };
}

/** Roue unitaire : rayon 1 (y, z) et largeur 1 (x), jante blanche teintée par instance de la couleur des jantes du modèle. */
function unitWheelGeometry(): THREE.BufferGeometry {
  return carWheelGeometry(1, 1, WHEEL_SEGMENTS);
}

export class TrafficModels {
  readonly group = new THREE.Group();
  private readonly slots = new Map<string, Slot>();
  private readonly bodyMaterial = tintPaintOnly(new THREE.MeshLambertMaterial({ vertexColors: true }));
  private readonly wheels: THREE.InstancedMesh;
  private readonly wheelMaterial = tintPaintOnly(new THREE.MeshLambertMaterial({ vertexColors: true }));
  private readonly lamps: THREE.InstancedMesh;
  private readonly lampMaterial = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
  private readonly beacons: THREE.InstancedMesh;
  private readonly beaconColor = { on: new THREE.Color("#5a8cff"), off: new THREE.Color("#1a2f66") };
  private readonly beaconSize = new THREE.Vector3();
  private nWheels = 0;
  private nLamps = 0;
  private nBeacons = 0;
  private readonly car = new THREE.Matrix4();
  private readonly tmp = new THREE.Matrix4();
  private readonly local = new THREE.Matrix4();
  private readonly euler = new THREE.Euler(0, 0, 0, "YXZ");
  private readonly quat = new THREE.Quaternion();
  private readonly pos = new THREE.Vector3();
  private readonly one = new THREE.Vector3(1, 1, 1);
  private readonly scale = new THREE.Vector3();
  private readonly color = new THREE.Color();
  private readonly lampColor = { head: new THREE.Color("#fff1c0"), tail: new THREE.Color("#ff3a22") };
  private readonly headSize = new THREE.Vector3(0.3, 0.18, 0.05);
  private readonly tailSize = new THREE.Vector3(0.28, 0.16, 0.05);
  private readonly noRotation = new THREE.Quaternion();
  private readonly body = new THREE.Matrix4();
  private readonly rollQuat = new THREE.Quaternion();
  private readonly spinQuat = new THREE.Quaternion();
  private readonly steerQuat = new THREE.Quaternion();
  private readonly xAxis = new THREE.Vector3(1, 0, 0);
  private readonly yAxis = new THREE.Vector3(0, 1, 0);
  private readonly zAxis = new THREE.Vector3(0, 0, 1);
  private readonly layouts = new Map<string, Layout>();

  constructor() {
    this.wheels = new THREE.InstancedMesh(unitWheelGeometry(), this.wheelMaterial, MAX_CARS * 4);
    this.lamps = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), this.lampMaterial, MAX_CARS * 4);
    this.beacons = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial(), MAX_BEACONS);
    this.beacons.castShadow = false;
    this.beacons.receiveShadow = false;
    for (const m of [this.wheels, this.lamps, this.beacons]) {
      m.count = 0;
      m.visible = false;
      // Les instances couvrent toute la zone et changent à chaque image : pas de tri par la caméra.
      m.frustumCulled = false;
    }
    this.wheels.castShadow = true;
    this.wheels.receiveShadow = true;
    // Éteints tant que `setNight` n'a pas dit le contraire (le jour : aucun appel de dessin).
    this.lampMaterial.visible = false;
    this.lamps.castShadow = false;
    this.lamps.receiveShadow = false;
    this.group.add(this.wheels, this.lamps, this.beacons);
  }

  /** Fabrique d'avance les maillages de ces modèles (cachés) : une géométrie coûte quelques millisecondes, mieux vaut les payer au chargement. */
  prepare(models: readonly string[]): void {
    for (const id of models) this.slot(id);
  }

  private slot(id: string): Slot {
    let s = this.slots.get(id);
    if (s) return s;
    const mesh = new THREE.InstancedMesh(bodyOnlyGeometry(id), this.bodyMaterial, PER_MODEL);
    mesh.count = 0;
    mesh.visible = false;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    this.group.add(mesh);
    s = { mesh, n: 0 };
    this.slots.set(id, s);
    return s;
  }

  private layout(model: string): Layout {
    const id = baseModel(model);
    let l = this.layouts.get(id);
    if (!l) {
      const p = CAR_BODIES[id]!, def = vehicleDef(id)!;
      l = { wheels: carLayout(p, def.spec.front, def.spec.rear).wheels, radius: p.wheelRadius, width: p.tyreWidth, lamps: lampBoxes(id), rim: new THREE.Color(p.style.rim), beacons: beaconBoxes(p, def.spec.front, def.spec.rear) };
      this.layouts.set(id, l);
    }
    return l;
  }

  /** Nuit : 0 (jour) à 1 (nuit noire) ; les feux s'allument comme les fenêtres (D19). */
  setNight(glow: number): void {
    this.lampMaterial.opacity = glow;
    this.lampMaterial.visible = glow > 0.01;
  }

  /** Réécrit les instances : une caisse, quatre roues et quatre feux par voiture. */
  set(items: readonly TrafficItem[]): void {
    for (const s of this.slots.values()) s.n = 0;
    this.nWheels = 0;
    this.nLamps = 0;
    this.nBeacons = 0;
    for (const c of items) {
      const s = this.slot(c.model);
      if (s.n >= PER_MODEL || this.nWheels + 4 > MAX_CARS * 4) continue;
      const l = this.layout(c.model);
      // Repère de la voiture (sans roulis) : les roues et les feux en partent.
      this.euler.set(c.pitch, -c.heading, 0);
      this.quat.setFromEuler(this.euler);
      this.car.compose(this.pos.set(c.x, c.z, -c.y), this.quat, this.one);
      // Caisse : même repère, avec le roulis autour de l'axe longitudinal (la caisse est suspendue, les roues restent au sol).
      this.rollQuat.setFromAxisAngle(this.zAxis, -c.lean);
      this.local.makeRotationFromQuaternion(this.rollQuat);
      this.body.multiplyMatrices(this.car, this.local);
      s.mesh.setMatrixAt(s.n, this.body);
      s.mesh.setColorAt(s.n, this.color.set(c.color));
      s.n++;
      // Roues : position dans le repère de la voiture, rotation de la roue, braquage devant, échelle du modèle.
      for (let k = 0; k < 4; k++) {
        const [x, z] = l.wheels[k]!;
        this.spinQuat.setFromAxisAngle(this.xAxis, -c.wheel);
        this.steerQuat.setFromAxisAngle(this.yAxis, k < 2 ? -c.steer : 0);
        this.quat.copy(this.steerQuat).multiply(this.spinQuat);
        this.local.compose(this.pos.set(x, l.radius, z), this.quat, this.scale.set(l.width, l.radius, l.radius));
        this.tmp.multiplyMatrices(this.car, this.local);
        this.wheels.setColorAt(this.nWheels, l.rim);
        this.wheels.setMatrixAt(this.nWheels++, this.tmp);
      }
      // Feux : deux phares, deux feux arrière, sur la caisse (elle prend le roulis).
      for (const head of [true, false]) {
        for (const [x, y, z] of head ? l.lamps.head : l.lamps.tail) {
          this.local.compose(this.pos.set(x, y, z), this.noRotation, head ? this.headSize : this.tailSize);
          this.tmp.multiplyMatrices(this.body, this.local);
          this.lamps.setMatrixAt(this.nLamps, this.tmp);
          this.lamps.setColorAt(this.nLamps, head ? this.lampColor.head : this.lampColor.tail);
          this.nLamps++;
        }
      }
      // Gyrophares : les deux feux de la barre s'allument l'un après l'autre, quatre fois par seconde, légèrement grossis par-dessus la barre éteinte.
      if (c.beacon !== undefined && this.nBeacons + l.beacons.length <= MAX_BEACONS) {
        const phase = Math.floor(c.beacon * 4) & 1;
        l.beacons.forEach((b, k) => {
          this.local.compose(this.pos.set(b.x, b.y, b.z), this.noRotation, this.beaconSize.set(b.size[0] + 0.01, b.size[1] + 0.01, b.size[2] + 0.01));
          this.tmp.multiplyMatrices(this.body, this.local);
          this.beacons.setMatrixAt(this.nBeacons, this.tmp);
          this.beacons.setColorAt(this.nBeacons, (k & 1) === phase ? this.beaconColor.on : this.beaconColor.off);
          this.nBeacons++;
        });
      }
    }
    for (const s of this.slots.values()) {
      s.mesh.count = s.n;
      s.mesh.visible = s.n > 0;
      s.mesh.instanceMatrix.needsUpdate = true;
      if (s.mesh.instanceColor) s.mesh.instanceColor.needsUpdate = true;
    }
    this.wheels.count = this.nWheels;
    this.wheels.visible = this.nWheels > 0;
    this.wheels.instanceMatrix.needsUpdate = true;
    if (this.wheels.instanceColor) this.wheels.instanceColor.needsUpdate = true;
    this.lamps.count = this.nLamps;
    this.lamps.visible = this.nLamps > 0;
    this.lamps.instanceMatrix.needsUpdate = true;
    if (this.lamps.instanceColor) this.lamps.instanceColor.needsUpdate = true;
    this.beacons.count = this.nBeacons;
    this.beacons.visible = this.nBeacons > 0;
    this.beacons.instanceMatrix.needsUpdate = true;
    if (this.beacons.instanceColor) this.beacons.instanceColor.needsUpdate = true;
  }

  /** Nombre de maillages dessinés : un par modèle présent, plus les roues et les feux, pour la mesure. */
  get drawn(): number {
    let n = this.nWheels > 0 ? 1 : 0;
    if (this.nLamps > 0 && this.lampMaterial.visible) n++;
    if (this.nBeacons > 0) n++;
    for (const s of this.slots.values()) if (s.n > 0) n++;
    return n;
  }

  /** Nombre de voitures dessinées. */
  get instances(): number {
    let n = 0;
    for (const s of this.slots.values()) n += s.n;
    return n;
  }

  dispose(): void {
    for (const s of this.slots.values()) s.mesh.geometry.dispose();
    this.wheels.geometry.dispose();
    this.lamps.geometry.dispose();
    this.lampMaterial.dispose();
    this.beacons.geometry.dispose();
    (this.beacons.material as THREE.Material).dispose();
    this.bodyMaterial.dispose();
    this.wheelMaterial.dispose();
    this.group.clear();
  }
}
