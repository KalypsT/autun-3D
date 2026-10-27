import { ZONE } from "../data/nav";

/**
 * Densité de passants selon le lieu et l'heure de jeu (D39). Le lieu est la zone du graphe piéton autour du joueur (centre, résidentiel, périphérie,
 * nature) ; la courbe horaire est propre à chaque zone : le centre vit toute la journée et reste animé le soir, les quartiers d'habitation ont leurs
 * pointes du matin et du soir, la périphérie suit la courbe de base. Une journée de jeu dure 20 minutes : les courbes sont lisibles, pas minutieuses.
 *
 * Analogie : le nombre de spectateurs dans la salle dépend du spectacle (l'heure) et du quartier du théâtre (la zone).
 */

/** Poids de chaque zone, en part de la capacité à l'heure la plus chargée. */
export const ZONE_WEIGHT: Record<number, number> = { [ZONE.centre]: 1, [ZONE.residential]: 0.35, [ZONE.outskirts]: 0.1, [ZONE.nature]: 0.1 };

type Anchors = readonly (readonly [number, number])[];

/** Courbe de base : nuit 3 %, matin 70 %, fin de matinée 85 %, midi 100 %, après-midi 90 %, fin de journée 100 %, soirée 50 %, nuit tombée 12 %. */
const BASE: Anchors = [[0, 0.03], [6, 0.03], [7, 0.7], [9, 0.7], [10, 0.85], [12, 0.85], [12.5, 1], [14, 1], [14.5, 0.9], [17, 0.9], [17.5, 1], [19, 1], [19.5, 0.5], [22, 0.5], [22.5, 0.12], [23.5, 0.12], [24, 0.03]];
/** Centre : les terrasses et les restaurants gardent du monde le soir. */
const CENTRE: Anchors = [[0, 0.04], [6, 0.04], [7, 0.6], [9, 0.7], [10, 0.9], [12, 0.9], [12.5, 1], [14, 1], [14.5, 0.95], [17, 0.95], [17.5, 1], [19, 1], [19.5, 0.7], [22, 0.65], [22.5, 0.2], [23.5, 0.2], [24, 0.04]];
/** Quartiers d'habitation : on part le matin, on rentre le soir, on est dehors peu en journée. */
const RESIDENTIAL: Anchors = [[0, 0.02], [6, 0.02], [7, 0.9], [9, 0.9], [10, 0.5], [17, 0.55], [17.5, 1], [19, 1], [19.5, 0.5], [22, 0.4], [22.5, 0.08], [23.5, 0.08], [24, 0.02]];

const CURVES: Record<number, Anchors> = { [ZONE.centre]: CENTRE, [ZONE.residential]: RESIDENTIAL, [ZONE.outskirts]: BASE, [ZONE.nature]: BASE };

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

/** Part de la capacité de passants attendue à cette heure (0 à 24) et dans cette zone (0 centre, 1 résidentiel, 2 périphérie, 3 nature). */
export function crowdDensity(hour: number, zone: number): number {
  return (ZONE_WEIGHT[zone] ?? ZONE_WEIGHT[ZONE.outskirts]!) * interpolate(CURVES[zone] ?? BASE, hour);
}

/**
 * Nombre de passants visé : capacité × densité, réduit quand on roule vite (on ne voit les gens qu'une seconde ou deux : de 6 à 12 m/s la cible
 * baisse jusqu'à la moitié).
 */
export function crowdTarget(capacity: number, hour: number, zone: number, speed: number): number {
  const fast = Math.min(Math.max((speed - 6) / 6, 0), 1);
  return Math.round(capacity * crowdDensity(hour, zone) * (1 - 0.5 * fast));
}
