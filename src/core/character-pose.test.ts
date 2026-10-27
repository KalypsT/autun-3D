import { describe, expect, it } from "vitest";
import { bodyDims, DEFAULT_RECIPE, recipeFromSeed, type Recipe } from "./character";
import { BONE, BONE_COUNT, createPose, geometryScales, restOffsets } from "./character-rig";
import { ballOffset, handReach, solveRide, twoBone, type RideAnchors, type RideStyle, type V3 } from "./character-pose";

const dist = (a: V3, b: V3): number => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

describe("cinématique inverse à deux segments", () => {
  it("garde les longueurs et atteint les cibles accessibles", () => {
    const bad: string[] = [];
    for (let i = 0; i < 200; i++) {
      const t: V3 = [Math.sin(i * 1.7) * 0.5, Math.cos(i * 2.3) * 0.5 - 0.1, Math.sin(i * 0.9) * 0.5];
      const c = twoBone([0, 0, 0], t, 0.4, 0.35, [0, 0, -1]);
      const reach = dist([0, 0, 0], t);
      if (Math.abs(dist([0, 0, 0], c.mid) - 0.4) > 1e-6) bad.push(`l1 ${i}`);
      if (Math.abs(dist(c.mid, c.end) - 0.35) > 1e-6) bad.push(`l2 ${i}`);
      if (reach > 0.06 && reach < 0.74 && dist(c.end, t) > 1e-6) bad.push(`cible ${i}`);
    }
    expect(bad).toEqual([]);
  });

  it("tend la chaîne vers une cible trop loin, et replie sans ruptures près de l'épaule", () => {
    const far = twoBone([0, 0, 0], [0, -2, 0], 0.4, 0.35, [0, 0, -1]);
    expect(far.end[1]).toBeLessThan(-0.7);
    expect(Math.abs(far.end[0]) + Math.abs(far.end[2])).toBeLessThan(1e-6);
    const near = twoBone([0, 0, 0], [0, -0.001, 0], 0.4, 0.35, [0, 0, -1]);
    expect(Number.isFinite(near.mid[0] + near.mid[1] + near.mid[2])).toBe(true);
  });

  it("plie le genou du côté du pôle", () => {
    const c = twoBone([0, 1, 0], [0, 0.3, 0], 0.42, 0.43, [0, 0, -1]);
    expect(c.mid[2]).toBeLessThan(-0.2);
  });
});

const BIKE: RideAnchors = { seat: [0, 0.88, 0.22], grips: [[-0.26, 1.04, -0.33], [0.26, 1.04, -0.33]], feet: [[-0.15, 0.13, 0.05], [0.15, 0.47, 0.05]] };
const MOTO: RideAnchors = { seat: [0, 0.93, 0.22], grips: [[-0.34, 1.11, -0.4], [0.34, 1.11, -0.4]], feet: [[-0.26, 0.375, 0.12], [0.26, 0.375, 0.12]] };
const SCOOTER: RideAnchors = { seat: [0, 0.165, 0.08], grips: [[-0.23, 1.12, -0.43], [0.23, 1.12, -0.43]], feet: [[-0.04, 0.166, -0.1], [0.04, 0.166, 0.2]] };
const TUCK: RideAnchors = { seat: [0, 0.88, 0.3], grips: [[-0.22, 0.94, -0.32], [0.22, 0.94, -0.32]], feet: [[-0.26, 0.475, 0.3], [0.26, 0.475, 0.3]] };
const ANCHORS: Record<RideStyle, RideAnchors> = { pedal: BIKE, seat: MOTO, tuck: TUCK, stand: SCOOTER };

