/**
 * Feu d'artifice du 14 juillet (plan « ville vivante », § 8, D202) : logique pure, déterministe (graine). Les fusées partent du plan d'eau
 * du Vallon, montent, éclatent en gerbes de particules qui retombent en s'éteignant ; le bouquet final multiplie les tirs.
 *
 * Le jeu va vite (une heure de jeu dure 50 s) : le spectacle couvre toute l'heure de 23 h à minuit, soit 50 s réelles.
 */

/** Centre du plan d'eau du Vallon (repère du jeu) : les fusées partent de là, à ± 120 m. */
export const LAKE = { x: 1240, y: 420, spread: 120 } as const;
export const SHOW = { from: 23, to: 24 } as const;

export interface Particle {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  /** Âge et durée de vie (s) ; couleur (0 à 5) ; 0 : traînée de la fusée, 1 : étincelle de la gerbe. */
  age: number;
  life: number;
  color: number;
  kind: number;
}

export interface Rocket {
  x: number;
  y: number;
  z: number;
  vz: number;
  /** Hauteur d'éclatement (m), couleur, taille de la gerbe. */
  burst: number;
  color: number;
  size: number;
}

const G = 9.81;

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Le feu : à chaque pas, des fusées partent selon l'heure ; elles éclatent ; les étincelles retombent. `onBurst` : éclatement (son). */
export class Fireworks {
  readonly rockets: Rocket[] = [];
  readonly particles: Particle[] = [];
  private readonly random: () => number;
  private next = 0;

  constructor(seed = 1407, readonly maxParticles = 2400, private readonly ground = 300) {
    this.random = rng(seed);
  }

  /** Cadence des tirs (fusées par seconde réelle) à cette heure : rien hors du spectacle, un tir par seconde, le bouquet final à la fin. */
  static rate(hour: number): number {
    if (hour < SHOW.from || hour >= SHOW.to) return 0;
    const t = (hour - SHOW.from) / (SHOW.to - SHOW.from);
    return t > 0.85 ? 6 : 1 + t;
  }

  step(dt: number, hour: number, onBurst?: (x: number, y: number, z: number, size: number) => void): void {
    const r = this.random;
    const rate = Fireworks.rate(hour);
    if (rate > 0) {
      this.next -= dt;
      while (this.next <= 0) {
        this.next += (0.5 + r()) / rate;
        this.rockets.push({
          x: LAKE.x + (r() - 0.5) * LAKE.spread, y: LAKE.y + (r() - 0.5) * LAKE.spread, z: this.ground,
          vz: 55 + r() * 20, burst: this.ground + 90 + r() * 70, color: Math.floor(r() * 6), size: 0.7 + r() * 0.6,
        });
      }
    }
    for (let i = this.rockets.length - 1; i >= 0; i--) {
      const k = this.rockets[i]!;
      k.z += k.vz * dt;
      k.vz -= G * 0.3 * dt;
      if (this.particles.length < this.maxParticles) this.particles.push({ x: k.x, y: k.y, z: k.z, vx: 0, vy: 0, vz: 0, age: 0, life: 0.5, color: 6, kind: 0 });
      if (k.z >= k.burst || k.vz <= 5) {
        this.rockets.splice(i, 1);
        onBurst?.(k.x, k.y, k.z, k.size);
        const n = Math.round(90 * k.size);
        const speed = 34 * k.size;
        for (let j = 0; j < n && this.particles.length < this.maxParticles; j++) {
          // Direction uniforme sur la sphère.
          const u = r() * 2 - 1, a = r() * Math.PI * 2, s = Math.sqrt(1 - u * u), v = speed * (0.85 + r() * 0.3);
          this.particles.push({ x: k.x, y: k.y, z: k.z, vx: s * Math.cos(a) * v, vy: s * Math.sin(a) * v, vz: u * v, age: 0, life: 2 + r() * 1.4, color: k.color, kind: 1 });
        }
      }
    }
    // Étincelles : freinées par l'air, tirées vers le bas ; elles s'éteignent au bout de leur vie.
    const drag = Math.exp(-dt * 1.6);
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i]!;
      p.age += dt;
      if (p.age >= p.life || p.z < this.ground) {
        this.particles[i] = this.particles[this.particles.length - 1]!;
        this.particles.pop();
        continue;
      }
      p.vx *= drag;
      p.vy *= drag;
      p.vz = p.vz * drag - G * 0.6 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
    }
  }
}
