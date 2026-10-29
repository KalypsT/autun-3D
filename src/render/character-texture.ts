import * as THREE from "three";
import { BOTTOMS, SHOES, TOPS, type BottomKind, type ShoeKind, type TopKind } from "../core/character";
import { LAYER_COUNT } from "../core/character-kit";

/**
 * Texture peinte des personnages (D101) : coutures, plis, poches, boutons, fermetures, lacets, visage. Tout est peint par le code,
 * au démarrage, sans image téléchargée. La texture ne porte pas les couleurs de la recette : elle les module (sombre dans un pli,
 * clair sur un genou de jean usé), sauf quelques détails peints dans leur propre couleur (blanc de l'œil, rayures d'un survêtement).
 *
 * Analogie : un patron de couturière. Chaque pièce du corps a sa place sur une grande feuille (`REGIONS`) ; la feuille existe en
 * plusieurs exemplaires (les pages), un par genre de vêtement : la page 1 dessine la chemise sur le torse, la page 3 la veste…
 * Le nuanceur choisit la page d'après la recette (`variantCode`) et le groupe de la pièce (`PartSpec.layer`).
 *
 * Codage d'un texel : rgb = facteur / 2 (le nuanceur multiplie par 2 : 0,5 laisse la couleur telle quelle, au-dessus on éclaircit) ;
 * alpha = 1 : on module la couleur de la recette ; alpha = 0 : on peint la couleur du texel telle quelle.
 */

export const TEXTURE_SIZE = 256;
type Rect = readonly [number, number, number, number];

/** Place de chaque forme sur la feuille (x, y, largeur, hauteur en texels ; y vers le haut de la texture, v = 0 en bas). */
export const REGIONS: Readonly<Record<string, Rect>> = {
  torso: [0, 0, 128, 96],
  hem: [128, 0, 64, 40],
  pelvis: [192, 0, 64, 40],
  skirt: [128, 40, 64, 40],
  sleeve: [192, 40, 64, 40],
  foreSleeve: [192, 80, 64, 32],
  thigh: [0, 96, 64, 64],
  shin: [64, 96, 64, 64],
  head: [128, 112, 128, 96],
  foot: [0, 160, 64, 40],
  boot: [64, 160, 32, 40],
  hair: [0, 200, 64, 48],
  white: [248, 248, 8, 8],
};

/** Région de chaque forme du catalogue (`character-parts.ts`) ; les formes absentes ne sont pas texturées. */
export const SHAPE_REGION: Readonly<Record<string, keyof typeof REGIONS>> = {
  torso: "torso", torsoF: "torso", hemJacket: "hem", hemCoat: "hem", pelvis: "pelvis", skirt: "skirt",
  sleeveShort: "sleeve", sleeveLong: "sleeve", foreSleeve: "foreSleeve",
  thighCloth: "thigh", thighShorts: "thigh", shinCloth: "shin",
  head: "head", foot: "foot", bootShaft: "boot",
  hairBuzz: "hair", hairShort: "hair", hairSide: "hair", hairCurly: "hair", hairBob: "hair", hairLong: "hair", hairPonytail: "hair", hairBun: "hair",
};

/** uv dans la feuille d'un point (u, v) d'une forme ; u < 0 : texel blanc (pas de texture). Une bordure d'un texel évite les débords. */
export function atlasUv(rect: Rect | null, u: number, v: number): [number, number] {
  if (!rect || u < 0) {
    const [x, y, w, h] = REGIONS.white!;
    return [(x + w / 2) / TEXTURE_SIZE, (y + h / 2) / TEXTURE_SIZE];
  }
  const [x, y, w, h] = rect;
  return [(x + 1 + u * (w - 2)) / TEXTURE_SIZE, (y + 1 + v * (h - 2)) / TEXTURE_SIZE];
}

type RGB = readonly [number, number, number];
const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));
/** Bruit de valeur déterministe dans [−1, 1]. */
const hash = (x: number, y: number, s: number): number => {
  const h = Math.sin(x * 127.1 + y * 311.7 + s * 74.7) * 43758.5453;
  return 2 * (h - Math.floor(h)) - 1;
};

/** Une région d'une page : on y peint en coordonnées de forme (u autour, v vers le haut), converties en texels. */
class Region {
  readonly w: number;
  readonly h: number;
  constructor(private readonly px: Float32Array, private readonly area: Rect) {
    this.w = area[2] - 2;
    this.h = area[3] - 2;
  }

