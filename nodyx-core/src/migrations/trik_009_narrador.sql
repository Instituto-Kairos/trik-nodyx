-- trik_009_narrador.sql
-- XP de narrador: post do narrador (models/trik.ts, NARRADOR) com #lore num
-- tópico que vale xp rende 15xp a cada 500 caracteres pra um pool à parte,
-- que o admin distribui depois entre os personagens do próprio narrador
-- (aba /admin/trik/narrador).
--
-- Não há coluna de saldo: saldo = soma dos prêmios - soma das distribuições.
-- Assim reverter um post (edição/exclusão) é só apagar a linha do prêmio, sem
-- contador pra manter em sincronia. Se o xp já tinha sido distribuído, o
-- saldo fica negativo ("dívida"), mesma regra do revert de cena normal.

BEGIN;

-- 1:1 com o post, igual a trik_scene_awards — existe pra permitir reverter em
-- PUT/DELETE /posts/:id. user_id é o narrador que escreveu o post.
CREATE TABLE IF NOT EXISTS trik_narrator_awards (
  post_id     UUID PRIMARY KEY REFERENCES posts(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  xp_awarded  INT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_trik_narrator_awards_user ON trik_narrator_awards(user_id);

-- Saída do pool pra um personagem. character_id fica SET NULL: apagar o
-- personagem não pode devolver ao pool um xp que já foi gasto.
CREATE TABLE IF NOT EXISTS trik_narrator_distributions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  character_id  UUID REFERENCES trik_characters(id) ON DELETE SET NULL,
  xp            INT NOT NULL CHECK (xp > 0),
  created_by    UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_trik_narrator_distributions_user ON trik_narrator_distributions(user_id);

COMMIT;
