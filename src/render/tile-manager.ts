import * as THREE from "three";
import type { Colliders } from "../core/collision";
import { landmarkDecks, landmarkSectors } from "../core/landmarks";
import { addTileColliders } from "../core/world";
import { loadLandmarks, loadLod, loadTile } from "../data/load";
import { MeshBuilder } from "./geometry";
import { buildFarTower } from "./monuments";
import type { TiledTerrain } from "../data/terrain";
import type { Furniture, LodBuilding, StairsZone, TileData, TileInfo, WorldBase } from "../data/types";
import { finish, type Steps } from "./geometry";
import { buildLodTile } from "./lod";
import { breakFurniture, disposeTile, type TileMeshes, type TileStats } from "./stylized";
import { FINE_RANGE, VIEW_RANGE } from "./terrain";

/**
 * Une tuile passe en détail quand son bord le plus proche est à moins de DETAIL_DISTANCE mètres, et revient en silhouette
 * au-delà de DETAIL_DISTANCE + UNLOAD_MARGIN. 300 m : mesuré fluide sur le téléphone de test (400 m aussi, mais mémoire doublée).
 */
export const DETAIL_DISTANCE = 300;
const UNLOAD_MARGIN = 90;
const MAX_FETCHES = 2;
/** Temps de construction accordé par image (ms) : au-delà, la construction reprend à l'image suivante. */
const BUDGET = 4;
/** Anticipation : on charge aussi autour du point où l'on sera dans LOOKAHEAD secondes. */
const LOOKAHEAD = 3;
/** Silhouettes : construites jusqu'à VIEW_RANGE (au-delà, le brouillard cache tout), retirées LOD_MARGIN plus loin. */
const LOD_MARGIN = 200;
const MAX_LOD_FETCHES = 3;
/** Relief fin : chargé pour les tuiles voisines de toute tuile détaillée (un bloc déborde d'une tuile, il faut le bloc de chacune des 8 voisines). */
const TERRAIN_REACH = 360;
const TERRAIN_KEEP = 200;
const MAX_TERRAIN_FETCHES = 4;
/** Les passes lentes (relief, silhouettes) ne tournent qu'une image sur SLOW. */
const SLOW = 6;
/** Au chargement, silhouettes construites d'avance dans ce rayon (m). */
const PRELOAD_LOD = 700;

/** Ce qu'une tuile détaillée garde pour le reste du jeu : mobilier, escaliers, marquages au sol. */
export interface TileExtras {
  id: string;
  /** Nombre de bâtiments de la tuile (pour classer son quartier, D55). */
  buildings: number;
  furniture: Furniture[];
  stairs: StairsZone[];
  marks: number[][][];
}

