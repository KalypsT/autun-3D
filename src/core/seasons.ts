/**
 * Ce que la saison change au décor (plan « ville vivante », § 4) : logique pure, sans rendu. Chaque valeur va de 0 à 1 et ne dépend
 * que de la saison et de l'avancement dans la saison (`t`), arrondi à l'heure de jeu : le décor change au plus une fois par heure de jeu.
 *
 * Calendrier des arbres : bourgeons au début du printemps (encore nus), vert tendre au printemps, vert franc l'été, couleurs d'automne
 * dès le début de l'automne, chute des feuilles dans sa seconde moitié, nus l'hiver. L'herbe jaunit à la fin de l'été et reste terne
 * l'hiver ; les feuilles mortes jonchent le sol de la mi-automne au début de l'hiver.
 */

import type { Season } from "./calendar";

export interface SeasonLook {
  /** Vert tendre des jeunes feuilles (printemps). */
  fresh: number;
  /** Feuillage qui prend ses couleurs d'automne. */
  turn: number;
  /** Arbres nus (feuilles tombées). */
  bare: number;
  /** Herbe jaunie (fin de l'été, début de l'automne). */
  dry: number;
  /** Herbe terne (hiver). */
  dull: number;
  /** Feuilles mortes au sol. */
  litter: number;
}

const smooth = (a: number, b: number, x: number): number => {
  const t = Math.min(Math.max((x - a) / (b - a), 0), 1);
  return t * t * (3 - 2 * t);
};

/** Le décor de la saison `season` à l'avancement `t` (0 à 1). */
export function seasonLook(season: Season, t: number): SeasonLook {
  switch (season) {
    case 0:
      return { fresh: smooth(0.05, 0.3, t) * (1 - smooth(0.45, 1, t)), turn: 0, bare: 1 - smooth(0, 0.3, t), dry: 0, dull: 0.6 * (1 - smooth(0, 0.35, t)), litter: 0 };
    case 1:
      return { fresh: 0, turn: 0, bare: 0, dry: 0.7 * smooth(0.45, 1, t), dull: 0, litter: 0 };
    case 2:
      return { fresh: 0, turn: smooth(0, 0.55, t), bare: smooth(0.5, 1, t), dry: 0.7 * (1 - smooth(0, 0.6, t)), dull: 0.5 * smooth(0.5, 1, t), litter: smooth(0.3, 0.75, t) };
    default:
      // La fin de l'hiver rejoint le début du printemps : plus de brun d'automne sous les bourgeons, herbe un peu moins terne.
      return { fresh: 0, turn: 1 - smooth(0.75, 1, t), bare: 1, dry: 0, dull: 0.5 + 0.5 * smooth(0, 0.2, t) - 0.4 * smooth(0.7, 1, t), litter: 1 - smooth(0, 0.4, t) };
  }
}

/** Avancement arrondi à l'heure de jeu (pour qu'un changement de décor ne se fasse qu'une fois par heure). */
export function hourlyT(dayInSeason: number, hour: number, length: number): number {
  return Math.min((dayInSeason + Math.floor(hour) / 24) / length, 0.999999);
}