function ride(recipe: Recipe, style: RideStyle): { world: Float32Array; d: ReturnType<typeof bodyDims> } {
  const d = bodyDims(recipe);
  const out = new Float32Array(BONE_COUNT * 16), world = new Float32Array(BONE_COUNT * 16);
  solveRide(out, world, restOffsets(d), geometryScales(d), d, style, ANCHORS[style], createPose());
  return { world, d };
}
const at = (w: Float32Array, b: number): V3 => [w[b * 16 + 12]!, w[b * 16 + 13]!, w[b * 16 + 14]!];
/** Point à `along` mètres sous l'articulation d'un os pendant (dans son repère). */
const below = (w: Float32Array, b: number, along: number): V3 => [w[b * 16 + 12]! - w[b * 16 + 4]! * along, w[b * 16 + 13]! - w[b * 16 + 5]! * along, w[b * 16 + 14]! - w[b * 16 + 6]! * along];

describe("poses sur véhicule", () => {
  it("amène mains et pieds sur leurs appuis quand ils sont à portée (vélo, moto, moto sportive, trottinette)", () => {
    const bad: string[] = [];
    for (const style of ["pedal", "seat", "tuck", "stand"] as const) {
      const a = ANCHORS[style];
      for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
        const recipe = { ...recipeFromSeed(seed), height: 1.7 + (seed % 3) * 0.05 };
        const { world, d } = ride(recipe, style);
        const hands = [below(world, BONE.forearmL, handReach(d)), below(world, BONE.forearmR, handReach(d))];
        const ankles = [at(world, BONE.footL), at(world, BONE.footR)];
        for (let s = 0; s < 2; s++) {
          if (dist(hands[s]!, a.grips[s]!) > 0.02) bad.push(`${style} ${seed} main ${s}: ${dist(hands[s]!, a.grips[s]!).toFixed(3)}`);
          const target: V3 = [a.feet[s]![0], a.feet[s]![1] + d.ankleY, a.feet[s]![2] + ballOffset(d)];
          if (dist(ankles[s]!, target) > 0.03) bad.push(`${style} ${seed} pied ${s}: ${dist(ankles[s]!, target).toFixed(3)}`);
        }
      }
    }
    expect(bad.slice(0, 6)).toEqual([]);
  });

  it("pose le bassin sur la selle, pieds à plat et genoux vers l'avant", () => {
    for (const style of ["pedal", "seat", "tuck"] as const) {
      const { world, d } = ride(DEFAULT_RECIPE, style);
      const p = at(world, BONE.pelvis);
      expect(Math.abs(p[0])).toBeLessThan(1e-4);
      expect(p[1] - ANCHORS[style].seat[1]).toBeGreaterThan(0.05);
      expect(p[1] - ANCHORS[style].seat[1]).toBeLessThan(0.1);
      for (const [knee, hip, foot] of [[BONE.shinL, BONE.thighL, BONE.footL], [BONE.shinR, BONE.thighR, BONE.footR]] as const) {
        expect(at(world, knee)[2]).toBeLessThan(Math.min(at(world, hip)[2], at(world, foot)[2]) + 0.02);
        // Semelle à plat : l'axe y du pied reste vertical.
        expect(world[foot * 16 + 5]!).toBeGreaterThan(0.99);
      }
      void d;
    }
  });

  it("garde les os à leur longueur (aucun étirement)", () => {
    const { world, d } = ride(DEFAULT_RECIPE, "pedal");
    for (const [a, b, len] of [[BONE.armR, BONE.forearmR, d.upperArm], [BONE.thighR, BONE.shinR, d.thigh], [BONE.shinR, BONE.footR, d.shin]] as const) {
      expect(dist(at(world, a), at(world, b))).toBeCloseTo(len, 4);
    }
  });

  it("reste finie pour toutes les morphologies, même quand les appuis sont hors de portée", () => {
    const bad: string[] = [];
    for (const height of [1.45, 2.02]) {
      for (const style of ["pedal", "seat", "tuck", "stand"] as const) {
        const out = new Float32Array(BONE_COUNT * 16);
        const { world } = ride({ ...DEFAULT_RECIPE, height, build: "heavy" }, style);
        for (const v of world) if (!Number.isFinite(v)) bad.push(`${style} ${height}`);
        void out;
      }
    }
    expect(bad).toEqual([]);
  });
});
