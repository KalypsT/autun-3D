import { weatherize } from "./weather-fx";
import * as THREE from "three";
import { loadGround } from "../data/load";
import { finish, type Steps } from "./geometry";
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
/**
 * Construction étalée des morceaux (D285) : temps de travail par image (ms) et lignes de la grille calculées entre deux points d'arrêt.
 * Un morceau proche (pas de 2,5 m) demande ≈ 51 000 altitudes : 8 à 11 ms d'un bloc sur PC, et jusqu'à deux par image ; sur le téléphone,
 * c'étaient les blocs de 30 à 60 ms de la partie « décor » du banc à 300 km/h. L'ancien maillage reste affiché jusqu'au remplacement.
 */
const BUILD_SLICE_MS = 3;
/** Le morceau sous le joueur attend son niveau : jusqu'à URGENT_SLICE_MS par image (il garde sinon son maillage plus grossier quelques images). */
const URGENT_SLICE_MS = 8;
const ROWS_PER_STEP = 8;
const SKIRT_INNER = 4.5;
const SKIRT_OUTER = 40;
/**
 * Relief lointain du panorama (D268) : un maillage par super-tuile de 1 km, à pas de VISTA_STEP m, évidé dans un disque de VISTA_HOLE m
 * autour du point où il a été construit, et enfoncé de VISTA_SINK m sous le relief grossier là où il chevauche le relief proche (qui reste
 * au-dessus).
 */
