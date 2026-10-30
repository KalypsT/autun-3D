/**
 * Explosion d'un véhicule (D111) : logique pure. Le souffle blesse et pousse ce qui est autour, d'autant moins qu'on est loin ;
 * le véhicule devient une épave qui brûle, puis fume, puis peut disparaître quand personne ne la regarde.
 * Analogie : un caillou dans l'eau, des ronds qui s'affaiblissent en s'éloignant.
 */
export const EXPLOSION = {
  /** Portée du souffle (m) ; en deçà de `full`, il frappe de toute sa force. */
  radius: 8,
  full: 2.5,
  /** Dégâts à pleine force : un passant (100 points de vie) ou le joueur à pied meurt à moins de `full` ; un véhicule voisin en prend 70. */
  ped: 160,
  player: 150,
  vehicle: 70,
  /** Le joueur dans un autre véhicule est protégé de moitié par la carrosserie. */
  sheltered: 0.5,
  /** Impulsion (m/s) qui projette les passants touchés. */
  impulse: 9,
  /** L'épave brûle (s), puis fume jusqu'à `smoke` (s) ; elle peut disparaître après `vanish` (s), hors de vue, à plus de `vanishDistance` (m). */
  fire: 9,
  smoke: 45,
  vanish: 180,
  vanishDistance: 120,
} as const;

/** Part de la force du souffle à une distance donnée (m) : 1 jusqu'à `full`, puis décroît jusqu'à 0 à `radius`. */
export function blastShare(distance: number): number {
  if (!(distance < EXPLOSION.radius)) return 0;
  if (distance <= EXPLOSION.full) return 1;
  const t = (distance - EXPLOSION.full) / (EXPLOSION.radius - EXPLOSION.full);
  return (1 - t) * (1 - t);
}

/** Ce que devient une épave à un instant donné depuis l'explosion : elle brûle, puis fume, puis elle est froide. */
export function wreckStage(sinceEnd: number): "fire" | "smoke" | "cold" {
  return sinceEnd < EXPLOSION.fire ? "fire" : sinceEnd < EXPLOSION.smoke ? "smoke" : "cold";
}
