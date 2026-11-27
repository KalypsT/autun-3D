import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LoadingScreen } from "./loading-screen";

/** Élément factice : classes, texte de l'avancement, écouteurs, retrait. */
const fakeScreen = () => {
  const classes = new Set<string>();
  const listeners: Record<string, ((e: Event) => void)[]> = {};
  const status = { textContent: "Chargement" };
  const el = {
    removed: false,
    classList: { add: (c: string) => classes.add(c), remove: (c: string) => classes.delete(c), contains: (c: string) => classes.has(c) },
    querySelector: () => status,
    addEventListener: (type: string, f: (e: Event) => void) => (listeners[type] ??= []).push(f),
    remove() {
      this.removed = true;
    },
  };
  const fire = (type: string): void => {
    for (const f of listeners[type] ?? []) f({ preventDefault() {} } as Event);
  };
  return { el, classes, status, fire };
};

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

afterEach(() => vi.unstubAllGlobals());

describe("écran de chargement (D338)", () => {
  it("écrit l'avancement, puis « Touche l'écran pour jouer » ; le toucher ferme l'écran (fondu) et commence la partie", async () => {
    const win = { addEventListener: vi.fn(), removeEventListener: vi.fn(), setTimeout: vi.fn() };
    vi.stubGlobal("window", win);
    const f = fakeScreen();
    const screen = new LoadingScreen(f.el as unknown as HTMLElement);
    let started = false;
    void screen.started.then(() => (started = true));
    screen.step("La ville");
    expect(f.status.textContent).toBe("La ville");
    screen.ready();
    expect(f.classes.has("ready")).toBe(true);
    expect(f.status.textContent).toBe("Touche l'écran pour jouer");
    // L'avancement ne remplace plus l'invitation.
    screen.step("Le relief");
    expect(f.status.textContent).toBe("Touche l'écran pour jouer");
    await tick();
    expect(started).toBe(false);
    f.fire("pointerdown");
    await tick();
    expect(started).toBe(true);
    expect(f.classes.has("gone")).toBe(true);
    expect(win.setTimeout).toHaveBeenCalledOnce();
  });

  it("sans attendre (banc, viewer, captures) : retiré tout de suite, la partie commence", async () => {
    const f = fakeScreen();
    const screen = new LoadingScreen(f.el as unknown as HTMLElement);
    let started = false;
    void screen.started.then(() => (started = true));
    screen.skip();
    await tick();
    expect(f.el.removed).toBe(true);
    expect(started).toBe(true);
  });

  it("une erreur reste affichée", () => {
    const f = fakeScreen();
    new LoadingScreen(f.el as unknown as HTMLElement).error("Erreur : réseau");
    expect(f.classes.has("error")).toBe(true);
    expect(f.status.textContent).toBe("Erreur : réseau");
  });

  it("index.html : huit images en CSS seulement, la première demandée d'abord, sans zoom si l'on réduit les animations ; le jeu porte son nom", () => {
    const html = readFileSync("index.html", "utf8");
    const slides = [...html.matchAll(/<img class="ld-slide" src="\/src\/assets\/loading\/([0-9]{2}-[a-z]+)\.webp"[^>]*fetchpriority="(high|low)"/g)];
    expect(slides.map((m) => m[2])).toEqual(["high", "low", "low", "low", "low", "low", "low", "low"]);
    for (const [, name] of slides) expect(readFileSync(`src/assets/loading/${name}.webp`).length).toBeLessThan(150_000);
    expect(html).toContain("@media (prefers-reduced-motion: reduce) { @keyframes ld-show");
    expect(html).toContain("<title>Grand Theft Autun</title>");
    const manifest = JSON.parse(readFileSync("public/domothib.json", "utf8")) as { id: string; nom: string; description: string; jaquette: string };
    expect(manifest.id).toBe("autun-3d");
    expect(manifest.nom).toBe("Grand Theft Autun");
    expect(manifest.description.length).toBeLessThanOrEqual(200);
    // Jaquette : WebP de 300 Ko au plus (contrat DomoThib §3).
    const cover = readFileSync(`public/${manifest.jaquette}`);
    expect(cover.subarray(0, 4).toString()).toBe("RIFF");
    expect(cover.subarray(8, 12).toString()).toBe("WEBP");
    expect(cover.length).toBeLessThanOrEqual(300_000);
  });
});
