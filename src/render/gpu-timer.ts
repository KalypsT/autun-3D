import type * as THREE from "three";

/**
 * Temps de calcul de la carte graphique (D314), pour le banc : requêtes de minutage (`EXT_disjoint_timer_query_webgl2`) autour du rendu
 * d'une image. Les résultats arrivent quelques images plus tard ; on les relit sans bloquer. Chrome sur Android coupe souvent cette
 * extension (raisons de sécurité) : `available` est alors faux et le rapport l'écrit.
 */
export class GpuTimer {
  readonly available: boolean;
  private readonly gl: WebGL2RenderingContext;
  private readonly ext: { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number } | null;
  private readonly pending: WebGLQuery[] = [];
  private active: WebGLQuery | null = null;
  /** Durées relues (ms) depuis la dernière remise à zéro. */
  samples: number[] = [];

  constructor(renderer: THREE.WebGLRenderer) {
    this.gl = renderer.getContext() as WebGL2RenderingContext;
    this.ext = this.gl.getExtension("EXT_disjoint_timer_query_webgl2") as { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number } | null;
    this.available = this.ext !== null && typeof this.gl.createQuery === "function";
  }

  begin(): void {
    if (!this.available || this.active || this.pending.length > 6) return;
    const q = this.gl.createQuery();
    if (!q) return;
    this.gl.beginQuery(this.ext!.TIME_ELAPSED_EXT, q);
    this.active = q;
  }

  end(): void {
    if (!this.active) return;
    this.gl.endQuery(this.ext!.TIME_ELAPSED_EXT);
    this.pending.push(this.active);
    this.active = null;
    this.poll();
  }

  private poll(): void {
    const gl = this.gl;
    const disjoint = gl.getParameter(this.ext!.GPU_DISJOINT_EXT) as boolean;
    while (this.pending.length) {
      const q = this.pending[0]!;
      if (!(gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE) as boolean)) break;
      const ns = gl.getQueryParameter(q, gl.QUERY_RESULT) as number;
      if (!disjoint) this.samples.push(ns / 1e6);
      gl.deleteQuery(q);
      this.pending.shift();
    }
  }

  /** Médiane et 95 % des durées relues (ms), ou null sans mesure. */
  summary(): { medianMs: number; p95Ms: number; n: number } | null {
    if (this.samples.length === 0) return null;
    const s = [...this.samples].sort((a, b) => a - b);
    const at = (q: number): number => Math.round(s[Math.min(s.length - 1, Math.floor(s.length * q))]! * 100) / 100;
    return { medianMs: at(0.5), p95Ms: at(0.95), n: s.length };
  }

  reset(): void {
    this.samples = [];
  }
}