  /** Parcourt les texels d'une boîte (en texels de la région, x enroulé autour), appelle `cov` (couverture 0 à 1) puis l'effet. */
  private each(x0: number, y0: number, x1: number, y1: number, cov: (x: number, y: number) => number, mul: RGB | null, put: RGB | null): void {
    for (let y = Math.max(0, Math.floor(y0)); y <= Math.min(this.h - 1, Math.ceil(y1)); y++) {
      for (let xx = Math.floor(x0); xx <= Math.ceil(x1); xx++) {
        const c = clamp01(cov(xx + 0.5, y + 0.5));
        if (c <= 0) continue;
        const x = ((xx % this.w) + this.w) % this.w;
        const i = ((this.area[1] + 1 + y) * TEXTURE_SIZE + this.area[0] + 1 + x) * 4;
        for (let k = 0; k < 3; k++) {
          if (mul) this.px[i + k] = this.px[i + k]! * (1 + (mul[k]! - 1) * c);
          if (put) this.px[i + k] = this.px[i + k]! + (put[k]! - this.px[i + k]!) * c;
        }
        if (put) this.px[i + 3] = this.px[i + 3]! * (1 - c);
      }
    }
  }

  /** Module tout la région par f(u, v) (facteur). */
  shade(f: (u: number, v: number) => number): void {
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        const k = f((x + 0.5) / this.w, (y + 0.5) / this.h);
        const i = ((this.area[1] + 1 + y) * TEXTURE_SIZE + this.area[0] + 1 + x) * 4;
        for (let c = 0; c < 3; c++) this.px[i + c] = this.px[i + c]! * k;
      }
    }
  }

  /** Grain du tissu : petites variations de clarté (`amp`), plus fines avec `scale` grand. */
  grain(amp: number, seed: number): void {
    this.shade((u, v) => 1 + amp * hash(Math.floor(u * this.w), Math.floor(v * this.h), seed));
  }

  /** Segment de (u0, v0) à (u1, v1), largeur en texels ; `mul` module, `put` peint. */
  line(u0: number, v0: number, u1: number, v1: number, width: number, mul: RGB | null, put: RGB | null = null): void {
    const ax = u0 * this.w, ay = v0 * this.h, bx = u1 * this.w, by = v1 * this.h;
    const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy || 1;
    const r = width / 2 + 1;
    this.each(Math.min(ax, bx) - r, Math.min(ay, by) - r, Math.max(ax, bx) + r, Math.max(ay, by) + r, (x, y) => {
      const t = clamp01(((x - ax) * dx + (y - ay) * dy) / l2);
      const d = Math.hypot(x - ax - t * dx, y - ay - t * dy);
      return width / 2 + 0.5 - d;
    }, mul, put);
  }

  /** Ellipse pleine de centre (u, v) et de demi-axes (ru, rv) en coordonnées de forme ; `soft` : bord en dégradé (part du rayon). */
  ellipse(u: number, v: number, ru: number, rv: number, mul: RGB | null, put: RGB | null = null, soft = 0): void {
    const cx = u * this.w, cy = v * this.h, rx = ru * this.w, ry = rv * this.h;
    this.each(cx - rx - 1, cy - ry - 1, cx + rx + 1, cy + ry + 1, (x, y) => {
      const d = Math.hypot((x - cx) / rx, (y - cy) / ry);
      if (soft > 0) return (1 - d) / soft;
      return (1 - d) * Math.min(rx, ry) + 0.5;
    }, mul, put);
  }

  /** Rectangle plein (u0, v0) – (u1, v1). */
  rect(u0: number, v0: number, u1: number, v1: number, mul: RGB | null, put: RGB | null = null): void {
    const x0 = u0 * this.w, y0 = v0 * this.h, x1 = u1 * this.w, y1 = v1 * this.h;
    this.each(x0 - 1, y0 - 1, x1 + 1, y1 + 1, (x, y) => Math.min(x - x0, x1 - x, y - y0, y1 - y) + 0.5, mul, put);
  }

  /** Contour de rectangle (piqûre, poche). */
  outline(u0: number, v0: number, u1: number, v1: number, width: number, mul: RGB): void {
    this.line(u0, v0, u1, v0, width, mul);
    this.line(u1, v0, u1, v1, width, mul);
    this.line(u1, v1, u0, v1, width, mul);
    this.line(u0, v1, u0, v0, width, mul);
  }
}

const k = (v: number): RGB => [v, v, v];
const SEAM = k(0.78), STITCH = k(1.25), FOLD = k(0.88), DEEP = k(0.62);
const IVORY: RGB = [0.82, 0.8, 0.74], METAL: RGB = [0.55, 0.55, 0.57], STRING: RGB = [0.86, 0.85, 0.82];

// Torse : u = 0,75 devant, 0,25 derrière, 0 et 0,5 sur les côtés (u croît du devant vers la droite du personnage) ;
// v = 0 sous la taille (y = −0,07), 1 au cou (y = 0,553). Les hauteurs ci-dessous en découlent : taille ≈ 0,37, poitrine ≈ 0,67.
const FRONT = 0.75, BACK = 0.25;

