import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { PART_SPECS } from "../../core/character-kit";
import { BONE_COUNT } from "../../core/character-rig";
import { partGeometry, type Lod } from "../character-parts";
import { CrowdRigs } from "./crowd-common";
import { NEAR_DISTANCE, type CrowdRenderer, type CrowdState } from "./crowd-types";

/**
 * Approche B : tous les personnages dans un seul appel de dessin (instances), la peau est faite par le processeur graphique.
 * La géométrie « universelle » contient toutes les pièces du catalogue ; chaque sommet connaît son os, sa pièce et son emplacement
 * de couleur. Chaque personnage est une ligne d'une texture de données : les 13 matrices d'os (3 lignes chacune), les 8 couleurs
 * d'emplacement et le masque des pièces présentes. Le nuanceur retire les pièces absentes (triangles réduits à un point).
 * Le processeur ne calcule que la pose (angles) et la cinématique directe, comme dans l'approche C.
 */

const ROW = 48;
const COLOR_AT = BONE_COUNT * 3;
const MASK_AT = ROW - 1;

const HEADER = /* glsl */ `
uniform highp sampler2D uInst;
in float aBone;
in float aPart;
in float aSlot;
bool partVisible() {
	vec3 m = texelFetch( uInst, ivec2( ${MASK_AT}, gl_InstanceID ), 0 ).xyz;
	float w = aPart < 22.0 ? m.x : ( aPart < 44.0 ? m.y : m.z );
	return mod( floor( w / exp2( mod( aPart, 22.0 ) ) ), 2.0 ) > 0.5;
}
void boneRows( out vec4 r0, out vec4 r1, out vec4 r2 ) {
	int b = int( aBone + 0.5 ) * 3;
	r0 = texelFetch( uInst, ivec2( b, gl_InstanceID ), 0 );
	r1 = texelFetch( uInst, ivec2( b + 1, gl_InstanceID ), 0 );
	r2 = texelFetch( uInst, ivec2( b + 2, gl_InstanceID ), 0 );
}
`;

const COLOR_VERTEX = /* glsl */ `
vColor = vec4( 1.0 );
vColor.rgb *= color;
if ( aSlot > -0.5 ) vColor.rgb *= texelFetch( uInst, ivec2( ${COLOR_AT} + int( aSlot + 0.5 ), gl_InstanceID ), 0 ).rgb;
`;

const NORMAL_VERTEX = /* glsl */ `
vec3 objectNormal = vec3( normal );
{
	vec4 r0, r1, r2;
	boneRows( r0, r1, r2 );
	objectNormal = normalize( vec3( dot( r0.xyz, normal ), dot( r1.xyz, normal ), dot( r2.xyz, normal ) ) );
}
`;

const POSITION_VERTEX = /* glsl */ `
vec3 transformed = vec3( position );
{
	vec4 r0, r1, r2;
	boneRows( r0, r1, r2 );
	if ( partVisible() ) transformed = vec3( dot( r0.xyz, position ) + r0.w, dot( r1.xyz, position ) + r1.w, dot( r2.xyz, position ) + r2.w );
	else transformed = vec3( r0.w, r1.w, r2.w );
}
`;

/** Géométrie universelle d'un niveau de détail : toutes les pièces du catalogue, un exemplaire par os porteur. */
function universalGeometry(lod: Lod): THREE.InstancedBufferGeometry {
  const pieces: THREE.BufferGeometry[] = [];
  PART_SPECS.forEach((spec, s) => {
    const shape = partGeometry(spec, lod);
    if (!shape) return;
    for (const bone of spec.bones) {
      const g = shape.clone();
      const n = g.getAttribute("position").count;
      g.setAttribute("aBone", new THREE.BufferAttribute(new Float32Array(n).fill(bone), 1));
      g.setAttribute("aPart", new THREE.BufferAttribute(new Float32Array(n).fill(s), 1));
      g.setAttribute("aSlot", new THREE.BufferAttribute(new Float32Array(n).fill(spec.slot), 1));
      pieces.push(g);
    }
  });
  const merged = mergeGeometries(pieces)!;
  pieces.forEach((p) => p.dispose());
  const instanced = new THREE.InstancedBufferGeometry();
  instanced.copy(merged as THREE.BufferGeometry as THREE.InstancedBufferGeometry);
  merged.dispose();
  return instanced;
}

interface Layer {
  mesh: THREE.Mesh;
  geometry: THREE.InstancedBufferGeometry;
  texture: THREE.DataTexture;
  data: Float32Array;
  count: number;
}

