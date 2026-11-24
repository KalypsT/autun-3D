import * as THREE from "three";
import { GRADE_GLSL, NEUTRAL_GRADE, type Grade } from "../core/grading";

/** Effets d'image (D314) : 0 aucun (rendu direct, comme avant), 1 couleurs selon l'heure, 2 couleurs et halo lumineux la nuit. */
export type EffectsLevel = 0 | 1 | 2;

/**
 * Niveaux de la chaîne du halo, en fraction de la définition de l'écran : le premier (demi-définition) reçoit les points lumineux,
 * les suivants les étalent de plus en plus loin. Le halo n'est jamais calculé en pleine définition.
 */
const BLOOM_LEVELS = [2, 4, 8, 16, 32];

const VERT = /* glsl */ `varying vec2 vUv; void main() { vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

/** sRGB (l'image de la scène, telle qu'elle irait à l'écran) vers linéaire. */
const DECODE = /* glsl */ `vec3 toLinear(vec3 c) { c = clamp(c, 0.0, 1.0); return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c)); }`;

/** Points lumineux, de l'image pleine définition vers la demi-définition (quatre lectures filtrées : un carré de 4 × 4 pixels). */
const PREFILTER = /* glsl */ `
varying vec2 vUv; uniform sampler2D tSrc; uniform vec2 uTexel; uniform float uThreshold; uniform float uKnee;
${DECODE}
vec4 pick(vec2 o) {
  vec3 c = toLinear(texture2D(tSrc, vUv + o * uTexel).rgb);
  float br = max(c.r, max(c.g, c.b));
  float soft = clamp(br - uThreshold + uKnee, 0.0, 2.0 * uKnee);
  soft = soft * soft / (4.0 * uKnee + 1e-4);
  // Moyenne pondérée par la luminance (Karis) : un pixel isolé très clair ne scintille pas d'une image à l'autre.
  float w = 1.0 / (1.0 + br);
  return vec4(c * max(soft, br - uThreshold) / max(br, 1e-4) * w, w);
}
void main() {
  vec4 s = pick(vec2(-1.0, -1.0)) + pick(vec2(1.0, -1.0)) + pick(vec2(-1.0, 1.0)) + pick(vec2(1.0, 1.0));
  gl_FragColor = vec4(s.rgb / s.a, 1.0);
}`;

/** Réduction (« dual Kawase ») : le centre et quatre diagonales. */
const DOWN = /* glsl */ `
varying vec2 vUv; uniform sampler2D tSrc; uniform vec2 uTexel;
void main() {
  vec3 s = texture2D(tSrc, vUv).rgb * 4.0;
  s += texture2D(tSrc, vUv + vec2(-1.0, -1.0) * uTexel).rgb + texture2D(tSrc, vUv + vec2(1.0, -1.0) * uTexel).rgb;
  s += texture2D(tSrc, vUv + vec2(-1.0, 1.0) * uTexel).rgb + texture2D(tSrc, vUv + vec2(1.0, 1.0) * uTexel).rgb;
  gl_FragColor = vec4(s / 8.0, 1.0);
}`;

/** Agrandissement (« dual Kawase », huit lectures) du niveau plus petit, ajouté au niveau courant. */
const UP = /* glsl */ `
varying vec2 vUv; uniform sampler2D tSrc; uniform sampler2D tCur; uniform vec2 uTexel; uniform float uCur;
void main() {
  vec2 h = uTexel;
  vec3 s = texture2D(tSrc, vUv + vec2(-2.0 * h.x, 0.0)).rgb + texture2D(tSrc, vUv + vec2(2.0 * h.x, 0.0)).rgb;
  s += texture2D(tSrc, vUv + vec2(0.0, -2.0 * h.y)).rgb + texture2D(tSrc, vUv + vec2(0.0, 2.0 * h.y)).rgb;
  s += (texture2D(tSrc, vUv + vec2(-h.x, -h.y)).rgb + texture2D(tSrc, vUv + vec2(h.x, -h.y)).rgb) * 2.0;
  s += (texture2D(tSrc, vUv + vec2(-h.x, h.y)).rgb + texture2D(tSrc, vUv + vec2(h.x, h.y)).rgb) * 2.0;
  gl_FragColor = vec4(s / 12.0 + texture2D(tCur, vUv).rgb * uCur, 1.0);
}`;

/**
 * Passe finale, en pleine définition, vers l'écran : image (déjà rendue en couleurs d'écran, comme avant) ramenée en linéaire, halo
 * ajouté, étalonnage, puis retour en sRGB. Le halo peut être découpé en paliers (`uSteps` > 0 : anneaux nets, comme une affiche).
 */
const COMPOSITE = /* glsl */ `
varying vec2 vUv; uniform sampler2D tScene; uniform sampler2D tBloom; uniform float uBloom; uniform float uSteps;
${DECODE}
${GRADE_GLSL}
void main() {
  vec3 c = toLinear(texture2D(tScene, vUv).rgb);
  if (uBloom > 0.0) {
    vec3 b = texture2D(tBloom, vUv).rgb * uBloom;
    if (uSteps > 0.0) {
      float m = max(b.r, max(b.g, b.b));
      float q = floor(m * uSteps + 0.5) / uSteps;
      b *= m > 1e-4 ? 0.7 * q / m : 0.0;
    }
    c += b;
  }
  gl_FragColor = vec4(gradeColor(c), 1.0);
  #include <colorspace_fragment>
}`;

const material = (fragmentShader: string, uniforms: Record<string, THREE.IUniform>): THREE.ShaderMaterial =>
  new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader, uniforms, depthTest: false, depthWrite: false, toneMapped: false });

/**
 * Cible de la scène : la scène y est rendue **comme à l'écran** (rendu des couleurs « Neutral » et sRGB dans chaque matière), en
 * demi-flottants. Three.js ne fait cela que pour l'écran et les cibles de réalité virtuelle (`isXRRenderTarget`) : on se sert de ce drapeau.
 * Ainsi les voiles translucides (projecteurs, halos au sol, vitres, pluie) se mélangent exactement comme avant ; une cible ordinaire
 * (linéaire) les mélangeait en lumière linéaire, et la façade éclairée de l'hôtel de ville sortait blanche (premier essai). Les
 * demi-flottants gardent le sRGB sans conversion matérielle (pas de format sRGB en demi-flottants). Vérifié par un test sur three.js.
 */
function sceneTarget(samples: number): THREE.WebGLRenderTarget {
  const t = hdrTarget(samples, true);
  t.texture.colorSpace = THREE.SRGBColorSpace;
  (t as THREE.WebGLRenderTarget & { isXRRenderTarget: boolean }).isXRRenderTarget = true;
  return t;
}

/** Cible intermédiaire en demi-flottants (le halo additionné dépasse 1). */
const hdrTarget = (samples = 0, depth = false): THREE.WebGLRenderTarget =>
  new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, format: THREE.RGBAFormat, depthBuffer: depth, stencilBuffer: false, samples, generateMipmaps: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });

/** La carte graphique sait-elle dessiner dans une cible en demi-flottants ? Sinon, pas d'effets. */
export function supportsEffects(renderer: THREE.WebGLRenderer): boolean {
  return renderer.capabilities.isWebGL2 && (renderer.extensions.has("EXT_color_buffer_float") || renderer.extensions.has("EXT_color_buffer_half_float"));
}

/**
 * Effets d'image (D314) : seul point d'entrée du rendu de la scène (jeu, pause, captures, viewer, banc).
 *
 * Niveau 0 : rendu direct à l'écran, rien ne change. Niveaux 1 et 2 : la scène est dessinée dans une cible (pleine définition,
 * MSAA ×`samples`), exactement comme elle le serait à l'écran ; la passe finale y applique l'étalonnage. Au niveau 2, le halo est
 * calculé en demi-définition et moins, à partir des seuls points plus clairs que `threshold` (lumières de la nuit) ; quand l'atmosphère
 * met le halo à zéro (le jour), ses passes ne tournent pas.
 */
export class PostFx {
  /** Force du halo (0 : passes du halo sautées) ; réglée par l'atmosphère selon la nuit. */
  bloom = 0;
  /**
   * Seuil (couleur linéaire, après le rendu des couleurs) et adoucissement. La nuit : murs sous la lune ≈ 0,15 à 0,25, façades des
   * projecteurs ≈ 0,5 à 0,7, fenêtres, lampadaires et phares ≈ 0,9 à 1.
   */
  threshold = 0.68;
  knee = 0.2;
  /** Paliers du halo (0 : dégradé continu ; 3 : anneaux nets autour des lumières, comme sur une affiche). */
  steps = 3;
  /** Force du halo à pleine nuit (multiplie `bloom`). */
  strength = 1;
  private levelValue: EffectsLevel;
  private readonly supported: boolean;
  private scene: THREE.WebGLRenderTarget | null = null;
  private mips: THREE.WebGLRenderTarget[] = [];
  private ups: THREE.WebGLRenderTarget[] = [];
  private readonly size = new THREE.Vector2(-1, -1);
  private readonly quad: THREE.Mesh;
  private readonly cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly prefilter = material(PREFILTER, { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() }, uThreshold: { value: 0.72 }, uKnee: { value: 0.25 } });
  private readonly down = material(DOWN, { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() } });
  private readonly up = material(UP, { tSrc: { value: null }, tCur: { value: null }, uTexel: { value: new THREE.Vector2() }, uCur: { value: 1 } });
  private readonly composite = material(COMPOSITE, {
    tScene: { value: null }, tBloom: { value: null }, uBloom: { value: 0 }, uSteps: { value: 0 },
    uGain: { value: new THREE.Vector3(1, 1, 1) }, uSat: { value: 1 }, uContrast: { value: 1 }, uShadows: { value: new THREE.Vector3() }, uHighlights: { value: new THREE.Vector3() },
  });
  /** Nombre de passes du halo de la dernière image (banc, tests). */
  bloomPasses = 0;

  constructor(
    private readonly renderer: THREE.WebGLRenderer,
    level: EffectsLevel,
    /** Échantillons du MSAA de la cible de la scène (0 : sans ; l'écran natif a son propre MSAA au niveau 0). */
    private samplesValue = 4,
  ) {
    this.supported = supportsEffects(renderer);
    this.levelValue = this.supported ? level : 0;
    const tri = new THREE.BufferGeometry();
    tri.setAttribute("position", new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
    this.quad = new THREE.Mesh(tri, this.composite);
    this.quad.frustumCulled = false;
    this.setGrade(NEUTRAL_GRADE);
  }

  get level(): EffectsLevel {
    return this.levelValue;
  }

  /** Change le niveau (réglage) ; sans prise en charge, reste à 0. Les cibles sont libérées au niveau 0. */
  set level(v: EffectsLevel) {
    this.levelValue = this.supported ? v : 0;
    if (this.levelValue === 0) this.release();
  }

  get samples(): number {
    return this.samplesValue;
  }

  /** Change le MSAA de la cible de la scène (banc) : elle est recréée à la prochaine image. */
  set samples(n: number) {
    if (n === this.samplesValue) return;
    this.samplesValue = n;
    this.scene?.dispose();
    this.scene = null;
  }

  get available(): boolean {
    return this.supported;
  }

  setGrade(grade: Grade): void {
    const u = this.composite.uniforms;
    (u["uGain"]!.value as THREE.Vector3).fromArray(grade.gain);
    u["uSat"]!.value = grade.saturation;
    u["uContrast"]!.value = grade.contrast;
    (u["uShadows"]!.value as THREE.Vector3).fromArray(grade.shadows);
    (u["uHighlights"]!.value as THREE.Vector3).fromArray(grade.highlights);
  }

  /** Dessine la scène, avec les effets du niveau en cours. */
  render(scene: THREE.Scene, camera: THREE.Camera): void {
    const r = this.renderer;
    if (this.levelValue === 0) {
      r.render(scene, camera);
      return;
    }
    this.resize();
    const target = this.scene!;
    r.setRenderTarget(target);
    r.render(scene, camera);
    // Compteurs du rendu (banc, ?debug) : ceux de la scène, plus les passes des effets (sinon, chaque passe les remettrait à zéro).
    const autoReset = r.info.autoReset;
    r.info.autoReset = false;
    const bloom = this.levelValue === 2 ? this.bloom * this.strength : 0;
    this.bloomPasses = 0;
    if (bloom > 0.005) this.renderBloom(target.texture);
    const u = this.composite.uniforms;
    u["tScene"]!.value = target.texture;
    u["tBloom"]!.value = this.ups[0]?.texture ?? null;
    u["uBloom"]!.value = bloom > 0.005 ? bloom : 0;
    u["uSteps"]!.value = this.steps;
    this.pass(this.composite, null);
    r.info.autoReset = autoReset;
  }

  private renderBloom(src: THREE.Texture): void {
    const p = this.prefilter.uniforms;
    p["tSrc"]!.value = src;
    (p["uTexel"]!.value as THREE.Vector2).set(1 / this.size.x, 1 / this.size.y);
    p["uThreshold"]!.value = this.threshold;
    p["uKnee"]!.value = this.knee;
    this.pass(this.prefilter, this.mips[0]!);
    for (let i = 1; i < this.mips.length; i++) {
      const prev = this.mips[i - 1]!;
      this.down.uniforms["tSrc"]!.value = prev.texture;
      (this.down.uniforms["uTexel"]!.value as THREE.Vector2).set(1 / prev.width, 1 / prev.height);
      this.pass(this.down, this.mips[i]!);
    }
    // De bas en haut : chaque niveau agrandit le précédent et y ajoute le sien ; le plus fin (demi-définition) reste dans ups[0].
    let src2 = this.mips[this.mips.length - 1]!;
    for (let i = this.mips.length - 2; i >= 0; i--) {
      const u = this.up.uniforms;
      u["tSrc"]!.value = src2.texture;
      u["tCur"]!.value = this.mips[i]!.texture;
      (u["uTexel"]!.value as THREE.Vector2).set(0.5 / src2.width, 0.5 / src2.height);
      u["uCur"]!.value = i === 0 ? 0.6 : 1;
      this.pass(this.up, this.ups[i]!);
      src2 = this.ups[i]!;
    }
  }

  private pass(mat: THREE.ShaderMaterial, target: THREE.WebGLRenderTarget | null): void {
    this.quad.material = mat;
    this.renderer.setRenderTarget(target);
    this.renderer.render(this.quad, this.cam);
    if (target) this.bloomPasses++;
  }

  /** Cibles à la taille de l'écran (définition comprise), recréées quand elle change. */
  private resize(): void {
    const s = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    if (s.equals(this.size) && this.scene) return;
    this.size.copy(s);
    if (!this.scene) this.scene = sceneTarget(this.samplesValue);
    this.scene.setSize(s.x, s.y);
    if (this.mips.length === 0) {
      this.mips = BLOOM_LEVELS.map(() => hdrTarget());
      this.ups = BLOOM_LEVELS.slice(0, -1).map(() => hdrTarget());
    }
    BLOOM_LEVELS.forEach((d, i) => {
      const w = Math.max(1, Math.round(s.x / d)), h = Math.max(1, Math.round(s.y / d));
      this.mips[i]!.setSize(w, h);
      this.ups[i]?.setSize(w, h);
    });
  }

  private release(): void {
    this.scene?.dispose();
    this.scene = null;
    for (const t of [...this.mips, ...this.ups]) t.dispose();
    this.mips = [];
    this.ups = [];
    this.size.set(-1, -1);
  }

  /** Mémoire des cibles (octets) : banc. */
  get memory(): number {
    if (!this.scene) return 0;
    const px = (t: THREE.WebGLRenderTarget): number => t.width * t.height;
    const sceneBytes = px(this.scene) * (8 * Math.max(1, this.samples) + 4 * Math.max(1, this.samples) + (this.samples > 0 ? 8 : 0));
    return sceneBytes + [...this.mips, ...this.ups].reduce((s, t) => s + px(t) * 8, 0);
  }
}
