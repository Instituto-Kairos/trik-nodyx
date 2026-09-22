-- trik_002_xp.sql
-- Módulo RPG (trik) — XP automático por cena, level up, /levelup e maestria
-- de arma (#treino) / conhecimento (#aula).
-- Ver plans/fase-dois.md, plans/fase-dois-passo-a-passo.md e
-- plans/TRIK-PROJECT.md (seção 4, "DETECTAR BUFFS").
--
-- Toda tabela aqui nasce na forma final: nada de CREATE seguido de ALTER
-- ou RENAME (a ordem dos CREATEs segue as dependências entre FKs).

BEGIN;

-- trik_threads: tópicos do fórum habilitados pra contar XP por cena.
-- Granularidade por tópico individual (não por categoria) — confirmado com
-- o usuário. Só a existência da linha importa (sem coluna `purpose`: ao
-- contrário de trik_channels, aqui só há um propósito possível).
CREATE TABLE IF NOT EXISTS trik_threads (
  thread_id   UUID PRIMARY KEY REFERENCES threads(id) ON DELETE CASCADE,
  enabled_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- trik_paths: especialização do personagem (ex: "guerreiro", "curandeiro").
-- Catálogo só — ainda não há fluxo pra atribuir uma path a um personagem
-- (Fase 3); existe aqui só pra trik_progression.path_id já ter pra onde
-- apontar.
CREATE TABLE IF NOT EXISTS trik_paths (
  id    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name  VARCHAR(100) NOT NULL
);

-- trik_progression: curva de progresso por "type" — 'character' (nível do
-- personagem, usa goal_xp), 'weapon' (maestria de arma, usa req_mastery) e
-- 'knowledge' (aulas, usa req_education). Nos dois últimos, req_* = "treinos/
-- aulas necessários" pra ir do nível N ao N+1 (1.0 = uma cena de 500
-- caracteres; 0 ou sem linha = nível máximo) e goal_xp não é lido (fica em
-- 1, só porque a coluna é NOT NULL). path_id fica nullable e fora da PK: nenhuma
-- curva é path-specific ainda (nada preenche a coluna). req_development ainda
-- não é lido por nada. Seed no fim do arquivo é placeholder — validar a
-- curva real depois.
CREATE TABLE IF NOT EXISTS trik_progression (
  type                VARCHAR(20) NOT NULL,
  level               INT NOT NULL,
  path_id             UUID REFERENCES trik_paths(id) ON DELETE CASCADE,
  goal_xp             BIGINT NOT NULL,
  req_development     SMALLINT NOT NULL DEFAULT 0,
  req_mastery         SMALLINT NOT NULL DEFAULT 0,
  req_education       SMALLINT NOT NULL DEFAULT 0,
  reward_conduct      SMALLINT NOT NULL DEFAULT 0,
  reward_principles   SMALLINT NOT NULL DEFAULT 0,
  reward_preferences  SMALLINT NOT NULL DEFAULT 0,
  reward_goal         BOOLEAN NOT NULL DEFAULT FALSE,
  PRIMARY KEY (type, level)
);

-- trik_character_progress: 1:1 com trik_characters. Orçamento de pontos
-- gasto (spent_*) é rastreado à parte do total (points_*) — "disponível" =
-- points_* - spent_*, sem depender de reconstruir o gasto a partir das
-- colunas de trik_characters (que já começam com pontos base do /registro,
-- fora do orçamento de level up).
CREATE TABLE IF NOT EXISTS trik_character_progress (
  character_id        UUID PRIMARY KEY REFERENCES trik_characters(id) ON DELETE CASCADE,
  level                INT NOT NULL DEFAULT 1,
  progress_xp          BIGINT NOT NULL DEFAULT 0,
  points_conduct       SMALLINT NOT NULL DEFAULT 0,
  points_principles    SMALLINT NOT NULL DEFAULT 0,
  points_preferences   SMALLINT NOT NULL DEFAULT 0,
  spent_conduct        SMALLINT NOT NULL DEFAULT 0,
  spent_principles     SMALLINT NOT NULL DEFAULT 0,
  spent_preferences    SMALLINT NOT NULL DEFAULT 0,
  has_goal             BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Catálogos pré-cadastrados de arma (#treino) e matéria (#aula) — tela
-- /admin/trik/catalogo. Hashtag sem match aqui é ignorada pelo Fluxo 1: a
-- cena cai no comportamento normal. A unicidade case-insensitive/sem acento
-- é garantida pela aplicação (models/trikMastery.ts, normalizeCatalogName) —
-- o UNIQUE do banco só pega o caso de nome idêntico.
-- trik_weapons.category: só registro no banco, nunca aparece na cena — existe
-- pra validar bônus de aptidão por categoria de arma (Fase 3). Texto livre;
-- a aplicação reaproveita a grafia de uma categoria já cadastrada (mesma
-- normalização do nome) pra "Espada" e "espada" não virarem duas categorias.
CREATE TABLE IF NOT EXISTS trik_weapons (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name      VARCHAR(60) NOT NULL UNIQUE,
  category  VARCHAR(60) NOT NULL
);
CREATE TABLE IF NOT EXISTS trik_knowledges (
  id    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name  VARCHAR(60) NOT NULL UNIQUE
);

-- Progresso de maestria por personagem. `progress` é NUMERIC porque a
-- unidade de treino é fracionária (caracteres/500, ex.: 842 chars = 1.68).
CREATE TABLE IF NOT EXISTS trik_character_weapon_progress (
  character_id  UUID NOT NULL REFERENCES trik_characters(id) ON DELETE CASCADE,
  weapon_id     UUID NOT NULL REFERENCES trik_weapons(id) ON DELETE CASCADE,
  level         INT NOT NULL DEFAULT 1,
  progress      NUMERIC(8,2) NOT NULL DEFAULT 0,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (character_id, weapon_id)
);
CREATE TABLE IF NOT EXISTS trik_character_knowledge_progress (
  character_id  UUID NOT NULL REFERENCES trik_characters(id) ON DELETE CASCADE,
  knowledge_id  UUID NOT NULL REFERENCES trik_knowledges(id) ON DELETE CASCADE,
  level         INT NOT NULL DEFAULT 1,
  progress      NUMERIC(8,2) NOT NULL DEFAULT 0,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (character_id, knowledge_id)
);

-- trik_scene_awards: 1:1 com o post do fórum — só números, nunca conteúdo.
-- Existe só pra permitir reverter em PUT/DELETE /posts/:id (xp de
-- personagem e, se a cena foi #treino/#aula, o crédito de maestria) e pra
-- somar o que já foi creditado no dia (teto diário de maestria).
--   weapon_id / knowledge_id: ON DELETE SET NULL — apagar um item do
--     catálogo não pode apagar o histórico de cenas, só perde a referência.
--   mastery_kind ('weapon' | 'knowledge'; NULL = cena sem maestria): existe
--     além dos dois ids porque eles viram NULL se o item sair do catálogo, e
--     o teto diário (models/trikMastery.ts, getMasteryUsedToday) precisa
--     continuar contando o que já foi creditado no dia.
CREATE TABLE IF NOT EXISTS trik_scene_awards (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  character_id     UUID NOT NULL REFERENCES trik_characters(id) ON DELETE CASCADE,
  post_id          UUID NOT NULL UNIQUE REFERENCES posts(id) ON DELETE CASCADE,
  xp_awarded       INT NOT NULL,
  weapon_id        UUID REFERENCES trik_weapons(id) ON DELETE SET NULL,
  knowledge_id     UUID REFERENCES trik_knowledges(id) ON DELETE SET NULL,
  mastery_awarded  NUMERIC(6,2) NOT NULL DEFAULT 0,
  mastery_kind     VARCHAR(10),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_trik_scene_awards_character ON trik_scene_awards(character_id);

-- trik_bonus: catálogo de tipos de bônus — cadastro via interface própria
-- no admin (/admin/trik/bonus), mesmo padrão de trik_weapons/trik_knowledges.
-- is_category distingue bônus focado (item específico, ex.: 1 arma) de
-- categórico (categoria inteira, ex.: todas as armas de "Espadas") — ver
-- TRIK-PROJECT.md, Fase 3 (motor de buff), "aptidão focada/categórica".
-- Ainda não lido por nada — só cadastro.
CREATE TABLE IF NOT EXISTS trik_bonus (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bonus_type   VARCHAR(42) NOT NULL,
  bonus_value  VARCHAR(3) NOT NULL,
  is_category  BOOLEAN NOT NULL DEFAULT FALSE
);

-- Catálogos consumidos pelo /levelup. bonus_id aponta pro tipo de bônus
-- (trik_bonus) — existe pra Fase 3 (motor de buff) já ler dali; não usado
-- por nada até agora. ON DELETE SET NULL: apagar um tipo de bônus não pode
-- apagar a aptidão/preferência/objetivo, só perde a referência.
CREATE TABLE IF NOT EXISTS trik_aptitudes (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        VARCHAR(100) NOT NULL,
  category    VARCHAR(50),
  bonus_id    UUID REFERENCES trik_bonus(id) ON DELETE SET NULL
);
CREATE TABLE IF NOT EXISTS trik_preferences (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        VARCHAR(100) NOT NULL,
  category    VARCHAR(50),
  bonus_id    UUID REFERENCES trik_bonus(id) ON DELETE SET NULL
);
CREATE TABLE IF NOT EXISTS trik_goals (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        VARCHAR(100) NOT NULL,
  category    VARCHAR(50),
  bonus_id    UUID REFERENCES trik_bonus(id) ON DELETE SET NULL
);

-- trik_character_bonuses: 1:1, slots fixos (bate com o modal do /levelup:
-- 2 preferências + 1 objetivo por enquanto — sem slots de aptidão ainda,
-- ver "Pendências conhecidas" no fase-dois.md). Colunas nullable —
-- preenchidas aos poucos, uma de cada vez.
CREATE TABLE IF NOT EXISTS trik_character_bonuses (
  character_id          UUID PRIMARY KEY REFERENCES trik_characters(id) ON DELETE CASCADE,
  first_aptitude_id      UUID REFERENCES trik_aptitudes(id),
  second_aptitude_id     UUID REFERENCES trik_aptitudes(id),
  first_preference_id    UUID REFERENCES trik_preferences(id),
  second_preference_id   UUID REFERENCES trik_preferences(id),
  goal_id                UUID REFERENCES trik_goals(id)
);

-- Seed inicial das curvas — placeholder, validar a curva real depois.
-- 'character': patamares de xp. 'weapon'/'knowledge': treinos/aulas
-- necessários por nível (req_mastery / req_education); goal_xp não é lido
-- nesses dois types, fica em 1.
INSERT INTO trik_progression (type, level, goal_xp, req_mastery, req_education) VALUES
  ('character', 1,  500,  0,  0), ('character', 2,  750,  0,  0), ('character', 3, 1000,  0,  0),
  ('weapon',    1,    1,  5,  0), ('weapon',    2,    1,  8,  0), ('weapon',    3,    1, 10,  0),
  ('knowledge', 1,    1,  0,  5), ('knowledge', 2,    1,  0,  8), ('knowledge', 3,    1,  0, 10)
ON CONFLICT (type, level) DO NOTHING;

COMMIT;
