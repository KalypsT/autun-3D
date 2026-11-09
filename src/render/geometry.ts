import * as THREE from "three";

/** Conversion repère données (x est, y nord, z haut) -> three (x est, y haut, z = -nord). */
export function toThree(x: number, y: number, z: number): [number, number, number] {
  return [x, z, -y];
}

export type Vec3 = [number, number, number];

/**
 * Travail découpé en tranches : chaque `yield` est un point où l'on peut rendre la main au navigateur
 * (construction des tuiles étalée sur plusieurs images). La valeur finale est le résultat.
 */
export type Steps<T> = Generator<void, T, void>;

/** Exécute un travail découpé d'une traite. */
export function finish<T>(steps: Steps<T>): T {
  let r = steps.next();
  while (!r.done) r = steps.next();
  return r.value;
}

/** Nombre de flottants copiés entre deux points d'arrêt lors de l'assemblage d'un maillage. */
const COPY_CHUNK = 40_000;

/** Accumulateur de triangles à normales plates et couleurs par sommet : un seul maillage par matériau. */
export class MeshBuilder {
  readonly positions: number[] = [];
  readonly normals: number[] = [];
  readonly colors: number[] = [];
  /**
   * Étiquette par sommet (attribut `aTag`, D200), seulement si le maillage en porte (`tagged`) : les lumières de la ville s'en servent
   * (seuil d'allumage d'une fenêtre, d'un lampadaire, horaire d'un commerce). `tag` est la valeur donnée aux sommets suivants.
   */
  readonly tags: number[] | null;
  tag = 0;
  /**
   * Opacité par sommet (D297), créée au premier sommet qui en a une (`triColors`) : les sommets d'avant valent 1. Le maillage assemblé porte
   * alors des couleurs à quatre composantes (three.js s'en sert seul) ; sans elle, trois composantes comme avant.
   */
  alphas: number[] | null = null;

  constructor(tagged = false) {
    this.tags = tagged ? [] : null;
  }

  /** Ajoute un triangle ; l'ordre des sommets est corrigé pour que la face regarde dans le sens de `n`. */
  tri(a: Vec3, b: Vec3, c: Vec3, n: Vec3, color: THREE.Color): void {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
    const flip = cx * n[0] + cy * n[1] + cz * n[2] < 0;
    const order = flip ? [a, c, b] : [a, b, c];
    for (const p of order) {
      this.positions.push(p[0], p[1], p[2]);
      this.normals.push(n[0], n[1], n[2]);
      this.colors.push(color.r, color.g, color.b);
    }
    this.tags?.push(this.tag, this.tag, this.tag);
    this.alphas?.push(1, 1, 1);
  }

  /** Triangle à couleur et opacité par sommet (voile de lumière des projecteurs, taches au sol, D297). */
  triColors(a: Vec3, b: Vec3, c: Vec3, n: Vec3, ca: THREE.Color, cb: THREE.Color, cc: THREE.Color, aa = 1, ab = 1, ac = 1): void {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    const flip = (uy * vz - uz * vy) * n[0] + (uz * vx - ux * vz) * n[1] + (ux * vy - uy * vx) * n[2] < 0;
    if (!this.alphas) this.alphas = new Array<number>(this.positions.length / 3).fill(1);
    const order: [Vec3, THREE.Color, number][] = flip ? [[a, ca, aa], [c, cc, ac], [b, cb, ab]] : [[a, ca, aa], [b, cb, ab], [c, cc, ac]];
    for (const [p, col, al] of order) {
      this.positions.push(p[0], p[1], p[2]);
      this.normals.push(n[0], n[1], n[2]);
      this.colors.push(col.r, col.g, col.b);
      this.alphas.push(al);
      this.tags?.push(this.tag);
    }
  }

  quad(a: Vec3, b: Vec3, c: Vec3, d: Vec3, n: Vec3, color: THREE.Color): void {
    this.tri(a, b, c, n, color);
    this.tri(a, c, d, n, color);
  }

  /** Quad dont la couleur passe de `low` (côté a-b) à `high` (côté c-d) : ombre au pied des murs, reflet dans les vitres. */
  quadGradient(a: Vec3, b: Vec3, c: Vec3, d: Vec3, n: Vec3, low: THREE.Color, high: THREE.Color): void {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    const flip = (uy * vz - uz * vy) * n[0] + (uz * vx - ux * vz) * n[1] + (ux * vy - uy * vx) * n[2] < 0;
    const tris: [Vec3, THREE.Color][][] = [
      [[a, low], [b, low], [c, high]],
      [[a, low], [c, high], [d, high]],
    ];
    for (const t of tris) {
      const order = flip ? [t[0]!, t[2]!, t[1]!] : t;
      for (const [p, col] of order) {
        this.positions.push(p[0], p[1], p[2]);
        this.normals.push(n[0], n[1], n[2]);
        this.colors.push(col.r, col.g, col.b);
        this.tags?.push(this.tag);
        this.alphas?.push(1);
      }
    }
  }

