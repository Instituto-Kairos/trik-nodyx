-- Troca de nome de usuário pelo próprio usuário (1 vez a cada 30 dias).
-- Posts, mensagens, reações e personagens apontam pro id da conta e não
-- mudam; o que quebraria são as menções, gravadas como texto (@nome,
-- @[Personagem](nome)). Cada nome antigo fica aqui e:
--  - /users/<nome antigo> redireciona pro perfil atual;
--  - menção nova a um nome antigo notifica o dono atual;
--  - ninguém mais pode registrar ou trocar pra esse nome (sem o índice
--    único, menções antigas passariam a apontar pra outra pessoa).
-- Conta apagada → o histórico vai junto e os nomes ficam livres.

BEGIN;

CREATE TABLE IF NOT EXISTS username_history (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  old_username  VARCHAR(50) NOT NULL,
  changed_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_username_history_old ON username_history (LOWER(old_username));
CREATE INDEX IF NOT EXISTS idx_username_history_user ON username_history (user_id, changed_at DESC);

COMMIT;
