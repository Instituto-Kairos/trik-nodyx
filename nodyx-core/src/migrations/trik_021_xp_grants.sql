-- trik_021_xp_grants.sql
-- Bônus de XP dado à mão pelo admin na ficha completa do personagem
-- (/admin/trik/registros/[id]). Cada concessão fica registrada (quem, quanto,
-- por quê) — o xp em si vai pro mesmo trik_character_progress das cenas, com
-- level up normal. Não tem revert: corrigir = conceder de novo.

BEGIN;

CREATE TABLE IF NOT EXISTS trik_xp_grants (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  character_id  UUID NOT NULL REFERENCES trik_characters(id) ON DELETE CASCADE,
  xp            INTEGER NOT NULL CHECK (xp > 0),
  reason        VARCHAR(200),
  granted_by    UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_trik_xp_grants_character
  ON trik_xp_grants (character_id, created_at DESC);

COMMIT;
