/** Panneau de rapport affiché à la fin du banc et des prototypes : texte à copier, JSON à télécharger. */
export function showReportPanel(text: string, json: string, filePrefix: string): void {
  console.log(text);
  const panel = document.createElement("div");
  panel.style.cssText = "position:fixed;inset:8px;z-index:10;display:flex;flex-direction:column;gap:8px;padding:10px;border-radius:10px;"
    + "background:rgba(18,20,26,.94);color:#eee;font:13px system-ui,sans-serif;";
  const pre = document.createElement("pre");
  pre.textContent = text;
  pre.style.cssText = "flex:1;margin:0;overflow:auto;white-space:pre-wrap;font:12px/1.4 ui-monospace,monospace;user-select:text;-webkit-user-select:text;";
  const bar = document.createElement("div");
  bar.style.cssText = "display:flex;gap:8px;flex-wrap:wrap;";
  const button = (label: string, fn: () => void): HTMLButtonElement => {
    const b = document.createElement("button");
    b.textContent = label;
    b.style.cssText = "padding:10px 14px;border-radius:8px;border:1px solid #888;background:#2b3140;color:#fff;font:14px system-ui,sans-serif;";
    b.addEventListener("click", fn);
    bar.append(b);
    return b;
  };
  const copy = button("Copier le rapport", () => {
    navigator.clipboard.writeText(text).then(
      () => { copy.textContent = "Copié ✓"; },
      () => {
        // Repli : sélection du texte pour une copie manuelle.
        const range = document.createRange();
        range.selectNodeContents(pre);
        getSelection()?.removeAllRanges();
        getSelection()?.addRange(range);
        copy.textContent = "Texte sélectionné : copiez-le";
      },
    );
  });
  button("Télécharger (JSON)", () => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([json], { type: "application/json" }));
    a.download = `autun-${filePrefix}-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-")}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });
  button("Relancer", () => location.reload());
  button("Jouer", () => { location.search = ""; });
  panel.append(bar, pre);
  document.body.append(panel);
}
