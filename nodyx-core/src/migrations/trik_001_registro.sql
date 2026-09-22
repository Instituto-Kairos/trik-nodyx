-- trik_001_registro.sql
-- Módulo RPG (trik) — jogadores, personagens e templates de plaquinha.
-- Ver plans/fase-um.md e plans/TRIK-PROJECT.md para o desenho completo.
--
-- Namespace trik_ (arquivo e tabelas) deliberado: este fork continua
-- recebendo merges de Pokled/nodyx (numeração NNN_*.sql), e "trik_" ordena
-- sempre depois de qualquer prefixo numérico (ASCII de 't' > qualquer
-- dígito) — sem exigir acompanhar até onde o upstream chegou a cada merge.

BEGIN;

-- trik_channels: mapeia canais da instância pra um propósito do módulo RPG
-- (chat): /registro, /plaquinha, /levelup e o canal de avisos ('anuncio' —
-- level up, pontos disponíveis, subida de maestria). Não há propósito
-- 'cena': o jogo roda em tópicos do fórum, marcados em trik_threads (002).
CREATE TABLE IF NOT EXISTS trik_channels (
  channel_id  UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  purpose     VARCHAR(20) NOT NULL,
  enabled_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (channel_id, purpose),
  CONSTRAINT trik_channels_purpose_check
    CHECK (purpose IN ('registro', 'plaquinha', 'levelup', 'anuncio'))
);

-- trik_players: identidade OOC do jogador. id = users.id direto (1:1) —
-- o campo é preenchido pelo id do usuário dentro do nodyx, sem gerador
-- próprio.
CREATE TABLE IF NOT EXISTS trik_players (
  id             UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  name           VARCHAR(100) NOT NULL,
  pronouns       VARCHAR(50),
  birth_date     DATE,
  permit_active  BOOLEAN NOT NULL DEFAULT FALSE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- trik_characters: N personagens por jogador. conduct_*/principles_*
-- começam com no máximo 1 ponto cada (regra do /registro — validada em
-- código, não em CHECK, porque a Fase 2 incrementa esses mesmos campos via
-- /levelup). pantheon/divine_bond/divine_gift são texto livre nesta fase
-- (batem com os campos do mockup de /registro, que não são dropdown) —
-- viram FK pra catálogo só na Fase 3, se o motor de buff precisar.
CREATE TABLE IF NOT EXISTS trik_characters (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id             UUID NOT NULL REFERENCES trik_players(id) ON DELETE CASCADE,
  name                  VARCHAR(100) NOT NULL,
  pronouns              VARCHAR(50),
  birth_date            DATE,
  faceclaim_name        VARCHAR(100),
  faceclaim_birth_date  DATE,
  ficha_link            VARCHAR(500) NOT NULL,
  pantheon              VARCHAR(100),
  divine_bond           VARCHAR(100),
  divine_gift           VARCHAR(240),
  conduct_presenca      SMALLINT NOT NULL DEFAULT 0,
  conduct_proposito     SMALLINT NOT NULL DEFAULT 0,
  conduct_sangue        SMALLINT NOT NULL DEFAULT 0,
  principles_mente      SMALLINT NOT NULL DEFAULT 0,
  principles_coracao    SMALLINT NOT NULL DEFAULT 0,
  principles_corpo      SMALLINT NOT NULL DEFAULT 0,
  template_name         VARCHAR(200),
  template_signature    TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_active_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (player_id, name)
);

CREATE INDEX IF NOT EXISTS idx_trik_characters_player ON trik_characters(player_id);

INSERT INTO modules (id, family, enabled) VALUES ('trik', 'core', true)
ON CONFLICT (id) DO NOTHING;

COMMIT;
