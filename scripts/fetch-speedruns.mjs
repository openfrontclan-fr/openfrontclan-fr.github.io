// Relève les speedruns du clan : sa victoire en équipe la plus rapide sur chaque carte, par taille de carte et par format.
// Une victoire compte quand le clan fait au moins la moitié de l'équipe gagnante, avec au moins 2 joueurs [FR], en partie
// publique d'au moins 2 minutes : en dessous, comme pour les points du bot, l'adversaire a sûrement quitté la partie.
// Le chrono est la durée de la partie donnée par OpenFront, celle des messages de victoire du bot.
//
// Pour dire quand le clan détient le record de tous les clans, le relevé lit aussi les records de TeamStats
// (teamstats.pro), site partenaire : un record par carte, taille et format, depuis le début de leur saison.
//
// Le relevé reprend là où il s'était arrêté. data/speedruns.json reste hors du dépôt, dans le cache d'Actions comme les
// fiches : il garde l'identifiant OpenFront des joueurs, que seul le build traduit en pseudos publics.
import { existsSync } from "node:fs";
import { readFile, writeFile, mkdir } from "node:fs/promises";

const API = "https://api.openfront.io/public";
const TAG = "FR";
const OUT = "data/speedruns.json";
// Flux public des records de TeamStats, ouvert aux autres sites (30 requêtes par minute au plus) : on le lit une fois par relevé.
const TEAMSTATS = "https://teamstats.pro/feed/team-speedruns.json";
// Avant la création du clan : le premier relevé remonte tout son historique.
const FIRST_DAY = "2026-05-01T00:00:00.000Z";
const MIN_SECONDS = 120;
// Un relevé s'arrête au bout de ce temps et reprend à la mise à jour suivante.
const BUDGET_MS = Number(process.env.SPEEDRUN_MINUTES ?? 25) * 60_000;
// Une partie finie depuis peu n'est pas toujours archivée : on la relit plus tard.
const SETTLE_MS = 2 * 3_600_000;
const DAY_MS = 86_400_000;
const PAGE_SIZE = 50;
const WORKERS = 6;
const MAX_TRIES = 4;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// null : la partie n'existe pas (encore). Erreur après plusieurs refus du serveur.
async function get(path) {
  for (let attempt = 0; attempt < 6; attempt++) {
    let res;
    try {
      res = await fetch(`${API}${path}`, { headers: { Accept: "application/json" } });
    } catch {
      await sleep(3000);
      continue;
    }
    if (res.ok) return res.json();
    if (res.status === 404) return null;
    if (res.status === 429 || res.status >= 500) {
      await sleep(10_000 * (attempt + 1));
      continue;
    }
    throw new Error(`${path} -> HTTP ${res.status}`);
  }
  throw new Error(`${path} -> pas de réponse`);
}

const range = (start, end) => `start=${start.toISOString()}&end=${end.toISOString()}`;

async function sessionsBetween(start, end) {
  const sessions = [];
  for (let page = 1; ; page++) {
    await sleep(250);
    const { results, total } = await get(`/clan/${TAG}/sessions?${range(start, end)}&limit=${PAGE_SIZE}&page=${page}`);
    sessions.push(...results);
    if (page * PAGE_SIZE >= total || results.length === 0) return sessions;
  }
}

const store = JSON.parse(await readFile(OUT, "utf8").catch(() => "null")) ?? { cursor: FIRST_DAY, records: {}, pending: [] };
// Restes de l'ancienne comparaison avec toutes les équipes, remplacée par les records de TeamStats.
for (const old of ["allSince", "allCap", "allCursor", "others", "pendingOthers"]) delete store[old];

// La victoire d'une partie publique par équipes d'au moins MIN_SECONDS : undefined si la partie ne compte pas, null si
// elle n'est pas encore archivée. fr dit si le clan fait au moins la moitié de l'équipe gagnante, avec 2 joueurs ou plus.
async function readWin(gameId) {
  await sleep(250);
  const game = (await get(`/game/${encodeURIComponent(gameId)}?turns=false`))?.info;
  if (!game) return null;
  const c = game.config ?? {};
  const [kind, , ...ids] = game.winner ?? [];
  const t = Math.round(game.duration ?? (game.end - game.start) / 1000);
  if (c.gameType !== "Public" || c.gameMode !== "Team" || kind !== "team" || !(t >= MIN_SECONDS)) return undefined;
  const winners = new Set(ids);
  const clan = (game.players ?? []).filter((p) => p.clanTag?.toUpperCase() === TAG && winners.has(p.clientID));
  return {
    game,
    t,
    winners,
    clan,
    fr: clan.length >= 2 && clan.length * 2 >= winners.size,
    key: [c.gameMap, c.gameMapSize ?? "Normal", c.playerTeams].join("|"),
    at: new Date(game.start).toISOString(),
  };
}

