import * as THREE from "three";
import type { Dog } from "../core/dogs";
import { DOG_POSE } from "../core/dogs";

/**
 * Chiens (D199) : **un seul appel de dessin** pour tous les chiens (maillage instancié : chaque instance place, tourne et grandit le
 * chien ; le trot des pattes, la queue qui remue et la tête baissée pour renifler sont calculés par le nuanceur à partir de deux
 * attributs d'instance), et **un seul** pour toutes les laisses (segments). Le chien mesure 0,5 m au garrot à la taille 1.
 */

/** Pelages : fauve, noir, blanc cassé, gris, brun, roux. */
const COATS = ["#c89a5a", "#2a2624", "#ece4d4", "#8a8a88", "#6a4a32", "#b8642e"].map((c) => new THREE.Color(c));

/** Parties du chien (attribut `part`) : 0 corps, 1 tête, 2 queue, 3 à 6 pattes (avant gauche, avant droite, arrière gauche, arrière droite). */
function box(out: { p: number[]; n: number[]; part: number[]; shade: number[] }, cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, part: number, shade = 1): void {
  const g = new THREE.BoxGeometry(sx, sy, sz);
  g.translate(cx, cy, cz);
  const pos = g.getAttribute("position"), nor = g.getAttribute("normal"), idx = g.getIndex()!;
  for (let k = 0; k < idx.count; k++) {
    const i = idx.getX(k);
    out.p.push(pos.getX(i), pos.getY(i), pos.getZ(i));
    out.n.push(nor.getX(i), nor.getY(i), nor.getZ(i));
    out.part.push(part);
    out.shade.push(shade);
  }
  g.dispose();
}

/** Géométrie du chien, tourné vers −z (comme les personnages), pattes au sol à y = 0. */
export function dogGeometry(): THREE.BufferGeometry {
  const o = { p: [] as number[], n: [] as number[], part: [] as number[], shade: [] as number[] };
  box(o, 0, 0.4, 0, 0.24, 0.22, 0.62, 0);
  box(o, 0, 0.55, -0.36, 0.2, 0.2, 0.22, 1);
  box(o, 0, 0.5, -0.5, 0.11, 0.1, 0.14, 1, 0.92);
  box(o, -0.07, 0.68, -0.32, 0.05, 0.1, 0.05, 1, 0.8);
  box(o, 0.07, 0.68, -0.32, 0.05, 0.1, 0.05, 1, 0.8);
  box(o, 0, 0.5, 0.36, 0.05, 0.05, 0.24, 2);
  for (const [x, z, part] of [[-0.08, -0.22, 3], [0.08, -0.22, 4], [-0.08, 0.22, 5], [0.08, 0.22, 6]] as const) box(o, x, 0.155, z, 0.07, 0.31, 0.07, part, 0.85);
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(o.p, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(o.n, 3));
  g.setAttribute("part", new THREE.Float32BufferAttribute(o.part, 1));
  g.setAttribute("shade", new THREE.Float32BufferAttribute(o.shade, 1));
  return g;
}

const VERTEX_HEAD = /* glsl */ `
attribute float part;
attribute float shade;
attribute vec3 aAnim;
varying float vShade;`;

/** Pattes : rotation autour de la hanche (y = 0,31) selon la phase ; tête baissée pour renifler, chien assis ; queue qui remue. */
const VERTEX_BODY = /* glsl */ `
vShade = shade;
{
  float phase = aAnim.x, gait = aAnim.y, pose = aAnim.z;
  if (part >= 3.0) {
    float k = part - 3.0;
    float off = (k == 0.0 || k == 3.0) ? 0.0 : 3.14159;
    float a = sin(phase + off) * 0.55 * gait;
    // Assis : pattes arrière repliées vers l'avant.
    if (pose > 1.5 && k >= 2.0) a = -1.2;
    float y = transformed.y - 0.31, z = transformed.z - (k < 2.0 ? -0.22 : 0.22);
    transformed.y = 0.31 + y * cos(a) - z * sin(a);
    transformed.z = (k < 2.0 ? -0.22 : 0.22) + y * sin(a) + z * cos(a);
  }
  if (part == 1.0 && pose > 0.5 && pose < 1.5) { transformed.y -= 0.2; transformed.z -= 0.06; }
  if (part == 2.0) transformed.x += sin(phase * 2.0 + 1.0) * 0.06 * (transformed.z - 0.24) * 8.0 * (0.5 + 0.5 * gait);
  // Assis : l'arrière-train descend.
  if (pose > 1.5 && part != 1.0) transformed.y -= max(0.0, transformed.z + 0.1) * 0.45;
}`;

