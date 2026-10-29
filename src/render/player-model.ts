import * as THREE from "three";
import { DEFAULT_RECIPE, type Recipe } from "../core/character";
import { createPose, cycleLength, HIT_POSE, hitPose, walkPose, type Pose } from "../core/character-rig";
import { attackPose, guardPose, gunPose } from "../core/character-attack";
import { setPart } from "../core/character-kit";
import type { AttackStyle, GunId } from "../core/weapons";
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
  /** Phase de marche (0 à 2π) : les pas s'entendent aux appuis (J7). */
  readonly phase: number;
  /**
   * Arme en main (J5) : pièce du kit tenue (null : les poings) et geste ; `style` null : mains nues, bras le long du corps. Le fondu vers la garde
   * suit tout seul.
   */
  setHeld(part: string | null, style: AttackStyle | null): void;
  /** Arme à feu en main (J5-3) : pièce tenue, arme (null : aucune), fondu de la garde à la visée (0 à 1) et secousse du dernier tir (0 à 1). Remplace `setHeld`. */
  setGun(part: string | null, gun: GunId | null, aim: number, recoil: number): void;
  /** Coup en cours (progression 0 à 1, moment de la frappe, poing +1 droit ou −1 gauche) ; null hors coup. À pied seulement. */
  setStrike(strike: { style: AttackStyle; u: number; hitAt: number; side: 1 | -1 } | null): void;
  /** Chute (D98, tombé d'un deux-roues) : temps depuis la chute (s) et sens (+1 sur le dos, −1 en avant), pose des passants heurtés ; null debout. */
  setDown(down: { t: number; side: number } | null): void;
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
  let held: string | null = null;
  let heldStyle: AttackStyle | null = null;
  let gun: { id: GunId; aim: number; recoil: number } | null = null;
  let strike: { style: AttackStyle; u: number; hitAt: number; side: 1 | -1 } | null = null;
  let down: { t: number; side: number } | null = null;
  const mask = new Float32Array(3);
  /** Sur un véhicule : l'arme reste dans la poche. */
  let mounted = false;

  const publish = (): void => {
    batch.clear();
    // Le masque de pièces de la recette, plus l'arme tenue.
    mask.set(rigs.masks[0]!);
    if (held && !mounted) setPart(mask, held, true);
    batch.push(rigs.render, rigs.colors[0]!, mask);
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
    get phase() {
      return phase;
    },
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
      mounted = false;
      if (down) {
        hitPose(pose, HIT_POSE.down, down.t, down.side, d);
        rigs.solveWith(0, pose, root);
        publish();
        return;
      }
      walkPose(pose, phase, v, d);
      // Arme blanche en main : garde du bras droit ; un coup en cours se joue par-dessus.
      if (heldStyle && held) guardPose(pose, heldStyle);
      if (gun && held) gunPose(pose, gun.id, gun.aim, gun.recoil);
      if (strike) attackPose(pose, strike.style, strike.u, strike.hitAt, strike.side);
      rigs.solveWith(0, pose, root);
      publish();
    },
    ride(vehicle, crank) {
      const anchors = vehicle.anchors;
      if (!anchors || vehicle.pose === "hidden") return;
      lastStride = null;
      mounted = true;
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
    setHeld(part, style) {
      held = part;
      heldStyle = style;
      gun = null;
    },
    setGun(part, id, aim, recoil) {
      held = part;
      heldStyle = null;
      gun = id ? { id, aim, recoil } : null;
    },
    setStrike(next) {
      strike = next;
    },
    setDown(next) {
      down = next;
    },
    dispose() {
      batch.dispose();
    },
  };
}

