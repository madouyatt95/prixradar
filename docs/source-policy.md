# Politique de collecte PrixRadar

PrixRadar ne doit pas contourner une authentification, un CAPTCHA, une limitation
d’accès ou une mesure anti-bot. Le repli HTTP vers navigateur sert uniquement à
interpréter une page publique rendue en JavaScript. Un blocage répété suspend la
source depuis le centre de pilotage.

## Sources autorisées

- Amazon : `amazon.fr`, `amazon.de`, `amazon.it`, `amazon.es`, `amazon.co.uk`
- Boulanger : `boulanger.com`
- Darty : `darty.com`
- Cdiscount : `cdiscount.com`

Chaque page ajoutée doit être HTTPS, sans identifiants dans l’URL, et correspondre
à l’enseigne déclarée. Avant activation, l’administrateur vérifie les conditions
d’utilisation, `robots.txt`, la fréquence raisonnable et l’absence de données
personnelles. Les URL sont dédupliquées et la cadence est adaptée à la volatilité.

## Données et preuve

Seules les informations nécessaires à l’alerte sont conservées : identité produit,
prix, frais, vendeur, conditions promotionnelles, dates de lecture et preuves de
comparaison. Les historiques techniques et coûts ont une rétention de 90 jours,
les observations de prix de 180 jours. Les consentements analytics et affiliation
sont séparés, facultatifs et modifiables depuis l’application.

## Incident connecteur

Les erreurs 403, 429, CAPTCHA, `access denied` et `blocked` sont classées
`ANTI_BOT_BLOCKED`. Les connecteurs sont testés chaque jour sur des pages de
référence sans notification. Le centre de pilotage permet de suspendre une source
sans déploiement de code.
