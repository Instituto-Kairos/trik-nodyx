-- trik_026_passes.sql
-- Passes do jogador: multiplicam o xp de cena de TODOS os personagens dele
-- (cenas normais e #treino/#aula; AU e narrador ficam de fora).
--
--   · permit_type: no máximo um entre
--       estudantil    → 1.5x
--       trabalhista_1 → 1.6x
--       trabalhista_2 → 1.75x
--     NULL = sem passe.
--   · permit_multiparo: o Passe Multíparo (1.4x), acumulável com qualquer um
--     dos de cima — multiplica em cima (estudantil + multíparo = 2.1x).
--
-- A conta mora em services/trik/xp/calc.ts (permitMultiplier).
--
-- permit_active (trik_001) fica no banco, mas o código não lê nem escreve
-- mais: era só um liga/desliga sem efeito, e não dá pra saber a qual passe
-- um "ativo" antigo correspondia.

BEGIN;

ALTER TABLE trik_players
  ADD COLUMN IF NOT EXISTS permit_type      VARCHAR(20),
  ADD COLUMN IF NOT EXISTS permit_multiparo BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE trik_players DROP CONSTRAINT IF EXISTS trik_players_permit_type_check;
ALTER TABLE trik_players ADD CONSTRAINT trik_players_permit_type_check
  CHECK (permit_type IS NULL OR permit_type IN ('estudantil', 'trabalhista_1', 'trabalhista_2'));

COMMIT;
