// La cote des joueurs en équipe, recalculée depuis le début à chaque mise à jour, à partir des parties relevées par
// scripts/fetch-team-games.mjs. Le calcul prend quelques secondes : changer la formule ne demande rien de plus.
//
// La formule : OpenSkill (Weng-Lin, modèle de Plackett-Luce), un système libre de la famille de TrueSkill. Chaque joueur a
// un niveau estimé (mu) et une incertitude (sigma). Après chaque partie, l'équipe gagnante bat chacune des autres équipes :
// - avec qui tu gagnes : la force d'une équipe est la somme des niveaux de ses joueurs, et gagner avec une équipe bien plus
//   forte que l'adversaire rapporte peu ;
// - contre qui : battre des équipes fortes rapporte plus que battre des équipes faibles ;
// - l'incertitude : un nouveau joueur bouge vite, un joueur qui a beaucoup joué bouge peu.
// L'API ne dit pas dans quelle équipe était chaque perdant : chaque équipe perdante est estimée à la force moyenne des
// perdants. Un gagnant mort en cours de partie ne reçoit que la part de la victoire correspondant à son temps en vie ; un
// perdant perd toujours tout, sinon quitter tôt protégerait sa cote.
//
// Comptent : les parties publiques par équipes, ni spéciales (modificateurs) ni Humains contre Nations, d'au moins
// 2 minutes, à 10 joueurs par équipe au plus. Le classement montre la cote prudente, mu - 3 sigma, après MIN_GAMES parties.
//
// Le calcul part du 1er du mois le plus ancien dont tous les jours sont relevés jusqu'au dernier : pendant que le relevé
// remonte un mois, le site garde la cote du mois d'après.
import { readFile, writeFile, readdir } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import { pathToFileURL } from "node:url";

const DIR = "data/parties";
// Le relevé le plus ancien possible ; le même que dans scripts/fetch-team-games.mjs.
const FROM = process.env.COTE_FROM ?? "2026-09-01";
const DAY_MS = 86_400_000;
const OUT = "data/cote.json";
// Les pseudos du top mondial, gardés avec les parties dans le cache d'Actions.
const NAMES = `${DIR}/noms.json`;
const TOP = 100;
// Le minimum de parties pour être classé : 20 au début, puis 40, puis 60. Pour un joueur ordinaire, la cote après
// 40 parties annonce à peine mieux la suite qu'après 20, et nettement mieux après 60. À remonter avec plus de mois.
export const MIN_GAMES = 60;
const MU = 25;
const SIGMA = MU / 3;
const BETA_SQ = (SIGMA / 2) ** 2;
const TAU_SQ = (MU / 300) ** 2;
const KAPPA = 0.0001;
const MIN_SECONDS = 120;
const MAX_TEAM_SIZE = 10;
// Bonus de survie entre perdants : un perdant encore en vie à la fin perd moins qu'un perdant éliminé tôt. Choisi le
// 27 novembre 2026 sur les parties de novembre, prévues avant de les jouer : 0,4 annonce le mieux si un joueur va gagner
// (+9 % sur l'ancienne formule) ; plus fort, il ferait monter des joueurs qui survivent beaucoup sans gagner.
const SURVIVAL = 0.4;

// Un joueur parti sans rien faire (ni attaque, ni construction, ni bateau, ni bombe) est ignoré : sa cote ne bouge pas,
// et il ne compte pas dans la force de son équipe.
const active = (p) => p[3] === 1;

// Une partie compte-t-elle ? [début, durée, équipes, format, spéciale, tours, gagnants, perdants]. La taille des équipes
// se mesure avec tous les joueurs inscrits, actifs ou non.
export const counts = ([, seconds, teams, , special, , winners, losers]) =>
  !special && seconds >= MIN_SECONDS && winners.some(active) && losers.some(active) && (winners.length + losers.length) / teams <= MAX_TEAM_SIZE;

