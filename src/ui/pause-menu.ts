import { clockText, notesExport, notesText, type PlaceNote } from "../core/notes";
import { compassName } from "../core/mapview";
import type { NotesStore } from "../core/notes-store";
import { LABELS, randomAppearance } from "../core/appearance";
import {
  AGES, applyAppearance, BAGS, BEARDS, bottomColorChoices, BOTTOM_COLORS, BOTTOMS, BUILDS, CLOTH_COLORS, DEFAULT_RECIPE, GLASSES, HAIR_COLORS, HAIR_STYLES, HATS, hatColorChoices,
  HEIGHT_RANGE, SEXES, SHOE_COLORS, SHOES, shoeColorChoices, SKIN_TONES, TOPS, topColorChoices, type Recipe,
} from "../core/character";
import { DETAIL_CHOICES, DPR_CHOICES, SENSITIVITY_RANGE, SHADOW_CHOICES, type SettingKey, type Settings } from "../core/settings";

/** Menu pause : Reprendre, Carte, Réglages, Lieux notés, Sauvegarde. Il ne touche pas au jeu : tout passe par `PauseHooks`. */
export interface PauseHooks {
  resume(): void;
  /** Ouvre la carte agrandie ; false si elle n'a pas pu être chargée. */
  openMap(): boolean;
  settings(): { values: Settings; locked: ReadonlySet<SettingKey> };
  setSettings(partial: Partial<Settings>): void;
  /** Enregistre maintenant ; false si le navigateur refuse. */
  save(): boolean;
  /** Dernier enregistrement (ms depuis 1970), ou null s'il n'y en a pas. */
  savedAt(): number | null;
  /** Recommence une partie : efface la sauvegarde puis recharge. */
  newGame(): void;
  /** Capture prise à l'entrée en pause (sans interface), et situation du joueur à cet instant. */
  pauseShot(): Promise<Blob | null>;
  situation(): { x: number; y: number; z: number; heading: number; hour: number; day: number };
  notes(): Promise<{ store: NotesStore; persistent: boolean }>;
  /** Apparence du joueur : lecture, changement (appliqué tout de suite en jeu et enregistré), aperçu dessiné par le moteur du jeu. */
  appearance: { get(): Recipe; set(recipe: Recipe): void; preview: { canvas: HTMLCanvasElement; show(recipe: Recipe): void; rotate(radians: number): void } };
  build: string;
}

type PanelId = "home" | "settings" | "appearance" | "notes" | "save";

function h<K extends keyof HTMLElementTagNameMap>(tag: K, cls = "", text = ""): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
}

