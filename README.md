# PrixRadar v0.6.0

PWA mobile-first pour détecter, vérifier et suivre des anomalies de prix sans
présenter une remise comme une « erreur certaine ».

## État réel

| Bloc | État | Preuve / limite |
| --- | --- | --- |
| PWA installable, responsive et hors ligne | actif | manifeste, service worker, vues mobile/desktop |
| Watchlist et préférences | actif | D1, identité appareil signée HMAC |
| Moteur d’anomalies | actif | médiane/MAD, fraîcheur, variante, vendeur, livraison, seconde lecture |
| API alertes et état des sources | actif | données `live` strictes, aucune fixture publique par défaut |
| Keepa dans la PWA | prêt | cache D1 15 min et quota 20 appels/heure/appareil ; requiert une clé |
| Collecteur Boulanger/Darty/Cdiscount | prêt à déployer | JSON-LD, connecteurs, Crawlee HTTP, Playwright en repli |
| Amazon Europe | prêt à déployer | Keepa EU5 + historique borné + double contrôle de page avant notification |
| Web Push | prêt à activer | souscriptions, heures calmes, réservation atomique et audit ; requiert VAPID + collecteur |
| Automatisation Apify | prête, non appliquée | plan EU5 toutes les 15 min + enseignes FR toutes les 30 min, provisionnement idempotent |
| Graphe produit multi-enseignes | actif | GTIN validé, marque/modèle normalisés, file de rapprochements incertains |
| Livraison localisée | actif | pays, préfixe postal et mode de livraison ; aucune adresse complète conservée |
| Coupe-circuits connecteurs | actif | ouverture après incidents répétés, temporisation exponentielle, sonde de reprise |
| Découverte Amazon sous budget | actif | rotation EU5 par gamme de prix/catégorie, enveloppe et cadence par segment |
| Pilotage administrateur | actif côté code | JWT Cloudflare Access + liste blanche d'e-mails ; requiert la configuration Access |
| Envoi d'alertes | mode prudent | `shadow` par défaut : décisions auditées sans Push réel jusqu'à recette |
| Radars en langage naturel | actif | règles durables par appareil, appliquées au routage Push |
| Scan EAN | actif | Barcode Detector, puis ZXing 0.2.1 épinglé sur iPhone, avec saisie manuelle de repli |
| Vérification immédiate | actif | file prioritaire durable consommée par l'Actor, résultat conservé |
| Score « Acheter maintenant » | actif | décision séparée du score d'anomalie, cinq facteurs explicables |
| Intelligence autonome | actif | panier fantôme, empreinte variante, indice interne, origine, vendeur et durée probable |
| Partage PWA | actif | une URL marchande partagée déclenche une inspection prioritaire durable |
| Sentinelle autonome | actif | frontière d’URL dédupliquée, priorisée et rescannée à cadence adaptative |
| Notifications à trois vitesses | actif | instantané, équilibré, ou urgent + résumé quotidien à 18 h |
| Budget auto-adaptatif | actif | rendement par 1 000 produits, coût/alerte et pression anti-bot |
| Configuration Essentiel / Expert | actif | trois profils compréhensibles, puis seuils détaillés persistés par appareil |
| Transparence publique | actif | taux LIVE à échantillon minimal, indice de sincérité et méthode sur `/transparence` |
| Passeport de preuve | actif | dossier public par alerte LIVE ; le statut « certifié » n’apparaît que si tous les contrôles passent |
| Registre de couverture | actif | identités produit persistées par segment, pagination durable et déduplication inter-pages, estimation calibrée et tests de contrat ; sitemap/flux/API restent désactivés |
| Parcours iPhone Safari | prêt à signer | PWA plein écran + WebExtension minimale ; publication TestFlight/App Store requiert un compte Apple |

Les six cartes affichées quand aucune source n’est active portent **DÉMO**. Elles
ne sont jamais ingérées, notifiées ou présentées comme des prix disponibles.

## Garde-fous d’une alerte LIVE

Une notification exige simultanément :

1. une source `live` et une offre disponible ;
2. au moins cinq observations historiques indépendantes ;
3. un écart robuste à la médiane (MAD) et une baisse significative ;
4. le même produit et la même variante lors de deux lectures ;
5. un vendeur direct ou explicitement fiable ;
6. un produit neuf et un **prix total livraison comprise connu** ;
7. une observation et une vérification de moins de 120 minutes ;
8. une expiration de l’alerte au plus tard 120 minutes après l’observation.

