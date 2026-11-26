/* Train & Fuel automated checks.
   Run before every update:  node tests/run.js
   Needs Node 18+ and Playwright (npm i -D playwright && npx playwright install chromium).
   Uses made-up data and a fake GitHub, so nothing real is read or written. */
const http = require("http"), fs = require("fs"), path = require("path");
const { chromium, devices } = require("playwright");
const ROOT = path.resolve(__dirname, "..");
const NOW = "2026-11-25T10:30:00-07:00";            // a Wednesday, after the 10 AM sleep cut-off
const results = [];
const check = (name, ok, info) => { results.push({ name, ok: !!ok, info }); };

/* ---------- made-up data ---------- */
function fixture({ withSleepToday = true, seenWorkoutsHoursAgo = 3 } = {}) {
  const files = {};
  const weights = {};
  const wk = [["2026-09-21", 190.2], ["2026-10-05", 189.1], ["2026-10-19", 188.0], ["2026-11-02", 187.4], ["2026-11-09", 186.9], ["2026-11-16", 186.1], ["2026-11-23", 185.6]];
  wk.forEach(([d, lb], i) => weights["w" + i] = { date: d, lb });
  const seenW = new Date(Date.parse(NOW) - seenWorkoutsHoursAgo * 36e5).toISOString();
  files["profile.json"] = { settings: { main: { kcal: 2400, proteinMin: 130, proteinMax: 160, fatMin: 55, fatMax: 90, waterMl: 3000, weightLo: 180, weightHi: 186, open: "07:00", close: "20:00", maxHr: 170, restHr: 56, weighDays: [1, 5],
      syncSeen: { workouts: seenW } } }, saved: {}, history: {}, weights };
  const meals = {}, workouts = {}, health = {}, water = {};
  for (const d of ["2026-11-22", "2026-11-23", "2026-11-24"]) {
    meals["b" + d] = { name: "Eggs and toast", kcal: 600, protein: 40, carbs: 50, fat: 25, date: d, time: "08:00" };
    meals["l" + d] = { name: "Chicken salad", kcal: 750, protein: 55, carbs: 40, fat: 35, date: d, time: "13:00", ingredients: "Chicken (1 portion) · Kale (1 cup)" };
    meals["d" + d] = { name: "Salmon and rice", kcal: 900, protein: 50, carbs: 90, fat: 30, date: d, time: "18:30" };
    health[d] = { sleepMin: 360, bed: "22:00", wake: "04:00" };
  }
  workouts.s1 = { type: "strength", name: "Upper body", minutes: 45, kcal: 250, date: "2026-11-23", time: "06:00", volumeKg: 9000 };
  files["log/2026-11.json"] = { meals, workouts, water, health };
  files["chat.json"] = { chat: {} };
  // Inbox: one weight, one workouts export (walks to merge, a strength session with a comma duration), one two-source sleep export
  files["inbox/weight-20261125-070000.json"] = JSON.stringify({ date: "Nov 25, 2026 at 7:00 AM", lb: "185.2" });
  files["inbox/workouts-20261125-070100.json"] =
    "W1~Traditional Strength Training~Nov 25, 2026 at 6:04 AM~2,394.248 secs.~182~~103~Strength+~Yes;" +
    "W2~Walking~Nov 24, 2026 at 7:01 AM~788 secs.~95~1,047 m~99~Watch~No;" +
    "W3~Walking~Nov 24, 2026 at 2:59 PM~865 secs.~72~1,043 m~85~Watch~No";
  if (withSleepToday) files["inbox/health-20261125-070200.json"] = JSON.stringify({ date: "Nov 25, 2026 at 7:02 AM", sleep:
    "Core~Nov 24, 2026 at 10:00 PM~Nov 25, 2026 at 12:00 AM;Deep~Nov 25, 2026 at 12:00 AM~Nov 25, 2026 at 1:00 AM;REM~Nov 25, 2026 at 1:00 AM~Nov 25, 2026 at 2:00 AM;" +
    "Awake~Nov 25, 2026 at 2:00 AM~Nov 25, 2026 at 2:10 AM;Asleep~Nov 25, 2026 at 3:00 AM~Nov 25, 2026 at 6:00 AM;Awake~Nov 25, 2026 at 4:00 AM~Nov 25, 2026 at 4:10 AM" });
  return files;
}