// Met à jour les cotes (Map identifiant → [mu, sigma, parties, victoires, dernière partie]) avec une partie.
export function rate(ratings, [start, , teams, , , turns, allWinners, allLosers]) {
  const winners = allWinners.filter(active);
  const losers = allLosers.filter(active);
  const get = (id) => {
    let r = ratings.get(id);
    if (!r) ratings.set(id, (r = [MU, SIGMA, 0, 0, 0]));
    // L'incertitude remonte un peu à chaque partie : le niveau d'un joueur peut changer.
    r[1] = Math.sqrt(r[1] ** 2 + TAU_SQ);
    return r;
  };
  // La part de la partie passée en vie : 1 pour un joueur encore là à la fin.
  const alive = (dead) => (dead < 0 || !(turns > 0) ? 1 : Math.min(1, Math.max(0, dead / turns)));
  const W = winners.map(([id, , dead]) => [get(id), alive(dead)]);
  const L = losers.map(([id, , dead]) => [get(id), alive(dead)]);
  const others = teams - 1;
  const muW = W.reduce((s, [r]) => s + r[0], 0);
  const varW = W.reduce((s, [r]) => s + r[1] ** 2, 0);
  const sumL = L.reduce((s, [r]) => s + r[0], 0);
  const muL = sumL / others;
  const varL = L.reduce((s, [r]) => s + r[1] ** 2, 0) / others;
  // L'équipe gagnante devant chacune des autres ; chaque équipe perdante derrière elle.
  // (Le modèle Bradley-Terry, équipe contre équipe, a été essayé : une seule victoire dans une partie à 28 équipes y vaut
  // 27 victoires, et des joueurs à 19 % de victoires finissaient en tête. Plackett-Luce ne fait pas cette erreur.)
  const c = Math.sqrt(varW + others * varL + teams * BETA_SQ);
  const eW = Math.exp(muW / c);
  const eL = Math.exp(muL / c);
  const den = eW + others * eL;
  const pW = eW / den;
  const omegaW = (varW / c) * (1 - pW);
  const deltaW = (Math.sqrt(varW) / c) * (varW / c ** 2) * pW * (1 - pW);
  // Chaque perdant est jugé avec la force de sa propre équipe : lui, plus des coéquipiers de la force moyenne des autres
  // perdants (le relevé ne dit pas qui jouait avec qui ; à deux équipes, c'est exactement l'équipe perdante). Avant le
  // 27 novembre 2026, tous les perdants comptaient comme une équipe moyenne : un joueur fort qui perdait dans une partie
  // à 26 équipes ne perdait presque rien, et gardait sa cote en gagnant 4 % de ses parties, autant que le hasard.
  const size = L.length / others;
  const sBar = L.reduce((s, [, a]) => s + a, 0) / L.length;
  for (const [r, weight] of W) {
    const share = r[1] ** 2 / varW;
    r[0] += share * omegaW * weight;
    r[1] *= Math.sqrt(Math.max(1 - share * deltaW * weight, KAPPA));
    r[2] += 1;
    r[3] += 1;
    r[4] = start;
  }
  for (const [r, a] of L) {
    const team = L.length > 1 ? r[0] + (size - 1) * ((sumL - r[0]) / (L.length - 1)) : r[0];
    const p = Math.exp(team / c) / den;
    const share = r[1] ** 2 / varL;
    // La défaite, selon la force de son équipe, et le bonus de survie (nul en moyenne entre les perdants).
    r[0] += (r[1] ** 2 / c) * (-p + SURVIVAL * (a - sBar));
    r[1] *= Math.sqrt(Math.max(1 - share * (Math.sqrt(varL) / c) * (varL / c ** 2) * p * (1 - p), KAPPA));
    r[2] += 1;
    r[4] = start;
  }
}

export const ordinal = ([mu, sigma]) => mu - 3 * sigma;
// La cote affichée : 1000 pour un nouveau joueur, 10 points par point de cote prudente.
export const cote = (r) => Math.round(1000 + 10 * ordinal(r));

// Toutes les parties relevées, dans l'ordre.
export async function* allGames(dir = DIR, from = "") {
  for (const file of (await readdir(dir).catch(() => [])).filter((f) => f.endsWith(".json.gz") && f.slice(0, 10) >= from).sort()) {
    yield* JSON.parse(gunzipSync(await readFile(`${dir}/${file}`))).games;
  }
}

