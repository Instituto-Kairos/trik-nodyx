-- trik_005_pantheons.sql
-- Módulo RPG (trik) — catálogo de panteões e divindades (pantheons/deities
-- do modelo de dados do TRIK-PROJECT), cadastrado em /admin/trik/panteoes e
-- consumido pelos dropdowns do modal de /registro.
--
-- Os dois têm bonus_id (trik_bonus, ON DELETE SET NULL — apagar um tipo de bônus não apaga o
-- panteão/divindade, só perde a referência).
--
-- A escolha do personagem fica em trik_character_bonuses.pantheon_id /
-- divine_bond_id (o characters_bonus do modelo). SET NULL em vez do CASCADE
-- do modelo: o CASCADE apagaria a linha inteira de bônus do personagem
-- (preferências, objetivo…) ao remover uma divindade do catálogo.
-- trik_characters.pantheon/divine_bond (texto) seguem como cópia do nome no
-- momento do registro — registros antigos de texto livre continuam valendo.

BEGIN;

CREATE TABLE IF NOT EXISTS trik_pantheons (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        VARCHAR(100) NOT NULL UNIQUE,
  bonus_id    UUID REFERENCES trik_bonus(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS trik_deities (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pantheon_id  UUID NOT NULL REFERENCES trik_pantheons(id) ON DELETE CASCADE,
  name         VARCHAR(100) NOT NULL,
  bonus_id     UUID REFERENCES trik_bonus(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (pantheon_id, name)
);

CREATE INDEX IF NOT EXISTS idx_trik_deities_pantheon ON trik_deities(pantheon_id);

ALTER TABLE trik_character_bonuses
  ADD COLUMN IF NOT EXISTS pantheon_id    UUID REFERENCES trik_pantheons(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS divine_bond_id UUID REFERENCES trik_deities(id)   ON DELETE SET NULL;

COMMIT;
