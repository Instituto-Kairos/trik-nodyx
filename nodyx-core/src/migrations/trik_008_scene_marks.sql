-- trik_008_scene_marks.sql
-- O bot Trik passou a marcar cena que contou xp com ✅ (antes ⚔️), e cena
-- recusada com ❌ (antes respondia no tópico). Troca retroativa das ⚔️ já
-- gravadas pelo bot — reações ⚔️ de membros de verdade ficam como estão.
--
-- Mantém o created_at original (o tooltip mostra "há X tempo"). Insere antes
-- de apagar, com ON CONFLICT, por causa da PK (post_id, user_id, emoji).
-- Sem usuário Trik no banco (módulo nunca usado) não faz nada.
--
-- trik_scene_rejections guarda o MOTIVO do ❌ (o post do bot dizia; a reação
-- não diz) — o frontend mostra ao clicar na reação. Código, não texto: o
-- texto fica em nodyx-frontend/src/lib/trik/sceneMarks.ts.

BEGIN;

CREATE TABLE IF NOT EXISTS trik_scene_rejections (
  post_id    UUID PRIMARY KEY REFERENCES posts(id) ON DELETE CASCADE,
  reason     VARCHAR(20) NOT NULL,
  created_at TIMESTAMP   NOT NULL DEFAULT NOW()
);

INSERT INTO post_reactions (post_id, user_id, emoji, created_at)
SELECT r.post_id, r.user_id, '✅', r.created_at
FROM post_reactions r
JOIN users u ON u.id = r.user_id
WHERE u.is_system = true AND u.username = 'Trik'
  AND r.emoji IN ('⚔️', '⚔')
ON CONFLICT DO NOTHING;

DELETE FROM post_reactions r
USING users u
WHERE u.id = r.user_id
  AND u.is_system = true AND u.username = 'Trik'
  AND r.emoji IN ('⚔️', '⚔');

COMMIT;
