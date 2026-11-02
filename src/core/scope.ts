/**
 * Lunette du fusil de précision (T3, D207). Logique pure.
 *
 * Analogie : regarder dans des jumelles en respirant. Le réticule dessine lentement un petit huit (le souffle) ; il tremble trois fois plus
 * juste après un tir. On ne marche pas en visant : le joystick gauche fait balayer lentement la lunette.
 */

/** Amplitude du balancement (rad) au repos : ≈ 30 cm à 150 m. */
export const SWAY = 0.002;
/** Le balancement est multiplié par (1 + SWAY_SHOT) juste après un tir, et revient en `SWAY_SETTLE` s. */
export const SWAY_SHOT = 2;
export const SWAY_SETTLE = 1.2;
/** Recul du tir dans la lunette : le regard monte de `KICK` rad. */
export const KICK = 0.035;
/** Vitesse de balayage au joystick (rad/s, joystick à fond), avant le grossissement : divisée par lui. */
export const PAN = 0.6;

/** Décalage du regard (rad) à l'instant `t` (s), `sinceShot` s après le dernier tir : un huit lent (0,23 et 0,46 Hz). */
export function scopeSway(t: number, sinceShot: number, out: { yaw: number; pitch: number }): { yaw: number; pitch: number } {
  const a = SWAY * (1 + SWAY_SHOT * Math.max(0, 1 - sinceShot / SWAY_SETTLE));
  out.yaw = a * Math.sin(t * 1.45);
  out.pitch = a * 0.6 * Math.sin(t * 2.9 + 0.7);
  return out;
}

/** Rotation de balayage (rad) au joystick pendant `dt` s : `right` et `forward` de −1 à 1, grossissement `zoom`. Pousser vers le haut lève le regard. */
export function scopePan(right: number, forward: number, zoom: number, dt: number, out: { yaw: number; pitch: number }): { yaw: number; pitch: number } {
  const k = (PAN / Math.max(zoom, 1)) * dt;
  out.yaw = right * k;
  out.pitch = -forward * k;
  return out;
}
