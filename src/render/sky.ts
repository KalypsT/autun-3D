import * as THREE from "three";

export const HORIZON = new THREE.Color("#bfd2e4");

/** Ciel : dégradé horizon → zénith, voile chaud autour du soleil. Le dôme suit la caméra. */
export function createSky(sunDir: THREE.Vector3): THREE.Mesh {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      sun: { value: sunDir.clone().normalize() },
      horizon: { value: HORIZON.clone() },
      zenith: { value: new THREE.Color("#4a84c4") },
      mid: { value: new THREE.Color("#8ab4dc") },
      bands: { value: 0 },
      disc: { value: 0 },
      stars: { value: 0 },
      clouds: { value: 0 },
    },
    vertexShader: `varying vec3 vDir; void main() { vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `
      varying vec3 vDir; uniform vec3 sun; uniform vec3 horizon; uniform vec3 zenith; uniform vec3 mid; uniform float bands; uniform float disc; uniform float stars; uniform float clouds;
      float h2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float vnoise(vec2 p) {
        vec2 i = floor(p), f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        return mix(mix(h2(i), h2(i + vec2(1.0, 0.0)), f.x), mix(h2(i + vec2(0.0, 1.0)), h2(i + vec2(1.0, 1.0)), f.x), f.y);
      }
      float cloudField(vec2 p) { return vnoise(p) * 0.55 + vnoise(p * 2.1 + 7.0) * 0.3 + vnoise(p * 4.3 + 3.0) * 0.15; }
      float hash(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
      void main() {
        float h = clamp(vDir.y, 0.0, 1.0);
        if (bands > 0.5) h = floor(h * bands + 0.5) / bands;
        vec3 col = h < 0.4 ? mix(horizon, mid, h / 0.4) : mix(mid, zenith, (h - 0.4) / 0.6);
        float s = max(dot(normalize(vDir), sun), 0.0);
        col += vec3(1.0, 0.85, 0.6) * (pow(s, 6.0) * 0.18 + pow(s, 180.0) * 0.9);
        if (disc > 0.5) col = mix(col, vec3(1.0, 0.96, 0.8), smoothstep(0.9965, 0.9975, s) );
        if (stars > 0.5 && vDir.y > 0.05) { vec3 g = floor(normalize(vDir) * 520.0); float st = step(0.9972, hash(g)); col += vec3(st) * smoothstep(0.05, 0.4, vDir.y); }
        if (clouds > 0.5 && vDir.y > 0.02) {
          vec2 p = vDir.xz / (vDir.y + 0.18) * 0.9;
          float c0 = step(0.6, cloudField(p));
          float c1 = step(0.6, cloudField(p + vec2(0.05, -0.09)));
          vec3 lit = vec3(1.0, 0.95, 0.84), shade = vec3(0.93, 0.74, 0.6);
          float fade = smoothstep(0.02, 0.12, vDir.y);
          col = mix(col, mix(shade, lit, c1), c0 * fade);
        }
        col = mix(col, horizon, smoothstep(0.0, -0.25, vDir.y));
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(1000, 32, 16), mat);
  sky.renderOrder = -1;
  sky.frustumCulled = false;
  return sky;
}
