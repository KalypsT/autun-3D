import { describe, expect, it } from "vitest";
import { bearing, clampToZone, compassName, fitScale, formatDistance, imageMatrix, imagesInView, panBy, pickLevel, screenToWorld, worldMatrix, worldToScreen, zoomAt, type MapView } from "./mapview";

const view = (over: Partial<MapView> = {}): MapView => ({ cx: 100, cy: -50, scale: 2, heading: 0, w: 400, h: 200, ...over });

describe("conversion monde / écran", () => {
  it("le centre de la vue est au centre de l'écran, le nord est en haut avec le cap 0", () => {
    const v = view();
    expect(worldToScreen(v, 100, -50)).toEqual([200, 100]);
    const [x, y] = worldToScreen(v, 100, -40);
    expect(x).toBeCloseTo(200);
    expect(y).toBeCloseTo(80);
  });

  it("le haut de l'écran suit le cap : cap est, l'est est en haut", () => {
    const v = view({ heading: Math.PI / 2 });
    const [x, y] = worldToScreen(v, 110, -50);
    expect(x).toBeCloseTo(200);
    expect(y).toBeCloseTo(80);
    // Le nord est alors à gauche.
    expect(worldToScreen(v, 100, -40)[0]).toBeLessThan(200);
  });

  it("aller-retour monde -> écran -> monde, quels que soient le cap et l'échelle", () => {
    for (const heading of [0, 0.7, 2.1, -3, 5]) {
      const v = view({ heading, scale: 0.37 });
      const [sx, sy] = worldToScreen(v, 523.4, -812.9);
      const [x, y] = screenToWorld(v, sx, sy);
      expect(x).toBeCloseTo(523.4, 6);
      expect(y).toBeCloseTo(-812.9, 6);
    }
  });

  it("la matrice 2D donne les mêmes points que worldToScreen", () => {
    const v = view({ heading: 1.1 });
    const [a, b, c, d, e, f] = worldMatrix(v);
    const [sx, sy] = worldToScreen(v, 31, 77);
    expect(a * 31 + c * 77 + e).toBeCloseTo(sx, 6);
    expect(b * 31 + d * 77 + f).toBeCloseTo(sy, 6);
  });

  it("la matrice d'une image envoie ses pixels sur les points du monde correspondants", () => {
    const v = view({ heading: -0.6, scale: 1.3 });
    const [a, b, c, d, e, f] = imageMatrix(v, -1520, -812, 1);
    // Pixel (250, 400) d'une image dont le coin nord-ouest est (-1520, -812) : monde (-1270, -1212).
    const [sx, sy] = worldToScreen(v, -1270, -1212);
    expect(a * 250 + c * 400 + e).toBeCloseTo(sx, 6);
    expect(b * 250 + d * 400 + f).toBeCloseTo(sy, 6);
  });
});

describe("déplacement et zoom", () => {
  it("le zoom garde le point sous le doigt en place", () => {
    for (const heading of [0, 1.3]) {
      const v = view({ heading });
      const [wx, wy] = screenToWorld(v, 300, 40);
      const z = zoomAt(v, 300, 40, 1.4);
      expect(z.scale).toBeCloseTo(2.8);
      const [sx, sy] = worldToScreen(z, wx, wy);
      expect(sx).toBeCloseTo(300, 6);
      expect(sy).toBeCloseTo(40, 6);
    }
  });

  it("le zoom reste entre les bornes", () => {
    expect(zoomAt(view(), 0, 0, 1000).scale).toBe(3);
    expect(zoomAt(view(), 0, 0, 1e-6).scale).toBe(0.05);
  });

  it("le déplacement fait suivre le monde au doigt", () => {
    const v = view({ heading: 0.9 });
    const [sx, sy] = worldToScreen(v, 10, 20);
    const p = panBy(v, 30, -12);
    const [tx, ty] = worldToScreen(p, 10, 20);
    expect(tx).toBeCloseTo(sx + 30, 6);
    expect(ty).toBeCloseTo(sy - 12, 6);
  });

  it("le centre ne sort pas de la zone (marge comprise) et l'échelle d'ensemble fait tout tenir", () => {
    const zone: [number, number, number, number] = [-1520, -1812, 1480, 1188];
    const c = clampToZone(view({ cx: 9000, cy: -9000 }), zone, 100);
    expect([c.cx, c.cy]).toEqual([1580, -1912]);
    expect(fitScale(zone, 915, 412)).toBeCloseTo(412 / 3000);
  });
});

describe("images de fond", () => {
  const images = [{ x0: -1520, y1: -812 }, { x0: -520, y1: -812 }, { x0: 480, y1: 188 }];
  it("ne garde que les images qui touchent la vue", () => {
    expect(imagesInView(images, 1000, view({ cx: -1000, cy: -1000, scale: 1, w: 200, h: 200 }))).toEqual([images[0]]);
    expect(imagesInView(images, 1000, view({ cx: -520, cy: -1000, scale: 1, w: 200, h: 200 }))).toEqual([images[0], images[1]]);
  });

  it("choisit le niveau le plus grossier qui reste net", () => {
    const levels = [1, 2];
    expect(pickLevel(levels, 0.39, 2)).toBe(2); // minimap : 0,78 px d'écran par mètre
    expect(pickLevel(levels, 0.9, 2.6)).toBe(1); // zoom : un pixel de 2 m ferait 4,7 px
    expect(pickLevel(levels, 0.1, 2.6)).toBe(2);
  });
});

describe("repères d'orientation", () => {
  it("cap, points cardinaux et distances", () => {
    expect(bearing(0, 0, 0, 10)).toBeCloseTo(0);
    expect(bearing(0, 0, 10, 0)).toBeCloseTo(Math.PI / 2);
    expect(compassName(0)).toBe("N");
    expect(compassName(Math.PI / 2)).toBe("E");
    expect(compassName(-Math.PI / 2)).toBe("O");
    expect(compassName(Math.PI * 0.25)).toBe("NE");
    expect(formatDistance(42)).toBe("40 m");
    expect(formatDistance(1234)).toBe("1,2 km");
  });
});