export class DogView {
  readonly mesh: THREE.InstancedMesh;
  readonly leashes: THREE.LineSegments;
  private readonly anim: THREE.InstancedBufferAttribute;
  private readonly leashPos: Float32Array;
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly up = new THREE.Vector3(0, 1, 0);
  private readonly v = new THREE.Vector3();
  private readonly s = new THREE.Vector3();

  constructor(scene: THREE.Scene, readonly capacity = 24) {
    const mat = new THREE.MeshLambertMaterial({ color: "#ffffff" });
    mat.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", `#include <common>${VERTEX_HEAD}`)
        .replace("#include <begin_vertex>", `#include <begin_vertex>${VERTEX_BODY}`);
      shader.fragmentShader = shader.fragmentShader
        .replace("#include <common>", "#include <common>\nvarying float vShade;")
        .replace("#include <color_fragment>", "#include <color_fragment>\ndiffuseColor.rgb *= vShade;");
    };
    mat.customProgramCacheKey = () => "dog";
    const geo = dogGeometry();
    this.anim = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
    this.anim.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute("aAnim", this.anim);
    this.mesh = new THREE.InstancedMesh(geo, mat, capacity);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.count = 0;
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false;
    this.mesh.name = "chiens";
    for (let i = 0; i < capacity; i++) this.mesh.setColorAt(i, COATS[0]!);
    this.leashPos = new Float32Array(capacity * 6);
    const lg = new THREE.BufferGeometry();
    lg.setAttribute("position", new THREE.BufferAttribute(this.leashPos, 3).setUsage(THREE.DynamicDrawUsage));
    this.leashes = new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: "#2a2420" }));
    this.leashes.frustumCulled = false;
    this.leashes.name = "laisses";
    scene.add(this.mesh, this.leashes);
  }

  /**
   * Dessine les chiens : `ground(x, y)` donne la hauteur du sol, `hand(dog)` la main du maître (repère three) ou null (pas de laisse).
   */
  update(dogs: readonly Dog[], ground: (x: number, y: number) => number, hand: (d: Dog, out: THREE.Vector3) => boolean): void {
    const n = Math.min(dogs.length, this.capacity);
    const anim = this.anim.array as Float32Array;
    let leashes = 0;
    for (let i = 0; i < n; i++) {
      const d = dogs[i]!;
      const z = ground(d.x, d.y);
      this.q.setFromAxisAngle(this.up, -d.heading);
      this.s.setScalar(d.size);
      this.m.compose(this.v.set(d.x, z, -d.y), this.q, this.s);
      this.mesh.setMatrixAt(i, this.m);
      this.mesh.setColorAt(i, COATS[d.coat % COATS.length]!);
      anim[i * 3] = d.phase;
      anim[i * 3 + 1] = Math.min(1, d.speed / 1.5);
      anim[i * 3 + 2] = d.pose === DOG_POSE.sit ? 2 : d.pose === DOG_POSE.sniff ? 1 : 0;
      if (hand(d, this.v)) {
        const k = leashes * 6;
        this.leashPos[k] = this.v.x;
        this.leashPos[k + 1] = this.v.y;
        this.leashPos[k + 2] = this.v.z;
        // Collier : à l'avant du cou.
        const fx = Math.sin(d.heading), fy = Math.cos(d.heading);
        this.leashPos[k + 3] = d.x + fx * 0.3 * d.size;
        this.leashPos[k + 4] = z + 0.55 * d.size;
        this.leashPos[k + 5] = -(d.y + fy * 0.3 * d.size);
        leashes++;
      }
    }
    this.mesh.count = n;
    this.mesh.visible = n > 0;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    this.anim.needsUpdate = true;
    const attr = this.leashes.geometry.getAttribute("position") as THREE.BufferAttribute;
    attr.needsUpdate = true;
    this.leashes.geometry.setDrawRange(0, leashes * 2);
    this.leashes.visible = leashes > 0;
  }

  setShadows(on: boolean): void {
    this.mesh.castShadow = on;
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.leashes.removeFromParent();
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
    this.leashes.geometry.dispose();
    (this.leashes.material as THREE.Material).dispose();
  }
}
