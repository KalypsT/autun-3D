/**
 * Sol sous les pieds (plaisir de jeu, lot 1-5, D313) : herbe, gravier, pavés ou sol dur, d'après les couches de sol des tuiles (les mêmes
 * polygones que le rendu des sols). Seules les couches qui changent le bruit des pas sont gardées ; ailleurs (enrobé, trottoir, dallage,
 * chaussée), c'est le sol dur. Analogie : l'oreille qui reconnaît le crissement du gravier ou le froissement de la pelouse.
 */

export type Footing = "hard" | "sett" | "gravel" | "grass";

const LAYER_FOOTING: Record<string, Footing> = {
  lawn: "grass",
  pitch: "grass",
  road_gravel: "gravel",
  plaza_gravel: "gravel",
  path_gravel: "gravel",
  play_gravel: "gravel",
  schist_red: "gravel",
  schist_black: "gravel",
  path_schist: "gravel",
  road_sett: "sett",
  plaza_sett: "sett",
  plaza_granite: "sett",
  plaza_pavers: "sett",
  plaza_brick: "sett",
  plaza_slate: "sett",
};
/** Les couches du golf (fairways, greens, départs) sont de l'herbe ; ses bunkers, du sable (comme le gravier) ; allées et terrasse, du sol dur. */
function layerFooting(name: string): Footing | null {
  if (name === "golf_bunker") return "gravel";
  if (/^golf_(fairway|green|tee)/.test(name)) return "grass";
  return LAYER_FOOTING[name] ?? null;
}

/** Priorité quand deux couches se recouvrent : un chemin (gravier, pavés) posé sur une pelouse l'emporte. */
const PRIORITY: Record<Footing, number> = { hard: 0, grass: 1, gravel: 2, sett: 3 };

export interface FootingPoly {
  kind: Footing;
  /** Anneaux aplatis (extérieur puis trous) et emprise x0, y0, x1, y1. */
  rings: number[][];
  box: [number, number, number, number];
}

/** Les polygones d'une tuile qui comptent pour le bruit des pas. */
export function footingPolys(ground: Record<string, number[][][]> | undefined): FootingPoly[] {
  const out: FootingPoly[] = [];
  if (!ground) return out;
  for (const [name, polys] of Object.entries(ground)) {
    const kind = layerFooting(name);
    if (!kind) continue;
    for (const rings of polys) {
      const outer = rings[0];
      if (!outer || outer.length < 6) continue;
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (let i = 0; i < outer.length; i += 2) {
        x0 = Math.min(x0, outer[i]!); x1 = Math.max(x1, outer[i]!);
        y0 = Math.min(y0, outer[i + 1]!); y1 = Math.max(y1, outer[i + 1]!);
      }
      out.push({ kind, rings, box: [x0, y0, x1, y1] });
    }
  }
  return out;
}

/** Le point (x, y) est-il dans le polygone (règle pair-impair sur tous ses anneaux : les trous sont exclus) ? */
function inside(rings: number[][], x: number, y: number): boolean {
  let c = false;
  for (const r of rings) {
    const n = r.length / 2;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const xi = r[i * 2]!, yi = r[i * 2 + 1]!, xj = r[j * 2]!, yj = r[j * 2 + 1]!;
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
    }
  }
  return c;
}

/** Sol au point (x, y) d'après les polygones des tuiles chargées. */
export function footingAt(tiles: Iterable<readonly FootingPoly[]>, x: number, y: number): Footing {
  let best: Footing = "hard";
  for (const polys of tiles) {
    for (const p of polys) {
      if (PRIORITY[p.kind] <= PRIORITY[best]) continue;
      const b = p.box;
      if (x < b[0] || x > b[2] || y < b[1] || y > b[3]) continue;
      if (inside(p.rings, x, y)) best = p.kind;
    }
  }
  return best;
}

/** Brouhaha des passants (0 à 1) d'après leur nombre à moins de 20 m : discret à quelques-uns, plein dans une rue animée. */
export function crowdMurmur(count: number): number {
  return Math.min(1, Math.max(0, (count - 2) / 14)) * 0.65;
}
