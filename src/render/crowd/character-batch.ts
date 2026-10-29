import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { PART_SPECS } from "../../core/character-kit";
import { BONE_COUNT, jointBlend } from "../../core/character-rig";
import { partGeometry, type Lod } from "../character-parts";

/**
 * Lot de personnages dessinés d'un seul appel (D37, approche B : instances et nuanceur).
 * La géométrie « universelle » contient toutes les pièces du catalogue ; chaque sommet connaît son os, sa pièce et son emplacement
 * de couleur. Chaque personnage est une ligne d'une texture de données : les 13 matrices d'os (3 lignes chacune), les 8 couleurs
 * d'emplacement et le masque des pièces présentes. Le nuanceur de sommets applique l'os (peau, souple aux articulations : `jointBlend`),
 * la couleur, et réduit à un point les pièces absentes. Les matrices sont exprimées dans le repère du maillage (`mesh`) : le lot peut donc être enfant d'un groupe
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
in vec3 aSkin;
bool partVisible() {
	vec3 m = texelFetch( uInst, ivec2( ${MASK_AT}, gl_InstanceID ), 0 ).xyz;
	float w = aPart < 22.0 ? m.x : ( aPart < 44.0 ? m.y : m.z );
	return mod( floor( w / exp2( mod( aPart, 22.0 ) ) ), 2.0 ) > 0.5;
}
void boneRows( float bone, out vec4 r0, out vec4 r1, out vec4 r2 ) {
	int b = int( bone + 0.5 ) * 3;
	r0 = texelFetch( uInst, ivec2( b, gl_InstanceID ), 0 );
	r1 = texelFetch( uInst, ivec2( b + 1, gl_InstanceID ), 0 );
	r2 = texelFetch( uInst, ivec2( b + 2, gl_InstanceID ), 0 );
}
// Orientation d'un os : colonnes de sa matrice, débarrassées de l'échelle de la géométrie.
mat3 boneRotation( vec4 r0, vec4 r1, vec4 r2 ) {
	return mat3( normalize( vec3( r0.x, r1.x, r2.x ) ), normalize( vec3( r0.y, r1.y, r2.y ) ), normalize( vec3( r0.z, r1.z, r2.z ) ) );
}
// Tourne v d'une fraction w de la rotation q (même axe, angle × w).
vec3 turnBy( mat3 q, float w, vec3 v ) {
	vec3 axis = vec3( q[ 1 ][ 2 ] - q[ 2 ][ 1 ], q[ 2 ][ 0 ] - q[ 0 ][ 2 ], q[ 0 ][ 1 ] - q[ 1 ][ 0 ] );
	float l = length( axis );
	if ( l < 1e-5 ) return v;
	axis /= l;
	float a = w * acos( clamp( ( q[ 0 ][ 0 ] + q[ 1 ][ 1 ] + q[ 2 ][ 2 ] - 1.0 ) * 0.5, -1.0, 1.0 ) );
	float c = cos( a ), s = sin( a );
	return v * c + cross( axis, v ) * s + axis * dot( axis, v ) * ( 1.0 - c );
}
// Peau (D37, D99) : l'os porteur, puis, près d'une articulation, une rotation partielle vers l'os voisin autour de l'articulation.
// Les pièces absentes sont réduites à un point.
void skin( vec3 p, vec3 n, out vec3 tp, out vec3 tn ) {
	vec4 r0, r1, r2;
	boneRows( aBone, r0, r1, r2 );
	if ( !partVisible() ) {
		tp = vec3( r0.w, r1.w, r2.w );
		tn = vec3( 0.0, 1.0, 0.0 );
		return;
	}
	tp = vec3( dot( r0.xyz, p ) + r0.w, dot( r1.xyz, p ) + r1.w, dot( r2.xyz, p ) + r2.w );
	// Normale sous une échelle non uniforme : M · S⁻² · n est parallèle à R · S⁻¹ · n.
	vec3 c0 = vec3( r0.x, r1.x, r2.x ), c1 = vec3( r0.y, r1.y, r2.y ), c2 = vec3( r0.z, r1.z, r2.z );
	vec3 m = n / vec3( dot( c0, c0 ), dot( c1, c1 ), dot( c2, c2 ) );
	tn = normalize( vec3( dot( r0.xyz, m ), dot( r1.xyz, m ), dot( r2.xyz, m ) ) );
	if ( aSkin.y > 0.0 ) {
		vec4 o0, o1, o2;
		boneRows( aSkin.x, o0, o1, o2 );
		mat3 q = boneRotation( o0, o1, o2 ) * transpose( boneRotation( r0, r1, r2 ) );
		vec3 pivot = aSkin.z > 0.5 ? vec3( o0.w, o1.w, o2.w ) : vec3( r0.w, r1.w, r2.w );
		tp = pivot + turnBy( q, aSkin.y, tp - pivot );
		tn = turnBy( q, aSkin.y, tn );
	}
}
`;

const COLOR_VERTEX = /* glsl */ `
vColor = vec4( 1.0 );
vColor.rgb *= color;
if ( aSlot > -0.5 ) vColor.rgb *= texelFetch( uInst, ivec2( ${COLOR_AT} + int( aSlot + 0.5 ), gl_InstanceID ), 0 ).rgb;
`;

// La normale passe avant la position dans le nuanceur Lambert : la peau est calculée une fois, ici.
const NORMAL_VERTEX = /* glsl */ `
vec3 skinned, objectNormal;
skin( position, normal, skinned, objectNormal );
`;

const POSITION_VERTEX = /* glsl */ `
vec3 transformed = skinned;
`;

const DEPTH_POSITION_VERTEX = /* glsl */ `
vec3 transformed, skinNormal;
skin( position, vec3( 0.0, 1.0, 0.0 ), transformed, skinNormal );
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
      const pos = g.getAttribute("position");
      const skin = new Float32Array(n * 3), w = [0, 0, 0];
      for (let i = 0; i < n; i++) skin.set(jointBlend(bone, pos.getX(i), pos.getY(i), pos.getZ(i), w), i * 3);
      g.setAttribute("aSkin", new THREE.BufferAttribute(skin, 3));
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
        .replace("#include <begin_vertex>", DEPTH_POSITION_VERTEX);
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
