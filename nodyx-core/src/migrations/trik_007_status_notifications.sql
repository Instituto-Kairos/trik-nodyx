-- trik_007_status_notifications.sql
-- Notificações do feed (status_posts): resposta, reação e repost num post seu.
--
-- notifications.post_id aponta para posts (fórum), então o feed ganha uma
-- coluna própria. CASCADE: apagar o status apaga as notificações sobre ele, e
-- o "Ver" nunca leva a um post que não existe mais.

BEGIN;

ALTER TABLE notifications
  ADD COLUMN IF NOT EXISTS status_post_id UUID REFERENCES status_posts(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_notif_status_post ON notifications(status_post_id)
  WHERE status_post_id IS NOT NULL;

COMMIT;
