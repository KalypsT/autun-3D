import { gaugeFraction, GAUGE_REDLINE, kmh } from "../core/speedo";

/** Compteur de vitesse, petit cadran accolé à la minimap (`#speedo`, D104) : chiffres et arc. Il ne touche au DOM que quand une valeur change. */
export class Speedo {
  private readonly value: HTMLElement;
  private readonly arc: SVGPathElement;
  private shown = -1;
  private fill = -1;
  private red = false;
  private hurt = false;

  constructor(private readonly el: HTMLElement) {
    this.value = el.querySelector<HTMLElement>("#speedo-value")!;
    this.arc = el.querySelector<SVGPathElement>("#speedo-arc")!;
  }

  /** Vitesse du véhicule (m/s) et sa vitesse maximale (m/s). */
  set(speed: number, topSpeed: number): void {
    const v = kmh(speed);
    if (v !== this.shown) {
      this.shown = v;
      this.value.textContent = String(v);
    }
    // Longueur de trait en centièmes de l'arc (`pathLength="100"`), au centième près.
    const f = gaugeFraction(speed, topSpeed);
    const fill = Math.round(f * 100);
    if (fill !== this.fill) {
      this.fill = fill;
      this.arc.style.strokeDasharray = `${fill} 100`;
    }
    const red = f >= GAUGE_REDLINE;
    if (red !== this.red) {
      this.red = red;
      this.arc.classList.toggle("red", red);
    }
  }

  /** Véhicule très abîmé (D109 : sous 30 % de santé, fumée noire, feu) : le cadran se cercle de rouge brique et bat lentement. */
  setHurt(hurt: boolean): void {
    if (hurt === this.hurt) return;
    this.hurt = hurt;
    this.el.classList.toggle("hurt", hurt);
  }
}
