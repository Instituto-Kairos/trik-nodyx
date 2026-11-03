-- trik_016_asset_staff.sql
-- Tipo de asset 'staff': imagens que aparecem só no painel admin
-- (/admin/assets), nunca nos assets públicos (/library). Upload só por
-- owner/admin. O arquivo continua servido em /uploads (a URL não é segredo).
-- 'video' entra junto: já estava em VALID_TYPES (routes/assets.ts) sem constar
-- no CHECK de 074.

BEGIN;

ALTER TABLE community_assets DROP CONSTRAINT IF EXISTS valid_asset_type;
ALTER TABLE community_assets ADD CONSTRAINT valid_asset_type
  CHECK (asset_type = ANY(ARRAY[
    'frame','banner','font','badge','sticker','theme','emoji','sound','image','video','staff'
  ]));

COMMIT;
