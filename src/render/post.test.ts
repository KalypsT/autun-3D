import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { PostFx } from "./post";

/** Faux moteur de rendu : sans WebGL, juste ce que `PostFx` lit et appelle. */
function fakeRenderer(halfFloat: boolean): { renderer: THREE.WebGLRenderer; renders: (string | null)[] } {
  const renders: (string | null)[] = [];
  let target: THREE.WebGLRenderTarget | null = null;
  const renderer = {
    capabilities: { isWebGL2: true },
    extensions: { has: (e: string) => halfFloat && e === "EXT_color_buffer_float" },
    info: { autoReset: true },
    getDrawingBufferSize: (v: THREE.Vector2) => v.set(800, 400),
    setRenderTarget: (t: THREE.WebGLRenderTarget | null) => { target = t; },
    render: (o: THREE.Object3D) => { renders.push(o instanceof THREE.Scene ? (target ? "scène→cible" : "scène→écran") : target ? `passe ${target.width}` : "passe→écran"); },
  } as unknown as THREE.WebGLRenderer;
  return { renderer, renders };
}

describe("effets d'image (D314)", () => {
  it("niveau 0 : la scène va directement à l'écran, comme avant", () => {
    const { renderer, renders } = fakeRenderer(true);
    new PostFx(renderer, 0).render(new THREE.Scene(), new THREE.PerspectiveCamera());
    expect(renders).toEqual(["scène→écran"]);
  });

  it("couleurs : la scène dans la cible, puis une seule passe vers l'écran ; de jour, le halo ne coûte rien", () => {
    const { renderer, renders } = fakeRenderer(true);
    const post = new PostFx(renderer, 2);
    post.bloom = 0;
    post.render(new THREE.Scene(), new THREE.PerspectiveCamera());
    expect(renders).toEqual(["scène→cible", "passe→écran"]);
    expect(post.bloomPasses).toBe(0);
  });

  it("la nuit : le halo est calculé en demi-définition et moins, jamais en pleine définition", () => {
    const { renderer, renders } = fakeRenderer(true);
    const post = new PostFx(renderer, 2);
    post.bloom = 1;
    post.render(new THREE.Scene(), new THREE.PerspectiveCamera());
    const widths = renders.filter((r) => r!.startsWith("passe ")).map((r) => Number(r!.slice(6)));
    expect(widths.length).toBe(post.bloomPasses);
    expect(Math.max(...widths)).toBe(400);
    expect(renders.at(-1)).toBe("passe→écran");
    // Au niveau 1 (couleurs seules), pas de halo même la nuit.
    post.level = 1;
    renders.length = 0;
    post.render(new THREE.Scene(), new THREE.PerspectiveCamera());
    expect(renders).toEqual(["scène→cible", "passe→écran"]);
  });

  it("sans cible en demi-flottants, les effets restent coupés", () => {
    const { renderer, renders } = fakeRenderer(false);
    const post = new PostFx(renderer, 2);
    expect(post.level).toBe(0);
    post.render(new THREE.Scene(), new THREE.PerspectiveCamera());
    expect(renders).toEqual(["scène→écran"]);
  });

  it("three.js rend dans une cible marquée « réalité virtuelle » comme à l'écran (rendu des couleurs et sRGB) : la cible de la scène s'en sert", () => {
    const src = readFileSync("node_modules/three/build/three.module.js", "utf8");
    expect(src).toMatch(/if \( _currentRenderTarget === null \|\| _currentRenderTarget\.isXRRenderTarget === true \) \{\s*toneMapping = _this\.toneMapping;/);
    expect(src).toMatch(/_currentRenderTarget\.isXRRenderTarget === true \? _currentRenderTarget\.texture\.colorSpace/);
  });
});
