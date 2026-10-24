-- trik_013_au.sql
-- Módulo RPG (trik) — Universo Alternativo (AU) jogado no mesmo fórum.
--
-- O AU não tem XP nem personagem: é uma árvore de categorias à parte, com os
-- próprios NPCCs (AU > NPCCs), um álbum de NPCs próprio na galeria e aliases
-- livres por jogador (/alias-au). O que separa os dois universos é o CONTEXTO
-- da menção: dentro do AU o autocomplete só oferece coisas do AU, fora dele
-- as do AU somem.

BEGIN;

-- Raízes do AU. Ao contrário de trik_notify_categories, AQUI HÁ herança:
-- marcar a raiz põe toda a subárvore no AU (isAuCategory sobe pelo parent_id).
-- Tabela própria em vez de coluna em categories: categories é do upstream.
CREATE TABLE IF NOT EXISTS trik_au_categories (
  category_id  UUID PRIMARY KEY REFERENCES categories(id) ON DELETE CASCADE,
  enabled_by   UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Aliases do AU: rótulo livre, sem limite de quantidade e sem ficha por
-- trás. Mencioná-lo notifica o jogador (user_id), igual alias de personagem.
-- Pertence ao usuário, não a trik_players: jogar no AU não exige /registro.
CREATE TABLE IF NOT EXISTS trik_au_aliases (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        VARCHAR(100) NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_trik_au_aliases_name
  ON trik_au_aliases (user_id, lower(name));

-- Álbum AU na galeria: some da visão "Todas" e só aparece no "Ver AU". O
-- álbum NPC do AU é um álbum AU chamado "NPC"/"NPCs".
ALTER TABLE galeria_albums
  ADD COLUMN IF NOT EXISTS is_au BOOLEAN NOT NULL DEFAULT FALSE;

COMMIT;
