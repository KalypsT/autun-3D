import * as THREE from "three";
import type { Terrain } from "../data/terrain";
import type { GroundMeta } from "../data/types";

/** Couleurs de la palette de ground.png -> classe de sol (cf. tools/data/build_streets.py). */
const PALETTE: [number, number, number][] = [
  [170, 165, 155], [70, 70, 74], [150, 148, 142], [120, 112, 104], [190, 175, 150], [80, 120, 60], [30, 30, 30], [160, 150, 140],
];

const GROUND_TEXTURES = ["asphalt", "sett", "gravel", "grass", "sidewalk", "paving"] as const;

function loadTexture(url: string): Promise<THREE.Texture> {
  return new Promise((resolve, reject) => {
    new THREE.TextureLoader().load(
      url,
      (t) => {
        t.wrapS = t.wrapT = THREE.RepeatWrapping;
        t.colorSpace = THREE.SRGBColorSpace;
        t.anisotropy = 8;
        resolve(t);
      },
      undefined,
      () => reject(new Error(`texture introuvable : ${url}`)),
    );
  });
}

/** Poids de mélange par classe (demi-résolution, filtrés) et occlusion près des bâtiments. */
function buildWeights(groundImage: HTMLImageElement): { a: THREE.DataTexture; b: THREE.DataTexture } {
  const W = groundImage.naturalWidth, H = groundImage.naturalHeight;
  const cv = document.createElement("canvas");
  cv.width = W;
  cv.height = H;
  const ctx = cv.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(groundImage, 0, 0);
  const px = ctx.getImageData(0, 0, W, H).data;
  const cls = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) {
    let best = 0, bd = Infinity;
    for (let k = 0; k < PALETTE.length; k++) {
      const p = PALETTE[k]!;
      const d = (px[4 * i]! - p[0]) ** 2 + (px[4 * i + 1]! - p[1]) ** 2 + (px[4 * i + 2]! - p[2]) ** 2;
      if (d < bd) {
        bd = d;
        best = k;
      }
    }
    cls[i] = best;
  }
  const w = W >> 1, h = H >> 1;
  const A = new Uint8Array(w * h * 4), B = new Uint8Array(w * h * 4);
  const bmask = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const acc = [0, 0, 0, 0, 0, 0]; // asphalte, pavés, gravier, herbe, trottoir, dallage
      let building = 0;
      for (let dy = 0; dy < 2; dy++) {
        for (let dx = 0; dx < 2; dx++) {
          const c = cls[(2 * y + dy) * W + 2 * x + dx]!;
          if (c === 6) building++;
          const slot = c === 1 ? 0 : c === 3 ? 1 : c === 4 ? 2 : c === 5 ? 3 : c === 2 ? 4 : 5;
          acc[slot]!++;
        }
      }
      const o = 4 * (y * w + x);
      for (let k = 0; k < 4; k++) A[o + k] = (acc[k]! / 4) * 255;
      B[o] = (acc[4]! / 4) * 255;
      bmask[y * w + x] = building / 4;
    }
  }
  // Occlusion : flou de boîte du masque des bâtiments (≈ 3 m), appliqué hors des bâtiments.
  const blur = (src: Float32Array, r: number): Float32Array => {
    const tmp = new Float32Array(src.length), out = new Float32Array(src.length);
    for (let y = 0; y < h; y++) {
      let sum = 0;
      for (let x = -r; x <= r; x++) sum += src[y * w + Math.min(Math.max(x, 0), w - 1)]!;
      for (let x = 0; x < w; x++) {
        tmp[y * w + x] = sum / (2 * r + 1);
        sum += src[y * w + Math.min(x + r + 1, w - 1)]! - src[y * w + Math.max(x - r, 0)]!;
      }
    }
    for (let x = 0; x < w; x++) {
      let sum = 0;
      for (let y = -r; y <= r; y++) sum += tmp[Math.min(Math.max(y, 0), h - 1) * w + x]!;
      for (let y = 0; y < h; y++) {
        out[y * w + x] = sum / (2 * r + 1);
        sum += tmp[Math.min(y + r + 1, h - 1) * w + x]! - tmp[Math.max(y - r, 0) * w + x]!;
      }
    }
    return out;
  };
  const soft = blur(blur(bmask, 2), 2);
  for (let i = 0; i < w * h; i++) B[4 * i + 2] = Math.min(1, soft[i]! * 2.2) * 255 * (bmask[i]! > 0.5 ? 0 : 1);
  const mk = (data: Uint8Array): THREE.DataTexture => {
    const t = new THREE.DataTexture(data, w, h, THREE.RGBAFormat);
    t.magFilter = THREE.LinearFilter;
    t.minFilter = THREE.LinearFilter;
    t.generateMipmaps = false;
    t.flipY = true;
    t.needsUpdate = true;
    return t;
  };
  return { a: mk(A), b: mk(B) };
}

