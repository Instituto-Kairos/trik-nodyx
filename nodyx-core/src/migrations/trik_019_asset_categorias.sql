-- trik_019_asset_categorias.sql
-- Categorias dos assets passam a ser: IK, AU, Staff, Emotes (emoji),
-- Emblemas (badge) e Bulk. Banner/ícone/moldura saíram do produto, então
-- 'frame', 'banner', 'sticker' e o genérico 'image' deixam de existir: o que
-- havia neles vai para o Bulk de quem enviou, e cada um reclassifica depois.
--
-- 'bulk' é privado: só o criador (e o owner, no /admin/assets) vê. Por isso
-- is_public acompanha o tipo (bulk → false), o que já o tira da busca pública
-- e da sincronização com o diretório.
--
-- 'sound', 'video', 'font' e 'theme' ficam como tipos internos (soundboard,
-- /admin/media, música), fora das categorias da biblioteca.

BEGIN;

-- O constraint antigo não aceita 'bulk': derrubar ANTES do UPDATE.
ALTER TABLE community_assets DROP CONSTRAINT IF EXISTS valid_asset_type;

UPDATE community_assets
   SET asset_type = 'bulk', is_public = false
 WHERE asset_type IN ('image', 'sticker', 'frame', 'banner');

ALTER TABLE community_assets ADD CONSTRAINT valid_asset_type
  CHECK (asset_type = ANY(ARRAY[
    'ik','au','staff','emoji','badge','bulk',
    'sound','video','font','theme'
  ]));

CREATE INDEX IF NOT EXISTS idx_assets_bulk_creator
  ON community_assets(creator_id, created_at DESC) WHERE asset_type = 'bulk';

-- Redirect das URLs antigas /uploads/posts/<x> (index.ts → not-found handler).
CREATE INDEX IF NOT EXISTS idx_assets_legacy_path
  ON community_assets ((metadata->>'legacy_path')) WHERE metadata ? 'legacy_path';

COMMIT;
