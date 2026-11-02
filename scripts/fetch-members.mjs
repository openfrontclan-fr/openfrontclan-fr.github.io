// Télécharge la liste officielle des membres du clan et écrit data/members.json.
import { writeFile, mkdir } from "node:fs/promises";

const API = "https://api.openfront.io/public";
const TAG = "FR";
const PAGE_SIZE = 50;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const members = [];
for (let page = 1; ; page++) {
  await sleep(400);
  const res = await fetch(`${API}/clan/${TAG}/members?limit=${PAGE_SIZE}&page=${page}`, {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`page ${page} -> HTTP ${res.status}`);
  const { results, total } = await res.json();
  members.push(...results);
  if (page * PAGE_SIZE >= total || results.length === 0) break;
}

await mkdir("data", { recursive: true });
await writeFile(
  "data/members.json",
  JSON.stringify({ fetchedAt: new Date().toISOString(), members }),
);
console.log(`membres=${members.length}`);
