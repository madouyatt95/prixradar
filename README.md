# PrixRadar

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
| Amazon Europe | prêt à déployer | Keepa EU5 : FR, DE, IT, ES et GB |
| Web Push | prêt à activer | souscriptions, heures calmes, réservation atomique et audit ; requiert VAPID + collecteur |

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
en livraison gratuite. Avec Keepa seul, Amazon fournit l’historique et le signal,
mais une alerte Push reste bloquée tant que le total livré n’est pas confirmé.

## Lancer la PWA

Prérequis : Node.js `>=22.13.0`.

```bash
npm install
npm run dev
```

Puis ouvrir `http://localhost:3000`.

Contrôles complets :

```bash
npm run check
npm run db:generate
npm audit
```

La base D1 utilise le binding `DB` de `.openai/hosting.json`. Les migrations
Drizzle sont dans `drizzle/` ; `0000` conserve la watchlist initiale et `0001`
ajoute alertes, observations, sources, cache/quota Keepa et notifications.

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

Le Site étant privé, le collecteur doit aussi envoyer :

```text
OAI-Sites-Authorization: Bearer <OAI_SITES_AUTH_TOKEN>
```

en plus du secret métier de la route appelée.

## API principale

- `POST /api/ingest` : enveloppe idempotente `alert_upsert` ou `source_status` ;
- `GET /api/alerts` : alertes LIVE, vérifiées, fraîches et non expirées ;
- `GET /api/sources` : santé réelle calculée depuis le dernier succès ;
- `GET|POST|DELETE /api/watchlist` : suivis par appareil signé ;
- `GET|PUT /api/preferences` : score minimal et heures calmes ;
- `GET|POST|DELETE /api/push` : souscriptions (cinq maximum par appareil) ;
- `GET /api/push/targets` : cibles autorisées, sans `ownerId` ;
- `POST /api/push/deliveries` : réservation/déduplication puis résultat d’envoi ;
- `GET /api/keepa` : snapshot historique mis en cache et limité par appareil.

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
