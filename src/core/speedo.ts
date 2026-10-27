/** Compteur de vitesse : conversion et fraction de l'arc (partie pure, l'affichage est dans `src/ui/speedo.ts`). */

/** Vitesse affichée en km/h, arrondie ; la marche arrière compte comme une vitesse. */
export function kmh(speed: number): number {
  return Math.round(Math.abs(speed) * 3.6);
}

/** Part de l'arc remplie (0 à 1) : vitesse rapportée à la vitesse maximale du véhicule. */
export function gaugeFraction(speed: number, topSpeed: number): number {
  if (!(topSpeed > 0)) return 0;
  return Math.min(Math.max(Math.abs(speed) / topSpeed, 0), 1);
}

/** Au-delà de cette part, l'arc passe au rouge. */
export const GAUGE_REDLINE = 0.85;
