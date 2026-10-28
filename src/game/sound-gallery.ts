import { AudioSystem } from "../audio/audio-system";
import { renderScene, SCENES, type At } from "../audio/catalog";
import { SettingsStore } from "../core/settings";

/**
 * Page d'écoute des sons (`?sounds`, J7, D89) : chaque son du jeu sur un bouton, rangé par famille, avec le volume du réglage.
 * Sert à juger les sons au téléphone sans avoir à provoquer la scène en jouant. `window.__sounds.render(id, wav)` rend une scène
 * hors ligne (outil `tools/sounds.sh`).
 */
export function startSoundGallery(): void {
  document.getElementById("loading")?.remove();
  const settings = new SettingsStore().load();
  const sys = new AudioSystem(Math.max(settings.volume, 0.5));
  const panel = document.createElement("div");
  panel.style.cssText =
    "position:fixed;inset:0;overflow:auto;z-index:10;background:#f3e9d2;color:#2b2118;font:15px/1.4 system-ui,sans-serif;padding:16px max(16px,env(safe-area-inset-right)) 32px max(16px,env(safe-area-inset-left));";
  const h = (tag: string, text: string, css = ""): HTMLElement => {
    const el = document.createElement(tag);
    el.textContent = text;
    if (css) el.style.cssText = css;
    return el;
  };
  panel.append(
    h("h1", "Sons d'Autun 3D", "margin:0 0 4px;font-size:22px;"),
    h("p", "Tous les sons sont fabriqués par le navigateur, sans fichier. Appuie sur un bouton pour écouter le son jusqu'au bout.", "margin:0 0 12px;color:#5b4a3a;"),
  );
  const vol = document.createElement("input");
  vol.type = "range";
  vol.min = "0";
  vol.max = "1";
  vol.step = "0.05";
  vol.value = String(Math.max(settings.volume, 0.5));
  vol.style.cssText = "width:min(320px,70vw);vertical-align:middle;";
  vol.addEventListener("input", () => sys.setVolume(Number(vol.value)));
  const volRow = h("div", "Volume ", "margin:0 0 16px;");
  volRow.append(vol);
  panel.append(volRow);
  let current: HTMLElement | null = null;
  const sections = new Map<string, HTMLElement>();
  for (const sc of SCENES) {
    let box = sections.get(sc.section);
    if (!box) {
      panel.append(h("h2", sc.section, "margin:18px 0 8px;font-size:17px;"));
      box = document.createElement("div");
      box.style.cssText = "display:flex;flex-wrap:wrap;gap:8px;";
      panel.append(box);
      sections.set(sc.section, box);
    }
    const b = h("button", sc.label, "padding:10px 14px;border-radius:10px;border:2px solid #2b2118;background:#efe3c8;color:#2b2118;font:inherit;cursor:pointer;");
    b.addEventListener("click", () => {
      // Le premier geste crée le contexte (écouteur en capture de `AudioSystem`) ; on attend qu'il tourne.
      const ctx = sys.ctx, kit = sys.kit, buses = sys.buses;
      if (!ctx || !kit || !buses) return;
      void ctx.resume().then(() => {
        const t0 = ctx.currentTime + 0.05;
        const at: At = (t, fn) => {
          setTimeout(fn, Math.max(0, (t - ctx.currentTime) * 1000));
        };
        sc.play(kit, buses.sfx, t0, at);
        current?.style.setProperty("background", "#efe3c8");
        current = b;
        b.style.background = "#f1b24a";
        setTimeout(() => {
          if (current === b) b.style.background = "#efe3c8";
        }, sc.seconds * 1000);
      });
    });
    box.append(b);
  }
  panel.append(h("p", "Les sons du jeu sont placés : un son à droite de l'écran s'entend à droite, il s'assourdit avec la distance et la sirène change de note en passant (effet Doppler).", "margin:20px 0 0;color:#5b4a3a;"));
  document.body.append(panel);
  (window as unknown as { __sounds: object }).__sounds = {
    ids: SCENES.map((s) => s.id),
    render: async (id: string, wav: boolean) => {
      const sc = SCENES.find((s) => s.id === id);
      if (!sc) throw new Error(`son inconnu : ${id}`);
      return renderScene(sc, wav);
    },
  };
}
