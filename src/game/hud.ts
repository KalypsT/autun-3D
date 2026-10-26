import type * as THREE from "three";

/** Compteur d'images par seconde et budget de dessin pour le panneau de debug. */
export class FrameMeter {
  private frames = 0;
  private acc = 0;
  fps = 0;

  constructor(
    private readonly renderer: THREE.WebGLRenderer,
    private readonly el: HTMLElement,
    private readonly extra: () => string = () => "",
  ) {}

  tick(dt: number): void {
    this.frames++;
    this.acc += dt;
    if (this.acc < 0.5) return;
    this.fps = this.frames / this.acc;
    this.frames = 0;
    this.acc = 0;
    const i = this.renderer.info;
    this.el.textContent = `${this.fps.toFixed(0)} i/s · ${i.render.calls} appels · ${(i.render.triangles / 1000).toFixed(0)}k tri${this.extra()}`;
  }
}