/** Maillage du relief (une maille tous les `step` mètres), habillé des matières de sol et bordé d'une jupe. */
export async function buildTerrain(terrain: Terrain, groundMeta: GroundMeta, groundImage: HTMLImageElement, step = 2): Promise<THREE.Group> {
  const nx = Math.floor((terrain.xMax - terrain.xMin) / step) + 1;
  const ny = Math.floor((terrain.yMax - terrain.yMin) / step) + 1;
  const pos = new Float32Array(nx * ny * 3);
  const uv = new Float32Array(nx * ny * 2);
  const gw = groundMeta.cols * groundMeta.res;
  const gh = groundMeta.rows * groundMeta.res;
  const gy0 = groundMeta.y1 - gh;
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const x = terrain.xMin + i * step;
      const y = terrain.yMin + j * step;
      const k = j * nx + i;
      pos[3 * k] = x;
      pos[3 * k + 1] = terrain.heightAt(x, y);
      pos[3 * k + 2] = -y;
      uv[2 * k] = (x - groundMeta.x0) / gw;
      uv[2 * k + 1] = (y - gy0) / gh;
    }
  }
  const index: number[] = [];
  for (let j = 0; j < ny - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const a = j * nx + i, b = a + 1, c = a + nx, d = c + 1;
      index.push(a, b, c, b, d, c);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  g.setIndex(index);
  g.computeVertexNormals();

  const [textures, weights] = await Promise.all([
    Promise.all(GROUND_TEXTURES.map((n) => loadTexture(`${import.meta.env.BASE_URL}textures/ground/${n}.jpg`))),
    Promise.resolve(buildWeights(groundImage)),
  ]);
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.95, metalness: 0 });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms["wA"] = { value: weights.a };
    shader.uniforms["wB"] = { value: weights.b };
    textures.forEach((t, i) => (shader.uniforms[`t${i}`] = { value: t }));
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec2 vG;\nvarying vec2 vW;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvG = uv;\nvW = position.xz;");
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
varying vec2 vG; varying vec2 vW;
uniform sampler2D wA; uniform sampler2D wB;
uniform sampler2D t0; uniform sampler2D t1; uniform sampler2D t2; uniform sampler2D t3; uniform sampler2D t4; uniform sampler2D t5;
vec3 tile(sampler2D t, vec2 p, float s) { return mix(texture2D(t, p / s).rgb, texture2D(t, p / (s * 3.7) + 0.31).rgb, 0.4); }`,
      )
      .replace(
        "#include <map_fragment>",
        `vec4 a = texture2D(wA, vG); vec4 b = texture2D(wB, vG);
float pav = max(1.0 - (a.r + a.g + a.b + a.a + b.r), 0.0);
vec3 gcol = a.r * tile(t0, vW, 3.0) * 1.15 + a.g * tile(t1, vW, 2.4) + a.b * tile(t2, vW, 2.6) * 1.1
          + a.a * tile(t3, vW, 2.2) * 0.9 + b.r * tile(t4, vW, 2.4) + pav * tile(t5, vW, 2.8);
gcol *= 1.0 - 0.5 * b.b;
diffuseColor.rgb *= gcol;`,
      );
  };
  const mesh = new THREE.Mesh(g, mat);
  mesh.receiveShadow = true;

  // Jupe : le relief ne flotte pas, il est posé sur un socle de terre.
  const skirt: number[] = [];
  const bottom = terrain.meta.zmin - 18;
  const edge = (pts: [number, number][]): void => {
    for (let i = 0; i < pts.length - 1; i++) {
      const [x0, y0] = pts[i]!, [x1, y1] = pts[i + 1]!;
      const h0 = terrain.heightAt(x0, y0), h1 = terrain.heightAt(x1, y1);
      skirt.push(x0, h0, -y0, x1, h1, -y1, x1, bottom, -y1, x0, h0, -y0, x1, bottom, -y1, x0, bottom, -y0);
    }
  };
  const side = (fixed: number, from: number, to: number, horizontal: boolean): [number, number][] => {
    const pts: [number, number][] = [];
    for (let v = from; v < to; v += step) pts.push(horizontal ? [v, fixed] : [fixed, v]);
    pts.push(horizontal ? [to, fixed] : [fixed, to]);
    return pts;
  };
  edge(side(terrain.yMin, terrain.xMin, terrain.xMax, true));
  edge(side(terrain.yMax, terrain.xMin, terrain.xMax, true));
  edge(side(terrain.xMin, terrain.yMin, terrain.yMax, false));
  edge(side(terrain.xMax, terrain.yMin, terrain.yMax, false));
  const sg = new THREE.BufferGeometry();
  sg.setAttribute("position", new THREE.Float32BufferAttribute(skirt, 3));
  sg.computeVertexNormals();
  const skirtMesh = new THREE.Mesh(sg, new THREE.MeshStandardMaterial({ color: "#6b5d4a", roughness: 1, side: THREE.DoubleSide }));

  const group = new THREE.Group();
  group.add(mesh, skirtMesh);
  return group;
}
