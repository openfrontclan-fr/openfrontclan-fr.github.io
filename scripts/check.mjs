// Capture chaque page de public/index.html et teste ses interactions dans Edge sans fenêtre.
// Les captures sont écrites dans le dossier temporaire, sous fr-shot.
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const EDGE = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const PORT = 9334;
const OUT = join(tmpdir(), "fr-shot");
const PAGES = ["accueil", "classement", "membres", "jouer"];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const edge = spawn(EDGE, [
  "--headless=new", "--no-first-run", "--hide-scrollbars",
  "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist",
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${join(tmpdir(), `fr-cdp-${process.pid}`)}`,
  "about:blank",
], { stdio: "ignore" });

async function json(path, method = "GET") {
  for (let i = 0; i < 40; i++) {
    try {
      return await (await fetch(`http://127.0.0.1:${PORT}${path}`, { method })).json();
    } catch {
      await sleep(250);
    }
  }
  throw new Error("Edge ne répond pas");
}

const target = await json("/json/new?about:blank", "PUT");
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => { ws.onopen = r; });
let id = 0;
const waiting = new Map();
const errors = [];
ws.onmessage = (m) => {
  const msg = JSON.parse(m.data);
  if (msg.id && waiting.has(msg.id)) { waiting.get(msg.id)(msg.result ?? msg.error); waiting.delete(msg.id); }
  if (msg.method === "Runtime.exceptionThrown") errors.push(msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text);
  if (msg.method === "Log.entryAdded" && msg.params.entry.level === "error") errors.push(`${msg.params.entry.text} ${msg.params.entry.url ?? ""}`);
};
const send = (method, params = {}) => new Promise((r) => {
  id += 1;
  waiting.set(id, r);
  ws.send(JSON.stringify({ id, method, params }));
});
const js = async (expression) => (await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true })).result?.value;
const shot = async (name) => {
  const r = await send("Page.captureScreenshot", { format: "jpeg", quality: 85 });
  await writeFile(join(OUT, `${name}.jpg`), Buffer.from(r.data, "base64"));
};
const open = async (width, height, mobile, hash = "") => {
  await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile });
  await send("Emulation.setTouchEmulationEnabled", { enabled: mobile });
  await send("Page.navigate", { url: "about:blank" });
  await sleep(150);
  await send("Page.navigate", { url: pathToFileURL(resolve("public/index.html")).href + hash });
  await sleep(1200);
  await js("document.fonts.ready.then(() => 1)");
  await sleep(500);
};
const visible = () => js(`[...document.querySelectorAll(".view")].filter((v) => !v.hidden).map((v) => v.id).join()`);
const click = (sel) => js(`document.querySelector(${JSON.stringify(sel)}).click(); 1`);
const scrollTo = async (sel, offset = 0, wait = 1200) => {
  await js(`document.documentElement.style.scrollBehavior = "auto"; document.querySelector(${JSON.stringify(sel)}).scrollIntoView(); scrollBy(0, ${offset}); 1`);
  await sleep(wait);
};

await mkdir(OUT, { recursive: true });
await send("Page.enable");
await send("Runtime.enable");
await send("Log.enable");
await send("Page.bringToFront");
await send("Emulation.setFocusEmulationEnabled", { enabled: true });
await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "no-preference" }] });

const report = {};

/* Ordinateur */
await open(1440, 900, false);
report.startPage = await visible();
await shot("d-accueil");
await scrollTo(".tally", -160, 500);
await shot("d-accueil-bas");
await scrollTo("#rejoindre", -60, 500);
await shot("d-call");

await click('.hub-item[href="#classement"]');
await sleep(800);
report.hubClick = await visible();
report.scrollAfterClick = await js("scrollY");
report.current = await js(`document.querySelector('.links a[aria-current="true"]')?.innerText`);
report.hash = await js("location.hash");
await shot("d-classement");
await scrollTo("#activite", -90);
await shot("d-activite");
report.seriesWins = await js(`(() => { document.getElementById("series-wins").click(); return document.getElementById("readout-value").textContent; })()`);
await sleep(1300);
const box = await js(`(() => { const r = document.querySelector("#plot svg").getBoundingClientRect(); return [r.left + r.width * .4, r.top + r.height * .5]; })()`);
await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: box[0], y: box[1] });
await sleep(200);
report.hoverLabel = await js(`document.getElementById("readout-label").innerText`);
await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 5, y: 5 });
report.more = await js(`(() => { const b = document.getElementById("more"); b.click(); const n = document.querySelectorAll("#clans tr").length; b.click(); return [n, document.querySelectorAll("#clans tr").length]; })()`);

