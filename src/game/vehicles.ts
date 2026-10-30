import type * as THREE from "three";
import { Colliders } from "../core/collision";
import { findStalls } from "../core/parking";
import { createVehicle, type VehicleSpec, type VehicleState } from "../core/vehicle";
import { parkingZone, pickModel } from "../core/vehicle-placement";
import { CATALOG, damageProfile, FAMILIES, paletteColor, vehicleDef, type FamilyInfo, type VehicleDef, type VehicleFamily } from "../core/vehicle-catalog";
import { DAMAGE, deratedSpec, looksDented, VehicleDamage, ZONES } from "../core/damage";
import { createBikeModel, MOUNTAIN_BIKE } from "../render/bike-model";
import { carLayout, wheelTrack } from "../render/car-body";
import { baseModel, CAR_BODIES, carRestGeometry, createCarModel, DENTED } from "../render/car-model";
import { bakeRest, ParkedModels } from "../render/parked-models";
import { createMotoModel } from "../render/moto-model";
import { createMotorScooterModel } from "../render/motorscooter-model";
import { createKickScooterModel } from "../render/kickscooter-model";
import { createLocoRideModel, locoRestGeometry } from "../render/train-model";
import type { TileExtras } from "../render/tile-manager";
import type { VehicleModel } from "../render/vehicle-model";
import type { HeightField } from "../data/types";
import type { SavedVehicle } from "../core/save";

/** Dessin de chaque modèle du catalogue (`src/core/vehicle-catalog.ts`), à la couleur donnée. Un test vérifie que chaque entrée en a un. */
export const MODEL_BUILDERS: Record<string, (color: string) => VehicleModel> = {
  "velo-ville": (color) => createBikeModel(color),
  vtt: (color) => createBikeModel(color, MOUNTAIN_BIKE),
  trottinette: createKickScooterModel,
  "scooter-125": createMotorScooterModel,
  ...Object.fromEntries(Object.keys(CAR_BODIES).map((id) => [id, (color: string) => createCarModel(id, color)])),
  // La locomotive du petit train (D118) : le train la dessine ; conduite, elle ne porte que le joueur.
  "petit-train": () => createLocoRideModel(),
  "moto-routiere": (color) => createMotoModel(color),
  "moto-sportive": (color) => createMotoModel(color, "sport"),
};

/** Géométrie au repos d'un modèle garé (peinture blanche), pour le maillage instancié de tous ses exemplaires. */
export function restGeometryOf(id: string): THREE.BufferGeometry {
  const def = vehicleDef(baseModel(id));
  if (!def) throw new Error(`modèle de véhicule inconnu : ${id}`);
  if (def.train) return locoRestGeometry();
  return def.family === "car" ? carRestGeometry(id) : bakeRest(MODEL_BUILDERS[def.id]!("#ffffff"));
}

/** Modèle dessiné pour un véhicule garé ou de la circulation : sa forme abîmée s'il paraît cabossé (voitures seulement, D112). */
export function drawnModel(def: VehicleDef, damage: VehicleDamage): string {
  return def.family === "car" && !def.train && looksDented(damage) ? def.id + DENTED : def.id;
}

/** Modèle articulé d'une entrée du catalogue, de la couleur de la variante. */
export function buildModel(def: VehicleDef, variant: number): VehicleModel {
  return MODEL_BUILDERS[def.id]!(paletteColor(def, variant));
}

/** Traces de pneus : la voie d'une voiture est celle de ses roues dessinées (générateur de carrosserie). */
export function tyreOf(v: { def: VehicleDef }): FamilyInfo["tyre"] {
  const t = FAMILIES[v.def.family].tyre, body = CAR_BODIES[v.def.id];
  return v.def.family === "car" && body ? { ...t, track: wheelTrack(body) } : t;
}

/** Caméra de poursuite : celle de la famille, reculée et relevée pour les voitures plus longues et plus hautes que la citadine (3,98 × 1,42 m). */
export function chaseOf(v: { def: VehicleDef }): FamilyInfo["camera"] {
  const c = FAMILIES[v.def.family].camera;
  // Petit train (D118) : la caméra recule et monte pour voir les wagons derrière la locomotive.
  if (v.def.train) return { distance: 12, perSpeed: 0.1, height: 2.2 };
  if (v.def.family !== "car") return c;
  const { length, height } = v.def.size;
  return { distance: c.distance + (length - 3.98) * 1.2, perSpeed: c.perSpeed, height: c.height + (height - 1.42) * 0.5 };
}

