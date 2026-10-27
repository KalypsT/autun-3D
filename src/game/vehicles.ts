import type * as THREE from "three";
import { Colliders } from "../core/collision";
import { findStalls } from "../core/parking";
import { BIKE, CAR, createVehicle, MOTO, SCOOTER, type VehicleSpec, type VehicleState } from "../core/vehicle";
import { createBikeModel } from "../render/bike-model";
import { createCarModel, ParkedCars } from "../render/car-model";
import { createMotoModel } from "../render/moto-model";
import { createScooterModel } from "../render/scooter-model";
import type { TileExtras } from "../render/tile-manager";
import type { VehicleModel } from "../render/vehicle-model";
import type { HeightField } from "../data/types";
import type { SavedVehicle } from "../core/save";

export type VehicleKind = "bike" | "scooter" | "car" | "moto";

/** Par type : physique, modèle, pictogramme, libellé de l'accélérateur, distance pour monter, caméra de poursuite. */
export const KINDS: Record<VehicleKind, {
  spec: VehicleSpec;
  model: (variant: number) => VehicleModel;
  icon: string;
  gas: string;
  reach: number;
  camera: { distance: number; perSpeed: number; height: number };
  /** Traces de pneus : demi-voie (0 pour un deux-roues) et largeur de bande (m). */
  tyre: { track: number; width: number };
}> = {
  bike: { spec: BIKE, model: createBikeModel, icon: "🚲", gas: "Pédaler", reach: 2.2, camera: { distance: 3.9, perSpeed: 0.15, height: 0.2 }, tyre: { track: 0, width: 0.05 } },
  scooter: { spec: SCOOTER, model: createScooterModel, icon: "🛴", gas: "Accélérer", reach: 2.2, camera: { distance: 3.9, perSpeed: 0.15, height: 0.2 }, tyre: { track: 0, width: 0.06 } },
  car: { spec: CAR, model: createCarModel, icon: "🚗", gas: "Accélérer", reach: 3.0, camera: { distance: 6.2, perSpeed: 0.06, height: 0.55 }, tyre: { track: 0.74, width: 0.2 } },
  moto: { spec: MOTO, model: createMotoModel, icon: "🏍️", gas: "Accélérer", reach: 2.2, camera: { distance: 4.6, perSpeed: 0.07, height: 0.35 }, tyre: { track: 0, width: 0.12 } },
};

/** Un véhicule du monde : garé, ou conduit par le joueur. Il reste là où on le laisse. */
export interface Vehicle {
  id: string;
  kind: VehicleKind;
  spec: VehicleSpec;
  state: VehicleState;
  variant: number;
  /** Modèle articulé ; une voiture garée n'en a pas (elle est dessinée par instances). */
  model: VehicleModel | null;
  ridden: boolean;
  /** Place d'origine ; null pour un véhicule retrouvé dans une sauvegarde (d'origine inconnue : toujours à enregistrer). */
  home: { x: number; y: number; heading: number } | null;
}

/** Au-delà, les véhicules garés ne sont pas dessinés. */
const DRAW_DISTANCE = 110;
const CAR_DRAW_DISTANCE = 170;
/** Écart entre deux vélos rangés côte à côte (m). */
const BIKE_SPACING = 0.7;
/** Part des places de stationnement occupées par une voiture, puis par deux motos. */
const OCCUPANCY = 0.3;
const MOTO_OCCUPANCY = 0.04;
const MAX_PARKED_CARS = 400;