  get triangleCount(): number {
    return this.positions.length / 9;
  }

  build(): THREE.BufferGeometry {
    return finish(this.buildSteps());
  }

  /** Assemble ce maillage suivi de `more` en une géométrie, par blocs (copie des sommets étalée). */
  *buildSteps(more: readonly MeshBuilder[] = []): Steps<THREE.BufferGeometry> {
    const parts: MeshBuilder[] = [this, ...more];
    let n = 0;
    for (const p of parts) n += p.positions.length;
    // Opacité par sommet (D297) : couleurs à quatre composantes si l'une des parties en porte.
    const rgba = parts.some((p) => p.alphas);
    const out = { positions: new Float32Array(n), normals: new Float32Array(n), colors: new Float32Array(rgba ? (n / 3) * 4 : n) };
    for (const k of rgba ? (["positions", "normals"] as const) : (["positions", "normals", "colors"] as const)) {
      const dst = out[k];
      let o = 0;
      for (const p of parts) {
        const src = p[k];
        for (let i = 0; i < src.length; i += COPY_CHUNK) {
          const end = Math.min(src.length, i + COPY_CHUNK);
          for (let j = i; j < end; j++) dst[o + j] = src[j]!;
          yield;
        }
        o += src.length;
      }
    }
    if (rgba) {
      const dst = out.colors;
      let v = 0;
      for (const p of parts) {
        const nv = p.positions.length / 3;
        for (let i = 0; i < nv; i++, v++) {
          dst[4 * v] = p.colors[3 * i]!;
          dst[4 * v + 1] = p.colors[3 * i + 1]!;
          dst[4 * v + 2] = p.colors[3 * i + 2]!;
          dst[4 * v + 3] = p.alphas ? p.alphas[i]! : 1;
          if ((i & 16383) === 16383) yield;
        }
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(out.positions, 3));
    g.setAttribute("normal", new THREE.BufferAttribute(out.normals, 3));
    g.setAttribute("color", new THREE.BufferAttribute(out.colors, rgba ? 4 : 3));
    // Étiquettes (D200) : celles des maillages qui en portent, 0 pour les autres.
    if (parts.some((p) => p.tags)) {
      const tags = new Float32Array(n / 3);
      let o = 0;
      for (const p of parts) {
        if (p.tags) tags.set(p.tags, o);
        o += p.positions.length / 3;
      }
      g.setAttribute("aTag", new THREE.BufferAttribute(tags, 1));
    }
    g.computeBoundingBox();
    yield;
    g.computeBoundingSphere();
    return g;
  }
}

/** Hachage déterministe d'un texte vers [0, 1). */
export function hash01(text: string, salt = 0): number {
  let h = 2166136261 ^ salt;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 100000) / 100000;
}

export type UV = [number, number];

/** Comme MeshBuilder, avec coordonnées de texture (un maillage par matériau texturé). */
export class UvMeshBuilder {
  readonly positions: number[] = [];
  readonly normals: number[] = [];
  readonly uvs: number[] = [];
  readonly colors: number[] = [];

  tri(a: Vec3, b: Vec3, c: Vec3, n: Vec3, ua: UV, ub: UV, uc: UV, color: THREE.Color): void {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
    const flip = cx * n[0] + cy * n[1] + cz * n[2] < 0;
    const order: [Vec3, UV][] = flip ? [[a, ua], [c, uc], [b, ub]] : [[a, ua], [b, ub], [c, uc]];
    for (const [p, uv] of order) {
      this.positions.push(p[0], p[1], p[2]);
      this.normals.push(n[0], n[1], n[2]);
      this.uvs.push(uv[0], uv[1]);
      this.colors.push(color.r, color.g, color.b);
    }
  }

  quad(a: Vec3, b: Vec3, c: Vec3, d: Vec3, n: Vec3, ua: UV, ub: UV, uc: UV, ud: UV, color: THREE.Color): void {
    this.tri(a, b, c, n, ua, ub, uc, color);
    this.tri(a, c, d, n, ua, uc, ud, color);
  }

  get triangleCount(): number {
    return this.positions.length / 9;
  }

  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(this.positions, 3));
    g.setAttribute("normal", new THREE.Float32BufferAttribute(this.normals, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(this.uvs, 2));
    g.setAttribute("color", new THREE.Float32BufferAttribute(this.colors, 3));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}
