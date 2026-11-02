// Télécharge le profil public des membres à pseudo public et écrit data/profiles.json.
// Un profil masqué (searchHidden) ou illisible est noté hidden : aucune de ses données détaillées n'est gardée.
import { readFile, writeFile } from "node:fs/promises";

const API = "https://api.openfront.io/public";
const OUT = "data/profiles.json";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const { members } = JSON.parse(await readFile("data/members.json", "utf8"));
const named = members.filter((m) => m.username);

async function load(id) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await fetch(`${API}/player/${encodeURIComponent(id)}`, { headers: { Accept: "application/json" } });
    if (res.ok) return res.json();
    if (res.status !== 429) return null;
    await sleep(30_000);
  }
  return null;
}

// Carrière en parties publiques : trahisons, bombes A, bombes H, MIRV, transports, villes, or.
function career(player) {
  const fun = [0, 0, 0, 0, 0, 0, 0];
  for (const difficulties of Object.values(player.stats?.Public ?? {})) {
    for (const leaf of Object.values(difficulties)) {
      const s = leaf.stats ?? {};
      fun[0] += Number(s.betrayals ?? 0);
      fun[1] += Number(s.bombs?.abomb?.[0] ?? 0);
      fun[2] += Number(s.bombs?.hbomb?.[0] ?? 0);
      fun[3] += Number(s.bombs?.mirv?.[0] ?? 0);
      fun[4] += Number(s.boats?.trans?.[0] ?? 0);
      fun[5] += Number(s.units?.city?.[0] ?? 0);
      fun[6] += (s.gold ?? []).reduce((sum, v) => sum + Number(v), 0);
    }
  }
  return fun;
}

const profiles = {};
let done = 0, hidden = 0, failed = 0;
for (const m of named) {
  await sleep(350);
  let player = null;
  try {
    player = await load(m.publicId);
  } catch {
    player = null;
  }
  if (!player) failed += 1;
  if (!player || player.searchHidden) {
    hidden += 1;
    profiles[m.publicId] = { hidden: true };
  } else {
    profiles[m.publicId] = { since: player.createdAt?.slice(0, 7) ?? null, fun: career(player) };
  }
  done += 1;
  if (done % 100 === 0) {
    await writeFile(OUT, JSON.stringify(profiles));
    console.log(`${done}/${named.length}`);
  }
}
await writeFile(OUT, JSON.stringify(profiles));
console.log(`profils=${done} masques=${hidden} echecs=${failed}`);
// Trop d'échecs : on arrête tout plutôt que de publier un site sans profils.
if (failed > named.length * 0.2) {
  console.error("Trop de profils illisibles, la mise à jour est annulée.");
  process.exit(1);
}
