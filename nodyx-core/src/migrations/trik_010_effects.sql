-- trik_010_effects.sql
-- Módulo RPG (trik) — Fase 3: motor de bônus por EFEITOS, listas
-- desbloqueáveis (transtornos, distúrbios, habilidades únicas,
-- peculiaridades), slots de aptidão natural/adquirida, regiões, clima e
-- semana de jogo. Ver plans/fase-tres-bonus.md (regras fechadas em 2026-10-12).
--
-- Migration nova (não edita 001/002): já há produção desde a trik_005.

BEGIN;

-- ─── Matéria ganha categoria (igual arma) ───────────────────────────────────
-- Nullable: matérias já cadastradas ficam sem; a tela passa a exigir.
ALTER TABLE trik_knowledges
  ADD COLUMN IF NOT EXISTS category VARCHAR(60);

-- ─── Slots de aptidão do modelo (2 naturais + 2 adquiridas) ─────────────────
-- first/second_aptitude_id nunca foram preenchidos por nenhuma rota (Fase 2
-- não tinha aptidão), então viram os slots naturais sem perda de dado.
ALTER TABLE trik_character_bonuses
  RENAME COLUMN first_aptitude_id TO first_natural_aptitude_id;
ALTER TABLE trik_character_bonuses
  RENAME COLUMN second_aptitude_id TO second_natural_aptitude_id;
ALTER TABLE trik_character_bonuses
  ADD COLUMN IF NOT EXISTS first_acquired_aptitude_id  UUID REFERENCES trik_aptitudes(id),
  ADD COLUMN IF NOT EXISTS second_acquired_aptitude_id UUID REFERENCES trik_aptitudes(id);

-- Desbloqueio por nível (definido pelo admin na aba de up), mesmo padrão de
-- reward_preferences: quantos slots o nível libera. Orçamento no personagem
-- igual ao de preferências (points_* ganho, spent_* usado).
ALTER TABLE trik_progression
  ADD COLUMN IF NOT EXISTS reward_natural_aptitudes  SMALLINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS reward_acquired_aptitudes SMALLINT NOT NULL DEFAULT 0;
ALTER TABLE trik_character_progress
  ADD COLUMN IF NOT EXISTS points_natural_aptitudes  SMALLINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS spent_natural_aptitudes   SMALLINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS points_acquired_aptitudes SMALLINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS spent_acquired_aptitudes  SMALLINT NOT NULL DEFAULT 0;

