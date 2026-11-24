/**
 * Vagues de la mer (D316) : logique pure, même calcul que le nuanceur de la mer (`WAVES_GLSL`), pour que ce qui flotte plus tard (jet-ski,
 * phase 5) suive exactement les vagues qu'on voit.
 *
 * Trois houles qui se croisent, chacune une sinusoïde qui avance dans sa direction. Les périodes sont des fractions entières d'une minute
 * (60/16, 60/21, 60/28 s) : la mer revient exactement à l'identique toutes les 60 s, ce qui permet de replier le temps sans saut (la
 * précision des flottants du nuanceur reste bonne sur une longue partie). Longueur d'onde de l'eau profonde : L = g T² / 2π. Directions
 * fixes (le vent dominant d'ouest, D315) : faire tourner les houles avec le vent ferait glisser les crêtes au loin (phase × distance).
 * Seule leur hauteur suit le vent.
 */

const G = 9.81;
/** Durée après laquelle la mer se répète (s). */
export const WAVE_LOOP = 60;

interface Swell {
  /** Part de la hauteur. */
  amp: number;
  /** Nombre d'oscillations par boucle de 60 s. */
  n: number;
  /** Direction de propagation (radians, repère du jeu : 0 vers l'est). */
  dir: number;
  /** Déphasage. */
  phase: number;
}

const SWELLS: readonly Swell[] = [
  { amp: 0.55, n: 16, dir: 0.3, phase: 0 },
  { amp: 0.3, n: 21, dir: 0.85, phase: 1.7 },
  { amp: 0.15, n: 28, dir: -0.35, phase: 4.1 },
];

/** Pulsation (rad/s), nombre d'onde (rad/m) et direction de chaque houle. */
export const SWELL_TERMS = SWELLS.map((s) => {
  const w = (2 * Math.PI * s.n) / WAVE_LOOP;
  return { amp: s.amp, w, k: (w * w) / G, dx: Math.cos(s.dir), dy: Math.sin(s.dir), phase: s.phase };
});

/** Hauteur des creux aux crêtes (m) selon le vent (0 à 1) : 0,2 m par temps calme, 0,8 m sous l'orage. Amplitude = moitié. */
export function waveAmplitude(wind: number): number {
  return 0.1 + 0.3 * Math.min(Math.max(wind, 0), 1);
}

/** Hauteur de l'eau au-dessus du niveau de la mer (m) au point (x, y) du jeu, au temps `t` (s), pour une amplitude `amp`. */
export function waveHeight(x: number, y: number, t: number, amp: number): number {
  const tt = t % WAVE_LOOP;
  let h = 0;
  for (const s of SWELL_TERMS) h += s.amp * Math.sin(s.k * (s.dx * x + s.dy * y) - s.w * tt + s.phase);
  return h * amp;
}

/** Pente de l'eau (dh/dx, dh/dy). */
export function waveSlope(x: number, y: number, t: number, amp: number): [number, number] {
  const tt = t % WAVE_LOOP;
  let gx = 0, gy = 0;
  for (const s of SWELL_TERMS) {
    const c = s.amp * s.k * Math.cos(s.k * (s.dx * x + s.dy * y) - s.w * tt + s.phase);
    gx += c * s.dx;
    gy += c * s.dy;
  }
  return [gx * amp, gy * amp];
}

const f = (v: number): string => (Number.isInteger(v) ? v.toFixed(1) : String(v));

/** GLSL : `float waveHeight(vec2 p, float t)` et `vec2 waveSlope(vec2 p, float t)`, amplitude 1 (à multiplier), `t` déjà replié. */
export const WAVES_GLSL = /* glsl */ `
float waveHeight(vec2 p, float t) {
  float h = 0.0;
${SWELL_TERMS.map((s) => `  h += ${f(s.amp)} * sin(${f(s.k)} * dot(p, vec2(${f(s.dx)}, ${f(s.dy)})) - ${f(s.w)} * t + ${f(s.phase)});`).join("\n")}
  return h;
}
vec2 waveSlope(vec2 p, float t) {
  vec2 g = vec2(0.0);
${SWELL_TERMS.map((s) => `  g += ${f(s.amp * s.k)} * cos(${f(s.k)} * dot(p, vec2(${f(s.dx)}, ${f(s.dy)})) - ${f(s.w)} * t + ${f(s.phase)}) * vec2(${f(s.dx)}, ${f(s.dy)});`).join("\n")}
  return g;
}`;
