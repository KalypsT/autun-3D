/**
 * Lumières de la ville (plan « ville vivante », § 6, D200) : logique pure. Part des fenêtres allumées selon l'heure : elles s'allument
 * de la tombée de la nuit à 21 h, s'éteignent peu à peu de 22 h à 1 h, quelques-unes restent allumées toute la nuit, d'autres se
 * rallument vers 6 h 30 (on se lève). Chaque fenêtre a son seuil (0 à 1) : elle est allumée si la part du moment le dépasse.
 */

const smooth = (a: number, b: number, x: number): number => {
  const t = Math.min(Math.max((x - a) / (b - a), 0), 1);
  return t * t * (3 - 2 * t);
};

/** Part des fenêtres « habitées » allumées à cette heure (0 à 1), si la nuit est tombée (sinon le jeu ne les montre pas). */
export function litWindowShare(hour: number): number {
  const h = ((hour % 24) + 24) % 24;
  if (h >= 12) {
    // Soir : de 25 % à la tombée de la nuit (17 h l'hiver) à 90 % à 21 h, puis l'extinction jusqu'à minuit.
    const evening = 0.25 + 0.65 * smooth(17, 21, h);
    return h < 22 ? evening : evening - (0.9 - 0.4) * smooth(22, 24, h);
  }
  // Après minuit : de 40 % à 12 % à 1 h, puis le réveil de 6 h à 7 h 30 (jusqu'à 40 %), avant que le jour ne les éteigne.
  const night = 0.4 - 0.28 * smooth(0, 1, h);
  // (De 9 h à midi, sans effet à l'écran puisqu'il fait jour, on rejoint la valeur du soir pour éviter un saut.)
  return night + 0.28 * smooth(5.8, 7, h) - 0.15 * smooth(9, 12, h);
}

/** Allumage des lampadaires : chacun à son seuil, à mesure que la nuit tombe (`night` 0 à 1) ; tous allumés aux deux tiers de la tombée. */
export function lampLevel(night: number): number {
  return Math.min(1, Math.max(0, night * 1.5));
}
