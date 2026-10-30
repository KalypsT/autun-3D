import * as THREE from "three";

/**
 * Fumée des véhicules abîmés (D110), dans **un seul maillage instancié** : chaque bouffée est un petit polyèdre éclairé (style « affiche » :
 * des volumes à facettes, pas de transparence) qui monte, dérive avec le vent, gonfle, puis rétrécit jusqu'à disparaître.
 * Rien à l'écran : maillage caché, **0 appel de dessin** ; dès qu'une bouffée existe, **+1** (sans ombre), quel que soit leur nombre.
 * Il servira aussi aux flammes et à l'explosion (étape 3) et aux autres véhicules (étape 4).
 *
 * Repère : celui du jeu en entrée (x est, y nord, z haut) ; la scène three est (x, z, −y).
 */

const CAPACITY = 220;
/** Vent léger (m/s, vers l'est et le nord) : la fumée penche. */
const WIND = { x: 0.35, y: 0.2 };

interface Puff {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  t: number;
  life: number;
  size0: number;
  size1: number;
  spin: number;
  color: THREE.Color;
}

export class Smoke {
  readonly mesh: THREE.InstancedMesh;
  private readonly puffs: Puff[] = [];
  private readonly free: Puff[] = [];
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly e = new THREE.Euler();
  private readonly p = new THREE.Vector3();
  private readonly s = new THREE.Vector3();
  /** Bouffées écrites au dernier `update` (diagnostic, tests). */
  count = 0;

  constructor(scene: THREE.Scene | null) {
    const geo = new THREE.IcosahedronGeometry(0.5, 0);
    const material = new THREE.MeshLambertMaterial({ flatShading: true });
    this.mesh = new THREE.InstancedMesh(geo, material, CAPACITY);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(CAPACITY * 3), 3);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;
    this.mesh.count = 0;
    this.mesh.visible = false;
    scene?.add(this.mesh);
  }

  /** Une bouffée en (x, y, z), lancée à (vx, vy, vz) m/s, de taille size0 à size1 (m) pendant `life` secondes. Ignorée si tout est pris. */
  emit(x: number, y: number, z: number, vx: number, vy: number, vz: number, color: THREE.Color, size0: number, size1: number, life: number, rand: () => number): void {
    if (this.puffs.length >= CAPACITY) return;
    const p = this.free.pop() ?? ({ color: new THREE.Color() } as Puff);
    Object.assign(p, { x, y, z, vx, vy, vz, t: 0, life, size0, size1, spin: rand() * Math.PI * 2 });
    p.color.copy(color);
    this.puffs.push(p);
  }

  update(dt: number): void {
    let n = 0;
    for (let i = this.puffs.length - 1; i >= 0; i--) {
      const p = this.puffs[i]!;
      p.t += dt;
      if (p.t >= p.life) {
        this.puffs[i] = this.puffs[this.puffs.length - 1]!;
        this.puffs.pop();
        this.free.push(p);
        continue;
      }
      // Monte en ralentissant, prend le vent, perd son élan horizontal.
      const drag = Math.exp(-dt * 1.5);
      p.vx = WIND.x + (p.vx - WIND.x) * drag;
      p.vy = WIND.y + (p.vy - WIND.y) * drag;
      p.vz *= Math.exp(-dt * 0.6);
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      const k = p.t / p.life;
      // Gonfle vite, puis rétrécit sur le dernier tiers (elle « se dissipe »).
      const size = (p.size0 + (p.size1 - p.size0) * Math.sqrt(Math.min(1, k * 1.5))) * (k > 0.66 ? 1 - (k - 0.66) / 0.34 : 1);
      this.e.set(p.spin + k, p.spin * 0.7, 0);
      this.q.setFromEuler(this.e);
      this.m.compose(this.p.set(p.x, p.z, -p.y), this.q, this.s.setScalar(Math.max(size, 0.001)));
      this.mesh.setMatrixAt(n, this.m);
      this.mesh.setColorAt(n, p.color);
      n++;
    }
    this.count = n;
    this.mesh.count = n;
    this.mesh.visible = n > 0;
    if (n > 0) {
      this.mesh.instanceMatrix.needsUpdate = true;
      this.mesh.instanceColor!.needsUpdate = true;
    }
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}
