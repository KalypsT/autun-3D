// Rejoue les écrans de l'interface (J1) dans le jeu, en tactile, format téléphone paysage (915 × 412), et les capture.
// Usage : node tools/ui-shots.cjs <url-de-base> <dossier-de-sortie> [scénario]
//   scénarios (séparés par des virgules) : hud (en jeu, à pied puis en voiture), pause (menu, réglages, notes, sauvegarde), map (carte agrandie, repère), save (sauvegarde et reprise), speedo (compteur de vitesse : voiture, vélo, pause), appearance (écran Apparence, aléatoire, retour en jeu, rechargement), wanted (étoiles de recherche), police (poursuite de nuit), arrest (poursuite, gendarmes à pied, arrestation), health (jauge de santé, flash, mort et reprise à l'hôpital), combat (armes en main, coups de poing, de couteau, de batte), guns (armes à feu, traits, armes au sol, appels de dessin), cache (une arme au sol), all
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

  if (want("wanted")) {
    // Cinq étoiles (J5-4) avec la jauge de santé et l'arme : la ligne du haut doit tenir (à pied, 45 points de vie, couteau).
    const c5 = await open("arms=all&hurt=45&wanted=5&h=15");
    await page.addStyleTag({ content: "#wanted .wstar { animation: none !important; } #weapon.flash button { animation: none !important; }" });
    await page.evaluate(() => window.__autun.inventory.select("knife"));
    await sleep(1500);
    await shot("j5-hud-5-etoiles");
    await c5.close();
    // Étoiles de recherche (J4-0) : niveau imposé ; sans police (J4-4), la piste est « perdue » et les étoiles clignotent : on fige l'animation.
    const ctx = await open("ride=voiture&wanted=3&h=15");
    await page.addStyleTag({ content: "#wanted .wstar { animation: none !important; }" });
    await sleep(1500);
    await shot("j4-recherche-3-voiture");
    await page.evaluate(() => window.__autun.wanted.set(1, 0, 0));
    await sleep(600);
    await shot("j4-recherche-1");
    await ctx.close();
  }

  if (want("police")) {
    // Poursuite (J4-4) : deux étoiles, la nuit ; on attend qu'une voiture de gendarmerie soit à moins de 25 m du joueur (rendu logiciel : plusieurs minutes).
    const ctx = await open("wanted=2&h=21.5&traffic=10");
    await page.waitForFunction(() => {
      const t = window.__autun.traffic();
      const p = window.__autun.player;
      return t && t.cars.some((c) => c.sim.chase && Math.hypot(c.sim.state.x - p.x, c.sim.state.y - p.y) < 25);
    }, null, { timeout: 900000, polling: 1000 });
    await page.addStyleTag({ content: "#wanted .wstar { animation: none !important; }" });
    await shot("j4-police-nuit");
    await ctx.close();
  }

  if (want("arrest")) {
    // Poursuite et arrestation (J4-5) : une étoile, en fin d'après-midi ; caméra tournée vers la gendarmerie qui arrive, puis vers les gendarmes à pied,
    // puis le bandeau d'arrestation. Rendu logiciel : 15 à 30 minutes.
    const ctx = await open("wanted=1&h=17.5&traffic=8");
    await page.addStyleTag({ content: "#wanted .wstar { animation: none !important; } #busted.show { animation: none !important; }" });
    const face = (pick) => page.evaluate((which) => {
      const a = window.__autun, p = a.player;
      let best = null, bd = 1e9;
      if (which === "car") a.traffic().forEachPolice((id, x, y) => { const d = Math.hypot(x - p.x, y - p.y); if (d < bd) { bd = d; best = { x, y }; } });
      else for (const o of a.police.officers.list) { const d = Math.hypot(o.x - p.x, o.y - p.y); if (d < bd) { bd = d; best = o; } }
      if (best) a.look(Math.atan2(best.x - p.x, best.y - p.y));
      return bd;
    }, pick);
    await page.waitForFunction(() => {
      const a = window.__autun, p = a.player, t = a.traffic();
      let near = false;
      if (t) t.forEachPolice((id, x, y, h, s, ch) => { if (ch && Math.hypot(x - p.x, y - p.y) < 30) near = true; });
      return near;
    }, null, { timeout: 1800000, polling: 1000 });
    await face("car");
    await frames(3);
    await shot("j4-gendarmerie-arrive");
    await page.waitForFunction(() => window.__autun.police.officers.list.length > 0, null, { timeout: 1800000, polling: 1000 });
    await page.waitForFunction(() => window.__autun.police.officers.list.some((o) => Math.hypot(o.x - window.__autun.player.x, o.y - window.__autun.player.y) < 7), null, { timeout: 1800000, polling: 500 });
    await face("officer");
    await frames(2);
    await shot("j4-gendarmes-a-pied");
    await page.waitForFunction(() => document.getElementById("busted").classList.contains("show"), null, { timeout: 1800000, polling: 500 });
    await frames(2);
    await shot("j4-arrete");
    await ctx.close();
  }

  if (want("health")) {
    // Santé (J5-0) : 35 points de vie, puis 15 (jauge rouge) ; mort : bandeau, reprise à l'hôpital, jauge pleine donc cachée.
    const ctx = await open("hurt=35&h=15");
    await page.addStyleTag({ content: "#health .hicon { animation: none !important; } #busted.show { animation: none !important; } #hurt { transition: none !important; }" });
    await sleep(1500);
    await shot("j5-sante-35");
    await page.evaluate(() => window.__autun.health.set(15));
    await sleep(600);
    await shot("j5-sante-15");
    await page.evaluate(() => window.__autun.health.damage(1000));
    await frames(3);
    await shot("j5-mort");
    const state = await page.evaluate(() => ({ x: window.__autun.player.x, y: window.__autun.player.y, hp: window.__autun.health.hp }));
    console.log("après la mort :", JSON.stringify(state));
    await ctx.close();
  }

  if (want("combat")) {
    // Corps à corps (J5-1) : armes en main et geste de coup. On se place face au passant le plus proche, on tient le bouton d'attaque (touche réelle),
    // et on fige le jeu (pause) à la frappe pour capturer la pose. Rendu logiciel : quelques minutes.
    const ctx = await open("arms=all&h=15");
    await page.addStyleTag({ content: "#weapon.flash button { animation: none !important; }" });
    await sleep(1500);
    await shot("j5-mains-nues");
    const facePed = () => page.evaluate(() => {
      const a = window.__autun, c = a.pedsController(), out = [], p = { x: 0, y: 0 };
      c.pick(a.player.x, a.player.y, 0, 80, Math.PI, 1, out);
      if (!out.length) return false;
      c.position(out[0], p);
      // Un mètre quinze au sud du passant, tourné vers lui ; caméra de trois quarts, côté bras droit.
      a.player.x = p.x; a.player.y = p.y - 1.15; a.player.heading = 0;
      a.look(-0.9);
      return true;
    });
    const hold = async (progress) => {
      await touch("touchStart", [[845, 272]]);
      await page.waitForFunction((u) => { const m = window.__autun.melee; if (m.active && m.progress >= u) { window.__autun.ui.paused = true; return true; } return false; }, progress, { timeout: 600000, polling: "raf" });
      await touch("touchEnd", []);
    };
    const release = async () => { await page.evaluate(() => { window.__autun.ui.paused = false; window.__autun.melee.cancel(); }); await sleep(800); };
    for (const [id, name, progress] of [["fists", "poing", 0.5], ["knife", "couteau", 0.5], ["bat", "batte", 0.5]]) {
      await page.evaluate((w) => window.__autun.inventory.select(w), id);
      await sleep(1200);
      if (!(await facePed())) console.log("pas de passant à portée");
      await hold(progress);
      await sleep(1200);
      await shot(`j5-coup-${name}`);
      await release();
    }
    // Garde armée au repos.
    await page.evaluate(() => window.__autun.inventory.select("knife"));
    await sleep(2500);
    await shot("j5-garde-couteau");
    // Mort d'un passant (J5-2) : on le tue d'un coup, on laisse tomber le corps, puis on capture le cadavre au sol.
    await page.evaluate(() => window.__autun.inventory.select("fists"));
    await facePed();
    await page.evaluate(() => {
      const a = window.__autun, c = a.pedsController(), out = [];
      c.pick(a.player.x, a.player.y, 0, 5, Math.PI, 1, out);
      if (out.length) c.hurt(out[0], 500, 0, 1, 1.4);
    });
    await sleep(4000);
    await shot("j5-cadavre");
    await ctx.close();
  }

  if (want("cache")) {
    // Une arme au sol (J5-3) : la batte du Monument aux morts, vue de côté à 6 m (caisse qui tourne et faisceau jaune).
    const ctx = await open("h=15");
    await page.evaluate(() => { const a = window.__autun; a.player.x = 34.8; a.player.y = -44; a.look(-2.356 + 0.55); });
    await sleep(3000);
    await shot("j5-arme-au-sol");
    await ctx.close();
  }

  if (want("guns")) {
    // Armes à feu (J5-3) : arme au sol (caisse et faisceau) au Monument aux morts, puis pistolet, fusil à pompe et fusil d'assaut tenus et tirés. On fige le jeu (pause)
    // à l'image du tir ; on relève les appels de dessin sans effet, avec un tir et avec une arme au sol en vue. Rendu logiciel : quelques minutes.
    const ctx = await open("arms=pistol,shotgun,rifle&h=15");
    await page.addStyleTag({ content: "#weapon.flash button { animation: none !important; }" });
    await sleep(1500);
    // Une cache : la batte du Monument aux morts, vue du nord (à 6 m).
    await page.evaluate(() => { const a = window.__autun; a.player.x = 30.8; a.player.y = -42; a.look(Math.PI); });
    await sleep(2500);
    await shot("j5-arme-au-sol");
    // Appels de dessin exacts : la même image avec le maillage des effets caché, puis montré (le jeu est figé à l'image mesurée).
    const delta = () => page.evaluate(() => {
      const a = window.__autun;
      const wasPaused = a.ui.paused;
      a.ui.paused = true;
      const r = (vis) => { a.fx.mesh.visible = vis; a.renderOnce(); return { calls: a.renderer.info.render.calls, tris: a.renderer.info.render.triangles }; };
      const had = a.fx.mesh.visible;
      const off = r(false), on = r(had);
      a.fx.mesh.visible = had;
      a.ui.paused = wasPaused;
      return { effets: a.fx.count, sans: off, avec: on, delta: on.calls - off.calls, triangles: on.tris - off.tris };
    });
    console.log("arme au sol en vue :", JSON.stringify(await delta()));
    const facePed = () => page.evaluate(() => {
      const a = window.__autun, c = a.pedsController(), out = [], p = { x: 0, y: 0 };
      c.pick(a.player.x, a.player.y, 0, 80, Math.PI, 1, out);
      if (!out.length) return false;
      c.position(out[0], p);
      a.player.x = p.x - 0.8; a.player.y = p.y - 7; a.player.heading = 0;
      a.look(-0.5);
      return true;
    });
    for (const [id, name] of [["pistol", "pistolet"], ["shotgun", "fusil-pompe"], ["rifle", "fusil-assaut"]]) {
      await page.evaluate((w) => window.__autun.inventory.select(w), id);
      await sleep(1200);
      if (!(await facePed())) console.log("pas de passant à portée");
      await touch("touchStart", [[845, 272]]);
      await page.waitForFunction(() => { const a = window.__autun; if (a.fx.count > 0 && a.gun.recoil > 0.5) { a.ui.paused = true; return true; } return false; }, null, { timeout: 600000, polling: "raf" });
      await touch("touchEnd", []);
      await sleep(1200);
      await shot(`j5-tir-${name}`);
      console.log(`tir (${name}) :`, JSON.stringify(await delta()));
      await page.evaluate(() => { window.__autun.ui.paused = false; window.__autun.gun.cancel(); });
      await sleep(800);
    }
    await ctx.close();
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
