/** Dimensions et clés des éléments de façade (fenêtres, portes, vitrines, balcons, enseignes). Tailles en mètres.
 *  Le dessin est fait par `stylized.ts` d'après la clé. */

export interface ElementSpec {
  key: string;
  /** Largeur et hauteur de l'élément, volets et encadrement compris. */
  wm: number;
  hm: number;
}

export interface WindowSpec {
  style: "panes_6" | "panes_4" | "panes_2" | "french_window" | "picture" | "small";
  w: number;
  h: number;
  surround: "stone" | "plaster_band" | "none";
  lintel: "flat" | "segmental" | "arched" | "none";
  sill: boolean;
  shutter: "battant" | "persienne" | "roulant" | "none";
  shutterColor: string;
  frame: string;
}

const SURROUND_W = { stone: 0.14, plaster_band: 0.1, none: 0 } as const;
const FRAMES = ["#e9e4d6", "#5a4632", "#3d3d3b"];

export function quantize(v: number, step = 0.1): number {
  return Math.round(v / step) * step;
}

function lum(hex: string): number {
  return 0.299 * parseInt(hex.slice(1, 3), 16) + 0.587 * parseInt(hex.slice(3, 5), 16) + 0.114 * parseInt(hex.slice(5, 7), 16);
}

/** Forme canonique : ce qui ne se voit pas ne crée pas de variante (couleur de volet sans volet, linteau sans encadrement…). */
export function canonicalWindow(s: WindowSpec): WindowSpec {
  const c = { ...s, w: quantize(s.w, 0.1), h: quantize(s.h, 0.2) };
  if (c.surround === "none") c.lintel = "none";
  if (c.shutter === "none" || c.shutter === "roulant") c.shutterColor = "#000000";
  c.frame = FRAMES.reduce((best, f) => (Math.abs(lum(f) - lum(s.frame)) < Math.abs(lum(best) - lum(s.frame)) ? f : best));
  return c;
}

export function windowDims(s: WindowSpec): { wm: number; hm: number; bottomPad: number; sur: number } {
  const sur = SURROUND_W[s.surround];
  const leaf = s.shutter === "battant" || s.shutter === "persienne" ? s.w / 2 : 0;
  const bottomPad = s.sill ? 0.16 : 0.02;
  const top = sur + (s.lintel === "segmental" ? 0.1 : 0) + 0.02;
  return { wm: s.w + 2 * sur + 2 * leaf + 0.06, hm: bottomPad + s.h + top, bottomPad, sur };
}

export function windowKey(s: WindowSpec): string {
  return `win|${s.style}|${s.w.toFixed(1)}x${s.h.toFixed(1)}|${s.surround}|${s.lintel}|${s.sill ? 1 : 0}|${s.shutter}|${s.shutterColor}|${s.frame}`;
}

export function windowRequest(s: WindowSpec): ElementSpec & { bottomPad: number } {
  const d = windowDims(s);
  return { key: windowKey(s), wm: d.wm, hm: d.hm, bottomPad: d.bottomPad };
}

export type DoorStyle = "simple" | "carriage" | "glazed" | "garage";

export function doorDims(style: DoorStyle): { wm: number; hm: number; w: number; h: number; sur: number } {
  switch (style) {
    case "carriage": return { w: 2.4, h: 3.0, sur: 0.2, wm: 2.8, hm: 3.3 };
    case "glazed": return { w: 1.2, h: 2.35, sur: 0.12, wm: 1.44, hm: 2.5 };
    case "garage": return { w: 2.5, h: 2.2, sur: 0.1, wm: 2.7, hm: 2.35 };
    default: return { w: 1.0, h: 2.15, sur: 0.14, wm: 1.28, hm: 2.4 };
  }
}

export function doorRequest(style: DoorStyle, color: string): ElementSpec {
  const d = doorDims(style);
  return { key: `door|${style}|${color}`, wm: d.wm, hm: d.hm };
}

export const SHOP_MODULE_W = 1.4;

export function shopModuleRequest(color: string, glazing: "full" | "divided", hm: number, door: boolean): ElementSpec {
  return { key: `shop|${color}|${glazing}|${hm.toFixed(1)}|${door ? "door" : "window"}`, wm: door ? 1.2 : SHOP_MODULE_W, hm };
}

export function railingRequest(): ElementSpec {
  return { key: "railing", wm: 1.0, hm: 0.95 };
}

export function signRequest(text: string, bg: string, widthM: number): ElementSpec {
  return { key: `sign|${text}|${bg}|${quantize(widthM, 0.5)}`, wm: quantize(widthM, 0.5), hm: 0.55 };
}
