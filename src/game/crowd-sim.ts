import type { Recipe } from "../core/character";
import { createRng, recipeFromSeed } from "../core/character";
import { phaseRate } from "../core/character-rig";
import { createCrowdState, type CrowdState } from "../render/crowd/crowd-types";

/**
 * Foule d'essai (prototype de l'étape P et banc de foule) : des promeneurs qui vont droit devant eux dans un secteur devant la caméra,
 * font demi-tour au bord, marchent, courent ou s'arrêtent. Ce n'est PAS la simulation de J2 : pas de navigation, pas de collisions.
 * Coordonnées de la scène three ; `groundAt(x, z)` donne la hauteur du terrain.
 */
export interface CrowdSimOptions {
  count: number;
  /** Position de la caméra (scène three) et direction du regard (cap, rad, rotation autour de y). */
  camX: number;
  camZ: number;
  camYaw: number;
  seed?: number;
  /** Distances min et max devant la caméra (m) et demi-angle du secteur (rad). */
  near?: number;
  far?: number;
  spread?: number;
}

export interface CrowdSim {
  state: CrowdState;
  /** Fait avancer la simulation de `dt` secondes. */
  step(dt: number, groundAt: (x: number, z: number) => number): void;
}

export function createCrowdSim(o: CrowdSimOptions): CrowdSim {
  const seed = o.seed ?? 1;
  const recipes: Recipe[] = Array.from({ length: o.count }, (_, i) => recipeFromSeed(seed * 100003 + i));
  const state = createCrowdState(recipes);
  const rng = createRng(seed ^ 0x51ed);
  const near = o.near ?? 5, far = o.far ?? 60, spread = o.spread ?? 0.85;
  // Cap de marche de chacun : direction du déplacement dans le plan (x, z de la scène).
  const dir = new Float32Array(o.count);
  const walk = new Float32Array(o.count);
  const toLocal = (x: number, z: number): { forward: number; side: number } => {
    // Repère de la caméra : « avant » = direction du regard (−z quand camYaw = 0).
    const dx = x - o.camX, dz = z - o.camZ;
    const fx = -Math.sin(o.camYaw), fz = -Math.cos(o.camYaw);
    return { forward: dx * fx + dz * fz, side: dx * -fz + dz * fx };
  };
  for (let i = 0; i < o.count; i++) {
    const dist = near + rng() * (far - near), ang = (rng() * 2 - 1) * spread;
    const fx = -Math.sin(o.camYaw + ang), fz = -Math.cos(o.camYaw + ang);
    state.x[i] = o.camX + fx * dist;
    state.z[i] = o.camZ + fz * dist;
    const k = rng();
    // 12 % à l'arrêt, 8 % qui courent, le reste marche entre 0,9 et 1,8 m/s.
    walk[i] = k < 0.12 ? 0 : k < 0.2 ? 3.6 + rng() * 1.6 : 0.9 + rng() * 0.9;
    dir[i] = rng() * Math.PI * 2;
    state.speed[i] = walk[i]!;
    state.phase[i] = rng() * Math.PI * 2;
  }
  return {
    state,
    step(dt, groundAt) {
      for (let i = 0; i < o.count; i++) {
        const v = walk[i]!;
        state.speed[i] = v;
        if (v > 0) {
          let x = state.x[i]! + Math.sin(dir[i]!) * v * dt, z = state.z[i]! + Math.cos(dir[i]!) * v * dt;
          const p = toLocal(x, z);
          // Au bord du secteur : demi-tour (vers le centre du secteur).
          if (p.forward < near || p.forward > far || Math.abs(p.side) > Math.max(2, p.forward * Math.tan(spread))) {
            const cx = o.camX - Math.sin(o.camYaw) * ((near + far) / 2), cz = o.camZ - Math.cos(o.camYaw) * ((near + far) / 2);
            dir[i] = Math.atan2(cx - state.x[i]!, cz - state.z[i]!);
            x = state.x[i]!;
            z = state.z[i]!;
          }
          state.x[i] = x;
          state.z[i] = z;
          state.phase[i] = (state.phase[i]! + phaseRate(v, state.recipes[i]!.height) * dt) % (Math.PI * 2);
        }
        // Le personnage regarde où il va : le « avant » du corps est −z, donc cap = π − direction.
        state.yaw[i] = Math.PI + dir[i]!;
        state.y[i] = groundAt(state.x[i]!, state.z[i]!);
      }
    },
  };
}