const publicIds = (clan) => clan.map((p) => p.publicID).filter((id) => typeof id === "string");

// Garde la victoire [FR] si elle bat le chrono de sa catégorie. Renvoie false si la partie n'est pas encore archivée.
async function consider(gameId) {
  const win = await readWin(gameId);
  if (win === null) return false;
  if (!win?.fr) return true;
  const { game, t, winners, clan, key, at } = win;
  const best = store.records[key];
  if (best && (best.g === gameId || best.t <= t)) return true;
  store.records[key] = {
    g: gameId,
    t,
    at,
    fr: clan.length,
    team: winners.size,
    n: game.players.length,
    ids: publicIds(clan),
    // Le chrono battu, pour afficher l'écart.
    prev: best ? best.t : null,
  };
  return true;
}

// Lit les parties par lots de WORKERS ; rend celles qui ne sont pas encore archivées.
async function considerAll(gameIds) {
  const queue = [...gameIds];
  const missing = [];
  await Promise.all(Array.from({ length: WORKERS }, async () => {
    while (queue.length) {
      const id = queue.shift();
      if (!(await consider(id))) missing.push(id);
    }
  }));
  return missing;
}

const save = async () => {
  await mkdir("data", { recursive: true });
  await writeFile(OUT, JSON.stringify(store));
};

const started = Date.now();
// Les parties pas encore archivées au dernier relevé : relues, puis abandonnées après MAX_TRIES essais.
const stillMissing = new Set(await considerAll((store.pending ?? []).map((p) => p.g)));
store.pending = (store.pending ?? []).filter((p) => stillMissing.has(p.g) && p.tries + 1 < MAX_TRIES).map((p) => ({ g: p.g, tries: p.tries + 1 }));

const limit = Date.now() - SETTLE_MS;
let days = 0;
while (Date.now() - started < BUDGET_MS) {
  const start = new Date(store.cursor);
  if (start.getTime() >= limit - 60_000) break;
  const end = new Date(Math.min(start.getTime() + DAY_MS, limit));
  // Seules les victoires avec au moins 2 joueurs [FR] peuvent compter, et assez nombreux pour faire la moitié d'une
  // équipe moyenne de la partie : la marge de moitié laisse passer les équipes plus petites que la moyenne.
  const likely = (s) => s.hasWon && s.clanPlayerCount >= 2 && !(s.clanPlayerCount * 4 < s.totalPlayerCount / Math.max(1, s.numTeams));
  const wins = (await sessionsBetween(start, end)).filter(likely).map((s) => s.gameId);
  const missing = await considerAll([...new Set(wins)]);
  store.pending.push(...missing.map((g) => ({ g, tries: 0 })));
  store.cursor = end.toISOString();
  days += 1;
  await save();
  if (days % 10 === 0) console.log(`relevé jusqu'au ${store.cursor.slice(0, 10)}`);
}

