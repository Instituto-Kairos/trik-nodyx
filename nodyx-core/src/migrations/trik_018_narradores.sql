-- trik_018_narradores.sql
-- Vários narradores, cada um com a SUA tag (ex.: o narrador do AU com #au).
-- Post do narrador com a tag dele num tópico que vale xp rende xp pro pool
-- dele (trik_narrator_awards, que já é por user_id), distribuído na aba
-- /admin/trik/narrador entre os personagens dele: os do /registro (com level
-- up) ou os do /registro-au (só acumulam).
--
-- O narrador fixo do #lore (NARRADOR em models/trik.ts) entra aqui como a
-- primeira linha. Se a conta ainda não existir, o código continua tratando
-- ele como narrador de #lore (getNarratorTagFor).

BEGIN;

CREATE TABLE IF NOT EXISTS trik_narrators (
  user_id     UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  tag         VARCHAR(30) NOT NULL,   -- sem o '#'
  added_by    UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Uma tag, um narrador: senão um post com #au premiaria quem?
CREATE UNIQUE INDEX IF NOT EXISTS idx_trik_narrators_tag ON trik_narrators (lower(tag));

INSERT INTO trik_narrators (user_id, tag)
SELECT id, 'lore' FROM users
 WHERE is_system = false
   AND (LOWER(username) = 'oorpheas'
        OR id IN (SELECT user_id FROM username_history WHERE LOWER(old_username) = 'oorpheas'))
 LIMIT 1
ON CONFLICT DO NOTHING;

-- Distribuição pra personagem de AU (trik_au_characters). Uma linha aponta
-- pra um OU pro outro; os dois NULL = personagem apagado depois.
ALTER TABLE trik_narrator_distributions
  ADD COLUMN IF NOT EXISTS au_character_id UUID REFERENCES trik_au_characters(id) ON DELETE SET NULL;

COMMIT;
