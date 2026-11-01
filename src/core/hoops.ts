/**
 * Paniers de basket des terrains de sport (D176, lot 5 de docs/plans/college-vallon.md). Un panier : (x, y, cap) où (x, y) est le panneau et `cap`
 * (degrés depuis le nord, sens horaire) la direction dans laquelle il regarde, vers le terrain ; son poteau est derrière lui.
 */
export const HOOP = {
  /** Hauteur de l'anneau (règle du basket), du bas du panneau et du haut du panneau ; largeur du panneau. */
  rim: 3.05, boardBottom: 2.9, boardTop: 3.95, boardWidth: 1.8,
  /** Distance du poteau au panneau (potence), rayon du poteau (obstacle) et de l'anneau, débord de l'anneau devant le panneau. */
  arm: 1.2, poleRadius: 0.13, ring: 0.23, ringOffset: 0.45,
} as const;

/** Direction (x, y) unitaire vers laquelle regarde le panneau. */
export function hoopDir(cap: number): [number, number] {
  return [Math.sin((cap * Math.PI) / 180), Math.cos((cap * Math.PI) / 180)];
}

/** Pied du poteau : à `arm` derrière le panneau. */
export function hoopPole(h: readonly [number, number, number]): [number, number] {
  const [dx, dy] = hoopDir(h[2]);
  return [h[0] - dx * HOOP.arm, h[1] - dy * HOOP.arm];
}
