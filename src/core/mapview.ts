/**
 * Carte : passage du monde (mètres, x est, y nord) à l'écran (pixels, y vers le bas) et retour.
 * Une vue est un point du monde au centre de l'écran, une échelle (pixels par mètre) et un cap : le haut de l'écran
 * montre la direction (sin cap, cos cap) du monde, comme le yaw de la caméra (cap 0 : nord en haut).
 */

export interface MapView {
  /** Point du monde au centre de l'écran. */
  cx: number;
  cy: number;
  /** Pixels (CSS) par mètre. */
  scale: number;
  /** Direction du monde affichée vers le haut de l'écran (rad). */
  heading: number;
  /** Taille de la zone d'affichage (px CSS). */
  w: number;
  h: number;
}

/** Un kilomètre de fond de carte : coin nord-ouest (x0, y1) ; `files` donne le fichier de chaque niveau (clé : mètres par pixel). */
export interface MapImageInfo {
  id: string;
  x0: number;
  y1: number;
  files: Record<string, string>;
}

export interface MapIndex {
  version: number;
  /** Côté (m) d'une image par kilomètre. */
  size: number;
  /** Mètres par pixel des niveaux disponibles pour chaque kilomètre (du plus fin au plus grossier). */
  levels: number[];
  /** Emprise des tuiles qui existent : x0, y0, x1, y1. */
  zone: [number, number, number, number];
  images: MapImageInfo[];
  /** Toute la zone en une image, pour les vues très éloignées. */
  overview: { file: string; x0: number; y1: number; res: number; w: number; h: number };
}

export function worldToScreen(v: MapView, x: number, y: number): [number, number] {
  const dx = x - v.cx, dy = y - v.cy;
  const s = Math.sin(v.heading), c = Math.cos(v.heading);
  const right = dx * c - dy * s, forward = dx * s + dy * c;
  return [v.w / 2 + right * v.scale, v.h / 2 - forward * v.scale];
}

export function screenToWorld(v: MapView, sx: number, sy: number): [number, number] {
  const right = (sx - v.w / 2) / v.scale, forward = (v.h / 2 - sy) / v.scale;
  const s = Math.sin(v.heading), c = Math.cos(v.heading);
  return [v.cx + right * c + forward * s, v.cy - right * s + forward * c];
}

/** Matrice 2D (a, b, c, d, e, f de `ctx.setTransform`) qui envoie les coordonnées du monde sur l'écran. */
export function worldMatrix(v: MapView): [number, number, number, number, number, number] {
  const s = Math.sin(v.heading), c = Math.cos(v.heading);
  const a = v.scale * c, b = -v.scale * s, cc = -v.scale * s, d = -v.scale * c;
  const e = v.w / 2 - (a * v.cx + cc * v.cy), f = v.h / 2 - (b * v.cx + d * v.cy);
  return [a, b, cc, d, e, f];
}

/** Matrice qui envoie les pixels d'une image de fond (coin nord-ouest en (x0, y1), `res` m par pixel) sur l'écran. */
export function imageMatrix(v: MapView, x0: number, y1: number, res: number): [number, number, number, number, number, number] {
  const [a, b, c, d, e, f] = worldMatrix(v);
  // pixel (u, v) -> monde (x0 + u·res, y1 − v·res)
  return [a * res, b * res, -c * res, -d * res, a * x0 + c * y1 + e, b * x0 + d * y1 + f];
}

/** Rectangle du monde (x0, y0, x1, y1) qui contient tout ce que la vue affiche (le cap peut être quelconque). */
export function viewBounds(v: MapView): [number, number, number, number] {
  const r = Math.hypot(v.w, v.h) / 2 / v.scale;
  return [v.cx - r, v.cy - r, v.cx + r, v.cy + r];
}

/** Images de fond (carrés de `size` mètres de côté) qui touchent la vue. */
export function imagesInView<T extends { x0: number; y1: number }>(images: readonly T[], size: number, v: MapView): T[] {
  const [bx0, by0, bx1, by1] = viewBounds(v);
  return images.filter((im) => im.x0 < bx1 && im.x0 + size > bx0 && im.y1 - size < by1 && im.y1 > by0);
}

/**
 * Niveau de détail à dessiner : le plus grossier dont un pixel d'image ne couvre pas plus de `maxPx` pixels de l'écran
 * (au-delà, l'image paraîtrait en gros carrés). `levels` va du plus fin au plus grossier, `dpr` est la densité de pixels du canvas.
 */
export function pickLevel(levels: readonly number[], scale: number, dpr: number, maxPx = 2): number {
  let best = levels[0]!;
  for (const res of levels) if (res * scale * dpr <= maxPx) best = res;
  return best;
}

export const MIN_SCALE = 0.05;
export const MAX_SCALE = 3;

/** Zoom de `factor` autour d'un point de l'écran : le point du monde sous le doigt ne bouge pas. */
export function zoomAt(v: MapView, sx: number, sy: number, factor: number, min = MIN_SCALE, max = MAX_SCALE): MapView {
  const scale = Math.min(Math.max(v.scale * factor, min), max);
  const [wx, wy] = screenToWorld(v, sx, sy);
  const next = { ...v, scale };
  // Le point est maintenant en (px, py) : on déplace le centre pour qu'il retombe en (sx, sy).
  const [px, py] = worldToScreen(next, wx, wy);
  const [cx, cy] = screenToWorld(next, v.w / 2 + (px - sx), v.h / 2 + (py - sy));
  return { ...next, cx, cy };
}

/** Déplacement au doigt de (dx, dy) pixels : le monde suit le doigt. */
export function panBy(v: MapView, dx: number, dy: number): MapView {
  const [cx, cy] = screenToWorld(v, v.w / 2 - dx, v.h / 2 - dy);
  return { ...v, cx, cy };
}

/** Le centre de la vue reste dans l'emprise (agrandie de `margin` m) : on ne se perd pas hors de la carte. */
export function clampToZone(v: MapView, zone: readonly [number, number, number, number], margin = 100): MapView {
  return { ...v, cx: Math.min(Math.max(v.cx, zone[0] - margin), zone[2] + margin), cy: Math.min(Math.max(v.cy, zone[1] - margin), zone[3] + margin) };
}

/** Échelle (px/m) qui fait tenir toute l'emprise dans la zone d'affichage. */
export function fitScale(zone: readonly [number, number, number, number], w: number, h: number): number {
  return Math.min(w / (zone[2] - zone[0]), h / (zone[3] - zone[1]));
}

/** Cap (rad, 0 = nord, sens horaire) de (x0, y0) vers (x1, y1). */
export function bearing(x0: number, y0: number, x1: number, y1: number): number {
  return Math.atan2(x1 - x0, y1 - y0);
}

/** Distance lisible : « 85 m », « 1,2 km ». */
export function formatDistance(m: number): string {
  if (m < 1000) return `${Math.round(m / 5) * 5 || Math.round(m)} m`;
  return `${(m / 1000).toFixed(1).replace(".", ",")} km`;
}

const COMPASS = ["N", "NE", "E", "SE", "S", "SO", "O", "NO"];
/** Point cardinal (N, NE, E…) d'un cap en radians. */
export function compassName(heading: number): string {
  const turn = (((heading / (2 * Math.PI)) % 1) + 1) % 1;
  return COMPASS[Math.round(turn * 8) % 8]!;
}
