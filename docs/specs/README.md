# Specs internes

Ces documents sont des cahiers des charges de travail, écrits en français au fil du
développement, pas des pages publiées. Si vous cherchez la documentation officielle
d'une fonctionnalité, elle vit sur **[nodyx.dev](https://nodyx.dev)**, ou dans
`docs/en/specs/` pour les specs numérotées qui ont une version publique (002 à 013
au 18/09/2026).

## Pourquoi deux dossiers qui se ressemblent

- **`docs/specs/` (ici)** : le brouillon de travail. Écrit avant ou pendant le code,
  parfois révisé après coup avec un rapport de phase (`PHASE_0_REPORT.md`,
  `sessions/`), jamais retravaillé pour un lecteur externe. Le nommage dérive au fil
  du temps (`SPEC.MD`, `SPEC.md`, `016-OctoGuard.md`) parce que personne ne
  retouche ces fichiers une fois la fonctionnalité livrée.
- **`docs/en/specs/`** : la version publiée, en anglais, intégrée à la navigation
  de nodyx.dev. Volontairement plus courte, écrite pour quelqu'un qui découvre la
  fonctionnalité plutôt que pour quelqu'un qui va l'implémenter.

Une spec ici n'a pas vocation à obtenir automatiquement son équivalent publié : les
specs 014 à 017 (sauvegarde, Streamer Hub, OctoGuard, config admin) n'en ont pas
encore, certaines par manque de temps, d'autres parce que la fonctionnalité a déjà
sa propre page dédiée ailleurs (`docs/en/STREAMER-HUB.md`,
`docs/en/OCTOGUARD.md`).

## Si vous contribuez au code

Lisez la spec correspondante ici avant de toucher à une fonctionnalité listée.
C'est le document qui explique le pourquoi des décisions, pas seulement le quoi.
