import type { HeightField, TerrainMeta, TileInfo, WorldManifest } from "./types";
import { Decks } from "../core/decks";

/** Grille d'altitudes : logique pure, sans rendu. */
export class Terrain implements HeightField {
  constructor(
    readonly meta: TerrainMeta,
    /** Altitudes en mètres, ligne 0 = nord. */
    readonly heights: Float32Array,
  ) {
    if (heights.length !== meta.cols * meta.rows) throw new Error("terrain : taille de grille incohérente");
  }

  /** Décode le fichier terrain.bin (uint16 little-endian, centimètres au-dessus de `base`). */
  static decode(meta: TerrainMeta, bin: ArrayBuffer): Terrain {
    const raw = new Uint16Array(bin);
    const heights = new Float32Array(raw.length);
    for (let i = 0; i < raw.length; i++) heights[i] = meta.base + (raw[i] ?? 0) * meta.unit;
    return new Terrain(meta, heights);
  }

  get xMin(): number {
    return this.meta.x0;
  }
  get xMax(): number {
    return this.meta.x0 + this.meta.cols * this.meta.res;
  }
  get yMin(): number {
    return this.meta.y1 - this.meta.rows * this.meta.res;
  }
  get yMax(): number {
    return this.meta.y1;
  }

  private at(col: number, row: number): number {
    const c = Math.min(Math.max(col, 0), this.meta.cols - 1);
    const r = Math.min(Math.max(row, 0), this.meta.rows - 1);
    return this.heights[r * this.meta.cols + c] ?? 0;
  }

  /** Altitude (interpolation bilinéaire) ; au-delà des bords, la valeur du bord. */
  heightAt(x: number, y: number): number {
    const { x0, y1, res } = this.meta;
    const fx = (x - x0) / res - 0.5;
    const fy = (y1 - y) / res - 0.5;
    const c0 = Math.floor(fx);
    const r0 = Math.floor(fy);
    const tx = fx - c0;
    const ty = fy - r0;
    const top = this.at(c0, r0) * (1 - tx) + this.at(c0 + 1, r0) * tx;
    const bottom = this.at(c0, r0 + 1) * (1 - tx) + this.at(c0 + 1, r0 + 1) * tx;
    return top * (1 - ty) + bottom * ty;
  }
}

/**
 * Relief de toute la zone, en deux résolutions : un relief grossier global (8 m) et des blocs fins (1 m) par tuile, chargés
 * à la demande. Un point dont le bloc fin est chargé a son altitude fine, les autres retombent sur le relief grossier.
 * Chaque bloc déborde de sa tuile : l'interpolation ne sort jamais de son bloc, donc pas de couture entre tuiles.
 */
export class TiledTerrain implements HeightField {
  /** Tabliers de pont et quais des tuiles chargées (D93). */
  readonly decks = new Decks();
  private readonly blocks: (Terrain | undefined)[];
  private readonly index = new Map<string, TileInfo>();
  private readonly pending = new Map<string, Promise<void>>();
  private readonly loadedSet = new Set<string>();
  /** Blocs introuvables : on ne les redemande pas. */
  private readonly failed = new Set<string>();
  private readonly cols: number;
  private readonly rows: number;
  private readonly x0: number;
  private readonly y0: number;
  private readonly size: number;
  private readonly zone: [number, number, number, number];
  readonly seaLevel: number | undefined;

  constructor(
    manifest: WorldManifest,
    /** Relief grossier de toute la zone. */
    readonly coarse: Terrain,
    private readonly fetchBlock: (id: string) => Promise<ArrayBuffer>,
  ) {
    this.cols = manifest.cols;
    this.rows = manifest.rows;
    [this.x0, this.y0] = manifest.gridOrigin;
    this.zone = manifest.zone;
    this.seaLevel = manifest.sea?.z;
    this.size = manifest.tileSize;
    this.blocks = new Array<Terrain | undefined>(this.cols * this.rows);
    for (const t of manifest.tiles) this.index.set(t.id, t);
  }

  /** Décode un fichier terrain/<id>.bin : float32[4] = base, x0, y1, côté, puis côté × côté uint16 (cm au-dessus de la base). */
  static decodeBlock(buf: ArrayBuffer): Terrain {
    const [base, x0, y1, n] = new Float32Array(buf, 0, 4) as unknown as [number, number, number, number];
    const raw = new Uint16Array(buf, 16, n * n);
    const heights = new Float32Array(raw.length);
    for (let i = 0; i < raw.length; i++) heights[i] = base + raw[i]! * 0.01;
    return new Terrain({ cols: n, rows: n, res: 1, x0, y0: y1 - n, y1, base, unit: 0.01, zmin: base, zmax: base }, heights);
  }

