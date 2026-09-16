# CDC — Bascule mesh ↔ SFU (§17-B concret)

> Design de l'orchestration qui fait passer un **vrai** canal vocal du mesh (P2P) à
> l'SFU **sans couper l'audio**. Complète le CDC principal (`NODYX_SFU_CDC.md` §4, §17).
> Le §17 du CDC principal décrit des offer/answer bruts : **obsolète**, l'implémentation
> réelle utilise mediasoup-client (transports + `voice:sfu_*` en style ack, cf `voiceSfu.ts`).
> Ce document fait foi pour la bascule.
>
> **Statut : DESIGN, en attente de validation Jonathan. Zéro ligne de code avant OK
> (voice.ts = sanctuaire).**

## 1. But & doctrine

- **Zéro coupure** : à aucun instant un participant ne perd l'audio d'un autre pendant la transition.
- **Additif & dormant** : quand le flag est OFF, `voice.ts` (mesh) se comporte **exactement** comme aujourd'hui, à la ligne près. Rollback = éteindre le flag.
- **Le mesh reste le défaut** pour les petits salons. L'SFU ne s'active qu'au-delà d'un seuil, là où le mesh peine.
- **Sanctuaire** : les modifs de `voice.ts` (back + front) sont chirurgicales, gardées par le flag, et testées. On ne touche au sanctuaire qu'avec cette validation.

## 2. Déclencheur

Un canal bascule mesh → SFU quand **toutes** ces conditions sont vraies :
- `VOICE_SFU_URL` défini (le daemon existe) **et** `VOICE_SFU_AUTO=true` (nouveau flag, OFF par défaut) ;
- **liste blanche** `VOICE_SFU_AUTO_CHANNELS` (IDs de canaux, séparés par des virgules) : le canal y figure — **ou** la liste est vide = tous les canaux. Permet d'activer sur **UN seul vrai canal** de test (décision rollout) sans toucher aux autres ;
- le nombre de participants (seats) du canal **atteint le seuil** `VOICE_SFU_MESH_THRESHOLD` = **6** (décidé : le mesh audio tient ~8-10, on bascule à 6 avec de la marge) ;
- (P2, plus tard) **ou** un partage d'écran démarre (le mesh plafonne à ~4 en vidéo).

**v1 : on reste en SFU une fois basculé** (pas de re-bascule SFU→mesh sous le seuil ; cf CDC §13). Simple et sûr.

## 3. Machine à états (par canal, côté serveur)

```
mesh  ──(seuil franchi)──►  switching  ──(tous prêts)──►  sfu
  ▲                             │
  └──────(échec / abandon)──────┘
```

Le serveur tient une map `channelMode: channelId → 'mesh' | 'switching' | 'sfu'` (défaut `mesh`).
Pendant `switching`, le mesh **reste entièrement debout**.

## 4. Le protocole overlap — le cœur (zéro coupure)

Le principe : **tout le monde s'entend via le mesh jusqu'à ce que tout le monde soit sur l'SFU, puis on bascule ensemble.** Le mesh n'est fermé qu'au tout dernier instant, coordonné par le serveur.

```
1. Serveur (seuil franchi) : channelMode = switching
   Serveur → room : voice:mode {sfu}          # "établissez l'SFU, MAIS gardez le mesh"

2. Chaque client, à voice:mode {sfu} :
   - GARDE son mesh actif (voice.ts inchangé : entend/émet toujours via P2P)
   - EN PARALLÈLE : établit l'SFU (voiceSfu.ts) : device.load, send+recv transports,
     produce(micro), consume(toutes les publications du salon)
   - NE JOUE PAS ENCORE l'audio SFU (sinon double son / écho)
   - quand son SFU produit ET consomme les autres → client → serveur : voice:sfu_ready

3. Serveur : collecte les voice:sfu_ready de TOUS les sockets du salon.
   Quand tous prêts (dans le délai T) :
   channelMode = sfu
   Serveur → room : voice:sfu_commit

4. Chaque client, à voice:sfu_commit :
   - bascule la lecture mesh → SFU (coupe/retire les <audio> mesh, active les <audio> SFU)
   - ferme ses PC mesh
   => le mesh jouait jusqu'à cet instant précis : AUCUN trou.
```

**Pourquoi la porte "tous prêts" est indispensable** : le mesh est N↔N. Si un client fermait son mesh dès que SON SFU est prêt, un pair encore en mesh (pas encore basculé) cesserait de l'entendre (le producer SFU du premier n'étant consommé par le retardataire qu'une fois basculé). En fermant le mesh **seulement quand tous sont sur l'SFU**, personne ne tombe dans un trou.

**Anti-double-son** : pendant `switching`, le client reçoit potentiellement l'audio d'un pair par le mesh **et** par l'SFU. Règle simple : **on ne joue que le mesh** jusqu'au `commit`, **puis** on joue l'SFU. Pas de lecture simultanée des deux → pas d'écho.

## 5. Arrivée tardive (salon déjà en SFU)

