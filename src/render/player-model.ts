import * as THREE from "three";
import { DEFAULT_RECIPE, type Recipe } from "../core/character";
import { createPose, cycleLength, walkPose, type Pose } from "../core/character-rig";
import { solveRide, type V3 } from "../core/character-pose";
import { CharacterBatch } from "./crowd/character-batch";
import { CrowdRigs } from "./crowd/crowd-common";
import type { VehicleModel } from "./vehicle-model";

/**
 * Le joueur : un personnage de la même fabrique que les passants (recette, catalogue de pièces, un seul appel de dessin, D37),
 * à pied (marche, course) ou sur un véhicule (pédalage, assis, debout). `group` se place dans la scène (à pied) ou dans le repère
 * du véhicule (au volant) : les matrices d'os sont toujours exprimées dans le repère du groupe.
 */
export interface PlayerModel {
  group: THREE.Group;
  /** À pied : place et anime le personnage (position en repère données, cap, phase de pas du joueur, vitesse). */
  update(x: number, y: number, z: number, heading: number, stride: number, speed: number): void;
  /** Sur un véhicule : pose selon `vehicle.pose` (pédalage au rythme de `crank`, assis, debout), mains et pieds sur les appuis du véhicule. */
  ride(vehicle: VehicleModel, crank: number): void;
  /** Change d'apparence. */
  setRecipe(recipe: Recipe): void;
  dispose(): void;
}

/** Le joueur compte la distance parcourue par 2,2 rad par mètre ; la phase de marche, 2π par foulée complète. */
const STRIDE_PER_METRE = 2.2;

export function createPlayerModel(recipe: Recipe = DEFAULT_RECIPE): PlayerModel {
  const group = new THREE.Group();
  const batch = new CharacterBatch(0, 1);
  batch.mesh.castShadow = true;
  group.add(batch.mesh);
  let rigs = new CrowdRigs([recipe]);
  const pose: Pose = createPose();
  const root = { x: 0, y: 0, z: 0, yaw: 0 };
  let phase = 0;
  let lastStride: number | null = null;

  const publish = (): void => {
    batch.clear();
    batch.push(rigs.render, rigs.colors[0]!, rigs.masks[0]!);
    batch.flush();
  };

  // Appuis du véhicule, exprimés dans son propre repère.
  const inverse = new THREE.Matrix4();
  const p = new THREE.Vector3();
  const local = (object: THREE.Object3D): V3 => {
    p.setFromMatrixPosition(object.matrixWorld).applyMatrix4(inverse);
    return [p.x, p.y, p.z];
  };

  return {
    group,
    update(x, y, z, heading, stride, speed) {
      group.position.set(x, z, -y);
      group.rotation.set(0, -heading, 0);
      const d = rigs.dims[0]!;
      const v = Math.abs(speed);
      if (lastStride !== null && v > 0.02) {
        const metres = (stride - lastStride) / STRIDE_PER_METRE;
        // Une téléportation ou un arrêt brutal ne doit pas faire sauter la phase.
        if (metres > 0 && metres < 2) phase = (phase + (metres * Math.PI * 2) / cycleLength(v, d.height)) % (Math.PI * 2);
      }
      lastStride = stride;
      walkPose(pose, phase, v, d);
      rigs.solveWith(0, pose, root);
      publish();
    },
    ride(vehicle, crank) {
      const anchors = vehicle.anchors;
      if (!anchors || vehicle.pose === "hidden") return;
      lastStride = null;
      group.position.set(0, 0, 0);
      group.rotation.set(0, 0, 0);
      vehicle.setCrank?.(crank);
      vehicle.group.updateMatrixWorld(true);
      inverse.copy(vehicle.group.matrixWorld).invert();
      const seat: V3 = [vehicle.seat.x, vehicle.seat.y, vehicle.seat.z];
      solveRide(
        rigs.render, rigs.world, rigs.offsets[0]!, rigs.scales[0]!, rigs.dims[0]!, vehicle.pose,
        { seat, grips: [local(anchors.gripL), local(anchors.gripR)], feet: [local(anchors.footL), local(anchors.footR)] }, pose,
      );
      publish();
    },
    setRecipe(next) {
      rigs = new CrowdRigs([next]);
    },
    dispose() {
      batch.dispose();
    },
  };
}

