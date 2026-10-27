// Joue une séquence tactile dans le jeu (navigateur sans interface) et capture les étapes.
// Usage : node tools/play.cjs <url-de-base> <dossier-de-sortie> [scénario]
//   scénarios : walk (marche, course, regard), stream (course longue : chargement des tuiles), wall (marche contre un mur), still (capture à l'arrêt)
//   4e argument : paramètres d'URL, ex. "at=19,-157&yaw=2.17"
const { chromium } = require("playwright");
const fs = require("fs");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const [base, out, scenario = "walk", query = ""] = process.argv.slice(2);
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch({
    args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--enable-webgl"],
  });
  const ctx = await browser.newContext({ viewport: { width: 915, height: 412 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  page.on("console", (m) => { if (m.type() === "error") console.log("console:", m.text()); });
  page.on("pageerror", (e) => console.log("pageerror:", e.message));
  const cdp = await ctx.newCDPSession(page);
  const touch = (type, pts) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: pts.map(([x, y], i) => ({ x, y, id: i + 1 })) });
  const state = () => page.evaluate(() => { const p = window.__autun.player; const c = window.__autun.camera(); return { x: +p.x.toFixed(2), y: +p.y.toFixed(2), speed: +p.speed.toFixed(2), cam: [c.x, c.y, c.z].map((v) => +v.toFixed(1)) }; });
  const shot = async (name) => { await page.screenshot({ path: `${out}/${name}.png`, timeout: 120000 }); console.log("ok", `${out}/${name}.png`, JSON.stringify(await state())); };

  await page.goto(`${base}?debug&dpr=1${query ? "&" + query : ""}`);
  await page.waitForFunction(() => window.__autun && window.__autun.ready, null, { timeout: 180000 });
  await sleep(1500);
  await shot("jeu-depart");

  if (scenario === "walk") {
    // Joystick à demi-poussée : marche.
    await touch("touchStart", [[140, 300]]);
    await touch("touchMove", [[140, 270]]);
    await sleep(2500);
    await shot("jeu-marche");
    // À fond : course.
    await touch("touchMove", [[140, 240]]);
    await sleep(2500);
    await shot("jeu-course");
    await touch("touchEnd", []);
    await sleep(600);
    // Regard : glisser vers la gauche avec un second doigt à droite.
    await touch("touchStart", [[700, 200]]);
    for (let i = 1; i <= 12; i++) { await touch("touchMove", [[700 - i * 25, 200 + i * 3]]); await sleep(30); }
    await touch("touchEnd", []);
    await sleep(600);
    await shot("jeu-regard");
  } else if (scenario === "still") {
    await sleep(500);
  } else if (scenario === "stream") {
    // Téléportation par pas de 200 m vers le nord : les tuiles proches se chargent, les lointaines se déchargent.
    for (let i = 0; i < 6; i++) {
      await page.evaluate((dy) => { window.__autun.player.y += dy; }, 200);
      await sleep(5000);
      console.log(JSON.stringify(await page.evaluate(() => { const a = window.__autun; const s = a.tiles.stats; return { y: Math.round(a.player.y), tiles: s.loaded.join(" "), blocs: a.terrain.loaded, silhouettes: s.lods, draws: s.draws, tris: s.triangles, relief: a.terrainView.triangles, colliders: a.colliders.live.segments }; })));
    }
    await shot("jeu-flux");
  } else if (scenario === "wall") {
    // On marche vers la façade ouest de la place : on doit être arrêté, la caméra ne traverse pas.
    await page.keyboard.down("KeyA");
    await page.keyboard.down("ShiftLeft");
    await sleep(9000);
    await shot("jeu-mur");
    await page.keyboard.up("KeyA");
    await page.keyboard.up("ShiftLeft");
  }
  await browser.close();
})();
