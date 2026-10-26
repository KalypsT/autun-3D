import type * as THREE from "three";
import type { Colliders } from "../core/collision";
import { BIKE, createVehicle, SCOOTER, type VehicleSpec, type VehicleState } from "../core/vehicle";
import type { Terrain } from "../data/terrain";
import type { TileData } from "../data/types";
import { createBikeModel } from "../render/bike-model";
import { createScooterModel } from "../render/scooter-model";
import type { VehicleModel } from "../render/vehicle-model";

export type VehicleKind = "bike" | "scooter";

/** Par type : physique, modèle, pictogramme et libellé de l'accélérateur. */
export const KINDS: Record<VehicleKind, { spec: VehicleSpec; model: (variant: number) => VehicleModel; icon: string; gas: string }> = {
  bike: { spec: BIKE, model: createBikeModel, icon: "🚲", gas: "Pédaler" },
  scooter: { spec: SCOOTER, model: createScooterModel, icon: "🛴", gas: "Accélérer" },
};

/** Un véhicule du monde : garé, ou conduit par le joueur. Il reste là où on le laisse. */
export interface Vehicle {
  id: string;
  kind: VehicleKind;
  spec: VehicleSpec;
  state: VehicleState;
  model: VehicleModel;
  ridden: boolean;
}

/** Au-delà, les véhicules garés ne sont pas dessinés. */
const DRAW_DISTANCE = 110;
/** Écart entre deux vélos rangés côte à côte (m). */
const BIKE_SPACING = 0.7;

/** Petit hachage entier déterministe (placement et couleurs reproductibles). */
function hash(n: number): number {
  let h = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

export class Fleet {
  readonly vehicles: Vehicle[] = [];
  private readonly sources = new Set<number>();

  constructor(
    private readonly scene: THREE.Scene,
    private readonly colliders: Colliders,
    private readonly terrain: Terrain,
  ) {}

  /** Gare des vélos, et une trottinette en bout de rangée, aux parkings à vélos d'une tuile qui vient d'être construite (une seule fois par parking). */
  addFromTile(data: Pick<TileData, "furniture">): void {
    for (const f of data.furniture) {
      if (f.kind !== "bicycle_parking" || this.sources.has(f.id)) continue;
      this.sources.add(f.id);
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
  }

  add(kind: VehicleKind, id: string, x: number, y: number, heading: number, variant: number): Vehicle {
    const k = KINDS[kind];
    const v: Vehicle = { id, kind, spec: k.spec, state: createVehicle(x, y, heading, this.terrain), model: k.model(variant), ridden: false };
    v.state.pitch = 0;
    v.model.update(v.state);
    this.scene.add(v.model.group);
    this.vehicles.push(v);
    this.park(v);
    return v;
  }

  /** Le véhicule redevient un obstacle à sa place actuelle. */
  park(v: Vehicle): void {
    v.ridden = false;
    const s = v.state;
    this.colliders.currentTag = `veh:${v.id}`;
    for (const [off, r] of v.spec.hull) this.colliders.addCircle(s.x + Math.sin(s.heading) * off, s.y + Math.cos(s.heading) * off, r);
    this.colliders.currentTag = null;
  }

  /** Le joueur prend le véhicule : il n'est plus un obstacle pour lui-même. */
  take(v: Vehicle): void {
    v.ridden = true;
    this.colliders.removeTag(`veh:${v.id}`);
  }

  /** Véhicule libre le plus proche de (x, y), avec sa distance. */
  nearest(x: number, y: number): { vehicle: Vehicle; distance: number } | null {
    let best: { vehicle: Vehicle; distance: number } | null = null;
    for (const v of this.vehicles) {
      if (v.ridden) continue;
      const d = Math.hypot(v.state.x - x, v.state.y - y);
      if (!best || d < best.distance) best = { vehicle: v, distance: d };
    }
    return best;
  }

  /** Masque les véhicules éloignés de la caméra. */
  cull(x: number, y: number): void {
    for (const v of this.vehicles) v.model.group.visible = v.ridden || Math.hypot(v.state.x - x, v.state.y - y) < DRAW_DISTANCE;
  }
}