/** Plis et ombres communs à tous les hauts : coutures de côté, aisselles, sous la poitrine, ourlet, ombre portée du col. */
function torsoBase(r: Region, seed: number, hem = true): void {
  r.grain(0.035, seed);
  // Lumière peinte : un peu plus sombre vers la taille, ombre sous le col et sous le menton.
  r.shade((_u, v) => 0.9 + 0.12 * v - (v > 0.9 ? 0.25 * (v - 0.9) / 0.1 : 0));
  r.ellipse(FRONT, 0.93, 0.08, 0.08, k(0.8), null, 1);
  for (const u of [0, 0.5, 1]) {
    r.line(u, 0, u, 0.86, 1, SEAM);
    r.ellipse(u, 0.8, 0.06, 0.1, k(0.82), null, 1);
  }
  r.ellipse(FRONT, 0.56, 0.14, 0.05, k(0.93), null, 1);
  // Plis de taille sur les côtés.
  for (const s of [-1, 1]) for (const u of [0.5, 1]) {
    r.line(u + s * 0.03, 0.3, u + s * 0.08, 0.4, 1.4, FOLD);
    r.line(u + s * 0.02, 0.22, u + s * 0.07, 0.3, 1.2, FOLD);
  }
  // Coutures d'épaule.
  r.line(0.08, 0.91, 0.17, 0.97, 1, SEAM);
  r.line(0.33, 0.97, 0.42, 0.91, 1, SEAM);
  r.line(0.58, 0.91, 0.67, 0.97, 1, SEAM);
  r.line(0.83, 0.97, 0.92, 0.91, 1, SEAM);
  if (hem) r.rect(0, 0, 1, 0.05, k(0.85));
}

/** Rang de boutons (u, v de chaque bouton). */
function buttons(r: Region, u: number, vs: readonly number[], color: RGB, size = 1.6): void {
  for (const v of vs) {
    r.ellipse(u, v, size / r.w, size / r.h, k(0.55));
    r.ellipse(u, v, (size - 0.6) / r.w, (size - 0.6) / r.h, null, color);
  }
}

function paintTorso(r: Region, top: TopKind): void {
  switch (top) {
    case "tshirt":
      torsoBase(r, 1);
      r.rect(0, 0.955, 1, 1, k(0.8));
      break;
    case "shirt":
    case "apron":
      torsoBase(r, 2);
      r.line(FRONT - 0.014, 0.04, FRONT - 0.014, 1, 1, SEAM);
      r.line(FRONT + 0.014, 0.04, FRONT + 0.014, 1, 1, SEAM);
      buttons(r, FRONT, [0.14, 0.3, 0.46, 0.62, 0.77, 0.9], IVORY);
      r.outline(0.66, 0.6, 0.72, 0.72, 1, SEAM);
      r.line(0.66, 0.7, 0.72, 0.7, 1, SEAM);
      r.line(0.08, 0.86, 0.42, 0.86, 1, SEAM);
      break;
    case "sweater":
      torsoBase(r, 3, false);
      r.shade((u) => 1 - 0.07 * (0.5 + 0.5 * Math.cos(u * r.w * Math.PI * 0.66)));
      r.rect(0, 0, 1, 0.08, k(0.82));
      for (let i = 0; i < r.w; i += 2) r.line(i / r.w, 0, i / r.w, 0.08, 1, k(0.75));
      r.rect(0, 0.94, 1, 1, k(0.82));
      break;
    case "jacket":
      torsoBase(r, 4);
      r.line(FRONT, 0, FRONT, 1, 2.4, k(0.42));
      r.line(FRONT, 0, FRONT, 1, 0.8, null, METAL);
      r.line(0.64, 0.6, 0.69, 0.7, 1.4, DEEP);
      r.line(0.86, 0.6, 0.81, 0.7, 1.4, DEEP);
      r.line(0.7, 0.88, FRONT - 0.01, 0.98, 1.5, FOLD);
      r.line(0.8, 0.88, FRONT + 0.01, 0.98, 1.5, FOLD);
      break;
    case "coat":
      torsoBase(r, 5, false);
      buttons(r, FRONT - 0.035, [0.5, 0.62], k(0.25), 2);
      buttons(r, FRONT + 0.035, [0.5, 0.62], k(0.25), 2);
      // Revers.
      r.line(FRONT - 0.07, 0.97, FRONT - 0.01, 0.7, 1.6, k(0.7));
      r.line(FRONT + 0.07, 0.97, FRONT + 0.01, 0.7, 1.6, k(0.7));
      r.line(FRONT - 0.07, 0.97, FRONT - 0.1, 0.84, 1.2, SEAM);
      r.line(FRONT + 0.07, 0.97, FRONT + 0.1, 0.84, 1.2, SEAM);
      // Ceinture nouée.
      r.rect(0, 0.33, 1, 0.39, k(0.85));
      r.line(0, 0.33, 1, 0.33, 1, SEAM);
      r.line(0, 0.39, 1, 0.39, 1, SEAM);
      r.rect(FRONT - 0.025, 0.31, FRONT + 0.025, 0.41, k(0.6));
      r.rect(FRONT - 0.016, 0.33, FRONT + 0.016, 0.39, null, k(0.35));
      break;
    case "hoodie":
      torsoBase(r, 6, false);
      r.outline(0.66, 0.02, 0.84, 0.28, 1.2, SEAM);
      r.line(0.66, 0.28, 0.69, 0.08, 1.4, DEEP);
      r.line(0.84, 0.28, 0.81, 0.08, 1.4, DEEP);
      r.line(FRONT - 0.015, 0.99, FRONT - 0.018, 0.78, 1.2, null, STRING);
      r.line(FRONT + 0.015, 0.99, FRONT + 0.018, 0.78, 1.2, null, STRING);
      r.rect(0, 0, 1, 0.06, k(0.82));
      break;
    case "sport":
      torsoBase(r, 7);
      for (const u of [0, 0.5, 1]) {
        r.line(u - 0.016, 0.02, u - 0.016, 0.98, 1.4, null, [0.92, 0.92, 0.9]);
        r.line(u + 0.016, 0.02, u + 0.016, 0.98, 1.4, null, [0.92, 0.92, 0.9]);
      }
      r.line(FRONT, 0.72, FRONT, 1, 1.6, k(0.45));
      r.rect(0.68, 0.7, 0.705, 0.74, null, [0.92, 0.92, 0.9]);
      break;
    case "hivis":
      torsoBase(r, 8);
      r.line(FRONT, 0, FRONT, 1, 2, k(0.6));
      r.outline(0.64, 0.1, 0.71, 0.24, 1, k(0.72));
      r.outline(0.79, 0.1, 0.86, 0.24, 1, k(0.72));
      r.outline(0.79, 0.56, 0.84, 0.66, 1, k(0.72));
      break;
  }
}

