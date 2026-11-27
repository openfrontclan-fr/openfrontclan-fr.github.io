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
    ? {
        start: isoDate(w.start),
        wins: count(w.wins),
        promotions: count(w.promotions),
        newActive: Number.isFinite(w.newActive) ? count(w.newActive) : null,
        // Le podium des 7 jours : [pseudo, lien de la fiche ou null, rang, points, victoires, parties], dans l'ordre du bot.
        top: (Array.isArray(w.top) ? w.top : []).slice(0, 3).flatMap((p) => {
          const rank = text(p?.rank, 40);
          const { name, linked } = publicName(p);
          return typeof p?.publicId === "string" && rank && name ? [[name, linked, rank, count(p.xp), count(p.wins), count(p.games)]] : [];
        }),
      }
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

// Speedruns du clan (scripts/fetch-speedruns.mjs) : la victoire la plus rapide par carte, taille et format.
// Chaque ligne : [carte, compacte (1/0), format, secondes, date, partie, joueurs FR, taille de l'équipe, joueurs de la partie,
// [[pseudo, lien de la fiche ou null]], FR anonymes, chrono battu ou null, record du monde (1/0), record du monde d'un autre
// clan à battre ou null]. Les identifiants des joueurs ne sortent pas d'ici : un membre de l'effectif garde son pseudo
// public, un membre anonyme ou parti du clan est seulement compté.
const runs = JSON.parse(await readFile("data/speedruns.json", "utf8").catch(() => "null"));
const validGame = (g) => typeof g === "string" && /^[A-Za-z0-9]{4,16}$/.test(g);
const teamOf = (ids, fr) => {
  const names = [];
  for (const id of Array.isArray(ids) ? ids : []) {
    const { name, linked } = publicName({ publicId: id });
    if (name && byId.has(id)) names.push([name, linked]);
  }
  return [names, Math.max(0, count(fr) - names.length)];
};
// Records de TeamStats (teamstats.pro, site partenaire) détenus par [FR]. Ils viennent de l'extérieur : chaque champ est
// vérifié. Chaque ligne : [carte, compacte (1/0), format OpenFront, format TeamStats, dixièmes de seconde, date, partie,
// joueurs FR, joueurs de la partie, [[pseudo, lien]], FR anonymes].
const TS_FORMATS = ["trio", "quads", "team"];
const ts = runs?.teamstats;
const tsRecords = (Array.isArray(ts?.records) ? ts.records : []).filter((r) =>
  validGame(r?.g) && typeof r.key === "string" && TS_FORMATS.includes(r.format) && r.t > 0 && isoDate(r.at));
const tsKeys = new Set(tsRecords.map((r) => r.key));
// Le record du monde d'un autre clan dans la catégorie, quand il est plus rapide que le nôtre : [secondes (durée de la
// partie, comme nos chronos), clan, partie].
const toBeat = (key, r) => {
  const o = ts?.others?.[key];
  return !tsKeys.has(key) && o && validGame(o.g) && o.t > 0 && o.t < r.t && /^[A-Za-z0-9]{1,8}$/.test(o.clan)
    ? [count(o.t), o.clan.toUpperCase(), o.g]
    : null;
};
const mapName = (map) => text(runs.mapNames?.[map], 60) || text(map, 60);
// Vignettes des cartes (OpenFront, CC BY-SA 4.0), téléchargées par le relevé dans data/maps : nom affiché → fichier.
const thumbFiles = new Set((await readdir("data/maps").catch(() => [])).filter((f) => /^[a-z0-9]+\.webp$/.test(f)));
const thumbOf = (map) => {
  const file = `${map.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().replace(/[^a-z0-9]/g, "")}.webp`;
  return thumbFiles.has(file) ? file : null;
};
const thumbs = {};
for (const map of new Set([...Object.keys(runs?.records ?? {}), ...tsRecords.map((r) => r.key)].map((k) => k.split("|")[0]))) {
  if (thumbOf(map)) thumbs[mapName(map)] = thumbOf(map);
}
const teamstats = tsRecords.length || count(ts?.total)
  ? {
      at: isoDate(ts.at),
      season: text(ts.season, 30).replace(/^season\b/i, "saison"),
      since: isoDate(ts.since),
      total: count(ts.total),
      page: typeof ts.page === "string" && /^https:\/\/teamstats\.pro\/[\w./-]*$/.test(ts.page) ? ts.page : "https://teamstats.pro/",
      rows: tsRecords.map((r) => {
        const [map, size, teams] = r.key.split("|");
        return [mapName(map), size === "Compact" ? 1 : 0, text(teams, 12), r.format, Math.round(r.t * 10), isoDate(r.at), r.g,
          count(r.fr), count(r.n), ...teamOf(r.ids, r.fr)];
      }),
    }
  : null;
