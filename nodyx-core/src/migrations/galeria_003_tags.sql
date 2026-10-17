-- Galeria — catálogo de tags.
--
-- As imagens continuam guardando as tags em galeria_images.tags (TEXT[], com
-- índice GIN): o catálogo não substitui isso, só dá às pessoas uma lista para
-- escolher em vez de redigitar "kaelen" toda vez, e vira a barra de filtros da
-- galeria. Tag nova digitada no envio entra no catálogo automaticamente.
--
-- Unicidade sem diferenciar maiúsculas: "Kaelen" e "kaelen" seriam duas tags
-- que filtram coisas diferentes, e ninguém quer isso.

BEGIN;

CREATE TABLE IF NOT EXISTS galeria_tags (
  id           UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  community_id UUID         NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  name         VARCHAR(30)  NOT NULL,
  created_by   UUID         REFERENCES users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_galeria_tags_name
  ON galeria_tags(community_id, lower(name));

-- Tags que já estão em imagens entram no catálogo (a primeira grafia vence).
INSERT INTO galeria_tags (community_id, name)
SELECT DISTINCT ON (i.community_id, lower(t)) i.community_id, left(t, 30)
  FROM galeria_images i, unnest(i.tags) AS t
 WHERE btrim(t) <> ''
 ORDER BY i.community_id, lower(t)
ON CONFLICT DO NOTHING;

COMMIT;
