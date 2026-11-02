import * as THREE from "three";
import type { Fireworks } from "../core/fireworks";

/** Couleurs des gerbes (rouge, or, vert, bleu, blanc, violet) et de la traînée des fusées. */
const COLORS = ["#ff4a3a", "#ffc84a", "#5aff7a", "#5aa8ff", "#ffffff", "#d26aff", "#ffd8a0"].map((c) => new THREE.Color(c));

/**
 * Le feu d'artifice à l'écran (D202) : toutes les particules en **un seul appel de dessin** (points additifs, de taille constante à
 * l'écran au-delà de 150 m), et leur reflet dans le plan d'eau (un second appel, plus pâle, sous la surface).
 */
export class FireworksView {
  readonly points: THREE.Points;
  readonly reflection: THREE.Points;
  private readonly pos: Float32Array;
  private readonly col: Float32Array;
  private readonly rpos: Float32Array;

  constructor(scene: THREE.Scene, readonly capacity = 2400, private readonly water = 300) {
    this.pos = new Float32Array(capacity * 3);
    this.col = new Float32Array(capacity * 3);
    this.rpos = new Float32Array(capacity * 3);
    const make = (pos: Float32Array, opacity: number, size: number): THREE.Points => {
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
      g.setAttribute("color", new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
      const m = new THREE.PointsMaterial({ size, sizeAttenuation: false, vertexColors: true, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
      const p = new THREE.Points(g, m);
      p.frustumCulled = false;
      p.visible = false;
      p.renderOrder = 6;
      scene.add(p);
      return p;
    };
    this.points = make(this.pos, 1, 4.5);
    this.points.name = "feu-artifice";
    this.reflection = make(this.rpos, 0.35, 3);
    this.reflection.name = "feu-reflet";
  }

  update(fw: Fireworks): void {
    const n = Math.min(fw.particles.length, this.capacity);
    for (let i = 0; i < n; i++) {
      const p = fw.particles[i]!;
      // Une étincelle s'éteint à la fin de sa vie (couleur vers le noir : additif, donc transparent).
      const fade = p.kind === 0 ? 1 - p.age / p.life : Math.pow(1 - p.age / p.life, 1.5);
      const c = COLORS[p.color]!;
      this.col.set([c.r * fade, c.g * fade, c.b * fade], i * 3);
      this.pos.set([p.x, p.z, -p.y], i * 3);
      this.rpos.set([p.x, 2 * this.water - p.z, -p.y], i * 3);
    }
    for (const pts of [this.points, this.reflection]) {
      const g = pts.geometry;
      g.setDrawRange(0, n);
      (g.getAttribute("position") as THREE.BufferAttribute).needsUpdate = true;
      (g.getAttribute("color") as THREE.BufferAttribute).needsUpdate = true;
      pts.visible = n > 0;
    }
  }

  dispose(): void {
    for (const pts of [this.points, this.reflection]) {
      pts.removeFromParent();
      pts.geometry.dispose();
      (pts.material as THREE.Material).dispose();
    }
  }
}
