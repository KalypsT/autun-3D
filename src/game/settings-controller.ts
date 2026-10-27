import { effectiveSettings, SettingsStore, type SettingKey, type Settings } from "../core/settings";
import type * as THREE from "three";
import type { TileManager } from "../render/tile-manager";

/**
 * Réglages en vigueur. `stored` est ce que le joueur a choisi (enregistré), `values` ce qui s'applique : pareil, sauf les réglages
 * que l'URL impose (`locked`). Un changement s'applique tout de suite, sans recharger.
 */
export class SettingsController {
  values: Settings;
  readonly locked: ReadonlySet<SettingKey>;
  private stored: Settings;
  /** Les consommateurs qui n'ont pas de méthode ici (commandes, minimap) s'abonnent. */
  readonly listeners: ((values: Settings, changed: readonly SettingKey[]) => void)[] = [];

  constructor(
    private readonly renderer: THREE.WebGLRenderer,
    private readonly sunLight: THREE.DirectionalLight,
    private readonly tiles: TileManager,
    private readonly store: SettingsStore,
    stored: Settings,
    params: URLSearchParams,
  ) {
    this.stored = stored;
    const eff = effectiveSettings(stored, params);
    this.values = eff.values;
    this.locked = eff.locked;
  }

  set(partial: Partial<Settings>): void {
    const changed: SettingKey[] = [];
    for (const key of Object.keys(partial) as SettingKey[]) {
      if (this.locked.has(key) || partial[key] === undefined || this.stored[key] === partial[key]) continue;
      (this.stored as unknown as Record<string, unknown>)[key] = partial[key];
      (this.values as unknown as Record<string, unknown>)[key] = partial[key];
      changed.push(key);
    }
    if (changed.length === 0) return;
    this.store.write(this.stored);
    this.apply(changed);
  }

  /** Applique au rendu ce qui en dépend ; les autres réglages sont lus par ceux qui s'en servent (écouteurs). */
  apply(changed: readonly SettingKey[]): void {
    const { renderer, sunLight, tiles, values } = this;
    if (changed.includes("dpr")) renderer.setPixelRatio(Math.min(window.devicePixelRatio, values.dpr));
    if (changed.includes("shadows")) {
      const on = values.shadows !== 0;
      sunLight.castShadow = on;
      if (on && sunLight.shadow.mapSize.x !== values.shadows) {
        // La carte d'ombres est recréée à la nouvelle taille au prochain rendu.
        sunLight.shadow.map?.dispose();
        sunLight.shadow.map = null;
        sunLight.shadow.mapSize.set(values.shadows, values.shadows);
      }
    }
    if (changed.includes("detail")) tiles.load = values.detail;
    for (const l of this.listeners) l(values, changed);
  }
}
