// Rejoue les écrans de l'interface (J1) dans le jeu, en tactile, format téléphone paysage (915 × 412), et les capture.
// Usage : node tools/ui-shots.cjs <url-de-base> <dossier-de-sortie> [scénario]
//   scénarios (séparés par des virgules) : hud (en jeu, à pied puis en voiture), pause (menu, réglages, notes, sauvegarde), map (carte agrandie, repère), save (sauvegarde et reprise), speedo (compteur de vitesse : voiture, vélo, pause), appearance (écran Apparence, aléatoire, retour en jeu, rechargement), wanted (étoiles de recherche), police (poursuite de nuit), arrest (poursuite, gendarmes à pied, arrestation), health (jauge de santé, flash, mort et reprise à l'hôpital), combat (armes en main, coups de poing, de couteau, de batte), guns (armes à feu, traits, armes au sol, appels de dessin), cache (une arme au sol), thumb (pouce droit à pied : monter, ramasser, recharger), armed (gendarmes armés à quatre étoiles : tir, mort, pistolet lâché), aim (mode visée : caméra à l'épaule, viseur, tir), scope (fusil de précision : lunette, tir à 50 m), strafe (pas de côté en visée, arcs des tirs reçus), sprint (bouton Sprint allumé, pouce gauche poussé : vitesse et pose), guide (itinéraire vers le repère à pied, en voiture, sur la carte agrandie ; dernier véhicule), feats (saut lancé en voiture : ralenti, bandeau ; carnet de records), night (halo la nuit, D314 : phares de la voiture, feu d'artifice du 14 juillet sur le plan d'eau du Vallon, effets coupés puis allumés), money (argent, D317 : solde, gain, billets lâchés et ramassés, facture de l'hôpital, au volant), carnet (défis et carnet, D319), monuments (chasse aux monuments, D320 : découverte, fiche, liste, carte), tresors (pièces d'or des toits, D321), magasins (boulangerie ouverte et fermée, écran d'achat, D322), vehicules (achat d'une citadine chez Dacia, livraison, carnet, D323), armes (James, pistolet et balles, onglet Caches, D324), armes2 (pistolet-mitrailleur, mitrailleuse, Surplus Éduen, D325), grenade (arc, vol, explosion, D326), fumigene (gilet et fumigène au Surplus, nuage, D327), vol (vol à l'arraché, phase 4), pickpocket (phase 4), chien (chien échappé, phase 4), all
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
  // Pause (D102) : un appui sur la minimap ouvre la carte, qui est l'écran de pause ; « Menu » mène au menu.
  const pauseMap = async () => {
    await click("#minimap");
    await page.waitForFunction(() => !document.getElementById("bigmap").hidden, null, { timeout: 30000 });
  };
  const pauseMenu = async () => {
    await pauseMap();
    await click(".bm-menu");
  };
  const frames = (n) => page.evaluate((k) => new Promise((res) => { let i = 0; const f = () => (++i >= k ? res() : requestAnimationFrame(f)); requestAnimationFrame(f); }), n);

  if (want("night")) {
    // Halo lumineux (D314) : la voiture du joueur phares allumés dans une rue, puis le feu d'artifice du 14 juillet (date 9, 23 h 20) vu
    // de la rive ouest du plan d'eau du Vallon ; chaque fois effets coupés (?post=0) puis allumés.
    for (const post of [0, 2]) {
      const c1 = await open(`ride=voiture&h=22.5&speed=0&post=${post}`);
      await sleep(2500);
      await shot(`d314-phares-post${post}`);
      await c1.close();
      const c2 = await open(`h=23.33&speed=0&date=9&at=1105,300&yaw=0.8&post=${post}`);
      // Le spectacle a commencé avant notre arrivée : on laisse monter quelques fusées.
      await page.evaluate(() => new Promise((res) => setTimeout(res, 6000)));
      await shot(`d314-feu-artifice-post${post}`);
      await c2.close();
    }
  }

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

  if (want("sprint")) {
    // Sprint (PJ 1-1) : un appui sur le bouton, puis le pouce gauche poussé à moitié : pleine vitesse quand même.
    const ctx = await open("h=11");
    await sleep(1500);
    const b = await page.locator("#sprint").boundingBox();
    await touch("touchStart", [[b.x + b.width / 2, b.y + b.height / 2]]);
    await touch("touchEnd", []);
    await touch("touchStart", [[200, 300]]);
    await touch("touchMove", [[200, 270]]);
    await sleep(4000);
    const speed = await page.evaluate(() => window.__autun.player?.speed ?? null);
    console.log("vitesse en sprint (m/s) :", speed);
    await shot("pj1-sprint");
    await touch("touchEnd", []);
    await sleep(1500);
    console.log("bouton après lâcher :", await page.evaluate(() => document.getElementById("sprint").className));
    await ctx.close();
  }

  if (want("guide")) {
    // Guidage (D310) : repère vers la gare ; à pied (trottoirs), puis en voiture (routes, sens uniques), puis la carte agrandie.
    const routeReady = () => page.waitForFunction(() => window.__autun.ui.guide.points !== null, null, { timeout: 120000 });
    const ctx = await open("h=11");
    await page.evaluate(() => window.__autun.ui.setWaypoint({ x: 600, y: -900 }));
    await routeReady();
    await sleep(800);
    console.log("à pied :", await page.evaluate(() => ({ m: Math.round(window.__autun.ui.guide.remaining), ms: window.__autun.ui.guide.lastMs.toFixed(1) })));
    await shot("pj1-guide-pied");
    await ctx.close();
    const c2 = await open("ride=voiture&h=11");
    await page.evaluate(() => window.__autun.ui.setWaypoint({ x: 600, y: -900 }));
    await routeReady();
    await sleep(800);
    console.log("en voiture :", await page.evaluate(() => ({ m: Math.round(window.__autun.ui.guide.remaining), ms: window.__autun.ui.guide.lastMs.toFixed(1) })));
    await shot("pj1-guide-voiture");
    // Descendre (E), s'éloigner un peu : la pastille du dernier véhicule apparaît.
    await page.keyboard.press("KeyE");
    await sleep(1500);
    await page.keyboard.down("KeyS");
    await sleep(3000);
    await page.keyboard.up("KeyS");
    await sleep(800);
    await shot("pj1-guide-dernier-vehicule");
    await pauseMap();
    await sleep(2500);
    await shot("pj1-guide-carte");
    await c2.close();
  }

  if (want("feats")) {
    // Sensations (D311) : la voiture lancée en l'air à 90 km/h depuis 3 m ; ralenti pendant le vol, bandeau à la réception. Puis le carnet (D312).
    const ctx = await open("ride=voiture&h=11");
    await sleep(1500);
    await page.evaluate(() => {
      const s = window.__autun.riding().state;
      s.speed = 25; s.vx = Math.sin(s.heading) * 25; s.vy = Math.cos(s.heading) * 25; s.z += 3; s.air = 3; s.vz = 4;
    });
    // Vitesse du temps pendant le vol (rendu logiciel lent : on la relève à chaque image).
    const minScale = await page.evaluate(() => new Promise((res) => {
      let min = 1, n = 0;
      const f = () => { min = Math.min(min, window.__autun.timeScale.current); if (++n < 400 && !document.getElementById("feat").classList.contains("show")) requestAnimationFrame(f); else res(min); };
      requestAnimationFrame(f);
    }));
    console.log("saut :", await page.evaluate(() => ({ text: document.getElementById("feat").textContent, record: window.__autun.records.values.jump })), "temps le plus lent :", minScale);
    // Le bandeau ne dure que 2,6 s : on le rejoue, animation figée, pour la capture.
    await page.addStyleTag({ content: "#feat.show { animation: none !important; }" });
    await page.evaluate(() => window.__autun.showFeat("Saut 46 m · record !"));
    await sleep(300);
    await shot("pj1-saut-bandeau");
    await pauseMenu();
    await clickText("Carnet");
    await clickText("Records");
    await sleep(500);
    await shot("pj1-records");
    await ctx.close();
  }

  if (want("money")) {
    // Argent (PJ 3, D317) : le solde sous la date et un gain qui monte ; des billets lâchés devant soi, ramassés ; la facture de l'hôpital ;
    // le solde au volant (la date disparaît, il remonte).
    const ctx = await open("money=1250&h=15");
    await sleep(1500);
    await page.addStyleTag({ content: "#money .m-pop { animation: none !important; transform: translateY(17px); } #busted.show { animation: none !important; }" });
    await page.evaluate(() => window.__autun.wallet.earn(250, "Découverte"));
    await frames(3);
    await shot("pj3-argent");
    await page.evaluate(() => { for (const el of document.querySelectorAll("#money .m-pop")) el.remove(); });
    const heap = await page.evaluate(() => {
      const a = window.__autun, p = a.player, h = p.heading;
      // Devant et un peu à droite : juste devant, la liasse serait cachée par les jambes du personnage.
      const q = { x: p.x + Math.sin(h) * 2.6 + Math.cos(h) * 1.3, y: p.y + Math.cos(h) * 2.6 - Math.sin(h) * 1.3 };
      a.pickups.dropCash(q.x, q.y, 23);
      a.look(h);
      a.tilt(0.45);
      return q;
    });
    await frames(4);
    await shot("pj3-billets");
    await page.evaluate((q) => { const p = window.__autun.player; p.x = q.x; p.y = q.y; }, heap);
    await frames(4);
    console.log("solde après les billets :", await page.evaluate(() => window.__autun.wallet.balance));
    await shot("pj3-billets-ramasses");
    await page.evaluate(() => window.__autun.health.damage(1000));
    await frames(3);
    await shot("pj3-mort-facture");
    console.log("solde après la mort :", await page.evaluate(() => window.__autun.wallet.balance), "armes :", await page.evaluate(() => window.__autun.inventory.toSave().owned));
    await ctx.close();
    const c2 = await open("money=1250&ride=voiture&h=15");
    await sleep(1500);
    await shot("pj3-argent-voiture");
    await c2.close();
  }

  if (want("carnet")) {
    // Carnet et défis (PJ 3, D319) : un saut de 60 m franchit deux paliers d'un coup (bandeaux à la suite, primes au solde) ; puis le carnet,
    // onglet Défis et onglet Records.
    const ctx = await open("money=200&h=15");
    await sleep(1500);
    await page.addStyleTag({ content: "#feat.show { animation: none !important; } #money .m-pop { animation: none !important; transform: translateY(17px); }" });
    await page.evaluate(() => {
      const a = window.__autun;
      a.challenges.add("foot", 5200);
      a.challenges.offer("topSpeed", 34);
      for (const h of a.challenges.offer("jump", 60)) { a.wallet.earn(h.reward, "Défi"); }
    });
    console.log("solde :", await page.evaluate(() => window.__autun.wallet.balance), "paliers :", await page.evaluate(() => window.__autun.challenges.count));
    // Le bandeau ne dure que 2,6 s (temps réel) : rendu logiciel lent, on capture juste après l'avoir demandé.
    await page.addStyleTag({ content: "body.game #feat.keep { display: block !important; }" });
    await page.evaluate(() => { window.__autun.showFeat("Défi argent : saut de 50 m"); document.getElementById("feat").classList.add("keep"); });
    await sleep(300);
    await shot("pj3-defi-bandeau");
    await page.evaluate(() => window.__autun.ui.showCarnet("defis"));
    await sleep(600);
    await shot("pj3-carnet-defis");
    await clickText("Records");
    await sleep(400);
    await shot("pj3-carnet-records");
    await ctx.close();
  }

  if (want("vol")) {
    // Vol à l'arraché (phase 4, E1) : le voleur rejoint sa victime, lui arrache son sac (bulle « Au voleur ! », repères sur la minimap) ;
    // il est mis à terre, le sac tombe ; ramassé, rendu à la victime (bouton « Rendre le sac », prime) ; l'onglet « Faits divers » du carnet.
    const ctx = await open("event=vol&h=15&money=200&peds=150");
    await page.addStyleTag({ content: "body.game #feat.keep { display: block !important; } #money .m-pop { animation: none !important; transform: translateY(17px); }" });
    await page.waitForFunction(() => window.__autun.events.director.active.length > 0, null, { timeout: 240000, polling: 500 });
    const roles = await page.evaluate(() => { const e = window.__autun.events.director.active[0]; return { victim: e.victim, thief: e.thief }; });
    console.log("vol lancé :", roles);
    // Pour la capture : le joueur à 10 m de la victime, de côté (dans le jeu, elle est à 15 – 45 m).
    await page.evaluate((s) => {
      const a = window.__autun, sim = a.pedsController().eventPeds(), q = { x: 0, y: 0 }, h = sim.headingOf(s);
      sim.position(s, q);
      a.player.x = q.x + Math.cos(h) * 9 + Math.sin(h) * 3;
      a.player.y = q.y - Math.sin(h) * 9 + Math.cos(h) * 3;
    }, roles.victim);
    // On regarde la victime.
    const lookAt = async (slot) => page.evaluate((s) => {
      const a = window.__autun, sim = a.pedsController().eventPeds(), q = { x: 0, y: 0 };
      sim.position(s, q);
      a.look(Math.atan2(q.x - a.player.x, q.y - a.player.y));
      a.tilt(0.12);
    }, slot);
    for (let k = 0; k < 400; k++) {
      await lookAt(roles.victim);
      const phase = await page.evaluate(() => window.__autun.events.director.active[0]?.phase ?? "fini");
      if (phase !== "approach") break;
      await sleep(400);
    }
    await sleep(700);
    await shot("pj4-vol-arrache");
    await lookAt(roles.thief);
    await sleep(1500);
    await shot("pj4-vol-fuite");
    // Le voleur plaqué (comme un joueur en sprint) : le sac tombe.
    await page.evaluate((s) => window.__autun.pedsController().eventPeds().applyImpulse(s, 0, 4.4), roles.thief);
    await page.waitForFunction(() => window.__autun.events.director.active[0]?.phase === "bag", null, { timeout: 60000, polling: 200 });
    const bag = await page.evaluate(() => { const e = window.__autun.events.director.active[0]; return { ...e.bagAt }; });
    // Le sac un peu à droite du personnage (droit devant, il serait caché par lui).
    await page.evaluate((b) => { const a = window.__autun; a.player.x = b.x - 3.2; a.player.y = b.y - 2.2; a.look(Math.atan2(3.2, 2.2) - 0.3); a.tilt(0.35); }, bag);
    await sleep(1200);
    await shot("pj4-vol-sac");
    await page.evaluate((b) => { const p = window.__autun.player; p.x = b.x; p.y = b.y; }, bag);
    await page.waitForFunction(() => window.__autun.events.director.active[0]?.phase === "carried", null, { timeout: 60000, polling: 200 });
    const v = await page.evaluate((s) => { const q = { x: 0, y: 0 }; window.__autun.pedsController().eventPeds().position(s, q); return q; }, roles.victim);
    await page.evaluate((q) => { const a = window.__autun; a.player.x = q.x + 1.6; a.player.y = q.y - 1.2; a.look(Math.atan2(-1.6, 1.2)); a.tilt(0.25); }, v);
    await page.waitForFunction(() => document.getElementById("action").textContent.includes("Rendre"), null, { timeout: 60000, polling: 200 });
    await sleep(500);
    await shot("pj4-vol-rendre");
    await click("#action");
    await page.evaluate(() => document.getElementById("feat").classList.add("keep"));
    await sleep(600);
    console.log("solde après le sac rendu :", await page.evaluate(() => window.__autun.wallet.balance));
    await shot("pj4-vol-merci");
    await sleep(1500);
    await page.evaluate(() => window.__autun.ui.showCarnet("faits"));
    await sleep(600);
    await shot("pj4-carnet-faits");
    await ctx.close();
  }

  if (want("pickpocket")) {
    // Pickpocket (phase 4, E2) : on se fait voler (bulle « Hé ! », « −80 € ») ; le pickpocket plaqué lâche les billets ; ramassés.
    const ctx = await open("event=pickpocket&h=15&money=800&peds=150");
    await page.addStyleTag({ content: "body.game #feat.keep { display: block !important; } #money .m-pop { animation: none !important; transform: translateY(17px); }" });
    // Le joueur dans le coin le plus animé (une rue fréquentée) : il faut trois passants à moins de 12 m.
    for (let k = 0; k < 60; k++) {
      const started = await page.evaluate(() => {
        const a = window.__autun, sim = a.pedsController()?.eventPeds();
        if (a.events.director.active.length > 0) return true;
        if (!sim) return false;
        const q = { x: 0, y: 0 }, out = [];
        let best = -1, bn = 0;
        for (let i = 0; i < sim.capacity; i++) {
          if (sim.modeOf(i) !== 0) continue;
          sim.position(i, q);
          out.length = 0;
          const n = sim.queryCircle(q.x, q.y, 10, out);
          if (n > bn) { bn = n; best = i; }
        }
        if (best >= 0) { sim.position(best, q); a.player.x = q.x + 1; a.player.y = q.y + 1; }
        return false;
      });
      if (started) break;
      await sleep(2000);
    }
    await page.waitForFunction(() => window.__autun.events.director.active.length > 0, null, { timeout: 240000, polling: 500 });
    const slot = await page.evaluate(() => window.__autun.events.director.active[0].thief);
    await page.waitForFunction(() => window.__autun.events.director.active[0]?.phase !== "approach", null, { timeout: 120000, polling: 200 });
    // On se retourne vers lui.
    await page.evaluate((s) => { const a = window.__autun, q = { x: 0, y: 0 }; a.pedsController().eventPeds().position(s, q); a.look(Math.atan2(q.x - a.player.x, q.y - a.player.y) + 0.3); a.tilt(0.15); }, slot);
    await sleep(900);
    await shot("pj4-pickpocket");
    await page.evaluate((s) => { const a = window.__autun, sim = a.pedsController().eventPeds(), q = { x: 0, y: 0 }; sim.position(s, q); sim.tackle(s, (q.x - a.player.x) * 0.5, (q.y - a.player.y) * 0.5); }, slot);
    await page.waitForFunction(() => window.__autun.events.director.active[0]?.phase === "cash", null, { timeout: 60000, polling: 200 });
    const c = await page.evaluate(() => ({ ...window.__autun.events.director.active[0].cashAt }));
    await page.evaluate((q) => { const a = window.__autun; a.player.x = q.x - 3; a.player.y = q.y - 2; a.look(Math.atan2(3, 2) - 0.3); a.tilt(0.35); }, c);
    await sleep(1200);
    await shot("pj4-pickpocket-billets");
    await page.evaluate((q) => { const p = window.__autun.player; p.x = q.x; p.y = q.y; }, c);
    await page.waitForFunction(() => window.__autun.events.director.active.length === 0, null, { timeout: 60000, polling: 200 });
    await page.evaluate(() => document.getElementById("feat").classList.add("keep"));
    await sleep(500);
    console.log("solde après le pickpocket :", await page.evaluate(() => window.__autun.wallet.balance));
    await shot("pj4-pickpocket-recupere");
    await ctx.close();
  }

  if (want("chien")) {
    // Chien échappé (phase 4, E3) : le chien file, son maître court après en l'appelant ; on l'attrape ; on le rend.
    const ctx = await open("event=chien&h=10&peds=150");
    await page.addStyleTag({ content: "body.game #feat.keep { display: block !important; } #money .m-pop { animation: none !important; transform: translateY(17px); }" });
    await page.waitForFunction(() => window.__autun.events.director.active.length > 0, null, { timeout: 240000, polling: 500 });
    await sleep(2500);
    const dog = async () => page.evaluate(() => { const e = window.__autun.events.director.active[0]; return { x: e.dog.x, y: e.dog.y }; });
    let d = await dog();
    // Pour la capture : le joueur à 12 m du chien.
    // Le chien un peu à droite du personnage (droit devant, il serait caché par lui).
    await page.evaluate((q) => { const a = window.__autun; a.player.x = q.x - 7; a.player.y = q.y - 6; a.look(Math.atan2(7, 6) - 0.35); a.tilt(0.25); }, d);
    await sleep(1500);
    await shot("pj4-chien");
    // On s'approche au pas (posé à côté de lui, jusqu'à ce que le bouton « Attraper » vienne : il bouge) ; le geste part aussitôt après l'image.
    const near = (who) => page.evaluate((w) => {
      const a = window.__autun, e = a.events.director.active[0];
      if (!e) return false;
      const q = { x: e.dog.x, y: e.dog.y };
      if (w === "owner") a.pedsController().eventPeds().position(e.owner, q);
      a.player.x = q.x - 1; a.player.y = q.y - 0.6; a.look(Math.atan2(1, 0.6) - 0.4); a.tilt(0.3);
      return true;
    }, who);
    const act = (verb) => page.evaluate((v) => {
      const a = window.__autun, p = a.player, x = a.events.action({ x: p.x, y: p.y, vx: 0, vy: 0, speed: 0, onFoot: true, yaw: 0 });
      if (!x || x.verb !== v) return false;
      x.run();
      return true;
    }, verb);
    let shotDone = false;
    for (let k = 0; k < 80; k++) {
      await near("dog");
      await sleep(300);
      if (!shotDone && await page.evaluate(() => document.getElementById("action").textContent.includes("Attraper"))) {
        await shot("pj4-chien-attraper");
        shotDone = true;
      }
      if (await act("Attraper")) break;
    }
    for (let k = 0; k < 80; k++) {
      await near("owner");
      await sleep(400);
      if (await page.evaluate(() => document.getElementById("action").textContent.includes("Rendre"))) {
        await shot("pj4-chien-rendre");
        if (await act("Rendre")) break;
      }
    }
    await page.evaluate(() => document.getElementById("feat").classList.add("keep"));
    await sleep(600);
    await shot("pj4-chien-merci");
    await ctx.close();
  }

  if (want("monuments")) {
    // Chasse aux monuments (PJ 3, D320) : on arrive à la porte d'Arroux (bandeau, prime, « Lire la fiche ») ; la fiche dans le carnet ;
    // la liste des monuments ; la carte agrandie avec les « ? ».
    const ctx = await open("money=200&h=16&at=-264,1020&yaw=0");
    await sleep(1500);
    await page.addStyleTag({ content: "body.game #feat.keep { display: block !important; } #money .m-pop { animation: none !important; transform: translateY(17px); }" });
    await page.evaluate(() => { const p = window.__autun.player; p.x = -266; p.y = 1048; });
    await page.waitForFunction(() => window.__autun.notebook.has("monuments", "arroux"), null, { timeout: 120000, polling: 200 });
    await page.evaluate(() => document.getElementById("feat").classList.add("keep"));
    await sleep(300);
    console.log("solde :", await page.evaluate(() => window.__autun.wallet.balance));
    await shot("pj3-decouverte");
    await click("#discover");
    await sleep(500);
    await shot("pj3-fiche");
    await clickText("Retour à la liste");
    await sleep(300);
    await shot("pj3-carnet-monuments");
    await page.evaluate(() => window.__autun.ui.setPaused(false));
    await frames(2);
    await pauseMap();
    await sleep(800);
    await shot("pj3-carte-monuments");
    await ctx.close();
  }

  if (want("tresors")) {
    // Pièces d'or des toits (PJ 3, D321) : sur le toit d'une pièce facile du centre, la pièce devant soi ; ramassée ; le carnet par quartier.
    const sites = JSON.parse(fs.readFileSync("src/data/treasures.json", "utf8"));
    const t = sites.find((q) => q.group === "Centre" && q.level === 1);
    const ctx = await open(`money=200&h=15&at=${t.x},${t.y - 6}&yaw=0`);
    await sleep(1500);
    await page.addStyleTag({ content: "body.game #feat.keep { display: block !important; } #money .m-pop { animation: none !important; transform: translateY(17px); }" });
    // Sur le toit, à 1,8 m de la pièce (hors de portée de ramassage), face à elle : on essaie les quatre côtés, on garde celui où l'on tient.
    let placed = null;
    for (const [dx, dy, yaw] of [[0, -1.8, 0], [0, 1.8, Math.PI], [-1.8, 0, Math.PI / 2], [1.8, 0, -Math.PI / 2]]) {
      await page.evaluate(([q, ddx, ddy, yy]) => {
        const a = window.__autun, p = a.player;
        p.x = q.x + ddx; p.y = q.y + ddy; p.z = q.z + 0.05; p.vz = 0; p.vx = 0; p.vy = 0;
        // Un peu de biais : droit derrière le personnage, la pièce serait cachée par son corps.
        a.look(yy + 0.55); a.tilt(0.4);
      }, [t, dx, dy, yaw]);
      await frames(4);
      const z = await page.evaluate(() => window.__autun.player.z);
      if (Math.abs(z - t.z) < 0.6) { placed = { dx, dy, z }; break; }
    }
    console.log("pièce", t.id, "joueur", JSON.stringify(placed));
    await shot("pj3-piece");
    await page.evaluate((q) => { const p = window.__autun.player; p.x = q.x; p.y = q.y; }, t);
    await page.waitForFunction((id) => window.__autun.notebook.has("tresors", id), t.id, { timeout: 60000, polling: 200 });
    await page.evaluate(() => document.getElementById("feat").classList.add("keep"));
    await sleep(300);
    await shot("pj3-piece-trouvee");
    await page.evaluate(() => window.__autun.ui.showCarnet("tresors"));
    await sleep(500);
    await shot("pj3-carnet-pieces");
    await ctx.close();
  }

  if (want("magasins")) {
    // Magasins (PJ 3, D322) : la boulangerie Benzaabar, rue de la mairie, un mercredi à 10 h, blessé : « Entrer », l'écran d'achat, un sandwich ;
    // puis la même à 21 h : « Fermé » et le bandeau qui dit quand elle ouvre.
    const ctx = await open("money=40&hurt=40&h=10&weekday=3&at=-30,104&yaw=-1.6");
    await page.waitForFunction(() => window.__autun.ui.shops.length > 0, null, { timeout: 120000 });
    await sleep(1500);
    console.log("bouton :", await page.evaluate(() => document.getElementById("action").getAttribute("aria-label")));
    await shot("pj3-boulangerie-entrer");
    await click("#action");
    await sleep(400);
    await shot("pj3-boulangerie-ecran");
    await page.locator("#shop .sh-buy").nth(1).click();
    await sleep(300);
    console.log("après :", await page.evaluate(() => ({ hp: window.__autun.health.hp, solde: window.__autun.wallet.balance })));
    await shot("pj3-boulangerie-achat");
    await ctx.close();
    const c2 = await open("money=40&h=21&weekday=3&at=-30,104&yaw=-1.6");
    await page.waitForFunction(() => window.__autun.ui.shops.length > 0, null, { timeout: 120000 });
    await sleep(1500);
    await page.addStyleTag({ content: "body.game #feat.keep { display: block !important; }" });
    await click("#action");
    await page.evaluate(() => document.getElementById("feat").classList.add("keep"));
    await sleep(300);
    console.log("fermé :", await page.evaluate(() => document.getElementById("feat").textContent));
    await shot("pj3-boulangerie-fermee");
    await c2.close();
  }

  if (want("vehicules")) {
    // Véhicules achetés (PJ 3, D323) : chez Dacia Autun un mercredi à 11 h, 20 000 € ; l'écran du concessionnaire ; une citadine dans sa
    // troisième couleur ; livrée devant ; l'onglet Véhicules du carnet.
    const ctx = await open("money=20000&h=11&weekday=3&at=-1500,735&yaw=0");
    await page.waitForFunction(() => window.__autun.ui.shops.some((s) => s.kind === "car"), null, { timeout: 120000 });
    await sleep(1500);
    const shop = await page.evaluate(() => { const s = window.__autun.ui.shops.find((q) => q.name.startsWith("Dacia")); return { x: s.x, y: s.y, name: s.name }; });
    // Autour du magasin, au sol (le point du lieu est dans le bâtiment : on y partirait sur le toit), jusqu'à ce que « Entrer » apparaisse.
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2, r = 26;
      await page.evaluate(([q, aa, rr]) => { const p = window.__autun.player; p.x = q.x + Math.sin(aa) * rr; p.y = q.y + Math.cos(aa) * rr; p.z = -1000; p.vz = 0; }, [shop, a, r]);
      await frames(4);
      const label = await page.evaluate(() => document.getElementById("action").getAttribute("aria-label") || "");
      if (label.startsWith("Entrer")) break;
    }
    console.log("bouton :", await page.evaluate(() => document.getElementById("action").getAttribute("aria-label")));
    await click("#action");
    await sleep(400);
    await page.locator("#shop .sh-row").nth(1).locator(".sh-swatch").nth(2).click();
    await sleep(200);
    await shot("pj3-concession");
    await page.locator("#shop .sh-row").nth(1).locator(".sh-buy").click();
    await sleep(300);
    console.log("note :", await page.evaluate(() => document.querySelector("#shop .sh-note")?.textContent), "solde :", await page.evaluate(() => window.__autun.wallet.balance));
    await shot("pj3-concession-achat");
    await click("#shop .sh-leave");
    const car = await page.evaluate(() => { const v = window.__autun.fleet.get("achat-1"); return v ? { x: v.state.x, y: v.state.y } : null; });
    console.log("livrée :", JSON.stringify(car));
    if (car) await page.evaluate((c) => { const a = window.__autun, p = a.player; a.look(Math.atan2(c.x - p.x, c.y - p.y)); a.tilt(0.25); }, car);
    await frames(4);
    await shot("pj3-livraison");
    await page.evaluate(() => window.__autun.ui.showCarnet("vehicules"));
    await sleep(500);
    await shot("pj3-carnet-vehicules");
    await ctx.close();
  }

  if (want("armes")) {
    // Armureries (PJ 3, D324) : James, un mercredi à 10 h, 1 000 € : un pistolet, puis des balles ; l'onglet Caches du carnet.
    const ctx = await open("money=1000&h=10&weekday=3&at=2,-190&yaw=3.14");
    await page.waitForFunction(() => window.__autun.ui.shops.some((s) => s.name === "James"), null, { timeout: 120000 });
    await sleep(1500);
    const shop = await page.evaluate(() => { const s = window.__autun.ui.shops.find((q) => q.name === "James"); return { x: s.x, y: s.y }; });
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2;
      await page.evaluate(([q, aa]) => { const p = window.__autun.player; p.x = q.x + Math.sin(aa) * 8; p.y = q.y + Math.cos(aa) * 8; p.z = -1000; p.vz = 0; }, [shop, a]);
      await frames(4);
      if ((await page.evaluate(() => document.getElementById("action").getAttribute("aria-label") || "")).startsWith("Entrer")) break;
    }
    console.log("bouton :", await page.evaluate(() => document.getElementById("action").getAttribute("aria-label")));
    await click("#action");
    await sleep(400);
    await page.locator("#shop .sh-row").nth(0).locator(".sh-buy").click();
    await sleep(200);
    await page.locator("#shop .sh-row").nth(3).locator(".sh-buy").click();
    await sleep(300);
    console.log("note :", await page.evaluate(() => document.querySelector("#shop .sh-note")?.textContent), "solde :", await page.evaluate(() => window.__autun.wallet.balance));
    await shot("pj3-james");
    await click("#shop .sh-leave");
    await page.evaluate(() => window.__autun.ui.showCarnet("caches"));
    await sleep(500);
    await shot("pj3-carnet-caches");
    await ctx.close();
  }

  if (want("armes2")) {
    // Pistolet-mitrailleur et mitrailleuse (PJ 3, D325) : chacune en main, vue de trois quarts ; puis l'écran du Surplus Éduen.
    for (const id of ["smg", "lmg"]) {
      const c = await open(`arms=${id}&h=15`);
      await sleep(1500);
      await page.evaluate((w) => { const a = window.__autun; a.inventory.select(w); a.look(a.player.heading + 2.4); a.tilt(0.15); }, id);
      await frames(6);
      await shot(`pj3-${id}`);
      await c.close();
    }
    const ctx = await open("money=8000&h=10&weekday=3&at=-28,36&yaw=-1.5");
    await page.waitForFunction(() => window.__autun.ui.shops.some((s) => s.name === "Surplus Éduen"), null, { timeout: 120000 });
    await sleep(1500);
    console.log("bouton :", await page.evaluate(() => document.getElementById("action").getAttribute("aria-label")));
    await click("#action");
    await sleep(400);
    await shot("pj3-surplus");
    await ctx.close();
  }

  if (want("grenade")) {
    // Grenades (PJ 3, D326) : bouton tenu, l'arc ; relâché, la grenade vole ; trois secondes plus tard, l'explosion.
    const ctx = await open("arms=grenade&h=15");
    await sleep(1500);
    await page.evaluate(() => { const a = window.__autun; a.inventory.select("grenade"); a.tilt(0.1); });
    await frames(3);
    const b = await page.locator("#attack").boundingBox();
    const cx = b.x + b.width / 2, cy = b.y + b.height / 2;
    await touch("touchStart", [[cx, cy]]);
    await frames(6);
    await shot("pj3-grenade-arc");
    await touch("touchEnd", []);
    await frames(8);
    await shot("pj3-grenade-vol");
    console.log("grenades :", await page.evaluate(() => window.__autun.inventory.reserveOf("grenade")));
    // Rendu logiciel lent : on attend la mèche (3 s de jeu), puis on capture l'explosion.
    await page.evaluate(() => new Promise((res) => setTimeout(res, 3200)));
    await frames(2);
    await shot("pj3-grenade-explosion");
    await ctx.close();
  }

  if (want("fumigene")) {
    // Gilet et fumigène (PJ 3, D327) : au Surplus Éduen, un gilet et un fumigène ; la barre du gilet sous la santé ; le fumigène lancé, son nuage.
    const ctx = await open("money=1000&hurt=70&h=10&weekday=3&at=-28,36&yaw=-1.5");
    await page.waitForFunction(() => window.__autun.ui.shops.some((s) => s.name === "Surplus Éduen"), null, { timeout: 120000 });
    await sleep(1500);
    await click("#action");
    await sleep(400);
    for (const id of ["gilet", "smoke"]) {
      const i = await page.evaluate((w) => window.__autun.ui.shops.find((s) => s.name === "Surplus Éduen").items.findIndex((q) => q.id === w), id);
      await page.locator("#shop .sh-row").nth(i).locator(".sh-buy").click();
      await sleep(200);
    }
    console.log("note :", await page.evaluate(() => document.querySelector("#shop .sh-note")?.textContent), "solde :", await page.evaluate(() => window.__autun.wallet.balance));
    await click("#shop .sh-leave");
    await page.evaluate(() => { const a = window.__autun; a.inventory.select("smoke"); a.look(a.player.heading + Math.PI); a.tilt(0.05); });
    await frames(3);
    const b = await page.locator("#attack").boundingBox();
    await touch("touchStart", [[b.x + b.width / 2, b.y + b.height / 2]]);
    await frames(4);
    await touch("touchEnd", []);
    await page.evaluate(() => new Promise((res) => setTimeout(res, 3500)));
    await frames(3);
    await shot("pj3-fumigene");
    await ctx.close();
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

  if (want("thumb")) {
    // Groupe du pouce droit à pied (D103) : pistolet en main (bouton de rechargement) à côté d'une voiture garée (« Monter »), puis sur une batte au sol (ramassée automatiquement, D159 : plus de bouton « Ramasser »).
    const ctx = await open("arms=pistol&h=15");
    await page.addStyleTag({ content: "#weapon.flash button { animation: none !important; }" });
    await page.evaluate(() => {
      const a = window.__autun, p = a.player;
      a.inventory.select("pistol");
      const k = a.fleet.nearest(p.x, p.y, "car");
      if (k) { p.x = k.vehicle.state.x + 2; p.y = k.vehicle.state.y; }
    });
    await sleep(2500);
    await shot("p-pouce-monter");
    await page.evaluate(() => {
      const a = window.__autun, p = a.player, c = a.pickups.list.find((q) => q.weapon === "bat");
      if (c) { p.x = c.x + 0.5; p.y = c.y; }
    });
    await sleep(2500);
    await shot("p-pouce-ramasse");
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

  if (want("aim")) {
    // Mode visée (D205) : pistolet en main face à un passant à 7 m, bouton Viser touché (caméra à l'épaule, viseur au centre), puis un tir figé à l'image.
    const ctx = await open("arms=pistol,rifle&h=15");
    await sleep(1500);
    await page.evaluate(() => window.__autun.inventory.select("pistol"));
    await sleep(800);
    const placed = await page.evaluate(() => {
      const a = window.__autun, c = a.pedsController(), out = [], p = { x: 0, y: 0 };
      c.pick(a.player.x, a.player.y, 0, 80, Math.PI, 1, out);
      if (!out.length) return false;
      c.position(out[0], p);
      a.player.x = p.x - 0.8; a.player.y = p.y - 7; a.player.heading = 0;
      a.look(0.05);
      return true;
    });
    if (!placed) console.log("pas de passant à portée");
    await shot("t1-avant-visee");
    // Bouton Viser : à gauche du bouton de tir (right 138 px, bottom 34 px, 64 px).
    await touch("touchStart", [[915 - 170, 412 - 66]]);
    await touch("touchEnd", []);
    await page.waitForFunction(() => document.body.classList.contains("aiming") && window.__autun.gun.aiming, null, { timeout: 120000, polling: "raf" });
    await sleep(2500);
    await shot("t1-visee");
    console.log("visée :", JSON.stringify(await page.evaluate(() => { const g = window.__autun.gun; return { kind: g.aimKind, point: g.aimPoint, facing: g.facing }; })));
    // Bouton de tir : son centre (right 26 px, bottom 30 px, 96 px).
    await touch("touchStart", [[915 - 74, 412 - 78]]);
    await page.waitForFunction(() => { const a = window.__autun; if (a.fx.count > 0 && a.gun.recoil > 0.5) { a.ui.paused = true; return true; } return false; }, null, { timeout: 600000, polling: "raf" });
    await touch("touchEnd", []);
    await sleep(1200);
    await shot("t1-visee-tir");
    await page.evaluate(() => { window.__autun.ui.paused = false; });
    await ctx.close();
  }

  if (want("scope")) {
    // Lunette (D207) : fusil de précision, un passant à 50 m droit devant, bouton Viser (la lunette s'ouvre), puis un tir figé à l'image.
    const ctx = await open("arms=sniper&h=15");
    await sleep(1500);
    await page.evaluate(() => window.__autun.inventory.select("sniper"));
    await sleep(800);
    const placed = await page.evaluate(() => {
      const a = window.__autun, c = a.pedsController(), out = [], p = { x: 0, y: 0 };
      c.pick(a.player.x, a.player.y, 0, 80, Math.PI, 1, out);
      if (!out.length) return false;
      c.position(out[0], p);
      a.player.x = p.x; a.player.y = p.y - 50; a.player.heading = 0;
      a.look(0.0);
      return true;
    });
    if (!placed) console.log("pas de passant à portée");
    await touch("touchStart", [[915 - 170, 412 - 66]]);
    await touch("touchEnd", []);
    await page.waitForFunction(() => document.body.classList.contains("scoped"), null, { timeout: 120000, polling: "raf" });
    // On garde le passant dans la lunette : le regard est recalé sur lui à chaque image pendant l'attente.
    const track = () => page.evaluate(() => {
      const a = window.__autun, c = a.pedsController(), out = [], p = { x: 0, y: 0 };
      c.pick(a.player.x, a.player.y, 0, 80, 0.6, 1, out);
      if (out.length) { c.position(out[0], p); a.look(Math.atan2(p.x - a.player.x, p.y - a.player.y)); a.tilt(0.005); }
    });
    for (let k = 0; k < 4; k++) { await track(); await sleep(600); }
    await shot("t3-lunette");
    console.log("lunette :", JSON.stringify(await page.evaluate(() => { const g = window.__autun.gun; return { kind: g.aimKind, point: g.aimPoint }; })));
    await touch("touchStart", [[915 - 74, 412 - 78]]);
    await page.waitForFunction(() => { const a = window.__autun; if (a.fx.count > 0 && a.gun.recoil > 0.5) { a.ui.paused = true; return true; } return false; }, null, { timeout: 600000, polling: "raf" });
    await touch("touchEnd", []);
    await sleep(1200);
    await shot("t3-lunette-tir");
    await page.evaluate(() => { window.__autun.ui.paused = false; });
    await ctx.close();
  }

  if (want("strafe")) {
    // T4 (D208) : en visée, pas de côté vers la droite (touche D) ; puis deux gendarmes armés, derrière et à gauche, tirent : arcs des tirs reçus.
    const ctx = await open("arms=pistol&h=15&wanted=4");
    await sleep(1500);
    await page.evaluate(() => { const a = window.__autun; a.inventory.select("pistol"); a.player.x = -10; a.player.y = -40; a.player.heading = 0; a.look(0); });
    await touch("touchStart", [[915 - 170, 412 - 66]]);
    await touch("touchEnd", []);
    await page.waitForFunction(() => document.body.classList.contains("aiming"), null, { timeout: 120000, polling: "raf" });
    await page.keyboard.down("KeyD");
    await sleep(2500);
    await page.evaluate(() => { window.__autun.ui.paused = true; });
    await page.keyboard.up("KeyD");
    await sleep(800);
    await shot("t4-pas-de-cote");
    await page.evaluate(() => {
      const a = window.__autun;
      a.ui.paused = false;
      const o = a.police.officers;
      o.spawn(a.player.x - 12, a.player.y - 8, 0, 0, 11);
      o.spawn(a.player.x + 4, a.player.y - 15, 0, 0, 23);
    });
    await page.waitForFunction(() => document.querySelectorAll("#threats .threat[style*='block']").length >= 1, null, { timeout: 900000, polling: "raf" });
    await page.evaluate(() => { window.__autun.ui.paused = true; });
    await sleep(1200);
    await shot("t4-tirs-recus");
    await ctx.close();
  }

  if (want("armed")) {
    // Police armée (J5-5) : quatre étoiles, deux gendarmes à 14 m qui visent le joueur ; on fige le jeu au tir, puis on en abat un (cadavre et pistolet lâché).
    const ctx = await open("wanted=4&h=15");
    await page.addStyleTag({ content: "#wanted .wstar { animation: none !important; } #hurt { transition: none !important; }" });
    await sleep(1500);
    await page.evaluate(() => {
      const a = window.__autun;
      a.player.x = -10; a.player.y = -40; a.player.heading = 0; a.look(0);
      const o = a.police.officers;
      o.spawn(-8.5, -27.5, Math.PI, 0, 11);
      o.spawn(-12.5, -26.5, Math.PI, 0, 23);
    });
    await page.waitForFunction(() => {
      const a = window.__autun, l = a.police.officers.list;
      if (l.some((o) => o.sinceShot < 0.12 && o.aiming)) { a.ui.paused = true; return true; }
      return false;
    }, null, { timeout: 900000, polling: "raf" });
    await sleep(1500);
    await shot("j5-police-arme-tir");
    await page.evaluate(() => { window.__autun.ui.paused = false; });
    await sleep(500);
    await page.evaluate(() => {
      const a = window.__autun, o = a.police.officers.list[0];
      a.police.officers.hurt(o.slot, 500, 0, -1, 1);
    });
    await page.waitForFunction(() => window.__autun.police.officers.list.some((o) => o.mode === "dead" && o.poseT > 1.5) && window.__autun.pickups.list.some((p) => p.dropped), null, { timeout: 900000, polling: "raf" });
    await page.evaluate(() => { window.__autun.ui.paused = true; });
    await sleep(1500);
    await shot("j5-police-gendarme-tue");
    await ctx.close();
  }

  if (want("pause")) {
    // Réglages enregistrés avant le chargement (définition ×1,5, ombres moyennes : plus léger pour le rendu logiciel) : rien n'est imposé par l'URL.
    const ctx = await open("", () => localStorage.setItem("autun3d.settings", JSON.stringify({ dpr: 1.5, shadows: 2048 })), true);
    await pauseMenu();
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
    await clickText("Crédits");
    await shot("j1-pause-credits");
    await ctx.close();
  }

  if (want("map")) {
    const ctx = await open();
    await pauseMap();
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
    await click(".bm-filter");
    await click(".bm-resume");
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
    await pauseMap();
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
    await pauseMenu();
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
    await pauseMenu();
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
