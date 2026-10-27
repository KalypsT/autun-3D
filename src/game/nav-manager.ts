import { NavGraph } from "../core/nav-graph";
import { loadNavCell, loadNavIndex, type NavIndex } from "../data/nav";

/** Rayon (m) autour du joueur dans lequel les données de navigation doivent être là : couronne des passants (≤ 250 m) et marge. */
export const NAV_REACH = 400;
/** Au-delà de ce rayon (m), une super-tuile est déchargée. */
export const NAV_UNLOAD = 650;
/** Anticipation (s) : on charge aussi autour du point où l'on sera dans ce délai, comme les tuiles. */
const LOOKAHEAD = 4;
const MAX_FETCHES = 2;

/** Distance (m) d'un point au rectangle de la super-tuile `id` (`s<i>_<j>`). */
export function navCellDistance(index: NavIndex, id: string, px: number, py: number): number {
  const [i, j] = id.slice(1).split("_").map(Number) as [number, number];
  const x0 = index.gridOrigin[0] + i * index.cell, y0 = index.gridOrigin[1] + j * index.cell;
  return Math.hypot(Math.max(x0 - px, 0, px - (x0 + index.cell)), Math.max(y0 - py, 0, py - (y0 + index.cell)));
}

/** Super-tuiles à avoir en mémoire autour du joueur (position et vitesse en m/s), les plus proches d'abord. */
export function navCellsWanted(index: NavIndex, px: number, py: number, vx = 0, vy = 0, reach = NAV_REACH): string[] {
  const ax = px + vx * LOOKAHEAD, ay = py + vy * LOOKAHEAD;
  return index.cells
    .map((c) => ({ id: c.id, d: Math.min(navCellDistance(index, c.id, px, py), navCellDistance(index, c.id, ax, ay)) }))
    .filter((c) => c.d < reach)
    .sort((a, b) => a.d - b.d)
    .map((c) => c.id);
}

/** Charge et décharge les super-tuiles de navigation autour du joueur. Rien n'est chargé tant que l'index n'est pas arrivé. */
export class NavManager {
  readonly graph = new NavGraph();
  index: NavIndex | null = null;
  private readonly fetching = new Set<string>();
  private frame = 0;
  /** Appelé après chaque ajout ou retrait de super-tuile. */
  onChange: (() => void) | null = null;

  /** Charge l'index ; à attendre avant le premier `update`. */
  async init(): Promise<void> {
    this.index = await loadNavIndex();
  }

  /** À appeler à chaque image (le travail ne se fait qu'une image sur dix). */
  update(px: number, py: number, vx = 0, vy = 0): void {
    const index = this.index;
    if (!index || this.frame++ % 10 !== 0) return;
    for (const id of navCellsWanted(index, px, py, vx, vy)) {
      if (this.graph.has(id) || this.fetching.has(id) || this.fetching.size >= MAX_FETCHES) continue;
      this.fetching.add(id);
      void loadNavCell(id).then(
        (cell) => {
          this.fetching.delete(id);
          this.graph.add(cell);
          this.onChange?.();
        },
        (err: unknown) => {
          this.fetching.delete(id);
          console.error(`navigation ${id}`, err);
        },
      );
    }
    let removed = false;
    for (const id of [...this.graph.cells.keys()]) {
      if (navCellDistance(index, id, px, py) > NAV_UNLOAD) removed = this.graph.remove(id) || removed;
    }
    if (removed) this.onChange?.();
  }

  /** Charge d'un coup les super-tuiles autour d'un point (départ du jeu, banc, captures). */
  async preload(px: number, py: number): Promise<void> {
    if (!this.index) await this.init();
    await Promise.all(navCellsWanted(this.index!, px, py).map((id) => loadNavCell(id).then((c) => this.graph.add(c))));
    this.onChange?.();
  }
}
