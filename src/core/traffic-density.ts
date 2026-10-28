import { ZONE } from "../data/nav";

/**
 * Densité de circulation selon le lieu et l'heure de jeu (J3-4, D64), sur le modèle de `crowd-density.ts` : le lieu est la zone du graphe piéton
 * autour du joueur, la courbe horaire a deux pointes (les trajets du matin et du soir) et une nuit qui ne se vide pas tout à fait (les rues
 * principales restent traversées). Une journée de jeu dure 20 minutes : les courbes sont lisibles, pas minutieuses.
 */

/** Poids de chaque zone, en part de la capacité à l'heure la plus chargée : le centre est dense, la périphérie est traversée, la nature presque vide. */
export const TRAFFIC_ZONE_WEIGHT: Record<number, number> = { [ZONE.centre]: 1, [ZONE.residential]: 0.6, [ZONE.outskirts]: 0.45, [ZONE.nature]: 0.15 };

type Anchors = readonly (readonly [number, number])[];

/** Nuit 30 %, pointe du matin 100 % (7 h à 9 h), journée 80 à 90 %, pointe du soir 100 % (17 h à 19 h), soirée 60 %, tard 40 %. */
const CURVE: Anchors = [[0, 0.3], [5, 0.3], [6.5, 0.6], [7, 1], [9, 1], [10, 0.8], [12, 0.85], [12.5, 0.9], [14, 0.9], [15, 0.8], [16.5, 0.85], [17, 1], [19, 1], [20, 0.6], [22, 0.5], [23, 0.4], [24, 0.3]];

function interpolate(a: Anchors, hour: number): number {
  const h = ((hour % 24) + 24) % 24;
  for (let i = 1; i < a.length; i++) {
    const [h1, v1] = a[i]!;
    if (h <= h1) {
      const [h0, v0] = a[i - 1]!;
      return h1 === h0 ? v1 : v0 + ((v1 - v0) * (h - h0)) / (h1 - h0);
    }
  }
  return a[a.length - 1]![1];
}

/** Part de la capacité de voitures attendue à cette heure (0 à 24) et dans cette zone (0 centre, 1 résidentiel, 2 périphérie, 3 nature). */
export function trafficDensity(hour: number, zone: number): number {
  return (TRAFFIC_ZONE_WEIGHT[zone] ?? TRAFFIC_ZONE_WEIGHT[ZONE.outskirts]!) * interpolate(CURVE, hour);
}

/**
 * Nombre de voitures visé : capacité × densité, réduit quand on roule vite (on ne voit les voitures qu'un instant et le budget d'images
 * est plus serré : de 12 à 25 m/s la cible baisse jusqu'à la moitié), jamais zéro tant que la capacité n'est pas nulle et que la zone n'est pas la nature.
 */
export function trafficTarget(capacity: number, hour: number, zone: number, speed: number): number {
  if (capacity <= 0) return 0;
  const fast = Math.min(Math.max((speed - 12) / 13, 0), 1);
  const n = Math.round(capacity * trafficDensity(hour, zone) * (1 - 0.5 * fast));
  return zone === ZONE.nature ? n : Math.max(n, 1);
}
