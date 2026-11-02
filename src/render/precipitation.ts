import * as THREE from "three";

/**
 * Pluie et neige qui tombent (D196) : un nuage de gouttes (ou de flocons) dans une boîte qui suit la caméra, **un seul appel de dessin**
 * par sorte, et rien à calculer sur le processeur : chaque goutte a une position tirée une fois, que le nuanceur fait tomber avec le
 * temps et replie dans la boîte autour de la caméra. La densité choisit combien de gouttes sont dessinées (les autres sont repoussées
 * hors de l'écran par le nuanceur).
 *
 * Analogie : un aquarium de gouttes porté à bout de bras ; on marche, l'aquarium suit, les gouttes y tombent sans fin.
 */

export interface PrecipitationOptions {
  /** Nombre maximal de gouttes (ou de flocons). */
  count: number;
  /** Taille de la boîte autour de la caméra (m) : largeur, hauteur, profondeur. */
  box: [number, number, number];
  /** Vitesse de chute (m/s). */
  speed: number;
  /** Longueur de la traînée (m) et largeur (m) : une goutte est un trait vertical, un flocon un carré. */
  length: number;
  width: number;
  color: THREE.ColorRepresentation;
  opacity: number;
  /** Flocon (carré qui flotte) plutôt que goutte (trait). */
  snow: boolean;
}

export const RAIN: PrecipitationOptions = { count: 6000, box: [36, 22, 36], speed: 11, length: 0.55, width: 0.016, color: "#c9d6e2", opacity: 0.42, snow: false };
export const SNOW: PrecipitationOptions = { count: 4500, box: [32, 18, 32], speed: 1.1, length: 0.06, width: 0.05, color: "#ffffff", opacity: 0.9, snow: true };

const VERTEX = /* glsl */ `
attribute vec4 seed;
attribute vec2 corner;
uniform float uTime;
uniform float uAmount;
uniform vec3 uBox;
uniform float uSpeed;
uniform float uLength;
uniform float uWidth;
uniform float uSnow;
uniform vec2 uWind;
varying float vFade;
varying float vAlong;
varying vec2 vCorner;
void main() {
  vCorner = corner;
  // Goutte au-delà de la densité voulue : hors de l'écran (le processeur graphique la jette avant de la dessiner).
  if (seed.w > uAmount) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); vFade = 0.0; vAlong = 0.0; return; }
  vec3 p = seed.xyz * uBox;
  float t = uTime * uSpeed * (0.85 + 0.3 * fract(seed.w * 37.0));
  p.y -= t;
  p.xz += uWind * t / uSpeed;
  // Flocons : ils flottent de côté.
  p.x += uSnow * sin(uTime * 0.9 + seed.w * 61.0) * 0.6;
  p.z += uSnow * cos(uTime * 0.7 + seed.w * 43.0) * 0.6;
  // Repliée dans la boîte centrée sur la caméra.
  vec3 rel = mod(p - cameraPosition + 0.5 * uBox, uBox) - 0.5 * uBox;
  vec3 world = cameraPosition + rel;
  vFade = (1.0 - smoothstep(0.3, 0.5, length(rel.xz) / uBox.x)) * smoothstep(0.0, 1.5, length(rel));
  vAlong = corner.y;
  vec4 mv = viewMatrix * vec4(world, 1.0);
  if (uSnow > 0.5) {
    mv.xy += corner * uWidth;
  } else {
    // Trait vertical (penché par le vent), tourné vers la caméra.
    vec3 dir = normalize(vec3(uWind.x, -uSpeed, uWind.y));
    vec3 side = normalize(cross(dir, world - cameraPosition));
    vec3 w = world + dir * (corner.y * uLength) + side * (corner.x * uWidth);
    mv = viewMatrix * vec4(w, 1.0);
  }
  gl_Position = projectionMatrix * mv;
}`;

const FRAGMENT = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity;
uniform float uSnow;
varying float vFade;
varying float vAlong;
varying vec2 vCorner;
void main() {
  // Goutte : plus claire à la tête, effacée à la queue ; flocon : disque aux bords doux.
  float a = uSnow > 0.5 ? smoothstep(1.0, 0.55, length(vCorner)) : 1.0 - abs(vAlong - 0.35) * 1.4;
  gl_FragColor = vec4(uColor, uOpacity * vFade * clamp(a, 0.0, 1.0));
  #include <colorspace_fragment>
}`;

export class Precipitation {
  readonly mesh: THREE.Mesh;
  private readonly material: THREE.ShaderMaterial;

  constructor(readonly opts: PrecipitationOptions, rng: () => number = mulberry(opts.snow ? 17 : 11)) {
    const n = opts.count;
    const seeds = new Float32Array(n * 4 * 4), corners = new Float32Array(n * 4 * 2), index = new Uint32Array(n * 6);
    for (let i = 0; i < n; i++) {
      // La densité dessine les gouttes de rang le plus bas : `w` croît avec le rang, avec un peu de désordre.
      const s = [rng(), rng(), rng(), (i + rng()) / n];
      const c = opts.snow ? [[-1, -1], [1, -1], [1, 1], [-1, 1]] : [[-1, 0], [1, 0], [1, 1], [-1, 1]];
      for (let k = 0; k < 4; k++) {
        seeds.set(s, (i * 4 + k) * 4);
        corners.set(c[k]!, (i * 4 + k) * 2);
      }
      index.set([i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3], i * 6);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("seed", new THREE.BufferAttribute(seeds, 4));
    g.setAttribute("corner", new THREE.BufferAttribute(corners, 2));
    // `position` n'est pas lue, mais three la demande pour compter les sommets.
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(n * 4 * 3), 3));
    g.setIndex(new THREE.BufferAttribute(index, 1));
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      transparent: true,
      depthWrite: false,
      fog: false,
      side: THREE.DoubleSide,
      uniforms: {
        uTime: { value: 0 }, uAmount: { value: 0 }, uBox: { value: new THREE.Vector3(...opts.box) }, uSpeed: { value: opts.speed },
        uLength: { value: opts.length }, uWidth: { value: opts.width }, uSnow: { value: opts.snow ? 1 : 0 }, uWind: { value: new THREE.Vector2(0.8, 0.3) },
        uColor: { value: new THREE.Color(opts.color) }, uOpacity: { value: opts.opacity },
      },
    });
    this.mesh = new THREE.Mesh(g, this.material);
    this.mesh.name = opts.snow ? "neige" : "pluie";
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 5;
    this.mesh.visible = false;
  }

  /** Densité (0 à 1), temps, éclairage (assombrit la nuit) : à chaque image. Invisible (aucun appel de dessin) à densité nulle. */
  update(amount: number, time: number, light: number): void {
    const u = this.material.uniforms;
    this.mesh.visible = amount > 0.005;
    u["uAmount"]!.value = amount;
    // Temps replié pour garder la précision des flottants sur les longues parties (la chute boucle de toute façon).
    u["uTime"]!.value = time % 3600;
    u["uOpacity"]!.value = this.opts.opacity * (0.35 + 0.65 * light);
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}

function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
