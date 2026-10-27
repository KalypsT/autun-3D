// Captures et essais des prototypes de foule (étape P), au format téléphone en paysage, sans carte graphique.
// Usage : node tools/proto.cjs <url-de-base> <dossier-de-sortie> nom:requête ...
//   ex. : look-C:proto=look&r=C&n=24       capture d'une rangée de personnages dessinée par l'approche C
//         bench:bench=court&crowd=50&soak=1   déroule le banc en version brève avec une foule (sans valeur de mesure)
//         run:proto=court                   déroule la série de mesures en version brève, imprime le rapport (sans valeur de mesure)
const { chromium } = require("playwright");
const fs = require("fs");

(async () => {
  const [base, out, ...jobs] = process.argv.slice(2);
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--enable-webgl"] });
  const ctx = await browser.newContext({ viewport: { width: 915, height: 412 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  let failed = false;
  for (const job of jobs) {
    const [name, query] = [job.slice(0, job.indexOf(":")), job.slice(job.indexOf(":") + 1)];
    const page = await ctx.newPage();
    page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") console.log("console:", m.text().slice(0, 400)); });
    page.on("pageerror", (e) => { failed = true; console.log("pageerror:", e.message); });
    await page.goto(`${base}?dpr=1&${query}`);
    await page.waitForFunction(() => window.__autun && window.__autun.ready, null, { timeout: 240000 });
    if (query.startsWith("proto=court") || query.startsWith("proto=1")) {
      await page.waitForFunction(() => window.__autun.proto, null, { timeout: 1200000, polling: 2000 });
      const text = await page.evaluate(() => window.__autun.proto.text);
      fs.writeFileSync(`${out}/${name}.txt`, text);
      console.log(text);
      await page.screenshot({ path: `${out}/${name}.png`, timeout: 180000 });
    } else if (query.startsWith("bench")) {
      await page.waitForFunction(() => window.__autun.bench, null, { timeout: 1800000, polling: 2000 });
      const text = await page.evaluate(() => window.__autun.bench.text);
      fs.writeFileSync(`${out}/${name}.txt`, text);
      console.log(text);
    } else {
      // Quelques images pour que les tuiles et la foule soient en place.
      await page.evaluate(() => new Promise((res) => { let i = 0; const f = () => (++i >= 4 ? res() : requestAnimationFrame(f)); requestAnimationFrame(f); }));
      await page.waitForTimeout(1500);
      await page.screenshot({ path: `${out}/${name}.png`, timeout: 180000 });
      console.log("ok", `${out}/${name}.png`);
    }
    await page.close();
  }
  await browser.close();
  if (failed) process.exit(1);
})();
