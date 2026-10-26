import * as THREE from "three";

/** Conversion repère données (x est, y nord, z haut) -> three (x est, y haut, z = -nord). */
export function toThree(x: number, y: number, z: number): [number, number, number] {
  return [x, z, -y];
}

export type Vec3 = [number, number, number];

/** Accumulateur de triangles à normales plates et couleurs par sommet : un seul maillage par matériau. */
export class MeshBuilder {
  readonly positions: number[] = [];
  readonly normals: number[] = [];
  readonly colors: number[] = [];

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
      }
    }
  }

  get triangleCount(): number {
    return this.positions.length / 9;
  }

  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(this.positions, 3));
    g.setAttribute("normal", new THREE.Float32BufferAttribute(this.normals, 3));
    g.setAttribute("color", new THREE.Float32BufferAttribute(this.colors, 3));
    g.computeBoundingSphere();
    g.computeBoundingBox();
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
