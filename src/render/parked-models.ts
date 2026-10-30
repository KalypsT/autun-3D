import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { createVehicle } from "../core/vehicle";
import type { VehicleModel } from "./vehicle-model";

/**
 * Véhicules garés (D56) : une géométrie « au repos » par modèle (peinture en blanc), un seul maillage instancié par modèle présent, quel que
 * soit le nombre d'exemplaires et la famille. Analogie : un tampon par modèle, pas un dessin à la main par véhicule.
 *
 * Tous les sommets d'un modèle ont leur couleur propre (pneus, verre, chrome…), sauf la peinture, en blanc pur : le nuanceur teinte (par la couleur de
 * l'instance) seulement les sommets blancs et laisse les autres tels quels. Un véhicule qu'on enfourche reçoit, lui, son modèle articulé (`take`).
 */

/**
 * Teinte par instance des seuls sommets de peinture (blanc pur) : le reste garde sa couleur. Le nuanceur reçu ici n'a pas encore ses `#include`
 * dépliés : on remplace l'inclusion du bloc de couleur par ce bloc modifié (D116 ; avant, le remplacement ne trouvait rien et tout était teint,
 * jantes, feux et vitres compris).
 */
export function tintPaintOnly(material: THREE.MeshLambertMaterial): THREE.MeshLambertMaterial {
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader.replace(
      "#include <color_vertex>",
      THREE.ShaderChunk.color_vertex.replace(
        "vColor.rgb *= instanceColor.rgb;",
        "vColor.rgb *= mix( vec3( 1.0 ), instanceColor.rgb, step( 0.999, min( color.r, min( color.g, color.b ) ) ) );",
      ),
    );
  };
  // Un programme propre : l'ajout ci-dessus ne doit pas être partagé avec un autre matériau Lambert.
  material.customProgramCacheKey = () => "paint-tint";
  return material;
}

const flat = { heightAt: () => 0, xMin: -10, xMax: 10, yMin: -10, yMax: 10 };

/**
 * Géométrie au repos d'un modèle articulé construit en blanc : toutes ses pièces dans le repère du véhicule (guidon droit, roues à l'arrêt, pas de roulis),
 * fusionnées. Le modèle est libéré ensuite ; les géométries partagées (roues) restent à leur propriétaire.
 */
export function bakeRest(model: VehicleModel): THREE.BufferGeometry {
  model.update(createVehicle(0, 0, 0, flat));
  model.group.updateMatrixWorld(true);
  const parts: THREE.BufferGeometry[] = [];
  model.group.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    parts.push(mesh.geometry.clone().applyMatrix4(mesh.matrixWorld));
  });
  const merged = mergeGeometries(parts);
  for (const p of parts) p.dispose();
  model.dispose();
  if (!merged) throw new Error("modèle sans pièces");
  return merged;
}

interface Slot {
  mesh: THREE.InstancedMesh;
  n: number;
}

export interface ParkedItem {
  model: string;
  x: number;
  y: number;
  z: number;
  heading: number;
  pitch: number;
  /** Inclinaison (rad, positive à droite) : un deux-roues tombé est couché (D98). */
  lean?: number;
  color: string;
}

export class ParkedModels {
  readonly group = new THREE.Group();
  private readonly slots = new Map<string, Slot>();
  private readonly material = tintPaintOnly(new THREE.MeshLambertMaterial({ vertexColors: true }));
  private readonly matrix = new THREE.Matrix4();
  private readonly color = new THREE.Color();
  private readonly euler = new THREE.Euler(0, 0, 0, "YXZ");
  private readonly quat = new THREE.Quaternion();
  private readonly pos = new THREE.Vector3();
  private readonly one = new THREE.Vector3(1, 1, 1);

  /** `capacity` : nombre maximal d'exemplaires d'un même modèle ; `restGeometry` : géométrie au repos d'un modèle (peinture blanche), demandée une fois par modèle présent. */
  constructor(readonly capacity: number, private readonly restGeometry: (model: string) => THREE.BufferGeometry) {}

  private slot(id: string): Slot {
    let s = this.slots.get(id);
    if (s) return s;
    const mesh = new THREE.InstancedMesh(this.restGeometry(id), this.material, this.capacity);
    mesh.count = 0;
    mesh.visible = false;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    // Les instances changent souvent et couvrent toute la zone : pas de tri par la caméra.
    mesh.frustumCulled = false;
    this.group.add(mesh);
    s = { mesh, n: 0 };
    this.slots.set(id, s);
    return s;
  }

  /**
   * Fabrique d'avance les maillages de ces modèles (cachés, sans coût de dessin) : la géométrie au repos d'un modèle coûte quelques millisecondes,
   * mieux vaut les payer au chargement que dans une image, quand un modèle entre pour la première fois dans le champ.
   */
  prepare(models: readonly string[]): void {
    for (const id of models) this.slot(id);
  }

  /** Réécrit les instances : une par véhicule garé visible (modèle, position au sol, cap, tangage, couleur). */
  set(items: readonly ParkedItem[]): void {
    for (const s of this.slots.values()) s.n = 0;
    for (const c of items) {
      const s = this.slot(c.model);
      if (s.n >= this.capacity) continue;
      this.euler.set(c.pitch, -c.heading, -(c.lean ?? 0));
      this.quat.setFromEuler(this.euler);
      this.matrix.compose(this.pos.set(c.x, c.z, -c.y), this.quat, this.one);
      s.mesh.setMatrixAt(s.n, this.matrix);
      s.mesh.setColorAt(s.n, this.color.set(c.color));
      s.n++;
    }
    for (const s of this.slots.values()) {
      s.mesh.count = s.n;
      s.mesh.visible = s.n > 0;
      s.mesh.instanceMatrix.needsUpdate = true;
      if (s.mesh.instanceColor) s.mesh.instanceColor.needsUpdate = true;
    }
  }

  /** Nombre de maillages dessinés (un par modèle présent), pour la mesure. */
  get drawn(): number {
    let n = 0;
    for (const s of this.slots.values()) if (s.n > 0) n++;
    return n;
  }

  /** Nombre d'exemplaires dessinés. */
  get instances(): number {
    let n = 0;
    for (const s of this.slots.values()) n += s.n;
    return n;
  }
}
