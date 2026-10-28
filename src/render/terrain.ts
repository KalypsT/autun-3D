import * as THREE from "three";
import { loadGround } from "../data/load";
import type { TiledTerrain } from "../data/terrain";
import type { HeightField, TileInfo, WorldManifest } from "../data/types";

/** Pas du maillage selon la distance au joueur (m) : [distance max, pas]. Au-delà de FINE_RANGE, relief grossier et sols grossiers. */
const LEVELS: [number, number][] = [[90, 2.5], [300, 6], [Infinity, 14]];
/** Distance en deçà de laquelle un morceau utilise le relief fin et les sols fins (m). */
export const FINE_RANGE = 300;
/** Au-delà de cette distance (m), le brouillard cache tout : aucun morceau n'est construit. */
export const VIEW_RANGE = 1300;
const VIEW_MARGIN = 250;
/** Les sols fins d'un morceau sont gardés tant qu'il est à moins de cette distance (m). */
const FINE_KEEP = 420;
const MAX_GROUND_FETCHES = 3;
const SKIRT_INNER = 4.5;
const SKIRT_OUTER = 40;

/** Poids de mélange (données, pas des couleurs) : mipmaps pour ne pas scintiller au loin. */
function weightTexture(img: HTMLImageElement | null, flat: [number, number, number]): THREE.Texture {
  const t = img ? new THREE.Texture(img) : new THREE.DataTexture(new Uint8Array([...flat, 255]), 1, 1, THREE.RGBAFormat);
  t.colorSpace = THREE.NoColorSpace;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  t.needsUpdate = true;
  return t;
}

/** Matériau du relief : mélange de six teintes de sol selon deux textures de poids, placées par `ground` = (x ouest, y sud, 1/largeur, 1/hauteur). */
function groundMaterial(wA: THREE.Texture, wB: THREE.Texture, ground: THREE.Vector4, palette: readonly string[]): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.95, metalness: 0, side: THREE.DoubleSide });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms["wA"] = { value: wA };
    shader.uniforms["wB"] = { value: wB };
    shader.uniforms["uGround"] = { value: ground };
    shader.uniforms["pal"] = { value: palette.map((c) => new THREE.Color(c)) };
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nuniform vec4 uGround;\nvarying vec2 vG;\nvarying vec2 vW;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvG = vec2((position.x - uGround.x) * uGround.z, (-position.z - uGround.y) * uGround.w);\nvW = position.xz;");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying vec2 vG; varying vec2 vW;\nuniform sampler2D wA; uniform sampler2D wB; uniform vec3 pal[6];")
      .replace(
        "#include <map_fragment>",
        `vec3 a = texture2D(wA, vG).rgb; vec3 b = texture2D(wB, vG).rgb;
float pav = max(1.0 - (a.r + a.g + a.b + b.r + b.g), 0.0);
vec3 gcol = a.r * pal[0] + a.g * pal[1] + a.b * pal[2] + b.r * pal[3] + b.g * pal[4] + pav * pal[5];
gcol *= 1.0 - 0.35 * b.b;
diffuseColor.rgb *= gcol;`,
      );
  };
  return mat;
}

/** Deux textures de poids et le matériau qui les utilise. */
interface GroundSet {
  material: THREE.MeshStandardMaterial;
  textures: THREE.Texture[];
}

function groundSet(images: [HTMLImageElement, HTMLImageElement] | null, ground: THREE.Vector4, palette: readonly string[]): GroundSet {
  // Sans images : herbe partout (A = 0, B = herbe).
  const a = weightTexture(images?.[0] ?? null, [0, 0, 0]), b = weightTexture(images?.[1] ?? null, [255, 0, 0]);
  return { material: groundMaterial(a, b, ground, palette), textures: [a, b] };
}

function disposeSet(g: GroundSet): void {
  for (const t of g.textures) t.dispose();
  g.material.dispose();
}

interface Chunk {
  info: TileInfo;
  /** Super-tuile qui porte ses sols grossiers. */
  superId: string;
  mesh: THREE.Mesh | null;
  level: number;
  /** Distance au joueur lors de la dernière mise à jour (m). */
  d: number;
  fine: GroundSet | null;
  fineLoading: boolean;
  /** Bords de la zone ou de la commune (pas de tuile voisine) : jupe profonde. */
  open: [boolean, boolean, boolean, boolean];
}

