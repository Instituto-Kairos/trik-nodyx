-- trik_020_narrador_tags.sql
-- Narrador com VÁRIAS tags (ex.: o narrador do AU com #au e #evento). Post do
-- narrador com qualquer uma das tags dele num tópico que vale xp rende xp pro
-- mesmo pool (trik_narrator_awards, por user_id) — as tags só identificam a
-- cena, não separam saldo.
--
-- trik_narrators.tag (trik_018) deixa de ser a fonte: as tags moram aqui. A
-- coluna fica (nullable, sem índice) só pra não quebrar rollback.
--
-- O narrador fixo do #lore (NARRADOR em models/trik.ts) tem #lore implícito,
-- mesmo sem linha aqui; tags extras dele entram nesta tabela normalmente.

BEGIN;

CREATE TABLE IF NOT EXISTS trik_narrator_tags (
  tag         VARCHAR(30) NOT NULL,   -- sem o '#'
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  added_by    UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Uma tag, um narrador: senão um post com #au premiaria quem?
CREATE UNIQUE INDEX IF NOT EXISTS idx_trik_narrator_tags_tag ON trik_narrator_tags (lower(tag));
CREATE INDEX IF NOT EXISTS idx_trik_narrator_tags_user ON trik_narrator_tags (user_id);

INSERT INTO trik_narrator_tags (tag, user_id, added_by, created_at)
SELECT tag, user_id, added_by, created_at FROM trik_narrators WHERE tag IS NOT NULL
ON CONFLICT DO NOTHING;

DROP INDEX IF EXISTS idx_trik_narrators_tag;
ALTER TABLE trik_narrators ALTER COLUMN tag DROP NOT NULL;

COMMIT;
