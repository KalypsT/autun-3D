import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { installSunHaze, setSunHaze, sunHazeDir } from "./sun-haze";
import { createSky } from "./sky";

describe("brume teintée par le soleil (D315)", () => {
  installSunHaze();

  it("les morceaux de brouillard de three.js lisent la teinte ; les nuanceurs des matières les incluent toujours", () => {
    expect(THREE.ShaderChunk.fog_fragment).toContain("sunHazeTint( fogColor, vFogDir.xz )");
    expect(THREE.ShaderChunk.fog_vertex).toContain("vFogDir");
    for (const name of ["toon", "lambert", "basic", "points", "sprite"] as const) {
      expect(THREE.ShaderLib[name]!.fragmentShader).toContain("#include <fog_fragment>");
      expect(THREE.ShaderLib[name]!.vertexShader).toContain("#include <fog_vertex>");
    }
  });

  it("chaque matière reçoit les mêmes objets (recopiés par référence) : changer la brume ne touche aucune matière", () => {
    const a = THREE.UniformsUtils.clone(THREE.ShaderLib["toon"]!.uniforms);
    const b = THREE.UniformsUtils.clone(THREE.ShaderLib["lambert"]!.uniforms);
    expect(a["sunHazeDir"]!.value).toBe(sunHazeDir);
    expect(b["sunHazeDir"]!.value).toBe(sunHazeDir);
    setSunHaze(0, -3, 0.7, "#ff7838", "#56508e");
    expect(a["sunHazeDir"]!.value).toMatchObject({ x: 0, z: -1, w: 0.7 });
    const sky = createSky(new THREE.Vector3(0, 1, 0)).material as THREE.ShaderMaterial;
    expect(sky.uniforms["sunHazeDir"]!.value).toBe(sunHazeDir);
    setSunHaze(1, 0, 0, "#fff", "#fff");
    expect(sunHazeDir.w).toBe(0);
  });
});
