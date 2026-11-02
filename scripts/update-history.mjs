// Ajoute le point du jour à data/history.json : c'est la seule donnée conservée d'un jour à l'autre.
import { readFile, writeFile } from "node:fs/promises";

const FILE = "data/history.json";
const snap = JSON.parse(await readFile("data/snapshot.json", "utf8"));
const { members } = JSON.parse(await readFile("data/members.json", "utf8"));
const history = JSON.parse(await readFile(FILE, "utf8").catch(() => "[]"));

const clans = snap.leaderboard.clans;
const i = clans.findIndex((c) => c.clanTag === snap.tag);
const neighbour = (c) => (c ? { tag: c.clanTag, score: c.weightedWins } : null);
const point = {
  date: snap.fetchedAt.slice(0, 10),
  rank: i + 1,
  score: clans[i].weightedWins,
  games: clans[i].games,
  wins: clans[i].wins,
  members: members.length,
  above: neighbour(clans[i - 1]),
  below: neighbour(clans[i + 1]),
};

const kept = history.filter((p) => p.date !== point.date);
kept.push(point);
await writeFile(FILE, `${JSON.stringify(kept, null, 1)}\n`);
console.log(`historique : ${kept.length} jour(s), ${point.date}, rang ${point.rank}`);
