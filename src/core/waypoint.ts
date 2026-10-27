/** Repère posé par le joueur sur la carte : un point du monde, rien de plus (pas de guidage par les routes). */

export interface Waypoint {
  x: number;
  y: number;
}

/**
 * Appui long sur la carte en (x, y) : si un repère existe à moins de `reach` mètres, on le retire ; sinon on pose le repère ici.
 * `reach` suit le zoom (taille d'un doigt en mètres), pour qu'un appui long sur le repère le retire toujours.
 */
export function toggleWaypoint(current: Waypoint | null, x: number, y: number, reach: number): Waypoint | null {
  if (current && Math.hypot(current.x - x, current.y - y) <= reach) return null;
  return { x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10 };
}

/** Repère vu depuis le joueur : distance et cap (rad, 0 = nord), plus l'écart par rapport à la direction regardée. */
export function waypointFrom(px: number, py: number, wp: Waypoint, heading: number): { distance: number; bearing: number; relative: number } {
  const dx = wp.x - px, dy = wp.y - py;
  const bearing = Math.atan2(dx, dy);
  const relative = ((((bearing - heading) % (2 * Math.PI)) + 3 * Math.PI) % (2 * Math.PI)) - Math.PI;
  return { distance: Math.hypot(dx, dy), bearing, relative };
}

/**
 * Minimap ronde de rayon `r` centrée en (0, 0) : point à afficher pour un objet situé en (sx, sy) par rapport au centre (pixels).
 * Dans le disque (moins une marge), il reste en place ; au-delà, il est ramené sur le bord (flèche orientée vers lui).
 */
export function clampToDisc(sx: number, sy: number, r: number): { x: number; y: number; outside: boolean; angle: number } {
  const d = Math.hypot(sx, sy);
  const angle = Math.atan2(sx, -sy);
  if (d <= r) return { x: sx, y: sy, outside: false, angle };
  return { x: (sx / d) * r, y: (sy / d) * r, outside: true, angle };
}
