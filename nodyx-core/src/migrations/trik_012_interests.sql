-- trik_012_interests.sql
-- Módulo RPG (trik) — Fase 3: interesses primário e secundário.
-- Ver plans/fase-tres-bonus.md §6.5.
--
-- Cada interesse aponta para uma CATEGORIA de arma (treino) ou de matéria
-- (aula) e reduz o requisito de nível de maestria nela: primário −2,
-- secundário −1. O slot abre por nível (admin, aba de up) e, depois de
-- aberto, pode ser trocado uma vez por semana real (domingo–sábado).

BEGIN;

-- Desbloqueio por nível: mesmo padrão de reward_*_aptitudes (quantos slots o
-- nível libera; aqui o máximo útil é 1 de cada). Diferente da aptidão, não
-- há spent_*: o slot aberto continua aberto e a escolha pode mudar.
ALTER TABLE trik_progression
  ADD COLUMN IF NOT EXISTS reward_primary_interest   SMALLINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS reward_secondary_interest SMALLINT NOT NULL DEFAULT 0;
ALTER TABLE trik_character_progress
  ADD COLUMN IF NOT EXISTS points_primary_interest   SMALLINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS points_secondary_interest SMALLINT NOT NULL DEFAULT 0;

-- Uma linha por slot escolhido. category é texto (como trik_effects.
-- weapon_category): apagar a última arma de uma categoria não apaga o
-- interesse, ele só deixa de bater com alguma cena.
CREATE TABLE IF NOT EXISTS trik_character_interests (
  character_id  UUID NOT NULL REFERENCES trik_characters(id) ON DELETE CASCADE,
  slot          VARCHAR(10) NOT NULL CHECK (slot IN ('primario', 'secundario')),
  kind          VARCHAR(10) NOT NULL CHECK (kind IN ('weapon', 'knowledge')),
  category      VARCHAR(60) NOT NULL,
  chosen_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (character_id, slot)
);

-- Os dois slots não podem apontar para a mesma categoria.
CREATE UNIQUE INDEX IF NOT EXISTS trik_character_interests_unique_category
  ON trik_character_interests (character_id, kind, LOWER(category));

COMMIT;
