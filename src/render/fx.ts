import * as THREE from "three";
import type { WeaponId } from "../core/weapons";

/**
 * Effets de tir et armes au sol (J5-3, D84), dans **un seul maillage instancié** : des boîtes, une par trait de tir, éclair de bouche, étincelle ou
 * morceau de cache. Matière sans éclairage, hors brouillard et hors tonalité (elles brillent), sans ombre. Rien d'actif : le maillage est caché, **0 appel
 * de dessin** ; dès qu'une instance existe, **+1 appel de dessin** quel que soit leur nombre. Style « affiche » : pas de sang, les impacts sur une
 * personne sont des éclats crème, ceux d'un mur des étincelles orange.
 *
 * Repère : celui du jeu en entrée (x est, y nord, z haut) ; la scène three est (x, z, −y).
 */

const CAPACITY = 192;
const TRACER_LIFE = 0.1;
const FLASH_LIFE = 0.06;
const SPARK_LIFE = 0.18;

const COLORS: Record<WeaponId, [number, number, number]> = {
  fists: [1, 1, 1],
  knife: [0.75, 0.82, 0.9],
  bat: [0.9, 0.62, 0.3],
  pistol: [0.95, 0.5, 0.2],
  shotgun: [0.9, 0.3, 0.2],
  rifle: [0.35, 0.65, 0.95],
};
const BEAM: [number, number, number] = [1, 0.8, 0.35];
const TRACER: [number, number, number] = [1, 0.93, 0.62];
const SPARK_WALL: [number, number, number] = [1, 0.6, 0.2];
const SPARK_BODY: [number, number, number] = [1, 0.97, 0.85];

/** Une arme au sol à dessiner. */
export interface PickupView {
  x: number;
  y: number;
  z: number;
  weapon: WeaponId;
}

interface Item {
  /** 0 trait, 1 éclair, 2 étincelle. */
  kind: 0 | 1 | 2;
  t: number;
  life: number;
  x: number;
  y: number;
  z: number;
  x1: number;
  y1: number;
  z1: number;
  vx: number;
  vy: number;
  vz: number;
  color: [number, number, number];
}

export class Fx {
  readonly mesh: THREE.InstancedMesh;
  private readonly items: Item[] = [];
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly p = new THREE.Vector3();
  private readonly s = new THREE.Vector3();
  private readonly e = new THREE.Euler();
  private readonly dir = new THREE.Vector3();
  private readonly color = new THREE.Color();
  private readonly z = new THREE.Vector3(0, 0, 1);
  /** Instances écrites au dernier `update` (diagnostic, tests). */
  count = 0;