// Les records de TeamStats. Leur chrono va de la fin du placement à la victoire, une vingtaine de secondes de moins que la
// durée de la partie. Chaque partie record est ouverte une fois, et gardée tant qu'elle reste un record : on y lit son format
// exact (2 équipes, 3 équipes…, que TeamStats regroupe en « team ») et sa durée selon OpenFront, comparable à nos chronos.
// - records : ceux de [FR], avec les joueurs (ceux de notre record quand c'est la même partie) ;
// - others : par catégorie, le record d'un autre clan, à battre.
// En cas de panne, les anciens records restent.
let openedNow = 0;
try {
  const res = await fetch(TEAMSTATS, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const feed = await res.json();
  if (!Array.isArray(feed.records)) throw new Error("pas de liste de records");
  const list = feed.records.filter((r) => typeof r?.clan === "string" && /^[A-Za-z0-9]{4,16}$/.test(r.gameId));
  const isFr = (r) => r.clan.toUpperCase() === TAG;
  const ours = new Map(Object.entries(store.records).map(([key, r]) => [r.g, { key, t: r.t, fr: r.fr, n: r.n, ids: r.ids }]));
  const opened = store.teamstats?.games ?? {};
  const frGames = new Set(list.filter(isFr).map((r) => r.gameId));
  const queue = [...new Set(list.map((r) => r.gameId))].filter((g) => !ours.has(g) && !(opened[g]?.t > 0));
  await Promise.all(Array.from({ length: WORKERS }, async () => {
    while (queue.length) {
      const g = queue.shift();
      const win = await readWin(g);
      if (!win) continue;
      openedNow += 1;
      opened[g] = { key: win.key, t: win.t };
      // Les identifiants des joueurs ne sont gardés que pour les records [FR].
      if (frGames.has(g)) Object.assign(opened[g], { fr: win.clan.length, n: win.game.players.length, ids: publicIds(win.clan) });
    }
  }));
  const games = {};
  const records = [];
  const others = {};
  for (const r of list) {
    const who = ours.get(r.gameId) ?? opened[r.gameId];
    if (!who) continue;
    if (!ours.has(r.gameId)) games[r.gameId] = who;
    if (isFr(r)) records.push({ g: r.gameId, map: r.map, size: r.size, format: r.format, t: r.time, at: r.date, key: who.key, fr: who.fr, n: who.n, ids: who.ids });
    else if (!(others[who.key]?.t <= who.t)) others[who.key] = { g: r.gameId, t: who.t, clan: r.clan, at: r.date };
  }
  store.teamstats = {
    at: feed.updatedAt,
    season: feed.season,
    since: feed.since,
    total: feed.records.length,
    page: feed.source,
    records,
    others,
    games,
  };
} catch (error) {
  console.error("Records TeamStats non lus :", error.message);
}

// « Giant World Map » → giantworldmap : la clé de la carte dans les traductions et son dossier dans les ressources d'OpenFront.
const folder = (name) => name.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().replace(/[^a-z0-9]/g, "");
const RESOURCES = "https://raw.githubusercontent.com/openfrontio/OpenFrontIO/main/resources";
const maps = new Set([...Object.keys(store.records), ...(store.teamstats?.records ?? []).map((r) => r.key)].map((k) => k.split("|")[0]));

// Les noms des cartes en français, tels que les traduit OpenFront. En cas de panne, les anciens restent.
try {
  const res = await fetch(`${RESOURCES}/lang/fr.json`, { signal: AbortSignal.timeout(15_000) });
  if (res.ok) {
    const fr = (await res.json()).map ?? {};
    store.mapNames = Object.fromEntries([...maps].map((m) => [m, typeof fr[folder(m)] === "string" ? fr[folder(m)] : m]));
  }
} catch (error) {
  console.error("Noms des cartes non lus :", error.message);
}

// Les vignettes des cartes (OpenFront, CC BY-SA 4.0), une dizaine de Ko chacune, gardées dans le cache d'Actions avec le
// relevé : on ne télécharge que les nouvelles, et on rafraîchit chacune tous les 30 jours. Une vignette manquante n'empêche rien.
const THUMBS = "data/maps";
await mkdir(THUMBS, { recursive: true });
store.thumbs ??= {};
let fetched = 0;
for (const m of [...maps].map(folder)) {
  if (existsSync(`${THUMBS}/${m}.webp`) && Date.now() - Date.parse(store.thumbs[m] ?? 0) < 30 * DAY_MS) continue;
  try {
    const res = await fetch(`${RESOURCES}/maps/${m}/thumbnail.webp`, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) continue;
    await writeFile(`${THUMBS}/${m}.webp`, Buffer.from(await res.arrayBuffer()));
    store.thumbs[m] = new Date().toISOString();
    fetched += 1;
  } catch (error) {
    console.error(`Vignette ${m} non lue :`, error.message);
  }
}
await save();
console.log(`speedruns : ${Object.keys(store.records).length} records, relevé jusqu'au ${store.cursor}, ${store.pending.length} parties en attente`);
console.log(`TeamStats : ${store.teamstats?.records.length ?? 0} records [FR] sur ${store.teamstats?.total ?? 0}, ${Object.keys(store.teamstats?.others ?? {}).length} records à battre, ${openedNow} parties ouvertes`);
console.log(`vignettes : ${fetched} téléchargées, ${Object.keys(store.thumbs).length} en cache`);