const speedruns = runs && runs.records && isoDate(runs.cursor)
  ? {
      until: isoDate(runs.cursor),
      teamstats,
      thumbs,
      rows: Object.entries(runs.records).flatMap(([key, r]) => {
        const [map, size, teams] = key.split("|");
        if (!map || !teams || !validGame(r?.g) || !(r.t > 0) || !isoDate(r.at)) return [];
        return [[
          mapName(map), size === "Compact" ? 1 : 0, text(teams, 12), count(r.t), isoDate(r.at),
          r.g, count(r.fr), count(r.team), count(r.n), ...teamOf(r.ids, r.fr), r.prev > r.t ? count(r.prev) : null,
          tsKeys.has(key) ? 1 : 0, toBeat(key, r),
        ]];
      }),
    }
  : null;

// Les classements des fiches publiques, comme la carrière. La page reçoit le résumé de chaque joueur ; ses courbes et son
// style de jeu partent dans elo.json, que la fiche ne charge qu'à l'ouverture.
// - La cote en équipe, calculée par le site (scripts/cote.mjs) depuis toutes les parties publiques par équipes.
// - Le FFA classé d'OpenFront et le profil de jeu de TeamStats (scripts/fetch-elo.mjs), qui viennent de l'extérieur :
//   chaque champ est vérifié. La Team ELO de TeamStats n'est plus publiée : la cote la remplace.
const eloStore = JSON.parse(await readFile("data/elo.json", "utf8").catch(() => "null"));
const coteStore = JSON.parse(await readFile("data/cote.json", "utf8").catch(() => "null"));
// Une cote n'est publiée que si son relevé est à jour : pendant le premier rattrapage, elle resterait figée au début du mois.
const coteFresh = Number.isFinite(coteStore?.until) && Date.parse(snap.fetchedAt) - coteStore.until < 3 * 86_400_000;
const TIERS = ["Grandmaster", "Master", "Diamond", "Platinum", "Gold", "Silver", "Bronze", "Iron"];
const tierOf = (v) => (typeof v === "string" && /^[A-Za-z]+( I{1,3})?$/.test(v) && TIERS.includes(v.split(" ")[0]) ? v : null);
const STYLES = ["attack", "territory", "support", "economy", "destruction", "building"];
const num = (v) => (Number.isFinite(v) ? Math.round(v) : null);
const rows = (list, width) => (Array.isArray(list) ? list : []).filter((r) => Array.isArray(r) && r.length === width && r.every(Number.isFinite));
const eloPlayers = {};
const cotePlayers = {};
const eloFile = {};
for (const m of members) {
  if (!m.username || profileOf(m).hidden) continue;
  const e = eloStore?.players?.[m.publicId];
  const t = e?.team ?? null;
  const f = e?.ffa && Number.isFinite(e.ffa.rating) ? e.ffa : null;
  const c = coteFresh ? coteStore.players?.[m.publicId] : null;
  const style = Array.isArray(t?.style) && t.style.length === STYLES.length
    ? t.style.map((s) => [tierOf(s?.[0]), Number.isFinite(s?.[1]) ? Math.min(100, Math.max(0, Math.round(s[1]))) : null])
    : null;
  if (!f && !style && !c) continue;
  // [cote, parties, victoires, rang mondial ou null avant MIN_GAMES parties, gain ou perte à la dernière mise à jour,
  // parties sous le tag [FR] (null si le relevé ne le dit pas)]
  if (c && Number.isFinite(c.cote)) cotePlayers[slug(m)] = [num(c.cote), count(c.games), count(c.wins), num(c.rank), num(c.change) ?? 0, Number.isFinite(c.fr) ? count(c.fr) : null];
  // f : [note, palier, rang mondial, pic, victoires, défaites] ; best : la partie du style de jeu où il est le plus fort.
  if (f || style) {
    eloPlayers[slug(m)] = {
      f: f ? [num(f.rating), tierOf(f.tier), num(f.rank), num(f.peak), count(f.wins), count(f.losses)] : null,
      best: STYLES.includes(t?.best) ? t.best : null,
    };
  }
  // s : [palier, % des meilleurs] pour chaque partie du style ; f : [minute, note] ; c : [jour depuis 1970, cote].
  eloFile[slug(m)] = { s: style, f: rows(e?.hist?.ffa, 2), c: c ? rows(c.curve, 2) : [] };
}
const elo = Object.keys(eloPlayers).length
  ? {
      ffaSeason: Number.isFinite(eloStore.ffa?.season?.number) ? eloStore.ffa.season.number : null,
      ffaSince: isoDate(eloStore.ffa?.season?.startDate),
      players: eloPlayers,
    }
  : null;
