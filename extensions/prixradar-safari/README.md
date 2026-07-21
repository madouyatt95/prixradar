# Extension Safari PrixRadar

Cette WebExtension ouvre la fiche courante dans la file d’inspection PrixRadar.
Elle ne lit pas l’historique Safari, ne modifie pas la page, et n’effectue ni
commande ni paiement.

## Préparer l’application iPhone/iPad

Sur un Mac avec Xcode et un compte Apple Developer :

```bash
xcrun safari-web-extension-converter extensions/prixradar-safari \
  --project-location build/prixradar-safari-ios \
  --app-name PrixRadar \
  --bundle-identifier fr.prixradar.safari
```

Ouvrir ensuite le projet généré dans Xcode, choisir l’équipe de signature,
tester sur iPhone puis distribuer via TestFlight et l’App Store. La signature et
la publication Apple ne peuvent pas être automatisées sans le compte du
propriétaire.

Le manifeste PWA reste utile sur Android. Sur iPhone, cette extension constitue
le chemin fiable pour envoyer la page Safari vers PrixRadar.
