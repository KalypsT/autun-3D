import { describe, expect, it } from "vitest";
import { bodyDims, DEFAULT_RECIPE, HEIGHT_RANGE, recipeFromSeed } from "./character";
import { BONE, BONE_COUNT, createPose, cycleLength, DOWN_TIME, geometryScales, HIT_POSE, hitPose, jointBlend, PARENT, phaseRate, REF_DIMS, restOffsets, solveBones, STUMBLE_TIME, walkPose } from "./character-rig";

const root = { x: 0, y: 0, z: 0, yaw: 0 };

function solve(recipe = DEFAULT_RECIPE, phase = 0, speed = 0, r = root): { world: Float32Array; render: Float32Array; d: ReturnType<typeof bodyDims> } {
  const d = bodyDims(recipe);
  const pose = createPose();
  walkPose(pose, phase, speed, d);
  const world = new Float32Array(BONE_COUNT * 16), render = new Float32Array(BONE_COUNT * 16);
  solveBones(render, world, restOffsets(d), geometryScales(d), pose, r);
  return { world, render, d };
}
/** Position monde de l'articulation d'un os (colonne de translation). */
const at = (m: Float32Array, bone: number): [number, number, number] => [m[bone * 16 + 12]!, m[bone * 16 + 13]!, m[bone * 16 + 14]!];

describe("squelette", () => {
  it("a une hiérarchie valide : chaque parent précède son enfant", () => {
    expect(PARENT.length).toBe(BONE_COUNT);
    expect(PARENT.every((p, i) => (i === 0 ? p === -1 : p >= 0 && p < i))).toBe(true);
  });

  it("place les articulations au repos aux hauteurs de bodyDims", () => {
    const { world, d } = solve();
    expect(at(world, BONE.pelvis)[1]).toBeCloseTo(d.hipY, 5);
    expect(at(world, BONE.thighR)[0]).toBeCloseTo(d.stance, 5);
    expect(at(world, BONE.thighL)[0]).toBeCloseTo(-d.stance, 5);
    expect(at(world, BONE.shinR)[1]).toBeCloseTo(d.kneeY, 5);
    expect(at(world, BONE.footR)[1]).toBeCloseTo(d.ankleY, 5);
    expect(at(world, BONE.armR)[0]).toBeCloseTo(d.shoulderHalf, 5);
    // Au repos de la marche (vitesse nulle) le bras est à peine écarté : le coude est à 1 cm près sous l'épaule.
    expect(at(world, BONE.forearmR)[1]).toBeCloseTo(d.shoulderY - 0.025 * d.height - d.upperArm, 2);
  });

  it("applique la position et le cap de la racine", () => {
    const { world } = solve(DEFAULT_RECIPE, 0, 0, { x: 10, y: 5, z: -3, yaw: Math.PI / 2 });
    const [x, y, z] = at(world, BONE.thighR);
    // Cap de +90° : l'axe x du corps pointe vers −z.
    expect(x).toBeCloseTo(10, 4);
    expect(y).toBeCloseTo(5 + bodyDims(DEFAULT_RECIPE).hipY, 4);
    expect(z).toBeCloseTo(-3 - bodyDims(DEFAULT_RECIPE).stance, 4);
  });

  it("le corps de référence a une échelle de géométrie de 1 partout", () => {
    const s = geometryScales(REF_DIMS);
    for (const v of s) expect(v).toBeCloseTo(1, 6);
  });
});