  constructor(scene: THREE.Scene) {
    const material = new THREE.MeshBasicMaterial({ fog: false, toneMapped: false });
    this.mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), material, CAPACITY);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(CAPACITY * 3), 3);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;
    this.mesh.count = 0;
    this.mesh.visible = false;
    scene.add(this.mesh);
  }

  private add(it: Item): void {
    // Plein : le plus ancien s'efface.
    if (this.items.length >= CAPACITY - 40) this.items.shift();
    this.items.push(it);
  }

  /** Trait de tir de (x0, y0, z0) à (x1, y1, z1). */
  tracer(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): void {
    this.add({ kind: 0, t: 0, life: TRACER_LIFE, x: x0, y: y0, z: z0, x1, y1, z1, vx: 0, vy: 0, vz: 0, color: TRACER });
  }

  /** Éclair de bouche en (x, y, z). */
  flash(x: number, y: number, z: number): void {
    this.add({ kind: 1, t: 0, life: FLASH_LIFE, x, y, z, x1: 0, y1: 0, z1: 0, vx: 0, vy: 0, vz: 0, color: TRACER });
  }

  /** Gerbe d'étincelles en (x, y, z) : orange sur un mur, crème sur une personne ; `rand` donne des nombres de 0 à 1. */
  sparks(x: number, y: number, z: number, body: boolean, rand: () => number): void {
    for (let k = 0; k < 4; k++) {
      const a = rand() * Math.PI * 2, sp = 1.5 + rand() * 2.5;
      this.add({ kind: 2, t: 0, life: SPARK_LIFE, x, y, z, x1: 0, y1: 0, z1: 0, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, vz: 1 + rand() * 2, color: body ? SPARK_BODY : SPARK_WALL });
    }
  }

  /** Avance les effets de `dt` s et écrit les instances : effets vivants, puis les armes au sol (caisse qui tourne et rebondit, faisceau). */
  update(dt: number, pickups: readonly PickupView[], time: number): void {
    let n = 0;
    const mesh = this.mesh, m = this.m;
    const put = (r: number, g: number, b: number): void => {
      if (n >= CAPACITY) return;
      mesh.setMatrixAt(n, m);
      this.color.setRGB(r, g, b);
      mesh.setColorAt(n, this.color);
      n++;
    };
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i]!;
      // Un effet est dessiné au moins une fois, même si l'image qui le crée dure plus que lui (images longues du rendu logiciel, hoquet) : on le vieillit après.
      if (it.t >= it.life) {
        this.items.splice(i, 1);
        continue;
      }
      const u = it.t / it.life;
      it.t += dt;
      if (it.kind === 0) {
        // Trait : une boîte fine, couchée de l'un à l'autre point ; elle s'amincit en fin de vie.
        this.dir.set(it.x1 - it.x, it.z1 - it.z, -(it.y1 - it.y));
        const len = this.dir.length();
        if (len < 1e-4) continue;
        this.dir.divideScalar(len);
        this.q.setFromUnitVectors(this.z, this.dir);
        this.p.set((it.x + it.x1) / 2, (it.z + it.z1) / 2, -(it.y + it.y1) / 2);
        const w = 0.06 * (1 - u * 0.8);
        this.s.set(w, w, len);
        m.compose(this.p, this.q, this.s);
        put(it.color[0], it.color[1], it.color[2]);
      } else if (it.kind === 1) {
        // Éclair : deux boîtes en croix, qui rétrécissent.
        const sz = 0.34 * (1 - u * 0.6);
        this.p.set(it.x, it.z, -it.y);
        this.s.set(sz, sz * 0.25, sz * 0.25);
        this.q.identity();
        m.compose(this.p, this.q, this.s);
        put(1, 0.92, 0.5);
        this.s.set(sz * 0.25, sz, sz * 0.25);
        m.compose(this.p, this.q, this.s);
        put(1, 0.92, 0.5);
      } else {
        const sz = 0.07 * (1 - u * 0.7);
        this.p.set(it.x, it.z, -it.y);
        this.s.set(sz, sz, sz);
        this.q.identity();
        m.compose(this.p, this.q, this.s);
        put(it.color[0], it.color[1], it.color[2]);
        it.vz -= 9 * dt;
        it.x += it.vx * dt;
        it.y += it.vy * dt;
        it.z += it.vz * dt;
      }
    }
    for (const pk of pickups) {
      const c = COLORS[pk.weapon];
      const bob = Math.sin(time * 2.4 + pk.x) * 0.08;
      this.e.set(0.25, time * 1.3 + pk.y, 0);
      this.q.setFromEuler(this.e);
      this.p.set(pk.x, pk.z + 0.75 + bob, -pk.y);
      this.s.set(0.7, 0.4, 0.4);
      m.compose(this.p, this.q, this.s);
      put(c[0], c[1], c[2]);
      this.p.set(pk.x, pk.z + 1.9, -pk.y);
      this.s.set(0.2, 2.6, 0.2);
      this.q.identity();
      m.compose(this.p, this.q, this.s);
      put(BEAM[0], BEAM[1], BEAM[2]);
    }
    this.count = n;
    mesh.count = n;
    mesh.visible = n > 0;
    if (n > 0) {
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
    this.mesh.dispose();
  }
}