/** Bas d'une veste, d'un manteau ou d'un sweat (pièce du bassin) : v = 0 à l'ourlet, 1 à la taille. */
function paintHem(r: Region, top: TopKind): void {
  r.grain(0.035, 11);
  for (const u of [0, 0.5, 1]) r.line(u, 0, u, 1, 1, SEAM);
  if (top === "jacket") {
    r.line(FRONT, 0, FRONT, 1, 2.4, k(0.42));
    r.line(FRONT, 0, FRONT, 1, 0.8, null, METAL);
    r.line(0.63, 0.5, 0.68, 0.72, 1.6, DEEP);
    r.line(0.87, 0.5, 0.82, 0.72, 1.6, DEEP);
    r.rect(0, 0, 1, 0.14, k(0.82));
  } else if (top === "coat") {
    buttons(r, FRONT - 0.035, [0.68, 0.84], k(0.25), 2);
    buttons(r, FRONT + 0.035, [0.68, 0.84], k(0.25), 2);
    r.line(FRONT + 0.005, 0, FRONT + 0.005, 0.6, 1.2, k(0.7));
    for (const u of [0.62, 0.88]) {
      r.rect(u - 0.045, 0.66, u + 0.045, 0.72, k(0.85));
      r.line(u - 0.045, 0.66, u + 0.045, 0.66, 1, DEEP);
    }
    r.line(BACK, 0, BACK, 0.35, 1.4, DEEP);
    r.rect(0, 0, 1, 0.04, k(0.85));
    for (const u of [0.15, 0.4, 0.6, 0.9]) r.line(u, 0.04, u + 0.02, 0.4, 2, FOLD);
  } else if (top === "hoodie") {
    r.outline(0.66, 0.4, 0.84, 1, 1.2, SEAM);
    r.line(0.66, 0.9, 0.69, 0.5, 1.4, DEEP);
    r.line(0.84, 0.9, 0.81, 0.5, 1.4, DEEP);
    r.rect(0, 0, 1, 0.3, k(0.82));
    for (let i = 0; i < r.w; i += 2) r.line(i / r.w, 0, i / r.w, 0.3, 1, k(0.82));
  }
}

/** Manches : v = 0 au bout de la manche, 1 à l'épaule ; le pli du coude est devant (u = 0,75) en bas de la manche longue. */
function paintSleeve(r: Region, top: TopKind): void {
  r.grain(0.035, 21);
  r.line(BACK, 0, BACK, 1, 1, SEAM);
  r.rect(0, 0.92, 1, 1, k(0.88));
  if (top === "tshirt" || top === "sport") {
    r.rect(0, 0, 1, 0.1, k(0.82));
    if (top === "sport") {
      r.line(0, 0.04, 1, 0.04, 1.4, null, [0.92, 0.92, 0.9]);
      r.line(0.5, 0.1, 0.5, 1, 1.4, null, [0.92, 0.92, 0.9]);
    }
    return;
  }
  for (const v of [0.05, 0.11, 0.17]) r.line(FRONT - 0.12, v, FRONT + 0.12, v + 0.03, 1.2, FOLD);
  if (top === "sweater") r.shade((u) => 1 - 0.07 * (0.5 + 0.5 * Math.cos(u * r.w * Math.PI * 0.66)));
}