await click('.links a[href="#membres"]');
await sleep(800);
report.navClick = await visible();
await shot("d-membres");
await scrollTo(".roster", -90, 500);
await shot("d-roster");
report.search = await js(`(() => { const i = document.getElementById("roster-search"); i.value = "hulk"; i.dispatchEvent(new Event("input")); const n = document.querySelectorAll("#roster tr").length; const t = document.querySelector("#roster tr")?.innerText.split("\\t")[0]; i.value = ""; i.dispatchEvent(new Event("input")); return [n, t]; })()`);
report.modeRanked = await js(`(() => { document.getElementById("mode-ranked").click(); const r = [document.getElementById("podium-label").textContent, document.querySelector("#podium .card.first .who").textContent, document.querySelectorAll("#roster tr").length]; return r; })()`);
await sleep(300);
await shot("d-membres-classe");
await js(`document.getElementById("mode-total").click(); 1`);
report.hiddenExcludedFromSearch = await js(`(() => { const hidden = MEMBERS.find((m) => m.name && m.hidden); if (!hidden) return "aucun"; const i = document.getElementById("roster-search"); i.value = hidden.name; i.dispatchEvent(new Event("input")); const shown = [...document.querySelectorAll("#roster a")].some((x) => x.textContent === hidden.name); i.value = ""; i.dispatchEvent(new Event("input")); return !shown; })()`);
report.sortNew = await js(`(() => { document.getElementById("roster-new").click(); const d = document.querySelector("#roster tr td:last-child").innerText; document.getElementById("roster-wins").click(); return d; })()`);

await click("#podium .card.first");
await sleep(700);
report.playerFromPodium = [await visible(), await js("document.querySelector('#player h1').textContent"), await js("location.hash.startsWith('#joueur-')"), await js(`document.querySelector('.links a[aria-current="true"]')?.innerText`)];
await shot("d-joueur");
const visiblePublic = await js(`(() => { const m = rankingOf("total").find((x) => R.profiles[x.slug]); return m ? m.slug : null; })()`);
report.playerWithCareer = null;
if (visiblePublic) {
  await js(`document.querySelector('.back').click(); 1`);
  await sleep(300);
  await js(`location.hash = "joueur-${visiblePublic}"; 1`);
  await sleep(700);
  report.playerWithCareer = [await js("document.querySelector('#player h1').textContent"), await js("document.querySelectorAll('#player .facts li').length"), await js("document.querySelectorAll('#player .mode-row').length")];
  await shot("d-joueur-carriere");
}
await click('.links a[href="#accueil"]');
await sleep(500);
report.accueilLink = await visible();
await click('.links a[href="#jouer"]');
await sleep(800);
await shot("d-jouer");
await scrollTo("#outils", -90, 500);
await shot("d-outils");

await js("history.back(); 1");
await sleep(600);
report.backButton = await visible();
await click(".brand");
await sleep(500);
report.brandClick = await visible();
report.overflowDesktop = await js("document.documentElement.scrollWidth - innerWidth");

/* Liens directs */
report.directLinks = {};
for (const p of PAGES) {
  await open(1440, 900, false, `#${p}`);
  report.directLinks[p] = await visible();
}
await open(1440, 900, false, "#rejoindre");
report.directRejoindre = [await visible(), (await js("scrollY")) > 300];
await click(".cta");
report.cta = await visible();

/* Téléphone */
await open(390, 844, true);
await shot("m-accueil");
await scrollTo(".hub", -90, 500);
await shot("m-hub");
report.mobile = {};
for (const p of PAGES) {
  await open(390, 844, true, `#${p}`);
  if (p !== "accueil") await shot(`m-${p}`);
  report.mobile[p] = {
    overflow: await js("document.documentElement.scrollWidth - innerWidth"),
    clipped: await js(`[...document.querySelectorAll("main *, footer *")].filter((e) => e.getClientRects().length && e.getBoundingClientRect().right > innerWidth + 1 && !e.closest(".heat-wrap") && !e.closest("svg")).map((e) => e.tagName + "." + e.className).slice(0, 6)`),
  };
}
await open(390, 844, true, "#membres");
await scrollTo(".roster", -90, 500);
await shot("m-roster");
await js(`document.querySelector("#podium .card.first").click(); 1`);
await sleep(600);
await shot("m-joueur");
report.mobilePlayer = { overflow: await js("document.documentElement.scrollWidth - innerWidth"), clipped: await js(`[...document.querySelectorAll("main *, footer *")].filter((e) => e.getClientRects().length && e.getBoundingClientRect().right > innerWidth + 1 && !e.closest("svg")).map((e) => e.tagName + "." + e.className).slice(0, 6)`) };
report.ctaVisible = await js(`(() => { const r = document.querySelector(".cta").getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth; })()`);
report.menu = await js(`(() => { const m = document.getElementById("menu"); m.click(); const o = getComputedStyle(document.getElementById("nav-links")).display; document.querySelector('.links a[href="#jouer"]').click(); return [o, getComputedStyle(document.getElementById("nav-links")).display, [...document.querySelectorAll(".view")].filter((v) => !v.hidden)[0].id]; })()`);

report.errors = errors;
console.log(JSON.stringify(report, null, 1));
console.log(OUT);
ws.close();
const version = await json("/json/version");
const browser = new WebSocket(version.webSocketDebuggerUrl);
await new Promise((r) => { browser.onopen = r; });
browser.send(JSON.stringify({ id: 1, method: "Browser.close" }));
await sleep(800);
browser.close();
