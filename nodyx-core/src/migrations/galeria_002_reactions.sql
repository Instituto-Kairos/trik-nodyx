-- galeria_002_reactions.sql
-- Reações às imagens da galeria: um usuário, uma linha por emoji.

BEGIN;

CREATE TABLE IF NOT EXISTS galeria_image_reactions (
  image_id   UUID        NOT NULL REFERENCES galeria_images(id) ON DELETE CASCADE,
  user_id    UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  emoji      VARCHAR(16) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (image_id, user_id, emoji)
);

COMMIT;
