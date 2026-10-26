import * as THREE from "three";
import type { Colliders } from "../core/collision";
import { addTileColliders } from "../core/world";
import { loadTile } from "../data/load";
import type { Furniture, StairsZone, TileData, TileInfo, WorldBase } from "../data/types";
import { finish, type Steps } from "./geometry";
import { buildLodTile } from "./lod";
import { disposeTile, type TileMeshes, type TileStats } from "./stylized";

/** Une tuile passe en détail quand son bord le plus proche est à moins de LOAD mètres, et revient en silhouette au-delà de UNLOAD. */
const LOAD = 210;
const UNLOAD_MARGIN = 90;
const MAX_FETCHES = 2;
/** Temps de construction accordé par image (ms) : au-delà, la construction reprend à l'image suivante. */
const BUDGET = 4;
/** Anticipation : on charge aussi autour du point où l'on sera dans LOOKAHEAD secondes. */
const LOOKAHEAD = 3;

/** Ce qu'une tuile détaillée garde pour le reste du jeu : mobilier, escaliers, marquages au sol. */
export interface TileExtras {
  id: string;
  furniture: Furniture[];
  stairs: StairsZone[];
  marks: number[][][];
}

interface Entry {
  info: TileInfo;
  lod: THREE.Mesh | null;
  detail: TileMeshes | null;
  data: TileData | null;
  /** Extrait de la tuile détaillée gardé après construction (pour placer les véhicules). */
  extras: TileExtras | null;
  fetching: boolean;
  /** Maillages pas encore montrés (envoi à la carte graphique étalé, un par image) ; la silhouette reste jusque-là. */
  pending: THREE.Object3D[];
}

/** Construction en cours, découpée en tranches. */
interface Job {
  e: Entry;
  data: TileData;
  steps: Steps<TileMeshes>;
  /** Travail cumulé (ms), nombre d'images, plus longue tranche. */
  work: number;
  frames: number;
  slice: number;
}

export interface BuildRecord {
  id: string;
  /** Travail total (ms), réparti sur `frames` images ; plus longue tranche `slice` (ms). */
  ms: number;
  frames: number;
  slice: number;
  at: number;
}

function distanceTo(info: TileInfo, px: number, py: number): number {
  const [x0, y0, x1, y1] = info.bounds;
  return Math.hypot(Math.max(x0 - px, 0, px - x1), Math.max(y0 - py, 0, py - y1));
}

/** Charge et décharge les tuiles détaillées autour du joueur ; les autres restent en silhouettes. */
export class TileManager {
  readonly group = new THREE.Group();
  private readonly entries = new Map<string, Entry>();
  private job: Job | null = null;
  hidden = new Set<string>();
  /** Temps de construction passé pendant la dernière image (ms), 0 sans construction. */
  sliceMs = 0;
  /** Dernières constructions de tuiles, pour le banc de test. */
  readonly builds: BuildRecord[] = [];
  /** Nombre total de constructions terminées depuis le début. */
  buildCount = 0;
  /** Appelé après chaque construction de tuile détaillée, et quand une tuile détaillée est déchargée. */
  onBuild: ((extras: TileExtras) => void) | null = null;
  onUnload: ((id: string) => void) | null = null;

  constructor(
    world: WorldBase,
    private readonly builder: (data: TileData) => Steps<TileMeshes>,
    private readonly colliders: Colliders | null,
    private readonly load = LOAD,
    /** Budget par image (ms) ; très grand = construction d'un bloc, comme avant. */
    private readonly budget = BUDGET,
  ) {
    for (const info of world.manifest.tiles) {
      const lod = buildLodTile(world.lod[info.id] ?? [], world.terrain);
      if (lod) this.group.add(lod);
      this.entries.set(info.id, { info, lod, detail: null, data: null, extras: null, fetching: false, pending: [] });
    }
  }

  /** La silhouette disparaît quand tous les maillages détaillés sont montrés. */
  private show(e: Entry): void {
    if (e.lod) e.lod.visible = !e.detail || e.pending.length > 0;
  }

  /** Fin de construction : la tuile entre dans la scène, maillages masqués, et ses obstacles comptent tout de suite. */
  private finishBuild(e: Entry, data: TileData, meshes: TileMeshes, revealAll: boolean): void {
    e.detail = meshes;
    e.pending = [];
    for (const m of meshes.group.children) {
      if (this.hidden.has(m.name)) m.visible = false;
      else if (!revealAll) {
        m.visible = false;
        e.pending.push(m);
      }
    }
    this.group.add(meshes.group);
    if (this.colliders) addTileColliders(this.colliders, data, e.info.id);
    e.extras = { id: e.info.id, furniture: data.furniture, stairs: data.stairs ?? [], marks: data.ground?.["marks"] ?? [] };
    this.onBuild?.(e.extras);
    this.buildCount++;
    this.show(e);
  }

