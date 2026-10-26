import * as THREE from "three";
import type { Colliders } from "../core/collision";
import { addTileColliders } from "../core/world";
import { loadTile } from "../data/load";
import type { TileData, TileInfo, WorldBase } from "../data/types";
import { buildTileDetail, disposeTile, type CityResources, type TileMeshes, type TileStats } from "./buildings";
import { buildLodTile } from "./lod";

/** Une tuile passe en détail quand son bord le plus proche est à moins de LOAD mètres, et revient en silhouette au-delà de UNLOAD. */
const LOAD = 210;
const UNLOAD_MARGIN = 90;
const MAX_FETCHES = 2;

interface Entry {
  info: TileInfo;
  lod: THREE.Mesh | null;
  detail: TileMeshes | null;
  data: TileData | null;
  fetching: boolean;
  /** Conserve les données le temps que la tuile est détaillée (reconstruction après recyclage d'atlas). */
  keep: TileData | null;
  stale: boolean;
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

  constructor(
    private readonly world: WorldBase,
    private readonly res: CityResources,
    private readonly colliders: Colliders | null,
    private readonly load = LOAD,
    private readonly styler: { apply(root: THREE.Object3D): void } | null = null,
  ) {
    for (const info of world.manifest.tiles) {
      const lod = buildLodTile(world.lod[info.id] ?? [], world.terrain);
      if (lod) {
        this.styler?.apply(lod);
        this.group.add(lod);
      }
      this.entries.set(info.id, { info, lod, detail: null, data: null, fetching: false, keep: null, stale: false });
    }
  }

  private show(e: Entry): void {
    if (e.lod) e.lod.visible = !e.detail;
    if (e.detail) e.detail.group.visible = true;
  }

  private build(e: Entry): void {
    const data = e.data ?? e.keep!;
    e.data = null;
    e.keep = data;
    const t0 = performance.now();
    let meshes = buildTileDetail(this.res, data, this.world.terrain);
    // Atlas plein : on vide la page la plus ancienne, les tuiles qui s'en servaient sont à refaire.
    for (let attempt = 0; attempt < 3 && meshes.missed > 0; attempt++) {
      disposeTile(meshes);
      const facade = this.res.facadeAtlas.missed > 0 ? this.res.facadeAtlas.recycle() : -1;
      const sign = this.res.signAtlas.missed > 0 ? this.res.signAtlas.recycle() : -1;
      for (const o of this.entries.values()) {
        if (o !== e && o.detail && (o.detail.pages.facade.has(facade) || o.detail.pages.sign.has(sign))) this.markStale(o);
      }
      this.res.facadeAtlas.missed = this.res.signAtlas.missed = 0;
      meshes = buildTileDetail(this.res, data, this.world.terrain);
    }
    if (e.detail) {
      this.group.remove(e.detail.group);
      disposeTile(e.detail);
    } else if (this.colliders) addTileColliders(this.colliders, data, e.info.id);
    this.styler?.apply(meshes.group);
    meshes.group.children.forEach((m) => { if (this.hidden.has(m.name)) m.visible = false; });
    e.detail = meshes;
    e.stale = false;
    this.group.add(meshes.group);
    this.show(e);
    this.lastBuildMs = performance.now() - t0;
  }

  /** Les sprites de cette tuile ont été écrasés dans l'atlas : on les masque et on la reconstruit dès que possible. */
  private markStale(e: Entry): void {
    e.stale = true;
    e.detail?.group.children.forEach((m) => { if (m.name.startsWith("sprites-") || m.name.startsWith("enseignes-")) m.visible = false; });
  }

  private unload(e: Entry): void {
    if (!e.detail) return;
    this.group.remove(e.detail.group);
    disposeTile(e.detail);
    e.detail = null;
    e.keep = null;
    e.stale = false;
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
      if (e.stale && e.detail && !built) {
        this.build(e);
        built = true;
      } else if (d < this.load && !e.detail) {
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

  /** Charge et construit tout ce qui est proche de (px, py) avant le début du jeu. */
  async preload(px: number, py: number): Promise<void> {
    const near = [...this.entries.values()].filter((e) => distanceTo(e.info, px, py) < this.load);
    await Promise.all(near.map((e) => this.fetch(e)));
    for (const e of near.sort((a, b) => distanceTo(a.info, px, py) - distanceTo(b.info, px, py))) if (e.data) this.build(e);
    for (let pass = 0; pass < 3; pass++) for (const e of this.entries.values()) if (e.stale && e.detail) this.build(e);
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