/** Avant-bras des manches longues : v = 0 au poignet, 1 au coude. Poignets selon le haut. */
function paintForeSleeve(r: Region, top: TopKind): void {
  r.grain(0.035, 31);
  r.line(BACK, 0, BACK, 1, 1, SEAM);
  for (const v of [0.86, 0.93]) r.line(FRONT - 0.15, v, FRONT + 0.15, v - 0.03, 1.2, FOLD);
  switch (top) {
    case "shirt":
    case "apron":
      r.rect(0, 0, 1, 0.16, k(0.92));
      r.line(0, 0.16, 1, 0.16, 1, SEAM);
      buttons(r, BACK + 0.06, [0.08], IVORY, 1.4);
      break;
    case "sweater":
    case "hoodie":
    case "sport":
      r.rect(0, 0, 1, 0.18, k(0.82));
      for (let i = 0; i < r.w; i += 2) r.line(i / r.w, 0, i / r.w, 0.18, 1, k(0.8));
      if (top === "sport") r.line(0.5, 0.18, 0.5, 1, 1.4, null, [0.92, 0.92, 0.9]);
      break;
    case "jacket":
    case "coat":
    case "hivis":
      r.rect(0, 0, 1, 0.1, k(0.84));
      r.line(0, 0.1, 1, 0.1, 1, SEAM);
      break;
  }
}

// Jambes (cuisse et jambe du pantalon) : u = 0,75 devant, 0,25 derrière, coutures sur les côtés (0 et 0,5). Cuisse : v = 0 au genou,
// 1 à la hanche ; jambe : v = 0 à la cheville, 1 au genou.
function legSeams(r: Region, doubled: boolean): void {
  for (const u of [0, 0.5, 1]) {
    r.line(u, 0, u, 1, 1, SEAM);
    if (doubled) r.line(u + 0.02, 0, u + 0.02, 1, 0.8, STITCH);
  }
}

function paintThigh(r: Region, bottom: BottomKind): void {
  r.grain(bottom === "jeans" ? 0.06 : 0.035, 41);
  switch (bottom) {
    case "jeans":
      legSeams(r, true);
      r.ellipse(FRONT, 0.55, 0.13, 0.45, k(1.14), null, 1);
      r.ellipse(FRONT, 0.02, 0.1, 0.12, k(1.12), null, 1);
      for (let i = 0; i < 4; i++) r.line(FRONT - 0.1 + i * 0.03, 0.82 - i * 0.02, FRONT - 0.04 + i * 0.03, 0.9, 1, k(1.18));
      break;
    case "trousers":
      legSeams(r, false);
      r.line(FRONT, 0, FRONT, 1, 1, k(1.15));
      r.line(FRONT + 0.012, 0, FRONT + 0.012, 1, 1, k(0.88));
      r.line(BACK, 0, BACK, 1, 1, k(1.1));
      break;
    case "shorts":
      legSeams(r, false);
      r.rect(0, 0, 1, 0.12, k(0.85));
      r.line(0, 0.12, 1, 0.12, 1, SEAM);
      break;
    case "jogging":
      r.line(0, 0, 0, 1, 2.2, null, [0.92, 0.92, 0.9]);
      r.line(0.5, 0, 0.5, 1, 2.2, null, [0.92, 0.92, 0.9]);
      r.line(1, 0, 1, 1, 2.2, null, [0.92, 0.92, 0.9]);
      for (const v of [0.12, 0.2]) r.line(FRONT - 0.1, v, FRONT + 0.1, v + 0.02, 1.4, FOLD);
      break;
    case "work":
      legSeams(r, true);
      for (const u of [0.5, 0]) {
        r.rect(u + 0.04, 0.25, u + 0.2, 0.55, k(0.9));
        r.outline(u + 0.04, 0.25, u + 0.2, 0.55, 1, SEAM);
        r.line(u + 0.04, 0.5, u + 0.2, 0.5, 1, DEEP);
      }
      r.rect(FRONT - 0.12, 0, FRONT + 0.12, 0.12, k(0.82));
      break;
    case "skirt":
      break;
  }
}

