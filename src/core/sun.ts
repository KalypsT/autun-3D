/** Position du soleil (temps solaire local, sans équation du temps) : logique pure, sans rendu. */

export const AUTUN_LATITUDE = 46.95;

export interface Sun {
  /** Hauteur au-dessus de l'horizon, radians (négative la nuit). */
  elevation: number;
  /** Azimut depuis le nord, dans le sens des aiguilles d'une montre, radians. */
  azimuth: number;
}

export function sunPosition(dayOfYear: number, solarHour: number, latitudeDeg = AUTUN_LATITUDE): Sun {
  const rad = Math.PI / 180;
  const phi = latitudeDeg * rad;
  const delta = 23.44 * rad * Math.sin((2 * Math.PI * (284 + dayOfYear)) / 365);
  const h = (solarHour - 12) * 15 * rad;
  const sinEl = Math.sin(phi) * Math.sin(delta) + Math.cos(phi) * Math.cos(delta) * Math.cos(h);
  const elevation = Math.asin(sinEl);
  let azimuth = Math.atan2(Math.sin(h), Math.cos(h) * Math.sin(phi) - Math.tan(delta) * Math.cos(phi)) + Math.PI;
  azimuth = (azimuth + 2 * Math.PI) % (2 * Math.PI);
  return { elevation, azimuth };
}

/** Direction vers le soleil dans le repère données (x est, y nord, z haut). */
export function sunDirection(sun: Sun): [number, number, number] {
  const c = Math.cos(sun.elevation);
  return [Math.sin(sun.azimuth) * c, Math.cos(sun.azimuth) * c, Math.sin(sun.elevation)];
}