  private record(r: BuildRecord): void {
    this.builds.push(r);
    if (this.builds.length > 256) this.builds.shift();
  }

  private unload(e: Entry): void {
    if (this.job?.e === e) {
      this.job.steps.return(undefined as unknown as TileMeshes);
      this.job = null;
    }
    if (!e.detail) return;
    this.group.remove(e.detail.group);
    disposeTile(e.detail);
    e.detail = null;
    e.pending = [];
    e.extras = null;
    this.colliders?.removeTag(e.info.id);
    this.onUnload?.(e.info.id);
    this.show(e);
  }

  private fetch(e: Entry): Promise<void> {
    e.fetching = true;
    return loadTile(e.info.id).then(
      (d) => { e.data = d; e.fetching = false; },
      (err: unknown) => { e.fetching = false; console.error(`tuile ${e.info.id}`, err); },
    );
  }

  /** Fait avancer la construction en cours dans le budget de l'image. */
  private work(): void {
    const job = this.job;
    if (!job) return;
    const t0 = performance.now();
    let r = job.steps.next();
    while (!r.done && performance.now() - t0 < this.budget) r = job.steps.next();
    const t1 = performance.now();
    const dt = t1 - t0;
    job.work += dt;
    job.frames++;
    job.slice = Math.max(job.slice, dt);
    this.sliceMs += dt;
    if (r.done) {
      this.job = null;
      const t2 = performance.now();
      this.finishBuild(job.e, job.data, r.value, false);
      const extra = performance.now() - t2;
      this.sliceMs += extra;
      this.record({ id: job.e.info.id, ms: job.work + extra, frames: job.frames, slice: Math.max(job.slice, dt + extra), at: t1 });
    }
  }

  /**
   * À appeler à chaque image, avec la position et la vitesse (m/s) du joueur : lance les chargements (les tuiles
   * vers lesquelles on va d'abord), avance la construction en cours, montre un maillage en attente, décharge au loin.
   */
  update(px: number, py: number, vx = 0, vy = 0): void {
    this.sliceMs = 0;
    const ax = px + vx * LOOKAHEAD, ay = py + vy * LOOKAHEAD;
    const all = [...this.entries.values()]
      .map((e) => ({ e, d: Math.min(distanceTo(e.info, px, py), distanceTo(e.info, ax, ay)) }))
      .sort((a, b) => a.d - b.d);
    let fetching = all.filter(({ e }) => e.fetching).length;
    // Un seul maillage montré par image : l'envoi des sommets à la carte graphique est étalé.
    let revealed = false;
    for (const { e, d } of all) {
      if (d < this.load) {
        if (e.detail) {
          if (!revealed && e.pending.length) {
            e.pending.shift()!.visible = true;
            revealed = true;
            this.show(e);
          }
        } else if (e.data && !this.job) {
          this.job = { e, data: e.data, steps: this.builder(e.data), work: 0, frames: 0, slice: 0 };
          e.data = null;
        } else if (!e.data && !e.fetching && this.job?.e !== e && fetching < MAX_FETCHES) {
          void this.fetch(e);
          fetching++;
        }
      } else if (d > this.load + UNLOAD_MARGIN && (e.detail || this.job?.e === e)) this.unload(e);
    }
    this.work();
  }

  /** Extraits des tuiles détaillées actuellement chargées. */
  loadedExtras(): TileExtras[] {
    const out: TileExtras[] = [];
    for (const e of this.entries.values()) if (e.extras) out.push(e.extras);
    return out;
  }

  /** Charge et construit d'une traite tout ce qui est proche de (px, py) avant le début du jeu. */
  async preload(px: number, py: number): Promise<void> {
    const near = [...this.entries.values()].filter((e) => distanceTo(e.info, px, py) < this.load);
    await Promise.all(near.map((e) => this.fetch(e)));
    for (const e of near.sort((a, b) => distanceTo(a.info, px, py) - distanceTo(b.info, px, py))) {
      const data = e.data;
      if (!data) continue;
      e.data = null;
      const t0 = performance.now();
      this.finishBuild(e, data, finish(this.builder(data)), true);
      const ms = performance.now() - t0;
      this.record({ id: e.info.id, ms, frames: 0, slice: ms, at: performance.now() });
    }
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
