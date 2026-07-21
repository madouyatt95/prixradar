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

## Indice interne et panier fantôme

PrixRadar ne dépend d’aucun comparateur externe. Son indice de marché rapproche
uniquement des offres collectées par ses connecteurs, avec une empreinte de
variante suffisamment fiable. Le panier fantôme peut ajouter un article dans une
session technique isolée pour relire stock, frais et total ; il ne saisit aucune
donnée personnelle et ne clique jamais sur commander, payer ou confirmer.

Le scan EAN charge uniquement si nécessaire la version UMD épinglée
`@zxing/browser@0.2.1` depuis un CDN, afin de compenser l'absence de
`BarcodeDetector` activé par défaut sur iPhone. Ce composant analyse le flux
caméra localement : aucune image n'est envoyée à PrixRadar, ZXing ou au CDN.

Chaque page ajoutée doit être HTTPS, sans identifiants dans l’URL, et correspondre
à l’enseigne déclarée. Avant activation, l’administrateur vérifie les conditions
d’utilisation, `robots.txt`, la fréquence raisonnable et l’absence de données
personnelles. Les URL sont dédupliquées et la cadence est adaptée à la volatilité.
Les liens découverts alimentent une frontière persistante : priorité plus forte
après une anomalie, plus faible après des doublons ou un blocage, et coupe-circuit
immédiat si une protection anti-bot se déclenche.

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

Trois échecs consécutifs, ou deux blocages anti-bot, ouvrent automatiquement le
circuit. Le délai de refroidissement part de 30 minutes et augmente jusqu'à
24 heures. Une seule page sert ensuite de sonde ; la cadence normale ne reprend
qu'après son succès. Réarmer manuellement ne contourne jamais un CAPTCHA.

## Localisation et minimisation

Le calcul de disponibilité peut utiliser le pays, un préfixe postal court et le
mode de livraison. L'adresse complète n'est ni demandée ni conservée. Quand un
utilisateur exige une correspondance locale, toute offre non vérifiée pour sa
zone est exclue des notifications au lieu d'être supposée livrable.

## Référentiel produit

Une comparaison entre enseignes est automatique avec un GTIN valide. À défaut,
marque et modèle normalisés peuvent proposer un rapprochement, mais les cas
incertains restent en revue. Une décision « Séparer » crée une identité isolée :
un prix ne doit jamais être comparé à une variante ou un produit voisin.