interface Entry {
  info: TileInfo;
  lod: THREE.Mesh | null;
  detail: TileMeshes | null;
  data: TileData | null;
  /** Silhouettes : "none" (pas chargées), "fetching", "queued" (reçues, maillage à construire), "ready" (maillage construit). */
  lodState: "none" | "fetching" | "queued" | "ready";
  lodData: LodBuilding[] | null;
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
  private readonly grid = new Map<number, Entry>();
  /** Tuiles avec une requête, des données ou un maillage détaillé en cours ou en mémoire. */
  private readonly live = new Set<Entry>();
  /** Tuiles dont les silhouettes sont demandées, en attente ou construites. */
  private readonly lodLive = new Set<Entry>();
  private lodFetching = 0;
  private readonly lodQueue: Entry[] = [];
  private readonly terrain: TiledTerrain;
  private readonly cols: number;
  /** Coin sud-ouest de la grille mondiale. */
  private readonly zone: [number, number];
  private readonly size: number;
  private frame = 0;
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
    /** Rayon de chargement des tuiles détaillées (m) ; modifiable en jeu (réglages). */
    public load = DETAIL_DISTANCE,
    /** Budget par image (ms) ; très grand = construction d'un bloc, comme avant. */
    private readonly budget = BUDGET,
  ) {
    this.terrain = world.terrain;
    this.cols = world.manifest.cols;
    this.zone = world.manifest.gridOrigin;
    this.size = world.manifest.tileSize;
    void this.loadFar();
    for (const info of world.manifest.tiles) {
      const e: Entry = { info, lod: null, lodState: info.lod > 0 ? "none" : "ready", lodData: null, detail: null, data: null, extras: null, fetching: false, pending: [] };
      this.entries.set(info.id, e);
      this.grid.set(info.row * this.cols + info.col, e);
    }
  }

  /** Tuiles dont l'emprise touche le carré de demi-côté `range` autour du point. */
  private near(px: number, py: number, range: number): Entry[] {
    const out: Entry[] = [];
    const c0 = Math.max(0, Math.floor((px - range - this.zone[0]) / this.size)), c1 = Math.floor((px + range - this.zone[0]) / this.size);
    const r0 = Math.max(0, Math.floor((py - range - this.zone[1]) / this.size)), r1 = Math.floor((py + range - this.zone[1]) / this.size);
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= Math.min(c1, this.cols - 1); c++) {
        const e = this.grid.get(r * this.cols + c);
        if (e) out.push(e);
      }
    }
    return out;
  }

  /** La silhouette disparaît quand tous les maillages détaillés sont montrés ; les clochers lointains de la tuile aussi. */
  private show(e: Entry): void {
    const far = !e.detail || e.pending.length > 0;
    if (e.lod) e.lod.visible = far;
    for (const m of this.far.get(e.info.id) ?? []) m.visible = far;
  }

  /** Clochers dessinés de loin (D95) : la flèche de Saint-Lazare se voit depuis toute la ville, avant que sa tuile soit détaillée. */
  private readonly far = new Map<string, THREE.Mesh[]>();

  private async loadFar(): Promise<void> {
    const list = await loadLandmarks();
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0 });
    for (const l of list) {
      const e = this.entries.get(l.tile);
      if (!e) continue;
      const mb = new MeshBuilder();
      buildFarTower(mb, l.t, this.terrain);
      const mesh = new THREE.Mesh(mb.build(), mat);
      mesh.name = "repere";
      this.group.add(mesh);
      const arr = this.far.get(l.tile) ?? [];
      arr.push(mesh);
      this.far.set(l.tile, arr);
      this.show(e);
    }
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
    if (this.colliders) addTileColliders(this.colliders, data, e.info.id, this.terrain);
    e.extras = { id: e.info.id, buildings: data.buildings.length, furniture: data.furniture, stairs: data.stairs ?? [], marks: data.ground?.["marks"] ?? [] };
    this.onBuild?.(e.extras);
    this.buildCount++;
    this.show(e);
  }

  private record(r: BuildRecord): void {
    this.builds.push(r);
    if (this.builds.length > 256) this.builds.shift();
  }

  /**
   * Tabliers de pont et quais de la tuile (D93), avant sa construction : chaussées, mobilier et entités s'y posent. Un quai est à
   * hauteur fixe au-dessus du plus haut point de son contour.
   */
  private registerDecks(id: string, data: TileData): void {
    const st = data.structures;
    // Marches et volée du porche de la cathédrale (D132), invisibles : les monuments les dessinent.
    const extra = landmarkDecks(data.kinds);
    // Gradins du théâtre romain (D133) : secteurs d'anneau, invisibles eux aussi.
    const sectors = landmarkSectors(data.kinds);
    if (sectors.length) this.terrain.decks.addSectors(id, sectors);
    if (!st) {
      if (extra.length) this.terrain.decks.add(id, extra);
      return;
    }
    const platforms = st.platforms.map((p, i) => {
      let z = -Infinity;
      for (let k = 0; k < p.r.length; k += 2) z = Math.max(z, this.terrain.groundAt(p.r[k]!, p.r[k + 1]!));
      return { ...p, z: z + p.h, id: `q:${id}:${i}` };
    });
    this.terrain.decks.add(id, [...st.decks, ...extra], platforms);
  }

  private unload(e: Entry): void {
    this.terrain.decks.remove(e.info.id);
    if (this.job?.e === e) {
      this.job.steps.return(undefined as unknown as TileMeshes);
      this.job = null;
    }
    e.data = null;
    if (e.detail) {
      this.group.remove(e.detail.group);
      disposeTile(e.detail);
      e.detail = null;
      e.pending = [];
      e.extras = null;
      this.colliders?.removeTag(e.info.id);
      this.onUnload?.(e.info.id);
      this.show(e);
    }
    this.release(e);
  }

  private fetch(e: Entry): Promise<void> {
    e.fetching = true;
    this.live.add(e);
    return loadTile(e.info.id).then(
      (d) => { e.data = d; e.fetching = false; },
      (err: unknown) => { e.fetching = false; this.release(e); console.error(`tuile ${e.info.id}`, err); },
    );
  }

  /**
   * Un véhicule a arraché le mobilier `id` (D160) : il disparaît du maillage de sa tuile (les trois petits maillages du mobilier cassable
   * sont refaits). Renvoie le mobilier, ou null s'il n'est dans aucune tuile détaillée. Une tuile rechargée le remet en place.
   */
  breakProp(id: number): Furniture | null {
    for (const e of this.entries.values()) {
      if (!e.detail) continue;
      const f = breakFurniture(e.detail, id, this.terrain);
      if (f) return f;
    }
    return null;
  }

  /** La tuile n'a plus rien en mémoire ni en cours : elle n'est plus suivie pour le déchargement. */
  private release(e: Entry): void {
    if (!e.fetching && !e.data && !e.detail && this.job?.e !== e) this.live.delete(e);
  }

  private fetchLod(e: Entry): Promise<void> {
    e.lodState = "fetching";
    this.lodLive.add(e);
    this.lodFetching++;
    return loadLod(e.info.id).then(
      (d) => { e.lodData = d; e.lodState = "queued"; this.lodQueue.push(e); this.lodFetching--; },
      (err: unknown) => { e.lodState = "ready"; this.lodFetching--; console.error(`silhouettes ${e.info.id}`, err); },
    );
  }

  private buildLod(e: Entry): void {
    const mesh = e.lodData ? buildLodTile(e.lodData, this.terrain) : null;
    e.lodData = null;
    e.lodState = "ready";
    if (mesh) {
      e.lod = mesh;
      this.group.add(mesh);
      this.show(e);
    }
  }

  private dropLod(e: Entry): void {
    if (e.lod) {
      this.group.remove(e.lod);
      e.lod.geometry.dispose();
      (e.lod.material as THREE.Material).dispose();
      e.lod = null;
    }
    e.lodData = null;
    e.lodState = "none";
    this.lodLive.delete(e);
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
    this.frame++;
    const ax = px + vx * LOOKAHEAD, ay = py + vy * LOOKAHEAD;
    const dist = (e: Entry): number => Math.min(distanceTo(e.info, px, py), distanceTo(e.info, ax, ay));
    const all = this.near(px, py, this.load + Math.hypot(vx, vy) * LOOKAHEAD + 1)
      .map((e) => ({ e, d: dist(e) }))
      .sort((a, b) => a.d - b.d);
    let fetching = 0;
    for (const e of this.live) if (e.fetching) fetching++;
    // Un seul maillage montré par image : l'envoi des sommets à la carte graphique est étalé.
    let revealed = false;
    for (const { e, d } of all) {
      if (d >= this.load) continue;
      if (e.detail) {
        if (!revealed && e.pending.length) {
          e.pending.shift()!.visible = true;
          revealed = true;
          this.show(e);
        }
      } else if (e.data && !this.job) {
        // Les altitudes fines de la tuile et de ses voisines doivent être là : les bâtiments, murs et sols s'y posent.
        if (this.terrain.ready(e.info)) {
          this.registerDecks(e.info.id, e.data);
          this.job = { e, data: e.data, steps: this.builder(e.data), work: 0, frames: 0, slice: 0 };
          e.data = null;
        }
      } else if (!e.data && !e.fetching && this.job?.e !== e && fetching < MAX_FETCHES) {
        void this.fetch(e);
        fetching++;
      }
    }
    for (const e of [...this.live]) {
      if (dist(e) > this.load + UNLOAD_MARGIN) this.unload(e);
    }
    if (this.frame % SLOW === 0) this.slow(px, py, vx, vy);
    const queued = this.lodQueue.shift();
    if (queued?.lodState === "queued") this.buildLod(queued);
    this.work();
  }

  /** Relief fin et silhouettes : passes qui n'ont pas besoin de tourner à chaque image. */
  private slow(px: number, py: number, vx: number, vy: number): void {
    const ax = px + vx * LOOKAHEAD, ay = py + vy * LOOKAHEAD;
    const dist = (e: Entry): number => Math.min(distanceTo(e.info, px, py), distanceTo(e.info, ax, ay));
    // Relief fin : autour de toute tuile détaillée, ses huit voisines comprises ; retiré quand plus aucune tuile détaillée n'en a besoin.
    const reach = Math.max(this.load, FINE_RANGE) + TERRAIN_REACH;
    const wide = this.near(px, py, reach + Math.hypot(vx, vy) * LOOKAHEAD)
      .map((e) => ({ e, d: dist(e) }))
      .filter(({ d }) => d < reach)
      .sort((a, b) => a.d - b.d);
    for (const { e } of wide) {
      if (this.terrain.inflight >= MAX_TERRAIN_FETCHES) break;
      if (!this.terrain.has(e.info.id)) void this.terrain.request(e.info.id);
    }
    for (const id of [...this.terrain.loadedIds()]) {
      const e = this.entries.get(id);
      if (e && dist(e) > reach + TERRAIN_KEEP) this.terrain.drop(id);
    }
    // Silhouettes : tout ce qui est visible, les plus proches d'abord.
    const lods = this.near(px, py, VIEW_RANGE)
      .filter((e) => e.lodState === "none" && distanceTo(e.info, px, py) < VIEW_RANGE)
      .sort((a, b) => distanceTo(a.info, px, py) - distanceTo(b.info, px, py));
    for (const e of lods) {
      if (this.lodFetching >= MAX_LOD_FETCHES) break;
      void this.fetchLod(e);
    }
    for (const e of [...this.lodLive]) {
      if ((e.lodState === "ready" || e.lodState === "queued") && distanceTo(e.info, px, py) > VIEW_RANGE + LOD_MARGIN) this.dropLod(e);
    }
  }

  /**
   * Les obstacles de la tuile qui contient (x, y) sont-ils en place ? Faux tant qu'elle se charge ou se construit : on y traverserait
   * les murs. Vrai hors des tuiles du monde (les limites du monde s'en chargent).
   */
  solidAt(x: number, y: number): boolean {
    const c = Math.floor((x - this.zone[0]) / this.size), r = Math.floor((y - this.zone[1]) / this.size);
    const e = c >= 0 && c < this.cols ? this.grid.get(r * this.cols + c) : undefined;
    return !e || e.extras !== null;
  }

  /** Extraits des tuiles détaillées actuellement chargées. */
  loadedExtras(): TileExtras[] {
    const out: TileExtras[] = [];
    for (const e of this.entries.values()) if (e.extras) out.push(e.extras);
    return out;
  }

  /** Charge et construit d'une traite tout ce qui est proche de (px, py) avant le début du jeu. */
  async preload(px: number, py: number): Promise<void> {
    const near = this.near(px, py, this.load).filter((e) => distanceTo(e.info, px, py) < this.load);
    const wide = this.near(px, py, PRELOAD_LOD).filter((e) => e.lodState === "none" && distanceTo(e.info, px, py) < PRELOAD_LOD);
    const blocks = new Set<string>();
    for (const e of near) {
      for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) blocks.add(`${e.info.col + dc}_${e.info.row + dr}`);
    }
    await Promise.all([
      ...[...blocks].filter((id) => this.entries.has(id)).map((id) => this.terrain.request(id)),
      ...near.map((e) => this.fetch(e)),
      ...wide.map((e) => this.fetchLod(e)),
    ]);
    for (const e of wide) {
      const i = this.lodQueue.indexOf(e);
      if (i >= 0) this.lodQueue.splice(i, 1);
      if (e.lodState === "queued") this.buildLod(e);
    }
    for (const e of near.sort((a, b) => distanceTo(a.info, px, py) - distanceTo(b.info, px, py))) {
      const data = e.data;
      if (!data) continue;
      e.data = null;
      this.registerDecks(e.info.id, data);
      const t0 = performance.now();
      this.finishBuild(e, data, finish(this.builder(data)), true);
      const ms = performance.now() - t0;
      this.record({ id: e.info.id, ms, frames: 0, slice: ms, at: performance.now() });
    }
  }

  get stats(): { loaded: string[]; triangles: number; draws: number; lods: number; tileStats: Record<string, TileStats> } {
    const loaded: string[] = [];
    const tileStats: Record<string, TileStats> = {};
    let triangles = 0, draws = 0, lods = 0;
    for (const e of this.entries.values()) {
      if (e.lod) {
        lods++;
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
    return { loaded, triangles: Math.round(triangles), draws, lods, tileStats };
  }
}
