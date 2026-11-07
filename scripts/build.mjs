// Agrège les données et les injecte dans src/page.html.
// Produit public/index.html (à héberger) et public/artifact.html (aperçu, sans doctype).
import { createHash } from "node:crypto";
import { copyFile, readFile, writeFile, mkdir } from "node:fs/promises";

const [source = "src/page.html", out = "public"] = process.argv.slice(2);
const profiles = JSON.parse(await readFile("data/profiles.json", "utf8").catch(() => "{}"));
const snap = JSON.parse(await readFile("data/snapshot.json", "utf8"));
const page = await readFile(source, "utf8");
const { members } = JSON.parse(await readFile("data/members.json", "utf8"));

const paris = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Paris",
  weekday: "short",
  hour: "2-digit",
  hourCycle: "h23",
});
const WEEK = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

// Parties par jour de la semaine et par heure de Paris.
const heat = WEEK.map(() => Array(24).fill(0));
for (const s of snap.sessions) {
  const parts = Object.fromEntries(
    paris.formatToParts(new Date(s.t)).map((p) => [p.type, p.value]),
  );
  heat[WEEK.indexOf(parts.weekday)][Number(parts.hour)] += 1;
}

// Effectif : aucun identifiant n'est publié pour les membres sans pseudo public.
const played = (m) => m.stats.total.wins + m.stats.total.losses;

// Membres actuels cumulés, jour par jour, depuis la première arrivée.
const joinedPerDay = new Map();
for (const m of members) {
  const day = m.joinedAt.slice(0, 10);
  joinedPerDay.set(day, (joinedPerDay.get(day) ?? 0) + 1);
}
const firstDay = [...joinedPerDay.keys()].sort()[0];
const lastDay = snap.fetchedAt.slice(0, 10);
const growth = [];
let total = 0;
for (let d = new Date(`${firstDay}T00:00:00Z`); d.toISOString().slice(0, 10) <= lastDay; d = new Date(d.getTime() + 86_400_000)) {
  const key = d.toISOString().slice(0, 10);
  total += joinedPerDay.get(key) ?? 0;
  growth.push([key, total]);
}

// Le lien d'une page joueur ne révèle pas son identifiant OpenFront.
const slug = (m) => createHash("sha1").update(m.publicId).digest("hex").slice(0, 8);
// Même ordre que MODE_KEYS dans la page.
const MODES = ["ffa", "team", "duos", "trios", "quads", "hvn", "ranked", "1v1"];
const modeStats = (m) => {
  const flat = MODES.flatMap((k) => [m.stats[k].wins, m.stats[k].losses]);
  return flat.some((v) => v > 0) ? flat : null;
};

// Un profil masqué, illisible ou pas encore récupéré ne publie aucune donnée détaillée.
const profileOf = (m) => profiles[m.publicId] ?? { hidden: true };
const publicProfiles = Object.fromEntries(
  members
    .filter((m) => m.username && !profileOf(m).hidden)
    .map((m) => [slug(m), { id: m.publicId, since: profileOf(m).since, fun: profileOf(m).fun }]),
);

const roster = {
  total: members.length,
  named: members.filter((m) => m.username).length,
  active: members.filter((m) => played(m) > 0).length,
  command: members
    .filter((m) => m.role !== "member" && m.username)
    .map((m) => ({ role: m.role, name: m.username, slug: slug(m) })),
  growth,
  profiles: publicProfiles,
  rows: members
    .filter((m) => m.username || played(m) > 0)
    .map((m) => [
      m.username ?? null,
      m.username ? slug(m) : null,
      m.joinedAt.slice(0, 10),
      m.stats.total.wins,
      m.stats.total.losses,
      m.username ? modeStats(m) : null,
      m.username && profileOf(m).hidden ? 1 : 0,
    ]),
};

// Classement du bot Discord : seulement les comptes liés et non masqués, envoyés par le bot.
// Il vient de l'extérieur du site : chaque champ est vérifié avant d'entrer dans la page.
const sent = JSON.parse(await readFile("data/discord.json", "utf8").catch(() => "null"));
const byId = new Map(members.map((m) => [m.publicId, m]));
const text = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const count = (v) => (Number.isFinite(v) && v >= 0 ? Math.round(v) : 0);
const discord = Array.isArray(sent?.players) && !Number.isNaN(Date.parse(sent.generatedAt))
  ? {
      at: new Date(sent.generatedAt).toISOString(),
      ranked: count(sent.ranked),
      players: sent.players.slice(0, 500).flatMap((p) => {
        const rank = text(p.rank, 40);
        if (typeof p.publicId !== "string" || !rank) return [];
        const m = byId.get(p.publicId);
        // Pseudo public de l'effectif d'abord ; un membre anonyme dans l'effectif le reste ici.
        const name = m ? m.username ?? null : text(p.username, 40) || null;
        const linked = m?.username && !profileOf(m).hidden ? slug(m) : null;
        return [[count(p.position) || null, name, linked, rank, count(p.xp), count(p.games)]];
      }),
    }
  : null;

const data = {
  tag: snap.tag,
  roster,
  discord,
  fetchedAt: snap.fetchedAt,
  period: { start: snap.leaderboard.start, end: snap.leaderboard.end },
  clans: snap.leaderboard.clans.map((c, i) => ({
    rank: i + 1,
    tag: c.clanTag,
    games: c.games,
    wins: c.wins,
    score: c.weightedWins,
  })),
  days: snap.days.map((d) => ({ date: d.date, games: d.games, wins: d.wins })),
  sessionCount: snap.sessions.length,
  heat,
};

const json = JSON.stringify(data).replaceAll("<", "\\u003c");
const body = page.replace("/*__DATA__*/null", () => json);

const headEnd = body.indexOf("</style>") + "</style>".length;

await mkdir(out, { recursive: true });
await copyFile("assets/bg-hero.webp", `${out}/bg-hero.webp`);
await copyFile("assets/logo.svg", `${out}/logo.svg`);
await writeFile(`${out}/artifact.html`, body);
await writeFile(
  `${out}/index.html`,
  `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#070a14">
<meta property="og:type" content="website">
<meta property="og:title" content="Front Français [FR]">
<meta property="og:description" content="Le clan France sur OpenFront : classement, membres, podiums et meilleurs créneaux.">
<link rel="icon" type="image/svg+xml" href="logo.svg">
${body.slice(0, headEnd)}
</head>
<body>
${body.slice(headEnd)}
</body>
</html>
`,
);
console.log(`${out}/index.html`, (body.length / 1024).toFixed(0) + " Ko");
