-- Galeria — anotações de uma imagem.
--
-- Cada imagem tem uma página própria (/galeria/<id>) e, abaixo dela, uma linha
-- do tempo de anotações que SÓ quem enviou a imagem escreve: um caderno do
-- post, não uma conversa. Por isso não há curtidas, respostas nem contadores.
-- Admin/owner pode apagar uma anotação (moderação), não escrever.

BEGIN;

CREATE TABLE IF NOT EXISTS galeria_notes (
  id           UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  -- CASCADE: as anotações só existem em função da imagem.
  image_id     UUID         NOT NULL REFERENCES galeria_images(id) ON DELETE CASCADE,
  community_id UUID         NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  author_id    UUID         REFERENCES users(id) ON DELETE SET NULL,
  -- HTML já sanitizado no servidor, como a descrição da imagem.
  content      TEXT         NOT NULL,
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_galeria_notes_image ON galeria_notes(image_id, created_at);

COMMIT;
