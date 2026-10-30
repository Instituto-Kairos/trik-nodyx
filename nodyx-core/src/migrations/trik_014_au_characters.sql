-- trik_014_au_characters.sql
-- Módulo RPG (trik) — personagens do Universo Alternativo (/registro-au).
--
-- Só nome + link da ficha, vários por jogador, e sem trik_players por trás
-- (jogar no AU continua não exigindo /registro). A plaquinha é a mesma do
-- universo principal (/plaquinha lista os dois) e o xp usa a mesma conta de
-- cena, mas só acumula: sem nível, pontos nem /levelup.

BEGIN;

CREATE TABLE IF NOT EXISTS trik_au_characters (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name                VARCHAR(100) NOT NULL,
  ficha_link          VARCHAR(500) NOT NULL,
  template_name       VARCHAR(200),
  template_signature  TEXT,
  xp                  BIGINT NOT NULL DEFAULT 0,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_trik_au_characters_name
  ON trik_au_characters (user_id, lower(name));

-- Prêmio por post, como trik_scene_awards: é o que deixa editar/apagar o
-- post desfazer o xp.
CREATE TABLE IF NOT EXISTS trik_au_scene_awards (
  post_id       UUID PRIMARY KEY REFERENCES posts(id) ON DELETE CASCADE,
  character_id  UUID NOT NULL REFERENCES trik_au_characters(id) ON DELETE CASCADE,
  xp_awarded    INT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE trik_channels DROP CONSTRAINT IF EXISTS trik_channels_purpose_check;
ALTER TABLE trik_channels ADD CONSTRAINT trik_channels_purpose_check
  CHECK (purpose IN ('registro', 'plaquinha', 'levelup', 'anuncio', 'clima', 'alertas', 'registro-au'));

COMMIT;