function paintShin(r: Region, bottom: BottomKind): void {
  r.grain(bottom === "jeans" ? 0.06 : 0.035, 51);
  switch (bottom) {
    case "jeans":
      legSeams(r, true);
      r.ellipse(FRONT, 0.98, 0.1, 0.15, k(1.12), null, 1);
      r.rect(0, 0, 1, 0.07, k(0.8));
      for (const v of [0.12, 0.2, 0.28]) r.line(FRONT - 0.15, v, FRONT + 0.15, v + 0.03, 1.3, FOLD);
      break;
    case "trousers":
      legSeams(r, false);
      r.line(FRONT, 0, FRONT, 1, 1, k(1.15));
      r.line(FRONT + 0.012, 0, FRONT + 0.012, 1, 1, k(0.88));
      r.line(BACK, 0, BACK, 1, 1, k(1.1));
      r.rect(0, 0, 1, 0.05, k(0.85));
      break;
    case "jogging":
      r.line(0, 0.1, 0, 1, 2.2, null, [0.92, 0.92, 0.9]);
      r.line(0.5, 0.1, 0.5, 1, 2.2, null, [0.92, 0.92, 0.9]);
      r.line(1, 0.1, 1, 1, 2.2, null, [0.92, 0.92, 0.9]);
      r.rect(0, 0, 1, 0.1, k(0.75));
      for (let i = 0; i < r.w; i += 2) r.line(i / r.w, 0, i / r.w, 0.1, 1, k(0.82));
      break;
    case "work":
      legSeams(r, true);
      r.rect(FRONT - 0.13, 0.72, FRONT + 0.13, 1, k(0.78));
      r.outline(FRONT - 0.13, 0.72, FRONT + 0.13, 1, 1, SEAM);
      r.rect(0, 0, 1, 0.05, k(0.85));
      break;
    default:
      break;
  }
}

/** Bassin du pantalon : v = 0 à l'entrejambe (y = −0,155), 1 à la taille (y = 0,03) ; seul le bas (v < 0,45) dépasse du haut. */
function paintPelvis(r: Region, bottom: BottomKind): void {
  r.grain(bottom === "jeans" ? 0.06 : 0.035, 61);
  r.line(BACK, 0, BACK, 1, 1, SEAM);
  if (bottom === "jeans" || bottom === "shorts" || bottom === "work") {
    // Poches arrière, braguette, poches avant.
    for (const u of [0.15, 0.35]) {
      r.outline(u - 0.06, 0.12, u + 0.06, 0.4, 1, SEAM);
      if (bottom === "jeans") r.outline(u - 0.05, 0.14, u + 0.05, 0.38, 0.7, STITCH);
    }
    r.line(FRONT + 0.03, 0.12, FRONT + 0.03, 0.6, 1, SEAM);
    r.line(FRONT, 0.1, FRONT + 0.03, 0.14, 1, SEAM);
    r.line(0.6, 0.6, 0.66, 0.3, 1.2, DEEP);
    r.line(0.9, 0.6, 0.84, 0.3, 1.2, DEEP);
    if (bottom === "jeans") r.line(0, 0.45, 1, 0.45, 1, SEAM);
  } else if (bottom === "trousers") {
    for (const u of [0.15, 0.35]) r.line(u - 0.05, 0.32, u + 0.05, 0.32, 1.2, DEEP);
    r.line(FRONT + 0.03, 0.12, FRONT + 0.03, 0.6, 1, SEAM);
    r.line(0.6, 0.6, 0.64, 0.3, 1.2, DEEP);
    r.line(0.9, 0.6, 0.86, 0.3, 1.2, DEEP);
  } else if (bottom === "jogging") {
    r.line(0, 0, 0, 1, 2.2, null, [0.92, 0.92, 0.9]);
    r.line(0.5, 0, 0.5, 1, 2.2, null, [0.92, 0.92, 0.9]);
    r.line(1, 0, 1, 1, 2.2, null, [0.92, 0.92, 0.9]);
  }
}

/** Jupe : plis creux, ourlet, ceinture. v = 0 à l'ourlet. */
function paintSkirt(r: Region): void {
  r.grain(0.035, 71);
  for (let i = 0; i < 16; i++) r.line(i / 16, 0, i / 16, 0.75, 1.4, i % 2 ? FOLD : k(1.1));
  r.rect(0, 0, 1, 0.05, k(0.85));
  r.rect(0, 0.88, 1, 1, k(0.85));
}

/** Chaussure : v = 0 au talon, 1 à la pointe ; u = 0,25 sur le dessus, 0,75 dessous, 0 et 0,5 sur les côtés. */
function paintFoot(r: Region, shoes: ShoeKind): void {
  const TOP = 0.25;
  r.grain(0.03, 81);
  switch (shoes) {
    case "sneakers":
      r.rect(TOP - 0.08, 0.4, TOP + 0.08, 0.72, k(0.8));
      for (const v of [0.44, 0.51, 0.58, 0.65]) r.line(TOP - 0.07, v, TOP + 0.07, v + 0.02, 1.2, null, [0.93, 0.93, 0.9]);
      for (const u of [0, 0.5, 1]) r.line(u - 0.04, 0.25, u + 0.04, 0.62, 2, null, [0.93, 0.93, 0.9]);
      r.ellipse(TOP, 0.94, 0.15, 0.12, k(1.15), null, 1);
      r.rect(0.4, 0, 1, 0.08, k(0.75));
      break;
    case "leather":
      r.line(TOP - 0.16, 0.78, TOP, 0.82, 1, DEEP);
      r.line(TOP, 0.82, TOP + 0.16, 0.78, 1, DEEP);
      for (const v of [0.46, 0.52, 0.58]) r.line(TOP - 0.05, v, TOP + 0.05, v, 1, k(0.45));
      r.ellipse(TOP, 0.9, 0.06, 0.06, k(1.45), null, 1);
      r.ellipse(TOP + 0.02, 0.2, 0.05, 0.08, k(1.3), null, 1);
      r.line(0.56, 0, 0.56, 1, 1, k(0.5));
      r.line(0.94, 0, 0.94, 1, 1, k(0.5));
      break;
    case "boots":
      for (let i = 0; i < 5; i++) {
        const v = 0.15 + i * 0.08;
        r.line(TOP - 0.06, v, TOP + 0.06, v + 0.06, 1.2, k(0.5));
        r.line(TOP + 0.06, v, TOP - 0.06, v + 0.06, 1.2, k(0.5));
      }
      r.line(TOP - 0.17, 0.74, TOP + 0.17, 0.74, 1.2, DEEP);
      r.line(0.56, 0, 0.56, 1, 1.4, k(0.5));
      r.line(0.94, 0, 0.94, 1, 1.4, k(0.5));
      break;
  }
}

