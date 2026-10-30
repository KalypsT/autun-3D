import type { HeightField } from "../data/types";

/**
 * La mer qui entoure le monde (D105) : on avance dans l'eau jusqu'à une certaine profondeur, jamais plus loin. Comme le rivage descend en
 * pente douce dans la plaine et tombe en falaise sur les hauteurs, la profondeur suffit à dire où s'arrêter : pas de mur à dessiner.
 */

/** Profondeur (m) au-delà de laquelle on ne peut plus avancer : à pied (l'eau à la taille), en voiture, sur un deux-roues. */
export const WADE_DEPTH = 1.0;
export const CAR_DEPTH = 0.5;
export const BIKE_DEPTH = 0.35;

/** Profondeur de la mer en (x, y), sur le relief nu ; 0 à terre ou sans mer. */
export function waterDepth(terrain: HeightField, x: number, y: number): number {
  const sea = terrain.seaLevel;
  if (sea === undefined) return 0;
  return Math.max(0, sea - (terrain.ground ?? terrain).heightAt(x, y));
}

/** Point le plus avancé vers (x, y), depuis (px, py), où la profondeur reste sous `max` : glisse le long du rivage. */
export function holdShore(terrain: HeightField, px: number, py: number, x: number, y: number, max: number): { x: number; y: number; blocked: boolean } {
  if (terrain.seaLevel === undefined || waterDepth(terrain, x, y) <= max) return { x, y, blocked: false };
  if (waterDepth(terrain, x, py) <= max) return { x, y: py, blocked: true };
  if (waterDepth(terrain, px, y) <= max) return { x: px, y, blocked: true };
  return { x: px, y: py, blocked: true };
}

/** Normale du rivage (vers la terre, unitaire) en (x, y), d'après la pente de la profondeur ; nulle sur le plat. */
export function shoreNormal(terrain: HeightField, x: number, y: number): [number, number] {
  const e = 1.5;
  const gx = waterDepth(terrain, x + e, y) - waterDepth(terrain, x - e, y);
  const gy = waterDepth(terrain, x, y + e) - waterDepth(terrain, x, y - e);
  const n = Math.hypot(gx, gy);
  return n > 1e-6 ? [-gx / n, -gy / n] : [0, 0];
}

/**
 * Sur un tablier de pont ou un quai (au-dessus du relief nu) : leurs extrémités ne rejoignent pas toujours la chaussée dans les données (D93),
 * on y redescend sans tomber.
 */
export function onDeck(terrain: HeightField, x: number, y: number, z: number): boolean {
  return terrain.ground !== undefined && z - terrain.ground.heightAt(x, y) > 0.3;
}
