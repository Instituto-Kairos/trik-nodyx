-- trik_015_au_narrators.sql
-- Módulo RPG (trik) — narradores do Universo Alternativo, por raiz de AU.
--
-- Dá acesso de leitura à aba AU do admin sem o papel de admin. Não confundir
-- com o narrador do #lore (trikNarrador.ts), que é uma conta única de xp.

BEGIN;

CREATE TABLE IF NOT EXISTS trik_au_narrators (
  category_id  UUID NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  added_by     UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (category_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_trik_au_narrators_user ON trik_au_narrators (user_id);

COMMIT;
