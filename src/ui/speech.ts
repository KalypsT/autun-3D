import * as THREE from "three";

/** Où dessiner une bulle : un point du monde (repère du jeu, z = altitude du haut de la tête), ou null si la personne n'est plus là. */
export type SpeechAnchor = () => { x: number; y: number; z: number } | null;

interface Bubble {
  key: number;
  el: HTMLDivElement;
  text: string;
  life: number;
  at: SpeechAnchor;
  shown: boolean;
}

/** Bulles affichées à la fois au plus (la plus ancienne cède sa place). */
const MAX_BUBBLES = 2;
/** Marge (px) au bord de l'écran pour une bulle hors champ. */
const EDGE = 54;

/**
 * Bulles de parole (phase 4, événements) : « Au voleur ! » au-dessus de la tête de la victime, style « affiche » (fond crème, liseré et ombre encre,
 * italique grasse). Hors champ, la bulle se range au bord de l'écran du côté de la scène, avec une flèche : on sait où tourner la tête.
 * Le DOM n'est touché qu'aux changements de texte ; la position est réécrite à chaque image (deux éléments au plus).
 */
export class SpeechBubbles {
  private readonly list: Bubble[] = [];
  private readonly v = new THREE.Vector3();

  constructor(private readonly root: HTMLElement) {}

  /** La personne `key` dit `text` pendant `seconds` s (remplace ce qu'elle disait). */
  say(key: number, text: string, seconds: number, at: SpeechAnchor): void {
    let b = this.list.find((q) => q.key === key);
    if (!b) {
      if (this.list.length >= MAX_BUBBLES) this.drop(this.list[0]!);
      const el = document.createElement("div");
      el.className = "speech";
      el.setAttribute("aria-live", "polite");
      this.root.appendChild(el);
      b = { key, el, text: "", life: 0, at, shown: false };
      this.list.push(b);
    }
    b.at = at;
    b.life = seconds;
    if (b.text !== text) {
      b.text = text;
      b.el.textContent = text;
    }
  }

  private drop(b: Bubble): void {
    b.el.remove();
    this.list.splice(this.list.indexOf(b), 1);
  }

  clear(): void {
    while (this.list.length) this.drop(this.list[0]!);
  }

  /** À chaque image (pas en pause) : durée de vie, puis position à l'écran. */
  update(dt: number, camera: THREE.Camera, width: number, height: number): void {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const b = this.list[i]!;
      b.life -= dt;
      const p = b.life > 0 ? b.at() : null;
      if (!p) {
        this.drop(b);
        continue;
      }
      // Repère three : x, altitude, −y.
      const v = this.v.set(p.x, p.z + 0.35, -p.y).applyMatrix4(camera.matrixWorldInverse);
      const behind = v.z > -0.5;
      v.applyMatrix4(camera.projectionMatrix);
      let sx = (v.x * 0.5 + 0.5) * width, sy = (-v.y * 0.5 + 0.5) * height;
      if (behind) {
        // Derrière la caméra : la projection est retournée ; on la remet du bon côté et on la pousse au bord.
        sx = width - sx;
        sy = height - sy;
      }
      const inside = !behind && sx > EDGE && sx < width - EDGE && sy > EDGE && sy < height - EDGE;
      let arrow = "";
      if (!inside) {
        // Au bord, dans la direction de la scène depuis le centre de l'écran.
        const cx = width / 2, cy = height / 2;
        let dx = sx - cx, dy = sy - cy;
        if (behind && Math.abs(dx) < 1 && Math.abs(dy) < 1) dx = 1;
        const k = Math.min((cx - EDGE) / Math.max(Math.abs(dx), 1e-3), (cy - EDGE) / Math.max(Math.abs(dy), 1e-3));
        if (k < 1 || behind) {
          dx *= Math.min(k, behind ? k : 1);
          dy *= Math.min(k, behind ? k : 1);
        }
        sx = cx + dx;
        sy = cy + dy;
        arrow = Math.abs(dx) * height > Math.abs(dy) * width ? (dx < 0 ? "◀ " : " ▶") : dy < 0 ? "▲ " : "▼ ";
      }
      const text = arrow === " ▶" ? `${b.text}${arrow}` : `${arrow}${b.text}`;
      if (b.el.textContent !== text) b.el.textContent = text;
      b.el.classList.toggle("edge", !inside);
      b.el.style.left = `${Math.round(sx)}px`;
      b.el.style.top = `${Math.round(sy)}px`;
      if (!b.shown) {
        b.shown = true;
        b.el.classList.add("show");
      }
    }
  }
}
