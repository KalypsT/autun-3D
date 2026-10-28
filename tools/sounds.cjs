// Vérifie les sons synthétisés (J7) sans haut-parleur : rend chaque scène de `src/audio/catalog.ts` dans un OfflineAudioContext,
// imprime crête, niveau moyen et part du temps audible, et écrit les fichiers WAV si on le demande.
// Usage : node tools/sounds.cjs <url-de-base> <dossier-de-sortie> [wav] [id ...]
const { chromium } = require("playwright");
const fs = require("fs");

(async () => {
  const [base, out, ...rest] = process.argv.slice(2);
  const wav = rest[0] === "wav";
  const only = wav ? rest.slice(1) : rest;
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
  const page = await browser.newPage();
  let failed = false;
  page.on("pageerror", (e) => { failed = true; console.log("pageerror:", e.message); });
  page.on("console", (m) => { if (m.type() === "error") { failed = true; console.log("console:", m.text().slice(0, 400)); } });
  await page.goto(`${base}?sounds`);
  await page.waitForFunction(() => window.__sounds, null, { timeout: 60000 });
  const ids = only.length ? only : await page.evaluate(() => window.__sounds.ids);
  const rows = [];
  for (const id of ids) {
    const r = await page.evaluate(([i, w]) => window.__sounds.render(i, w), [id, wav]);
    if (r.wav) fs.writeFileSync(`${out}/${id}.wav`, Buffer.from(r.wav, "base64"));
    const db = (v) => (v > 0 ? (20 * Math.log10(v)).toFixed(1) : "-inf");
    const flag = r.invalid ? "INVALIDE" : r.peak < 0.02 ? "MUET ?" : r.peak > 0.99 ? "SATURE ?" : "";
    rows.push(`${id.padEnd(22)} ${r.seconds.toFixed(1).padStart(5)} s  crête ${db(r.peak).padStart(6)} dB  moyenne ${db(r.rms).padStart(6)} dB  audible ${(r.active * 100).toFixed(0).padStart(3)} %  ${flag}`);
    if (flag) failed = true;
    console.log(rows[rows.length - 1]);
  }
  fs.writeFileSync(`${out}/sons.txt`, rows.join("\n") + "\n");
  await browser.close();
  process.exit(failed ? 1 : 0);
})();