/**
 * D'où sort la fumée d'un véhicule abîmé (D110), dans son repère : [vers la droite, hauteur, vers l'avant] (m). Voiture : le capot, au-dessus du moteur ;
 * deux-roues : le moteur, sous la selle.
 */
export function smokeOrigin(def: VehicleDef): [number, number, number] {
  const body = CAR_BODIES[def.id];
  if (def.family !== "car" || !body) return [0, 0.62, 0.05];
  const L = carLayout(body, def.spec.front, def.spec.rear);
  return [0, (body.noseHeight + body.belt) / 2 + 0.06, -(L.noseZ + body.hood * 0.45)];
}

/** Interface et conduite communes à la famille du véhicule. */
export function familyOf(v: { def: VehicleDef }): FamilyInfo {
  return FAMILIES[v.def.family];
}

/** Un véhicule du monde : garé, ou conduit par le joueur. Il reste là où on le laisse. */
export interface Vehicle {
  id: string;
  def: VehicleDef;
  family: VehicleFamily;
  spec: VehicleSpec;
  state: VehicleState;
  variant: number;
  /** Modèle articulé, seulement tant qu'on le conduit : un véhicule garé n'en a pas (il est dessiné par instances, avec tous ceux de son modèle). */
  model: VehicleModel | null;
  ridden: boolean;
  /** Place d'origine ; null pour un véhicule retrouvé dans une sauvegarde (d'origine inconnue : toujours à enregistrer). */
  home: { x: number; y: number; heading: number } | null;
  /** Dégâts (D109) : santé, zones écrasées, feu, fin. */
  damage: VehicleDamage;
}

/** Fiche avec laquelle le véhicule roule : celle du modèle, moteur affaibli selon ses dégâts (`deratedSpec`). */
export function drivenSpec(v: { spec: VehicleSpec; damage: VehicleDamage }): VehicleSpec {
  return deratedSpec(v.spec, v.damage.power);
}

/** Peinture d'une épave brûlée (D111). */
const WRECK_COLOR = "#2b2724";
/** Au-delà, les véhicules garés ne sont pas dessinés. */
const DRAW_DISTANCE = 110;
const CAR_DRAW_DISTANCE = 170;
/** Écart entre deux vélos rangés côte à côte (m). */
const BIKE_SPACING = 0.7;
/** Part des places de stationnement occupées par une voiture, puis par deux motos. */
const OCCUPANCY = 0.3;
const MOTO_OCCUPANCY = 0.04;
/** Exemplaires d'un même modèle dessinés au plus. */
const MAX_PARKED = 400;

