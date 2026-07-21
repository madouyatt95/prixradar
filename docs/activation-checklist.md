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
- `ADMIN_EMAILS`, avec les adresses autorisées à piloter les sources
- `CF_ACCESS_TEAM_DOMAIN`, par exemple `votre-equipe.cloudflareaccess.com`
- `CF_ACCESS_AUD`, l'audience de l'application Cloudflare Access
- `ALERT_DELIVERY_MODE=shadow` pendant la recette

Après redéploiement, `/api/health` doit répondre sans révéler les valeurs et
afficher les capacités correspondantes à `true`.

Dans Cloudflare Zero Trust, créer une application Access **Self-hosted** sur
`https://votre-domaine/api/admin/*`, autoriser seulement les e-mails voulus et
reporter son `AUD` dans `CF_ACCESS_AUD`. `ADMIN_EMAILS` constitue une seconde
barrière côté application. Le radar reste public et ne demande donc aucune
connexion ChatGPT ; seul l'onglet Pilotage déclenche l'accès Cloudflare.

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
- `ENABLE_BROWSER_FALLBACK=true`

Ne pas ajouter `APIFY_TOKEN` à l’Actor : il sert seulement à créer les plannings
depuis un poste d’administration.

## 4. Choisir les pages de départ françaises

Les pages se gèrent désormais dans l’onglet **Pilotage**. `PRIXRADAR_RETAIL_URLS`
reste un amorçage facultatif pour le premier déploiement. Utiliser des pages
catégorie/recherche stables de Boulanger, Darty et Cdiscount, jamais des domaines
non autorisés. Le collecteur récupère automatiquement le plan dû, découvre les
fiches produit, puis effectue deux lectures avant ingestion.

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
- les segments Keepa EU5 récupérés depuis le pilotage, chacun avec un budget ;
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

1. conserver `ALERT_DELIVERY_MODE=shadow`, lancer un Actor et vérifier son dataset ;
2. constater les cinq statuts Amazon dans la vue Sources ;
3. initialiser la rotation EU5 et vérifier les budgets consommés ;
4. contrôler qu’un frais de port inconnu ou une zone non vérifiée bloque la notification ;
5. confirmer les rapprochements de produits incertains ;
6. activer les notifications sur un téléphone de test ;
7. mesurer pendant au moins sept jours les faux positifs et les alertes expirées ;
8. passer `ALERT_DELIVERY_MODE=live`, redéployer, puis vérifier une livraison réelle ;
9. lancer le contrôle public :

```bash
PRIXRADAR_SMOKE_URL=https://votre-url npm run smoke:production
```

Si le smoke test n'identifie pas `cloudflare-d1`, le lien testé est un aperçu
Vercel ou un déploiement incomplet, pas la production PrixRadar.

Une « erreur de prix » reste un signal probabiliste : la PWA doit conserver le
libellé de confiance et le conseil de vérification avant achat.