/* ---------- tiny static server + fake GitHub ---------- */
function serve() {
  return new Promise(res => {
    const srv = http.createServer((q, r) => {
      const u = decodeURIComponent(new URL(q.url, "http://x").pathname);
      const f = path.join(ROOT, u === "/" ? "index.html" : u);
      if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end(); }
      const ext = path.extname(f);
      r.writeHead(200, { "Content-Type": { ".html": "text/html", ".js": "text/javascript", ".wasm": "application/wasm", ".json": "application/json", ".png": "image/png" }[ext] || "application/octet-stream" });
      fs.createReadStream(f).pipe(r);
    }).listen(0, () => res(srv));
  });
}
async function open(browser, port, files, hash = "#today") {
  const ctx = await browser.newContext({ ...devices["iPhone 13"], timezoneId: "America/Vancouver" });
  await ctx.clock.install({ time: new Date(NOW) });
  await ctx.addInitScript(() => { localStorage.setItem("tf-github", JSON.stringify({ repo: "test/data", token: "test" })); });
  const p = await ctx.newPage(); const errs = []; const gh = { deleted: [], put: [] };
  p.on("pageerror", e => errs.push(e.message));
  await p.route("https://api.github.com/**", async r => {
    const u = new URL(r.request().url()); const m = u.pathname.match(/contents\/(.*)$/); const meth = r.request().method();
    const key = m ? decodeURIComponent(m[1]).replace(/\/$/, "") : "";
    if (meth === "DELETE") { gh.deleted.push(key); delete files[key]; return r.fulfill({ json: {} }); }
    if (meth === "PUT") { gh.put.push(key); return r.fulfill({ json: { content: { sha: "n" + gh.put.length } } }); }
    if (!m) return r.fulfill({ json: { private: true, permissions: { push: true } } });
    if (key === "inbox") return r.fulfill({ json: Object.keys(files).filter(k => k.startsWith("inbox/")).map(k => ({ type: "file", name: k.slice(6), sha: "s", path: k })) });
    const f = files[key]; if (f == null) return r.fulfill({ status: 404, json: {} });
    const text = typeof f === "string" ? f : JSON.stringify(f);
    return r.fulfill({ json: { sha: "s", content: Buffer.from(text).toString("base64") } });
  });
  await p.route(/openfoodfacts|elevenlabs/, r => r.fulfill({ json: {} }));
  await p.goto(`http://localhost:${port}/index.html${hash}`);
  await p.waitForFunction(() => typeof lastLoad !== "undefined" && lastLoad > 0, null, { timeout: 15000 });
  await p.waitForTimeout(1500);
  return { p, ctx, errs, gh };
}

