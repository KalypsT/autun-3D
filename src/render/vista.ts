import * as THREE from "three";
import { loadLod } from "../data/load";
import type { TiledTerrain } from "../data/terrain";
import type { LodBuilding, TileInfo, WorldManifest } from "../data/types";
import type { Atmosphere } from "./atmosphere";
import { buildLodTile } from "./lod";
import type { TerrainView } from "./terrain";
import { VIEW_RANGE } from "./terrain";
import type { TileManager } from "./tile-manager";

/**
 * Panorama (D268, docs/plans/croix-liberation.md, lot 4) : en hauteur, au-dessus de la ville (la Croix de la Libération, les collines du sud),
 * l'horizon s'éloigne. Au sol, rien ne change : brouillard à 800 m, relief et silhouettes jusqu'à 1 300 m.
 *
 * Belvédère : la caméra domine le relief alentour (premier quartile du relief grossier sur un cercle de 1 km, la mer comptant pour son
 * niveau) de BELVEDERE[0] à BELVEDERE[1] m ; la part `k` (0 à 1) suit en douceur (TAU s). Avec `k` :
 * - le brouillard s'éloigne vers VISTA_RANGE (Atmosphere.setVista ; la brume et la pluie le rapprochent toujours) ;
 * - le plan lointain de la caméra suit ;
 * - au-delà de VIEW_RANGE, le relief lointain (TerrainView.updateVista) et les silhouettes des bâtiments, regroupées par super-tuile de 1 km
 *   (une quarantaine d'appels de dessin pour toute la ville), prennent le relais des morceaux et des silhouettes par tuile.
 * `?vista=0` : jamais ; `?vista=1` : toujours (captures, mesures).
 */
export const VISTA_RANGE = 7000;
const BELVEDERE: [number, number] = [90, 200];
const TAU = 1.2;
const RING = 1000;
const NEAR_FAR = 1200;
/** Le panorama se reconstruit quand le joueur s'est éloigné de plus de MOVE m de son centre (comme TerrainView). */
const MOVE = 150;
/** Super-tuiles de silhouettes en chargement à la fois. */
const MAX_LOADING = 3;
/** Après IDLE s sous le seuil, le panorama est libéré (relief lointain et silhouettes regroupées). */
const IDLE = 20;

