import type { SpriteRequest } from "./atlas";
import type { Paint } from "./paint";

/** Dessins procéduraux des éléments de façade. Tailles en mètres, relief 0-255 (128 = plan du mur). */

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

const STONE = "#d8d0bc";
const BAND = "#ece7d9";

const SURROUND_W = { stone: 0.14, plaster_band: 0.1, none: 0 } as const;

export function quantize(v: number, step = 0.1): number {
  return Math.round(v / step) * step;
}

const FRAMES = ["#e9e4d6", "#5a4632", "#3d3d3b"];

function lum(hex: string): number {
  return 0.299 * parseInt(hex.slice(1, 3), 16) + 0.587 * parseInt(hex.slice(3, 5), 16) + 0.114 * parseInt(hex.slice(5, 7), 16);
}

/** Forme canonique : ce qui ne se voit pas ne crée pas de variante (couleur de volet sans volet, linteau sans encadrement…). */
export function canonicalWindow(s: WindowSpec): WindowSpec {
  const c = { ...s, w: quantize(s.w, 0.1), h: quantize(s.h, 0.2) };
  if (c.surround === "none") c.lintel = "none";
  if (c.shutter === "none" || c.shutter === "roulant") c.shutterColor = "#000000";
  // Cadre : clair, brun ou sombre.
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

function openingPath(ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, arched: boolean): void {
  if (arched) {
    const r = (x1 - x0) / 2;
    ctx.moveTo(x0, y1);
    ctx.lineTo(x0, y0 + r);
    ctx.arc((x0 + x1) / 2, y0 + r, r, Math.PI, 0);
    ctx.lineTo(x1, y1);
    ctx.closePath();
  } else {
    ctx.rect(x0, y0, x1 - x0, y1 - y0);
  }
}

function glass(p: Paint, x0: number, y0: number, x1: number, y1: number, arched: boolean): void {
  p.fill((c) => openingPath(c, x0, y0, x1, y1, arched), "#2c3744", 40);
  const g = p.c.createLinearGradient(x0, y0, x1, y1);
  g.addColorStop(0, "rgba(150,175,200,0.55)");
  g.addColorStop(0.5, "rgba(70,88,106,0.25)");
  g.addColorStop(1, "rgba(30,38,48,0.1)");
  p.c.fillStyle = g;
  p.c.beginPath();
  openingPath(p.c, x0, y0, x1, y1, arched);
  p.c.fill();
  // Ombre portée du linteau sur la vitre : l'encadrement est en saillie.
  const sh = p.c.createLinearGradient(0, y0, 0, y0 + (y1 - y0) * 0.18);
  sh.addColorStop(0, "rgba(0,0,0,0.35)");
  sh.addColorStop(1, "rgba(0,0,0,0)");
  p.c.fillStyle = sh;
  p.c.fillRect(x0, y0, x1 - x0, (y1 - y0) * 0.18);
}

function sashes(p: Paint, s: WindowSpec, ppm: number, x0: number, y0: number, x1: number, y1: number): void {
  const t = Math.max(2, Math.round(0.045 * ppm));
  const thin = Math.max(1, Math.round(0.022 * ppm));
  const cols = s.style === "picture" || s.style === "small" ? 1 : 2;
  const rows = { panes_6: 3, panes_4: 2, panes_2: 1, french_window: 4, picture: 1, small: 1 }[s.style];
  const arched = s.lintel === "arched";
  // Cadre extérieur
  p.fill((c) => {
    openingPath(c, x0, y0, x1, y1, arched);
    openingPath(c, x0 + t, y0 + t, x1 - t, y1 - t, arched);
  }, s.frame, 195, "evenodd");
  // Traverses et petits-bois
  for (let r = 1; r < rows; r++) {
    const y = y0 + ((y1 - y0) * r) / rows;
    p.rect(x0, y - thin / 2, x1 - x0, thin, s.frame, 190);
  }
  for (let cidx = 1; cidx < cols; cidx++) {
    const x = x0 + ((x1 - x0) * cidx) / cols;
    p.rect(x - t * 0.8, y0, t * 1.6, y1 - y0, s.frame, 200);
  }
  if (s.style !== "picture" && s.style !== "small") {
    // Traverse de mi-hauteur plus marquée entre les deux vantaux supérieur et inférieur.
    p.rect(x0, (y0 + y1) / 2 - t / 2, x1 - x0, t, s.frame, 198);
  }
}

function shutters(p: Paint, s: WindowSpec, ppm: number, ox0: number, oy0: number, ox1: number, oy1: number, sur: number): void {
  if (s.shutter !== "battant" && s.shutter !== "persienne") return;
  const leaf = (ox1 - ox0) / 2;
  const top = oy0 - sur * ppm;
  const bottom = oy1;
  const draw = (x: number, w: number): void => {
    p.rect(x, top, w, bottom - top, s.shutterColor, 160);
    if (s.shutter === "persienne") {
      const step = Math.max(2, 0.04 * ppm);
      for (let y = top + 2; y < bottom - 2; y += step) {
        p.rect(x + 2, y, w - 4, Math.max(1, step * 0.45), "rgba(255,255,255,0.14)", 176);
        p.rect(x + 2, y + step * 0.5, w - 4, Math.max(1, step * 0.4), "rgba(0,0,0,0.22)", 146);
      }
    } else {
      const step = Math.max(3, 0.1 * ppm);
      for (let xx = x + step; xx < x + w - 1; xx += step) p.rect(xx, top, 1, bottom - top, "rgba(0,0,0,0.3)", 138);
      p.rect(x, top, w, Math.max(2, 0.07 * ppm), "rgba(0,0,0,0.15)", 172);
      p.rect(x, bottom - Math.max(2, 0.07 * ppm), w, Math.max(2, 0.07 * ppm), "rgba(0,0,0,0.15)", 172);
      // Écharpe en Z
      p.fill((c) => {
        c.moveTo(x, bottom - 0.1 * ppm);
        c.lineTo(x + w, top + 0.2 * ppm);
        c.lineTo(x + w, top + 0.2 * ppm + Math.max(2, 0.06 * ppm));
        c.lineTo(x, bottom - 0.1 * ppm + Math.max(2, 0.06 * ppm));
      }, "rgba(0,0,0,0.18)", 170);
    }
    // Léger liseré d'ombre côté mur
    p.tint((c) => c.rect(x, top, w, bottom - top), "rgba(0,0,0,0.05)");
  };
  draw(ox0 - sur * ppm - leaf, leaf);
  draw(ox1 + sur * ppm, leaf);
}

export function windowRequest(s: WindowSpec): SpriteRequest & { bottomPad: number } {
  const d = windowDims(s);
  return {
    key: windowKey(s), wm: d.wm, hm: d.hm, bottomPad: d.bottomPad,
    draw: (p, ppm) => {
      const W = p.w, H = p.hgt;
      const sur = d.sur * ppm;
      const ox0 = W / 2 - (s.w * ppm) / 2, ox1 = ox0 + s.w * ppm;
      const oy1 = H - d.bottomPad * ppm, oy0 = oy1 - s.h * ppm;
      const arched = s.lintel === "arched";
      shutters(p, s, ppm, ox0, oy0, ox1, oy1, d.sur);
      if (s.surround !== "none") {
        const col = s.surround === "stone" ? STONE : BAND;
        const rel = s.surround === "stone" ? 172 : 158;
        const topY = oy0 - sur - (s.lintel === "segmental" ? 0.1 * ppm : 0);
        p.fill((c) => {
          c.moveTo(ox0 - sur, oy1);
          c.lineTo(ox0 - sur, oy0 - (s.lintel === "segmental" ? 0 : sur));
          if (s.lintel === "segmental") c.quadraticCurveTo(W / 2, topY - 0.06 * ppm, ox1 + sur, oy0);
          else if (arched) c.arc(W / 2, oy0 + (ox1 - ox0) / 2, (ox1 - ox0) / 2 + sur, Math.PI, 0);
          else c.lineTo(ox1 + sur, oy0 - sur);
          c.lineTo(ox1 + sur, oy1);
          c.closePath();
        }, col, rel);
        if (s.surround === "stone" && s.lintel !== "arched") {
          // Clé de voûte / claveau central
          p.rect(W / 2 - 0.08 * ppm, topY, 0.16 * ppm, sur + (s.lintel === "segmental" ? 0.1 * ppm : 0), "rgba(255,255,255,0.35)", 186);
        }
      }
      glass(p, ox0, oy0, ox1, oy1, arched);
      sashes(p, s, ppm, ox0, oy0, ox1, oy1);
      if (s.sill) {
        const sx0 = ox0 - sur - 0.04 * ppm, sx1 = ox1 + sur + 0.04 * ppm;
        p.rect(sx0, oy1, sx1 - sx0, 0.08 * ppm, STONE, 205);
        p.tint((c) => c.rect(sx0, oy1 + 0.08 * ppm, sx1 - sx0, 0.05 * ppm), "rgba(0,0,0,0.28)");
        p.rect(sx0, oy1 + 0.08 * ppm, sx1 - sx0, 0.025 * ppm, "#bdb5a1", 150);
      }
    },
  };
}

// --- Portes -----------------------------------------------------------------------------

export type DoorStyle = "simple" | "carriage" | "glazed" | "garage";

export function doorDims(style: DoorStyle): { wm: number; hm: number; w: number; h: number; sur: number } {
  switch (style) {
    case "carriage": return { w: 2.4, h: 3.0, sur: 0.2, wm: 2.8, hm: 3.3 };
    case "glazed": return { w: 1.2, h: 2.35, sur: 0.12, wm: 1.44, hm: 2.5 };
    case "garage": return { w: 2.5, h: 2.2, sur: 0.1, wm: 2.7, hm: 2.35 };
    default: return { w: 1.0, h: 2.15, sur: 0.14, wm: 1.28, hm: 2.4 };
  }
}

export function doorRequest(style: DoorStyle, color: string): SpriteRequest {
  const d = doorDims(style);
  return {
    key: `door|${style}|${color}`, wm: d.wm, hm: d.hm,
    draw: (p, ppm) => {
      const W = p.w, H = p.hgt;
      const w = d.w * ppm, h = d.h * ppm, sur = d.sur * ppm;
      const x0 = (W - w) / 2, x1 = x0 + w, y1 = H - 0.12 * ppm, y0 = y1 - h;
      const arched = style === "carriage";
      if (style !== "garage") {
        // Marche en pierre
        p.rect(x0 - sur, y1, w + 2 * sur, 0.12 * ppm, "#bcb4a2", 190);
        // Encadrement
        p.fill((c) => {
          c.moveTo(x0 - sur, y1);
          c.lineTo(x0 - sur, arched ? y0 + w / 2 : y0 - sur);
          if (arched) c.arc(W / 2, y0 + w / 2, w / 2 + sur, Math.PI, 0);
          else c.lineTo(x1 + sur, y0 - sur);
          c.lineTo(x1 + sur, y1);
          c.closePath();
        }, STONE, 170);
      }
      if (style === "glazed") {
        p.rect(x0, y0, w, h, color, 190);
        glass(p, x0 + 0.06 * ppm, y0 + 0.06 * ppm, x1 - 0.06 * ppm, y1 - 0.45 * ppm, false);
        p.rect(W / 2 - 1, y0, 2, h - 0.45 * ppm, color, 195);
        p.rect(x0 + 0.1 * ppm, y1 - 0.9 * ppm, 0.04 * ppm, 0.5 * ppm, "#cfc9b8", 215);
      } else if (style === "garage") {
        p.rect(x0, y0, w, h, color === "#e8e4d8" ? "#e8e4d8" : "#d9d6cd", 165);
        for (let y = y0 + 0.4 * ppm; y < y1; y += 0.4 * ppm) p.rect(x0, y, w, 1.5, "rgba(0,0,0,0.3)", 135);
      } else {
        p.fill((c) => openingPath(c, x0, y0, x1, y1, arched), color, 170);
        // Planches ou panneaux
        const step = (style === "carriage" ? 0.16 : 0.5) * ppm;
        for (let x = x0 + step; x < x1 - 1; x += step) p.rect(x, y0 + (arched ? w / 2 : 0), 1.5, y1 - y0 - (arched ? w / 2 : 0), "rgba(0,0,0,0.3)", 138);
        if (style === "simple") {
          for (const [py, ph] of [[0.15, 0.7], [1.0, 0.95]] as const) {
            p.rect(x0 + 0.12 * ppm, y0 + py * ppm, w - 0.24 * ppm, ph * ppm, "rgba(0,0,0,0.12)", 150);
          }
          p.rect(x1 - 0.18 * ppm, y1 - 1.0 * ppm, 0.07 * ppm, 0.07 * ppm, "#d8c58a", 220);
        } else {
          p.rect(W / 2 - 1.5, y0 + w / 2, 3, y1 - y0 - w / 2, "rgba(0,0,0,0.45)", 120);
          for (let y = y0 + w / 2 + 0.3 * ppm; y < y1 - 0.2 * ppm; y += 0.45 * ppm) {
            for (let x = x0 + 0.2 * ppm; x < x1 - 0.1 * ppm; x += 0.5 * ppm) p.rect(x, y, 3, 3, "#2a2a2a", 200);
          }
        }
      }
    },
  };
}

// --- Vitrines ---------------------------------------------------------------------------

export const SHOP_MODULE_W = 1.4;

export function shopModuleRequest(color: string, glazing: "full" | "divided", hm: number, door: boolean): SpriteRequest {
  const w = door ? 1.2 : SHOP_MODULE_W;
  return {
    key: `shop|${color}|${glazing}|${hm.toFixed(1)}|${door ? "door" : "window"}`, wm: w, hm,
    draw: (p, ppm) => {
      const W = p.w, H = p.hgt;
      const m = 0.07 * ppm, bulk = (door ? 0.15 : 0.55) * ppm;
      // Dormant et soubassement
      p.rect(0, 0, W, H, color, 175);
      glass(p, m, m, W - m, H - bulk, false);
      if (door) {
        p.rect(W / 2 - 1.5, m, 3, H - bulk - m, color, 190);
        p.rect(m + 0.1 * ppm, H * 0.45, 0.04 * ppm, 0.6 * ppm, "#d8d2c0", 220);
      } else {
        if (glazing === "divided") {
          p.rect(m, m + (H - bulk - m) * 0.62, W - 2 * m, Math.max(2, 0.04 * ppm), color, 190);
          p.rect(W / 2 - 1.5, m, 3, H - bulk - m, color, 190);
        }
        // Panneau de soubassement en creux
        p.rect(m * 1.6, H - bulk + m * 0.8, W - m * 3.2, bulk - m * 1.8, "rgba(0,0,0,0.18)", 150);
      }
      p.rect(0, H - 0.04 * ppm, W, 0.04 * ppm, "rgba(0,0,0,0.25)", 120);
    },
  };
}

export function railingRequest(): SpriteRequest {
  return {
    key: "railing", wm: 1.0, hm: 0.95,
    draw: (p, ppm) => {
      const W = p.w, H = p.hgt;
      const iron = "#1c1c1e";
      const bar = Math.max(1.5, 0.018 * ppm);
      for (let x = bar; x < W; x += 0.115 * ppm) p.rect(x, 0.06 * ppm, bar, H - 0.06 * ppm, iron, 190);
      p.rect(0, 0.0, W, 0.05 * ppm, iron, 205);
      p.rect(0, H - 0.1 * ppm, W, 0.04 * ppm, iron, 200);
      p.rect(0, H * 0.45, W, 0.025 * ppm, iron, 195);
      p.fill((c) => c.arc(W / 2, H * 0.52, 0.17 * ppm, 0, Math.PI * 2), "rgba(0,0,0,0)", 128);
      p.c.strokeStyle = iron;
      p.c.lineWidth = bar;
      p.c.beginPath();
      p.c.arc(W / 2, H * 0.52, 0.17 * ppm, 0, Math.PI * 2);
      p.c.stroke();
      p.h.strokeStyle = "rgb(200,200,200)";
      p.h.lineWidth = bar;
      p.h.beginPath();
      p.h.arc(W / 2, H * 0.52, 0.17 * ppm, 0, Math.PI * 2);
      p.h.stroke();
    },
  };
}

// --- Enseignes --------------------------------------------------------------------------

export function signRequest(text: string, bg: string, widthM: number): SpriteRequest {
  const wm = quantize(widthM, 0.5);
  const dark = luminance(bg) < 0.45;
  return {
    key: `sign|${text}|${bg}|${wm}`, wm, hm: 0.55,
    draw: (p) => {
      const W = p.w, H = p.hgt;
      p.rect(0, 0, W, H, bg, 160);
      p.rect(2, 2, W - 4, H - 4, "rgba(255,255,255,0.12)", 175);
      p.c.fillStyle = dark ? "#f1e7c8" : "#262626";
      p.c.textAlign = "center";
      p.c.textBaseline = "middle";
      let size = H * 0.62;
      p.c.font = `700 ${size}px "Trebuchet MS", system-ui, sans-serif`;
      while (p.c.measureText(text).width > W * 0.9 && size > 8) {
        size -= 1;
        p.c.font = `700 ${size}px "Trebuchet MS", system-ui, sans-serif`;
      }
      p.c.fillText(text, W / 2, H / 2 + 1);
      p.h.fillStyle = "rgb(200,200,200)";
      p.h.textAlign = "center";
      p.h.textBaseline = "middle";
      p.h.font = p.c.font;
      p.h.fillText(text, W / 2, H / 2 + 1);
    },
  };
}

function luminance(hex: string): number {
  const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}