// Le top mondial de la cote, pour sa page : [pseudo ou null, clan, cote, parties, victoires, fiche ou null, gain ou perte à
// la dernière mise à jour, masqué (1 s'il s'est masqué de la recherche d'OpenFront, 0 sinon)]. Un membre du
// clan y garde son pseudo public et sa fiche ; un membre anonyme ou masqué y reste anonyme, comme partout sur le site. Les
// autres joueurs gardent le pseudo qu'OpenFront publie, sauf s'ils se sont masqués de sa recherche ; un compte sans
// pseudo reste sans pseudo.
const coteTop = (Array.isArray(coteStore?.top) ? coteStore.top : []).slice(0, 100).map((t) => {
  const m = byId.get(t?.id);
  const open = m && m.username && !profileOf(m).hidden;
  const name = m ? (open ? m.username : null) : text(t?.name, 40) || null;
  return [name, m && !open ? "FR" : text(t?.clan, 8), num(t?.cote), count(t?.games), count(t?.wins), open ? slug(m) : null, num(t?.change) ?? 0, !m && t?.hidden === true ? 1 : 0];
}).filter((t) => t[2] !== null);
// Les paliers de l'ELO FR, calés sur sa répartition (environ 1 % de Grands maîtres, 3 % de Maîtres, 7 % de Diamants…),
// recalés le 27 novembre 2026 sur trois mois de parties (journal : « répartition des classés »), puis le même jour après
// la correction des perdants et le bonus de survie.
// Les mêmes pour la page et pour le bot du Discord (elo-fr.json).
const COTE_TIERS = [["Grandmaster", 1525], ["Master", 1350], ["Diamond", 1225], ["Platinum", 1150], ["Gold", 1050], ["Silver", 975], ["Bronze", 925], ["Iron", null]];
const TIER_NAMES = { Grandmaster: "Grand maître", Master: "Maître", Diamond: "Diamant", Platinum: "Platine", Gold: "Or", Silver: "Argent", Bronze: "Bronze", Iron: "Fer" };
// Le classement du clan ne garde que les membres classés qui jouent au moins la moitié de leurs parties par équipes sous le
// tag [FR]. Les autres gardent leur ELO et leur rang mondial.
const FR_SHARE = 0.5;
const inClanBoard = ([, games, , rank, , fr]) => Boolean(rank) && (fr === null || fr >= games * FR_SHARE);
const cote = Object.keys(cotePlayers).length
  ? {
      since: isoDate(new Date(coteStore.from).toISOString()),
      until: isoDate(new Date(coteStore.until).toISOString()),
      games: count(coteStore.games),
      ranked: count(coteStore.ranked),
      minGames: count(coteStore.minGames),
      frShare: FR_SHARE,
      tiers: COTE_TIERS,
      players: cotePlayers,
      top: coteTop,
    }
  : null;
