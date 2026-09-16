# CDC : Cloisonnement de l'identité Nodyx Signet par instance

## Contexte

Audit sécurité du 15/09 (revue multi-agents, casquette "Palantir" au sens de
Palantir Technologies : corrélation de données à grande échelle, pas exploitation
d'un bug isolé). Deux failles de prise de compte ont été trouvées et corrigées
dans `nodyx-core/src/routes/authenticator.ts` (PR #717). Ce CDC traite le
troisième constat, structurel, qui reste vrai même une fois ces deux failles
fermées : **le modèle d'identité Signet ne cloisonne pas par instance**, ce qui
contredit la promesse de Nodyx (vie privée, zéro surveillance, décentralisation
réelle, cf `project_vision_fondatrice`).

Décision de Jonathan (15/09) : "On durcit. Nous ne sommes pas des moutons. Nodyx
est un droit HUMAIN." Priorité confirmée sur ce chantier.

## Le problème, vérifié dans le code réel (pas supposé)

Contrairement à l'hypothèse initiale de l'agent d'audit, le modèle de données
**supporte déjà** des identités séparées par instance : `DeviceRecord` a un champ
`hubUrl`, et `routes/setup/+page.svelte` génère bien un `deviceId` ET une paire
de clés **fraîche à chaque exécution** (`generateDeviceId()` + `generateKeyPair()`
à chaque passage par `/setup`).

Le vrai trou est dans le flow de connexion, `nodyx-authenticator/src/routes/connect/+page.svelte` :

```ts
devices = await getAllDevices()      // TOUS les appareils, toutes instances confondues
selectedDevice = devices[0]          // le premier, sans filtrer sur instanceUrl
```

Et `approve()` envoie toujours `selectedDevice.id` + `selectedDevice.publicKey`
vers `${instanceUrl}/auth/signet-complete`, qui appelle **toujours**
`POST /api/auth/challenges/approve-cross` côté `nodyx-core`
(`nodyx-frontend/src/routes/auth/signet-complete/+server.ts:40`), jamais le
flow "normal" par `device_token`.

Conséquence concrète : un utilisateur qui a déjà un appareil Signet et clique
"se connecter" sur une **nouvelle** instance (jamais visitée) envoie son identité
existante (celle créée pour la première instance) vers cette nouvelle instance.
`approve-cross` ne la reconnaît pas, donc auto-création de compte avec cette
même identité. Résultat : **le chemin sans effort (cliquer "connecter") réutilise
l'identité partout, alors que le chemin cloisonné (relancer `/setup` pour
chaque nouvelle instance) existe mais n'est jamais emprunté en pratique.**
Le système récompense la réutilisation, pas le cloisonnement.

Un opérateur d'instance malveillant (ou tout tiers qui recoupe les logs de
plusieurs instances) voit donc le même `deviceId` et la même clé publique
ECDSA (infalsifiable) se connecter sous des pseudos différents sur des
communautés différentes : corrélation cross-instance triviale, alors que
l'utilisateur croyait cloisonner ses identités.

## Ce qu'on protège, et ce qu'on ne protège pas

- **Protégé par ce chantier** : la corrélation *entre* instances par un tiers
  qui n'a accès à aucune des deux bases (recoupement de logs, d'annuaire, ou
  simple moisson du `deviceId` en tant qu'opérateur d'une instance tierce).
- **Hors périmètre, par construction** : un opérateur d'instance voit toujours
  tout ce que SES PROPRES utilisateurs font sur SA instance (c'est le modèle
  "une instance = une communauté" de Nodyx, pas un défaut à corriger ici).
- **Hors périmètre** : la corrélation par comportement/style d'écriture, IP
  partagée, etc., des attaques de désanonymisation qui existent sur toute
  plateforme et ne sont pas spécifiques au design de Signet.

## Options envisagées

