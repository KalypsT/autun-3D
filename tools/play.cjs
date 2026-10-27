// Joue une séquence tactile dans le jeu (navigateur sans interface) et capture les étapes.
// Usage : node tools/play.cjs <url-de-base> <dossier-de-sortie> [scénario]
//   scénarios : walk (marche, course, regard), hold (au volant : vitesse imposée à chaque image, accélérateur tenu, paramètre hold=km/h), stream (course longue : chargement des tuiles), wall (marche contre un mur), still (capture à l'arrêt)
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
  } else if (scenario === "hold") {
    // Le rendu logiciel est trop lent pour accélérer vraiment : on impose le vecteur vitesse à chaque image (`speed` est recalculée à partir de vx et vy).
    const kmh = Number(new URLSearchParams(query).get("hold") ?? 15);
    await page.evaluate((v) => {
      window.__holdKmh = v;
      const raf = window.requestAnimationFrame.bind(window);
      window.requestAnimationFrame = (cb) => raf((t) => { const r = window.__autun.riding(); if (r) { const st = r.state, m = window.__holdKmh / 3.6; st.vx = Math.sin(st.heading) * m; st.vy = Math.cos(st.heading) * m; st.speed = m; } cb(t); });
    }, kmh);
    await page.keyboard.down("ArrowUp");
    for (const name of ["a", "b", "c"]) {
      await page.evaluate(() => new Promise((res) => { let i = 0; const f = () => (++i >= 3 ? res() : requestAnimationFrame(f)); requestAnimationFrame(f); }));
      await shot(`jeu-roule-${name}`);
    }
    await page.keyboard.up("ArrowUp");
  } else if (scenario === "still") {
    // Quelques images du jeu (le rendu logiciel en fait une par seconde) avant la capture.
    await page.evaluate(() => new Promise((res) => { let i = 0; const f = () => (++i >= 5 ? res() : requestAnimationFrame(f)); requestAnimationFrame(f); }));
    await shot("jeu-fixe");
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
