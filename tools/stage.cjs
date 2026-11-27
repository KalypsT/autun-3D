// Captures mises en scène pour la jaquette et l'écran de chargement (D338) : le jeu (pas le viewer), sans interface, en 1280 × 720.
// Usage : node tools/stage.cjs <url-de-base> <dossier-de-sortie> "nom;paramètres d'URL;cap;inclinaison;attente" ...
//   cap et inclinaison (rad) : caméra tournée autour du joueur (`look`, `tilt` de window.__autun) ; attente en ms après le chargement.
//   6e champ facultatif : touches appuyées après le chargement (ex. « v » : viser), séparées par des virgules.
//   ex. : node tools/stage.cjs http://localhost:4173/ out "cathedrale;at=40,-470&h=18.6&ride=moto;3.1;0.05;4000"
const { chromium } = require("playwright");
const fs = require("fs");

(async () => {
  const [base, out, ...specs] = process.argv.slice(2);
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch({
    args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--enable-webgl"],
  });
  const ctx = await browser.newContext({ viewport: { width: Number(process.env.STAGE_W ?? 1280), height: Number(process.env.STAGE_H ?? 720) }, deviceScaleFactor: 1 });
  for (const spec of specs) {
    const [name, query = "", yaw = "", pitch = "", wait = "3000", keys = ""] = spec.split(";");
    const page = await ctx.newPage();
    page.on("pageerror", (e) => console.log("pageerror:", e.message));
    // ?skipintro : ni écran de chargement ni « Touche l'écran » (captures) ; dpr=1 : la définition de la fenêtre.
    await page.goto(`${base}?dpr=1&skipintro&${query}`);
    await page.waitForFunction(() => window.__autun && window.__autun.ready, null, { timeout: 240000 });
    // Toute l'interface (éléments à identifiant) masquée, sauf la toile ; le grain et la vignette (sans identifiant) restent.
    await page.addStyleTag({ content: "body > [id]:not(#game) { display: none !important; }" });
    if (yaw !== "") await page.evaluate((v) => window.__autun.look(v), Number(yaw));
    if (pitch !== "") await page.evaluate((v) => window.__autun.tilt(v), Number(pitch));
    for (const k of keys.split(",").filter(Boolean)) await page.keyboard.press(k);
    await page.waitForTimeout(Number(wait));
    if (yaw !== "") await page.evaluate((v) => window.__autun.look(v), Number(yaw));
    if (pitch !== "") await page.evaluate((v) => window.__autun.tilt(v), Number(pitch));
    await page.waitForTimeout(600);
    const file = `${out}/${name}.png`;
    await page.screenshot({ path: file, timeout: 240000 });
    console.log("ok", file, JSON.stringify(await page.evaluate(() => { const p = window.__autun.player; return { x: p.x, y: p.y }; })));
    await page.close();
  }
  await browser.close();
})();
