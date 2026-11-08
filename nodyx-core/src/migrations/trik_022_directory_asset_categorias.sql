-- trik_022_directory_asset_categorias.sql
-- A trik_019 trocou as categorias de community_assets (ik, au, staff, bulk…)
-- mas o directory_assets ficou com o CHECK antigo (migration 076): o push de
-- um asset 'ik'/'au'/'staff' pro diretório seria rejeitado.
--
-- O diretório recebe assets de OUTRAS instâncias também — inclusive do Nodyx
-- upstream, que ainda usa frame/banner/sticker/image. Por isso o novo CHECK é
-- a UNIÃO das duas listas, e nenhuma linha existente é alterada.
-- ('bulk' é privado e nunca é enviado, mas fica aceito por consistência.)

BEGIN;

ALTER TABLE directory_assets DROP CONSTRAINT IF EXISTS valid_asset_type;
ALTER TABLE directory_assets ADD CONSTRAINT valid_asset_type
  CHECK (asset_type = ANY(ARRAY[
    'ik','au','staff','emoji','badge','bulk',
    'sound','video','font','theme',
    'frame','banner','sticker','image'
  ]));

COMMIT;
