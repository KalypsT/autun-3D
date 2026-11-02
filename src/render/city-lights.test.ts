import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { lampLevel, litWindowShare } from "../core/city-lights";
import { scheduleOf, SCHEDULES } from "../core/opening";
import { loadRealWorld } from "../core/testing";
import { cityLights, lightUniforms, setCityLights, TAG } from "./city-lights";
import { buildDevanture } from "./devanture";
import { planFacades } from "./facades";
import { MeshBuilder } from "./geometry";
import { setShutterTarget } from "./shutter-sink";

describe("lumières de la ville : horaires (D200)", () => {
  it("les fenêtres s'allument le soir, s'éteignent la nuit, se rallument au réveil, sans saut", () => {
    expect(litWindowShare(18)).toBeLessThan(litWindowShare(21));
    expect(litWindowShare(21)).toBeGreaterThan(0.85);
    expect(litWindowShare(3)).toBeCloseTo(0.12, 2);
    expect(litWindowShare(7)).toBeGreaterThan(litWindowShare(4));
    for (let h = 0; h < 24; h += 0.05) {
      const v = litWindowShare(h);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
      expect(Math.abs(litWindowShare(h + 0.05) - v)).toBeLessThan(0.05);
    }
    expect(Math.abs(litWindowShare(23.999) - litWindowShare(0))).toBeLessThan(0.02);
    expect(lampLevel(0)).toBe(0);
    expect(lampLevel(0.7)).toBe(1);
  });
});

describe("lumières de la ville : étiquettes et nuanceurs (D200)", () => {
  it("un maillage étiqueté garde une étiquette par sommet, rendue en attribut `aTag`", () => {
    const mb = new MeshBuilder(true);
    const c = new THREE.Color();
    mb.tag = 0.4;
    mb.quad([0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0], [0, 0, 1], c);
    mb.tag = 3;
    mb.quadGradient([0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0], [0, 0, 1], c, c);
    const g = mb.build();
    const t = g.getAttribute("aTag");
    expect(t.count).toBe(12);
    expect(t.getX(0)).toBeCloseTo(0.4);
    expect(t.getX(11)).toBe(3);
    expect(new MeshBuilder().build().getAttribute("aTag")).toBeUndefined();
  });

  it("le verre allumé et les rideaux de fer lisent les uniformes partagés", () => {
    for (const mode of ["glow", "shutter"] as const) {
      const lib = mode === "glow" ? THREE.ShaderLib.basic! : THREE.ShaderLib.lambert!;
      const m = cityLights(mode === "glow" ? new THREE.MeshBasicMaterial() : new THREE.MeshLambertMaterial(), mode);
      const shader = { vertexShader: lib.vertexShader, fragmentShader: lib.fragmentShader, uniforms: {} } as unknown as THREE.WebGLProgramParametersWithUniforms;
      m.onBeforeCompile(shader, null as unknown as THREE.WebGLRenderer);
      expect(shader.vertexShader).toContain("vTag = aTag;");
      expect(shader.fragmentShader).toContain("discard");
      expect(shader.uniforms["uShop"]).toBe(lightUniforms.uShop);
      expect(m.customProgramCacheKey()).toContain(`lights-${mode}`);
    }
    setCityLights(0.5, 0.3, SCHEDULES.map((_, i) => i % 2));
    expect(lightUniforms.uWin.value).toBe(0.5);
    expect(lightUniforms.uShop.value[1]).toBe(1);
  });

  it("les vitrines génériques savent l'horaire de leur commerce", () => {
    const { terrain, tile } = loadRealWorld();
    const plan = planFacades(tile.buildings, new Map(tile.fiches.map((f) => [f.id, f])), terrain);
    const shops = plan.placements.filter((p) => p.key.startsWith("shop|"));
    expect(shops.length).toBeGreaterThan(20);
    for (const p of shops) {
      expect(p.sched).toBeGreaterThanOrEqual(0);
      expect(p.sched).toBeLessThan(SCHEDULES.length);
    }
    expect(new Set(shops.map((p) => p.sched)).size).toBeGreaterThan(2);
  }, 30000);

  it("une devanture dessine un rideau de fer par baie, étiqueté par son horaire", () => {
    const { tile } = loadRealWorld();
    const fiche = tile.fiches.find((f) => f.ground.devanture)!;
    const shutters = new MeshBuilder(true), glow = new MeshBuilder(true);
    const tag = TAG.shop + scheduleOf("bakery");
    shutters.tag = glow.tag = tag;
    setShutterTarget(shutters);
    const f = { x: 0, y: 0, z: 0, tx: 1, ty: 0, nx: 0, ny: -1, key: "essai", atlas: "facade" as const };
    buildDevanture(new MeshBuilder(), glow, null, f, fiche.ground.devanture!, "#7f93c0");
    setShutterTarget(null);
    expect(shutters.triangleCount).toBeGreaterThan(0);
    expect(new Set(shutters.tags)).toEqual(new Set([tag]));
    expect(new Set(glow.tags)).toEqual(new Set([tag]));
  });
});