Un frais de port inconnu reste `NULL` de bout en bout. Il n’est jamais transformé
en livraison gratuite. Keepa fournit le signal et au maximum 60 points historiques ;
une notification Amazon reste bloquée jusqu’à ce que la page marchande confirme
deux fois l’ASIN, le prix, le vendeur, l’état, le stock et le total livré.

## Lancer la PWA

Prérequis : Node.js `>=22.13.0`.

```bash
npm install
npm run dev
```

Puis ouvrir `http://localhost:3000`.

### Cibles de déploiement

- **Cloudflare/Sites est la production de référence.** Le build `vinext` reçoit
  le binding D1 `DB` et exécute les migrations persistantes.
- **Vercel reste un aperçu de l'interface.** Avec `VERCEL=1`, Next.js natif
  publie la PWA, mais les fonctions dépendantes de D1 échouent explicitement :
  ce déploiement ne doit pas être communiqué comme le service de production.

Contrôles complets :

```bash
npm run check
npm run db:generate
npm audit
# après publication
PRIXRADAR_SMOKE_URL=https://votre-url npm run smoke:production
```

La base D1 utilise le binding `DB` de `.openai/hosting.json`. Les migrations
Drizzle sont dans `drizzle/`. La migration `0005` ajoute l’intelligence autonome,
les inspections issues du partage PWA et la frontière de la sentinelle. La
migration `0006` ajoute les profils Essentiel/Expert et les mesures de couverture,
sans recréer ni vider les tables existantes. La migration `0007` ajoute le registre
durable des identités produit par segment afin que les paramètres de suivi et les
chevauchements entre catégories ne gonflent pas le taux de couverture.

## Configuration utilisateur

Le mode **Essentiel** expose d’abord les choix utiles à tout le monde : catégories,
budget, pays et l’un des trois profils suivants.

| Profil | Usage | Principaux garde-fous |
| --- | --- | --- |
| Fiable | priorité à la qualité | score 85, vendeur 85, panier confirmé, 10 points d’historique, fraîcheur 30 min |
| Équilibré | réglage recommandé | score 75, vendeur 70, panier confirmé, 5 points, fraîcheur 60 min |
| Rapide | recevoir davantage de signaux | score 65, vendeur 60, variante exacte, 3 points, fraîcheur 90 min |

Le volet **Expert** révèle ensuite les seuils individuels : remise et score,
vendeur, variante, confirmation panier, profondeur historique, fraîcheur,
fermeture automatique, mode de livraison, localisation, cadence des notifications
et heures calmes. Les réglages sont persistés dans D1 et réappliqués au routage
Push, pas seulement à l’affichage.

## Variables serveur de la PWA

Copier `.env.example` vers `.env.local` pour le développement. Ne jamais utiliser
le préfixe `NEXT_PUBLIC_` pour ces valeurs.

| Variable | Rôle |
| --- | --- |
| `DEVICE_COOKIE_SECRET` | signe le cookie appareil ; obligatoire en HTTPS |
| `KEEPA_API_KEY` | recherche et historique Amazon Keepa |
| `INGEST_SECRET` | écriture des observations et statuts de source |
| `PUSH_DELIVERY_SECRET` | lecture des cibles et audit Push, distinct du précédent |
| `VAPID_PUBLIC_KEY` | souscription Web Push dans la PWA |
| `VAPID_PRIVATE_KEY` | signature des Push côté collecteur |
| `CF_ACCESS_TEAM_DOMAIN` / `CF_ACCESS_AUD` | validation cryptographique de l'identité Cloudflare Access |
| `ADMIN_EMAILS` | seconde liste blanche des administrateurs autorisés |
| `ALERT_DELIVERY_MODE` | `shadow` par défaut, `live` seulement après recette |

La route `/api/health` n’expose que des booléens de capacité, jamais les secrets.

## Service de collecte

Le service autonome est dans `services/collector`. Il privilégie HTTP + JSON-LD,
utilise les sélecteurs par enseigne en repli, puis Playwright uniquement si le
repli navigateur est activé.

```bash
cd services/collector
npm install
npm run check
npm run build
npm run scan-source -- https://www.boulanger.com/ref/123 --fixture
npm run scan-keepa -- FR,DE,IT,ES,GB --limit=25 --fixture
```

