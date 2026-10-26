import * as THREE from "three";
import type { Terrain } from "../data/terrain";
import type { GroundMeta } from "../data/types";

const GROUND_TEXTURES = ["asphalt", "sett", "gravel", "grass", "sidewalk", "paving"] as const;
const CHUNK = 250;
/** Pas du maillage selon la distance au joueur (m) : [distance max, pas]. */
const LEVELS: [number, number][] = [[110, 2], [380, 5], [Infinity, 12]];
const SKIRT_INNER = 3;
const SKIRT_OUTER = 40;

function loadTexture(url: string): Promise<THREE.Texture> {
  return new Promise((resolve, reject) => {
    new THREE.TextureLoader().load(
      url,
      (t) => {
        t.wrapS = t.wrapT = THREE.RepeatWrapping;
        t.colorSpace = THREE.SRGBColorSpace;
        t.anisotropy = 8;
        resolve(t);
      },
      undefined,
      () => reject(new Error(`texture introuvable : ${url}`)),
    );
  });
}

/** Poids de mélange (données, pas des couleurs) : mipmaps pour ne pas scintiller au loin. */
function weightTexture(img: HTMLImageElement): THREE.Texture {
  const t = new THREE.Texture(img);
  t.colorSpace = THREE.NoColorSpace;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  t.needsUpdate = true;
  return t;
}

interface Chunk {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  mesh: THREE.Mesh | null;
  level: number;
}

/** Relief découpé en morceaux de 250 m dont le pas du maillage dépend de la distance ; chaque morceau a une jupe. */
export class TerrainView {
  readonly group = new THREE.Group();
  private readonly chunks: Chunk[] = [];
  private readonly material: THREE.MeshStandardMaterial;
  triangles = 0;

  private constructor(
    private readonly terrain: Terrain,
    material: THREE.MeshStandardMaterial,
    private readonly nearStep: number,
  ) {
    this.material = material;
    for (let y = terrain.yMin; y < terrain.yMax - 1e-6; y += CHUNK) {
      for (let x = terrain.xMin; x < terrain.xMax - 1e-6; x += CHUNK) {
        this.chunks.push({ x0: x, y0: y, x1: Math.min(x + CHUNK, terrain.xMax), y1: Math.min(y + CHUNK, terrain.yMax), mesh: null, level: -1 });
      }
    }
  }

  static async create(terrain: Terrain, meta: GroundMeta, a: HTMLImageElement, b: HTMLImageElement, nearStep = 2): Promise<TerrainView> {
    const textures = await Promise.all(GROUND_TEXTURES.map((n) => loadTexture(`${import.meta.env.BASE_URL}textures/ground/${n}.jpg`)));
    const wA = weightTexture(a), wB = weightTexture(b);
    const gw = meta.cols * meta.res, gh = meta.rows * meta.res;
    const ground = new THREE.Vector4(meta.x0, meta.y1 - gh, 1 / gw, 1 / gh);
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.95, metalness: 0, side: THREE.DoubleSide });
    mat.onBeforeCompile = (shader) => {
      shader.uniforms["wA"] = { value: wA };
      shader.uniforms["wB"] = { value: wB };
      shader.uniforms["uGround"] = { value: ground };
      textures.forEach((t, i) => (shader.uniforms[`t${i}`] = { value: t }));
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", "#include <common>\nuniform vec4 uGround;\nvarying vec2 vG;\nvarying vec2 vW;")
        .replace("#include <begin_vertex>", "#include <begin_vertex>\nvG = vec2((position.x - uGround.x) * uGround.z, (-position.z - uGround.y) * uGround.w);\nvW = position.xz;");
      shader.fragmentShader = shader.fragmentShader
        .replace(
          "#include <common>",
          `#include <common>
varying vec2 vG; varying vec2 vW;
uniform sampler2D wA; uniform sampler2D wB;
uniform sampler2D t0; uniform sampler2D t1; uniform sampler2D t2; uniform sampler2D t3; uniform sampler2D t4; uniform sampler2D t5;
vec3 tile(sampler2D t, vec2 p, float s) { return mix(texture2D(t, p / s).rgb, texture2D(t, p / (s * 3.7) + 0.31).rgb, 0.4); }`,
        )
        .replace(
          "#include <map_fragment>",
          `vec3 a = texture2D(wA, vG).rgb; vec3 b = texture2D(wB, vG).rgb;
float pav = max(1.0 - (a.r + a.g + a.b + b.r + b.g), 0.0);
vec3 gcol = a.r * tile(t0, vW, 3.0) * 1.15 + a.g * tile(t1, vW, 2.4) + a.b * tile(t2, vW, 2.6) * 1.1
          + b.r * tile(t3, vW, 2.2) * 0.9 + b.g * tile(t4, vW, 2.4) + pav * tile(t5, vW, 2.8);
gcol *= 1.0 - 0.5 * b.b;
diffuseColor.rgb *= gcol;`,
        );
    };
    return new TerrainView(terrain, mat, nearStep);
  }

  private levelFor(c: Chunk, px: number, py: number): number {
    const dx = Math.max(c.x0 - px, 0, px - c.x1), dy = Math.max(c.y0 - py, 0, py - c.y1);
    const d = Math.hypot(dx, dy);
    return LEVELS.findIndex(([max]) => d < max);
  }

  private build(c: Chunk, level: number): void {
    const t = this.terrain;
    const step = level === 0 ? this.nearStep : LEVELS[level]![1];
    const cx = Math.max(1, Math.round((c.x1 - c.x0) / step)), cy = Math.max(1, Math.round((c.y1 - c.y0) / step));
    const nx = cx + 1, ny = cy + 1;
    const total = nx * ny;
    const pos: number[] = [], nrm: number[] = [];
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const x = c.x0 + ((c.x1 - c.x0) * i) / cx, y = c.y0 + ((c.y1 - c.y0) * j) / cy;
        pos.push(x, t.heightAt(x, y), -y);
        const e = Math.max(step * 0.5, 1);
        const gx = (t.heightAt(x + e, y) - t.heightAt(x - e, y)) / (2 * e), gy = (t.heightAt(x, y + e) - t.heightAt(x, y - e)) / (2 * e);
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
    // Jupe : copie des sommets de bord, abaissée (plus profonde sur le bord extérieur de la zone).
    const skirtOf = (i: number, j: number): number => {
      const outer = (i === 0 && c.x0 <= t.xMin + 1e-6) || (i === cx && c.x1 >= t.xMax - 1e-6) || (j === 0 && c.y0 <= t.yMin + 1e-6) || (j === cy && c.y1 >= t.yMax - 1e-6);
      return outer ? SKIRT_OUTER : SKIRT_INNER;
    };
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
      c.mesh = new THREE.Mesh(g, this.material);
      c.mesh.receiveShadow = true;
      this.group.add(c.mesh);
    }
    this.triangles += idx.length / 3;
    c.level = level;
  }

  /** Met à jour les niveaux de détail ; `budget` limite le nombre de morceaux reconstruits par appel. */
  update(px: number, py: number, budget = 2): void {
    const todo = this.chunks
      .map((c) => ({ c, want: this.levelFor(c, px, py) }))
      .filter((o) => o.want !== o.c.level)
      .sort((a, b) => a.want - b.want);
    for (const { c, want } of todo.slice(0, budget)) this.build(c, want);
  }

  /** Construit immédiatement tous les morceaux au niveau voulu autour de (px, py). */
  settle(px: number, py: number): void {
    this.update(px, py, this.chunks.length);
  }
}
