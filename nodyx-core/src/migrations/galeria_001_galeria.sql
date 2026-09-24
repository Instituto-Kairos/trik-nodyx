-- galeria_001_galeria.sql
-- Galeria de imagens interna da comunidade — álbuns + imagens com descrição rica.
--
-- Prefixo `galeria_` pelo mesmo motivo do `trik_` (ver trik_001_registro.sql):
-- este fork continua recebendo merges de Pokled/nodyx, cuja numeração é NNN_*.
-- Uma letra ordena sempre depois de qualquer dígito no `.sort()` do runner
-- (scripts/migrate.ts), então não há corrida com o upstream a cada merge.
--
-- Por que não reaproveitar community_assets (a antiga /library): aquilo guarda
-- COSMÉTICOS (molduras, emblemas, fontes, sons) que os perfis referenciam por
-- FK — banner_asset_id, frame_asset_id, badge_asset_id. Misturar fotos de cena
-- ali acoplaria duas coisas de ciclo de vida diferente, e apagar uma imagem da
-- galeria poderia derrubar o perfil de alguém.
--
-- Independente do módulo trik de propósito: a galeria é útil a qualquer
-- comunidade, e o RPG a usa por tags, sem FK para trik_characters.

BEGIN;

-- Álbum: o agrupamento navegável ("Retratos", "Cenas", "Mapas").
CREATE TABLE IF NOT EXISTS galeria_albums (
  id           UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  community_id UUID         NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  name         VARCHAR(100) NOT NULL,
  slug         VARCHAR(100) NOT NULL,
  -- Descrição do álbum é texto simples: quem quiser formatar escreve na imagem.
  description  VARCHAR(500),
  created_by   UUID         REFERENCES users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE (community_id, slug)
);

-- Imagem: um cartão, no modelo do "forum gallery" do Discord — miniatura
-- grande, título curto e um corpo em rich text.
CREATE TABLE IF NOT EXISTS galeria_images (
  id             UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Álbum opcional: uma imagem sem álbum aparece em "Sem álbum", e apagar o
  -- álbum não pode levar as imagens junto (SET NULL, não CASCADE).
  album_id       UUID         REFERENCES galeria_albums(id) ON DELETE SET NULL,
  community_id   UUID         NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  uploader_id    UUID         REFERENCES users(id) ON DELETE SET NULL,

  title          VARCHAR(160) NOT NULL,
  -- HTML já sanitizado no servidor (mesmo sanitize do fórum). Guardar o HTML
  -- e não Markdown mantém o NodyxEditor como única fonte de formatação.
  description    TEXT,

  file_path      TEXT         NOT NULL,   -- ex: "galeria/abc123.webp"
  thumbnail_path TEXT,                    -- miniatura WebP
  file_hash      CHAR(64)     NOT NULL,   -- SHA-256, para deduplicar
  file_size      INTEGER      NOT NULL,
  mime_type      VARCHAR(50)  NOT NULL,
  width          INTEGER,
  height         INTEGER,

  tags           TEXT[]       NOT NULL DEFAULT '{}',

  created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- Listagem por álbum e a home da galeria ordenam por data decrescente.
CREATE INDEX IF NOT EXISTS idx_galeria_images_album   ON galeria_images(album_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_galeria_images_comm    ON galeria_images(community_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_galeria_images_tags    ON galeria_images USING GIN(tags);
CREATE INDEX IF NOT EXISTS idx_galeria_images_hash    ON galeria_images(community_id, file_hash);
CREATE INDEX IF NOT EXISTS idx_galeria_albums_comm    ON galeria_albums(community_id, name);

-- Módulo interno (family 'community'), não a galeria pública de vitrine que o
-- registro `gallery` descreve em config/modules.ts.
INSERT INTO modules (id, family, enabled) VALUES ('galeria', 'community', true)
ON CONFLICT (id) DO NOTHING;

COMMIT;
