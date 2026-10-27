import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { PART_SPECS } from "../../core/character-kit";
import { BONE_COUNT } from "../../core/character-rig";
import { partGeometry, type Lod } from "../character-parts";

/**
 * Lot de personnages dessinés d'un seul appel (D37, approche B : instances et nuanceur).
 * La géométrie « universelle » contient toutes les pièces du catalogue ; chaque sommet connaît son os, sa pièce et son emplacement
 * de couleur. Chaque personnage est une ligne d'une texture de données : les 13 matrices d'os (3 lignes chacune), les 8 couleurs
 * d'emplacement et le masque des pièces présentes. Le nuanceur de sommets applique l'os (peau), la couleur, et réduit à un point
 * les pièces absentes. Les matrices sont exprimées dans le repère du maillage (`mesh`) : le lot peut donc être enfant d'un groupe
 * qui bouge (le joueur sur son véhicule) ou rester à l'origine de la scène (la foule, en coordonnées du monde).
 */

export const ROW = 48;
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

export class CharacterBatch {
  readonly mesh: THREE.Mesh;
  private readonly geometry: THREE.InstancedBufferGeometry;
  private readonly texture: THREE.DataTexture;
  private readonly data: Float32Array;
  private readonly material: THREE.MeshLambertMaterial;
  private readonly depth: THREE.MeshDepthMaterial;
  /** Personnages écrits depuis le dernier `clear`. */
  count = 0;

  constructor(lod: Lod, readonly capacity: number) {
    const cap = Math.max(1, capacity);
    this.geometry = universalGeometry(lod);
    this.data = new Float32Array(ROW * 4 * cap);
    this.texture = new THREE.DataTexture(this.data, ROW, cap, THREE.RGBAFormat, THREE.FloatType);
    this.texture.minFilter = this.texture.magFilter = THREE.NearestFilter;
    this.texture.generateMipmaps = false;
    this.texture.needsUpdate = true;
    const uniform = { value: this.texture };
    this.material = new THREE.MeshLambertMaterial({ vertexColors: true });
    this.material.onBeforeCompile = (shader) => {
      shader.uniforms["uInst"] = uniform;
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", `#include <common>\n${HEADER}`)
        .replace("#include <color_vertex>", COLOR_VERTEX)
        .replace("#include <beginnormal_vertex>", NORMAL_VERTEX)
        .replace("#include <begin_vertex>", POSITION_VERTEX);
    };
    this.material.customProgramCacheKey = () => "character-batch-lambert";
    this.depth = new THREE.MeshDepthMaterial();
    this.depth.onBeforeCompile = (shader) => {
      shader.uniforms["uInst"] = uniform;
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", `#include <common>\n${HEADER}`)
        .replace("#include <begin_vertex>", POSITION_VERTEX);
    };
    this.depth.customProgramCacheKey = () => "character-batch-depth";
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.customDepthMaterial = this.depth;
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = lod === 0;
    this.mesh.visible = false;
  }

  clear(): void {
    this.count = 0;
  }

  /**
   * Ajoute un personnage : matrices de rendu des 13 os (13 × 16, colonnes), couleurs d'emplacement (8 × 3) et masque de pièces (3 mots).
   * Ignoré quand le lot est plein.
   */
  push(bones: Float32Array, colors: Float32Array, mask: Float32Array): void {
    if (this.count >= this.capacity) return;
    const d = this.data, row = this.count++ * ROW * 4;
    for (let b = 0; b < BONE_COUNT; b++) {
      const src = b * 16, dst = row + b * 12;
      // Trois lignes de la matrice affine : (m[0], m[4], m[8], m[12]), etc.
      for (let r = 0; r < 3; r++) {
        d[dst + r * 4] = bones[src + r]!;
        d[dst + r * 4 + 1] = bones[src + 4 + r]!;
        d[dst + r * 4 + 2] = bones[src + 8 + r]!;
        d[dst + r * 4 + 3] = bones[src + 12 + r]!;
      }
    }
    for (let k = 0; k < 8; k++) {
      d[row + (COLOR_AT + k) * 4] = colors[k * 3]!;
      d[row + (COLOR_AT + k) * 4 + 1] = colors[k * 3 + 1]!;
      d[row + (COLOR_AT + k) * 4 + 2] = colors[k * 3 + 2]!;
      d[row + (COLOR_AT + k) * 4 + 3] = 1;
    }
    d[row + MASK_AT * 4] = mask[0]!;
    d[row + MASK_AT * 4 + 1] = mask[1]!;
    d[row + MASK_AT * 4 + 2] = mask[2]!;
  }

  /** Publie les personnages écrits : nombre d'instances, visibilité, envoi de la texture. */
  flush(): void {
    this.geometry.instanceCount = this.count;
    this.mesh.visible = this.count > 0;
    this.texture.needsUpdate = true;
  }

  dispose(): void {
    this.geometry.dispose();
    this.texture.dispose();
    this.material.dispose();
    this.depth.dispose();
  }
}
