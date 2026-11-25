/**
 * Grenades (plaisir de jeu, phase 3, lot 7-3, D326) : logique pure. On tient le bouton d'attaque, l'arc s'affiche ; on relâche, la grenade
 * part dans la direction du regard ; elle rebondit, roule, et explose au bout de `GRENADE.fuse` secondes (le souffle des véhicules qui
 * explosent, D111).
 *
 * Analogie : la balle qu'on lance en cloche par-dessus un mur ; la courbe affichée est celle qu'elle suivra jusqu'au premier rebond.
 */

export const GRENADE = {
  /** Vitesse au lancer (m/s) : environ 20 m de portée à 35°. */
  speed: 14,
  /** Mèche (s) depuis le lancer. */
  fuse: 3,
  gravity: 9.8,
  /** Rebond : part de la vitesse verticale gardée, et de la vitesse horizontale gardée à chaque contact. */
  bounce: 0.35,
  friction: 0.6,
  /** Grenades portées au plus. */
  max: 10,
  /** Hauteur du lancer au-dessus des pieds (m). */
  hand: 1.6,
} as const;

export interface GrenadeBody {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  /** Secondes depuis le lancer. */
  t: number;
}

/**
 * Vitesse au lancer pour un regard de cap `yaw` (rad, 0 = nord) et d'inclinaison `pitch` (rad, positif : la caméra regarde plus bas,
 * convention du jeu) : on lance plus haut quand on regarde plus haut ; entre 3° et 66° au-dessus de l'horizontale.
 */
export function throwVelocity(yaw: number, pitch: number, speed: number = GRENADE.speed): { vx: number; vy: number; vz: number } {
  const elev = Math.min(Math.max(0.62 - pitch * 1.1, 0.05), 1.15);
  const h = Math.cos(elev) * speed;
  return { vx: Math.sin(yaw) * h, vy: Math.cos(yaw) * h, vz: Math.sin(elev) * speed };
}

/** Le monde que voit la grenade : l'altitude du sol (relief, ponts, toits) sous un point, et le premier mur sur un segment (fraction, ou null). */
export interface GrenadeWorld {
  ground(x: number, y: number, z: number): number;
  wall(x0: number, y0: number, x1: number, y1: number): number | null;
}

/** Avance la grenade de `dt` : chute, mur (elle repart en arrière, amortie), sol (rebond, frottement). Renvoie vrai si elle a touché quelque chose. */
export function stepGrenade(g: GrenadeBody, dt: number, world: GrenadeWorld): boolean {
  g.t += dt;
  g.vz -= GRENADE.gravity * dt;
  let nx = g.x + g.vx * dt, ny = g.y + g.vy * dt, contact = false;
  const hit = world.wall(g.x, g.y, nx, ny);
  if (hit !== null) {
    // Contre un mur : elle s'arrête au mur et repart en arrière, amortie (le côté du mur n'est pas connu : on renverse simplement).
    nx = g.x + (nx - g.x) * Math.max(0, hit - 0.05);
    ny = g.y + (ny - g.y) * Math.max(0, hit - 0.05);
    g.vx *= -GRENADE.bounce;
    g.vy *= -GRENADE.bounce;
    contact = true;
  }
  g.x = nx;
  g.y = ny;
  g.z += g.vz * dt;
  const floor = world.ground(g.x, g.y, g.z);
  if (g.z <= floor) {
    g.z = floor;
    if (g.vz < 0) {
      g.vz = Math.abs(g.vz) < 1 ? 0 : -g.vz * GRENADE.bounce;
      g.vx *= GRENADE.friction;
      g.vy *= GRENADE.friction;
      contact = true;
    }
  }
  return contact;
}

/** Points (x, y, z) de la trajectoire jusqu'au premier contact, tous les `dt`, pour dessiner l'arc ; `out` est vidé puis rempli. */
export function arcPoints(x: number, y: number, z: number, v: { vx: number; vy: number; vz: number }, world: GrenadeWorld, out: number[], dt = 0.06, maxSteps = 60): number[] {
  out.length = 0;
  const g: GrenadeBody = { x, y, z, vx: v.vx, vy: v.vy, vz: v.vz, t: 0 };
  for (let i = 0; i < maxSteps; i++) {
    const hit = stepGrenade(g, dt, world);
    out.push(g.x, g.y, g.z);
    if (hit) break;
  }
  return out;
}
