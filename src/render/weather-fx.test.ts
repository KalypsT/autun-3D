import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { Precipitation, RAIN, SNOW } from "./precipitation";
import { crownDepthMaterial, setGroundWeather, setSeasonLook, weatherize, weatherUniforms } from "./weather-fx";

/** Le programme tel que `onBeforeCompile` le reçoit (avec ses `#include` pas encore dépliés, D116). */
function compile(mat: THREE.Material, lib: "toon" | "lambert" | "standard"): THREE.WebGLProgramParametersWithUniforms {
  const src = (lib === "standard" ? THREE.ShaderLib.physical : lib === "toon" ? THREE.ShaderLib.toon : THREE.ShaderLib.lambert)!;
  const shader = { vertexShader: src.vertexShader, fragmentShader: src.fragmentShader, uniforms: {} } as unknown as THREE.WebGLProgramParametersWithUniforms;
  mat.onBeforeCompile(shader, null as unknown as THREE.WebGLRenderer);
  return shader;
}

describe("météo à l'écran : matières patinées (D196)", () => {
  it("chaque ligne remplacée existe dans les nuanceurs de Three.js (toon, lambert, standard)", () => {
    for (const lib of ["toon", "lambert", "standard"] as const) {
      const src = (lib === "standard" ? THREE.ShaderLib.physical : lib === "toon" ? THREE.ShaderLib.toon : THREE.ShaderLib.lambert)!;
      for (const inc of ["#include <common>", "#include <begin_vertex>"]) expect(src.vertexShader).toContain(inc);
      for (const inc of ["#include <common>", "#include <color_fragment>", "#include <emissivemap_fragment>"]) expect(src.fragmentShader).toContain(inc);
    }
  });

  it("le nuanceur reçoit les uniformes partagés et le code du sol ; les flaques seulement au sol", () => {
    const ground = compile(weatherize(new THREE.MeshToonMaterial(), "ground"), "toon");
    expect(ground.uniforms["uWet"]).toBe(weatherUniforms.uWet);
    expect(ground.uniforms["uSnow"]).toBe(weatherUniforms.uSnow);
    expect(ground.vertexShader).toContain("vWxPos = wxP.xyz;");
    expect(ground.fragmentShader).toContain("wxPuddle = uWet");
    expect(ground.fragmentShader).toContain("totalEmissiveRadiance += uSkyTint");
    const roof = compile(weatherize(new THREE.MeshLambertMaterial(), "roof"), "lambert");
    expect(roof.fragmentShader).not.toContain("wxPuddle = uWet");
    expect(roof.fragmentShader).toContain("wxCover");
    const crown = compile(weatherize(new THREE.MeshStandardMaterial(), "crown"), "standard");
    expect(crown.fragmentShader).not.toContain("totalEmissiveRadiance += uSkyTint");
  });

  it("le nuanceur d'origine est gardé, et chaque sorte de surface a sa propre clé de programme", () => {
    const m = new THREE.MeshToonMaterial();
    m.onBeforeCompile = (s) => { s.fragmentShader = s.fragmentShader.replace("#include <common>", "#include <common>\n// a moi"); };
    m.customProgramCacheKey = () => "moi";
    const s = compile(weatherize(m, "ground"), "toon");
    expect(s.fragmentShader).toContain("// a moi");
    expect(m.customProgramCacheKey()).toBe("moi|wx-ground");
    const a = weatherize(new THREE.MeshToonMaterial(), "wall"), b = weatherize(new THREE.MeshToonMaterial(), "roof");
    expect(a.customProgramCacheKey()).not.toBe(b.customProgramCacheKey());
  });

  it("changer la météo ne touche qu'aux uniformes partagés (aucune matière à recompiler)", () => {
    const m = weatherize(new THREE.MeshToonMaterial(), "ground");
    const version = m.version;
    setGroundWeather(0.7, 0.2, new THREE.Color(0.5, 0.6, 0.7));
    expect(weatherUniforms.uWet.value).toBe(0.7);
    expect(weatherUniforms.uSnow.value).toBe(0.2);
    expect(m.version).toBe(version);
    setGroundWeather(0, 0, new THREE.Color());
  });
});

describe("saisons à l'écran (D197)", () => {
  it("le feuillage rétrécit (instances seulement) et s'ajoure ; son ombre aussi", () => {
    const crown = compile(weatherize(new THREE.MeshToonMaterial(), "crown"), "toon");
    expect(crown.uniforms["uLeaf"]).toBe(weatherUniforms.uLeaf);
    expect(crown.vertexShader).toContain("transformed *= 1.0 - 0.3 * vWxBare;");
    expect(crown.fragmentShader).toContain("discard");
    const depth = crownDepthMaterial();
    const lib = THREE.ShaderLib.depth!;
    expect(lib.fragmentShader).toContain("#include <alphatest_fragment>");
    const shader = { vertexShader: lib.vertexShader, fragmentShader: lib.fragmentShader, uniforms: {} } as unknown as THREE.WebGLProgramParametersWithUniforms;
    depth.onBeforeCompile(shader, null as unknown as THREE.WebGLRenderer);
    expect(shader.vertexShader).toContain("vWxBare");
    expect(shader.fragmentShader).toContain("discard");
    expect(shader.uniforms["uLeaf"]).toBe(weatherUniforms.uLeaf);
  });

  it("le sol reçoit l'herbe et les feuilles mortes ; la saison ne touche qu'aux uniformes", () => {
    const ground = compile(weatherize(new THREE.MeshLambertMaterial(), "ground"), "lambert");
    expect(ground.fragmentShader).toContain("wxGrass");
    expect(ground.fragmentShader).toContain("wxLeaf");
    setSeasonLook({ fresh: 0.1, turn: 0.2, bare: 0.3, dry: 0.4, dull: 0.5, litter: 0.6 });
    expect(weatherUniforms.uLeaf.value.toArray()).toEqual([0.1, 0.2, 0.3, 0.4]);
    expect(weatherUniforms.uSoil.value.toArray()).toEqual([0.6, 0.5]);
    setSeasonLook({ fresh: 0, turn: 0, bare: 0, dry: 0, dull: 0, litter: 0 });
  });
});

describe("pluie et neige qui tombent (D196)", () => {
  it("un seul maillage par sorte, quatre sommets et deux triangles par goutte", () => {
    for (const opts of [RAIN, SNOW]) {
      const p = new Precipitation(opts);
      expect(p.mesh.geometry.getIndex()!.count).toBe(opts.count * 6);
      expect(p.mesh.geometry.getAttribute("seed").count).toBe(opts.count * 4);
      p.dispose();
    }
  });

  it("invisible (aucun appel de dessin) sans pluie ; la densité choisit les gouttes dessinées", () => {
    const p = new Precipitation(RAIN);
    p.update(0, 10, 1);
    expect(p.mesh.visible).toBe(false);
    p.update(0.5, 10, 1);
    expect(p.mesh.visible).toBe(true);
    // Le rang de chaque goutte (`seed.w`) croît : à mi-densité, la moitié des gouttes passe le seuil.
    const w = p.mesh.geometry.getAttribute("seed") as THREE.BufferAttribute;
    let under = 0;
    for (let i = 0; i < RAIN.count; i++) if (w.getW(i * 4) <= 0.5) under++;
    expect(Math.abs(under - RAIN.count / 2)).toBeLessThan(2);
    p.dispose();
  });
});
