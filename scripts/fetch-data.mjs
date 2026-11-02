// Télécharge les stats publiques du tag [FR] et écrit data/snapshot.json.
// À lancer côté serveur (CI, cron) : l'API n'autorise pas les appels depuis un autre site.
import { writeFile, mkdir } from "node:fs/promises";

const API = "https://api.openfront.io/public";
const TAG = "FR";
const DAYS = 14;
const SESSION_DAYS = 7;
const PAGE_SIZE = 50;
const DAY_MS = 86_400_000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(path) {
  await sleep(400);
  const res = await fetch(`${API}${path}`, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`${path} -> HTTP ${res.status}`);
  return res.json();
}

const range = (start, end) => `start=${start.toISOString()}&end=${end.toISOString()}`;

// Les journées sont découpées à minuit UTC ; la journée en cours est écartée car incomplète.
const today = new Date(new Date().toISOString().slice(0, 10) + "T00:00:00Z");

const leaderboard = await get("/clans/leaderboard");

const days = [];
for (let i = DAYS; i >= 1; i--) {
  const start = new Date(today.getTime() - i * DAY_MS);
  const end = new Date(start.getTime() + DAY_MS);
  const { clan } = await get(`/clan/${TAG}?${range(start, end)}`);
  days.push({ date: start.toISOString().slice(0, 10), ...clan });
}

const sessions = [];
for (let i = SESSION_DAYS; i >= 1; i--) {
  const start = new Date(today.getTime() - i * DAY_MS);
  const end = new Date(start.getTime() + DAY_MS);
  for (let page = 1; ; page++) {
    const { results, total } = await get(
      `/clan/${TAG}/sessions?${range(start, end)}&limit=${PAGE_SIZE}&page=${page}`,
    );
    sessions.push(...results);
    if (page * PAGE_SIZE >= total || results.length === 0) break;
  }
}

const now = new Date();
const latest = await get(
  `/clan/${TAG}/sessions?${range(new Date(now.getTime() - DAY_MS), now)}&limit=12&page=1`,
);

await mkdir("data", { recursive: true });
await writeFile(
  "data/snapshot.json",
  JSON.stringify({
    tag: TAG,
    fetchedAt: now.toISOString(),
    leaderboard,
    days,
    sessions: sessions.map((s) => ({
      t: s.gameStart,
      w: s.hasWon,
      n: s.clanPlayerCount,
      f: s.playerTeams,
      k: s.numTeams,
    })),
    latest: latest.results,
  }),
);
console.log(`days=${days.length} sessions=${sessions.length}`);