describe("marche", () => {
  it("à l'arrêt : debout, bras le long du corps, pieds au sol", () => {
    const pose = createPose();
    walkPose(pose, 1.3, 0, bodyDims(DEFAULT_RECIPE));
    expect(pose.rootDy).toBeCloseTo(0, 6);
    expect(pose.angles[BONE.thighL * 3]).toBeCloseTo(0, 6);
    expect(Math.abs(pose.angles[BONE.armL * 3]!)).toBeLessThan(0.1);
  });

  it("garde le pied le plus bas au sol à toute phase et toute vitesse (une seule vérification groupée)", () => {
    const bad: string[] = [];
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const recipe = recipeFromSeed(seed);
      for (const speed of [0.6, 1.4, 2.2, 4, 6]) {
        for (let i = 0; i < 24; i++) {
          const { world, d } = solve(recipe, (i / 24) * 2 * Math.PI, speed);
          const feet = [at(world, BONE.footL)[1], at(world, BONE.footR)[1]];
          const lowest = Math.min(...feet);
          if (Math.abs(lowest - d.ankleY) > 1e-4) bad.push(`${seed} ${speed} ${i}: ${lowest.toFixed(4)} / ${d.ankleY.toFixed(4)}`);
        }
      }
    }
    expect(bad.slice(0, 5)).toEqual([]);
  });

  it("respecte les limites d'articulation (genoux et coudes ne plient que dans le bon sens)", () => {
    const bad: string[] = [];
    const d = bodyDims(DEFAULT_RECIPE);
    for (const speed of [0, 0.8, 1.4, 2.5, 5, 8]) {
      for (let i = 0; i < 36; i++) {
        const pose = createPose();
        walkPose(pose, (i / 36) * 2 * Math.PI, speed, d);
        const a = pose.angles;
        for (const knee of [BONE.shinL, BONE.shinR]) if (a[knee * 3]! > 1e-9 || a[knee * 3]! < -2.3) bad.push(`genou ${speed} ${i}`);
        for (const elbow of [BONE.forearmL, BONE.forearmR]) if (a[elbow * 3]! < 0 || a[elbow * 3]! > 2.4) bad.push(`coude ${speed} ${i}`);
        for (const thigh of [BONE.thighL, BONE.thighR]) if (Math.abs(a[thigh * 3]!) > 1.1) bad.push(`cuisse ${speed} ${i}`);
        for (const v of a) if (!Number.isFinite(v)) bad.push(`non fini ${speed} ${i}`);
      }
    }
    expect(bad.slice(0, 5)).toEqual([]);
  });

  it("fait marcher les jambes en opposition de phase, et les bras à l'opposé des jambes", () => {
    const d = bodyDims(DEFAULT_RECIPE);
    const p1 = createPose(), p2 = createPose();
    walkPose(p1, 0.7, 1.4, d);
    walkPose(p2, 0.7 + Math.PI, 1.4, d);
    expect(p1.angles[BONE.thighL * 3]).toBeCloseTo(p2.angles[BONE.thighR * 3]!, 6);
    expect(p1.angles[BONE.shinL * 3]).toBeCloseTo(p2.angles[BONE.shinR * 3]!, 6);
    // Quand la jambe gauche est en avant, le bras gauche est en arrière (rx négatif).
    walkPose(p1, Math.PI / 2, 1.4, d);
    expect(p1.angles[BONE.thighL * 3]!).toBeGreaterThan(0.3);
    expect(p1.angles[BONE.armL * 3]!).toBeLessThan(-0.3);
  });

  it("est périodique", () => {
    const d = bodyDims(DEFAULT_RECIPE);
    const p1 = createPose(), p2 = createPose();
    walkPose(p1, 0.9, 1.6, d);
    walkPose(p2, 0.9 + 2 * Math.PI, 1.6, d);
    for (let i = 0; i < p1.angles.length; i++) expect(p1.angles[i]!).toBeCloseTo(p2.angles[i]!, 5);
  });

  it("balance plus fort et penche plus en courant qu'en marchant, et voûte les seniors", () => {
    const d = bodyDims(DEFAULT_RECIPE);
    const walk = createPose(), run = createPose();
    walkPose(walk, Math.PI / 2, 1.4, d);
    walkPose(run, Math.PI / 2, 5, d);
    expect(run.angles[BONE.thighL * 3]!).toBeGreaterThan(walk.angles[BONE.thighL * 3]!);
    expect(run.angles[BONE.torso * 3]!).toBeLessThan(walk.angles[BONE.torso * 3]!);
    expect(run.angles[BONE.forearmL * 3]!).toBeGreaterThan(walk.angles[BONE.forearmL * 3]!);
    const old = createPose();
    walkPose(old, 0, 0, bodyDims({ ...DEFAULT_RECIPE, age: "senior" }));
    const young = createPose();
    walkPose(young, 0, 0, d);
    expect(old.angles[BONE.torso * 3]!).toBeLessThan(young.angles[BONE.torso * 3]!);
  });

  it("donne des foulées plausibles : ≈ 1,5 m par cycle en marchant, cadence réaliste", () => {
    const L = cycleLength(1.4, 1.75);
    expect(L).toBeGreaterThan(1.3);
    expect(L).toBeLessThan(1.8);
    // Deux pas par cycle : 1,4 m/s ≈ 1,8 pas/s.
    const stepsPerSecond = (phaseRate(1.4, 1.75) / (2 * Math.PI)) * 2;
    expect(stepsPerSecond).toBeGreaterThan(1.6);
    expect(stepsPerSecond).toBeLessThan(2.2);
    const running = (phaseRate(5, 1.75) / (2 * Math.PI)) * 2;
    expect(running).toBeGreaterThan(2.4);
    expect(running).toBeLessThan(3.8);
  });
});

