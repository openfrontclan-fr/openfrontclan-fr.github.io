// Agrège les données et les injecte dans src/page.html.
// Produit public/index.html (à héberger) et public/artifact.html (aperçu, sans doctype).
import { createHash } from "node:crypto";
import { copyFile, readdir, readFile, writeFile, mkdir } from "node:fs/promises";

const [source = "src/page.html", out = "public"] = process.argv.slice(2);
// Adresse publique du site, pour les aperçus de liens. GitHub Pages redirige openfrontclan-fr.github.io vers ce domaine.
const SITE_URL = "https://frclan.fr";
const DESCRIPTION = "Le clan France sur OpenFront : classement, membres, rangs du Discord et guide du débutant.";
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
const isoDate = (v) => (typeof v === "string" && !Number.isNaN(Date.parse(v)) ? new Date(v).toISOString() : null);
// Un membre de l'effectif garde son pseudo public, un membre anonyme le reste ; hors de l'effectif, le pseudo envoyé.
const publicName = (p) => {
  const m = byId.get(p?.publicId);
  return {
    name: m ? m.username ?? null : text(p?.username, 40) || null,
    linked: m?.username && !profileOf(m).hidden ? slug(m) : null,
  };
};

// Ce que le bot envoie en plus du classement, chaque partie facultative.
function discordExtras() {
  // L'échelle des rangs : [nom, points, parties], du plus bas au plus haut. Sert à la progression des fiches.
  const ladder = (Array.isArray(sent.ladder) ? sent.ladder : []).slice(0, 60).flatMap((r) =>
    Array.isArray(r) && text(r[0], 40) ? [[text(r[0], 40), count(r[1]), count(r[2])]] : [],
  ).sort((a, b) => a[1] - b[1]);
  // Les 7 derniers jours, comptés par le bot depuis week.start. newActive vaut null quand l'API d'OpenFront n'a pas répondu.
  const w = sent.week;
  const week = w && isoDate(w.start)
    ? { start: isoDate(w.start), wins: count(w.wins), promotions: count(w.promotions), newActive: Number.isFinite(w.newActive) ? count(w.newActive) : null }
    : null;
  // Les dernières promotions : [pseudo, lien de la fiche ou null, rang, date]. Un membre anonyme n'y figure pas.
  const promotions = (Array.isArray(sent.promotions) ? sent.promotions : []).slice(0, 30).flatMap((p) => {
    const rank = text(p?.rank, 40);
    const at = isoDate(p?.at);
    const { name, linked } = publicName(p);
    return typeof p?.publicId === "string" && rank && at && name ? [[name, linked, rank, at]] : [];
  }).sort((a, b) => b[3].localeCompare(a[3])).slice(0, 8);
  // La dernière gazette : son nom, sa date, quelques lignes de texte brut et le lien du message sur Discord.
  const g = sent.gazette;
  const gazette = g && text(g.name, 40) && isoDate(g.at)
    ? {
        name: text(g.name, 40),
        at: isoDate(g.at),
        lines: (Array.isArray(g.lines) ? g.lines : []).slice(0, 5).map((l) => text(l, 160)).filter(Boolean),
        url: typeof g.url === "string" && /^https:\/\/discord\.com\/channels\/\d+\/\d+(\/\d+)?$/.test(g.url) ? g.url : null,
      }
    : null;
  return { ladder, week, promotions, gazette };
}

const discord = Array.isArray(sent?.players) && !Number.isNaN(Date.parse(sent.generatedAt))
  ? {
      at: new Date(sent.generatedAt).toISOString(),
      ranked: count(sent.ranked),
      players: sent.players.slice(0, 500).flatMap((p) => {
        const rank = text(p.rank, 40);
        if (typeof p.publicId !== "string" || !rank) return [];
        const { name, linked } = publicName(p);
        return [[count(p.position) || null, name, linked, rank, count(p.xp), count(p.games)]];
      }),
      ...discordExtras(),
    }
  : null;

// Événements programmés sur le Discord, envoyés avec le classement : nom, dates et lieu seulement.
const events = (Array.isArray(sent?.events) ? sent.events : []).slice(0, 8).flatMap((e) => {
  const name = text(e?.name, 100);
  const start = isoDate(e?.start);
  return name && start ? [{ name, start, end: isoDate(e.end), place: text(e.place, 60) || null }] : [];
}).sort((a, b) => a.start.localeCompare(b.start));

// Place du clan jour par jour : l'historique du dépôt, plus le point du jour, que le workflow n'y ajoute qu'après la construction.
const history = JSON.parse(await readFile("data/history.json", "utf8").catch(() => "[]"));
const todayPoint = { date: snap.fetchedAt.slice(0, 10), rank: snap.leaderboard.clans.findIndex((c) => c.clanTag === snap.tag) + 1 };
const places = [...history.filter((p) => p.date !== todayPoint.date), todayPoint]
  .filter((p) => /^\d{4}-\d{2}-\d{2}$/.test(p.date) && Number.isInteger(p.rank) && p.rank > 0)
  .sort((a, b) => a.date.localeCompare(b.date))
  .slice(-180)
  .map((p) => [p.date, p.rank]);

const data = {
  tag: snap.tag,
  roster,
  discord,
  events,
  places,
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

// Icônes du jeu (OpenFront, CC BY-SA 4.0) : chaque fichier de assets/icons devient un masque CSS .ico-<nom>.
const iconFiles = (await readdir("assets/icons")).filter((f) => f.endsWith(".svg")).sort();
const icons = (await Promise.all(iconFiles.map(async (f) =>
  `.ico-${f.slice(0, -4)} { --ico: url("data:image/svg+xml;base64,${(await readFile(`assets/icons/${f}`)).toString("base64")}"); }`,
))).join("\n");

const json = JSON.stringify(data).replaceAll("<", "\\u003c");
const body = page.replace("/*__ICONS__*/", () => icons).replace("/*__DATA__*/null", () => json);

const headEnd = body.indexOf("</style>") + "</style>".length;

await mkdir(out, { recursive: true });
await copyFile("assets/bg-hero.webp", `${out}/bg-hero.webp`);
await copyFile("assets/logo.svg", `${out}/logo.svg`);
// Image d'aperçu des liens partagés (Discord, réseaux) ; sa source est assets/og-card.html.
await copyFile("assets/og-card.png", `${out}/og.png`);
await writeFile(`${out}/artifact.html`, body);
await writeFile(
  `${out}/index.html`,
  `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#070a14">
<meta name="description" content="${DESCRIPTION}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="FR - OpenFront">
<meta property="og:title" content="FR - OpenFront">
<meta property="og:description" content="${DESCRIPTION}">
<meta property="og:url" content="${SITE_URL}/">
<meta property="og:image" content="${SITE_URL}/og.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="Rejoins le clan : le clan officiel France [FR] sur OpenFront">
<meta name="twitter:card" content="summary_large_image">
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
