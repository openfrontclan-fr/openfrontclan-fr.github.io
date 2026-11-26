// Relève toutes les parties publiques par équipes d'OpenFront, jour par jour, pour la cote des joueurs (scripts/cote.mjs).
// Chaque partie n'est téléchargée qu'une fois, et réduite à ce dont la cote peut avoir besoin : l'équipe gagnante, les
// perdants, leurs clans, le moment où chacun est mort, le format, le nombre d'équipes et la durée. La cote se recalcule
// ensuite depuis ces résumés en quelques secondes : changer sa formule ne demande pas de tout retélécharger.
//
// L'API ne dit pas dans quelle équipe était chaque perdant (le serveur les répartit en tenant compte des amis de chacun,
// qui ne sont pas publics). On garde donc les gagnants à part, et les perdants ensemble.
//
// Un fichier par jour (UTC), data/parties/AAAA-MM-JJ.json.gz, écrit une fois le jour fini. Les jours manquants se relèvent
// du plus récent au plus ancien : le jour qui vient de finir passe d'abord, puis le relevé remonte le passé avec le temps
// qui reste. scripts/cote.mjs n'utilise un mois que quand tous ses jours sont là. Les fichiers gardent les
// identifiants OpenFront de tous les joueurs : ils restent dans le cache d'Actions, pas dans le dépôt.
import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import { gzipSync } from "node:zlib";

const API = "https://api.openfront.io/public";
const DIR = "data/parties";
// Début du relevé : le 1er octobre 2026 (le relevé a commencé au 1er novembre, puis a été remonté d'un mois).
const FROM = process.env.COTE_FROM ?? "2026-10-01";
const BUDGET_MS = Number(process.env.COTE_MINUTES ?? 25) * 60_000;
// Une partie finie depuis peu n'est pas toujours archivée : un jour n'est relevé que 3 heures après sa fin.
const SETTLE_MS = 3 * 3_600_000;
const DAY_MS = 86_400_000;
const WORKERS = 6;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// null : la partie n'existe pas. Erreur après plusieurs refus du serveur.
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

async function gamesOfDay(start) {
  const end = new Date(start.getTime() + DAY_MS);
  const games = [];
  for (let offset = 0; ; offset += 1000) {
    await sleep(250);
    const page = (await get(`/games?start=${start.toISOString()}&end=${end.toISOString()}&type=Public&mode=Team&limit=1000&offset=${offset}`)) ?? [];
    games.push(...page);
    if (page.length < 1000) return games;
  }
}

// Le résumé d'une partie : [début (ms), durée (s), équipes, format, spéciale (1/0), tours, gagnants, perdants], chaque joueur
// étant [identifiant, clan ou "", tour de sa mort ou -1, actif (1/0)]. Actif : il a attaqué, construit, envoyé un bateau ou
// lancé une bombe ; un joueur parti sans rien faire ne doit pas peser sur la cote. undefined si la partie ne compte pas,
// null si elle est introuvable.
async function summary(id) {
  await sleep(250);
  const g = (await get(`/game/${encodeURIComponent(id)}?turns=false`))?.info;
  if (!g) return null;
  const c = g.config ?? {};
  const [kind, , ...winnerIds] = g.winner ?? [];
  if (c.gameType !== "Public" || c.gameMode !== "Team" || c.playerTeams === "Humans Vs Nations" || kind !== "team") return undefined;
  const players = (g.players ?? []).filter((p) => typeof p.publicID === "string");
  const size = { Duos: 2, Trios: 3, Quads: 4 }[c.playerTeams];
  const teams = size ? Math.max(2, Math.ceil((g.players ?? []).length / size)) : Number(c.playerTeams);
  if (!(teams >= 2) || players.length < 2) return undefined;
  const winners = new Set(winnerIds);
  const first = (list) => Object.values(list ?? {}).some((v) => Number(v?.[0]) > 0);
  const short = (p) => {
    const s = p.stats ?? {};
    const dead = Number(s.killedAt);
    const active = Number(s.attacks?.[0]) > 0 || first(s.units) || first(s.boats) || first(s.bombs);
    return [p.publicID, typeof p.clanTag === "string" ? p.clanTag.toUpperCase() : "", Number.isFinite(dead) ? dead : -1, active ? 1 : 0];
  };
  return [
    g.start,
    Math.round(g.duration ?? (g.end - g.start) / 1000),
    teams,
    String(c.playerTeams),
    g.publicGameType === "special" ? 1 : 0,
    g.num_turns ?? 0,
    players.filter((p) => winners.has(p.clientID)).map(short),
    players.filter((p) => !winners.has(p.clientID)).map(short),
  ];
}

await mkdir(DIR, { recursive: true });
const done = new Set((await readdir(DIR)).filter((f) => f.endsWith(".json.gz")).map((f) => f.slice(0, 10)));
const started = Date.now();
let days = 0;
let opened = 0;
const todo = [];
for (let day = new Date(`${FROM}T00:00:00.000Z`); day.getTime() + DAY_MS < Date.now() - SETTLE_MS; day = new Date(day.getTime() + DAY_MS)) {
  if (!done.has(day.toISOString().slice(0, 10))) todo.push(day);
}
for (const day of todo.reverse()) {
  const key = day.toISOString().slice(0, 10);
  if (Date.now() - started > BUDGET_MS) break;
  const ids = [...new Set((await gamesOfDay(day)).filter((g) => g.playerTeams !== "Humans Vs Nations").map((g) => g.game))];
  const games = [];
  let missing = 0;
  const queue = [...ids];
  await Promise.all(Array.from({ length: WORKERS }, async () => {
    while (queue.length) {
      const s = await summary(queue.shift());
      if (s === null) missing += 1;
      else if (s) games.push(s);
    }
  }));
  games.sort((a, b) => a[0] - b[0]);
  await writeFile(`${DIR}/${key}.json.gz`, gzipSync(JSON.stringify({ day: key, listed: ids.length, missing, games })));
  opened += ids.length;
  days += 1;
  console.log(`${key} : ${games.length} parties gardées sur ${ids.length}${missing ? `, ${missing} introuvables` : ""}`);
}
const all = (await readdir(DIR)).filter((f) => f.endsWith(".json.gz")).length;
console.log(`parties par équipes : ${days} jours relevés (${opened} parties ouvertes), ${all} jours en cache`);