/**
 * Relief découpé en morceaux alignés sur les tuiles de 250 m. Près du joueur (FINE_RANGE), un morceau est maillé d'après le relief fin de
 * sa tuile et coloré par les sols fins de sa tuile (1 m par pixel) ; plus loin, d'après le relief grossier et les sols grossiers de sa
 * super-tuile (4 m par pixel). Tout est chargé à la demande, rien n'est global. Chaque morceau a une jupe.
 */
export class TerrainView {
  readonly group = new THREE.Group();
  private readonly chunks = new Map<number, Chunk>();
  private readonly cols: number;
  private readonly rows: number;
  private readonly size: number;
  /** Coin sud-ouest de la grille mondiale. */
  private readonly zone: [number, number];
  private readonly lattice: [number, number];
  private readonly blockSize: number;
  private readonly superCells: Map<string, { x0: number; y1: number }>;
  private readonly superTiles: number;
  private readonly superSize: number;
  private readonly superRes: number;
  private readonly supers = new Map<string, GroundSet | "loading">();
  private readonly fallback: GroundSet;
  private readonly active = new Set<Chunk>();
  private groundFetches = 0;
  private frame = 0;
  triangles = 0;

  private constructor(
    private readonly terrain: TiledTerrain,
    manifest: WorldManifest,
    private readonly nearStep: number,
    private readonly palette: readonly string[],
  ) {
    this.cols = manifest.cols;
    this.rows = manifest.rows;
    this.size = manifest.tileSize;
    this.zone = manifest.gridOrigin;
    this.lattice = manifest.lattice;
    this.blockSize = manifest.blockSize;
    this.superTiles = manifest.super.tiles;
    this.superSize = manifest.super.size;
    this.superRes = manifest.super.res;
    this.superCells = new Map(manifest.super.cells.map((s) => [s.id, s]));
    this.fallback = groundSet(null, new THREE.Vector4(0, 0, 1, 1), palette);
    const has = new Set(manifest.tiles.map((t) => t.row * this.cols + t.col));
    for (const t of manifest.tiles) {
      const open = (c: number, r: number): boolean => c < 0 || c >= this.cols || r < 0 || r >= this.rows || !has.has(r * this.cols + c);
      this.chunks.set(t.row * this.cols + t.col, {
        info: t, superId: `s${Math.floor(t.col / this.superTiles)}_${Math.floor(t.row / this.superTiles)}`, mesh: null, level: -1, d: Infinity, fine: null, fineLoading: false,
        open: [open(t.col - 1, t.row), open(t.col + 1, t.row), open(t.col, t.row - 1), open(t.col, t.row + 1)],
      });
    }
  }

  static create(terrain: TiledTerrain, manifest: WorldManifest, nearStep: number, palette: readonly string[]): TerrainView {
    return new TerrainView(terrain, manifest, nearStep, palette);
  }

  private distance(c: Chunk, px: number, py: number): number {
    const [x0, y0, x1, y1] = c.info.bounds;
    return Math.hypot(Math.max(x0 - px, 0, px - x1), Math.max(y0 - py, 0, py - y1));
  }

  private levelFor(d: number): number {
    return LEVELS.findIndex(([max]) => d < max);
  }

