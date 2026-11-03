-- trik_017_galeria_tags_au.sql
-- Tags da galeria separadas por universo, como os álbuns (trik_013): tag de AU
-- só aparece na aba AU, tag normal só na Galeria. O mesmo nome pode existir
-- dos dois lados (são tags diferentes).
--
-- Tags existentes:
--   · usadas SÓ em imagens de AU        → viram AU
--   · usadas nos dois lados              → continuam normais + ganham uma cópia AU
--   · usadas só fora do AU, ou sem uso   → continuam normais

BEGIN;

ALTER TABLE galeria_tags ADD COLUMN IF NOT EXISTS is_au BOOLEAN NOT NULL DEFAULT false;

DROP INDEX IF EXISTS idx_galeria_tags_name;
CREATE UNIQUE INDEX IF NOT EXISTS idx_galeria_tags_name_au
  ON galeria_tags(community_id, is_au, lower(name));

-- Uso de cada tag por universo.
CREATE TEMP TABLE _uso ON COMMIT DROP AS
SELECT t.id, t.community_id, t.name, t.created_by,
       EXISTS (SELECT 1 FROM galeria_images i JOIN galeria_albums a ON a.id = i.album_id
                WHERE i.community_id = t.community_id AND a.is_au AND t.name = ANY(i.tags)) AS em_au,
       EXISTS (SELECT 1 FROM galeria_images i LEFT JOIN galeria_albums a ON a.id = i.album_id
                WHERE i.community_id = t.community_id AND NOT COALESCE(a.is_au, false) AND t.name = ANY(i.tags)) AS fora_au
  FROM galeria_tags t
 WHERE t.is_au = false;

UPDATE galeria_tags t SET is_au = true
  FROM _uso u WHERE u.id = t.id AND u.em_au AND NOT u.fora_au;

INSERT INTO galeria_tags (community_id, name, created_by, is_au)
SELECT community_id, name, created_by, true FROM _uso WHERE em_au AND fora_au
ON CONFLICT DO NOTHING;

COMMIT;
