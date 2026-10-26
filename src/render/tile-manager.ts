import * as THREE from "three";
import type { Colliders } from "../core/collision";
import { addTileColliders } from "../core/world";
import { loadTile } from "../data/load";
import type { Furniture, TileData, TileInfo, WorldBase } from "../data/types";
import { buildLodTile } from "./lod";
import { disposeTile, type TileMeshes, type TileStats } from "./stylized";

/** Une tuile passe en détail quand son bord le plus proche est à moins de LOAD mètres, et revient en silhouette au-delà de UNLOAD. */
const LOAD = 210;
const UNLOAD_MARGIN = 90;
const MAX_FETCHES = 2;

interface Entry {
  info: TileInfo;
  lod: THREE.Mesh | null;
  detail: TileMeshes | null;
  data: TileData | null;
  /** Mobilier de la tuile détaillée (gardé après construction, pour placer les véhicules). */
  furniture: Furniture[] | null;
  fetching: boolean;
}

function distanceTo(info: TileInfo, px: number, py: number): number {
  const [x0, y0, x1, y1] = info.bounds;
  return Math.hypot(Math.max(x0 - px, 0, px - x1), Math.max(y0 - py, 0, py - y1));
}

/** Charge et décharge les tuiles détaillées autour du joueur ; les autres restent en silhouettes. */
export class TileManager {
  readonly group = new THREE.Group();
  private readonly entries = new Map<string, Entry>();
  hidden = new Set<string>();
  lastBuildMs = 0;
  /** Dernières constructions de tuiles (identifiant, durée en ms, instant), pour le banc de test. */
  readonly builds: { id: string; ms: number; at: number }[] = [];
  /** Nombre total de constructions depuis le début. */
  buildCount = 0;
  /** Appelé après chaque construction de tuile détaillée (données de la tuile). */
  onBuild: ((data: Pick<TileData, "furniture">) => void) | null = null;

  constructor(
    world: WorldBase,
    private readonly builder: (data: TileData) => TileMeshes,
    private readonly colliders: Colliders | null,
    private readonly load = LOAD,
  ) {
    for (const info of world.manifest.tiles) {
      const lod = buildLodTile(world.lod[info.id] ?? [], world.terrain);
      if (lod) this.group.add(lod);
      this.entries.set(info.id, { info, lod, detail: null, data: null, furniture: null, fetching: false });
    }
  }

  private show(e: Entry): void {
    if (e.lod) e.lod.visible = !e.detail;
    if (e.detail) e.detail.group.visible = true;
  }

  private build(e: Entry): void {
    const data = e.data!;
    e.data = null;
    const t0 = performance.now();
    const meshes = this.builder(data);
    meshes.group.children.forEach((m) => { if (this.hidden.has(m.name)) m.visible = false; });
    e.detail = meshes;
    this.group.add(meshes.group);
    if (this.colliders) addTileColliders(this.colliders, data, e.info.id);
    e.furniture = data.furniture;
    this.onBuild?.(data);
    this.show(e);
    const t1 = performance.now();
    this.lastBuildMs = t1 - t0;
    this.buildCount++;
    this.builds.push({ id: e.info.id, ms: this.lastBuildMs, at: t1 });
    if (this.builds.length > 256) this.builds.shift();
  }

  private unload(e: Entry): void {
    if (!e.detail) return;
    this.group.remove(e.detail.group);
    disposeTile(e.detail);
    e.detail = null;
    e.furniture = null;
    this.colliders?.removeTag(e.info.id);
    this.show(e);
  }

  private fetch(e: Entry): Promise<void> {
    e.fetching = true;
    return loadTile(e.info.id).then(
      (d) => { e.data = d; e.fetching = false; },
      (err: unknown) => { e.fetching = false; console.error(`tuile ${e.info.id}`, err); },
    );
  }

  /** À appeler à chaque image : lance les chargements, construit au plus une tuile, décharge les tuiles éloignées. */
  update(px: number, py: number): void {
    const all = [...this.entries.values()].map((e) => ({ e, d: distanceTo(e.info, px, py) })).sort((a, b) => a.d - b.d);
    let fetching = all.filter(({ e }) => e.fetching).length;
    let built = false;
    for (const { e, d } of all) {
      if (d < this.load && !e.detail) {
        if (e.data && !built) {
          this.build(e);
          built = true;
        } else if (!e.data && !e.fetching && fetching < MAX_FETCHES) {
          void this.fetch(e);
          fetching++;
        }
      } else if (d > this.load + UNLOAD_MARGIN && e.detail) this.unload(e);
    }
  }

  /** Mobilier des tuiles détaillées actuellement chargées. */
  loadedFurniture(): Furniture[][] {
    const out: Furniture[][] = [];
    for (const e of this.entries.values()) if (e.furniture) out.push(e.furniture);
    return out;
  }

  /** Charge et construit tout ce qui est proche de (px, py) avant le début du jeu. */
  async preload(px: number, py: number): Promise<void> {
    const near = [...this.entries.values()].filter((e) => distanceTo(e.info, px, py) < this.load);
    await Promise.all(near.map((e) => this.fetch(e)));
    for (const e of near.sort((a, b) => distanceTo(a.info, px, py) - distanceTo(b.info, px, py))) if (e.data) this.build(e);
  }

  get stats(): { loaded: string[]; triangles: number; draws: number; tileStats: Record<string, TileStats> } {
    const loaded: string[] = [];
    const tileStats: Record<string, TileStats> = {};
    let triangles = 0, draws = 0;
    for (const e of this.entries.values()) {
      if (e.lod) {
        triangles += (e.lod.geometry.getAttribute("position").count) / 3;
        draws++;
      }
      if (e.detail) {
        loaded.push(e.info.id);
        tileStats[e.info.id] = e.detail.stats;
        triangles += e.detail.stats.triangles;
        draws += e.detail.stats.draws;
      }
    }
    return { loaded, triangles: Math.round(triangles), draws, tileStats };
  }
}
