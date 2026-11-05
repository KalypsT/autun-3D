import type { HeightField } from "../data/types";

/**
 * La mer qui entoure le monde (D105) : on avance dans l'eau jusqu'à une certaine profondeur, jamais plus loin. Comme le rivage descend en
 * pente douce dans la plaine et tombe en falaise sur les hauteurs, la profondeur suffit à dire où s'arrêter : pas de mur à dessiner.
 * L'eau de la ville (D240) suit la même règle : son fond est creusé sous un niveau propre à chaque plan d'eau (`HeightField.waterAt`).
 */

/** Profondeur (m) au-delà de laquelle on ne peut plus avancer : à pied (l'eau à la taille), en voiture, sur un deux-roues. */
export const WADE_DEPTH = 1.0;
export const CAR_DEPTH = 0.5;
export const BIKE_DEPTH = 0.35;

/** Il y a de l'eau dans ce monde : la mer, ou l'eau de la ville. */
export const hasWater = (terrain: HeightField): boolean => terrain.seaLevel !== undefined || terrain.waterAt !== undefined;

/**
 * Profondeur d'eau en (x, y) : mer ou eau de la ville, mesurée sous la surface où l'on se tient. Sur un pont, cette surface est le tablier,
 * et la profondeur est nulle ; `zHint` (l'altitude de qui demande) départage le tablier et le fond qui passe dessous. 0 à terre ou sans eau.
 */
export function waterDepth(terrain: HeightField, x: number, y: number, zHint?: number): number {
  const sea = terrain.seaLevel;
  const city = terrain.waterAt?.(x, y);
  if (sea === undefined && city === undefined) return 0;
  const floor = zHint === undefined ? (terrain.ground ?? terrain).heightAt(x, y) : terrain.heightAt(x, y, zHint);
  return Math.max(0, (sea ?? -Infinity) - floor, (city ?? -Infinity) - floor);
}

/** Surface du sol sous qui demande (`zHint` : départage tablier et fond), sinon relief nu. */
const floorAt = (terrain: HeightField, x: number, y: number, zHint?: number): number =>
  zHint === undefined ? (terrain.ground ?? terrain).heightAt(x, y) : terrain.heightAt(x, y, zHint);

/** Profondeur de la mer seule (D105) en (x, y). */
export function seaDepth(terrain: HeightField, x: number, y: number, zHint?: number): number {
  return terrain.seaLevel === undefined ? 0 : Math.max(0, terrain.seaLevel - floorAt(terrain, x, y, zHint));
}

/** Profondeur de l'eau de la ville seule (D240) en (x, y) : on y nage (D241). */
export function cityDepth(terrain: HeightField, x: number, y: number, zHint?: number): number {
  const w = terrain.waterAt?.(x, y);
  return w === undefined ? 0 : Math.max(0, w - floorAt(terrain, x, y, zHint));
}

/**
 * Point le plus avancé vers (x, y), depuis (px, py), où la profondeur reste sous `max` : glisse le long du rivage. `depth` : la profondeur
 * qui compte (par défaut la mer et l'eau de la ville ; à pied, seulement la mer : dans l'eau de la ville, on nage).
 */
export function holdShore(terrain: HeightField, px: number, py: number, x: number, y: number, max: number, zHint?: number, depth = waterDepth): { x: number; y: number; blocked: boolean } {
  if (!hasWater(terrain) || depth(terrain, x, y, zHint) <= max) return { x, y, blocked: false };
  if (depth(terrain, x, py, zHint) <= max) return { x, y: py, blocked: true };
  if (depth(terrain, px, y, zHint) <= max) return { x: px, y, blocked: true };
  return { x: px, y: py, blocked: true };
}

/** Normale du rivage (vers la terre, unitaire) en (x, y), d'après la pente de la profondeur ; nulle sur le plat. */
export function shoreNormal(terrain: HeightField, x: number, y: number, zHint?: number): [number, number] {
  const e = 1.5;
  const gx = waterDepth(terrain, x + e, y, zHint) - waterDepth(terrain, x - e, y, zHint);
  const gy = waterDepth(terrain, x, y + e, zHint) - waterDepth(terrain, x, y - e, zHint);
  const n = Math.hypot(gx, gy);
  return n > 1e-6 ? [-gx / n, -gy / n] : [0, 0];
}

/**
 * Sur un tablier de pont ou un quai (au-dessus du relief nu) : leurs extrémités ne rejoignent pas toujours la chaussée dans les données (D93),
 * on y redescend sans tomber.
 */
export function onDeck(terrain: HeightField, x: number, y: number, z: number): boolean {
  if (terrain.ground === undefined) return false;
  const g = terrain.ground.heightAt(x, y);
  // Un toit (D214) n'est pas un tablier : on tombe de son bord au lieu de rejoindre la rue d'un coup.
  return z - g > 0.3 && (terrain.roofless === undefined || terrain.roofless.heightAt(x, y, z) - g > 0.3);
}
