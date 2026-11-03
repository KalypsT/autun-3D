import { describe, expect, it } from "vitest";
import { bodyDims, DEFAULT_RECIPE, HEIGHT_RANGE, recipeFromSeed } from "./character";
import { BONE, BONE_COUNT, createPose, cycleLength, DOWN_TIME, geometryScales, HIT_BLEND, HIT_POSE, hitPose, lowestPoint, LYING_T, LYING_VARIANTS, lyingPose, stumblePose, downTier, DOWN_TIERS, downTime, lyingTime, fallTurn, fallShift, jointBlend, PARENT, phaseRate, REF_DIMS, restOffsets, solveBones, STRAFE_TWIST, strafePose, STUMBLE_TIME, walkPose, walksBackward } from "./character-rig";

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

  const stand = (): number[] => {
    const p = createPose();
    walkPose(p, 0, 0, d);
    return Array.from(p.angles);
  };

  it("trébuche (D211) : penche dans le sens de la poussée puis se rattrape, pieds au sol, debout immobile à la fin", () => {
    const rest = stand();
    const headOffset = (dir: number, t: number): [number, number] => {
      const pose = createPose();
      stumblePose(pose, t, dir, 2.2, 0.3, d);
      const world = new Float32Array(BONE_COUNT * 16), render = new Float32Array(BONE_COUNT * 16);
      solveBones(render, world, restOffsets(d), geometryScales(d), pose, root);
      return [world[BONE.head * 16 + 12]! - world[12]!, world[BONE.head * 16 + 14]! - world[14]!];
    };
    // Avant du personnage : −z ; sa droite : +x.
    expect(headOffset(0, 0.15)[1]).toBeLessThan(-0.15); // poussé vers l'avant : la tête part devant
    expect(headOffset(Math.PI, 0.15)[1]).toBeGreaterThan(0.1); // vers l'arrière
    expect(headOffset(Math.PI / 2, 0.15)[0]).toBeGreaterThan(0.12); // vers sa droite
    // Il revient en dépassant un peu dans l'autre sens (ressort amorti), puis se pose.
    expect(headOffset(0, 0.6)[1]).toBeGreaterThan(headOffset(0, 0)[1]);
    for (const dir of [0, 1, 2, Math.PI, -1.5]) {
      for (let k = 0; k <= 30; k++) {
        const pose = createPose();
        stumblePose(pose, (k / 30) * STUMBLE_TIME, dir, 2.5, 1, d);
        expect(Math.abs(lowestPoint(pose, d))).toBeLessThan(1e-6); // les pieds restent au sol
      }
    }
    const end = joints(HIT_POSE.stumble, STUMBLE_TIME, 1);
    expect(end.angles.every((a, k) => Math.abs(a - rest[k]!) < 1e-9)).toBe(true);
    expect(Math.abs(end.rootDy)).toBeLessThan(1e-6);
  });

  it("trébuche (D211) : fait des pas dans le sens de la poussée, plus marqués quand elle est forte", () => {
    const stride = (impulse: number, dir: number): number => {
      let reach = 0;
      for (let k = 0; k <= 30; k++) {
        const pose = createPose();
        stumblePose(pose, (k / 30) * 0.5, dir, impulse, 0.3, d);
        const world = new Float32Array(BONE_COUNT * 16), render = new Float32Array(BONE_COUNT * 16);
        solveBones(render, world, restOffsets(d), geometryScales(d), pose, root);
        // Écart des chevilles le long de la poussée (avant : −z).
        const along = (b: number): number => -(world[b * 16 + 14]! * Math.cos(dir)) + world[b * 16 + 12]! * Math.sin(dir);
        reach = Math.max(reach, Math.abs(along(BONE.footL) - along(BONE.footR)));
      }
      return reach;
    };
    expect(stride(2.5, 0)).toBeGreaterThan(0.3);
    expect(stride(2.5, Math.PI)).toBeGreaterThan(0.3);
    expect(stride(1, 0)).toBeLessThan(stride(2.5, 0));
  });

  it("tombe : au sol le corps repose à plat (bassin et tête au ras du sol, rien dessous) ; debout au début et à la fin (D209)", () => {
    const rest = stand();
    for (const side of [1, -1]) {
      for (let v = 0; v < LYING_VARIANTS; v++) {
        const pose = createPose();
        hitPose(pose, HIT_POSE.down, LYING_T, side, d, null, v);
        const world = new Float32Array(BONE_COUNT * 16), render = new Float32Array(BONE_COUNT * 16);
        solveBones(render, world, restOffsets(d), geometryScales(d), pose, root);
        expect(world[BONE.pelvis * 16 + 13]!).toBeLessThan(0.16);
        expect(world[BONE.head * 16 + 13]!).toBeLessThan(0.18);
        expect(Math.abs(lowestPoint(pose, d))).toBeLessThan(1e-6); // le point le plus bas touche le sol
      }
    }
    const start = joints(HIT_POSE.down, 0, 1), end = joints(HIT_POSE.down, DOWN_TIME, 1);
    expect(start.pelvis).toBeCloseTo(d.hipY, 3);
    expect(end.pelvis).toBeCloseTo(d.hipY, 3);
    expect(end.angles.every((a, k) => Math.abs(a - rest[k]!) < 1e-9)).toBe(true);
  });

  it("debout, le point le plus bas du corps est au sol (les semelles), à l'arrêt comme en marchant", () => {
    const pose = createPose();
    walkPose(pose, 0, 0, d);
    expect(lowestPoint(pose, d)).toBeCloseTo(0, 3);
    for (let k = 0; k < 8; k++) {
      walkPose(pose, (k / 8) * Math.PI * 2, 1.4, d);
      expect(Math.abs(lowestPoint(pose, d))).toBeLessThan(0.03);
    }
  });

  it("fondu (D209) : au choc, la pose est celle d'avant (la marche), puis rejoint la pose de choc en HIT_BLEND s", () => {
    const from = createPose();
    walkPose(from, 1.2, 1.6, d);
    for (const kind of [HIT_POSE.stumble, HIT_POSE.down]) {
      const p0 = createPose(), p1 = createPose(), ref = createPose();
      hitPose(p0, kind, 0, 1, d, from, 0);
      for (let k = 0; k < BONE_COUNT * 3; k++) expect(p0.angles[k]!).toBeCloseTo(from.angles[k]!, 6);
      hitPose(p1, kind, HIT_BLEND, 1, d, from, 0);
      hitPose(ref, kind, HIT_BLEND, 1, d, null, 0);
      for (let k = 0; k < BONE_COUNT * 3; k++) expect(p1.angles[k]!).toBeCloseTo(ref.angles[k]!, 6);
    }
  });

  const height = (side: number, t: number, variant = 0): { pelvis: number; head: number; hands: number; knees: number; low: number } => {
    const pose = createPose();
    hitPose(pose, HIT_POSE.down, t, side, d, null, variant);
    const world = new Float32Array(BONE_COUNT * 16), render = new Float32Array(BONE_COUNT * 16);
    solveBones(render, world, restOffsets(d), geometryScales(d), pose, root);
    const hand = (b: number): number => world[b * 16 + 13]! - world[b * 16 + 5]! * (d.forearm + 0.05 * d.height);
    return {
      pelvis: world[BONE.pelvis * 16 + 13]!, head: world[BONE.head * 16 + 13]!, hands: Math.max(hand(BONE.forearmL), hand(BONE.forearmR)),
      knees: Math.max(world[BONE.shinL * 16 + 13]!, world[BONE.shinR * 16 + 13]!), low: lowestPoint(pose, d),
    };
  };

  it("chute en plusieurs temps (D210) : le corps touche toujours le sol, sans flotter, et rien ne s'y enfonce (mains posées)", () => {
    for (const side of [1, -1]) {
      for (let v = 0; v < LYING_VARIANTS; v++) {
        let sunk = 0;
        for (let k = 0; k <= 360; k++) {
          const { low } = height(side, k / 100, v);
          expect(low).toBeLessThan(1e-6); // quelque chose touche le sol : jamais de corps qui flotte
          expect(low).toBeGreaterThan(-0.2);
          if (low < -0.03) sunk++;
        }
        expect(sunk).toBeLessThan(3); // une main qui s'enfoncerait : au plus deux centièmes de seconde
      }
    }
  });

  it("chute en plusieurs temps (D210) : la tête suit le buste avec retard, le bassin descend avant de toucher", () => {
    const rest = stand();
    const early = createPose();
    hitPose(early, HIT_POSE.down, 0.06, 1, d);
    // À 0,06 s le buste a déjà basculé, la tête pas encore (elle fouette ensuite).
    expect(Math.abs(early.angles[BONE.torso * 3]! - rest[BONE.torso * 3]!)).toBeGreaterThan(0.05);
    expect(Math.abs(early.angles[BONE.head * 3]! - rest[BONE.head * 3]!)).toBeLessThan(0.02);
    for (const side of [1, -1]) {
      const mid = height(side, 0.38), low = height(side, 0.9);
      expect(mid.pelvis).toBeLessThan(0.8);
      expect(mid.pelvis).toBeGreaterThan(0.3);
      expect(low.pelvis).toBeLessThan(0.16);
    }
  });

  it("relevé (D210) : du dos, il s'assoit (bassin au sol, tête haute) ; du ventre, il passe à quatre pattes puis un genou à terre", () => {
    const sit = height(1, DOWN_TIME - 1.1);
    expect(sit.pelvis).toBeLessThan(0.25);
    expect(sit.head).toBeGreaterThan(0.6);
    expect(sit.hands).toBeLessThan(0.15); // en appui sur les mains
    const fours = height(-1, DOWN_TIME - 0.7);
    expect(fours.pelvis).toBeGreaterThan(0.35);
    expect(fours.pelvis).toBeLessThan(0.65);
    expect(fours.hands).toBeLessThan(0.12);
    expect(fours.knees).toBeLessThan(0.12);
    const kneel = height(-1, DOWN_TIME - 0.4);
    expect(kneel.pelvis).toBeGreaterThan(0.45);
    expect(kneel.pelvis).toBeLessThan(0.7);
  });

  it("au sol (D210) : il respire à peine, et un mort (temps figé à LYING_T) ne bouge pas", () => {
    const a = createPose(), b = createPose();
    hitPose(a, HIT_POSE.down, LYING_T, 1, d);
    hitPose(b, HIT_POSE.down, LYING_T + 0.7, 1, d);
    let diff = 0;
    for (let k = 0; k < BONE_COUNT * 3; k++) diff = Math.max(diff, Math.abs(a.angles[k]! - b.angles[k]!));
    expect(diff).toBeGreaterThan(0.005);
    expect(diff).toBeLessThan(0.07);
  });

  it("intensités (D212) : légère (assis ou à genoux, vite relevé), forte, violente (plus longue) ; un mort finit couché", () => {
    expect(downTier(4.4)).toBe(DOWN_TIERS.light);
    expect(downTier(6)).toBe(DOWN_TIERS.strong);
    expect(downTier(8.5)).toBe(DOWN_TIERS.violent);
    expect(downTime(4.4)).toBeLessThan(downTime(6));
    expect(downTime(6)).toBe(DOWN_TIME);
    expect(downTime(8.5)).toBeGreaterThan(DOWN_TIME);
    // Un mort tombe au moins comme une chute forte : à `lyingTime`, couché.
    expect(lyingTime(4.4)).toBe(lyingTime(6));
    for (const imp of [6, 8.5]) {
      for (const side of [1, -1]) {
        const p = createPose();
        hitPose(p, HIT_POSE.down, lyingTime(imp), side, d, null, 0, side > 0 ? Math.PI : 0, imp);
        const world = new Float32Array(BONE_COUNT * 16), render = new Float32Array(BONE_COUNT * 16);
        solveBones(render, world, restOffsets(d), geometryScales(d), p, root);
        expect(world[BONE.pelvis * 16 + 13]!).toBeLessThan(0.16);
        expect(world[BONE.head * 16 + 13]!).toBeLessThan(0.2);
      }
    }
    // Légère : assis sur les fesses, la tête haute (choc de face) ; à quatre pattes (par derrière) ; jamais couché.
    const at = (side: number, t: number): { pelvis: number; head: number } => {
      const p = createPose();
      hitPose(p, HIT_POSE.down, t, side, d, null, 0, side > 0 ? Math.PI : 0, 4.4);
      const world = new Float32Array(BONE_COUNT * 16), render = new Float32Array(BONE_COUNT * 16);
      solveBones(render, world, restOffsets(d), geometryScales(d), p, root);
      return { pelvis: world[BONE.pelvis * 16 + 13]!, head: world[BONE.head * 16 + 13]! };
    };
    const sit = at(1, 0.9), fours = at(-1, 0.9);
    expect(sit.pelvis).toBeLessThan(0.25);
    expect(sit.head).toBeGreaterThan(0.6);
    expect(fours.pelvis).toBeGreaterThan(0.35);
    expect(fours.head).toBeGreaterThan(0.45);
    for (let k = 0; k <= 22; k++) expect(at(k % 2 ? 1 : -1, k / 10).head).toBeGreaterThan(0.4);
    // Debout au bout de la chute, quelle que soit l'intensité.
    const rest = stand();
    for (const imp of [4.4, 6, 8.5]) {
      const p = createPose();
      hitPose(p, HIT_POSE.down, downTime(imp), 1, d, null, 0, Math.PI, imp);
      expect(p.angles.every((v, k) => Math.abs(v - rest[k]!) < 1e-9)).toBe(true);
    }
  });

  it("intensités (D212) : le corps touche toujours le sol et rien ne s'y enfonce ; une chute violente décolle (vol plané)", () => {
    for (const imp of [4.4, 8.5]) {
      for (const side of [1, -1]) {
        for (let v = 0; v < LYING_VARIANTS; v += 3) {
          let flew = 0;
          for (let k = 0; k <= Math.round(downTime(imp) * 50); k++) {
            const p = createPose();
            hitPose(p, HIT_POSE.down, k / 50, side, d, null, v, side > 0 ? Math.PI : 0, imp);
            const low = lowestPoint(p, d), t = k / 50;
            expect(low).toBeGreaterThan(-0.03);
            if (imp > 8 && t > 0.05 && t < 0.43) {
              if (low > 0.2) flew++;
            } else expect(low).toBeLessThan(1e-6);
          }
          if (imp === 8.5) expect(flew).toBeGreaterThan(5);
          else expect(flew).toBe(0);
        }
      }
    }
  });

  it("quart de tour (D212) : poussé de côté, il pivote vers la poussée puis tombe sur le dos ou le ventre ; violent, il tourne en plus sur lui-même", () => {
    // Poussé vers sa droite, tombant sur le dos : un quart de tour vers sa gauche (son dos face à la poussée).
    expect(fallTurn(Math.PI / 2, 1, 6)).toBeCloseTo(-Math.PI / 2, 9);
    // Tombant en avant : un quart de tour vers sa droite.
    expect(fallTurn(Math.PI / 2, -1, 6)).toBeCloseTo(Math.PI / 2, 9);
    expect(fallTurn(0, -1, 6)).toBeCloseTo(0, 9);
    expect(Math.abs(fallTurn(0, -1, 8.5))).toBeGreaterThan(1);
    // Au choc, le corps fait face à l'ancien cap (le cap du personnage est déjà tourné) ; une fois posé, au nouveau.
    const p0 = createPose(), p1 = createPose();
    hitPose(p0, HIT_POSE.down, 0, 1, d, null, 0, Math.PI / 2, 6);
    hitPose(p1, HIT_POSE.down, 1, 1, d, null, 0, Math.PI / 2, 6);
    expect(p0.angles[BONE.pelvis * 3 + 1]!).toBeCloseTo(fallTurn(Math.PI / 2, 1, 6), 6);
    expect(Math.abs(p1.angles[BONE.pelvis * 3 + 1]!)).toBeLessThan(1e-6);
  });

  it("pieds fixes (D212) : avec le déplacement `fallShift`, les pieds restent à quelques centimètres de leur place pendant la bascule", () => {
    for (const imp of [4.4, 6]) {
      for (const side of [1, -1]) {
        let z0 = 0, worst = 0;
        for (let k = 0; k <= 45; k++) {
          const t = k / 50;
          const p = createPose();
          hitPose(p, HIT_POSE.down, t, side, d, null, 0, side > 0 ? Math.PI : 0, imp);
          const world = new Float32Array(BONE_COUNT * 16), render = new Float32Array(BONE_COUNT * 16);
          solveBones(render, world, restOffsets(d), geometryScales(d), p, root);
          const feet = (world[BONE.footL * 16 + 14]! + world[BONE.footR * 16 + 14]!) / 2 + (side > 0 ? 1 : -1) * fallShift(t, side, imp, d.height);
          if (k === 0) z0 = feet;
          if (t > 0.55) worst = Math.max(worst, Math.abs(feet - z0));
        }
        expect(worst).toBeLessThan(0.12); // une fois tombé (au lieu de ≈ 0,9 m sans déplacement)
      }
    }
  });

  it("pose au sol : chaque variante et sa symétrique (gauche ↔ droite) sont distinctes", () => {
    const seen = new Set<string>();
    for (let v = 0; v < LYING_VARIANTS; v++) {
      const p = createPose();
      lyingPose(p, 1, v);
      seen.add(Array.from(p.angles, (x) => x.toFixed(3)).join(","));
    }
    expect(seen.size).toBe(LYING_VARIANTS);
    const a = createPose(), b = createPose();
    lyingPose(a, -1, 0);
    lyingPose(b, -1, 1);
    expect(b.angles[BONE.armR * 3 + 2]!).toBeCloseTo(-a.angles[BONE.armL * 3 + 2]!, 9);
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
          hitPose(pose, kind, (total * k) / 20, seed % 2 ? 1 : -1, dd, null, seed);
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

describe("pas de côté et à reculons (D208)", () => {
  /** Direction de l'avant d'un os (son axe −z) dans le plan, en cap (0 : avant du personnage, positif vers sa droite). */
  const facing = (m: Float32Array, bone: number): number => Math.atan2(-m[bone * 16 + 8]!, m[bone * 16 + 10]!);
  const posed = (rel: number, w: number): Float32Array => {
    const d = REF_DIMS, pose = createPose();
    walkPose(pose, 0, 0, d);
    strafePose(pose, rel, w);
    const world = new Float32Array(BONE_COUNT * 16), render = new Float32Array(BONE_COUNT * 16);
    solveBones(render, world, restOffsets(d), geometryScales(d), pose, root);
    return world;
  };

  it("en marchant vers la droite, le bassin se tourne vers la droite et le buste reste face au regard", () => {
    const w = posed(Math.PI / 2, 1);
    expect(facing(w, BONE.pelvis)).toBeCloseTo(STRAFE_TWIST, 5);
    expect(facing(w, BONE.torso)).toBeCloseTo(0, 5);
    expect(facing(posed(-Math.PI / 2, 1), BONE.pelvis)).toBeCloseTo(-STRAFE_TWIST, 5);
    // À demi-vitesse, demi-torsion ; à l'arrêt, rien.
    expect(facing(posed(Math.PI / 2, 0.5), BONE.pelvis)).toBeCloseTo(STRAFE_TWIST / 2, 5);
    expect(facing(posed(Math.PI / 2, 0), BONE.pelvis)).toBeCloseTo(0, 5);
  });

  it("à reculons, les jambes restent tournées vers l'avant (le cycle se joue à l'envers) ; en biais arrière droit, le bassin se tourne vers la gauche", () => {
    expect(walksBackward(Math.PI)).toBe(true);
    expect(walksBackward(0.3)).toBe(false);
    expect(walksBackward(Math.PI / 2)).toBe(false);
    expect(facing(posed(Math.PI, 1), BONE.pelvis)).toBeCloseTo(0, 5);
    expect(facing(posed(Math.PI * 0.75, 1), BONE.pelvis)).toBeCloseTo(-Math.PI / 4, 5);
    expect(facing(posed(Math.PI * 0.75, 1), BONE.torso)).toBeCloseTo(0, 5);
  });
});