describe("échelles de recette", () => {
  it("garde des échelles positives et bornées pour toutes les morphologies", () => {
    const bad: string[] = [];
    for (const sex of ["f", "m"] as const) {
      for (const build of ["slim", "average", "stocky", "heavy"] as const) {
        for (const height of [HEIGHT_RANGE.min, 1.75, HEIGHT_RANGE.max]) {
          const s = geometryScales(bodyDims({ ...DEFAULT_RECIPE, sex, build, height }));
          for (const v of s) if (!(v > 0.65 && v < 1.8)) bad.push(`${sex} ${build} ${height}: ${v}`);
        }
      }
    }
    expect(bad).toEqual([]);
  });
});

describe("poses d'un passant heurté", () => {
  const d = bodyDims(DEFAULT_RECIPE);
  const joints = (kind: number, t: number, side: number): { y: number[]; pelvis: number; head: number; rootDy: number; angles: number[] } => {
    const pose = createPose();
    hitPose(pose, kind, t, side, d);
    const world = new Float32Array(BONE_COUNT * 16), render = new Float32Array(BONE_COUNT * 16);
    solveBones(render, world, restOffsets(d), geometryScales(d), pose, root);
    return { y: Array.from({ length: BONE_COUNT }, (_, b) => world[b * 16 + 13]!), pelvis: world[BONE.pelvis * 16 + 13]!, head: world[BONE.head * 16 + 13]!, rootDy: pose.rootDy, angles: Array.from(pose.angles) };
  };

  it("trébuche : se penche en milieu de mouvement, puis retrouve l'équilibre (tout à zéro à la fin)", () => {
    const mid = joints(HIT_POSE.stumble, STUMBLE_TIME / 2, 1);
    expect(mid.angles[BONE.pelvis * 3]!).toBeGreaterThan(0.4);
    expect(joints(HIT_POSE.stumble, STUMBLE_TIME / 2, -1).angles[BONE.pelvis * 3]!).toBeLessThan(-0.4);
    const end = joints(HIT_POSE.stumble, STUMBLE_TIME, 1);
    expect(end.angles.every((a) => Math.abs(a) < 1e-9)).toBe(true);
    expect(Math.abs(end.rootDy)).toBeLessThan(1e-9);
  });

  it("tombe : au sol le bassin est à 24 cm et la tête reste basse ; debout au début et à la fin", () => {
    const start = joints(HIT_POSE.down, 0, 1), lying = joints(HIT_POSE.down, 1.5, 1), end = joints(HIT_POSE.down, DOWN_TIME, 1);
    expect(start.pelvis).toBeCloseTo(d.hipY, 4);
    expect(lying.pelvis).toBeCloseTo(0.24, 2);
    expect(lying.head).toBeLessThan(0.45);
    expect(Math.min(...lying.y)).toBeGreaterThan(-0.03); // aucun os ne passe sous le sol
    expect(end.pelvis).toBeCloseTo(d.hipY, 4);
    expect(end.angles.every((a) => Math.abs(a) < 1e-9)).toBe(true);
  });

  it("tombe sur le dos (+1) ou vers l'avant (−1) : la tête passe derrière ou devant le bassin (axe z : l'avant du personnage est −z)", () => {
    const zOf = (side: number): number => {
      const pose = createPose();
      hitPose(pose, HIT_POSE.down, 1.5, side, d);
      const world = new Float32Array(BONE_COUNT * 16), render = new Float32Array(BONE_COUNT * 16);
      solveBones(render, world, restOffsets(d), geometryScales(d), pose, root);
      return world[BONE.head * 16 + 14]! - world[BONE.pelvis * 16 + 14]!;
    };
    expect(zOf(1)).toBeGreaterThan(0.4); // sur le dos : la tête est derrière
    expect(zOf(-1)).toBeLessThan(-0.4); // à plat ventre : la tête est devant
  });

  it("reste fini et sans os sous le sol pour toutes les morphologies et à chaque instant", () => {
    const bad: string[] = [];
    for (let seed = 0; seed < 60; seed++) {
      const r = recipeFromSeed(seed), dd = bodyDims(r);
      for (const [kind, total] of [[HIT_POSE.stumble, STUMBLE_TIME], [HIT_POSE.down, DOWN_TIME]] as const) {
        for (let k = 0; k <= 20; k++) {
          const pose = createPose();
          hitPose(pose, kind, (total * k) / 20, seed % 2 ? 1 : -1, dd);
          const world = new Float32Array(BONE_COUNT * 16), render = new Float32Array(BONE_COUNT * 16);
          solveBones(render, world, restOffsets(dd), geometryScales(dd), pose, root);
          for (let b = 0; b < BONE_COUNT; b++) if (!Number.isFinite(world[b * 16 + 13]!) || world[b * 16 + 13]! < -0.04) bad.push(`${seed} ${kind} ${k} ${b} ${world[b * 16 + 13]}`);
        }
      }
    }
    expect(bad).toEqual([]);
  });
});