### Option A : filtrer `connect` par `hubUrl`, sans changer la crypto
Le correctif minimal du bug réel trouvé ci-dessus : `connect/+page.svelte`
doit chercher un `DeviceRecord` dont `hubUrl === instanceUrl` plutôt que
`devices[0]`. Si aucun ne correspond, écran "Aucune identité pour cette
instance", avec un choix explicite et informé pour l'utilisateur :
- **soit** créer une identité dédiée à cette instance (relance `/setup`,
  déjà génère du frais aujourd'hui),
- **soit**, s'il le veut vraiment, choisir consciemment de réutiliser une
  identité existante (cas d'usage légitime : il veut que deux instances
  sachent que c'est la même personne, par exemple deux communautés qu'il
  gère lui-même), mais plus jamais un défaut silencieux.

Coût : petit (un flow de sélection revu, pas de nouvelle primitive crypto).
Ferme le bug comportemental. Ne change rien à la génération de clé
(`crypto.subtle.generateKey`, aléatoire, best practice actuelle).

### Option B : dérivation déterministe par instance (HKDF)
Une seule "graine maître" par appareil physique (générée une fois, sauvegardée
via la passphrase existante). Pour chaque instance, dériver un `deviceId` ET
une paire de clés ECDSA P-256 **déterministes** : `HKDF(graine, origine de
l'instance)`, réduit modulo l'ordre de la courbe P-256 pour obtenir un scalaire
privé, puis le point public correspondant. Zéro effort utilisateur, zéro
décision à prendre : une seule passphrase à retenir, et chaque instance obtient
automatiquement une identité non corrélable aux autres, pour toujours.

Coût réel, à ne pas sous-estimer :
- WebCrypto ne permet pas nativement de dériver une clé ECDSA depuis un secret.
  Il faut soit une lib de courbes (`@noble/curves`, pure JS, auditée, déjà
  utilisée par des wallets crypto pour exactement ce type de dérivation
  HD-wallet), soit implémenter la réduction modulaire à la main (déconseillé,
  trop de pièges de sécurité pour une réimplémentation maison).
- Compromis de sécurité explicite à trancher : aujourd'hui, la compromission
  d'une clé privée (un appareil volé et une passphrase cassée) ne touche QUE
  l'instance concernée. Avec une graine maître, la compromission de la GRAINE
  compromet TOUTES les instances déjà connectées d'un coup. C'est le compromis
  classique HD-wallet (BIP32) : confort de sauvegarde contre rayon d'explosion
  en cas de fuite de la graine.
- Migration : les `DeviceRecord` déjà enregistrés (clés aléatoires historiques)
  doivent continuer à fonctionner tels quels, pas de rupture pour les
  utilisateurs existants. La dérivation ne s'applique qu'aux NOUVELLES
  connexions à de NOUVELLES instances.

Coût : plus grand (nouvelle dépendance crypto vettée, tests dédiés, CDC de
sécurité propre à la primitive de dérivation avant tout code, cf
`feedback_session_cdc_modules_critiques`).

## Recommandation

**Faire A maintenant** (ferme le vrai bug comportemental trouvé, risque quasi
nul, aucune nouvelle primitive crypto) et **cadrer B comme un chantier séparé**,
si Jonathan veut vraiment la garantie structurelle "toujours cloisonné, zéro
mémoire utilisateur requise" plutôt que "cloisonné par défaut, réutilisation
possible sur choix explicite".

## Question ouverte pour Jonathan

Est-ce que A suffit pour l'ambition affichée ("Nodyx doit devenir la référence
en sécurité"), ou est-ce que B (dérivation déterministe, plus lourd, plus fort)
est la cible à viser directement ? Dans les deux cas, le point de départ commun
est A : sans lui, même un futur B ne serait pas exploité correctement puisque
c'est `connect/+page.svelte` qui décide aujourd'hui, à tort, "n'importe quel
appareil convient pour n'importe quelle instance".

## Vérification de fin de chantier (pour A)

- `connect/+page.svelte` : plus aucun `devices[0]` implicite, sélection par
  `hubUrl` explicite, écran dédié si aucune correspondance.
- Test (Vitest, à vérifier si `nodyx-authenticator` a déjà une suite de tests,
  sinon la poser à cette occasion) : deux `DeviceRecord` avec des `hubUrl`
  différents, connexion vers l'instance B ne doit JAMAIS proposer par défaut
  le device créé pour l'instance A.
- Vérification manuelle : scénario complet, deux instances de test, un seul
  appareil Signet, confirmer qu'une identité distincte est proposée par
  instance dès qu'on suit le nouveau flow.
