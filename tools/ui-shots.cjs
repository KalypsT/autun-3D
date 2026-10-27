// Rejoue les écrans de l'interface (J1) dans le jeu, en tactile, format téléphone paysage (915 × 412), et les capture.
// Usage : node tools/ui-shots.cjs <url-de-base> <dossier-de-sortie> [scénario]
//   scénarios (séparés par des virgules) : hud (en jeu, à pied puis en voiture), pause (menu, réglages, notes, sauvegarde), map (carte agrandie, repère), save (sauvegarde et reprise), speedo (compteur de vitesse : voiture, vélo, pause), appearance (écran Apparence, aléatoire, retour en jeu, rechargement), all
const { chromium } = require("playwright");
const fs = require("fs");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const [base, out, scenario = "all"] = process.argv.slice(2);
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--enable-webgl"] });
  const want = (name) => scenario === "all" || scenario.split(",").includes(name);
  let page, cdp, errors = [];

  // init : script exécuté avant la page (ex. réglages enregistrés) ; free : sans ?dpr=1 dans l'adresse (aucun réglage grisé).
  const open = async (query = "", init = null, free = false) => {
    const ctx = await browser.newContext({ viewport: { width: 915, height: 412 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
    page = await ctx.newPage();
    page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") console.log("console:", m.text()); });
    page.on("pageerror", (e) => { errors.push(e.message); console.log("pageerror:", e.message); });
    if (init) await page.addInitScript(init);
    cdp = await ctx.newCDPSession(page);
    await page.goto(`${base}?${free ? "" : "dpr=1&"}${query}`);
    await page.waitForFunction(() => window.__autun && window.__autun.ready, null, { timeout: 240000 });
    await page.waitForFunction(() => document.getElementById("clock").textContent !== "--:--" && window.__autun.ui.minimap.cost.calls > 2, null, { timeout: 240000 });
    return ctx;
  };
  const touch = (type, pts) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: pts.map(([x, y], i) => ({ x, y, id: i + 1 })) });
  const shot = async (name) => { await page.screenshot({ path: `${out}/${name}.png`, timeout: 180000 }); console.log("ok", `${out}/${name}.png`); };
  const click = async (sel) => { await page.click(sel, { timeout: 60000 }); await sleep(300); };
  const clickText = async (text) => { await page.locator(`button:has-text("${text}")`).first().click({ timeout: 60000 }); await sleep(300); };
  const frames = (n) => page.evaluate((k) => new Promise((res) => { let i = 0; const f = () => (++i >= k ? res() : requestAnimationFrame(f)); requestAnimationFrame(f); }), n);

  if (want("hud")) {
    const ctx = await open();
    await sleep(1500);
    await shot("j1-hud-pied");
    await page.evaluate(() => document.body.classList.add("layout"));
    await shot("j1-hud-zones");
    await page.evaluate(() => document.body.classList.remove("layout"));
    // Repère hors de la minimap : flèche sur le bord et distance.
    await page.evaluate(() => window.__autun.ui.setWaypoint({ x: 400, y: 300 }));
    await sleep(2500);
    await shot("j1-hud-repere-loin");
    await page.evaluate(() => window.__autun.ui.setWaypoint(null));
    await ctx.close();
    const c2 = await open("ride=voiture");
    await sleep(1500);
    await shot("j1-hud-voiture");
    await c2.close();
  }

  if (want("pause")) {
    // Réglages enregistrés avant le chargement (définition ×1,5, ombres moyennes : plus léger pour le rendu logiciel) : rien n'est imposé par l'URL.
    const ctx = await open("", () => localStorage.setItem("autun3d.settings", JSON.stringify({ dpr: 1.5, shadows: 2048 })), true);
    await click("#pausebtn");
    await sleep(800);
    await shot("j1-pause-menu");
    await clickText("Réglages");
    await shot("j1-pause-reglages");
    await clickText("Nord en haut");
    await clickText("Lieux notés");
    await sleep(500);
    await shot("j1-pause-notes-vide");
    await clickText("Noter ce lieu");
    await sleep(500);
    await page.fill("textarea", "Le pont du Marché n'existe pas ici : en vrai c'est une rue.");
    await shot("j1-pause-note-formulaire");
    await clickText("Enregistrer");
    await sleep(800);
    await shot("j1-pause-notes-liste");
    const text = await page.evaluate(async () => (await navigator.clipboard?.readText?.().catch(() => "")) || "");
    await clickText("Sauvegarde");
    await shot("j1-pause-sauvegarde");
    await clickText("Nouvelle partie");
    await shot("j1-pause-nouvelle-partie");
    await ctx.close();
  }

  if (want("map")) {
    const ctx = await open();
    await click("#pausebtn");
    await sleep(500);
    await clickText("Carte");
    await page.waitForFunction(() => !document.getElementById("bigmap").hidden, null, { timeout: 30000 });
    await sleep(2500);
    await shot("j1-carte");
    // Appui long : pose le repère (cercle qui se remplit pendant l'appui).
    await touch("touchStart", [[600, 150]]);
    await sleep(300);
    await shot("j1-carte-appui");
    await sleep(500);
    await touch("touchEnd", []);
    await sleep(400);
    await shot("j1-carte-repere");
    // Pincement : zoom avant au centre.
    await touch("touchStart", [[400, 200], [520, 200]]);
    for (let i = 1; i <= 8; i++) { await touch("touchMove", [[400 - i * 16, 200], [520 + i * 16, 200]]); await sleep(40); }
    await touch("touchEnd", []);
    await sleep(2500);
    await shot("j1-carte-zoom");
    // Tap sur un lieu (la mairie, d'après la capture précédente) : fiche.
    await touch("touchStart", [[467, 94]]);
    await sleep(80);
    await touch("touchEnd", []);
    await sleep(600);
    await shot("j1-carte-fiche");
    await click(".bm-filter");
    await shot("j1-carte-filtres");
    await click(".bm-back");
    await click(".pm-item:has-text('Reprendre')");
    // Le repère à 35 m devant : colonne et losange dans le monde.
    await page.evaluate(() => window.__autun.ui.setWaypoint({ x: -10, y: -5 }));
    await sleep(2500);
    await shot("j1-jeu-repere");
    await ctx.close();
  }

  if (want("marker")) {
    // Repère dans le monde (colonne, losange) puis filtres de la carte.
    const ctx = await open();
    await page.evaluate(() => window.__autun.ui.setWaypoint({ x: -10, y: -5 }));
    await sleep(3000);
    await shot("j1-jeu-repere-monde");
    await click("#pausebtn");
    await sleep(500);
    await clickText("Carte");
    await page.waitForFunction(() => !document.getElementById("bigmap").hidden, null, { timeout: 30000 });
    await sleep(2000);
    await click(".bm-filter");
    await shot("j1-carte-filtres");
    await click(".bm-filter");
    await touch("touchStart", [[584, 220]]);
    await sleep(60);
    await touch("touchEnd", []);
    await sleep(500);
    await shot("j1-carte-fiche");
    await ctx.close();
  }

  if (want("save")) {
    const ctx = await open();
    await page.evaluate(() => { const p = window.__autun.player; p.x = 120; p.y = 60; });
    await sleep(1500);
    await page.evaluate(() => { window.__autun.ui.setWaypoint({ x: 400, y: 300 }); window.__autun.ui.save(); });
    const saved = await page.evaluate(() => localStorage.getItem("autun3d.save"));
    console.log("sauvegarde:", saved ? saved.slice(0, 300) : saved);
    await page.reload();
    await page.waitForFunction(() => window.__autun && window.__autun.ready, null, { timeout: 240000 });
    await sleep(1500);
    console.log("après rechargement:", JSON.stringify(await page.evaluate(() => ({ x: window.__autun.player.x, y: window.__autun.player.y, wp: window.__autun.ui.waypoint }))));
    await shot("j1-reprise");
    await ctx.close();
  }

  if (want("speedo")) {
    // Le rendu logiciel est trop lent pour accélérer vraiment : on impose le vecteur vitesse du véhicule à chaque image (`speed` est recalculée à partir de vx et vy).
    const hold = (kmh) => page.evaluate((v) => {
      window.__holdKmh = v;
      if (window.__holding) return;
      window.__holding = true;
      const raf = window.requestAnimationFrame.bind(window);
      window.requestAnimationFrame = (cb) => raf((t) => { const r = window.__autun.riding(); if (r) { const st = r.state, v = window.__holdKmh / 3.6; st.vx = Math.sin(st.heading) * v; st.vy = Math.cos(st.heading) * v; st.speed = v; } cb(t); });
    }, kmh);
    const c1 = await open("ride=voiture");
    await hold(87);
    await frames(4);
    await shot("p-compteur-voiture");
    await hold(176);
    await frames(4);
    await shot("p-compteur-voiture-max");
    await click("#pausebtn");
    await sleep(800);
    await shot("p-compteur-pause");
    await c1.close();
    const c2 = await open("ride=velo");
    await hold(19);
    await frames(4);
    await shot("p-compteur-velo");
    await c2.close();
  }

  if (want("appearance")) {
    const ctx = await open("dist=2.8");
    await click("#pausebtn");
    await sleep(800);
    await clickText("Apparence");
    await sleep(1500);
    await shot("p-apparence-defaut");
    for (const label of ["Femme", "Senior", "Chignon", "Jupe", "Lunettes"]) await clickText(label);
    await sleep(1500);
    await shot("p-apparence-modifiee");
    await clickText("Hasard");
    await sleep(1500);
    await shot("p-apparence-aleatoire");
    await page.evaluate(() => { document.querySelector(".pm-content").scrollTop = 520; });
    await sleep(600);
    await shot("p-apparence-bas");
    const stored = await page.evaluate(() => localStorage.getItem("autun3d.appearance"));
    console.log("enregistré:", stored ? stored.slice(0, 120) : stored);
    await click(".pm-item:has-text('Reprendre')");
    await page.evaluate(() => new Promise((res) => { let i = 0; const f = () => (++i >= 5 ? res() : requestAnimationFrame(f)); requestAnimationFrame(f); }));
    await shot("p-apparence-jeu");
    await page.reload();
    await page.waitForFunction(() => window.__autun && window.__autun.ready, null, { timeout: 240000 });
    await page.evaluate(() => new Promise((res) => { let i = 0; const f = () => (++i >= 5 ? res() : requestAnimationFrame(f)); requestAnimationFrame(f); }));
    await sleep(3000);
    console.log("après rechargement:", (await page.evaluate(() => localStorage.getItem("autun3d.appearance")))?.slice(0, 60));
    await shot("p-apparence-rechargement");
    await ctx.close();
  }

  await browser.close();
  if (errors.length) { console.log("ERREURS:", errors); process.exit(1); }
})();
