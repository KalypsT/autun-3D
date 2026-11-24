/**
 * Étalonnage des couleurs selon l'heure (D314) : logique pure, appliquée par la passe finale des effets d'image (`render/post.ts`).
 *
 * Après le rendu des couleurs (« Neutral »), l'image passe par :
 * - un gain par composante (balance des blancs : chaud au couchant, bleuté la nuit) ;
 * - une saturation autour de la luminance ;
 * - un contraste en courbe en S qui garde le noir et le blanc (jamais d'écrêtage) ;
 * - une teinte ajoutée aux ombres et une autre aux lumières (« split toning » : ombres violettes ou bleues, lumières chaudes).
 *
 * Matin et soir ne sont pas pareils : matin doux (contraste bas, ombres claires et fraîches), midi franc (contraste et saturation un peu
 * relevés), coucher chaud (gain orangé, ombres violettes), nuit bleutée (ombres bleues, lumières de la ville qui restent chaudes).
 */

export interface Grade {
  /** Gain par composante (balance des blancs). */
  gain: [number, number, number];
  /** Saturation (1 : inchangée). */
  saturation: number;
  /** Contraste (1 : inchangé ; plus haut : courbe en S ; plus bas : vers le gris moyen). */
  contrast: number;
  /** Teinte ajoutée aux ombres (pondérée par (1 − l)²). */
  shadows: [number, number, number];
  /** Teinte ajoutée aux lumières (pondérée par l²). */
  highlights: [number, number, number];
}

export const NEUTRAL_GRADE: Grade = { gain: [1, 1, 1], saturation: 1, contrast: 1, shadows: [0, 0, 0], highlights: [0, 0, 0] };

const g = (gain: [number, number, number], saturation: number, contrast: number, shadows: [number, number, number], highlights: [number, number, number]): Grade => ({
  gain, saturation, contrast, shadows, highlights,
});

const NIGHT = g([1, 1, 1.03], 1.04, 1.06, [-0.005, -0.001, 0.012], [0.045, 0.018, -0.012]);
const NOON = g([1, 1, 1], 1.07, 1.1, [0, 0, 0], [0, 0, 0]);

/** Jalons du soir (hauteur du soleil en degrés → étalonnage), du plein jour à la nuit. */
const EVENING: [number, Grade][] = [
  [-10, NIGHT],
  [-3, g([1.02, 0.95, 1.04], 1.04, 1.02, [0.008, -0.004, 0.03], [0.035, 0.012, -0.008])],
  [3, g([1.09, 0.98, 0.86], 1.14, 1.06, [0.014, -0.004, 0.03], [0.03, 0.01, -0.012])],
  [15, g([1.04, 1, 0.94], 1.08, 1.06, [0.006, 0, 0.012], [0.012, 0.005, -0.006])],
  [30, NOON],
];

/** Jalons du matin : plus doux, plus frais, ombres plus claires. */
const MORNING: [number, Grade][] = [
  [-10, NIGHT],
  [-3, g([0.99, 0.96, 1.05], 0.96, 0.97, [0.012, 0.006, 0.03], [0.03, 0.016, 0.01])],
  [3, g([1.04, 0.99, 0.95], 0.96, 0.93, [0.018, 0.012, 0.028], [0.022, 0.012, 0.004])],
  [15, g([1.01, 1, 0.99], 0.97, 0.94, [0.012, 0.012, 0.02], [0.006, 0.004, 0])],
  [30, NOON],
];

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const lerp3 = (a: readonly number[], b: readonly number[], t: number): [number, number, number] => [lerp(a[0]!, b[0]!, t), lerp(a[1]!, b[1]!, t), lerp(a[2]!, b[2]!, t)];

