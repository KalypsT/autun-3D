import type { MeshBuilder } from "./geometry";

/**
 * Rideaux de fer de la tuile en cours de construction (D200) : les vitrines (`stylized.ts`, `devanture.ts`) y dessinent le rideau baissé,
 * étiqueté par l'horaire du commerce (l'étiquette courante de la cible). Une seule tuile se construit à la fois.
 */
let target: MeshBuilder | null = null;

export function setShutterTarget(mb: MeshBuilder | null): void {
  target = mb;
}

export function shutterTarget(): MeshBuilder | null {
  return target;
}
