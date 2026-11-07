# Front Français [FR]

Site du clan France [FR] sur [OpenFront](https://openfront.io/). Site de clan non officiel, sans lien avec les éditeurs du jeu.

## Fonctionnement

Le workflow `.github/workflows/site.yml` tourne deux fois par jour, à 12 heures d'écart : une mise à jour complète, puis une légère qui saute `fetch-profiles.mjs` et reprend les fiches de la complète, gardées dans le cache d'Actions. Un push lance aussi une mise à jour légère.

1. `scripts/fetch-members.mjs`, `fetch-profiles.mjs` et `fetch-data.mjs` téléchargent les données publiques d'OpenFront.
2. `scripts/build.mjs` les injecte dans `src/page.html` et produit le site.
3. `scripts/update-history.mjs` ajoute le point du jour à `data/history.json`.
4. Le site est déployé sur GitHub Pages.

Si le téléchargement échoue, le déploiement s'arrête et la dernière version reste en ligne.

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
