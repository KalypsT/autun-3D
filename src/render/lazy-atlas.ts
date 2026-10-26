import * as THREE from "three";
import type { SpriteRect, SpriteRequest } from "./atlas";
import { canvasTexture, Paint } from "./paint";

const PAD = 3;

interface Page {
  color: HTMLCanvasElement;
  normal: HTMLCanvasElement;
  map: THREE.CanvasTexture;
  normalMap: THREE.CanvasTexture;
  dirty: boolean;
  /** Dernier usage (horloge de l'atlas), pour recycler la page la plus ancienne. */
  lastUse: number;
  /** Prochaine position libre (étagères). */
  x: number;
  y: number;
  rowH: number;
}

/**
 * Atlas de sprites rempli à la demande : un sprite est dessiné la première fois qu'une tuile en a besoin,
 * à résolution fixe, puis partagé par toutes les tuiles. Les pages sont ajoutées au fur et à mesure (jusqu'à `maxPages`).
 */
export class LazyAtlas {
  readonly rects = new Map<string, SpriteRect>();
  readonly pages: Page[] = [];
  /** Appelé quand une page est créée (le matériau correspondant se crée alors). */
  onPage: ((index: number, page: Page) => void) | null = null;
  missed = 0;
  private clock = 0;

  constructor(
    readonly size: number,
    readonly ppm: number,
    private readonly normalStrength: number,
    private readonly maxPages: number,
  ) {}

  private newPage(): Page | null {
    if (this.pages.length >= this.maxPages) return null;
    const color = document.createElement("canvas");
    const normal = document.createElement("canvas");
    color.width = color.height = normal.width = normal.height = this.size;
    const n = normal.getContext("2d")!;
    n.fillStyle = "rgb(128,128,255)";
    n.fillRect(0, 0, this.size, this.size);
    const page: Page = {
      color, normal,
      map: canvasTexture(color, { srgb: true }),
      normalMap: canvasTexture(normal, { srgb: false }),
      dirty: false, lastUse: ++this.clock, x: 0, y: 0, rowH: 0,
    };
    this.pages.push(page);
    this.onPage?.(this.pages.length - 1, page);
    return page;
  }

  /** Rectangle du sprite, dessiné au besoin ; null si les pages sont pleines. */
  get(req: SpriteRequest): SpriteRect | null {
    const known = this.rects.get(req.key);
    if (known) {
      this.pages[known.page]!.lastUse = ++this.clock;
      return known;
    }
    const w = Math.ceil(req.wm * this.ppm) + 2 * PAD, h = Math.ceil(req.hm * this.ppm) + 2 * PAD;
    if (w > this.size || h > this.size) return null;
    const fit = (p: Page): boolean => {
      if (p.x + w > this.size) {
        p.x = 0;
        p.y += p.rowH;
        p.rowH = 0;
      }
      return p.y + h <= this.size;
    };
    let page: Page | null | undefined = [...this.pages].reverse().find(fit);
    if (!page) {
      page = this.newPage();
      if (page && !fit(page)) page = null;
    }
    if (!page) {
      this.missed++;
      return null;
    }
    const iw = w - 2 * PAD, ih = h - 2 * PAD;
    const sprite = new Paint(iw, ih);
    req.draw(sprite, this.ppm);
    page.color.getContext("2d")!.drawImage(sprite.color, page.x + PAD, page.y + PAD);
    page.normal.getContext("2d")!.drawImage(sprite.normalCanvas(this.normalStrength), page.x + PAD, page.y + PAD);
    const rect: SpriteRect = {
      page: this.pages.indexOf(page),
      u0: (page.x + PAD) / this.size, u1: (page.x + PAD + iw) / this.size,
      v0: 1 - (page.y + PAD + ih) / this.size, v1: 1 - (page.y + PAD) / this.size,
      wm: req.wm, hm: req.hm,
    };
    page.x += w;
    page.rowH = Math.max(page.rowH, h);
    page.dirty = true;
    page.lastUse = ++this.clock;
    this.rects.set(req.key, rect);
    return rect;
  }

  /** Vide la page la moins récemment utilisée (ses sprites seront redessinés à la demande) ; renvoie son indice. */
  recycle(): number {
    let idx = 0;
    this.pages.forEach((p, i) => { if (p.lastUse < this.pages[idx]!.lastUse) idx = i; });
    const page = this.pages[idx]!;
    for (const [key, r] of this.rects) if (r.page === idx) this.rects.delete(key);
    page.color.getContext("2d")!.clearRect(0, 0, this.size, this.size);
    const n = page.normal.getContext("2d")!;
    n.fillStyle = "rgb(128,128,255)";
    n.fillRect(0, 0, this.size, this.size);
    page.x = page.y = page.rowH = 0;
    page.dirty = true;
    page.lastUse = ++this.clock;
    return idx;
  }

  /** Envoie au GPU les pages modifiées. */
  flush(): void {
    for (const p of this.pages) {
      if (!p.dirty) continue;
      p.map.needsUpdate = true;
      p.normalMap.needsUpdate = true;
      p.dirty = false;
    }
  }

  get stats(): { pages: number; size: number; ppm: number; sprites: number; missed: number } {
    return { pages: this.pages.length, size: this.size, ppm: this.ppm, sprites: this.rects.size, missed: this.missed };
  }
}
