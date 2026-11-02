import * as THREE from "three";

/**
 * Oiseaux (et chauves-souris) de la ville (D203) : **un appel de dessin par sorte** (maillage instancié). Le battement d'ailes, le
 * balancement sur l'eau et le cou du héron sont calculés par le nuanceur à partir d'un attribut d'instance (phase, en vol).
 * Parties (`part`) : 0 corps et tête, 1 aile gauche, 2 aile droite (elles pivotent autour du dos, axe z) ; modèles tournés vers −z.
 */

export type BirdKind = "duck" | "heron" | "swift" | "bat";

const PALETTES: Record<BirdKind, string[]> = {
  duck: ["#6a5a44", "#2f6a4a", "#7a6450", "#5a4a38"],
  heron: ["#a8acb0", "#9aa0a6"],
  swift: ["#2a2a2e", "#323236"],
  bat: ["#3a302c", "#2c2624"],
};

function box(o: { p: number[]; n: number[]; part: number[]; c: number[] }, cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, part: number, color: string): void {
  const g = new THREE.BoxGeometry(sx, sy, sz).toNonIndexed();
  g.translate(cx, cy, cz);
  const pos = g.getAttribute("position"), nor = g.getAttribute("normal"), col = new THREE.Color(color);
  for (let i = 0; i < pos.count; i++) {
    o.p.push(pos.getX(i), pos.getY(i), pos.getZ(i));
    o.n.push(nor.getX(i), nor.getY(i), nor.getZ(i));
    o.part.push(part);
    o.c.push(col.r, col.g, col.b);
  }
  g.dispose();
}

/** Géométrie d'une sorte (blanc = couleur de l'instance ; les autres couleurs sont fixes : bec, pattes). */
export function birdGeometry(kind: BirdKind): THREE.BufferGeometry {
  const o = { p: [] as number[], n: [] as number[], part: [] as number[], c: [] as number[] };
  const W = "#ffffff";
  if (kind === "duck") {
    box(o, 0, 0.1, 0, 0.2, 0.14, 0.36, 0, W);
    box(o, 0, 0.24, -0.15, 0.1, 0.12, 0.11, 0, W);
    box(o, 0, 0.22, -0.24, 0.05, 0.03, 0.08, 0, "#e8a020");
    box(o, 0, 0.14, 0.2, 0.08, 0.06, 0.08, 0, W);
  } else if (kind === "heron") {
    for (const x of [-0.05, 0.05]) box(o, x, 0.35, 0.02, 0.025, 0.7, 0.025, 0, "#d8a050");
    box(o, 0, 0.82, 0.05, 0.2, 0.22, 0.5, 0, W);
    box(o, 0, 1.12, -0.18, 0.06, 0.45, 0.06, 0, W);
    box(o, 0, 1.36, -0.24, 0.08, 0.08, 0.14, 0, W);
    box(o, 0, 1.35, -0.38, 0.03, 0.03, 0.18, 0, "#e8c040");
    box(o, -0.32, 0.86, 0.05, 0.6, 0.03, 0.42, 1, W);
    box(o, 0.32, 0.86, 0.05, 0.6, 0.03, 0.42, 2, W);
  } else {
    // Martinet (ailes en faux, longues) ou chauve-souris (ailes larges, corps court).
    const swift = kind === "swift";
    box(o, 0, 0, 0, 0.06, 0.05, swift ? 0.17 : 0.1, 0, W);
    box(o, -(swift ? 0.13 : 0.11), 0, 0.01, swift ? 0.22 : 0.18, 0.01, swift ? 0.05 : 0.11, 1, W);
    box(o, swift ? 0.13 : 0.11, 0, 0.01, swift ? 0.22 : 0.18, 0.01, swift ? 0.05 : 0.11, 2, W);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(o.p, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(o.n, 3));
  g.setAttribute("part", new THREE.Float32BufferAttribute(o.part, 1));
  g.setAttribute("color", new THREE.Float32BufferAttribute(o.c, 3));
  return g;
}

/** Ailes : rotation autour de l'axe du corps (z), battement selon la phase ; au repos (héron posé) repliées contre le corps. */
const VERTEX = `
{
  if (part > 0.5) {
    // En vol, les deux ailes battent ensemble ; posé (héron), repliées à plat sur le dos.
    float cx = transformed.x;
    if (aAnim.y > 0.5) {
      float a = sin(aAnim.x) * 0.9;
      transformed.x = cx * cos(a);
      transformed.y += abs(cx) * sin(a);
    } else {
      transformed.x = cx * 0.3;
      transformed.y += 0.03;
    }
  }
  // Canards : léger balancement sur l'eau.
  transformed.y += aAnim.z * sin(aAnim.x * 0.7) * 0.02;
}`;

export class BirdView {
  readonly mesh: THREE.InstancedMesh;
  private readonly anim: THREE.InstancedBufferAttribute;
  private readonly palette: THREE.Color[];
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly up = new THREE.Vector3(0, 1, 0);
  private readonly p = new THREE.Vector3();
  private readonly s = new THREE.Vector3();

  constructor(scene: THREE.Scene, readonly kind: BirdKind, readonly capacity: number) {
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
    mat.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", "#include <common>\nattribute float part;\nattribute vec3 aAnim;")
        .replace("#include <begin_vertex>", `#include <begin_vertex>${VERTEX}`);
    };
    mat.customProgramCacheKey = () => "bird";
    const geo = birdGeometry(kind);
    this.anim = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
    this.anim.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute("aAnim", this.anim);
    this.mesh = new THREE.InstancedMesh(geo, mat, capacity);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.count = 0;
    this.mesh.visible = false;
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = kind === "heron" || kind === "duck";
    this.mesh.name = kind;
    this.palette = PALETTES[kind].map((c) => new THREE.Color(c));
    for (let i = 0; i < capacity; i++) this.mesh.setColorAt(i, this.palette[0]!);
    scene.add(this.mesh);
  }

  /** `items` : position (repère du jeu), hauteur absolue, cap, phase, en vol, couleur. */
  update(items: readonly { x: number; y: number; z: number; heading: number; phase: number; flying: boolean; coat: number; size: number }[]): void {
    const n = Math.min(items.length, this.capacity);
    const anim = this.anim.array as Float32Array;
    for (let i = 0; i < n; i++) {
      const b = items[i]!;
      this.q.setFromAxisAngle(this.up, -b.heading);
      this.s.setScalar(b.size);
      this.m.compose(this.p.set(b.x, b.z, -b.y), this.q, this.s);
      this.mesh.setMatrixAt(i, this.m);
      this.mesh.setColorAt(i, this.palette[b.coat % this.palette.length]!);
      anim[i * 3] = b.phase;
      anim[i * 3 + 1] = b.flying ? 1 : 0;
      anim[i * 3 + 2] = this.kind === "duck" ? 1 : 0;
    }
    this.mesh.count = n;
    this.mesh.visible = n > 0;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    this.anim.needsUpdate = true;
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}
