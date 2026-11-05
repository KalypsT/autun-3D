import type { NautiqueBlock, NautiqueModel } from "../data/types";
import { at, frameOf, type Frame } from "./landmarks";

/**
 * Base nautique du plan d'eau du Vallon (D245) : repère, toits, obstacles. Logique pure, partagée par le rendu (`src/render/nautique.ts`)
 * et les collisions (`world.ts`).
 */

/** Repère de la base : origine au coin sud-ouest du hangar du sud, s vers l'est-nord-est le long de son côté sud, t vers le nord-nord-ouest. */
export function nautiqueFrame(m: NautiqueModel): Frame {
  return frameOf(m.o[0], m.o[1], m.a, 1, 1);
}

/** Hauteur de la barrière levante baissée (lisse), section du mât au drapeau. */
export const NAUTIQUE_BARRIER_H = 1.0, NAUTIQUE_FLAG_POLE = 0.07;

/** Altitude du toit du volume au point (s, t) du repère (prolongée hors du volume pour les débords). */
export function roofAt(b: NautiqueBlock, s: number, t: number): number {
  const [s0, s1, t0, t1] = b.r, z = b.z, ridge = b.ridge ?? z;
  switch (b.roof) {
    case "flat":
      return z;
    case "mono": {
      const side = b.high ?? "s0";
      const u = side === "s0" ? (s1 - s) / (s1 - s0) : side === "s1" ? (s - s0) / (s1 - s0) : side === "t0" ? (t1 - t) / (t1 - t0) : (t - t0) / (t1 - t0);
      return z + (ridge - z) * u;
    }
    case "gable": {
      const alongS = (b.axis ?? "s") === "s";
      const c = b.at ?? (alongS ? (t0 + t1) / 2 : (s0 + s1) / 2), v = alongS ? t : s, lo = alongS ? t0 : s0, hi = alongS ? t1 : s1;
      const u = v <= c ? (v - lo) / (c - lo) : (hi - v) / (hi - c);
      return z + (ridge - z) * u;
    }
    case "hip": {
      // Pavillon : quatre pans jusqu'au sommet, au centre.
      const cs = (s0 + s1) / 2, ct = (t0 + t1) / 2;
      const u = Math.min(1 - Math.abs(s - cs) / ((s1 - s0) / 2), 1 - Math.abs(t - ct) / ((t1 - t0) / 2));
      return z + (ridge - z) * u;
    }
  }
}

const rect = (f: Frame, s0: number, s1: number, t0: number, t1: number): number[] => [...at(f, s0, t0), ...at(f, s1, t0), ...at(f, s1, t1), ...at(f, s0, t1)];

/** Obstacles (x, y) : chaque volume, le bloc de toilettes, le mât, les rochers, les potelets (D245). */
export function nautiqueRings(m: NautiqueModel): number[][] {
  const f = nautiqueFrame(m);
  const out = m.blocks.map((b) => rect(f, ...b.r));
  const site = m.site;
  if (site) {
    const [s, t, ls, lt] = site.wc;
    out.push(rect(f, s - ls / 2, s + ls / 2, t - lt / 2, t + lt / 2));
    const [ms, mt] = site.mast, p = 0.12;
    out.push(rect(f, ms - p, ms + p, mt - p, mt + p));
    for (const [rs, rt, r] of site.rocks) out.push(rect(f, rs - r * 0.8, rs + r * 0.8, rt - r * 0.8, rt + r * 0.8));
    for (const [bs, bt] of site.bollards) out.push(rect(f, bs - 0.08, bs + 0.08, bt - 0.08, bt + 0.08));
  }
  return out;
}

/** Ligne d'obstacle (x, y) : la barrière levante baissée ; on l'enjambe (1 m). */
export function nautiqueLines(m: NautiqueModel): number[][] {
  if (!m.site) return [];
  const f = nautiqueFrame(m), { a, b } = m.site.barrier;
  return [[...at(f, ...a), ...at(f, ...b)]];
}