// L'ELO FR des fiches publiques pour le bot du Discord, rangé par fiche (les 8 premiers caractères du SHA-1 de l'identifiant
// OpenFront, comme les liens #joueur-…) : le bot retrouve un compte lié sans que le fichier publie d'identifiant.
const eloForBot = cote
  ? (() => {
      const order = Object.entries(cotePlayers).filter(([, p]) => inClanBoard(p)).sort((a, b) => b[1][0] - a[1][0]).map(([s]) => s);
      const tierOf = (v) => COTE_TIERS.find(([, min]) => min === null || v >= min)[0];
      return {
        site: SITE_URL,
        updatedAt: cote.until,
        since: cote.since,
        formula: "1000 + 10 × (niveau − 3 × incertitude), OpenSkill (Plackett-Luce)",
        ranked: cote.ranked,
        minGames: cote.minGames,
        frShare: FR_SHARE,
        tiers: COTE_TIERS.map(([t, min]) => ({ name: TIER_NAMES[t], min })),
        players: Object.fromEntries(Object.entries(cotePlayers).map(([s, [elo, games, wins, rank, change, fr]]) => [s, {
          elo,
          change,
          tier: rank ? TIER_NAMES[tierOf(elo)] : null,
          worldRank: rank,
          // null aussi pour un membre classé qui joue moins de la moitié de ses parties sous le tag [FR].
          clanRank: order.includes(s) ? order.indexOf(s) + 1 : null,
          games,
          wins,
          frGames: fr,
          page: `${SITE_URL}/#joueur-${s}`,
        }])),
      };
    })()
  : null;

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
  speedruns,
  elo,
  cote,
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
// Logo de TeamStats, site partenaire, fourni par son auteur pour ce site.
await copyFile("assets/partners/teamstats.png", `${out}/teamstats.png`);
// Vignettes des cartes des speedruns, chargées seulement quand leur ligne s'affiche.
await mkdir(`${out}/maps`, { recursive: true });
for (const file of Object.values(thumbs)) await copyFile(`data/maps/${file}`, `${out}/maps/${file}`);
// Courbes d'ELO et style de jeu des fiches publiques, chargés à l'ouverture d'une fiche.
await writeFile(`${out}/elo.json`, JSON.stringify(eloFile));
// L'ELO FR des fiches publiques, lu par le bot du Discord pour sa commande de profil.
if (eloForBot) await writeFile(`${out}/elo-fr.json`, JSON.stringify(eloForBot));
// Image d'aperçu des liens partagés (Discord, réseaux) ; sa source est assets/og-card.html.
await copyFile("assets/og-card.png", `${out}/og.png`);
// Carte du monde en points derrière l'accueil, tirée de la carte « World » d'OpenFront (scripts/world-map.mjs).
await copyFile("assets/world.svg", `${out}/world.svg`);
// Polices hébergées avec le site, pour que la page ne demande rien à Google Fonts (assets/fonts/LICENCE.md).
await mkdir(`${out}/fonts`, { recursive: true });
await copyFile("assets/fonts/anton.woff2", `${out}/fonts/anton.woff2`);
await copyFile("assets/fonts/inter.woff2", `${out}/fonts/inter.woff2`);
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
