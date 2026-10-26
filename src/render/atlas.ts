import * as THREE from "three";
import { canvasTexture, Paint } from "./paint";

export interface SpriteRequest {
  key: string;
  /** Taille en mètres. */
  wm: number;
  hm: number;
  draw: (paint: Paint, ppm: number) => void;
}

export interface SpriteRect {
  page: number;
  u0: number;
  v0: number;
  u1: number;
  v1: number;
  wm: number;
  hm: number;
}

export interface Atlas {
  pages: { map: THREE.CanvasTexture; normalMap: THREE.CanvasTexture }[];
  rects: Map<string, SpriteRect>;
  ppm: number;
  size: number;
  /** Part de la surface des pages utilisée. */
  fill: number;
}

const PAD = 3;

interface Placed {
  r: SpriteRequest;
  page: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Dessine tous les sprites demandés dans des atlas carrés (au plus `maxPages` pages) ; la résolution
 * baisse jusqu'à ce que tout tienne.
 */
export function buildAtlas(requests: SpriteRequest[], size: number, maxPpm: number, normalStrength: number, maxPages = 1): Atlas {
  const unique = [...new Map(requests.map((r) => [r.key, r])).values()];
  let ppm = maxPpm;
  const layout = (p: number): Placed[] | null => {
    const items = unique
      .map((r) => ({ r, w: Math.ceil(r.wm * p) + 2 * PAD, h: Math.ceil(r.hm * p) + 2 * PAD }))
      .sort((a, b) => b.h - a.h || b.w - a.w);
    const placed: Placed[] = [];
    let page = 0, x = 0, y = 0, rowH = 0;
    for (const it of items) {
      if (x + it.w > size) {
        x = 0;
        y += rowH;
        rowH = 0;
      }
      if (y + it.h > size) {
        page++;
        x = 0;
        y = 0;
        rowH = 0;
      }
      if (page >= maxPages || it.w > size || it.h > size) return null;
      placed.push({ r: it.r, page, x, y, w: it.w, h: it.h });
      x += it.w;
      rowH = Math.max(rowH, it.h);
    }
    return placed;
  };
  let placed = layout(ppm);
  while (!placed && ppm > 8) {
    ppm *= 0.94;
    placed = layout(ppm);
  }
  if (!placed) throw new Error("atlas : rien ne tient");

  const pageCount = Math.max(...placed.map((p) => p.page)) + 1;
  const canvases = Array.from({ length: pageCount }, () => new Paint(size, size));
  const rects = new Map<string, SpriteRect>();
  let used = 0;
  for (const p of placed) {
    const w = p.w - 2 * PAD, h = p.h - 2 * PAD;
    const sprite = new Paint(w, h);
    p.r.draw(sprite, ppm);
    const page = canvases[p.page]!;
    page.c.drawImage(sprite.color, p.x + PAD, p.y + PAD);
    page.h.drawImage(sprite.height, p.x + PAD, p.y + PAD);
    rects.set(p.r.key, {
      page: p.page,
      u0: (p.x + PAD) / size, u1: (p.x + PAD + w) / size,
      v0: 1 - (p.y + PAD + h) / size, v1: 1 - (p.y + PAD) / size,
      wm: p.r.wm, hm: p.r.hm,
    });
    used += p.w * p.h;
  }
  return {
    pages: canvases.map((c) => ({
      map: canvasTexture(c.color, { srgb: true }),
      normalMap: canvasTexture(c.normalCanvas(normalStrength), { srgb: false }),
    })),
    rects, ppm, size, fill: used / (size * size * pageCount),
  };
}