-- ─── Listas desbloqueáveis ──────────────────────────────────────────────────
-- Formato de catálogo do modelo (id, category, name). category = agrupador
-- livre ("mental", "físico"…). O admin/narrador desbloqueia pro personagem —
-- sem limite de quantidade, por isso N:N e não slots fixos.
CREATE TABLE IF NOT EXISTS trik_disorders (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category  VARCHAR(50),
  name      VARCHAR(100) NOT NULL UNIQUE
);
CREATE TABLE IF NOT EXISTS trik_disturbances (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category  VARCHAR(50),
  name      VARCHAR(100) NOT NULL UNIQUE
);
CREATE TABLE IF NOT EXISTS trik_unique_abilities (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category  VARCHAR(50),
  name      VARCHAR(100) NOT NULL UNIQUE
);
CREATE TABLE IF NOT EXISTS trik_peculiarities (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category  VARCHAR(50),
  name      VARCHAR(100) NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS trik_character_disorders (
  character_id  UUID NOT NULL REFERENCES trik_characters(id) ON DELETE CASCADE,
  disorder_id   UUID NOT NULL REFERENCES trik_disorders(id) ON DELETE CASCADE,
  unlocked_by   UUID REFERENCES users(id) ON DELETE SET NULL,
  unlocked_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (character_id, disorder_id)
);
CREATE TABLE IF NOT EXISTS trik_character_disturbances (
  character_id    UUID NOT NULL REFERENCES trik_characters(id) ON DELETE CASCADE,
  disturbance_id  UUID NOT NULL REFERENCES trik_disturbances(id) ON DELETE CASCADE,
  unlocked_by     UUID REFERENCES users(id) ON DELETE SET NULL,
  unlocked_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (character_id, disturbance_id)
);
CREATE TABLE IF NOT EXISTS trik_character_unique_abilities (
  character_id       UUID NOT NULL REFERENCES trik_characters(id) ON DELETE CASCADE,
  unique_ability_id  UUID NOT NULL REFERENCES trik_unique_abilities(id) ON DELETE CASCADE,
  unlocked_by        UUID REFERENCES users(id) ON DELETE SET NULL,
  unlocked_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (character_id, unique_ability_id)
);
CREATE TABLE IF NOT EXISTS trik_character_peculiarities (
  character_id    UUID NOT NULL REFERENCES trik_characters(id) ON DELETE CASCADE,
  peculiarity_id  UUID NOT NULL REFERENCES trik_peculiarities(id) ON DELETE CASCADE,
  unlocked_by     UUID REFERENCES users(id) ON DELETE SET NULL,
  unlocked_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (character_id, peculiarity_id)
);

-- ─── Efeitos ────────────────────────────────────────────────────────────────
-- Substitui bonus_type/bonus_value (e trik_bonus): uma linha por efeito, com
-- dono, atividade, alvo, condição e valor. Dono = uma FK por catálogo (FK de
-- verdade: apagou o item, os efeitos somem junto) + CHECK "exatamente uma".
-- Foco × Categoria não é coluna: alvo específico (weapon_id/knowledge_id) =
-- foco; categoria ou nenhum = categoria.
CREATE TABLE IF NOT EXISTS trik_effects (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  aptitude_id        UUID REFERENCES trik_aptitudes(id)        ON DELETE CASCADE,
  preference_id      UUID REFERENCES trik_preferences(id)      ON DELETE CASCADE,
  goal_id            UUID REFERENCES trik_goals(id)            ON DELETE CASCADE,
  pantheon_id        UUID REFERENCES trik_pantheons(id)        ON DELETE CASCADE,
  deity_id           UUID REFERENCES trik_deities(id)          ON DELETE CASCADE,
  disorder_id        UUID REFERENCES trik_disorders(id)        ON DELETE CASCADE,
  disturbance_id     UUID REFERENCES trik_disturbances(id)     ON DELETE CASCADE,
  unique_ability_id  UUID REFERENCES trik_unique_abilities(id) ON DELETE CASCADE,
  peculiarity_id     UUID REFERENCES trik_peculiarities(id)    ON DELETE CASCADE,

  effect             VARCHAR(20) NOT NULL,
  activity           VARCHAR(10) NOT NULL DEFAULT 'todas',

  weapon_id          UUID REFERENCES trik_weapons(id)    ON DELETE CASCADE,
  knowledge_id       UUID REFERENCES trik_knowledges(id) ON DELETE CASCADE,
  weapon_category    VARCHAR(60),
  knowledge_category VARCHAR(60),
  alert_kind         VARCHAR(10),

  condition_kind     VARCHAR(10) NOT NULL DEFAULT 'sempre',
  condition_value    VARCHAR(20),

  value              NUMERIC(5,2),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT trik_effects_one_owner CHECK (num_nonnulls(
    aptitude_id, preference_id, goal_id, pantheon_id, deity_id,
    disorder_id, disturbance_id, unique_ability_id, peculiarity_id) = 1),

  CONSTRAINT trik_effects_effect_check CHECK (effect IN (
    'reduz_requisito', 'multiplica', 'limite_diario',
    'anula_alerta', 'sensibilidade', 'espelho')),
  CONSTRAINT trik_effects_activity_check CHECK (activity IN ('treino', 'aula', 'todas')),

  -- Alvo: no máximo um; arma só em treino, matéria só em aula.
  CONSTRAINT trik_effects_one_target CHECK (num_nonnulls(
    weapon_id, knowledge_id, weapon_category, knowledge_category, alert_kind) <= 1),
  CONSTRAINT trik_effects_weapon_target CHECK (
    (weapon_id IS NULL AND weapon_category IS NULL) OR activity = 'treino'),
  CONSTRAINT trik_effects_knowledge_target CHECK (
    (knowledge_id IS NULL AND knowledge_category IS NULL) OR activity = 'aula'),
  -- Efeitos de temperatura exigem o tipo de alerta; os outros não podem ter.
  CONSTRAINT trik_effects_alert_kind CHECK (
    (effect IN ('anula_alerta', 'sensibilidade')) = (alert_kind IS NOT NULL)
    AND (alert_kind IS NULL OR alert_kind IN ('calor', 'frio', 'umidade'))),

  -- Uma condição por efeito. Climas = lista fixa do código (weather_code →
  -- nome); garoa fica de fora (só narrativa, não gera bônus).
  CONSTRAINT trik_effects_condition CHECK (
       (condition_kind IN ('sempre', 'companhia') AND condition_value IS NULL)
    OR (condition_kind = 'periodo' AND condition_value IN ('dia', 'noite'))
    OR (condition_kind = 'clima'   AND condition_value IN
          ('sol', 'nublado', 'neblina', 'chuva', 'tempestade', 'neve'))),

  -- Valor só nos efeitos numéricos, e positivo.
  CONSTRAINT trik_effects_value CHECK (
    CASE WHEN effect IN ('reduz_requisito', 'multiplica', 'limite_diario')
         THEN value IS NOT NULL AND value > 0
         ELSE value IS NULL END)
);

-- ─── Regiões, clima e semana de jogo ────────────────────────────────────────
-- Região é do tópico: tópico sem região não tem clima, horário nem alerta.
CREATE TABLE IF NOT EXISTS trik_locations (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        VARCHAR(100) NOT NULL UNIQUE,
  latitude    NUMERIC(8,5) NOT NULL CHECK (latitude  BETWEEN -90  AND 90),
  longitude   NUMERIC(8,5) NOT NULL CHECK (longitude BETWEEN -180 AND 180),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE trik_threads
  ADD COLUMN IF NOT EXISTS location_id UUID REFERENCES trik_locations(id) ON DELETE SET NULL;

-- Dados da Open-Meteo (Historical) por região e data in-game, gravados ao
-- selecionar a semana. Horários no fuso local da região. Níveis de alerta
-- NÃO são gravados: saem dos limites do código a partir de temp/umidade.
-- rain_hours: texto pronto do horário da chuva ("das 14:00 às 17:00",
-- "o dia todo", "espalhada ao longo do dia"); só narrativa, não entra no motor.
CREATE TABLE IF NOT EXISTS trik_weather (
  location_id   UUID NOT NULL REFERENCES trik_locations(id) ON DELETE CASCADE,
  game_date     DATE NOT NULL,
  weather_code  SMALLINT,
  climate       VARCHAR(20),
  sunrise       TIME,
  sunset        TIME,
  temp_max      NUMERIC(4,1),
  temp_min      NUMERIC(4,1),
  humidity_min  SMALLINT,
  rain_hours    VARCHAR(80),
  fetched_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (location_id, game_date)
);

-- Linha única: a semana em jogo (domingo a sábado). Cena com Data fora dela
-- é inválida.
CREATE TABLE IF NOT EXISTS trik_game_state (
  id          BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id),
  week_start  DATE CHECK (week_start IS NULL OR EXTRACT(DOW FROM week_start) = 0),
  updated_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO trik_game_state (id) VALUES (TRUE) ON CONFLICT (id) DO NOTHING;

-- ─── Prêmio de cena: data in-game e detalhe dos bônus ───────────────────────
-- game_date: o teto diário passa a somar por ela (NULL = cena sem Data,
-- cai na data real do post). bonus_detail: efeitos/alertas aplicados, pra
-- auditoria e pro revert desfazer exatamente o que foi dado.
-- mastery_raw: unidades BRUTAS que gastaram teto (0 em cena penalizada/
-- proibida); mastery_awarded segue sendo o creditado (com bônus). NULL =
-- cena anterior à Fase 3, o teto usa mastery_awarded.
ALTER TABLE trik_scene_awards
  ADD COLUMN IF NOT EXISTS game_date    DATE,
  ADD COLUMN IF NOT EXISTS mastery_raw  NUMERIC(6,2),
  ADD COLUMN IF NOT EXISTS bonus_detail JSONB;

-- ─── Canais: propósitos Clima e Alertas ─────────────────────────────────────
ALTER TABLE trik_channels DROP CONSTRAINT IF EXISTS trik_channels_purpose_check;
ALTER TABLE trik_channels ADD CONSTRAINT trik_channels_purpose_check
  CHECK (purpose IN ('registro', 'plaquinha', 'levelup', 'anuncio', 'clima', 'alertas'));

-- ─── Sai o bônus "valor solto" ──────────────────────────────────────────────
-- Nada cadastrado em trik_bonus (confirmado pelo usuário).
ALTER TABLE trik_aptitudes   DROP COLUMN IF EXISTS bonus_id;
ALTER TABLE trik_preferences DROP COLUMN IF EXISTS bonus_id;
ALTER TABLE trik_goals       DROP COLUMN IF EXISTS bonus_id;
ALTER TABLE trik_pantheons   DROP COLUMN IF EXISTS bonus_id;
ALTER TABLE trik_deities     DROP COLUMN IF EXISTS bonus_id;
DROP TABLE IF EXISTS trik_bonus;

COMMIT;
