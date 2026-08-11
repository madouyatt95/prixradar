# Relais Facebook vers PrixRadar

Ce relais transforme les notifications officielles que Facebook envoie dans
Gmail en publications PrixRadar. Il ne se connecte pas au compte Facebook, ne
copie aucun cookie et ne lance aucun Actor public du Store Apify.

## Fonctionnement

1. Facebook envoie un e-mail pour une nouvelle publication des deux groupes
   suivis.
2. Google Apps Script vérifie les nouveaux e-mails toutes les cinq minutes,
   uniquement de 07:30 à 15:00, heure de Paris.
3. Seuls les liens de publication appartenant aux deux identifiants de groupe
   autorisés sont transmis à `/api/social/ingest`.
4. L'Actor personnel Creator démarre en mode `social-dispatch` et livre le Push
   PWA. Il ne scrape pas Facebook.

Les e-mails de plus de 45 minutes sont ignorés. Les identifiants de publication
et les livraisons Push sont dédupliqués côté PrixRadar.

## Installation unique

Créer un projet sur `script.google.com`, ajouter `Code.gs` et activer l'affichage
du fichier manifeste afin de remplacer `appsscript.json`. Dans **Paramètres du
projet > Propriétés du script**, créer les quatre propriétés suivantes sans les
écrire dans le code :

| Propriété | Valeur |
| --- | --- |
| `PRIXRADAR_BASE_URL` | `https://prixradar.madouyatt95.workers.dev` |
| `PRIXRADAR_INGEST_SECRET` | secret privé déjà installé côté Cloudflare |
| `APIFY_TOKEN` | token privé du compte Creator |
| `APIFY_ACTOR_ID` | identifiant de l'Actor personnel PrixRadar |

Exécuter ensuite `setupPrixRadarFacebookBridge`, accepter les autorisations
Gmail demandées, puis exécuter `testPrixRadarFacebookBridge`. La fonction de
test ne lit et ne publie aucun e-mail ; elle vérifie seulement PrixRadar, Apify
et la présence du déclencheur.

Pour une recette de bout en bout, activer **Toutes les publications** et les
notifications par e-mail sur les deux groupes Facebook, attendre un nouvel
e-mail réel, puis exécuter `relayFacebookEmailsNow` si le prochain passage n'a
pas encore eu lieu.

## Sécurité

- les secrets vivent dans les propriétés privées du script ;
- le token Apify est envoyé dans l'en-tête `Authorization`, jamais dans l'URL ;
- seuls les expéditeurs `facebookmail.com` et les deux groupes explicitement
  autorisés sont acceptés ;
- une erreur réseau laisse l'e-mail non traité pour permettre une nouvelle
  tentative ;
- aucune publication ancienne n'est importée en masse.