/** Petit hachage entier déterministe (placement et couleurs reproductibles). */
function hash(n: number): number {
  let h = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

/** Un véhicule est « déplacé » au-delà de ces écarts par rapport à sa place d'origine. */
const MOVED_DISTANCE = 0.5;
const MOVED_HEADING = 0.1;

export class Fleet {
  readonly vehicles: Vehicle[] = [];
  private readonly byId = new Map<string, Vehicle>();
  /** Obstacles que seules les voitures voient (escaliers). */
  readonly carOnly = new Colliders();
  private readonly sources = new Set<string>();
  private readonly parked = new ParkedCars(MAX_PARKED_CARS);
  private readonly clear: { x: number; y: number; r: number }[] = [];
  private carsDirty = true;
  private lastCull = { x: Infinity, y: Infinity };

  constructor(
    private readonly scene: THREE.Scene,
    private readonly colliders: Colliders,
    private readonly terrain: HeightField,
  ) {
    scene.add(this.parked.group);
  }

  /** Aucun véhicule ne sera garé dans ce cercle (point de départ du joueur). */
  keepClear(x: number, y: number, r: number): void {
    this.clear.push({ x, y, r });
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
      const count = 2 + (h % 2);
      const heading = ((h >>> 4) % 360) * (Math.PI / 180);
      // Côte à côte, perpendiculairement à leur axe.
      const rx = Math.cos(heading), ry = -Math.sin(heading);
      for (let i = 0; i <= count; i++) {
        const scooter = i === count;
        const off = (i - (count - 1) / 2) * BIKE_SPACING + (scooter ? 0.2 : 0);
        const p = this.colliders.resolve(f.x + rx * off, f.y + ry * off, 0.3);
        this.add(scooter ? "scooter" : "bike", `${scooter ? "trottinette" : "velo"}-${f.id}-${i}`, p.x, p.y, heading, (h >>> (8 + i * 3)) & 7);
      }
    }
    for (const s of findStalls(t.marks)) {
      const ix = Math.round(s.x * 10), iy = Math.round(s.y * 10);
      const key = `s${ix},${iy}`;
      if (this.sources.has(key)) continue;
      this.sources.add(key);
      const h = hash(Math.imul(ix, 73856093) ^ Math.imul(iy, 19349663));
      const draw = (h % 1000) / 1000;
      if (draw >= OCCUPANCY + MOTO_OCCUPANCY || this.clear.some((c) => Math.hypot(s.x - c.x, s.y - c.y) < c.r)) continue;
      // Garée en marche avant ou en marche arrière.
      const heading = s.heading + (h & 1024 ? Math.PI : 0);
      if (draw < OCCUPANCY) this.add("car", `voiture-${key}`, s.x, s.y, heading, (h >>> 12) & 15);
      else {
        // Deux motos côte à côte sur la place.
        const rx = Math.cos(heading), ry = -Math.sin(heading);
        for (const side of [-1, 1]) this.add("moto", `moto-${key}-${side}`, s.x + rx * side * 0.6, s.y + ry * side * 0.6, heading, ((h >>> 12) + side + 1) & 15);
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
  add(kind: VehicleKind, id: string, x: number, y: number, heading: number, variant: number, home: Vehicle["home"] = { x, y, heading }): Vehicle {
    const existing = this.byId.get(id);
    if (existing) return existing;
    const k = KINDS[kind];
    const v: Vehicle = { id, kind, spec: k.spec, state: createVehicle(x, y, heading, this.terrain), variant, model: null, ridden: false, home };
    this.byId.set(id, v);
    this.settle(v);
    if (kind !== "car") {
      v.model = k.model(variant);
      v.model.update(v.state);
      this.scene.add(v.model.group);
    }
    this.vehicles.push(v);
    this.park(v);
    return v;
  }

  /** Retrouve les véhicules d'une sauvegarde, là où ils avaient été laissés (avant que leurs tuiles ne les recréent à l'origine). */
  restore(saved: readonly SavedVehicle[]): void {
    for (const s of saved) this.add(s.kind, s.id, s.x, s.y, s.heading, s.variant, null);
  }

  get(id: string): Vehicle | null {
    return this.byId.get(id) ?? null;
  }

  /** Véhicules à enregistrer : ceux que le joueur a déplacés, ou conduit, depuis leur place d'origine. */
  savedVehicles(): SavedVehicle[] {
    const out: SavedVehicle[] = [];
    for (const v of this.vehicles) {
      const s = v.state, h = v.home;
      const moved = !h || v.ridden || Math.hypot(s.x - h.x, s.y - h.y) > MOVED_DISTANCE || Math.abs(Math.atan2(Math.sin(s.heading - h.heading), Math.cos(s.heading - h.heading))) > MOVED_HEADING;
      if (moved) out.push({ id: v.id, kind: v.kind, variant: v.variant, x: s.x, y: s.y, heading: s.heading });
    }
    return out;
  }

  /** Pose le véhicule sur le relief (hauteur et tangage entre les essieux). */
  private settle(v: Vehicle): void {
    const s = v.state, sp = v.spec;
    const fx = Math.sin(s.heading), fy = Math.cos(s.heading);
    const zf = this.terrain.heightAt(s.x + fx * sp.front, s.y + fy * sp.front);
    const zr = this.terrain.heightAt(s.x - fx * sp.rear, s.y - fy * sp.rear);
    s.z = (zf * sp.rear + zr * sp.front) / (sp.front + sp.rear);
    s.pitch = Math.atan2(zf - zr, sp.front + sp.rear);
  }

  /** Le véhicule redevient un obstacle à sa place actuelle ; une voiture repasse en instance. */
  park(v: Vehicle): void {
    v.ridden = false;
    const s = v.state;
    this.colliders.currentTag = `veh:${v.id}`;
    for (const [off, r] of v.spec.hull) this.colliders.addCircle(s.x + Math.sin(s.heading) * off, s.y + Math.cos(s.heading) * off, r);
    this.colliders.currentTag = null;
    if (v.kind === "car") {
      if (v.model) {
        this.scene.remove(v.model.group);
        v.model.dispose();
        v.model = null;
      }
      this.carsDirty = true;
    }
  }

  /** Le joueur prend le véhicule : il n'est plus un obstacle pour lui-même ; une voiture reçoit son modèle articulé. */
  take(v: Vehicle): VehicleModel {
    v.ridden = true;
    this.colliders.removeTag(`veh:${v.id}`);
    if (!v.model) {
      v.model = KINDS[v.kind].model(v.variant);
      v.model.update(v.state);
      this.scene.add(v.model.group);
      this.carsDirty = true;
    }
    return v.model;
  }

  /** Véhicule libre le plus proche de (x, y), d'un type donné ou de n'importe lequel, avec la distance à son centre. */
  nearest(x: number, y: number, kind: VehicleKind | null = null): { vehicle: Vehicle; distance: number } | null {
    let best: { vehicle: Vehicle; distance: number } | null = null;
    for (const v of this.vehicles) {
      if (v.ridden || (kind && v.kind !== kind)) continue;
      const d = Math.hypot(v.state.x - x, v.state.y - y);
      if (!best || d < best.distance) best = { vehicle: v, distance: d };
    }
    return best;
  }

  /** Masque les deux-roues éloignés et met à jour les voitures garées visibles (au plus tous les 10 m de déplacement). */
  cull(x: number, y: number): void {
    for (const v of this.vehicles) {
      if (v.model && v.kind !== "car") v.model.group.visible = v.ridden || Math.hypot(v.state.x - x, v.state.y - y) < DRAW_DISTANCE;
    }
    if (!this.carsDirty && Math.hypot(x - this.lastCull.x, y - this.lastCull.y) < 10) return;
    this.carsDirty = false;
    this.lastCull = { x, y };
    const cars = [];
    for (const v of this.vehicles) {
      if (v.kind !== "car" || v.ridden || Math.hypot(v.state.x - x, v.state.y - y) > CAR_DRAW_DISTANCE) continue;
      cars.push({ ...v.state, variant: v.variant });
    }
    this.parked.set(cars);
  }
}
