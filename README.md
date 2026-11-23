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
