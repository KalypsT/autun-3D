import * as THREE from "three";
import { canvasTexture } from "./canvas";

const W = 256, H = 40, COLS = 8, ROWS = 24;

export interface SignRect {
  u0: number;
  v0: number;
  u1: number;
  v1: number;
}

/** Atlas de noms de commerces : une case de 256 × 40 px par nom, recyclée en anneau quand il est plein. */
export class SignAtlas {
  readonly canvas = document.createElement("canvas");
  readonly texture: THREE.CanvasTexture;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly slots = new Map<string, number>();
  private readonly owner: (string | null)[] = new Array<string | null>(COLS * ROWS).fill(null);
  private next = 0;
  private dirty = false;

  constructor() {
    this.canvas.width = W * COLS;
    this.canvas.height = H * ROWS;
    this.ctx = this.canvas.getContext("2d")!;
    this.texture = canvasTexture(this.canvas, { srgb: true });
  }

  /** Rectangle de texture du nom (dessiné à la première demande), en lettres de la couleur donnée ; `script` : italique à empattements (enseigne peinte, D141). */
  get(text: string, color: string, script = false): SignRect {
    const key = `${text}|${color}${script ? "|script" : ""}`;
    let slot = this.slots.get(key);
    if (slot === undefined) {
      slot = this.next;
      this.next = (this.next + 1) % (COLS * ROWS);
      const old = this.owner[slot];
      if (old) this.slots.delete(old);
      this.owner[slot] = key;
      this.slots.set(key, slot);
      this.draw(slot, text, color, script);
    }
    const col = slot % COLS, row = Math.floor(slot / COLS);
    const cw = W * COLS, ch = H * ROWS;
    return { u0: (col * W) / cw, u1: ((col + 1) * W) / cw, v0: 1 - ((row + 1) * H) / ch, v1: 1 - (row * H) / ch };
  }

  private draw(slot: number, text: string, color: string, script: boolean): void {
    const x = (slot % COLS) * W, y = Math.floor(slot / COLS) * H;
    const g = this.ctx;
    g.clearRect(x, y, W, H);
    g.fillStyle = color;
    g.textAlign = "center";
    g.textBaseline = "middle";
    let size = H * 0.82;
    const font = (px: number): string => (script ? `italic 700 ${px}px Georgia, "Times New Roman", serif` : `700 ${px}px "Trebuchet MS", system-ui, sans-serif`);
    g.font = font(size);
    while (g.measureText(text).width > W * 0.94 && size > 9) {
      size -= 1;
      g.font = font(size);
    }
    g.fillText(text, x + W / 2, y + H / 2 + 1);
    this.dirty = true;
  }

  /** Envoie la texture au GPU si une case a changé. */
  flush(): void {
    if (this.dirty) {
      this.texture.needsUpdate = true;
      this.dirty = false;
    }
  }
}
