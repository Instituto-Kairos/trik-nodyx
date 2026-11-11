-- trik_023_levelup_reqs_narrator_tags.sql
--
-- 1) Requisitos extras pro level up de personagem (type 'character' em
--    trik_progression). Igual a goal_xp, valem pra SAIR do nível da linha:
--      req_weapon_level    — nível mínimo em QUALQUER arma (#treino). 0 = sem requisito.
--      req_knowledge_id    — matéria (#aula) específica exigida. NULL = sem requisito.
--      req_knowledge_level — nível mínimo nessa matéria (só vale com req_knowledge_id).
--    Faltando requisito, o xp represa em progress_xp (mesma regra do nível
--    máximo) e o personagem sobe assim que a maestria/aula chegar lá — ver
--    applyXpInTx e applySceneAward em models/trik.ts.
--
-- 2) trik_narrator_awards.tags: qual(is) tag(s) do narrador o post usou
--    (#lore, #au...), pro histórico da aba de narradores. Sem '#'.

BEGIN;

ALTER TABLE trik_progression
  ADD COLUMN IF NOT EXISTS req_weapon_level    SMALLINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS req_knowledge_id    UUID REFERENCES trik_knowledges(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS req_knowledge_level SMALLINT NOT NULL DEFAULT 0;

ALTER TABLE trik_narrator_awards
  ADD COLUMN IF NOT EXISTS tags TEXT[] NOT NULL DEFAULT '{}';

-- Backfill dos prêmios antigos: procura no texto do post as tags que o
-- narrador tem HOJE (+ #lore, que antes da trik_018 era a única). Tag que
-- foi removida depois não é achada — a linha fica com '{}' e a aba mostra "—".
-- [^[:alnum:]_] no lugar do lookahead de hasNarratorTag (#au não casa #aurora).
UPDATE trik_narrator_awards a
   SET tags = sub.tags
  FROM (
    SELECT a2.post_id, ARRAY_AGG(DISTINCT lower(t.tag)) AS tags
      FROM trik_narrator_awards a2
      JOIN posts p ON p.id = a2.post_id
      JOIN (
        SELECT user_id, tag FROM trik_narrator_tags
        UNION ALL
        SELECT a3.user_id, 'lore' FROM trik_narrator_awards a3
      ) t ON t.user_id = a2.user_id
     WHERE p.content ~* ('#' || t.tag || '([^[:alnum:]_À-ÿ]|$)')
     GROUP BY a2.post_id
  ) sub
 WHERE sub.post_id = a.post_id
   AND a.tags = '{}';

COMMIT;