export function createShaderCrowd(scene: THREE.Scene, state: CrowdState): CrowdRenderer {
  const rigs = new CrowdRigs(state.recipes);
  const group = new THREE.Group();
  scene.add(group);

  const layers = ([0, 1] as const).map((lod): Layer => {
    const geometry = universalGeometry(lod);
    const data = new Float32Array(ROW * 4 * Math.max(1, state.count));
    const texture = new THREE.DataTexture(data, ROW, Math.max(1, state.count), THREE.RGBAFormat, THREE.FloatType);
    texture.minFilter = texture.magFilter = THREE.NearestFilter;
    texture.generateMipmaps = false;
    texture.needsUpdate = true;
    const uniforms = { uInst: { value: texture } };
    const material = new THREE.MeshLambertMaterial({ vertexColors: true });
    material.onBeforeCompile = (shader) => {
      shader.uniforms["uInst"] = uniforms.uInst;
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", `#include <common>\n${HEADER}`)
        .replace("#include <color_vertex>", COLOR_VERTEX)
        .replace("#include <beginnormal_vertex>", NORMAL_VERTEX)
        .replace("#include <begin_vertex>", POSITION_VERTEX);
    };
    material.customProgramCacheKey = () => "crowd-shader-lambert";
    const depth = new THREE.MeshDepthMaterial();
    depth.onBeforeCompile = (shader) => {
      shader.uniforms["uInst"] = uniforms.uInst;
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", `#include <common>\n${HEADER}`)
        .replace("#include <begin_vertex>", POSITION_VERTEX);
    };
    depth.customProgramCacheKey = () => "crowd-shader-depth";
    const mesh = new THREE.Mesh(geometry, material);
    mesh.customDepthMaterial = depth;
    mesh.frustumCulled = false;
    mesh.castShadow = lod === 0;
    mesh.visible = false;
    group.add(mesh);
    return { mesh, geometry, texture, data, count: 0 };
  });

  let near = 0, far = 0;
  return {
    name: "B · instances et nuanceur",
    update(st, camX, camZ) {
      layers[0]!.count = layers[1]!.count = 0;
      near = far = 0;
      const nd2 = NEAR_DISTANCE * NEAR_DISTANCE;
      for (let i = 0; i < st.count; i++) {
        const dx = st.x[i]! - camX, dz = st.z[i]! - camZ;
        const lod = dx * dx + dz * dz < nd2 ? 0 : 1;
        if (lod === 0) near++;
        else far++;
        const layer = layers[lod]!;
        const row = layer.count++ * ROW * 4;
        rigs.solve(st, i);
        const d = layer.data, m = rigs.render;
        for (let b = 0; b < BONE_COUNT; b++) {
          const src = b * 16, dst = row + b * 12;
          // Trois lignes de la matrice affine : (m[0], m[4], m[8], m[12]), etc.
          for (let r = 0; r < 3; r++) {
            d[dst + r * 4] = m[src + r]!;
            d[dst + r * 4 + 1] = m[src + 4 + r]!;
            d[dst + r * 4 + 2] = m[src + 8 + r]!;
            d[dst + r * 4 + 3] = m[src + 12 + r]!;
          }
        }
        const colors = rigs.colors[i]!;
        for (let k = 0; k < 8; k++) {
          d[row + (COLOR_AT + k) * 4] = colors[k * 3]!;
          d[row + (COLOR_AT + k) * 4 + 1] = colors[k * 3 + 1]!;
          d[row + (COLOR_AT + k) * 4 + 2] = colors[k * 3 + 2]!;
          d[row + (COLOR_AT + k) * 4 + 3] = 1;
        }
        const mask = rigs.masks[i]!;
        d[row + MASK_AT * 4] = mask[0]!;
        d[row + MASK_AT * 4 + 1] = mask[1]!;
        d[row + MASK_AT * 4 + 2] = mask[2]!;
      }
      for (const layer of layers) {
        layer.geometry.instanceCount = layer.count;
        layer.mesh.visible = layer.count > 0;
        layer.texture.needsUpdate = true;
      }
    },
    setShadows(on) {
      layers[0]!.mesh.castShadow = on;
    },
    lodCounts: () => ({ near, far }),
    dispose() {
      scene.remove(group);
      for (const l of layers) {
        l.geometry.dispose();
        l.texture.dispose();
        (l.mesh.material as THREE.Material).dispose();
        l.mesh.customDepthMaterial?.dispose();
      }
    },
  };
}