  /** Morceaux dont la distance au point est inférieure à `range`. */
  private near(px: number, py: number, range: number): Chunk[] {
    const out: Chunk[] = [];
    const c0 = Math.max(0, Math.floor((px - range - this.zone[0]) / this.size)), c1 = Math.min(this.cols - 1, Math.floor((px + range - this.zone[0]) / this.size));
    const r0 = Math.max(0, Math.floor((py - range - this.zone[1]) / this.size)), r1 = Math.min(this.rows - 1, Math.floor((py + range - this.zone[1]) / this.size));
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const ch = this.chunks.get(r * this.cols + c);
        if (ch) out.push(ch);
      }
    }
    return out;
  }

  private fineGround(c: Chunk): THREE.Vector4 {
    const [fx, fy] = this.lattice;
    const [bx0, , , by1] = c.info.bounds;
    const ox = fx + Math.floor(bx0 - fx) - 1, oy = fy + Math.ceil(by1 - fy) + 1;
    const n = this.blockSize;
    return new THREE.Vector4(ox, oy - n, 1 / n, 1 / n);
  }

  private material(c: Chunk): THREE.Material {
    if (c.fine) return c.fine.material;
    const s = this.supers.get(c.superId);
    return s && s !== "loading" ? s.material : this.fallback.material;
  }

  private build(c: Chunk, level: number): void {
    const [bx0, by0, bx1, by1] = c.info.bounds;
    // Relief nu : les tabliers de pont (D93) ne doivent pas combler la vallée sous eux.
    const field: HeightField = level < 2 ? this.terrain.ground : this.terrain.coarse;
    const step = level === 0 ? this.nearStep : LEVELS[level]![1];
    const cx = Math.max(1, Math.round((bx1 - bx0) / step)), cy = Math.max(1, Math.round((by1 - by0) / step));
    const nx = cx + 1, ny = cy + 1;
    const total = nx * ny;
    const pos: number[] = [], nrm: number[] = [];
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const x = bx0 + ((bx1 - bx0) * i) / cx, y = by0 + ((by1 - by0) * j) / cy;
        pos.push(x, field.heightAt(x, y), -y);
        const e = Math.max(step * 0.5, 1);
        const gx = (field.heightAt(x + e, y) - field.heightAt(x - e, y)) / (2 * e), gy = (field.heightAt(x, y + e) - field.heightAt(x, y - e)) / (2 * e);
        const l = Math.hypot(gx, gy, 1);
        nrm.push(-gx / l, 1 / l, gy / l);
      }
    }
    const idx: number[] = [];
    for (let j = 0; j < cy; j++) {
      for (let i = 0; i < cx; i++) {
        const a = j * nx + i, b = a + 1, d = a + nx, e = d + 1;
        idx.push(a, b, d, b, e, d);
      }
    }
    // Jupe : copie des sommets de bord, abaissée (plus profonde là où il n'y a pas de tuile voisine).
    const [openW, openE, openS, openN] = c.open;
    const skirtOf = (i: number, j: number): number =>
      (i === 0 && openW) || (i === cx && openE) || (j === 0 && openS) || (j === cy && openN) ? SKIRT_OUTER : SKIRT_INNER;
    const ring: [number, number][] = [];
    for (let i = 0; i < cx; i++) ring.push([i, 0]);
    for (let j = 0; j < cy; j++) ring.push([cx, j]);
    for (let i = cx; i > 0; i--) ring.push([i, cy]);
    for (let j = cy; j > 0; j--) ring.push([0, j]);
    const base = total;
    ring.forEach(([i, j]) => {
      const v = j * nx + i;
      pos.push(pos[3 * v]!, pos[3 * v + 1]! - skirtOf(i, j), pos[3 * v + 2]!);
      nrm.push(nrm[3 * v]!, nrm[3 * v + 1]!, nrm[3 * v + 2]!);
    });
    for (let k = 0; k < ring.length; k++) {
      const [i0, j0] = ring[k]!, [i1, j1] = ring[(k + 1) % ring.length]!;
      const a = j0 * nx + i0, b = j1 * nx + i1, a2 = base + k, b2 = base + ((k + 1) % ring.length);
      idx.push(a, a2, b, b, a2, b2);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("normal", new THREE.Float32BufferAttribute(nrm, 3));
    g.setIndex(idx);
    g.computeBoundingSphere();
    if (c.mesh) {
      this.triangles -= c.mesh.geometry.index!.count / 3;
      c.mesh.geometry.dispose();
      c.mesh.geometry = g;
    } else {
      c.mesh = new THREE.Mesh(g, this.material(c));
      c.mesh.receiveShadow = true;
      this.group.add(c.mesh);
      this.active.add(c);
    }
    this.triangles += idx.length / 3;
    c.level = level;
  }

  private remove(c: Chunk): void {
    if (c.mesh) {
      this.group.remove(c.mesh);
      this.triangles -= c.mesh.geometry.index!.count / 3;
      c.mesh.geometry.dispose();
      c.mesh = null;
    }
    this.dropFine(c);
    c.level = -1;
    this.active.delete(c);
  }

  private dropFine(c: Chunk): void {
    if (!c.fine) return;
    disposeSet(c.fine);
    c.fine = null;
    if (c.mesh) c.mesh.material = this.material(c);
  }

  private wantFine(c: Chunk): void {
    if (c.fine || c.fineLoading || this.groundFetches >= MAX_GROUND_FETCHES) return;
    c.fineLoading = true;
    this.groundFetches++;
    void this.fetchFine(c);
  }

  private async fetchFine(c: Chunk): Promise<void> {
    try {
      const images = await loadGround(c.info.id);
      // Le morceau a pu s'éloigner pendant le chargement.
      if (c.d <= FINE_KEEP && !c.fine) {
        c.fine = groundSet(images, this.fineGround(c), this.palette);
        if (c.mesh) c.mesh.material = c.fine.material;
      }
    } catch (err) {
      console.error(`sols ${c.info.id}`, err);
    } finally {
      c.fineLoading = false;
      this.groundFetches--;
    }
  }

  private wantSuper(id: string): void {
    if (this.supers.has(id) || this.groundFetches >= MAX_GROUND_FETCHES) return;
    const cell = this.superCells.get(id);
    if (!cell) return;
    this.supers.set(id, "loading");
    this.groundFetches++;
    void this.fetchSuper(id, cell);
  }

  private async fetchSuper(id: string, cell: { x0: number; y1: number }): Promise<void> {
    try {
      const images = await loadGround(id);
      const side = this.superSize * this.superRes;
      this.supers.set(id, groundSet(images, new THREE.Vector4(cell.x0, cell.y1 - side, 1 / side, 1 / side), this.palette));
      for (const c of this.active) if (c.superId === id && c.mesh) c.mesh.material = this.material(c);
    } catch (err) {
      this.supers.delete(id);
      console.error(`sols ${id}`, err);
    } finally {
      this.groundFetches--;
    }
  }

  /** Libère les sols grossiers dont plus aucun morceau n'a besoin. */
  private sweepSupers(): void {
    const used = new Set<string>();
    for (const c of this.active) used.add(c.superId);
    for (const [id, s] of this.supers) {
      if (used.has(id) || s === "loading") continue;
      disposeSet(s);
      this.supers.delete(id);
    }
  }

  /** Met à jour les niveaux de détail ; `budget` limite le nombre de morceaux reconstruits par appel. */
  update(px: number, py: number, budget = 2): void {
    this.frame++;
    const todo: { c: Chunk; want: number; d: number }[] = [];
    for (const c of this.near(px, py, VIEW_RANGE + VIEW_MARGIN)) {
      const d = this.distance(c, px, py);
      c.d = d;
      if (d > VIEW_RANGE) {
        if (c.mesh && d > VIEW_RANGE + VIEW_MARGIN) this.remove(c);
        continue;
      }
      let want = this.levelFor(d);
      // Pas de relief fin chargé : en attendant, relief grossier.
      if (want < 2 && !this.terrain.has(c.info.id)) want = 2;
      if (want !== c.level) todo.push({ c, want, d });
      if (want < 2) this.wantFine(c);
      else if (c.fine && d > FINE_KEEP) this.dropFine(c);
      if (c.mesh || want >= 0) this.wantSuper(c.superId);
    }
    todo.sort((a, b) => a.want - b.want || a.d - b.d);
    for (const { c, want } of todo.slice(0, budget)) this.build(c, want);
    if (this.frame % 120 === 0) this.sweepSupers();
  }

  /** Construit immédiatement tous les morceaux au niveau voulu autour de (px, py). */
  settle(px: number, py: number): void {
    this.update(px, py, this.chunks.size);
  }

  /** Charge d'avance relief fin et sols (fins près de (px, py), grossiers jusqu'à VIEW_RANGE), puis construit les morceaux. */
  async preload(px: number, py: number): Promise<void> {
    const wait: Promise<unknown>[] = [];
    for (const c of this.near(px, py, FINE_RANGE + 360)) if (this.distance(c, px, py) < FINE_RANGE + 360) wait.push(this.terrain.request(c.info.id));
    await Promise.all(wait);
    const sup = new Set<string>();
    const fine: Promise<void>[] = [];
    for (const c of this.near(px, py, VIEW_RANGE)) {
      const d = this.distance(c, px, py);
      if (d >= VIEW_RANGE) continue;
      sup.add(c.superId);
      if (d < FINE_RANGE) {
        fine.push(loadGround(c.info.id).then((images) => { c.fine = groundSet(images, this.fineGround(c), this.palette); }));
      }
    }
    for (const id of sup) {
      const cell = this.superCells.get(id);
      if (!cell || this.supers.has(id)) continue;
      const side = this.superSize * this.superRes;
      fine.push(loadGround(id).then((images) => { this.supers.set(id, groundSet(images, new THREE.Vector4(cell.x0, cell.y1 - side, 1 / side, 1 / side), this.palette)); }));
    }
    await Promise.all(fine);
    this.settle(px, py);
  }
}