/** Petit hachage entier déterministe (placement et couleurs reproductibles). */
function hash(n: number): number {
  let h = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

/** Nombre pseudo-aléatoire dans [0, 1[ tiré du hachage `h` et d'un rang, indépendant de la place et de la couleur (qui utilisent d'autres bits de `h`). */
function unit(h: number, rank: number): number {
  return hash(Math.imul(h, 0x2545f491) ^ Math.imul(rank + 1, 0x9e3779b1)) / 0x100000000;
}

/** Côté des cases où rien ne se gare (m), et clé d'une case. */
const CLEAR_CELL = 2;
const cellKey = (ix: number, iy: number): number => (ix + 32768) * 65536 + (iy + 32768);

/** Un véhicule est « déplacé » au-delà de ces écarts par rapport à sa place d'origine. */
const MOVED_DISTANCE = 0.5;
const MOVED_HEADING = 0.1;

export class Fleet {
  readonly vehicles: Vehicle[] = [];
  private readonly byId = new Map<string, Vehicle>();
  /** Obstacles que seules les voitures voient (escaliers). */
  readonly carOnly = new Colliders();
  private readonly sources = new Set<string>();
  private readonly parked = new ParkedModels(MAX_PARKED, restGeometryOf);
  private readonly clear: { x: number; y: number; r: number }[] = [];
  /** Cases de 2 m où rien ne se gare : le circuit du petit train (D117), trop long pour une liste de cercles. */
  private readonly clearCells = new Set<number>();
  private dirty = true;
  private lastCull = { x: Infinity, y: Infinity };
  /** Pour la mesure (banc) : véhicules en tout, véhicules garés dessinés et maillages instanciés qu'ils coûtent (un par modèle présent). */
  readonly stats = { total: 0, drawn: 0, meshes: 0 };

  constructor(
    private readonly scene: THREE.Scene,
    private readonly colliders: Colliders,
    private readonly terrain: HeightField,
  ) {
    scene.add(this.parked.group);
    // Aussi la forme abîmée de chaque voiture (D112) : elle ne coûte un appel de dessin que quand une voiture cabossée est là.
    this.parked.prepare([...CATALOG.map((d) => d.id), ...CATALOG.filter((d) => d.family === "car").map((d) => d.id + DENTED)]);
  }

  /** Aucun véhicule ne sera garé dans ce cercle (point de départ du joueur). */
  keepClear(x: number, y: number, r: number): void {
    this.clear.push({ x, y, r });
  }

  /** Aucune voiture ne sera garée à moins de `r` m de ce tracé (points x, y à la suite, tous les mètres ou moins). */
  keepClearAlong(points: readonly number[], r: number): void {
    const n = Math.ceil(r / CLEAR_CELL);
    for (let i = 0; i < points.length; i += 2) {
      const cx = Math.floor(points[i]! / CLEAR_CELL), cy = Math.floor(points[i + 1]! / CLEAR_CELL);
      for (let dx = -n; dx <= n; dx++) {
        for (let dy = -n; dy <= n; dy++) {
          const x = (cx + dx + 0.5) * CLEAR_CELL, y = (cy + dy + 0.5) * CLEAR_CELL;
          if (Math.hypot(x - points[i]!, y - points[i + 1]!) < r) this.clearCells.add(cellKey(cx + dx, cy + dy));
        }
      }
    }
  }

  private cleared(x: number, y: number): boolean {
    return this.clearCells.has(cellKey(Math.floor(x / CLEAR_CELL), Math.floor(y / CLEAR_CELL))) || this.clear.some((c) => Math.hypot(x - c.x, y - c.y) < c.r);
  }

  /**
   * Véhicules d'une tuile qui vient d'être construite (une seule fois par source) : vélos et une trottinette
   * aux parkings à vélos, voitures sur une partie des places de stationnement ; escaliers infranchissables en voiture.
   */
  addFromTile(t: TileExtras): void {
    for (const f of t.furniture) {
      if (f.kind !== "bicycle_parking" || this.sources.has(`p${f.id}`)) continue;
      this.sources.add(`p${f.id}`);
      const h = hash(f.id);
      const zone = parkingZone(f.x, f.y, t.buildings);
      const count = 2 + (h % 2);
      const heading = ((h >>> 4) % 360) * (Math.PI / 180);
      // Côte à côte, perpendiculairement à leur axe.
      const rx = Math.cos(heading), ry = -Math.sin(heading);
      for (let i = 0; i <= count; i++) {
        const scooter = i === count;
        const off = (i - (count - 1) / 2) * BIKE_SPACING + (scooter ? 0.2 : 0);
        const p = this.colliders.resolve(f.x + rx * off, f.y + ry * off, 0.3);
        this.add(scooter ? "trottinette" : pickModel("bike", zone, unit(h, i)), `${scooter ? "trottinette" : "velo"}-${f.id}-${i}`, p.x, p.y, heading, (h >>> (8 + i * 3)) & 7);
      }
    }
    for (const s of findStalls(t.marks)) {
      const ix = Math.round(s.x * 10), iy = Math.round(s.y * 10);
      const key = `s${ix},${iy}`;
      if (this.sources.has(key)) continue;
      this.sources.add(key);
      const h = hash(Math.imul(ix, 73856093) ^ Math.imul(iy, 19349663));
      const draw = (h % 1000) / 1000;
      const zone = parkingZone(s.x, s.y, t.buildings);
      if (draw >= OCCUPANCY + MOTO_OCCUPANCY || this.cleared(s.x, s.y)) continue;
      // Garée en marche avant ou en marche arrière.
      const heading = s.heading + (h & 1024 ? Math.PI : 0);
      if (draw < OCCUPANCY) this.add(pickModel("car", zone, unit(h, 0)), `voiture-${key}`, s.x, s.y, heading, (h >>> 12) & 15);
      else {
        // Deux motos côte à côte sur la place.
        const rx = Math.cos(heading), ry = -Math.sin(heading);
        for (const side of [-1, 1]) this.add(pickModel("moto", zone, unit(h, side + 2)), `moto-${key}-${side}`, s.x + rx * side * 0.6, s.y + ry * side * 0.6, heading, ((h >>> 12) + side + 1) & 15);
      }
    }
    this.carOnly.currentTag = t.id;
    for (const st of t.stairs) {
      const [x0, y0, x1, y1] = st.bbox;
      this.carOnly.addRing([x0!, y0!, x1!, y0!, x1!, y1!, x0!, y1!]);
    }
    this.carOnly.currentTag = null;
  }

  /** La tuile est déchargée : ses escaliers disparaissent (les véhicules restent). */
  removeTile(id: string): void {
    this.carOnly.removeTag(id);
  }

  /**
   * Ajoute un véhicule ; un identifiant déjà présent renvoie le véhicule existant (une tuile qui se recharge ne le recrée pas,
   * et un véhicule retrouvé dans une sauvegarde reste à l'endroit où le joueur l'a laissé).
   */
  add(model: string, id: string, x: number, y: number, heading: number, variant: number, home: Vehicle["home"] = { x, y, heading }): Vehicle {
    const existing = this.byId.get(id);
    if (existing) return existing;
    const def = vehicleDef(model);
    if (!def) throw new Error(`modèle de véhicule inconnu : ${model}`);
    const v: Vehicle = { id, def, family: def.family, spec: def.spec, state: createVehicle(x, y, heading, this.terrain), variant, model: null, ridden: false, home, damage: new VehicleDamage(damageProfile(def)) };
    this.byId.set(id, v);
    this.settle(v);
    this.vehicles.push(v);
    this.park(v);
    return v;
  }

  /** Retire un véhicule de la flotte (J4 : confisqué à l'arrestation) : ni obstacle, ni dessin, ni sauvegarde. */
  remove(v: Vehicle): void {
    const i = this.vehicles.indexOf(v);
    if (i < 0) return;
    this.vehicles.splice(i, 1);
    this.byId.delete(v.id);
    this.colliders.removeTag(`veh:${v.id}`);
    if (v.model) {
      this.scene.remove(v.model.group);
      v.model.dispose();
      v.model = null;
    }
    this.dirty = true;
  }

  /** Retrouve les véhicules d'une sauvegarde, là où ils avaient été laissés (avant que leurs tuiles ne les recréent à l'origine). */
  restore(saved: readonly SavedVehicle[]): void {
    for (const s of saved) {
      const v = this.add(s.model, s.id, s.x, s.y, s.heading, s.variant, null);
      if (s.damage) v.damage.restore(s.damage.health, s.damage.zones, s.damage.end);
    }
  }

  get(id: string): Vehicle | null {
    return this.byId.get(id) ?? null;
  }

  /** Véhicules à enregistrer : ceux que le joueur a déplacés, ou conduit, depuis leur place d'origine. */
  savedVehicles(): SavedVehicle[] {
    const out: SavedVehicle[] = [];
    for (const v of this.vehicles) {
      // La locomotive du petit train n'est jamais enregistrée : une partie remet le train sur son circuit (D118).
      if (v.def.train) continue;
      const s = v.state, h = v.home;
      const moved = !h || v.ridden || Math.hypot(s.x - h.x, s.y - h.y) > MOVED_DISTANCE || Math.abs(Math.atan2(Math.sin(s.heading - h.heading), Math.cos(s.heading - h.heading))) > MOVED_HEADING;
      // Un véhicule abîmé est enregistré même s'il n'a pas bougé (une voiture garée percutée, D113), avec ses dégâts.
      const d = v.damage, hurt = d.version > 0 && (d.health < DAMAGE.max || d.end !== null || ZONES.some((z) => d.zones[z] > 0));
      if (!moved && !hurt) continue;
      out.push({ id: v.id, model: v.def.id, variant: v.variant, x: s.x, y: s.y, heading: s.heading, ...(hurt ? { damage: { health: d.health, zones: { ...d.zones }, end: d.end } } : {}) });
    }
    return out;
  }

  /**
   * Déplace un véhicule garé (la locomotive du petit train qui roule sur son circuit, D118) : sa position, posée sur le relief, et ses cercles
   * de collision. Rien à redessiner : il n'est pas dessiné par instances.
   */
  place(v: Vehicle, x: number, y: number, heading: number, speed: number): void {
    if (v.ridden) return;
    const s = v.state;
    s.x = x;
    s.y = y;
    s.heading = heading;
    s.speed = speed;
    s.vx = Math.sin(heading) * speed;
    s.vy = Math.cos(heading) * speed;
    this.settle(v);
    this.colliders.removeTag(`veh:${v.id}`);
    this.colliders.currentTag = `veh:${v.id}`;
    for (const [off, r] of v.spec.hull) this.colliders.addCircle(x + Math.sin(heading) * off, y + Math.cos(heading) * off, r);
    this.colliders.currentTag = null;
  }

  /** Pose le véhicule sur le relief (hauteur et tangage entre les essieux). */
  private settle(v: Vehicle): void {
    const s = v.state, sp = v.spec;
    const fx = Math.sin(s.heading), fy = Math.cos(s.heading);
    const zf = this.terrain.heightAt(s.x + fx * sp.front, s.y + fy * sp.front, s.z);
    const zr = this.terrain.heightAt(s.x - fx * sp.rear, s.y - fy * sp.rear, s.z);
    s.z = (zf * sp.rear + zr * sp.front) / (sp.front + sp.rear);
    s.pitch = Math.atan2(zf - zr, sp.front + sp.rear);
  }

  /** Le véhicule redevient un obstacle à sa place actuelle et repasse en instance (son modèle articulé est libéré). */
  park(v: Vehicle): void {
    v.ridden = false;
    const s = v.state;
    this.colliders.currentTag = `veh:${v.id}`;
    for (const [off, r] of v.spec.hull) this.colliders.addCircle(s.x + Math.sin(s.heading) * off, s.y + Math.cos(s.heading) * off, r);
    this.colliders.currentTag = null;
    if (v.model) {
      this.scene.remove(v.model.group);
      v.model.dispose();
      v.model = null;
    }
    this.dirty = true;
  }

  /** Le joueur prend le véhicule : il n'est plus un obstacle pour lui-même ; il reçoit son modèle articulé (les véhicules garés sont des instances). */
  take(v: Vehicle): VehicleModel {
    v.ridden = true;
    this.colliders.removeTag(`veh:${v.id}`);
    if (!v.model) {
      v.model = buildModel(v.def, v.variant);
      v.model.update(v.state);
      this.scene.add(v.model.group);
      this.dirty = true;
    }
    return v.model;
  }

  /** Redessine les véhicules garés à la prochaine image (un véhicule a changé d'aspect : épave). */
  refresh(): void {
    this.dirty = true;
  }

  /** Véhicules (garés ou conduit) à moins de `r` mètres de (x, y). */
  around(x: number, y: number, r: number, out: Vehicle[]): Vehicle[] {
    out.length = 0;
    for (const v of this.vehicles) if (Math.hypot(v.state.x - x, v.state.y - y) < r) out.push(v);
    return out;
  }

  /** Véhicule libre le plus proche de (x, y), d'un type donné ou de n'importe lequel, avec la distance à son centre. */
  nearest(x: number, y: number, family: VehicleFamily | null = null): { vehicle: Vehicle; distance: number } | null {
    let best: { vehicle: Vehicle; distance: number } | null = null;
    for (const v of this.vehicles) {
      // Une épave (brûlée, en panne, cassée) ne se reprend pas (D109).
      if (v.ridden || !v.damage.usable || (family && v.family !== family)) continue;
      const d = Math.hypot(v.state.x - x, v.state.y - y);
      if (!best || d < best.distance) best = { vehicle: v, distance: d };
    }
    return best;
  }

  /** Réécrit les instances des véhicules garés visibles (voitures à moins de 170 m, le reste à moins de 110 m), au plus tous les 10 m de déplacement. */
  cull(x: number, y: number): void {
    this.stats.total = this.vehicles.length;
    if (!this.dirty && Math.hypot(x - this.lastCull.x, y - this.lastCull.y) < 10) return;
    this.dirty = false;
    this.lastCull = { x, y };
    const items = [];
    for (const v of this.vehicles) {
      if (v.ridden) continue;
      const reach = v.family === "car" ? CAR_DRAW_DISTANCE : DRAW_DISTANCE;
      if (Math.hypot(v.state.x - x, v.state.y - y) > reach) continue;
      // Une épave brûlée est noircie : la peinture prend la teinte du charbon (D111).
      const color = v.damage.end === "explosion" ? WRECK_COLOR : paletteColor(v.def, v.variant);
      items.push({ model: drawnModel(v.def, v.damage), x: v.state.x, y: v.state.y, z: v.state.z, heading: v.state.heading, pitch: v.state.pitch, lean: v.state.lean, color });
    }
    this.parked.set(items);
    this.stats.drawn = this.parked.instances;
    this.stats.meshes = this.parked.drawn;
  }
}
