// Captures au format téléphone en paysage (navigateur sans interface).
// Usage : node tools/capture.cjs <url-de-base> <dossier-de-sortie> vue[:paramètres] ...
//   ex. : node tools/capture.cjs http://localhost:4173/ captures aerial street:h=18
const { chromium } = require("playwright");
const fs = require("fs");

(async () => {
  const [base, out, ...views] = process.argv.slice(2);
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch({
    args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--enable-webgl"],
  });
  // Pixel 7 en paysage : 915 × 412 pixels CSS, densité 2,625 ramenée à 2 pour la capture.
  const ctx = await browser.newContext({ viewport: { width: 915, height: 412 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  for (const spec of views) {
    const [view, extra] = spec.split(":");  // extra : "h=18&day=100" ; pour une caméra libre : custom:cam=x,y,h,tx,ty,th
    const page = await ctx.newPage();
    page.on("console", (m) => { if (m.type() === "error" || m.text().startsWith("ville")) console.log("console:", m.text()); });
    page.on("pageerror", (e) => console.log("pageerror:", e.message));
    await page.goto(`${base}?view=${view}&debug${extra ? "&" + extra : ""}`);
    await page.waitForFunction(() => window.__autun && window.__autun.ready, null, { timeout: 120000 });
    await page.waitForTimeout(2500);
    const file = `${out}/${view}${extra ? "-" + extra.replace(/[=&,.]/g, "_").slice(0, 40) : ""}.png`;
    await page.screenshot({ path: file });
    console.log("ok", file);
    await page.close();
  }
  await browser.close();
})();