Trivial : à `voice:join`, si `channelMode == sfu`, le serveur renvoie `voice:mode {sfu}` dans le `voice:init` ; le client rejoint directement l'SFU (pas de mesh du tout). C'est déjà le chemin du labo actuel.

## 6. Échecs & départs pendant la transition

- **Un client se déconnecte pendant `switching`** : le serveur le retire du set attendu ; si les restants sont tous prêts → `commit`. Pas de blocage.
- **Un client n'atteint pas l'SFU dans le délai T** (pas d'UDP, firewall) : **DÉCIDÉ = abandon**. Le serveur repasse `channelMode = mesh` et → room : `voice:mode {mesh}` ; tout le monde reste/revient au mesh, le client garde son mesh (il ne l'a jamais lâché) → aucune dégradation. L'SFU utilise le même chemin réseau que le TURN (déjà validé pour la plupart), donc l'échec est rare. Coût nul au seuil : à 6-8 personnes le mesh audio marche parfaitement.
- **Anti-flapping** : après un abandon, le canal reste `mesh` et **ne re-tente pas** la bascule tant que la composition du salon n'a pas changé (join/leave). Évite la boucle abandon→retry.
- **Arrivée tardive qui n'atteint pas l'SFU** (salon déjà `sfu`) : cas résiduel rare (topologie étoile, pas de pont mesh) → message clair « impossible de rejoindre le vocal » à cet user. Assumé v1.
- **Timeout T** : **~8-10 s** (le temps d'établir device+transports+produce+consume, cf voiceSfu.ts).

## 7. Points de contact sanctuaire (chirurgical, additif, flag-gardé)

Quand `VOICE_SFU_AUTO` est OFF : **aucun** de ces chemins ne s'exécute → mesh strictement identique à aujourd'hui.

- **`nodyx-core/src/socket/voice.ts`** (backend mesh) :
  - map `channelMode` + set des `sfu_ready` par canal ;
  - dans `voice:join`/`voice:leave` : recompter les seats, franchir le seuil → passer `switching` + `voice:mode {sfu}` ; en `sfu`, envoyer le mode au tardif ;
  - nouveaux handlers `voice:sfu_ready` (compter, gater le commit) ;
  - émettre `voice:sfu_commit` / abandon `voice:mode {mesh}` ;
  - au départ/déco : nettoyer le set, ré-évaluer.
  - **Additif** : les handlers mesh existants (`offer/answer/ice/leave/kick`) ne changent pas.
- **`nodyx-core/src/socket/voiceSfu.ts`** (relais SFU, déjà là) : réutilisé tel quel (join/produce/consume/publications). Éventuellement la coordination ready/commit vit ici plutôt que dans voice.ts pour garder voice.ts au minimum.
- **`nodyx-frontend/src/lib/voice.ts`** (client mesh) : à `voice:mode {sfu}` → **ne pas fermer le mesh**, déclencher l'établissement SFU (appel dans voiceSfu.ts) ; à `voice:sfu_commit` → basculer la lecture + fermer les PC mesh ; à `voice:mode {mesh}` (abandon) → annuler l'SFU, rester mesh. **Le point le plus délicat** : garder tout ça derrière un mode, mesh inchangé si flag off.
- **`nodyx-frontend/src/lib/voiceSfu.ts`** (client SFU) : exposer un mode "établir sans jouer, puis activer au commit" (produce+consume mais lecture retenue jusqu'au commit).

## 8. Déploiement & test

- Flag `VOICE_SFU_AUTO` **OFF** partout au départ. Le labo `/admin/sfu-lab` reste pour le test manuel.
- Activation progressive : un seul canal / **sleemstudio d'abord**, puis élargir.
- Rollback instantané = flag OFF (retour mesh pur).
- Tests Vitest : la logique de seuil + porte "tous prêts" + abandon, côté serveur (mockable) ; le client testé en labo à plusieurs.

## 9. Décisions — TRANCHÉES (Jonathan, 2026-07-08)

- **(a) Échec d'un client à joindre l'SFU → ABANDON → mesh.** Zéro dégradation, coût nul au seuil, échec rare. (+ anti-flapping, cf §6.)
- **(b) Porte "tous prêts" serveur → OUI** (garantit le zéro-coupure ; la bascule par-client indépendante rouvrirait le trou mesh N↔N du §4).
- **(c) Seuil = 6.** (Mesh audio confortable jusqu'à ~8-10 ; marge.)
- **(d) Re-bascule SFU→mesh sous le seuil → NON en v1** (on reste SFU).
- **(e) Rollout → UN canal réel de nodyx.org**, via la liste blanche `VOICE_SFU_AUTO_CHANNELS` (§2). Les autres canaux restent mesh pur.
- **(f) Timeout T = ~8-10 s.**

## 10. Ce que ça N'EST PAS (portée v1)

- Pas de re-bascule descendante (§9-d).
- Pas de topologie mixte mesh+SFU simultanée (§9-a : on est tout-mesh ou tout-SFU).
- Pas de partage d'écran SFU (P2, séparé).
- Pas de fédération inter-instances (P4).
