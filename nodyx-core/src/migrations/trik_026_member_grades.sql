-- Vários cargos (grades) por membro.
--
-- Até aqui um membro tinha no máximo UM cargo: community_members.grade_id.
-- Agora member_grades guarda TODOS os cargos da pessoa. community_members.grade_id
-- continua existindo como cargo PRINCIPAL: é o que aparece ao lado do nome (posts,
-- perfil, listas), então nada do que já lê esse campo precisa mudar. Invariante
-- mantida pelo banco (trigger abaixo): o cargo principal está sempre em member_grades.
--
-- Permissões e conteúdo privado passam a considerar a UNIÃO de todos os cargos.

BEGIN;

CREATE TABLE IF NOT EXISTS member_grades (
  community_id UUID      NOT NULL,
  user_id      UUID      NOT NULL,
  grade_id     UUID      NOT NULL REFERENCES community_grades(id) ON DELETE CASCADE,
  assigned_at  TIMESTAMP NOT NULL DEFAULT NOW(),
  PRIMARY KEY (community_id, user_id, grade_id),
  -- Saiu ou foi banido da comunidade: perde os cargos (como já perdia o grade_id)
  FOREIGN KEY (community_id, user_id) REFERENCES community_members(community_id, user_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_member_grades_grade ON member_grades(grade_id);
CREATE INDEX IF NOT EXISTS idx_member_grades_user  ON member_grades(user_id);

-- Quem já tinha cargo continua com ele
INSERT INTO member_grades (community_id, user_id, grade_id)
SELECT cm.community_id, cm.user_id, cm.grade_id
  FROM community_members cm
  JOIN community_grades g ON g.id = cm.grade_id AND g.community_id = cm.community_id
 WHERE cm.grade_id IS NOT NULL
ON CONFLICT DO NOTHING;

-- O cargo principal entra sozinho em member_grades. Cobre tudo que ainda grava
-- grade_id direto: cargo automático do OctoGuard, volta de um banimento temporário...
CREATE OR REPLACE FUNCTION nx_sync_primary_grade() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.grade_id IS NOT NULL THEN
    INSERT INTO member_grades (community_id, user_id, grade_id)
    VALUES (NEW.community_id, NEW.user_id, NEW.grade_id)
    ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS trg_sync_primary_grade ON community_members;
CREATE TRIGGER trg_sync_primary_grade
  AFTER INSERT OR UPDATE OF grade_id ON community_members
  FOR EACH ROW EXECUTE FUNCTION nx_sync_primary_grade();

-- Um banimento apaga a linha do membro (e com ela os cargos): guarda todos pra devolver.
ALTER TABLE community_bans ADD COLUMN IF NOT EXISTS prev_grade_ids UUID[];

-- ── Conteúdo privado: qualquer um dos cargos vale ─────────────────────────────

-- Equipe da comunidade: vê todo conteúdo privado.
CREATE OR REPLACE FUNCTION nx_is_content_staff(p_community UUID, p_user UUID)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT p_user IS NOT NULL AND EXISTS (
    SELECT 1
      FROM community_members cm
     WHERE cm.community_id = p_community
       AND cm.user_id      = p_user
       AND (cm.role IN ('moderator', 'admin', 'owner')
            OR EXISTS (
              SELECT 1
                FROM member_grades mg
                JOIN community_grades g ON g.id = mg.grade_id
               WHERE mg.community_id = cm.community_id
                 AND mg.user_id      = cm.user_id
                 AND (COALESCE(g.permissions->>'moderate_content', '') = 'true'
                      OR COALESCE(g.permissions->>'manage_categories', '') = 'true')))
  )
$$;

-- A pessoa tem algum dos cargos exigidos por esta categoria (sem herança).
CREATE OR REPLACE FUNCTION nx_category_self_open(p_category UUID, p_community UUID, p_user UUID)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT NOT EXISTS (SELECT 1 FROM category_grades WHERE category_id = p_category)
      OR (p_user IS NOT NULL AND EXISTS (
            SELECT 1
              FROM category_grades cg
              JOIN member_grades mg ON mg.grade_id = cg.grade_id
             WHERE cg.category_id  = p_category
               AND mg.user_id      = p_user
               AND mg.community_id = p_community))
$$;

-- Tópico visível: categoria visível E (tópico sem lista OU pessoa com um dos cargos), ou equipe.
CREATE OR REPLACE FUNCTION nx_can_view_thread(p_thread UUID, p_user UUID)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT COALESCE((
    SELECT CASE
      WHEN NOT EXISTS (SELECT 1 FROM thread_grades WHERE thread_id = t.id)
        THEN nx_can_view_category(t.category_id, p_user)
      WHEN nx_is_content_staff(c.community_id, p_user) THEN true
      ELSE nx_can_view_category(t.category_id, p_user)
           AND p_user IS NOT NULL
           AND EXISTS (
             SELECT 1
               FROM thread_grades tg
               JOIN member_grades mg ON mg.grade_id = tg.grade_id
              WHERE tg.thread_id     = t.id
                AND mg.user_id       = p_user
                AND mg.community_id  = c.community_id)
    END
      FROM threads t JOIN categories c ON c.id = t.category_id
     WHERE t.id = p_thread
  ), false)
$$;

COMMIT;