/** Tige de botte : lacets croisés devant, crochets, revers en haut. v = 0 en bas. */
function paintBoot(r: Region): void {
  r.grain(0.03, 91);
  for (let i = 0; i < 5; i++) {
    const v = 0.05 + i * 0.17;
    r.line(FRONT - 0.07, v, FRONT + 0.07, v + 0.12, 1.2, k(0.5));
    r.line(FRONT + 0.07, v, FRONT - 0.07, v + 0.12, 1.2, k(0.5));
    r.ellipse(FRONT - 0.08, v, 1.2 / r.w, 1.2 / r.h, null, METAL);
    r.ellipse(FRONT + 0.08, v, 1.2 / r.w, 1.2 / r.h, null, METAL);
  }
  r.rect(0, 0.88, 1, 1, k(0.8));
  r.line(BACK, 0, BACK, 0.88, 1, SEAM);
}

/** Cheveux : mèches le long de v (du sommet vers la lisière, ou de haut en bas sur les mèches longues). */
function paintHair(r: Region): void {
  r.grain(0.05, 101);
  for (let i = 0; i < 70; i++) {
    const u = (i * 0.618034) % 1, v0 = 0.05 * ((i * 7) % 5);
    const light = i % 5 === 0;
    r.line(u, v0, u + 0.01 * hash(i, 1, 3), 1, 1, light ? k(1.25) : k(0.78));
  }
}

/**
 * Visage (`variant` : 0 homme, 1 femme, +2 senior). La tête est une sphère : u = 0,75 devant, croît vers la gauche du personnage ;
 * v = 0 sous le menton, 1 au sommet. Yeux à v ≈ 0,556 et u = 0,75 ± 0,063 ; bouche à v ≈ 0,35.
 */
function paintFace(r: Region, variant: number): void {
  const female = variant % 2 === 1, senior = variant >= 2;
  const EYE_V = 0.556, EYE_DU = 0.063;
  r.grain(0.02, 111);
  for (const s of [-1, 1]) {
    const u = FRONT + s * EYE_DU;
    // Orbite, blanc de l'œil, iris, paupière.
    r.ellipse(u, EYE_V + 0.005, 0.045, 0.045, k(0.86), null, 1);
    r.ellipse(u, EYE_V, 0.025, 0.017, null, [0.86, 0.84, 0.8]);
    r.ellipse(u + s * 0.002, EYE_V - 0.001, 0.011, 0.015, null, [0.1, 0.07, 0.05]);
    r.line(u - 0.028, EYE_V + 0.014, u + 0.028, EYE_V + 0.014, female ? 1.8 : 1.3, k(0.3));
    // Sourcils : plus fins et plus arqués chez les femmes.
    const bv = EYE_V + (female ? 0.068 : 0.058);
    r.line(u - s * 0.032, bv - 0.006, u, bv + (female ? 0.012 : 0.004), female ? 1.5 : 2.6, k(0.32));
    r.line(u, bv + (female ? 0.012 : 0.004), u + s * 0.032, bv - (female ? 0.01 : 0.002), female ? 1.3 : 2.3, k(0.35));
    if (senior) {
      r.line(u + s * 0.035, EYE_V, u + s * 0.05, EYE_V + 0.012, 0.8, k(0.8));
      r.line(u + s * 0.035, EYE_V - 0.004, u + s * 0.05, EYE_V - 0.014, 0.8, k(0.8));
      // Sillons du nez à la bouche.
      r.line(FRONT + s * 0.03, 0.47, FRONT + s * 0.045, 0.37, 1, k(0.8));
    }
    // Pommettes (rose chez les femmes), creux de joue.
    r.ellipse(FRONT + s * 0.075, 0.45, 0.04, 0.05, female ? [1.05, 0.9, 0.88] : k(0.97), null, 1);
  }
  // Ombre sous le nez, bouche, creux sous la lèvre, menton.
  r.ellipse(FRONT, 0.43, 0.02, 0.012, k(0.86), null, 1);
  r.ellipse(FRONT, 0.352, 0.035, 0.016, female ? [0.88, 0.5, 0.5] : [0.88, 0.66, 0.62]);
  r.line(FRONT - 0.034, 0.352, FRONT + 0.034, 0.352, 1, k(0.45));
  r.ellipse(FRONT, 0.315, 0.025, 0.012, k(0.9), null, 1);
  if (senior) for (const v of [0.66, 0.69]) r.line(FRONT - 0.06, v, FRONT + 0.06, v, 0.8, k(0.85));
  // Ombre du cou sous la mâchoire.
  r.rect(0, 0, 1, 0.12, k(0.88));
}