const smooth = (a: number, b: number, v: number): number => {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

interface Far {
  mesh: THREE.Mesh | null;
  state: "loading" | "ready";
  /** Tuiles dont les silhouettes sont dans le maillage (celles à plus de VIEW_RANGE du centre quand il a été fait). */
  key: string;
}

export class Vista {
  /** Part du panorama, de 0 (au sol) à 1 (en belvédère). */
  k = 0;
  readonly group = new THREE.Group();
  triangles = 0;
  private readonly force: number | null;
  private center: [number, number] | null = null;
  private readonly supers = new Map<string, TileInfo[]>();
  private readonly far = new Map<string, Far>();
  private loading = 0;
  private idle = 0;
  private readonly seaZ: number;
  private readonly superSide: number;
  private readonly origin: [number, number];

  constructor(
    private readonly terrain: TiledTerrain,
    manifest: WorldManifest,
    private readonly view: TerrainView,
    private readonly tiles: TileManager,
    private readonly atmosphere: Atmosphere,
    private readonly camera: THREE.PerspectiveCamera,
    params: URLSearchParams,
  ) {
    const v = params.get("vista");
    this.force = v === "0" ? 0 : v === "1" ? 1 : null;
    this.seaZ = manifest.sea?.z ?? -Infinity;
    this.superSide = manifest.super.tiles * manifest.tileSize;
    this.origin = manifest.gridOrigin;
    for (const t of manifest.tiles) {
      if (!t.lod) continue;
      const id = `s${Math.floor(t.col / manifest.super.tiles)}_${Math.floor(t.row / manifest.super.tiles)}`;
      const list = this.supers.get(id) ?? [];
      list.push(t);
      this.supers.set(id, list);
    }
  }

  /** Hauteur de la caméra au-dessus du relief alentour (m) : premier quartile sur un cercle de RING m, la mer à son niveau. */
  dominance(x: number, y: number, z: number): number {
    const hs: number[] = [];
    for (let i = 0; i < 16; i++) {
      const a = (i * Math.PI) / 8;
      hs.push(Math.max(this.seaZ, this.terrain.coarse.heightAt(x + RING * Math.sin(a), y + RING * Math.cos(a))));
    }
    hs.sort((p, q) => p - q);
    return z - hs[4]!;
  }

  /**
   * À chaque image, après TileManager.update et TerrainView.update : (x, y) le joueur, `z` l'altitude de la caméra ; `instant` (viewer : la
   * caméra s'y téléporte) : pas de transition.
   */
  update(x: number, y: number, z: number, dt: number, instant = false): void {
    const target = this.force ?? smooth(BELVEDERE[0], BELVEDERE[1], this.dominance(x, y, z));
    this.k = this.force !== null || instant ? target : this.k + (target - this.k) * Math.min(1, dt / TAU);
    if (this.k < 1e-3) this.k = 0;
    const on = this.k > 0.02;
    this.atmosphere.setVista(this.k, VISTA_RANGE);
    const far = NEAR_FAR + (VISTA_RANGE * 1.1 - NEAR_FAR) * this.k;
    if (Math.abs(far - this.camera.far) > 5) {
      this.camera.far = far;
      this.camera.updateProjectionMatrix();
    }
    // Imposé (captures, mesures) : plusieurs super-tuiles par image, pour que tout soit là sans attendre.
    this.view.updateVista(x, y, on ? VISTA_RANGE : 0, this.force !== null ? 8 : 3);
    this.tiles.lodCutoff(x, y, on ? VIEW_RANGE : Infinity);
    this.group.visible = on;
    if (!on) {
      this.idle += dt;
      if (this.idle > IDLE && this.center && this.loading === 0) {
        for (const f of this.far.values()) this.dispose(f);
        this.far.clear();
        this.center = null;
        this.view.clearVista();
      }
      return;
    }
    this.idle = 0;
    // Le centre suit le joueur par pas de MOVE m ; seules les super-tuiles dont la liste de tuiles change sont refaites (une ou deux près du
    // bord du relief proche), les autres restent : en roulant sur la route de Montjeu, rien ne clignote.
    if (!this.center || Math.hypot(x - this.center[0], y - this.center[1]) > MOVE) this.center = [x, y];
    this.want(x, y);
  }

  /** Silhouettes regroupées des super-tuiles à portée, sans les tuiles à moins de VIEW_RANGE du centre (TileManager les dessine). */
  private want(x: number, y: number): void {
    const [cx, cy] = this.center!;
    for (const [id, list] of this.supers) {
      if (this.loading >= MAX_LOADING) break;
      const [i, j] = id.slice(1).split("_").map(Number) as [number, number];
      const x0 = this.origin[0] + i * this.superSide, y0 = this.origin[1] + j * this.superSide;
      const d = Math.hypot(Math.max(x0 - x, 0, x - x0 - this.superSide), Math.max(y0 - y, 0, y - y0 - this.superSide));
      if (d > VISTA_RANGE) continue;
      const mine = list.filter((t) => tileDistance(t, cx, cy) > VIEW_RANGE);
      const key = mine.map((t) => t.id).join(",");
      const old = this.far.get(id);
      if (old && old.key === key) continue;
      if (old?.state === "loading") continue;
      if (!mine.length) {
        if (old) this.dispose(old);
        this.far.set(id, { mesh: null, state: "ready", key });
        continue;
      }
      // L'ancien maillage reste montré jusqu'à ce que le nouveau soit prêt.
      const entry: Far = { mesh: null, state: "loading", key };
      if (old) this.far.set(id, { ...old, state: "loading" });
      else this.far.set(id, entry);
      this.loading++;
      void Promise.all(mine.map((t) => loadLod(t.id).catch(() => [] as LodBuilding[]))).then((parts) => {
        this.loading--;
        const cur = this.far.get(id);
        if (cur) this.dispose(cur);
        entry.mesh = buildLodTile(parts.flat(), this.terrain);
        entry.state = "ready";
        this.far.set(id, entry);
        if (entry.mesh) {
          this.group.add(entry.mesh);
          this.triangles += triangleCount(entry.mesh);
        }
      });
    }
  }

  private dispose(f: Far): void {
    if (!f.mesh) return;
    this.group.remove(f.mesh);
    this.triangles -= triangleCount(f.mesh);
    f.mesh.geometry.dispose();
    f.mesh = null;
  }
}

function triangleCount(m: THREE.Mesh): number {
  return m.geometry.index ? m.geometry.index.count / 3 : m.geometry.getAttribute("position").count / 3;
}

function tileDistance(t: TileInfo, px: number, py: number): number {
  const [x0, y0, x1, y1] = t.bounds;
  return Math.hypot(Math.max(x0 - px, 0, px - x1), Math.max(y0 - py, 0, py - y1));
}