// Le premier jour du calcul : le 1er du mois le plus ancien à partir duquel tous les jours sont relevés jusqu'au dernier.
export async function startDay(dir = DIR) {
  const days = new Set((await readdir(dir).catch(() => [])).filter((f) => f.endsWith(".json.gz")).map((f) => f.slice(0, 10)).filter((d) => d >= FROM));
  if (!days.size) return null;
  const iso = (ms) => new Date(ms).toISOString().slice(0, 10);
  let first = [...days].sort().at(-1);
  while (days.has(iso(Date.parse(first) - DAY_MS))) first = iso(Date.parse(first) - DAY_MS);
  if (first.endsWith("-01")) return first;
  const month = new Date(Date.parse(first));
  const next = iso(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + 1, 1));
  return days.has(next) ? next : first;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  // Seuls les membres actuels du clan sortent d'ici, avec leur rang mondial et leur courbe (la cote à la fin de chaque jour).
  const { members } = JSON.parse(await readFile("data/members.json", "utf8"));
  const inClan = new Set(members.map((m) => m.publicId));
  const ratings = new Map();
  const curves = new Map();
  const lastClan = new Map();
  // Les parties de chaque membre jouées sous le tag [FR] : le classement du clan ne garde que ceux qui en jouent au moins
  // la moitié sous ce tag (scripts/build.mjs).
  const frGames = new Map();
  // La cote de chacun au début du dernier jour où il a joué : [jour, cote], pour ce qu'il a gagné ou perdu ce jour-là.
  const dayStart = new Map();
  let used = 0;
  let first = null;
  let last = null;
  const start = await startDay();
  for await (const game of allGames(DIR, start ?? "")) {
    if (!counts(game)) continue;
    const day = Math.floor(game[0] / 86_400_000);
    for (const [id, , , on] of [...game[6], ...game[7]]) {
      if (on === 1 && dayStart.get(id)?.[0] !== day) dayStart.set(id, [day, ratings.has(id) ? cote(ratings.get(id)) : cote([MU, SIGMA])]);
    }
    rate(ratings, game);
    used += 1;
    first ??= game[0];
    last = game[0];
    for (const [id, clan, , on] of [...game[6], ...game[7]]) {
      if (on !== 1) continue;
      lastClan.set(id, clan);
      if (!inClan.has(id)) continue;
      if (clan === "FR") frGames.set(id, (frGames.get(id) ?? 0) + 1);
      const curve = curves.get(id) ?? curves.set(id, new Map()).get(id);
      curve.set(day, cote(ratings.get(id)));
    }
  }
  // Le rang mondial parmi les joueurs classés (MIN_GAMES parties ou plus).
  const ranked = [...ratings].filter(([, r]) => r[2] >= MIN_GAMES).sort((a, b) => ordinal(b[1]) - ordinal(a[1]));
  const rankOf = new Map(ranked.map(([id], i) => [id, i + 1]));
  // Ce que chacun a gagné ou perdu au dernier jour relevé, celui que la dernière mise à jour a ajouté (0 s'il n'a pas joué).
  const lastDay = last === null ? null : Math.floor(last / 86_400_000);
  const change = (id) => (dayStart.get(id)?.[0] === lastDay ? cote(ratings.get(id)) - dayStart.get(id)[1] : 0);
  const players = {};
  for (const id of inClan) {
    const r = ratings.get(id);
    if (!r) continue;
    players[id] = {
      cote: cote(r),
      games: r[2],
      wins: r[3],
      fr: frGames.get(id) ?? 0,
      rank: rankOf.get(id) ?? null,
      change: change(id),
      // [jour depuis 1970, cote à la fin du jour]
      curve: [...(curves.get(id) ?? [])],
    };
  }
  // Le top mondial, pour sa page : le pseudo de chacun vient d'OpenFront, gardé une semaine dans le cache. Un joueur qui
  // s'est masqué de la recherche sur OpenFront reste sans pseudo (hidden), comme un compte qui n'a pas de pseudo.
  const names = JSON.parse(await readFile(NAMES, "utf8").catch(() => "{}"));
  const top = [];
  let looked = 0;
  for (const [id, r] of ranked.slice(0, TOP)) {
    // Un pseudo manquant relevé avant que le cache ne note pourquoi (hidden) est relu tout de suite.
    const stale = names[id]?.name === null && names[id]?.hidden === undefined;
    if (stale || !(Date.now() - Date.parse(names[id]?.at ?? 0) < 7 * 86_400_000)) {
      try {
        const res = await fetch(`https://api.openfront.io/public/player/${encodeURIComponent(id)}`, { signal: AbortSignal.timeout(15_000) });
        const p = res.ok ? await res.json() : null;
        if (p) names[id] = { name: p.searchHidden ? null : typeof p.username === "string" ? p.username : null, hidden: p.searchHidden === true, at: new Date().toISOString() };
        looked += 1;
      } catch {
        // Le pseudo manquera jusqu'à la prochaine mise à jour.
      }
    }
    top.push({ id, name: names[id]?.name ?? null, hidden: names[id]?.hidden === true, clan: lastClan.get(id) ?? "", cote: cote(r), change: change(id), games: r[2], wins: r[3] });
  }
  await writeFile(NAMES, JSON.stringify(Object.fromEntries(Object.entries(names).filter(([, n]) => Date.now() - Date.parse(n.at) < 30 * 86_400_000))));
  await writeFile(OUT, JSON.stringify({ from: first, until: last, games: used, rated: ratings.size, ranked: ranked.length, minGames: MIN_GAMES, players, top }));
  // La répartition des classés, pour caler les paliers (scripts/build.mjs) : l'ELO à partir duquel on est dans les 1 %,
  // 4 %, 11 %… meilleurs, les parts visées au départ (environ 1 % de Grands maîtres, 3 % de Maîtres, 7 % de Diamants…).
  const at = (share) => cote(ranked[Math.max(0, Math.ceil(share * ranked.length) - 1)][1]);
  if (ranked.length) console.log(`répartition des classés : ${[1, 4, 11, 23, 54, 75, 90].map((p) => `${p} % à ${at(p / 100)}+`).join(", ")}`);
  console.log(`cote depuis le ${start} : ${used} parties, ${ratings.size} joueurs, ${ranked.length} classés (${MIN_GAMES} parties et plus), ${Object.keys(players).length} membres, top ${top.length} (${looked} pseudos lus)`);
}