/** Mélange de deux étalonnages (t = 0 : a, t = 1 : b). */
export function mixGrade(a: Grade, b: Grade, t: number): Grade {
  return {
    gain: lerp3(a.gain, b.gain, t), saturation: lerp(a.saturation, b.saturation, t), contrast: lerp(a.contrast, b.contrast, t),
    shadows: lerp3(a.shadows, b.shadows, t), highlights: lerp3(a.highlights, b.highlights, t),
  };
}

function along(stops: [number, Grade][], elev: number): Grade {
  if (elev <= stops[0]![0]) return stops[0]![1];
  for (let i = 1; i < stops.length; i++) {
    const [e1, g1] = stops[i]!;
    if (elev <= e1) {
      const [e0, g0] = stops[i - 1]!;
      return mixGrade(g0, g1, (elev - e0) / (e1 - e0));
    }
  }
  return stops[stops.length - 1]![1];
}

/**
 * Étalonnage pour une hauteur de soleil (degrés), le matin ou le soir (`morning` : avant midi solaire), sous une couverture nuageuse
 * `cloud` (0 à 1) : par temps couvert, on revient vers le neutre (la météo grise déjà le ciel et la lumière, D196).
 */
export function gradeAt(elevDeg: number, morning: boolean, cloud = 0): Grade {
  const base = along(morning ? MORNING : EVENING, elevDeg);
  const k = 0.65 * Math.min(Math.max((cloud - 0.2) / 0.7, 0), 1);
  return k > 0 ? mixGrade(base, NEUTRAL_GRADE, k) : base;
}

/** Applique l'étalonnage à une couleur linéaire déjà ramenée entre 0 et 1 (même calcul que le nuanceur ; sert aux tests). */
export function applyGrade(grade: Grade, rgb: readonly [number, number, number]): [number, number, number] {
  let [r, gr, b] = [rgb[0] * grade.gain[0], rgb[1] * grade.gain[1], rgb[2] * grade.gain[2]];
  const l0 = 0.2126 * r + 0.7152 * gr + 0.0722 * b;
  [r, gr, b] = [l0 + (r - l0) * grade.saturation, l0 + (gr - l0) * grade.saturation, l0 + (b - l0) * grade.saturation];
  const curve = (c: number): number => {
    const p = Math.sqrt(Math.min(Math.max(c, 0), 1));
    const q = grade.contrast >= 1 ? lerp(p, p * p * (3 - 2 * p), grade.contrast - 1) : 0.5 + (p - 0.5) * grade.contrast;
    return q * q;
  };
  [r, gr, b] = [curve(r), curve(gr), curve(b)];
  const p = Math.sqrt(Math.min(Math.max(0.2126 * r + 0.7152 * gr + 0.0722 * b, 0), 1));
  const ws = (1 - p) * (1 - p), wh = p * p;
  const out = (c: number, i: 0 | 1 | 2): number => Math.min(Math.max(c + grade.shadows[i] * ws + grade.highlights[i] * wh, 0), 1);
  return [out(r, 0), out(gr, 1), out(b, 2)];
}

/** GLSL de `applyGrade` (même calcul) ; uniformes : uGain, uSat, uContrast, uShadows, uHighlights. */
export const GRADE_GLSL = /* glsl */ `
uniform vec3 uGain; uniform float uSat; uniform float uContrast; uniform vec3 uShadows; uniform vec3 uHighlights;
vec3 gradeColor(vec3 c) {
  c *= uGain;
  float l0 = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = vec3(l0) + (c - vec3(l0)) * uSat;
  vec3 p = sqrt(clamp(c, 0.0, 1.0));
  vec3 q = uContrast >= 1.0 ? mix(p, p * p * (3.0 - 2.0 * p), uContrast - 1.0) : vec3(0.5) + (p - vec3(0.5)) * uContrast;
  c = q * q;
  float pl = sqrt(clamp(dot(c, vec3(0.2126, 0.7152, 0.0722)), 0.0, 1.0));
  return clamp(c + uShadows * (1.0 - pl) * (1.0 - pl) + uHighlights * pl * pl, 0.0, 1.0);
}`;
