import * as THREE from "three";

/** Un dessin à deux couches : couleur (RGBA) et relief (niveaux de gris, 128 = plan). */
export class Paint {
  readonly color: HTMLCanvasElement;
  readonly height: HTMLCanvasElement;
  readonly c: CanvasRenderingContext2D;
  readonly h: CanvasRenderingContext2D;

  constructor(
    readonly w: number,
    readonly hgt: number,
    opaque = false,
  ) {
    this.color = document.createElement("canvas");
    this.height = document.createElement("canvas");
    this.color.width = this.height.width = w;
    this.color.height = this.height.height = hgt;
    this.c = this.color.getContext("2d", { willReadFrequently: true })!;
    this.h = this.height.getContext("2d", { willReadFrequently: true })!;
    this.h.fillStyle = "rgb(128,128,128)";
    this.h.fillRect(0, 0, w, hgt);
    if (opaque) {
      this.c.fillStyle = "#ffffff";
      this.c.fillRect(0, 0, w, hgt);
    }
  }

  /** Dessine une forme sur les deux couches : `shape` trace le chemin, `fill` est la couleur, `relief` le niveau (0-255). */
  fill(shape: (ctx: CanvasRenderingContext2D) => void, fill: string, relief: number, rule: CanvasFillRule = "nonzero"): void {
    this.c.fillStyle = fill;
    this.c.beginPath();
    shape(this.c);
    this.c.fill(rule);
    this.h.fillStyle = `rgb(${relief},${relief},${relief})`;
    this.h.beginPath();
    shape(this.h);
    this.h.fill(rule);
  }

  rect(x: number, y: number, w: number, h: number, fill: string, relief: number): void {
    this.fill((ctx) => ctx.rect(x, y, w, h), fill, relief);
  }

  /** Couleur seule (ombres portées, reflets) sans toucher au relief. */
  tint(shape: (ctx: CanvasRenderingContext2D) => void, fill: string): void {
    this.c.fillStyle = fill;
    this.c.beginPath();
    shape(this.c);
    this.c.fill();
  }

  /** Normales (espace tangent, convention OpenGL) calculées depuis le relief. */
  normalCanvas(strength: number, wrap = false): HTMLCanvasElement {
    const src = this.h.getImageData(0, 0, this.w, this.hgt).data;
    const out = document.createElement("canvas");
    out.width = this.w;
    out.height = this.hgt;
    const octx = out.getContext("2d")!;
    const img = octx.createImageData(this.w, this.hgt);
    const at = (x: number, y: number): number => {
      if (wrap) {
        x = (x + this.w) % this.w;
        y = (y + this.hgt) % this.hgt;
      } else {
        x = Math.min(Math.max(x, 0), this.w - 1);
        y = Math.min(Math.max(y, 0), this.hgt - 1);
      }
      return src[(y * this.w + x) * 4]! / 255;
    };
    for (let y = 0; y < this.hgt; y++) {
      for (let x = 0; x < this.w; x++) {
        const dx = (at(x + 1, y) - at(x - 1, y)) * strength;
        const dy = (at(x, y + 1) - at(x, y - 1)) * strength;
        const nx = -dx, ny = dy, nz = 1;
        const l = Math.hypot(nx, ny, nz);
        const i = (y * this.w + x) * 4;
        img.data[i] = (nx / l * 0.5 + 0.5) * 255;
        img.data[i + 1] = (ny / l * 0.5 + 0.5) * 255;
        img.data[i + 2] = (nz / l * 0.5 + 0.5) * 255;
        img.data[i + 3] = 255;
      }
    }
    octx.putImageData(img, 0, 0);
    return out;
  }
}

export function canvasTexture(canvas: HTMLCanvasElement, opts: { srgb: boolean; repeat?: boolean; mipmaps?: boolean }): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = opts.srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  if (opts.repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  t.generateMipmaps = opts.mipmaps !== false;
  t.minFilter = t.generateMipmaps ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  return t;
}

/** Bruit pseudo-aléatoire déterministe (graine fixe) pour les textures procédurales. */
export function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
