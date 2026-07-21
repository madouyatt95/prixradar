# PrixRadar — checklist d’activation

Tout ce qui ne dépend pas d’un compte payant est déjà préparé. Cette checklist
commence au moment où les accès Keepa et Apify existent. Aucun ordinateur ne
devra rester allumé : la PWA et ses API tournent sur l’hébergement Cloudflare du
Site, tandis qu’Apify exécute le collecteur planifié.

## 1. Préparer les secrets une seule fois

Générer trois secrets indépendants et les clés Web Push :

```bash
openssl rand -base64 32
openssl rand -base64 32
openssl rand -base64 32
cd services/collector
npx web-push generate-vapid-keys
```

Les trois valeurs aléatoires servent respectivement à `DEVICE_COOKIE_SECRET`,
`INGEST_SECRET` et `PUSH_DELIVERY_SECRET`. Elles ne doivent jamais être copiées
dans Git, dans une capture d’écran ou dans une variable `NEXT_PUBLIC_*`.

## 2. Raccorder la PWA hébergée

Ajouter aux variables serveur du Site :

- `DEVICE_COOKIE_SECRET`
- `INGEST_SECRET`
- `PUSH_DELIVERY_SECRET`
- `VAPID_PUBLIC_KEY`
- `VAPID_PRIVATE_KEY`
- `VAPID_SUBJECT`, par exemple `mailto:alertes@votre-domaine.fr`
- `NEXT_PUBLIC_SITE_URL`, avec l’URL publique finale
- `KEEPA_API_KEY`, après souscription Keepa

Après redéploiement, `/api/health` doit répondre sans révéler les valeurs et
afficher les capacités correspondantes à `true`.

## 3. Publier le collecteur Apify

Depuis `services/collector` :

```bash
npm install
npm run check
apify push
```

Relever ensuite l’identifiant de l’Actor. Dans les variables secrètes de
l’Actor, ajouter :

- `KEEPA_API_KEY`
- `PRICE_RADAR_BASE_URL`
- `INGEST_SECRET`
- `PUSH_DELIVERY_SECRET`
- `VAPID_SUBJECT`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`
- `OAI_SITES_AUTH_TOKEN` uniquement tant que le Site reste privé
- `ENABLE_BROWSER_FALLBACK=true`

Ne pas ajouter `APIFY_TOKEN` à l’Actor : il sert seulement à créer les plannings
depuis un poste d’administration.

## 4. Choisir les pages de départ françaises

`PRIXRADAR_RETAIL_URLS` reçoit une liste séparée par des virgules ou des retours
à la ligne. Utiliser des pages catégorie/recherche stables de Boulanger, Darty et
Cdiscount, jamais des domaines non autorisés. Le collecteur découvre les fiches
produit, puis effectue deux lectures avant ingestion.

Commencer avec une page par enseigne. Élargir ensuite selon la consommation
réelle et la stabilité des connecteurs ; plus d’URL ne signifie pas
automatiquement une meilleure couverture si les pages se recouvrent.

## 5. Simuler puis créer les plannings

Sur le poste d’administration :

```bash
export APIFY_ACTOR_ID="votre-compte/prixradar-collector"
export PRIXRADAR_RETAIL_URLS="https://...,..."
npm run plan
```

Le plan doit montrer :

- Amazon EU5 dans une seule exécution toutes les 15 minutes ;
- 15 candidats Keepa maximum par marché ;
- 5 contrôles de page Amazon maximum par marché ;
- les enseignes françaises regroupées toutes les 30 minutes ;
- 1 024 Mo et 15 minutes maximum par exécution ;
- notification e-mail activée en cas d’échec de planning.

Après contrôle seulement :

```bash
export APIFY_TOKEN="votre-token"
npm run provision
```

La commande est idempotente : une nouvelle exécution met à jour les plannings
PrixRadar existants au lieu de les dupliquer.

## 6. Garde-fous de budget et validation

Dans Apify, activer les alertes de consommation et le plafond disponible sur le
compte avant d’activer de nouvelles pages ou un proxy payant. Aucun proxy payant
n’est prévu dans la configuration initiale. Contrôler les premières 24 heures,
puis une semaine, avant d’augmenter `limit` ou le nombre de pages.

Le parcours de recette est :

1. lancer un Actor avec `notify=false` et vérifier son dataset ;
2. constater les cinq statuts Amazon dans la vue Sources ;
3. contrôler qu’un frais de port inconnu bloque la notification ;
4. activer les notifications sur un téléphone de test ;
5. lancer avec `notify=true` ;
6. vérifier l’audit de livraison Push et l’absence de doublons ;
7. rendre finalement le Site public pour supprimer la connexion ChatGPT, puis
   retirer `OAI_SITES_AUTH_TOKEN` du collecteur si elle n’est plus nécessaire.

Une « erreur de prix » reste un signal probabiliste : la PWA doit conserver le
libellé de confiance et le conseil de vérification avant achat.
