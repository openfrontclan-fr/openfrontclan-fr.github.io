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
    ]
  }
}
```

`events` liste au plus 8 événements Discord programmés ou en cours : nom, début, fin (ou `null`) et lieu (ou `null`). L'accueil les affiche dans « Prochains événements » et masque de lui-même ceux qui sont finis, ou commencés depuis plus de 3 heures quand ils n'ont pas de fin.

`players` ne contient que les comptes liés avec `/lier` et non masqués ; `ranked` compte tous les membres classés, et `position` est la place dans ce classement complet. Le site garde le pseudo de l'effectif quand le joueur y est, et un membre anonyme dans l'effectif le reste. Avec `"profils": true` dans `client_payload`, la mise à jour retélécharge aussi les fiches des joueurs.

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
