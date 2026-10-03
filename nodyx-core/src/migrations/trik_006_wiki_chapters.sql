-- trik_006_wiki_chapters.sql
-- Biblioteca (wiki): capítulos/páginas dentro de um mesmo post.
--
-- O wiki_pages.content continua existindo e passa a ser a introdução (o que
-- aparece antes do sumário). Uma página sem capítulos se comporta como antes.
-- `position` é a ordem no sumário; o PATCH regrava a lista inteira, então não
-- há UNIQUE(page_id, position) para não atrapalhar a regravação.

BEGIN;

CREATE TABLE IF NOT EXISTS wiki_chapters (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  page_id     UUID        NOT NULL REFERENCES wiki_pages(id) ON DELETE CASCADE,
  position    INTEGER     NOT NULL,
  title       TEXT        NOT NULL,
  content     TEXT        NOT NULL DEFAULT '',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_wiki_chapters_page ON wiki_chapters(page_id, position);

COMMIT;