  get xMin(): number {
    return this.zone[0];
  }
  get xMax(): number {
    return this.zone[2];
  }
  get yMin(): number {
    return this.zone[1];
  }
  get yMax(): number {
    return this.zone[3];
  }

  private slot(x: number, y: number): number {
    const col = Math.floor((x - this.x0) / this.size), row = Math.floor((y - this.y0) / this.size);
    return col >= 0 && col < this.cols && row >= 0 && row < this.rows ? row * this.cols + col : -1;
  }

  /** Altitude de la surface : le relief, ou un tablier ou un quai au-dessus (D93) ; `zHint` départage deux niveaux. */
  heightAt(x: number, y: number, zHint?: number): number {
    const z = this.groundAt(x, y);
    return this.decks.empty ? z : this.decks.surface(x, y, z, zHint);
  }

  /** Relief nu (sans tabliers). */
  groundAt(x: number, y: number): number {
    const i = this.slot(x, y);
    const b = i < 0 ? undefined : this.blocks[i];
    return b ? b.heightAt(x, y) : this.coarse.heightAt(x, y);
  }

  /** Vue du relief nu, pour dessiner le sol, l'eau et les piles sous les ponts. */
  readonly ground: HeightField = ((t: TiledTerrain): HeightField => ({
    heightAt: (x, y) => t.groundAt(x, y),
    get xMin(): number { return t.xMin; }, get xMax(): number { return t.xMax; }, get yMin(): number { return t.yMin; }, get yMax(): number { return t.yMax; },
    get seaLevel(): number | undefined { return t.seaLevel; },
  }))(this);

  /** Altitude des rails : le tablier ferroviaire s'il y en a un, sinon le relief. */
  railAt(x: number, y: number): number {
    const z = this.groundAt(x, y);
    return this.decks.empty ? z : this.decks.surface(x, y, z, undefined, true);
  }

  private slotOf(id: string): number {
    const t = this.index.get(id);
    return t ? t.row * this.cols + t.col : -1;
  }

  has(id: string): boolean {
    const i = this.slotOf(id);
    return i >= 0 && this.blocks[i] !== undefined;
  }

  /** Bloc fin d'une tuile, déjà décodé (tests, chargement par lots). */
  setBlock(id: string, block: Terrain): void {
    const i = this.slotOf(id);
    if (i >= 0) {
      this.blocks[i] = block;
      this.loadedSet.add(id);
    }
  }

  drop(id: string): void {
    const i = this.slotOf(id);
    if (i >= 0) this.blocks[i] = undefined;
    this.loadedSet.delete(id);
  }

  /** Identifiants des blocs fins chargés. */
  loadedIds(): IterableIterator<string> {
    return this.loadedSet.values();
  }

  /** Charge le bloc fin d'une tuile (une seule requête, même si on le redemande). */
  request(id: string): Promise<void> {
    if (this.has(id) || this.failed.has(id)) return Promise.resolve();
    let p = this.pending.get(id);
    if (!p) {
      p = this.fetchBlock(id).then(
        (buf) => { this.setBlock(id, TiledTerrain.decodeBlock(buf)); this.pending.delete(id); },
        (err: unknown) => { this.pending.delete(id); this.failed.add(id); console.error(`relief ${id}`, err); },
      );
      this.pending.set(id, p);
    }
    return p;
  }

  /** Requêtes de blocs en cours. */
  get inflight(): number {
    return this.pending.size;
  }

  /** Les blocs fins de la tuile et de ses huit voisines sont chargés (ou n'existent pas) : les altitudes autour d'elle sont fines. */
  ready(t: TileInfo): boolean {
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        const col = t.col + dc, row = t.row + dr;
        if (col < 0 || col >= this.cols || row < 0 || row >= this.rows) continue;
        // Une voisine qui n'existe pas (hors de la commune) ou dont le bloc est introuvable ne bloque pas : repli sur le relief grossier.
        const id = `${col}_${row}`;
        if (!this.index.has(id) || this.failed.has(id)) continue;
        if (!this.blocks[row * this.cols + col]) return false;
      }
    }
    return true;
  }

  /** Nombre de blocs fins chargés. */
  get loaded(): number {
    return this.loadedSet.size;
  }
}
