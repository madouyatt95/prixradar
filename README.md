# PrixRadar

PWA mobile-first pour repérer, expliquer et suivre des anomalies de prix.

Cette première version sépare volontairement les fonctions réellement actives des
données de démonstration :

- **actif** : interface responsive, installation PWA, hors-ligne, suivi persistant
  par appareil dans D1, test de notification locale et vérification Amazon via
  Keepa lorsque la clé serveur est configurée ;
- **préparé** : UX des signaux, score explicable, vues Boulanger, Darty et
  Cdiscount ;
- **à déployer séparément** : collecteurs Crawlee, files BullMQ/Redis, accès aux
  flux partenaires et envoi programmé des notifications.

Les cartes visibles au démarrage portent un bandeau **DÉMO** : leurs prix sont des
exemples et ne doivent pas être utilisés pour acheter.

## Lancer l’application

Prérequis : Node.js `>=22.13.0`.

```bash
npm install
npm run dev
```

Puis ouvrir `http://localhost:3000`.

Commandes de contrôle :

```bash
npm run lint
npm test
npm run db:generate
```

## Connecter Keepa

La clé reste uniquement côté serveur. Copier `.env.example` vers `.env.local`,
puis renseigner :

```bash
KEEPA_API_KEY=votre_cle
```

La route `GET /api/keepa?asin=…&market=FR` interroge Keepa avec 90 jours
d’historique et renvoie des prix en unité mineure. Aucun faux résultat n’est servi
quand Keepa est absent ou indisponible.

Marchés pris en charge par Keepa dans l’application :

| Marché | Domaine Keepa | Devise |
| --- | ---: | --- |
| Amazon UK | 2 | GBP |
| Amazon DE | 3 | EUR |
| Amazon FR | 4 | EUR |
| Amazon IT | 8 | EUR |
| Amazon ES | 9 | EUR |

Amazon Belgique, Pays-Bas, Pologne, Suède et Irlande nécessitent un autre
fournisseur : ils ne sont pas aliasés vers un marché Keepa voisin.

## Watchlist D1

La base D1 est déclarée sous le binding `DB` dans `.openai/hosting.json`. La
migration générée se trouve dans `drizzle/0000_opposite_johnny_blaze.sql`.

La route `/api/watchlist` fournit GET, POST et DELETE. Elle attribue un identifiant
anonyme à l’appareil dans un cookie HttpOnly et conserve la liste côté serveur ;
`localStorage` n’est pas l’autorité de la donnée.

## Architecture de collecte cible

```text
Flux/API/JSON-LD  ─┐
HTTP Crawlee      ─┼─> normalisation produit/offre ─> détection statistique
Playwright repli  ─┘                                  │
                                                      v
                                     seconde vérification fraîche
                                                      │
                                                      v
                                       alerte + preuve + audit
```

Principes :

1. flux, API et données structurées avant le navigateur ;
2. un connecteur versionné par enseigne ;
3. prix total = prix + livraison, jamais le prix facial seul ;
4. produit, variante, vendeur, état et pays strictement normalisés ;
5. seconde lecture obligatoire avant notification ;
6. les erreurs de prix restent des **anomalies probables**, jamais une promesse
   d’honoration par le marchand.

Pour la production multi-enseignes, le collecteur doit vivre dans des workers
dédiés avec **Crawlee + Playwright + BullMQ/Redis**. La PWA reste le produit de
consultation, de suivi et d’alerte ; elle ne doit pas exécuter les crawls dans le
navigateur du téléphone.
