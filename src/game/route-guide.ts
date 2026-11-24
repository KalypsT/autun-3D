import { loadNavCell, loadNavIndex } from "../data/nav";
import { findGuide, pedGuide, polylineLength, roadGuide, routeProgress, type GuideEnd } from "../core/guide";
import { NavGraph } from "../core/nav-graph";
import type { Waypoint } from "../core/waypoint";

/** Le joueur au moment du calcul : position, cap du véhicule conduit (null à pied). */
export interface GuideState {
  x: number;
  y: number;
  vehicleHeading: number | null;
}

/** Au-delà de cet écart à la ligne (m), on recalcule l'itinéraire ; pas plus d'un calcul par `RECOMPUTE_S`. */
const OFF_ROUTE = 25;
const RECOMPUTE_S = 1.2;
/** Le repère est atteint : plus de trait sous cette distance (m). */
const ARRIVED = 18;
/** Distance de recherche de l'arête la plus proche, au départ et au repère (m). */
const START_REACH = 80;
const GOAL_REACH = 300;

/**
 * Guidage vers le repère (D310) : un graphe de navigation complet, à part de celui des passants (qui ne couvre que 400 m autour du joueur),
 * chargé à la première pose d'un repère (≈ 1,4 Mo, gardé en cache) ; l'itinéraire est recalculé quand on change de repère, qu'on monte
 * ou descend d'un véhicule, ou qu'on s'écarte du trait. Entre deux calculs, on suit seulement où en est le joueur sur la ligne.
 */
export class RouteGuide {
  private readonly nav = new NavGraph();
  private loading: Promise<void> | null = null;
  private loaded = false;
  private key = "";
  private cooldown = 0;
  private timer = 0;
  private seg = 0;
  /** Ligne à dessiner (du joueur au repère, le trait déjà parcouru retiré), ou null (pas de repère, pas d'itinéraire, ou arrivé). */
  points: number[] | null = null;
  /** Distance restante par l'itinéraire (m), ou null. */
  remaining: number | null = null;
  private full: number[] = [];
  private total = 0;
  /** Appelé quand le graphe complet vient d'être chargé. */
  onReady: (() => void) | null = null;
  /** Temps du dernier calcul (ms), pour le debug. */
  lastMs = 0;

  private load(): void {
    this.loading ??= loadNavIndex()
      .then((index) => Promise.all(index.cells.map((c) => loadNavCell(c.id).then((cell) => this.nav.add(cell)))))
      .then(
        () => {
          this.loaded = true;
          this.onReady?.();
        },
        (e: unknown) => console.warn("guidage indisponible :", e),
      );
  }

  /** Calcul au prochain `update`, sans attendre (repère posé sur la carte). */
  poke(): void {
    this.timer = this.cooldown = 0;
  }

  /** Le graphe complet est-il chargé ? */
  get ready(): boolean {
    return this.loaded;
  }

  /** À chaque image. */
  update(dt: number, wp: Waypoint | null, s: GuideState): void {
    this.cooldown -= dt;
    this.timer -= dt;
    if (!wp) {
      this.clear();
      this.key = "";
      return;
    }
    this.load();
    if (!this.loaded || this.timer > 0) return;
    this.timer = 0.2;
    if (Math.hypot(wp.x - s.x, wp.y - s.y) < ARRIVED) {
      this.clear();
      return;
    }
    const mode = s.vehicleHeading === null ? "foot" : "road";
    const key = `${wp.x},${wp.y},${mode}`;
    let need = key !== this.key;
    if (!need && this.full.length >= 4) {
      const p = routeProgress(this.full, s.x, s.y, Math.max(0, this.seg - 2));
      if (p.off > OFF_ROUTE) need = true;
      else this.follow(p.seg, p.x, p.y, p.along, wp);
    } else if (!need) need = true;
    if (need && (key !== this.key || this.cooldown <= 0)) {
      this.key = key;
      this.cooldown = RECOMPUTE_S;
      this.compute(wp, s, mode);
    }
  }

  private compute(wp: Waypoint, s: GuideState, mode: "foot" | "road"): void {
    const t0 = performance.now();
    const nearest = (x: number, y: number, r: number): GuideEnd | null =>
      mode === "road" ? this.nav.road.nearest(x, y, r) : this.nav.nearest(x, y, r);
    const from = nearest(s.x, s.y, START_REACH), to = nearest(wp.x, wp.y, GOAL_REACH);
    const g = mode === "road" ? roadGuide(this.nav.road) : pedGuide(this.nav);
    const r = from && to ? findGuide(g, from, to, s.vehicleHeading === null ? {} : { heading: s.vehicleHeading }) : null;
    this.lastMs = performance.now() - t0;
    if (!r) {
      // Pas d'itinéraire (loin de toute rue, repère en pleine mer…) : la minimap garde sa flèche au bord.
      this.clear();
      return;
    }
    // Du joueur au graphe, le graphe, puis du graphe au repère.
    this.full = [s.x, s.y, ...r.points, wp.x, wp.y];
    this.total = polylineLength(this.full);
    this.seg = 0;
    this.follow(0, s.x, s.y, 0, wp);
  }

  private follow(seg: number, px: number, py: number, along: number, wp: Waypoint): void {
    this.seg = seg;
    const pts = [px, py];
    for (let i = (seg + 1) * 2; i < this.full.length; i++) pts.push(this.full[i]!);
    this.points = pts;
    this.remaining = Math.max(this.total - along, Math.hypot(wp.x - px, wp.y - py));
  }

  private clear(): void {
    this.points = null;
    this.remaining = null;
    this.full = [];
  }
}
