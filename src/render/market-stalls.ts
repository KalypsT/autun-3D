import * as THREE from "three";

/**
 * Étals du marché (D201) : tréteaux, plateau, cagettes de fruits et légumes et bâche à rayures. **Deux appels de dessin** pour tout le
 * marché (maillages instanciés) : la structure (couleurs fixes) et la bâche (rayures blanches et de la couleur de l'instance).
 * Étal tourné vers −z (l'allée des clients), 2,3 m de large, posé au sol à y = 0 ; le marchand se tient derrière (+z).
 */

const BÂCHES = ["#c8323a", "#2f6fa8", "#3c8a4a", "#e0a020", "#7a3a8a", "#d85a1a"].map((c) => new THREE.Color(c));

function boxInto(parts: THREE.BufferGeometry[], sx: number, sy: number, sz: number, x: number, y: number, z: number, color: string): void {
  const g = new THREE.BoxGeometry(sx, sy, sz).toNonIndexed();
  g.translate(x, y, z);
  const c = new THREE.Color(color), n = g.getAttribute("position").count;
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) col.set([c.r, c.g, c.b], i * 3);
  g.setAttribute("color", new THREE.BufferAttribute(col, 3));
  parts.push(g);
}

function merge(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  let n = 0;
  for (const p of parts) n += p.getAttribute("position").count;
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), col = new Float32Array(n * 3);
  let o = 0;
  for (const p of parts) {
    pos.set(p.getAttribute("position").array as Float32Array, o * 3);
    nor.set(p.getAttribute("normal").array as Float32Array, o * 3);
    col.set(p.getAttribute("color").array as Float32Array, o * 3);
    o += p.getAttribute("position").count;
    p.dispose();
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
  g.setAttribute("color", new THREE.BufferAttribute(col, 3));
  return g;
}

/** Structure : tréteaux, plateau à nappe, cagettes garnies, montants de la bâche. */
export function stallFrameGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const wood = "#8a6a44", cloth = "#efe6d2";
  for (const x of [-0.95, 0.95]) for (const z of [-0.55, 0.15]) boxInto(parts, 0.05, 0.8, 0.05, x, 0.4, z, wood);
  boxInto(parts, 2.2, 0.05, 0.9, 0, 0.82, -0.2, cloth);
  boxInto(parts, 2.2, 0.35, 0.02, 0, 0.66, -0.66, cloth);
  const produce = ["#d8402a", "#e8a020", "#5a9a3a", "#c8b040", "#8a3a6a", "#e86a2a"];
  for (let i = 0; i < 6; i++) {
    const x = -0.85 + (i % 3) * 0.85, z = i < 3 ? -0.45 : 0.0;
    boxInto(parts, 0.55, 0.14, 0.38, x, 0.92, z, "#b88a52");
    boxInto(parts, 0.5, 0.06, 0.33, x, 1.0, z, produce[i]!);
  }
  for (const x of [-1.1, 1.1]) for (const z of [-0.7, 0.6]) boxInto(parts, 0.04, z < 0 ? 2.05 : 2.3, 0.04, x, z < 0 ? 1.025 : 1.15, z, "#9a9fa3");
  return merge(parts);
}

/** Bâche en pente douce, rayée : la couleur de sommet est le masque des rayures (1 couleur de la bâche, 0 blanc). */
export function stallAwningGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const n = 7, w = 2.4 / n;
  for (let i = 0; i < n; i++) {
    const x = -1.2 + w * (i + 0.5);
    // Pente : plus haute derrière (2,3 m) que devant (2,05 m).
    const g = new THREE.BoxGeometry(w, 0.03, 1.5).toNonIndexed();
    g.rotateX(-0.17);
    g.translate(x, 2.17, -0.05);
    // Masque des rayures : 1 bande de couleur, 0 bande blanche.
    const v = i % 2 === 0 ? 1 : 0;
    const c = g.getAttribute("position").count, col = new Float32Array(c * 3);
    for (let k = 0; k < c; k++) col.set([v, v, v], k * 3);
    g.setAttribute("color", new THREE.BufferAttribute(col, 3));
    parts.push(g);
  }
  return merge(parts);
}

export interface StallPlace {
  x: number;
  y: number;
  /** Cap de l'allée des clients (rad, 0 = nord, sens horaire) : l'étal la regarde. */
  heading: number;
  /** Couleur de la bâche (0 à 5). */
  color: number;
}

export class MarketStalls {
  readonly frame: THREE.InstancedMesh;
  readonly awning: THREE.InstancedMesh;
  private readonly tint: THREE.InstancedBufferAttribute;
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly up = new THREE.Vector3(0, 1, 0);
  private readonly one = new THREE.Vector3(1, 1, 1);
  private readonly p = new THREE.Vector3();

  constructor(scene: THREE.Scene, readonly capacity = 120) {
    this.frame = new THREE.InstancedMesh(stallFrameGeometry(), new THREE.MeshLambertMaterial({ vertexColors: true }), capacity);
    const awningMat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
    // Rayures : la couleur de sommet sert de masque (1 : couleur de la bâche, attribut d'instance `aTint` ; 0 : blanc cassé).
    awningMat.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", "#include <common>\nattribute vec3 aTint;\nvarying vec3 vTint;")
        .replace("#include <begin_vertex>", "#include <begin_vertex>\nvTint = aTint;");
      shader.fragmentShader = shader.fragmentShader
        .replace("#include <common>", "#include <common>\nvarying vec3 vTint;")
        .replace("#include <color_fragment>", "#include <color_fragment>\ndiffuseColor.rgb = mix(vec3(0.95, 0.93, 0.88), vTint, vColor.r);");
    };
    awningMat.customProgramCacheKey = () => "market-awning";
    const awningGeo = stallAwningGeometry();
    this.tint = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
    awningGeo.setAttribute("aTint", this.tint);
    this.awning = new THREE.InstancedMesh(awningGeo, awningMat, capacity);
    for (const mesh of [this.frame, this.awning]) {
      mesh.count = 0;
      mesh.visible = false;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      scene.add(mesh);
    }
    this.frame.name = "etals";
    this.awning.name = "baches";
  }

  /** Montre les étals `places` (au plus `capacity`), posés au sol (`ground`). Aucun appel de dessin sans étal. */
  update(places: readonly StallPlace[], ground: (x: number, y: number) => number): void {
    const n = Math.min(places.length, this.capacity);
    for (let i = 0; i < n; i++) {
      const s = places[i]!;
      // L'étal regarde son allée : son « devant » (−z local) suit le cap ; rotation autour de y de −cap + π.
      this.q.setFromAxisAngle(this.up, Math.PI - s.heading);
      this.m.compose(this.p.set(s.x, ground(s.x, s.y), -s.y), this.q, this.one);
      this.frame.setMatrixAt(i, this.m);
      this.awning.setMatrixAt(i, this.m);
      const c = BÂCHES[s.color % BÂCHES.length]!;
      this.tint.setXYZ(i, c.r, c.g, c.b);
    }
    for (const mesh of [this.frame, this.awning]) {
      mesh.count = n;
      mesh.visible = n > 0;
      mesh.instanceMatrix.needsUpdate = true;
    }
    this.tint.needsUpdate = true;
  }

  dispose(): void {
    for (const mesh of [this.frame, this.awning]) {
      mesh.removeFromParent();
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
    }
  }
}
