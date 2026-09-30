-- trik_004_post_reply.sql
-- Módulo RPG (trik) — fio de cena dentro de um tópico.
--
-- Dois jogadores podem cenar no mesmo tópico sem estarem juntos: a ordem
-- cronológica dos posts não diz quem está continuando quem. reply_to_id liga
-- cada post ao post que ele continua, e a página do tópico monta a partir
-- disso o breadcrumb da cena (para trás) e as continuações (para frente).
--
-- Só aponta para post do MESMO tópico — validado em código no POST /posts
-- (um CHECK não enxerga outra linha). Ao apagar um post do meio da cena, a
-- rota religa os filhos ao avô (PostModel.removeById) para o fio não partir;
-- o SET NULL abaixo é só a rede de segurança para qualquer outro DELETE.

BEGIN;

ALTER TABLE posts
  ADD COLUMN IF NOT EXISTS reply_to_id UUID REFERENCES posts(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_posts_reply_to
  ON posts(reply_to_id) WHERE reply_to_id IS NOT NULL;

COMMIT;
