import type { Recipe } from "../../core/character";
import { bodyDims, type BodyDims } from "../../core/character";
import { PART_SPECS, partMask } from "../../core/character-kit";
import { gunPose } from "../../core/character-attack";
import { BONE, BONE_COUNT, chestPose, collapsePose, createPose, geometryScales, getupPose, GUN_POSE, HIT_BLEND, hitPose, kneelPose, LIFE_POSE, lyingVariant, phonePose, pointPose, handsPose, sitPose, talkPose, restOffsets, solveBones, walkPose, type Pose, type Root } from "../../core/character-rig";
import { attackPose, guardPose } from "../../core/character-attack";
import { slotColors } from "../character-parts";
import type { CrowdState } from "./crowd-types";

/** Ce que chaque approche calcule une fois par personnage (corps, couleurs, pièces) et le calcul de pose partagé. */
export class CrowdRigs {
  readonly dims: BodyDims[];
  readonly offsets: Float32Array[];
  readonly scales: Float32Array[];
  readonly colors: Float32Array[];
  readonly masks: Float32Array[];
  /** Indices (dans PART_SPECS) des pièces visibles de chaque personnage. */
  readonly parts: Int16Array[];
  /** Matrices de rendu des os du dernier personnage résolu (13 × 16), et matrices monde sans échelle. */
  readonly render = new Float32Array(BONE_COUNT * 16);
  readonly world = new Float32Array(BONE_COUNT * 16);
  readonly pose: Pose = createPose();
  /** Pose d'avant un choc, d'où part le fondu (D209). */
  private readonly from: Pose = createPose();
  private readonly root = { x: 0, y: 0, z: 0, yaw: 0 };

  constructor(recipes: Recipe[]) {
    this.dims = recipes.map((r) => bodyDims(r));
    this.offsets = this.dims.map((d) => restOffsets(d));
    this.scales = this.dims.map((d) => geometryScales(d));
    this.colors = recipes.map((r) => slotColors(r));
    this.masks = recipes.map((r) => Float32Array.from(partMask(r) as number[]));
    this.parts = recipes.map((r) => {
      const list: number[] = [];
      PART_SPECS.forEach((s, i) => {
        if (s.when(r)) list.push(i);
      });
      return Int16Array.from(list);
    });
  }

  /**
   * Habille l'emplacement i d'une nouvelle recette (un passant naît dans un emplacement libre). Réutilise les tableaux de l'emplacement :
   * seules la recette et les listes de pièces sont refaites.
   */
  assign(i: number, r: Recipe): void {
    const d = bodyDims(r);
    this.dims[i] = d;
    restOffsets(d, this.offsets[i]);
    geometryScales(d, this.scales[i]);
    slotColors(r, this.colors[i]);
    partMask(r, this.masks[i]);
    const list: number[] = [];
    PART_SPECS.forEach((s, k) => {
      if (s.when(r)) list.push(k);
    });
    this.parts[i] = Int16Array.from(list);
  }

  /** Matrices d'os du personnage i pour une pose et une racine données (dans `render` et `world`). */
  solveWith(i: number, pose: Pose, root: Root): void {
    solveBones(this.render, this.world, this.offsets[i]!, this.scales[i]!, pose, root);
  }

  /** Pose de marche du personnage i, puis matrices d'os (dans `render` et `world`). */
  solve(state: CrowdState, i: number): void {
    const hit = state.pose?.[i] ?? 0;
    if (hit === GUN_POSE.aim || hit === GUN_POSE.ready) {
      // Armé (J5-5) : la marche, puis le pistolet en main : visée (la secousse du dernier tir suit `poseT`, secondes depuis le tir) ou pistolet bas.
      walkPose(this.pose, state.phase[i]!, state.speed[i]!, this.dims[i]!);
      gunPose(this.pose, "pistol", hit === GUN_POSE.aim ? 1 : 0, hit === GUN_POSE.aim ? Math.max(0, 1 - state.poseT![i]! / 0.18) : 0);
    } else if (hit === LIFE_POSE.sit) sitPose(this.pose, state.poseT![i]!, this.dims[i]!);
    else if (hit === LIFE_POSE.phone || hit === LIFE_POSE.talk || hit === LIFE_POSE.point || hit === LIFE_POSE.hands) {
      walkPose(this.pose, state.phase[i]!, state.speed[i]!, this.dims[i]!);
      if (hit === LIFE_POSE.phone) phonePose(this.pose);
      else if (hit === LIFE_POSE.point) pointPose(this.pose, state.poseT![i]!);
      else if (hit === LIFE_POSE.hands) handsPose(this.pose);
      else talkPose(this.pose, state.poseT![i]!);
    } else if (hit === LIFE_POSE.chest) {
      walkPose(this.pose, state.phase[i]!, state.speed[i]!, this.dims[i]!);
      chestPose(this.pose);
    } else if (hit === LIFE_POSE.collapse) collapsePose(this.pose, state.poseT![i]!, this.dims[i]!, lyingVariant(i));
    else if (hit === LIFE_POSE.getup) getupPose(this.pose, state.poseT![i]!, this.dims[i]!, lyingVariant(i));
    else if (hit === LIFE_POSE.kneel) kneelPose(this.pose, this.dims[i]!);
    else if (hit === LIFE_POSE.fists) {
      // Bagarre (phase 4) : garde levée, un coup de poing toutes les 1,1 s environ, d'un bras puis de l'autre (décalé d'un passant à l'autre).
      walkPose(this.pose, state.phase[i]!, state.speed[i]!, this.dims[i]!);
      const t = state.poseT![i]! + (i % 7) * 0.13, k = Math.floor(t / 1.1), u = (t - k * 1.1) / 0.55;
      guardPose(this.pose, "punch");
      if (u < 1) attackPose(this.pose, "punch", u, 0.5, k % 2 ? -1 : 1);
      else {
        // Entre deux coups, les deux poings en garde devant le visage.
        const a = this.pose.angles;
        a[BONE.armL * 3] = 0.6;
        a[BONE.armL * 3 + 2] = -0.1;
        a[BONE.forearmL * 3] = 1.5;
      }
    } else if (hit > 0) {
      // D209 : fondu depuis la marche d'avant le choc (sa phase est figée pendant le choc), puis la pose au sol de ce passant.
      const t = state.poseT![i]!;
      const from = t < HIT_BLEND ? this.from : null;
      if (from) walkPose(from, state.phase[i]!, state.poseV?.[i] ?? 0, this.dims[i]!);
      const side = state.poseSide![i]!;
      // D211 : un trébuchement suit la poussée (direction, intensité) et fait ses pas de rattrapage depuis la phase de marche figée au choc.
      hitPose(
        this.pose, hit, t, side, this.dims[i]!, from, state.poseVar?.[i] ?? lyingVariant(i),
        state.poseDir?.[i] ?? (side > 0 ? Math.PI : 0), state.poseAmp?.[i] ?? 2, state.phase[i]!,
      );
    }
    else walkPose(this.pose, state.phase[i]!, state.speed[i]!, this.dims[i]!);
    const look = state.look?.[i] ?? 0;
    if (look !== 0) this.pose.angles[BONE.head * 3 + 1]! += look;
    const r = this.root;
    r.x = state.x[i]!;
    r.y = state.y[i]!;
    r.z = state.z[i]!;
    r.yaw = state.yaw[i]!;
    solveBones(this.render, this.world, this.offsets[i]!, this.scales[i]!, this.pose, r);
  }
}
