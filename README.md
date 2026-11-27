# Front Français [FR]

Site du clan France [FR] sur [OpenFront](https://openfront.io/). Site de clan non officiel, sans lien avec les éditeurs du jeu.

## Fonctionnement

Le workflow `.github/workflows/site.yml` tourne deux fois par jour, à 12 heures d'écart : une mise à jour complète, puis une légère qui saute `fetch-profiles.mjs` et reprend les fiches de la complète, gardées dans le cache d'Actions. Un push lance aussi une mise à jour légère.

1. `scripts/fetch-members.mjs`, `fetch-profiles.mjs` et `fetch-data.mjs` téléchargent les données publiques d'OpenFront.
2. `scripts/build.mjs` les injecte dans `src/page.html` et produit le site.
3. `scripts/update-history.mjs` ajoute le point du jour à `data/history.json`.
4. Le site est déployé sur GitHub Pages.

Si le téléchargement échoue, le déploiement s'arrête et la dernière version reste en ligne.

## Classement du Discord

Le bot du Discord envoie son classement par un événement `repository_dispatch` de type `classement-discord`, avec un jeton GitHub limité à ce dépôt (permission « Contents » en écriture). Le workflow le garde dans le cache d'Actions, sans le mettre dans le dépôt, et le reprend aux mises à jour suivantes.

```json
{
  "event_type": "classement-discord",
  "client_payload": {
    "generatedAt": "2026-11-07T08:00:00.000Z",
    "ranked": 14,
    "players": [
      { "publicId": "…", "username": "…", "rank": "Capitaine II", "xp": 268, "games": 47, "position": 1 }
    ],
    "events": [
      { "name": "Guerre de clans", "start": "2026-11-14T20:00:00.000Z", "end": "2026-11-14T22:00:00.000Z", "place": "Vocal 1" }
    ],
    "ladder": [["Soldat", 0, 0], ["Caporal", 25, 0], ["Caporal II", 50, 0]],
    "week": {
      "start": "2026-11-15T23:00:00.000Z", "wins": 662, "promotions": 9, "newActive": 14,
      "top": [{ "publicId": "…", "username": "…", "rank": "Commandant II", "xp": 1842, "wins": 105, "games": 214 }]
    },
    "promotions": [
      { "publicId": "…", "username": "…", "rank": "Capitaine II", "at": "2026-11-21T19:37:00.000Z" }
    ],
    "gazette": {
      "name": "…",
      "at": "2026-11-21T16:00:00.000Z",
      "lines": ["6e au classement des clans, devant CYN", "814 victoires [FR] dans la semaine"],
      "url": "https://discord.com/channels/<serveur>/<salon>/<message>"
    }
  }
}
```

`ladder`, `week`, `promotions` et `gazette` sont facultatifs : sans eux, leurs blocs ne s'affichent pas.

- `ladder` est l'échelle complète des rangs, `[nom, points, parties]` du plus bas au plus haut. La fiche d'un joueur en tire la barre de progression vers le rang suivant.
- `week` est ce que le bot a compté sur les 7 derniers jours, depuis `start` (minuit à Paris) : victoires [FR], promotions échelons compris, et nouvelles recrues déjà en jeu (`newActive`, ou `null` quand l'API d'OpenFront n'a pas répondu). L'accueil l'affiche dans « La semaine du clan », avec la place gagnée ou perdue depuis `start`, tirée de l'historique du site. `week.top` donne les 3 meilleurs de ces 7 jours, par points gagnés (`xp`, `wins` et `games` sur les 7 jours, `rank` actuel) : c'est le podium en haut de l'accueil. Sans lui, le podium montre les 3 premiers du classement Discord au total.
- `promotions` liste les dernières montées de rang. Le site en garde 8, les plus récentes, et n'affiche pas un membre anonyme dans l'effectif.
- `gazette` est la dernière gazette du bot : son nom, sa date, au plus 5 lignes de texte brut et le lien de son message sur Discord.

Les insignes des rangs sont dessinés comme les images du bot : chevrons pour la troupe, galons pour les officiers, étoiles sur fond or pour les généraux. Les noms des grades doivent donc rester ceux de l'échelle : Soldat, Caporal, Sergent, Major, Lieutenant, Capitaine, Commandant, Colonel, Général, Maréchal, suivis de II ou III.

`events` liste au plus 8 événements Discord programmés ou en cours : nom, début, fin (ou `null`) et lieu (ou `null`). L'accueil les affiche dans « Prochains événements » et masque de lui-même ceux qui sont finis, ou commencés depuis plus de 3 heures quand ils n'ont pas de fin.

`players` ne contient que les comptes liés avec `/lier` et non masqués ; `ranked` compte tous les membres classés, et `position` est la place dans ce classement complet. Le site garde le pseudo de l'effectif quand le joueur y est, et un membre anonyme dans l'effectif le reste. Avec `"profils": true` dans `client_payload`, la mise à jour retélécharge aussi les fiches des joueurs.

## Speedruns du clan

`scripts/fetch-speedruns.mjs` garde, pour chaque carte, taille de carte et format, la victoire [FR] la plus rapide. Elle compte quand le clan fait au moins la moitié de l'équipe gagnante, avec au moins 2 joueurs [FR], en partie publique par équipes d'au moins 2 minutes. Le chrono est la durée de la partie donnée par OpenFront, comme dans les messages de victoire du bot.

Le relevé lit les victoires du clan jour par jour (`/clan/FR/sessions`), puis le détail de celles où les joueurs [FR] sont assez nombreux pour peser dans leur équipe (`/game/:id`) : au moins 2, et au moins le quart d'une équipe moyenne de la partie. Il reprend où le précédent s'est arrêté et s'arrête au bout de 25 minutes (`SPEEDRUN_MINUTES`) : le premier remonte jusqu'au 1er mai 2026 en quelques mises à jour.

Face aux autres clans, le relevé lit les records de [TeamStats](https://teamstats.pro/), site partenaire, dans leur flux public `https://teamstats.pro/feed/team-speedruns.json` : une requête par mise à jour, pour une limite de 30 par minute. Ce flux donne un record par carte, taille et format (trio ou quads complet d'un clan, ou équipe de 5 joueurs et plus dont plus de la moitié d'un clan), depuis le début de leur saison. Le site affiche ceux de [FR] dans l'onglet « Records du monde détenus par [FR] », avec le chrono de TeamStats, qui part de la fin du placement, et met le badge « Record du monde » sur nos records de la même carte, taille et format. Sous nos autres records, il affiche le record du monde d'un autre clan à battre, son clan et l'écart.

Le relevé ouvre une fois chaque partie record (`/game/:id`), puis seulement les nouvelles : environ 550 parties la première fois, en moins d'une minute. Il y lit le format exact, que TeamStats regroupe en « team » au-delà de 4 joueurs, et la durée de la partie, pour comparer le record avec nos chronos. Il ne garde les joueurs que des records [FR], et seulement s'ils ne sont pas déjà dans notre record. Si le flux ne répond pas, les records TeamStats précédents restent.

Chaque record montre la vignette de sa carte, tirée des ressources d'OpenFront (`resources/maps/<carte>/thumbnail.webp`, une dizaine de Ko). Le relevé ne télécharge que les cartes qui lui manquent, et rafraîchit chaque vignette tous les 30 jours. Il les garde dans `data/maps`, dans le cache d'Actions avec le relevé, et la page ne charge que celles des lignes affichées.

`data/speedruns.json` garde les identifiants OpenFront des joueurs : il reste dans le cache d'Actions, pas dans le dépôt, et le site n'en publie que les pseudos publics de l'effectif. Si le relevé échoue, le site se construit avec le précédent.

## ELO FR en équipe

Le site calcule son propre classement des joueurs en équipe, l'**ELO FR en équipe** (appelé « cote » dans le code), d'après les victoires : avec qui et contre qui on gagne. Sur le site, un (i) à côté de son nom explique la méthode.

1. `scripts/fetch-team-games.mjs` relève toutes les parties publiques par équipes d'OpenFront depuis le 1er septembre 2026 (`COTE_FROM`), un jour fini à la fois, 3 heures après sa fin. Les jours manquants se relèvent du plus récent au plus ancien : la veille passe d'abord, puis le relevé remonte le passé avec le temps qui reste. Il ouvre chaque partie une fois (`/game/:id`), environ 2 500 par jour, et n'en garde qu'un résumé : l'équipe gagnante, les perdants, leurs clans, le moment où chacun est mort, s'il a agi, le format, le nombre d'équipes et la durée. L'API ne dit pas dans quelle équipe était chaque perdant. Les résumés vont dans `data/parties/AAAA-MM-JJ.json.gz`, dans le cache d'Actions : ils gardent les identifiants de tous les joueurs. Le relevé a commencé au 1er novembre, puis a été remonté au 1er octobre, puis au 1er septembre, en quelques mises à jour : 20 minutes de relevé par mise à jour (`COTE_MINUTES`), ou plus en lançant le workflow à la main avec `minutes`. Le calcul part du 1er du mois le plus ancien dont tous les jours sont relevés : pendant qu'un mois se remonte, le site garde la cote calculée sans lui.
2. `scripts/cote.mjs` recalcule toute la cote depuis ces résumés à chaque mise à jour, en quelques secondes : changer la formule ne demande pas de tout retélécharger. Il écrit `data/cote.json`, avec seulement les membres actuels du clan, leur rang mondial, leur cote à la fin de chaque jour et ce qu'ils ont gagné ou perdu au dernier jour relevé (`change`, aussi pour le top 100).

La formule est OpenSkill (Weng-Lin, modèle de Plackett-Luce), de la famille de TrueSkill. Chaque joueur a un niveau et une incertitude ; après chaque partie, l'équipe gagnante bat chacune des autres équipes, et la force d'une équipe est la somme de ses joueurs. Le relevé ne dit pas qui jouait avec qui chez les perdants : chacun est jugé avec sa propre force et des coéquipiers de la force moyenne des autres perdants (avant le 27 novembre 2026, tous les perdants comptaient comme une équipe moyenne, et un joueur fort ne perdait presque rien dans les grandes parties). Un gagnant mort en cours de partie ne reçoit que la part de la victoire correspondant à son temps en vie ; entre perdants, celui qui est encore en vie à la fin perd moins que celui éliminé tôt (bonus de survie `SURVIVAL` = 0,4, choisi sur les parties de novembre parce qu'il annonce le mieux si un joueur va gagner). Ne comptent que les parties d'au moins 2 minutes, à 10 joueurs par équipe au plus, ni spéciales (modificateurs) ni Humains contre Nations. Un joueur qui n'a rien fait (ni attaque, ni construction, ni bateau, ni bombe) est ignoré, et ne compte pas dans la force de son équipe.

La cote affichée est prudente : `1000 + 10 × (niveau − 3 × incertitude)`. Il faut 60 parties pour être classé. Le classement du clan ne garde que les membres classés qui jouent au moins la moitié de leurs parties par équipes sous le tag [FR] (`frShare`) ; les autres gardent leur ELO et leur rang mondial, et leur rang dans le clan est vide. Les paliers, calés sur la répartition des joueurs classés, sont : Grand maître 1 525+, Maître 1 350+, Diamant 1 225+, Platine 1 150+, Or 1 050+, Argent 975+, Bronze 925+, Fer en dessous (recalés le 27 novembre 2026, après la correction des perdants et le bonus de survie). Le site n'affiche la cote que des membres qui ont une fiche publique, et seulement quand le relevé est à jour (3 jours de retard au plus). La méthode est expliquée sur la page Membres. À côté de chaque ELO, le site montre ce qu'il a gagné (en vert) ou perdu (en rouge) à la dernière mise à jour, c'est-à-dire avec les parties du dernier jour relevé ; « = » en gris s'il n'a pas bougé.

Le build publie aussi `elo-fr.json`, lu par le bot du Discord pour sa carte de profil : l'ELO FR des membres qui ont une fiche publique (ELO, gain ou perte à la dernière mise à jour `change`, palier, rang mondial, rang dans le clan, parties, parties sous le tag [FR] `frGames`, victoires, lien de la fiche), rangé par fiche (les 8 premiers caractères du SHA-1 de l'identifiant OpenFront), sans aucun identifiant.

La page `#monde` montre le top 100 mondial. Les pseudos viennent d'OpenFront (`/player/:id`), lus une fois par semaine et gardés dans `data/parties/noms.json`. Un joueur qui s'est masqué de la recherche d'OpenFront y apparaît comme « Joueur masqué » (`hidden` dans le cache), un compte OpenFront qui n'a pas de pseudo comme « Sans pseudo », et un membre du clan sans fiche publique y reste anonyme.

## Classements de TeamStats

`scripts/fetch-elo.mjs` lit sur [TeamStats](https://teamstats.pro/), site partenaire, dans ses flux publics (120 requêtes par minute au plus ; le relevé en fait au plus 100) :

- `feed/team-elo.json?clan=FR` : le profil de jeu de chaque joueur qui porte le tag (attaque, territoire, soutien, économie, destruction, construction), chaque partie notée face à tous les joueurs suivis ;
- `feed/ffa-elo.json?clan=FR` : la note du FFA classé d'OpenFront ;
- `feed/player/<publicId>.json` : l'historique du FFA classé, pour la courbe.

La Team ELO de TeamStats n'est pas publiée : la cote la remplace. Le profil de jeu est affiché sur les fiches « pour le fun », sans être présenté comme un classement.

Les deux listes sont lues à chaque mise à jour. La fiche d'un joueur n'est relue que s'il a joué depuis la précédente : la première fois, environ 650 fiches en 7 minutes, ensuite quelques dizaines. Le relevé s'arrête au bout de 10 minutes (`ELO_MINUTES`) et reprend à la mise à jour suivante. `data/elo.json` garde les identifiants OpenFront : il reste dans le cache d'Actions, pas dans le dépôt. Si le relevé échoue, le site se construit avec le précédent.

La page Membres affiche les classements du clan en cote et en FFA classé. Chaque fiche affiche la cote, le FFA classé, leurs courbes et le profil de jeu ; les courbes sont dans `elo.json`, que la fiche ne charge qu'à son ouverture.

## Vie privée

Les données brutes ne sont pas conservées dans ce dépôt. Le site ne publie ni pseudo ni identifiant pour les membres sans pseudo public. Pour les profils marqués comme masqués, il ne publie ni l'identifiant ni la carrière.

## En local

```bash
node scripts/fetch-members.mjs
node scripts/fetch-profiles.mjs
node scripts/fetch-data.mjs
node scripts/build.mjs
```

Le site est alors dans `public/index.html`.

## Licence

- Le code du site est sous licence [GNU AGPL 3.0](LICENSE).
- Les icônes du jeu, les vignettes des cartes et la carte du monde en points viennent d'OpenFront, sous licence [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) : voir [assets/icons/LICENCE.md](assets/icons/LICENCE.md).
- Les polices Anton et Inter sont sous licence [SIL OFL 1.1](https://openfontlicense.org/) : voir [assets/fonts/LICENCE.md](assets/fonts/LICENCE.md).
- Le logo de TeamStats (`assets/partners/teamstats.png`) appartient à [TeamStats](https://teamstats.pro/), qui l'a fourni pour ce site. Il n'est pas sous la licence du dépôt.
