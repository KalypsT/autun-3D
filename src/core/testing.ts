import { Terrain } from "../data/terrain";

/** Terrain plat de 200 × 200 m centré sur l'origine, pour les tests. */
export function flatTerrain(z = 0): Terrain {
  const meta = { cols: 200, rows: 200, res: 1, x0: -100, y0: -100, y1: 100, base: z, unit: 0.01, zmin: z, zmax: z };
  return Terrain.decode(meta, new Uint16Array(200 * 200).buffer);
}
