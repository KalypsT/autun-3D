import type * as THREE from "three";
import type { WorldData } from "../data/types";

/** Ce que le jeu et le viewer partagent : rendu, scène, soleil et données du monde. */
export interface GameContext {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  sky: THREE.Mesh;
  sunLight: THREE.DirectionalLight;
  /** Direction vers le soleil dans le repère three. */
  sunDir: THREE.Vector3;
  world: WorldData;
  params: URLSearchParams;
  debugEl: HTMLElement;
  /** Appelé quand le monde est prêt à être affiché (retire l'écran de chargement, signale aux captures). */
  ready: (extra?: object) => void;
}