(async () => {
  const srv = await serve(); const port = srv.address().port;
  const browser = await chromium.launch();
  try {
    /* ===== Scenario A: normal morning, everything synced ===== */
    const files = fixture();
    const { p, ctx, errs, gh } = await open(browser, port, files);

    // Every tab renders
    for (const v of ["today", "food", "train", "trends", "coach"]) {
      await p.evaluate(v => { location.hash = "#" + v; }, v); await p.waitForTimeout(400);
      check(`Tab "${v}" renders`, await p.evaluate(() => document.querySelector("#main").innerText.length > 50));
    }
    await p.evaluate(() => { location.hash = "#today"; }); await p.waitForTimeout(300);

    // Inbox processing
    check("Inbox files processed and deleted", gh.deleted.length >= 3, gh.deleted);
    check("Weight from Siri file saved", await p.evaluate(() => weights().some(w => w.date === "2026-11-25" && Math.abs(w.lb - 185.2) < .01)));
    const ws = await p.evaluate(() => allWorkouts().filter(w => w.source === "Apple Watch sync").map(w => ({ n: w.name, m: w.minutes, d: w.date, walk: !!w.walkDay, note: w.note })));
    const walks = ws.filter(w => w.walk);
    check("Walks merged into one 'Walks with Drake' entry", walks.length === 1 && /2 walks/.test(walks[0].note || ""), walks);
    const str = ws.find(w => /strength/i.test(w.n));
    check("Strength duration with thousands comma parsed (≈39.9 min)", str && Math.abs(str.m - 39.9) < .2, str);
    const sl = await p.evaluate(() => healthOn("2026-11-25"));
    check("Sleep: Watch stages + other-source 'Asleep' combined (410 min)", sl && sl.sleepMin === 410, sl && sl.sleepMin);
    check("Sleep: stages kept from the Watch", sl && sl.stages && sl.stages.deep === 60 && sl.stages.rem === 60);

    // Sync health
    const seen = await p.evaluate(() => S().syncSeen || {});
    check("Sync health records sleep, workouts and weight arrivals", seen.sleep && seen.workouts && seen.weight, seen);
    check("No sync warning when everything arrived", !(await p.$(".syncnote")));
    await p.click("#settingsBtn", { timeout: 2000 }).catch(() => {}); await p.waitForTimeout(300);
    const rows = await p.$$eval(".sh-row", r => r.map(x => x.innerText.replace(/\s+/g, " ")));
    check("Settings shows 4 sync rows with Run buttons", rows.length === 4 && rows.every(r => /Run/.test(r)), rows);
    check("Run buttons open the right shortcut", await p.$eval('.sh-row a[href*="Log%20Sleep"]', a => a.href.startsWith("shortcuts://run-shortcut")).catch(() => false));
    await p.evaluate(() => closeSheet());

    // Food log rows stay compact
    await p.evaluate(() => { date = "2026-11-24"; location.hash = "#food"; render(); }); await p.waitForTimeout(400);
    check("Food log rows don't list ingredients", !(await p.evaluate(() => document.querySelector("#main").innerText.includes("Kale (1 cup)"))));
    await p.evaluate(() => { date = todayStr(); render(); });

    // Meal builder
    await p.evaluate(() => mealBuilder({ name: "Test salad" })); await p.waitForTimeout(200);
    for (const w of ["kale", "olive oil"]) { await p.fill("#bQ", w); await p.waitForTimeout(150); await (await p.$('.bres[data-k="loc"]')).click(); await p.waitForTimeout(250); }
    check("Builder: newest ingredient opens with big amount controls", await p.$$eval(".bitem.open .bi-stp", x => x.length === 2).catch(() => false));
    check("Builder: older ingredients collapse to one line", await p.$$eval(".bitem.mini", x => x.length === 1).catch(() => false));
    check("Builder: 'type it in yourself' still available after adding", await p.isVisible("#bCustom") || await p.evaluate(() => !!document.querySelector("#bCustom") && getComputedStyle(document.querySelector("#bCustom")).display !== "none"));
    await p.click('[data-st="1"][data-d="1"]', { timeout: 2000 }).catch(() => {}); await p.waitForTimeout(100);
    const tot = await p.evaluate(() => Math.round(bldTotal().k));
    await p.click("[data-done]", { timeout: 2000 }).catch(() => {}); await p.waitForTimeout(100);
    check("Builder: Done collapses the open ingredient", await p.$$eval(".bitem.open", x => x.length === 0).catch(() => false));
    await p.click("#bLog", { timeout: 2000 }).catch(() => {}); await p.waitForTimeout(400);
    const logged = await p.evaluate(() => Object.values(col.meals).find(m => m.name === "Test salad"));
    check("Builder: meal logged with both parts and the right total", logged && logged.parts?.length === 2 && logged.kcal === tot, logged && [logged.kcal, tot]);

    // Coach tab
    check("Coach: time chips detect 'when did you eat' questions", await p.evaluate(() => askedWhen("What time did you eat that?") && !askedWhen("Nice work today.")));
    await p.evaluate(() => { location.hash = "#coach"; }); await p.waitForTimeout(500);
    check("Coach: 'Photos, screenshots' hint is plain text, not a floating bubble", await p.$eval(".composer .chint", e => getComputedStyle(e).position !== "fixed").catch(() => false));
    await p.focus("#chatIn").catch(() => {}); await p.waitForTimeout(500);
    check("Coach: message box pins above the keyboard", await p.$eval("#composer", e => e.classList.contains("pin") && getComputedStyle(e).position === "fixed").catch(() => false));
    await p.evaluate(() => document.activeElement.blur()); await p.waitForTimeout(200);

    // Trends
    await p.evaluate(() => { location.hash = "#trends"; }); await p.waitForTimeout(500);
    const tr = await p.evaluate(() => {
      const top = [...document.querySelectorAll("#main > .view > section.card")].map(s => (s.querySelector(".eyebrow")?.innerText || "").trim());
      return { top, more: document.querySelectorAll("details.more").length, open: document.querySelectorAll("details.more[open]").length,
        flags: document.querySelectorAll(".flags > .flag").length, seg: !!document.querySelector('[data-act="wRange"]'), txt: document.querySelector("#main").innerText };
    });
    check("Trends: short top section (≤5 cards)", tr.top.length <= 5, tr.top);
    check("Trends: extra charts folded under 'More', closed by default", tr.more >= 4 && tr.open === 0, [tr.more, tr.open]);
    check("Trends: at most 3 flags shown", tr.flags <= 3, tr.flags);
    check("Trends: no confusing 'last week has only' flag", !/Last week has only/.test(tr.txt));
    check("Weight card: fixed 6 weeks, no range buttons", !tr.seg);
    check("Weight card: shows the starting weigh-in", /Started at 190\.2 lb on Sep 21/.test(tr.txt));
    await p.click('details.more[data-more="cal"] > summary', { timeout: 2000 }).catch(() => {}); await p.waitForTimeout(200);
    await p.evaluate(() => render()); await p.waitForTimeout(200);
    check("Trends: an opened 'More' section stays open after refresh", await p.$('details.more[data-more="cal"][open]') != null);

    // Title link
    await p.evaluate(() => scrollTo(0, 600)); await p.click("#brandHome", { timeout: 2000 }).catch(() => {}); await p.waitForTimeout(700);
    check("Tapping the title goes to Today, top of page", await p.evaluate(() => location.hash === "#today" && date === todayStr() && scrollY < 5));

    // Pure functions
    check("Liquids detected for ml (750 ml bottle)", await p.evaluate(() => liquidInfo({ quantity: "750 ml", product_name: "Olive oil" }).liq));
    const lab = await p.evaluate(() => parseLabel("Nutrition Facts\nServing size 2 tbsp (30 g)\nCalories 140\nTotal Fat 14g\nTotal Carbohydrate 1g\nProtein 0g"));
    check("Label photo text parsed (140 kcal, 14 g fat)", lab && JSON.stringify(lab).includes("140") && JSON.stringify(lab).includes("14"), lab);
    check("Big training day raises calories", await p.evaluate(() => { const f = dayFuel("2026-11-25"); return f.kcal >= S().kcal; }));

    check("No script errors (scenario A)", errs.length === 0, errs);
    await ctx.close();

    /* ===== Scenario B: sleep never arrived, Watch silent for 2 days ===== */
    const fb = fixture({ withSleepToday: false, seenWorkoutsHoursAgo: 50 });
    delete fb["inbox/workouts-20261125-070100.json"];
    const B = await open(browser, port, fb);
    const note = await B.p.$eval(".syncnote", e => e.innerText).catch(() => "");
    check("Sync warning appears on Today when sleep and workouts are overdue", /Sleep/.test(note) && /Workouts/.test(note), note);
    check("Sync warning offers Run buttons", await B.p.$$eval(".syncnote a[href^='shortcuts://']", a => a.length === 2).catch(() => false));
    check("No script errors (scenario B)", B.errs.length === 0, B.errs);
    await B.ctx.close();
  } catch (e) {
    check("Test run finished without crashing", false, e.message);
  } finally {
    await browser.close(); srv.close();
  }
  const bad = results.filter(r => !r.ok);
  for (const r of results) console.log(`${r.ok ? "✓" : "✗"} ${r.name}${r.ok ? "" : "  → " + JSON.stringify(r.info)}`);
  console.log(`\n${results.length - bad.length}/${results.length} checks passed`);
  process.exit(bad.length ? 1 : 0);
})();