describe("peau souple aux articulations (D99)", () => {
  it("donne un poids de 0,5 à la jointure, qui s'éteint en s'éloignant, vers le bon os et le bon pivot", () => {
    const R = REF_DIMS;
    // Genou, côté cuisse : pivot sur l'origine de la jambe (l'enfant).
    expect(jointBlend(BONE.thighL, 0, -R.thigh + 0.001, 0)).toEqual([BONE.shinL, expect.closeTo(0.5, 2), 1]);
    // Genou, côté jambe : pivot sur sa propre origine.
    expect(jointBlend(BONE.shinR, 0, -0.001, 0)).toEqual([BONE.thighR, expect.closeTo(0.5, 2), 0]);
    // Milieu de la cuisse, du mollet, de l'avant-bras : rigide.
    expect(jointBlend(BONE.thighL, 0, -0.22, 0)[1]).toBe(0);
    expect(jointBlend(BONE.shinL, 0, -0.2, 0)[1]).toBe(0);
    expect(jointBlend(BONE.forearmR, 0, -0.15, 0)[1]).toBe(0);
    // Le haut de l'épaule suit le bras de son côté ; la tête et les pieds restent rigides.
    expect(jointBlend(BONE.torso, -0.19, 0.49, 0)[0]).toBe(BONE.armL);
    expect(jointBlend(BONE.torso, 0.19, 0.49, 0)[0]).toBe(BONE.armR);
    expect(jointBlend(BONE.head, 0, 0.15, 0)[1]).toBe(0);
    expect(jointBlend(BONE.footL, 0, -0.05, -0.1)[1]).toBe(0);
    // Le poids reste toujours entre 0 et 0,5.
    for (let b = 0; b < BONE_COUNT; b++) {
      for (let y = -0.5; y <= 0.6; y += 0.05) {
        const w = jointBlend(b, 0.1, y, 0)[1]!;
        expect(w).toBeGreaterThanOrEqual(0);
        expect(w).toBeLessThanOrEqual(0.5);
      }
    }
  });
});
