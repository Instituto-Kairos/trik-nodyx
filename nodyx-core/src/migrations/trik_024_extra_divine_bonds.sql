-- trik_024_extra_divine_bonds.sql
-- Vínculos divinos secundário e terciário: ganhos com o avanço da história,
-- atribuídos só pelo admin (ficha completa do personagem). Cada um é um par
-- panteão + divindade/caminho, como o principal (pantheon_id/divine_bond_id).
--
-- Efeitos do panteão/divindade valem pela metade no secundário (0.5x) e por
-- um quarto no terciário (0.25x) — só os numéricos (reduz_requisito,
-- limite_diario, multiplica: escala o ganho, 1.5 → 1.25). Liga/desliga
-- (anula_alerta, sensibilidade, espelho) só valem no principal. Ver
-- listCharacterEffects em models/trikEffects.ts.

BEGIN;

ALTER TABLE trik_character_bonuses
  ADD COLUMN IF NOT EXISTS secondary_pantheon_id    UUID REFERENCES trik_pantheons(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS secondary_divine_bond_id UUID REFERENCES trik_deities(id)   ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS tertiary_pantheon_id     UUID REFERENCES trik_pantheons(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS tertiary_divine_bond_id  UUID REFERENCES trik_deities(id)   ON DELETE SET NULL;

COMMIT;
