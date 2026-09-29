-- trik_003_notify_categories.sql
-- Módulo RPG (trik) — categorias do fórum em que TODO post (abertura de
-- tópico ou resposta) notifica todos os membros da comunidade.
--
-- Granularidade por categoria individual, sem herança: marcar uma categoria
-- NÃO inclui as subcategorias dela. A tela /admin/trik/notificacoes mostra a
-- árvore e o admin marca uma a uma — é isso que dá o "filtro de
-- subcategoria" (ex.: notificar "Cenas" e "Cenas › Eventos", mas não
-- "Cenas › Off"). Só a existência da linha importa, igual a trik_threads.

BEGIN;

CREATE TABLE IF NOT EXISTS trik_notify_categories (
  category_id  UUID PRIMARY KEY REFERENCES categories(id) ON DELETE CASCADE,
  enabled_by   UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Deduplicação em notifyCategoryPost (models/trik.ts): acha a notificação
-- não lida do mesmo tópico pra atualizá-la em vez de empilhar outra.
CREATE INDEX IF NOT EXISTS idx_notif_category_post_unread
  ON notifications (thread_id, user_id)
  WHERE type = 'category_post' AND is_read = false;

COMMIT;