Le mode `fixture` est bloqué à trois niveaux : sink, ingestion et Push. Le service
comprend BullMQ/Redis, Docker Compose et un packaging Apify Actor. Voir
`services/collector/README.md` pour le déploiement.

La PWA peut être publique sans exposer le pilotage : seules les routes
`/api/admin/*` sont placées derrière Cloudflare Access. Le collecteur s'authentifie
sur ses routes privées avec `INGEST_SECRET` et `PUSH_DELIVERY_SECRET` ; aucune
connexion ChatGPT et aucun jeton de navigateur ne sont requis.

Le plan d’activation complet, y compris les variables, les contrôles de coût et
le passage en accès public sans connexion ChatGPT, se trouve dans
[`docs/activation-checklist.md`](docs/activation-checklist.md).

## API principale

- `POST /api/ingest` : enveloppe idempotente `alert_upsert` ou `source_status` ;
- `GET /api/alerts` : alertes LIVE, vérifiées, fraîches et non expirées ;
- `GET /api/sources` : santé réelle calculée depuis le dernier succès ;
- `GET|POST|DELETE /api/watchlist` : suivis par appareil signé ;
- `GET|PUT /api/preferences` : profil Essentiel/Expert, presets, seuils de preuve, budget et heures calmes ;
- `GET|POST|DELETE /api/push` : souscriptions (cinq maximum par appareil) ;
- `GET /api/push/targets` : cibles autorisées, sans `ownerId` ;
- `POST /api/push/deliveries` : réservation/déduplication puis résultat d’envoi ;
- `GET /api/keepa` : snapshot historique mis en cache et limité par appareil.
- `GET|POST|DELETE /api/radars` : alertes en langage naturel, durables par appareil ;
- `GET|POST /api/recheck` : vérification prioritaire et état de son traitement ;
- `GET|POST /api/inspections` : URL partagée, file durable et résultat par appareil ;
- `POST /api/frontier` : nouvelles fiches découvertes par la sentinelle privée et rattachement dédupliqué au segment de couverture ;
- `GET /api/push/digests` : résumés quotidiens privés préparés pour le collecteur ;
- `GET|POST|PATCH /api/admin/sources` : couverture, budgets et réarmement des circuits ;
- `GET /api/admin/coverage` : couverture estimée, versions des adaptateurs et tests de contrat ;
- `GET|POST|PATCH /api/admin/discovery` : rotation Amazon EU5 sous budget ;
- `GET|PATCH /api/admin/products` : contrôle des rapprochements multi-enseignes.
- `GET /api/public/metrics?days=7|30` : fiabilité observée, sans taux publié sous le minimum requis ;
- `GET /api/integrity` : indice de cohérence des promotions face aux 30 jours antérieurs et au marché ;
- `GET /api/certified/:id` : preuve JSON publique d’une alerte LIVE ; `/certified/:id` en est la lecture humaine.

Le prototype Safari se trouve dans `extensions/prixradar-safari`. Il transmet
uniquement l’URL de l’onglet marchand courant vers le flux d’inspection de la
PWA. Il ne lit pas l’historique du navigateur et ne peut jamais aller jusqu’à la
commande ou au paiement. Voir son README pour la conversion Xcode et la signature.

Les API privées ne sont jamais mises en cache par le service worker. La rétention
est appliquée lors des rapports de source : observations 180 jours, événements et
audits 90 jours, alertes expirées 30 jours.

## Couverture et limites

« Détecter presque tout » n’est pas garanti : les pages changent, certaines
offres sont personnalisées, les stocks sont localisés et des protections anti-bot
existent. En production, il faut privilégier flux/API/affiliation et accords
marchands, respecter robots.txt et les conditions d’utilisation, puis maintenir
les connecteurs avec des tests de contrat.

Amazon Belgique, Pays-Bas, Pologne, Suède et Irlande ne sont pas aliasés vers un
autre pays : ce projet limite volontairement Keepa aux cinq domaines EU5 dont le
mapping est validé.

PrixRadar ne dépend d’aucune recherche manuelle sur un comparateur ou une
communauté. Son indice est construit uniquement avec les observations marchandes
qu’il a lui-même rapprochées et vérifiées. La page du vendeur reste l’autorité
finale, et le panier fantôme ne franchit jamais l’étape de paiement.