const VISTA_STEP = 25;
const VISTA_SINK = 3;
const VISTA_HOLE = VIEW_RANGE - 100;
/** Le panorama se reconstruit quand le joueur s'est éloigné de plus de VISTA_MOVE m du centre de son trou. */
const VISTA_MOVE = 150;

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
  // Pas de `weatherize` ici : il enchaîne avec ce nuanceur une fois celui-ci posé (fin de la fonction).
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
  // Clé de programme propre au relief : `weatherize` la complète (sinon tous les nuanceurs enchaînés auraient le même texte).
  mat.customProgramCacheKey = () => "terrain-ground";
  return weatherize(mat, "ground");
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
  private pitsVersion = 0;
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
  /** Morceau en cours de construction étalée (D285), au niveau voulu, avec la version des creux d'affichage à son début. */
  private job: { c: Chunk; level: number; pits: number; steps: Steps<THREE.BufferGeometry> } | null = null;
  triangles = 0;
  /** Relief lointain du panorama (D268), par super-tuile, et centre de son trou. */
  private readonly vista = new Map<string, THREE.Mesh | null>();
  /** Super-tuiles construites autour d'un ancien centre : gardées à l'écran jusqu'à leur remplacement (pas de trou en roulant). */
  private readonly vistaStale = new Set<string>();
  private vistaCenter: [number, number] | null = null;
  vistaTriangles = 0;

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

  /** Construit le morceau au niveau voulu d'une traite (chargement, `settle`). */
  private build(c: Chunk, level: number): void {
    if (this.job?.c === c) this.job = null;
    this.apply(c, level, finish(this.buildSteps(c, level)));
  }

  /** Géométrie du morceau au niveau voulu, en rendant la main toutes les ROWS_PER_STEP lignes de la grille. */
  private *buildSteps(c: Chunk, level: number): Steps<THREE.BufferGeometry> {
    const [bx0, by0, bx1, by1] = c.info.bounds;
    // Relief nu : les tabliers de pont (D93) ne doivent pas combler la vallée sous eux.
    // Creux d'affichage (D248) : le relief proche passe sous le bowl, dessiné plus finement que ces carreaux.
    const field: HeightField = level < 2 ? this.terrain.display : this.terrain.coarse;
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
      if ((j + 1) % ROWS_PER_STEP === 0) yield;
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
    // Bandes de relief fin des remparts (D250), après la jupe (qui suppose ses sommets juste après la grille) : elles recouvrent le creux
    // d'affichage, côté haut du mur.
    if (level < 2) this.addCovers(bx0, by0, bx1, by1, pos, nrm, idx);
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("normal", new THREE.Float32BufferAttribute(nrm, 3));
    g.setIndex(idx);
    g.computeBoundingSphere();
    return g;
  }

  /** Remplace le maillage du morceau par la géométrie construite (ou le crée). */
  private apply(c: Chunk, level: number, g: THREE.BufferGeometry): void {
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
    this.triangles += g.index!.count / 3;
    c.level = level;
  }

  /**
   * Bandes de relief fin (D250) des segments dont le milieu est dans le morceau : le vrai relief (`ground`, sans creux) à mailles de 1 m sur
   * 0,8 m, 1 cm au-dessus (les sols vectoriels sont à 3,5 cm et plus).
   */
  private addCovers(bx0: number, by0: number, bx1: number, by1: number, pos: number[], nrm: number[], idx: number[]): void {
    const g = this.terrain.ground;
    for (const cv of this.terrain.pits.covers(bx0, by0, bx1, by1)) {
      const p = cv.pts, q = cv.nrm, n = p.length / 2;
      const K = Math.max(2, Math.ceil(cv.width / 0.8));
      for (let i = 0; i + 1 < n; i++) {
        const ax = p[2 * i]!, ay = p[2 * i + 1]!, bx = p[2 * i + 2]!, by = p[2 * i + 3]!;
        const mx = (ax + bx) / 2, my = (ay + by) / 2;
        if (mx < bx0 || mx >= bx1 || my < by0 || my >= by1) continue;
        const tx = bx - ax, ty = by - ay;
        const S = Math.max(1, Math.ceil(Math.hypot(tx, ty)));
        // Sens du repère (le long, en travers) : comme celui de la grille (x, y) si la bande part à gauche, inversé sinon.
        const flip = tx * q[2 * i + 1]! - ty * q[2 * i]! < 0;
        const base = pos.length / 3;
        for (let si = 0; si <= S; si++) {
          const u = si / S;
          let nx = q[2 * i]! + u * (q[2 * i + 2]! - q[2 * i]!), ny = q[2 * i + 1]! + u * (q[2 * i + 3]! - q[2 * i + 1]!);
          const l = Math.hypot(nx, ny) || 1;
          nx /= l;
          ny /= l;
          for (let k = 0; k <= K; k++) {
            const w = (cv.width * k) / K;
            const x = ax + u * tx + nx * w, y = ay + u * ty + ny * w;
            pos.push(x, g.heightAt(x, y) + 0.01, -y);
            const e = 0.5;
            const gx = (g.heightAt(x + e, y) - g.heightAt(x - e, y)) / (2 * e), gy = (g.heightAt(x, y + e) - g.heightAt(x, y - e)) / (2 * e);
            const ln = Math.hypot(gx, gy, 1);
            nrm.push(-gx / ln, 1 / ln, gy / ln);
          }
        }
        for (let si = 0; si < S; si++) {
          for (let k = 0; k < K; k++) {
            const a = base + si * (K + 1) + k, b = a + K + 1, d = a + 1, e = b + 1;
            if (flip) idx.push(a, d, b, d, e, b);
            else idx.push(a, b, d, b, e, d);
          }
        }
      }
    }
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
    const used = new Set<string>(this.vista.keys());
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
    // Creux d'affichage ajoutés ou retirés (tuile chargée ou déchargée, D248) : les morceaux proches qu'ils touchent se reconstruisent.
    if (this.terrain.pits.version !== this.pitsVersion) {
      this.pitsVersion = this.terrain.pits.version;
      const boxes = this.terrain.pits.boxes();
      for (const c of this.active) {
        const [x0, y0, x1, y1] = c.info.bounds;
        if (c.level >= 0 && c.level < 2 && (boxes.length === 0 || boxes.some(([a, b, cc, d]) => a <= x1 && cc >= x0 && b <= y1 && d >= y0))) c.level = -1;
      }
    }
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
    if (budget > 2) {
      // `settle` : tout, tout de suite.
      for (const { c, want } of todo.slice(0, budget)) this.build(c, want);
    } else this.work(todo, budget);
    if (this.frame % 120 === 0) this.sweepSupers();
  }

  /**
   * Construction étalée (D285) : avance le morceau en cours, puis les suivants de `todo` (au plus `budget` commencés par image, comme avant),
   * dans BUILD_SLICE_MS ms. Un morceau qui ne veut plus ce niveau (le joueur a filé) ou dont les creux d'affichage ont changé est abandonné.
   */
  private work(todo: readonly { c: Chunk; want: number; d: number }[], budget: number): void {
    const job = this.job;
    if (job && (job.pits !== this.pitsVersion || !todo.some((t) => t.c === job.c && t.want === job.level))) this.job = null;
    const t0 = performance.now();
    // Le morceau sous le joueur (distance nulle) passe en premier parmi ceux du même niveau voulu : il a droit à plus de temps.
    const slice = todo.some((t) => t.d === 0 && t.c.level !== t.want) ? URGENT_SLICE_MS : BUILD_SLICE_MS;
    let started = 0, next = 0;
    for (;;) {
      if (!this.job) {
        while (next < todo.length && (todo[next]!.c.level === todo[next]!.want)) next++;
        if (next >= todo.length || started >= budget) return;
        const { c, want } = todo[next++]!;
        this.job = { c, level: want, pits: this.pitsVersion, steps: this.buildSteps(c, want) };
        started++;
      }
      const j = this.job;
      let r = j.steps.next();
      while (!r.done && performance.now() - t0 < slice) r = j.steps.next();
      if (!r.done) return;
      this.job = null;
      this.apply(j.c, j.level, r.value);
      if (performance.now() - t0 >= slice) return;
    }
  }

  /**
   * Relief lointain du panorama (D268) : au-delà de VIEW_RANGE et jusqu'à `reach` m, une super-tuile de 1 km par maillage (une quarantaine
   * d'appels de dessin pour toute la ville, au lieu de quatre cents morceaux) ; `reach` ≤ VIEW_RANGE : rien n'est montré. Construit au plus
   * `budget` super-tuiles par appel ; les sols grossiers sont ceux du relief grossier (même matière).
   */
  updateVista(px: number, py: number, reach: number, budget = 3): void {
    const on = reach > VIEW_RANGE;
    if (!on) {
      for (const m of this.vista.values()) if (m) m.visible = false;
      return;
    }
    if (this.vistaCenter && Math.hypot(px - this.vistaCenter[0], py - this.vistaCenter[1]) > VISTA_MOVE) {
      this.vistaCenter = [px, py];
      for (const id of this.vista.keys()) this.vistaStale.add(id);
    }
    if (!this.vistaCenter) this.vistaCenter = [px, py];
    const side = this.superTiles * this.size;
    let built = 0;
    // Des plus proches aux plus lointaines : tant qu'une super-tuile manque, la mer du monde (282,5 m) se voit par le trou.
    const order = [...this.superCells.keys()].map((id) => {
      const [i, j] = id.slice(1).split("_").map(Number) as [number, number];
      const x0 = this.zone[0] + i * side, y0 = this.zone[1] + j * side;
      return { id, x0, y0, d: Math.hypot(Math.max(x0 - px, 0, px - x0 - side), Math.max(y0 - py, 0, py - y0 - side)) };
    }).sort((a, b) => a.d - b.d);
    for (const { id, x0, y0, d } of order) {
      const far = Math.hypot(Math.max(Math.abs(x0 - px), Math.abs(x0 + side - px)), Math.max(Math.abs(y0 - py), Math.abs(y0 + side - py)));
      const mesh = this.vista.get(id);
      if (d > reach || far < VISTA_HOLE) {
        if (mesh) mesh.visible = false;
        continue;
      }
      // Déjà construite (null : tout entière dans le trou, rien à dessiner ; sans ce repère, elle se reconstruirait à chaque image et
      // prendrait le budget de toutes les suivantes).
      if (mesh !== undefined && (!this.vistaStale.has(id) || built >= budget)) {
        if (mesh) mesh.visible = true;
        continue;
      }
      const set = this.supers.get(id);
      if (!set) this.wantSuper(id);
      if (!set || set === "loading" || built >= budget) continue;
      const m = this.buildVista(x0, y0, side, set.material);
      if (mesh) this.disposeVista(mesh);
      this.vistaStale.delete(id);
      this.vista.set(id, m);
      if (m) this.group.add(m);
      built++;
    }
  }

  private buildVista(x0: number, y0: number, side: number, material: THREE.Material): THREE.Mesh | null {
    const [cx, cy] = this.vistaCenter!;
    const n = Math.round(side / VISTA_STEP), field = this.terrain.coarse;
    const pos: number[] = [], nrm: number[] = [], idx: number[] = [];
    for (let j = 0; j <= n; j++) {
      for (let i = 0; i <= n; i++) {
        const x = x0 + i * VISTA_STEP, y = y0 + j * VISTA_STEP;
        // Enfoncé seulement là où il chevauche le relief proche (jusqu'à 400 m au-delà du trou) : plus loin, la plaine de l'Arroux (285 m)
        // passerait sous la mer du monde (282,5 m).
        const sink = VISTA_SINK * Math.min(1, Math.max(0, (VISTA_HOLE + 400 - Math.hypot(x - cx, y - cy)) / 100));
        pos.push(x, field.heightAt(x, y) - sink, -y);
        const e = VISTA_STEP;
        const gx = (field.heightAt(x + e, y) - field.heightAt(x - e, y)) / (2 * e), gy = (field.heightAt(x, y + e) - field.heightAt(x, y - e)) / (2 * e);
        const l = Math.hypot(gx, gy, 1);
        nrm.push(-gx / l, 1 / l, gy / l);
      }
    }
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const mx = x0 + (i + 0.5) * VISTA_STEP, my = y0 + (j + 0.5) * VISTA_STEP;
        if (Math.hypot(mx - cx, my - cy) < VISTA_HOLE) continue;
        const a = j * (n + 1) + i, b = a + 1, d = a + n + 1, e = d + 1;
        idx.push(a, b, d, b, e, d);
      }
    }
    if (!idx.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("normal", new THREE.Float32BufferAttribute(nrm, 3));
    g.setIndex(idx);
    g.computeBoundingSphere();
    const mesh = new THREE.Mesh(g, material);
    mesh.receiveShadow = true;
    this.vistaTriangles += idx.length / 3;
    return mesh;
  }

  /** Libère tout le relief lointain du panorama (on est redescendu en ville depuis un moment). */
  clearVista(): void {
    for (const m of this.vista.values()) if (m) this.disposeVista(m);
    this.vista.clear();
    this.vistaStale.clear();
    this.vistaCenter = null;
  }

  private disposeVista(m: THREE.Mesh): void {
    this.group.remove(m);
    this.vistaTriangles -= m.geometry.index!.count / 3;
    m.geometry.dispose();
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
