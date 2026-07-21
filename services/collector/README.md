# PrixRadar Collector

Service Node.js 22 autonome. Il collecte uniquement des hôtes explicitement
autorisés, privilégie HTTP + JSON-LD, puis utilise Playwright seulement lorsque
le repli est activé. Une offre doit être identique pendant deux lectures avant
d'être envoyée à PrixRadar.

## Installation et contrôles

```bash
cd services/collector
npm install
npm run check
npm run build
```

Le service et ses tests démarrent sans secret. Les commandes externes signalent
clairement une configuration absente et ne substituent aucune donnée de démo.

```bash
npm run scan-source -- https://www.boulanger.com/ref/123
npm run scan-source -- https://www.darty.com/nav/achat/...html --browser
npm run scan-keepa -- FR,DE --limit=25
npm run worker
```

Copier `.env.example` vers `.env`, puis charger les variables avec le mécanisme
du déploiement ou `node --env-file=.env ...`. Ne jamais exposer ces variables à
la PWA.

## Contrats privés PrixRadar

Toutes les requêtes utilisent `Authorization: Bearer ...`. Lorsque le Site est
privé, `OAI_SITES_AUTH_TOKEN` ajoute aussi :

```text
OAI-Sites-Authorization: Bearer <token>
```

- `POST /api/ingest` utilise exclusivement `INGEST_SECRET`, transmet
  `Idempotency-Key` et une `VerifiedObservation` versionnée.
- `GET /api/push/targets?score=…&after=…&limit=…` utilise exclusivement
  `PUSH_DELIVERY_SECRET`. La réponse paginée attendue contient
  `{ "ok": true, "targets": [{ "id", "endpoint", "keys", "contentEncoding", "minScore" }], "nextAfter": … }`.
- `POST /api/push/deliveries` réserve avec
  `{ "action":"reserve", "alertId", "subscriptionId" }`, puis complète avec
  `{ "action":"complete", "reservationId", "status":"sent|failed", "errorCode?" }`.

`INGEST_SECRET` et `PUSH_DELIVERY_SECRET` doivent être différents. Les réponses
d'erreur, journaux structurés et sorties CLI n'incluent jamais les clés.

## Files et débit

BullMQ déduplique les scans, place les vérifications en priorité haute, applique
3 à 5 tentatives avec backoff exponentiel et limite un worker à 20 tâches par
minute. Lancer Redis seul ou avec le worker :

```bash
docker compose up redis
docker compose --profile worker up --build
```

## Keepa EU5

`scan-keepa` appelle `/deal` pour découvrir les baisses puis `/product` pour
obtenir le produit et les statistiques 90 jours. Les marchés sont GB=2, DE=3,
FR=4, IT=8 et ES=9. Le client suit `tokensLeft`, `refillIn` et `refillRate`, attend
un refill court et diffère les attentes supérieures à la limite configurée. La
clé Keepa ne figure jamais dans une URL journalisée.

## Apify Actor

Le packaging `.actor/` accepte `source`, `market`, `urls` et `mode`. Depuis ce
dossier, `apify push` utilise le Dockerfile du collecteur. Le mode `fixture`
marque chaque résultat et refuse explicitement `notify=true`; les deux couches
sink et push refusent aussi toute fixture.

## Limites réelles

- les sélecteurs marchands sont des replis après JSON-LD et devront être suivis
  lorsque les sites changent ;
- aucun crawler ne garantit le passage de toutes les protections anti-bot ;
- Amazon Belgique, Pays-Bas, Pologne, Suède et Irlande ne sont pas inventés ou
  aliasés : ce client Keepa ne couvre que les cinq domaines déclarés ;
- une anomalie est un signal probabiliste, pas une garantie que le marchand
  honorera la commande ;
- les conditions d'utilisation, robots.txt, fréquences raisonnables et accords
  partenaires restent à appliquer par source en production.
