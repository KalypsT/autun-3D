import { describe, expect, it } from "vitest";
import { bodyDims, DEFAULT_RECIPE } from "./character";
import { attackBlend, attackKey, attackPose, guardPose, gunPose } from "./character-attack";
import { BONE, BONE_COUNT, createPose, geometryScales, restOffsets, solveBones, walkPose } from "./character-rig";
import type { AttackStyle } from "./weapons";

const STYLES: AttackStyle[] = ["punch", "stab", "swing"];
const d = bodyDims(DEFAULT_RECIPE);
const root = { x: 0, y: 0, z: 0, yaw: 0 };

function hand(pose: ReturnType<typeof createPose>, bone: number): { x: number; y: number; z: number } {
  const world = new Float32Array(BONE_COUNT * 16), render = new Float32Array(BONE_COUNT * 16);
  solveBones(render, world, restOffsets(d), geometryScales(d), pose, root);
  const m = bone * 16;
  // Main : au bout de l'avant-bras, le long de son axe −y.
  return { x: world[m + 12]! - world[m + 4]! * d.forearm, y: world[m + 13]! - world[m + 5]! * d.forearm, z: world[m + 14]! - world[m + 6]! * d.forearm };
}

describe("poses d'attaque (J5-1)", () => {
  it("le fondu vaut 0 au début et à la fin du coup, 1 au milieu", () => {
    expect(attackBlend(0)).toBe(0);
    expect(attackBlend(1)).toBe(0);
    expect(attackBlend(0.5)).toBe(1);
  });

  it("revient exactement à la pose de marche aux deux bouts du coup (pas de saut)", () => {
    for (const style of STYLES) {
      for (const side of [1, -1] as const) {
        const a = createPose(), b = createPose();
        walkPose(a, 1.3, 1.4, d);
        walkPose(b, 1.3, 1.4, d);
        attackPose(b, style, 0, 0.45, side);
        expect(Array.from(b.angles)).toEqual(Array.from(a.angles));
        attackPose(b, style, 1, 0.45, side);
        expect(Array.from(b.angles)).toEqual(Array.from(a.angles));
      }
    }
  });

  it("à la frappe, la main du coup est loin devant le buste, plus loin qu'en garde", () => {
    for (const style of STYLES) {
      for (const side of [1, -1] as const) {
        const bone = side > 0 ? BONE.forearmR : BONE.forearmL;
        const guard = createPose(), strike = createPose();
        walkPose(guard, 0, 0, d);
        walkPose(strike, 0, 0, d);
        guardPose(guard, style);
        guardPose(strike, style);
        attackPose(strike, style, 0.45, 0.45, side);
        const g = hand(guard, bone), s = hand(strike, bone);
        // Le visage regarde −z : « devant » = z plus petit.
        expect(s.z).toBeLessThan(-0.45);
        if (side > 0) expect(s.z).toBeLessThan(g.z + 0.02);
      }
    }
  });

  it("tous les angles restent finis et bornés tout au long d'un coup, et le bassin ne descend pas", () => {
    for (const style of STYLES) {
      for (let u = 0; u <= 1.0001; u += 0.02) {
        for (const hitAt of [0.45, 0.5]) {
          const p = createPose();
          walkPose(p, u * 6, 1.4, d);
          const rootDy = p.rootDy;
          guardPose(p, style);
          attackPose(p, style, Math.min(u, 1), hitAt, 1);
          for (const v of p.angles) {
            expect(Number.isFinite(v)).toBe(true);
            expect(Math.abs(v)).toBeLessThan(2.6);
          }
          expect(p.rootDy).toBe(rootDy);
        }
      }
    }
  });

  it("les images clés sont continues (aucun saut entre deux instants voisins)", () => {
    for (const style of STYLES) {
      let prev = attackKey(style, 0, 0.45).slice();
      for (let u = 0.005; u <= 1; u += 0.005) {
        const k = attackKey(style, u, 0.45);
        for (let i = 0; i < 6; i++) expect(Math.abs(k[i]! - prev[i]!)).toBeLessThan(0.25);
        prev = k.slice();
      }
    }
  });

  it("armes à feu : à la visée les bras sont tendus devant le buste, à hauteur d'épaule ; la secousse recule la main ; les angles restent bornés", () => {
    for (const gun of ["pistol", "shotgun", "rifle"] as const) {
      const ready = createPose(), aim = createPose(), kick = createPose();
      for (const p of [ready, aim, kick]) walkPose(p, 0, 0, d);
      gunPose(ready, gun, 0, 0);
      gunPose(aim, gun, 1, 0);
      gunPose(kick, gun, 1, 1);
      const hr = hand(ready, BONE.forearmR), ha = hand(aim, BONE.forearmR), hk = hand(kick, BONE.forearmR);
      expect(ha.y).toBeGreaterThan(hr.y);
      expect(ha.z).toBeLessThan(-0.45);
      // Hauteur de l'épaule (≈ 1,45 m) : la main est à peu près à cette hauteur en visée.
      expect(ha.y).toBeGreaterThan(1.2);
      expect(ha.y).toBeLessThan(1.7);
      expect(hk.z).toBeGreaterThan(ha.z);
      // La main d'appui rejoint l'arme (devant le buste aussi).
      expect(hand(aim, BONE.forearmL).z).toBeLessThan(-0.35);
      for (const v of kick.angles) expect(Math.abs(v)).toBeLessThan(2.6);
    }
  });
});