function download(name: string, mime: string, content: string): void {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([content], { type: mime }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

const stamp = (): string => new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
const dateText = (ms: number): string => new Date(ms).toLocaleString("fr-FR", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });

export class PauseMenu {
  readonly el: HTMLDivElement;
  private readonly content: HTMLDivElement;
  private readonly nav = new Map<PanelId, HTMLButtonElement>();
  private panel: PanelId = "home";
  private readonly urls: string[] = [];

  constructor(private readonly hooks: PauseHooks) {
    const el = (this.el = h("div"));
    el.id = "pause";
    el.hidden = true;
    const side = h("div", "pm-side");
    const title = h("div", "pm-title", "Pause");
    side.append(title);
    const item = (label: string, on: () => void, id?: PanelId): void => {
      const b = h("button", "pm-item", label);
      b.addEventListener("click", on);
      if (id) this.nav.set(id, b);
      side.append(b);
    };
    item("▶  Reprendre", () => hooks.resume());
    item("🗺  Carte", () => {
      if (!hooks.openMap()) this.content.replaceChildren(h("h2", "", "Carte"), h("p", "pm-warn", "La carte n'a pas pu être chargée (fichiers absents ou réseau coupé). Réessaie plus tard."));
    });
    item("👤  Apparence", () => this.show("appearance"), "appearance");
    item("⚙  Réglages", () => this.show("settings"), "settings");
    item("📍  Lieux notés", () => this.show("notes"), "notes");
    item("💾  Sauvegarde", () => this.show("save"), "save");
    this.content = h("div", "pm-content");
    el.append(side, this.content);
    document.body.append(el);
  }

  get isOpen(): boolean {
    return !this.el.hidden;
  }

  open(panel: PanelId = "home"): void {
    this.el.hidden = false;
    this.show(panel);
  }

  close(): void {
    this.el.hidden = true;
    this.release();
  }

  /** Redessine le panneau courant (les réglages ou les notes ont changé ailleurs). */
  refresh(): void {
    this.show(this.panel);
  }

  private release(): void {
    for (const u of this.urls.splice(0)) URL.revokeObjectURL(u);
  }

  private show(panel: PanelId): void {
    this.release();
    this.panel = panel;
    for (const [id, b] of this.nav) b.classList.toggle("on", id === panel);
    this.content.replaceChildren();
    if (panel === "home") this.home();
    else if (panel === "settings") this.settingsPanel();
    else if (panel === "appearance") this.appearancePanel();
    else if (panel === "notes") void this.notesPanel();
    else this.savePanel();
  }

  private home(): void {
    const at = this.hooks.savedAt();
    this.content.append(
      h("h2", "", "Partie en pause"),
      h("p", "pm-muted", "Le temps du jeu est arrêté : véhicules, soleil et horloge reprendront là où tu les as laissés."),
      h("p", "", at ? `Dernier enregistrement : ${dateText(at)}.` : "Pas encore d'enregistrement. La partie est enregistrée à chaque pause, quand tu quittes la page et toutes les 30 secondes."),
    );
  }

  // --- Réglages -----------------------------------------------------------------------------------------------------------

  private settingsPanel(): void {
    const { values, locked } = this.hooks.settings();
    const c = this.content;
    c.append(h("h2", "", "Réglages"));
    const row = (label: string, hint: string, key: SettingKey, control: HTMLElement): void => {
      const r = h("div", "pm-row");
      const left = h("div", "pm-label");
      left.append(h("span", "", label));
      left.append(h("small", "", locked.has(key) ? `Imposé par l'adresse de la page (paramètre d'URL) : ${String(values[key])}.` : hint));
      r.append(left, control);
      if (locked.has(key)) r.classList.add("locked");
      c.append(r);
    };
    const choices = <T extends number | boolean>(key: SettingKey, items: readonly { value: T; label: string }[], current: T): HTMLElement => {
      const seg = h("div", "pm-seg");
      for (const it of items) {
        const b = h("button", it.value === current ? "on" : "", it.label);
        b.disabled = locked.has(key);
        b.addEventListener("click", () => {
          this.hooks.setSettings({ [key]: it.value } as Partial<Settings>);
          this.show("settings");
        });
        seg.append(b);
      }
      return seg;
    };
    row("Définition", "Plus haut : plus net, mais plus lent et plus chaud.", "dpr", choices("dpr", DPR_CHOICES.map((v) => ({ value: v, label: `×${String(v).replace(".", ",")}` })), values.dpr));
    row("Ombres", "Fines : la meilleure qualité, la plus lourde.", "shadows", choices("shadows", SHADOW_CHOICES.map((v) => ({ value: v, label: v === 0 ? "Aucune" : v === 2048 ? "Moyennes" : "Fines" })), values.shadows));
    row("Rayon de détail", "Distance jusqu'à laquelle les bâtiments sont détaillés. 400 m double la mémoire.", "detail", choices("detail", DETAIL_CHOICES.map((v) => ({ value: v, label: `${v} m` })), values.detail));
    const range = h("input");
    range.type = "range";
    range.min = String(SENSITIVITY_RANGE.min);
    range.max = String(SENSITIVITY_RANGE.max);
    range.step = String(SENSITIVITY_RANGE.step);
    range.value = String(values.sensitivity);
    const out = h("span", "pm-value", `×${values.sensitivity.toFixed(1).replace(".", ",")}`);
    range.addEventListener("input", () => {
      const v = Number(range.value);
      out.textContent = `×${v.toFixed(1).replace(".", ",")}`;
      this.hooks.setSettings({ sensitivity: v });
    });
    const sens = h("div", "pm-slider");
    sens.append(range, out);
    row("Sensibilité de la caméra", "Vitesse de rotation au doigt.", "sensitivity", sens);
    row("Minimap", "Tourner avec la caméra, ou garder le nord en haut.", "minimapNorth", choices("minimapNorth", [{ value: false, label: "Tourne" }, { value: true, label: "Nord en haut" }], values.minimapNorth));
    c.append(h("p", "pm-muted", "Les réglages sont enregistrés sur cet appareil. Un paramètre dans l'adresse de la page (?dpr=, ?shadowmap=, ?detail=) reste prioritaire."));
  }

  // --- Apparence ----------------------------------------------------------------------------------------------------------

  private appearancePanel(): void {
    const { appearance } = this.hooks;
    const c = this.content;
    c.append(h("h2", "", "Apparence"));
    const layout = h("div", "pm-appearance");
    const left = h("div", "pm-preview");
    const right = h("div", "pm-controls");
    layout.append(left, right);
    c.append(layout);

    // Aperçu : glisser pour tourner le personnage.
    const canvas = appearance.preview.canvas;
    let last: number | null = null;
    canvas.onpointerdown = (e) => {
      last = e.clientX;
      canvas.setPointerCapture(e.pointerId);
    };
    canvas.onpointermove = (e) => {
      if (last === null) return;
      appearance.preview.rotate((e.clientX - last) * 0.014);
      last = e.clientX;
    };
    canvas.onpointerup = canvas.onpointercancel = () => {
      last = null;
    };
    const bar = h("div", "pm-actions");
    const random = h("button", "pm-primary", "🎲 Hasard");
    random.addEventListener("click", () => change(randomAppearance()));
    const reset = h("button", "", "Par défaut");
    reset.addEventListener("click", () => change(applyAppearance(DEFAULT_RECIPE)));
    bar.append(random, reset);
    left.append(canvas, bar, h("small", "pm-muted", "Glisse sur l'image pour tourner."));

    const change = (next: Recipe): void => {
      appearance.set(next);
      appearance.preview.show(next);
      build();
    };
    const patch = (p: Partial<Recipe>): void => change(applyAppearance(appearance.get(), p));

    const build = (): void => {
      const keep = c.scrollTop;
      const r = appearance.get();
      right.replaceChildren();
      const section = (title: string): void => {
        right.append(h("h3", "pm-section", title));
      };
      const choice = <T extends string>(label: string, labels: Record<T, string>, values: readonly T[], current: T, set: (v: T) => void): void => {
        const row = h("div", "pm-arow");
        row.append(h("span", "pm-alabel", label));
        const box = h("div", "pm-chips");
        for (const v of values) {
          const b = h("button", v === current ? "on" : "", labels[v]);
          b.addEventListener("click", () => set(v));
          box.append(b);
        }
        row.append(box);
        right.append(row);
      };
      const swatches = (label: string, palette: readonly string[], indices: readonly number[], current: number, set: (i: number) => void): void => {
        const row = h("div", "pm-arow");
        row.append(h("span", "pm-alabel", label));
        const box = h("div", "pm-swatches");
        for (const i of indices) {
          const b = h("button", i === current ? "pm-sw on" : "pm-sw");
          b.style.background = palette[i]!;
          b.setAttribute("aria-label", palette[i]!);
          b.addEventListener("click", () => set(i));
          box.append(b);
        }
        row.append(box);
        right.append(row);
      };
      const range = (n: number): number[] => Array.from({ length: n }, (_, i) => i);

      section("Corps");
      choice("Sexe", LABELS.sex, SEXES, r.sex, (v) => patch({ sex: v }));
      choice("Âge", LABELS.age, AGES, r.age, (v) => patch({ age: v }));
      choice("Corpulence", LABELS.build, BUILDS, r.build, (v) => patch({ build: v }));
      const hrow = h("div", "pm-arow");
      hrow.append(h("span", "pm-alabel", "Taille"));
      const slider = h("input");
      slider.type = "range";
      slider.min = String(Math.round(HEIGHT_RANGE.min * 100));
      slider.max = String(Math.round(HEIGHT_RANGE.max * 100));
      slider.step = "1";
      slider.value = String(Math.round(r.height * 100));
      const out = h("span", "pm-value", `${(r.height).toFixed(2).replace(".", ",")} m`);
      out.style.width = "52px";
      // Pendant le glissement on ne reconstruit pas l'écran (le curseur serait perdu) : seul l'aperçu change.
      slider.addEventListener("input", () => {
        const next = applyAppearance(appearance.get(), { height: Number(slider.value) / 100 });
        out.textContent = `${next.height.toFixed(2).replace(".", ",")} m`;
        appearance.set(next);
        appearance.preview.show(next);
      });
      const sl = h("div", "pm-slider");
      sl.append(slider, out);
      hrow.append(sl);
      right.append(hrow);
      swatches("Teint", SKIN_TONES, range(SKIN_TONES.length), r.skin, (i) => patch({ skin: i }));

      section("Cheveux");
      choice("Coiffure", LABELS.hairStyle, HAIR_STYLES, r.hairStyle, (v) => patch({ hairStyle: v }));
      swatches("Couleur", HAIR_COLORS, range(HAIR_COLORS.length), r.hairColor, (i) => patch({ hairColor: i }));
      choice("Barbe", LABELS.beard, BEARDS, r.beard, (v) => patch({ beard: v }));

      section("Tenue");
      choice("Haut", LABELS.top, TOPS, r.top, (v) => patch({ top: v }));
      swatches(r.top === "apron" ? "Couleur du tablier" : "Couleur du haut", CLOTH_COLORS, topColorChoices(r.top), r.topColor, (i) => patch({ topColor: i }));
      if (r.top === "apron") swatches("Chemise dessous", CLOTH_COLORS, range(16), r.scarfColor, (i) => patch({ scarfColor: i }));
      choice("Bas", LABELS.bottom, BOTTOMS, r.bottom, (v) => patch({ bottom: v }));
      swatches("Couleur du bas", BOTTOM_COLORS, bottomColorChoices(r.bottom), r.bottomColor, (i) => patch({ bottomColor: i }));
      choice("Chaussures", LABELS.shoes, SHOES, r.shoes, (v) => patch({ shoes: v }));
      swatches("Couleur des chaussures", SHOE_COLORS, shoeColorChoices(r.shoes), r.shoeColor, (i) => patch({ shoeColor: i }));

      section("Accessoires");
      choice("Chapeau", LABELS.hat, HATS, r.hat, (v) => patch({ hat: v }));
      if (r.hat !== "none") swatches("Couleur du chapeau", CLOTH_COLORS, hatColorChoices(r.hat), r.hatColor, (i) => patch({ hatColor: i }));
      choice("Lunettes", LABELS.glasses, GLASSES, r.glasses, (v) => patch({ glasses: v }));
      choice("Sac", LABELS.bag, BAGS, r.bag, (v) => patch({ bag: v }));
      if (r.bag !== "none") swatches("Couleur du sac", CLOTH_COLORS, range(16), r.bagColor, (i) => patch({ bagColor: i }));
      if (r.top !== "apron") {
        choice("Écharpe", { off: "Non", on: "Oui" }, ["off", "on"] as const, r.scarf ? "on" : "off", (v) => patch({ scarf: v === "on" }));
        if (r.scarf) swatches("Couleur de l'écharpe", CLOTH_COLORS, range(16), r.scarfColor, (i) => patch({ scarfColor: i }));
      }
      c.scrollTop = keep;
    };
    appearance.preview.show(appearance.get());
    build();
  }

  // --- Lieux notés --------------------------------------------------------------------------------------------------------

  private async notesPanel(): Promise<void> {
    const c = this.content;
    c.append(h("h2", "", "Lieux notés"));
    const { store, persistent } = await this.hooks.notes();
    if (this.panel !== "notes") return;
    const actions = h("div", "pm-actions");
    const add = h("button", "pm-primary", "📍 Noter ce lieu");
    add.addEventListener("click", () => void this.noteForm(store));
    actions.append(add);
    const copy = h("button", "", "Copier le texte");
    copy.disabled = store.notes.length === 0;
    copy.addEventListener("click", () => {
      const text = notesText(store.notes, this.hooks.build);
      navigator.clipboard.writeText(text).then(
        () => { copy.textContent = "Copié ✓"; },
        () => {
          const ta = h("textarea", "pm-paste");
          ta.value = text;
          c.append(ta);
          ta.select();
          copy.textContent = "Texte sélectionné : copiez-le";
        },
      );
    });
    const dl = h("button", "", "Télécharger (JSON)");
    dl.disabled = store.notes.length === 0;
    dl.addEventListener("click", () => {
      dl.textContent = "Préparation…";
      void store.shotUrls().then((shots) => {
        download(`autun-lieux-${stamp()}.json`, "application/json", JSON.stringify(notesExport(store.notes, this.hooks.build, shots), null, 1));
        dl.textContent = "Télécharger (JSON)";
      });
    });
    actions.append(copy, dl);
    c.append(actions);
    if (!persistent) c.append(h("p", "pm-warn", "Le stockage de ce navigateur est indisponible : les notes disparaîtront au rechargement. Exporte-les avant."));
    const list = h("div", "pm-notes");
    c.append(list);
    if (store.notes.length === 0) list.append(h("p", "pm-muted", "Aucune note. Utilise « Noter ce lieu » quand la carte ne correspond pas à la réalité : la position, la direction, l'heure et une capture sont enregistrées."));
    for (const n of store.notes) list.append(await this.noteRow(store, n));
  }

  private async noteRow(store: NotesStore, n: PlaceNote): Promise<HTMLElement> {
    const row = h("div", "pm-note");
    if (n.hasShot) {
      const blob = await store.shot(n.id);
      if (blob) {
        const img = h("img");
        const url = URL.createObjectURL(blob);
        this.urls.push(url);
        img.src = url;
        img.alt = "Capture du lieu";
        row.append(img);
      }
    }
    const body = h("div", "pm-note-body");
    body.append(h("div", "", n.text.trim() || "(sans texte)"), h("small", "", `x ${n.x.toFixed(0)}, y ${n.y.toFixed(0)} · face au ${compassName(n.heading)} · ${clockText(n.hour)}`));
    const del = h("button", "pm-del", "Supprimer");
    del.addEventListener("click", () => {
      void store.remove(n.id).then(() => this.show("notes"));
    });
    row.append(body, del);
    return row;
  }

  private async noteForm(store: NotesStore): Promise<void> {
    const c = this.content;
    const shot = await this.hooks.pauseShot();
    const where = this.hooks.situation();
    c.replaceChildren(h("h2", "", "Noter ce lieu"));
    const form = h("div", "pm-form");
    if (shot) {
      const img = h("img", "pm-shot");
      const url = URL.createObjectURL(shot);
      this.urls.push(url);
      img.src = url;
      form.append(img);
    }
    const side = h("div", "pm-form-side");
    side.append(h("small", "", `x ${where.x.toFixed(0)}, y ${where.y.toFixed(0)} · face au ${compassName(where.heading)} · ${clockText(where.hour)}`));
    const text = h("textarea");
    text.placeholder = "Ce qui ne correspond pas à la réalité…";
    text.rows = 3;
    const bar = h("div", "pm-actions");
    const ok = h("button", "pm-primary", "Enregistrer");
    ok.addEventListener("click", () => {
      ok.disabled = true;
      void store.add({ x: where.x, y: where.y, z: where.z, heading: where.heading, hour: where.hour, day: where.day, text: text.value }, shot).then((saved) => {
        this.show("notes");
        if (!saved) this.content.prepend(h("p", "pm-warn", "Note gardée en mémoire seulement : le navigateur a refusé de l'enregistrer. Exporte-la."));
      });
    });
    const cancel = h("button", "", "Annuler");
    cancel.addEventListener("click", () => this.show("notes"));
    bar.append(ok, cancel);
    side.append(text, bar);
    form.append(side);
    c.append(form);
    text.focus();
  }

  // --- Sauvegarde ---------------------------------------------------------------------------------------------------------

  private savePanel(): void {
    const c = this.content;
    c.append(h("h2", "", "Sauvegarde"));
    const at = this.hooks.savedAt();
    const info = h("p", "", at ? `Dernier enregistrement : ${dateText(at)}.` : "Pas encore d'enregistrement.");
    c.append(info, h("p", "pm-muted", "Position, véhicule, véhicules déplacés, heure et repère sont enregistrés sur cet appareil à chaque pause, quand la page passe en arrière-plan et toutes les 30 secondes."));
    const bar = h("div", "pm-actions");
    const now = h("button", "pm-primary", "Enregistrer maintenant");
    now.addEventListener("click", () => {
      const ok = this.hooks.save();
      info.textContent = ok ? `Enregistré à ${new Date().toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}.` : "Le navigateur refuse l'enregistrement (stockage interdit ou plein).";
    });
    const fresh = h("button", "pm-danger", "Nouvelle partie");
    fresh.addEventListener("click", () => {
      bar.replaceChildren();
      const ask = h("p", "pm-warn", "Effacer la sauvegarde et recommencer au départ ? Les réglages et les lieux notés sont conservés.");
      const yes = h("button", "pm-danger", "Oui, recommencer");
      yes.addEventListener("click", () => this.hooks.newGame());
      const no = h("button", "", "Annuler");
      no.addEventListener("click", () => this.show("save"));
      bar.append(ask, yes, no);
    });
    bar.append(now, fresh);
    c.append(bar);
    c.append(h("p", "pm-muted pm-build", `Version ${this.hooks.build} · © contributeurs OpenStreetMap · IGN`));
  }
}
