// Relève l'ELO des membres sur TeamStats (teamstats.pro), site partenaire : la Team ELO et le style de jeu, la note du
// FFA classé d'OpenFront, et leur historique pour les courbes des fiches.
//
// Les deux listes du clan sont lues à chaque mise à jour. La fiche d'un joueur, qui porte son historique, n'est relue que
// s'il a joué depuis la précédente : son nombre de parties ou sa note a changé. Le flux accepte 120 requêtes par minute ;
// on en fait au plus 100, et on s'arrête au bout de ELO_MINUTES pour reprendre à la mise à jour suivante.
//
// data/elo.json reste hors du dépôt, dans le cache d'Actions comme les fiches : il garde les identifiants OpenFront.
// Seuls les membres actuels du clan y entrent ; le build ne publie que ceux qui ont une fiche publique.
import { readFile, writeFile, mkdir } from "node:fs/promises";

const FEED = "https://teamstats.pro/feed";
const TAG = "FR";
const OUT = "data/elo.json";
const PAUSE_MS = 600;
const BUDGET_MS = Number(process.env.ELO_MINUTES ?? 10) * 60_000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// null : pas de fiche pour ce joueur. Erreur après plusieurs refus du serveur.
async function get(path) {
  for (let attempt = 0; attempt < 4; attempt++) {
    let res;
    try {
      res = await fetch(`${FEED}${path}`, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(20_000) });
    } catch {
      await sleep(3000);
      continue;
    }
    if (res.ok) return res.json();
    if (res.status === 404) return null;
    if (res.status === 429 || res.status >= 500) {
      await sleep(15_000 * (attempt + 1));
      continue;
    }
    throw new Error(`${path} -> HTTP ${res.status}`);
  }
  throw new Error(`${path} -> pas de réponse`);
}

const { members } = JSON.parse(await readFile("data/members.json", "utf8"));
const inClan = new Set(members.map((m) => m.publicId));
const store = JSON.parse(await readFile(OUT, "utf8").catch(() => "null")) ?? { players: {} };

const team = await get(`/team-elo.json?clan=${TAG}`);
await sleep(PAUSE_MS);
const ffa = await get(`/ffa-elo.json?clan=${TAG}`);
if (!Array.isArray(team?.players) || !Array.isArray(ffa?.players)) throw new Error("listes ELO illisibles");

// Le style de jeu : les six parties de la Team ELO, chacune avec son palier et le pourcentage des meilleurs.
const STYLES = ["attack", "territory", "support", "economy", "destruction", "building"];
const styleOf = (p) => (p?.playstyle ? STYLES.map((k) => [p.playstyle[k]?.grade ?? null, p.playstyle[k]?.topPercent ?? null]) : null);
const teamOf = (p) => ({
  rated: Boolean(p.rated),
  elo: p.elo,
  rank: p.rank,
  tier: p.tier,
  games: p.games,
  best: p.bestPlaystyle,
  style: styleOf(p),
});
const ffaOf = (p) => ({ rating: p.rating, peak: p.peak, tier: p.tier, rank: p.overallRank, wins: p.wins, losses: p.losses });

// Ce que disent les listes, pour chaque membre actuel.
const now = {};
for (const p of [...team.players, ...(team.placement ?? [])]) {
  if (inClan.has(p?.publicId)) (now[p.publicId] ??= {}).team = teamOf(p);
}
for (const p of ffa.players) {
  if (inClan.has(p?.publicId)) (now[p.publicId] ??= {}).ffa = ffaOf(p);
}

// La Team ELO partie par partie : [minute, ELO, victoire (1/0), officielle (1/0)]. Le FFA : la dernière note de chaque jour.
const minute = (iso) => Math.round(Date.parse(iso) / 60_000);
const teamHistory = (h) => (Array.isArray(h) ? h : []).filter((g) => Number.isFinite(g?.elo) && g.date).map((g) => [minute(g.date), Math.round(g.elo), g.won ? 1 : 0, g.official ? 1 : 0]);
const ffaHistory = (h) => {
  const byDay = new Map();
  for (const s of Array.isArray(h) ? h : []) if (Number.isFinite(s?.rating) && s.date) byDay.set(s.date.slice(0, 10), [minute(s.date), Math.round(s.rating)]);
  return [...byDay.values()];
};

const started = Date.now();
let read = 0;
const players = {};
for (const [id, cur] of Object.entries(now)) {
  const old = store.players[id];
  const sig = `${cur.team?.games ?? 0}|${cur.team?.elo ?? 0}|${(cur.ffa?.wins ?? 0) + (cur.ffa?.losses ?? 0)}|${cur.ffa?.rating ?? 0}`;
  let hist = old?.hist ?? null;
  let seen = old?.sig;
  if (sig !== old?.sig && Date.now() - started < BUDGET_MS) {
    await sleep(PAUSE_MS);
    const p = await get(`/player/${encodeURIComponent(id)}.json`);
    read += 1;
    if (p) {
      hist = { team: teamHistory(p.teamElo?.history), ffa: ffaHistory(p.ffa?.history) };
      seen = sig;
    }
  }
  players[id] = { ...cur, sig: seen ?? null, hist };
}

store.players = players;
store.team = { at: team.updatedAt, season: team.season, since: team.since };
store.ffa = { at: ffa.updatedAt, season: ffa.season };
await mkdir("data", { recursive: true });
await writeFile(OUT, JSON.stringify(store));
const late = Object.values(players).filter((p) => !p.hist).length;
console.log(`ELO : ${Object.keys(players).length} membres sur TeamStats, ${read} fiches lues, ${late} encore sans historique`);