/**
 * Contraste des facteurs peints (exposant) : à la distance du jeu, un pli à 0,88 ne se voit pas. Les textures de GTA 3 forçaient
 * aussi le trait ; on garde la peinture lisible et on accentue ici, en une fois.
 */
const CONTRAST = 1.7;

/** Peint toutes les pages : rgba en flottants (rgb = facteur, alpha 1 = modulation), avant le codage. */
export function paintPages(): Float32Array[] {
  const pages: Float32Array[] = [];
  for (let layer = 0; layer < LAYER_COUNT; layer++) {
    const px = new Float32Array(TEXTURE_SIZE * TEXTURE_SIZE * 4).fill(1);
    const region = (name: keyof typeof REGIONS): Region => new Region(px, REGIONS[name]!);
    paintTorso(region("torso"), TOPS[layer] ?? "tshirt");
    paintHem(region("hem"), TOPS[layer] ?? "tshirt");
    paintSleeve(region("sleeve"), TOPS[layer] ?? "tshirt");
    paintForeSleeve(region("foreSleeve"), TOPS[layer] ?? "tshirt");
    const bottom: BottomKind = BOTTOMS[layer] ?? "jeans";
    paintThigh(region("thigh"), bottom);
    paintShin(region("shin"), bottom);
    paintPelvis(region("pelvis"), bottom);
    paintSkirt(region("skirt"));
    paintFoot(region("foot"), SHOES[layer] ?? "sneakers");
    paintBoot(region("boot"));
    paintHair(region("hair"));
    paintFace(region("head"), layer % 4);
    for (let i = 0; i < px.length; i += 4) {
      if (px[i + 3]! > 0.5) for (let c = 0; c < 3; c++) px[i + c] = px[i + c]! ** CONTRAST;
    }
    // Bordures : chaque région recopie son bord sur le texel de marge (le filtrage ne mélange pas deux régions voisines).
    for (const name of Object.keys(REGIONS) as (keyof typeof REGIONS)[]) {
      const [x, y, w, h] = REGIONS[name]!;
      const copy = (dx: number, dy: number, sx: number, sy: number): void => {
        const d = (dy * TEXTURE_SIZE + dx) * 4, s = (sy * TEXTURE_SIZE + sx) * 4;
        for (let c = 0; c < 4; c++) px[d + c] = px[s + c]!;
      };
      for (let i = x; i < x + w; i++) {
        const sx = Math.min(Math.max(i, x + 1), x + w - 2);
        copy(i, y, sx, y + 1);
        copy(i, y + h - 1, sx, y + h - 2);
      }
      for (let j = y; j < y + h; j++) {
        const sy = Math.min(Math.max(j, y + 1), y + h - 2);
        copy(x, j, x + 1, sy);
        copy(x + w - 1, j, x + w - 2, sy);
      }
    }
    pages.push(px);
  }
  return pages;
}

/** Code les pages en octets (rgb / 2, alpha), à la suite. */
export function encodePages(pages: readonly Float32Array[]): Uint8Array {
  const out = new Uint8Array(TEXTURE_SIZE * TEXTURE_SIZE * 4 * pages.length);
  pages.forEach((px, p) => {
    const base = p * TEXTURE_SIZE * TEXTURE_SIZE * 4;
    for (let i = 0; i < px.length; i++) out[base + i] = Math.round(255 * clamp01(i % 4 === 3 ? px[i]! : px[i]! / 2));
  });
  return out;
}

let shared: THREE.DataArrayTexture | null = null;

/** Texture des personnages (une seule pour tout le jeu, faite à la première demande : ≈ 20 ms). */
export function characterTexture(): THREE.DataArrayTexture {
  if (shared) return shared;
  const tex = new THREE.DataArrayTexture(encodePages(paintPages()), TEXTURE_SIZE, TEXTURE_SIZE, LAYER_COUNT);
  tex.format = THREE.RGBAFormat;
  tex.type = THREE.UnsignedByteType;
  tex.colorSpace = THREE.NoColorSpace;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  shared = tex;
  return tex;
}
