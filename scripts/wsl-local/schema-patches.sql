-- Ajustes de schema pro banco de teste do WSL, aplicados por update.sh a cada update.
--
-- Por quê existe: enquanto o módulo não tem produção, mudança de schema edita
-- trik_001/trik_002 direto (sem migration nova). Só que o runner não reaplica
-- uma migration já registrada em schema_migrations — então um banco que rodou
-- a versão ANTERIOR fica sem a mudança. Cada comando aqui leva esse banco pro
-- MESMO schema que a migration editada cria num banco novo, e é idempotente
-- (num banco recém-criado pelo core, não faz nada).
--
-- Ao resetar o banco (full-reset.sh) estes ajustes deixam de ser necessários:
-- pode apagar o que já vale nas migrations. Ao editar uma migration, acrescente
-- o ajuste equivalente aqui.
BEGIN;

-- trik_002: trik_weapons.category VARCHAR(60) NOT NULL (sem default, como na
-- migration). O DEFAULT temporário só existe pra não quebrar se já houver armas.
ALTER TABLE IF EXISTS trik_weapons ADD COLUMN IF NOT EXISTS category VARCHAR(60) NOT NULL DEFAULT 'Sem categoria';
ALTER TABLE IF EXISTS trik_weapons ALTER COLUMN category DROP DEFAULT;

-- trik_002: catálogo de tipos de bônus (trik_bonus) + trik_aptitudes/
-- preferences/goals trocando bonus_type/bonus_value livres por bonus_id (FK).
-- Um banco que já rodou a versão anterior ainda tem as colunas antigas — dropa
-- elas depois de criar a tabela nova e a coluna nova (nunca havia dado pra
-- migrar dado: bonus_type/bonus_value não eram consumidos por nada até aqui).
-- Só antes da trik_010: ela substitui trik_bonus por trik_effects e dropa
-- os bonus_id — recriar aqui depois disso traria a tabela velha de volta.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM schema_migrations WHERE version = 'trik_010_effects') THEN
    CREATE TABLE IF NOT EXISTS trik_bonus (
      id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      bonus_type   VARCHAR(42) NOT NULL,
      bonus_value  VARCHAR(3) NOT NULL,
      is_category  BOOLEAN NOT NULL DEFAULT FALSE
    );
    ALTER TABLE IF EXISTS trik_aptitudes ADD COLUMN IF NOT EXISTS bonus_id UUID REFERENCES trik_bonus(id) ON DELETE SET NULL;
    ALTER TABLE IF EXISTS trik_preferences ADD COLUMN IF NOT EXISTS bonus_id UUID REFERENCES trik_bonus(id) ON DELETE SET NULL;
    ALTER TABLE IF EXISTS trik_goals ADD COLUMN IF NOT EXISTS bonus_id UUID REFERENCES trik_bonus(id) ON DELETE SET NULL;
    ALTER TABLE IF EXISTS trik_aptitudes DROP COLUMN IF EXISTS bonus_type, DROP COLUMN IF EXISTS bonus_value;
    ALTER TABLE IF EXISTS trik_preferences DROP COLUMN IF EXISTS bonus_type, DROP COLUMN IF EXISTS bonus_value;
    ALTER TABLE IF EXISTS trik_goals DROP COLUMN IF EXISTS bonus_type, DROP COLUMN IF EXISTS bonus_value;
  END IF;
END $$;

-- trik_010 (Fase 3), editada depois de já aplicada no WSL em 2026-10-14:
--  - trik_weather: rain_start/rain_end (TIME) viraram rain_hours (texto
--    pronto — dois blocos de chuva não cabiam num início/fim só);
--  - trik_scene_awards.mastery_raw: unidades brutas que gastam o teto diário.
-- trik_weather ainda estava vazia quando isto foi escrito: nada a migrar.
ALTER TABLE IF EXISTS trik_weather ADD COLUMN IF NOT EXISTS rain_hours VARCHAR(80);
ALTER TABLE IF EXISTS trik_weather DROP COLUMN IF EXISTS rain_start, DROP COLUMN IF EXISTS rain_end;
ALTER TABLE IF EXISTS trik_scene_awards ADD COLUMN IF NOT EXISTS mastery_raw NUMERIC(6,2);

-- Limpeza: um update.sh rodado antes desta guarda recriou trik_bonus e os
-- bonus_id depois da trik_010 (WSL, 2026-10-14 — vazios, nada a perder).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM schema_migrations WHERE version = 'trik_010_effects') THEN
    ALTER TABLE IF EXISTS trik_aptitudes   DROP COLUMN IF EXISTS bonus_id;
    ALTER TABLE IF EXISTS trik_preferences DROP COLUMN IF EXISTS bonus_id;
    ALTER TABLE IF EXISTS trik_goals       DROP COLUMN IF EXISTS bonus_id;
    DROP TABLE IF EXISTS trik_bonus;
  END IF;
END $$;

COMMIT;
