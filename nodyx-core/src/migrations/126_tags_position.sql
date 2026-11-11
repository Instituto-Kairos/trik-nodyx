-- Ordem manual das tags. Até aqui a ordem era alfabética (ORDER BY name);
-- agora o admin define a sequência em /admin/tags e ela vale em todo o fórum.
-- O backfill preserva a ordem alfabética atual, então nada muda até alguém reordenar.

ALTER TABLE tags ADD COLUMN IF NOT EXISTS position INT NOT NULL DEFAULT 0;

UPDATE tags t
   SET position = r.rn
  FROM (
    SELECT id, ROW_NUMBER() OVER (PARTITION BY community_id ORDER BY name ASC) AS rn
      FROM tags
  ) r
 WHERE t.id = r.id;
