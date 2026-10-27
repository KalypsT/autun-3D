import * as THREE from "three";
import type { Recipe } from "../core/character";
import { createPlayerModel, type PlayerModel } from "./player-model";

/**
 * Aperçu du personnage dans l'écran « Apparence » : une petite scène (le personnage sur un socle, lumière de l'affiche) dessinée
 * avec le moteur du jeu dans un coin de son canevas, puis copiée dans un canevas 2D de la page. Pas de second contexte WebGL
 * (coûteux en mémoire sur téléphone) : pendant la pause, le menu couvre l'écran et le jeu n'y dessine plus.
 * Le dessin se fait à la demande (changement d'apparence, rotation au doigt), jamais en boucle.
 */

/** Taille de l'aperçu à l'écran (pixels CSS). */
export const PREVIEW_SIZE = { width: 190, height: 236 } as const;
const BACKGROUND = "#efdcb4";

export class AppearancePreview {
  /** Canevas 2D à insérer dans la page. */
  readonly canvas = document.createElement("canvas");
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(28, PREVIEW_SIZE.width / PREVIEW_SIZE.height, 0.5, 20);
  private model: PlayerModel;
  /** Cap du personnage : de trois quarts face à la caméra au départ (son visage regarde vers −z, la caméra est du côté +z). */
  private yaw = -(Math.PI - 0.5);
  private pending = false;
  private readonly saved = { viewport: new THREE.Vector4(), scissor: new THREE.Vector4(), color: new THREE.Color() };

  constructor(private readonly renderer: THREE.WebGLRenderer, recipe: Recipe) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.round(PREVIEW_SIZE.width * dpr);
    this.canvas.height = Math.round(PREVIEW_SIZE.height * dpr);
    this.canvas.style.cssText = `width:${PREVIEW_SIZE.width}px;height:${PREVIEW_SIZE.height}px;border-radius:12px;touch-action:none;`;
    this.scene.background = new THREE.Color(BACKGROUND);
    const sun = new THREE.DirectionalLight("#ffe2b0", 3);
    sun.position.set(-1.5, 2.5, 2.5);
    const sky = new THREE.HemisphereLight("#8fc3c4", "#c0603a", 1.3);
    this.scene.add(sun, sky);
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.85, 0.06, 28), new THREE.MeshLambertMaterial({ color: "#d6b98a" }));
    base.position.y = -0.03;
    this.scene.add(base);
    this.camera.position.set(0, 1.0, 5.0);
    this.camera.lookAt(0, 0.93, 0);
    this.model = createPlayerModel(recipe);
    this.scene.add(this.model.group);
    this.pose();
  }

  private pose(): void {
    this.model.update(0, 0, 0, this.yaw, 0, 0);
  }

  /** Nouvelle apparence : le personnage est refait et l'aperçu redessiné. */
  show(recipe: Recipe): void {
    this.model.setRecipe(recipe);
    this.pose();
    this.draw();
  }

  /** Tourne le personnage (rad). */
  rotate(radians: number): void {
    this.yaw += radians;
    this.pose();
    this.draw();
  }

  /** Dessine au prochain affichage (plusieurs demandes d'une même image n'en font qu'un). */
  draw(): void {
    if (this.pending) return;
    this.pending = true;
    requestAnimationFrame(() => {
      this.pending = false;
      this.render();
    });
  }

  private render(): void {
    const r = this.renderer;
    const gl = r.domElement;
    const pr = r.getPixelRatio();
    const w = Math.min(PREVIEW_SIZE.width, Math.floor(gl.width / pr)), h = Math.min(PREVIEW_SIZE.height, Math.floor(gl.height / pr));
    if (w < 10 || h < 10) return;
    r.getViewport(this.saved.viewport);
    r.getScissor(this.saved.scissor);
    const scissorTest = r.getScissorTest();
    r.getClearColor(this.saved.color);
    const alpha = r.getClearAlpha();
    const shadows = r.shadowMap.enabled;
    r.shadowMap.enabled = false;
    r.setViewport(0, 0, w, h);
    r.setScissor(0, 0, w, h);
    r.setScissorTest(true);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    r.render(this.scene, this.camera);
    // Même tâche que le dessin : le tampon est encore valide. L'origine de WebGL est en bas à gauche.
    const sw = Math.round(w * pr), sh = Math.round(h * pr);
    const ctx = this.canvas.getContext("2d");
    ctx?.drawImage(gl, 0, gl.height - sh, sw, sh, 0, 0, this.canvas.width, this.canvas.height);
    r.shadowMap.enabled = shadows;
    r.setScissorTest(scissorTest);
    r.setScissor(this.saved.scissor);
    r.setViewport(this.saved.viewport);
    r.setClearColor(this.saved.color, alpha);
  }

  dispose(): void {
    this.model.dispose();
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && m !== this.model.group.children[0]) {
        m.geometry.dispose();
        (m.material as THREE.Material).dispose();
      }
    });
  }
}
