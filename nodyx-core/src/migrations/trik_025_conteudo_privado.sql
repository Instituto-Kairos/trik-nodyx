-- trik_025_conteudo_privado.sql
-- Categorias e tópicos visíveis só para certos cargos (grades).
--
--   · category_grades: uma categoria com pelo menos uma linha aqui é PRIVADA,
--     visível só para quem tem um desses cargos. Subcategorias herdam: para ver
--     uma categoria é preciso passar por ela e por todas as de cima.
--   · thread_grades: o mesmo, por tópico. Lista vazia = segue a categoria.
--     As duas regras se somam (categoria E tópico).
--   · A equipe vê tudo: role moderator/admin/owner na comunidade, ou um cargo
--     com moderate_content ou manage_categories.
--   · Visitante sem conta (uid NULL) só vê o que não tem restrição.
--
-- A regra mora em funções SQL para que TODA consulta (lista, busca, feed,
-- sitemap, cartas de link...) use exatamente a mesma lógica:
--   nx_can_view_category(category_id, user_id)
--   nx_can_view_thread(thread_id, user_id)

BEGIN;

CREATE TABLE IF NOT EXISTS category_grades (
  category_id UUID NOT NULL REFERENCES categories(id)       ON DELETE CASCADE,
  grade_id    UUID NOT NULL REFERENCES community_grades(id) ON DELETE CASCADE,
  PRIMARY KEY (category_id, grade_id)
);
CREATE INDEX IF NOT EXISTS idx_category_grades_grade ON category_grades(grade_id);

CREATE TABLE IF NOT EXISTS thread_grades (
  thread_id UUID NOT NULL REFERENCES threads(id)          ON DELETE CASCADE,
  grade_id  UUID NOT NULL REFERENCES community_grades(id) ON DELETE CASCADE,
  PRIMARY KEY (thread_id, grade_id)
);
CREATE INDEX IF NOT EXISTS idx_thread_grades_grade ON thread_grades(grade_id);

-- Equipe da comunidade: vê todo conteúdo privado.
CREATE OR REPLACE FUNCTION nx_is_content_staff(p_community UUID, p_user UUID)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT p_user IS NOT NULL AND EXISTS (
    SELECT 1
      FROM community_members cm
      LEFT JOIN community_grades g ON g.id = cm.grade_id
     WHERE cm.community_id = p_community
       AND cm.user_id      = p_user
       AND (cm.role IN ('moderator', 'admin', 'owner')
            OR COALESCE(g.permissions->>'moderate_content', '') = 'true'
            OR COALESCE(g.permissions->>'manage_categories', '') = 'true')
  )
$$;

-- A pessoa tem algum dos cargos exigidos por esta categoria (sem herança).
CREATE OR REPLACE FUNCTION nx_category_self_open(p_category UUID, p_community UUID, p_user UUID)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT NOT EXISTS (SELECT 1 FROM category_grades WHERE category_id = p_category)
      OR (p_user IS NOT NULL AND EXISTS (
            SELECT 1
              FROM category_grades cg
              JOIN community_members cm ON cm.grade_id = cg.grade_id
             WHERE cg.category_id  = p_category
               AND cm.user_id      = p_user
               AND cm.community_id = p_community))
$$;

-- Categoria visível: equipe, ou aberta em toda a cadeia até a raiz.
CREATE OR REPLACE FUNCTION nx_can_view_category(p_category UUID, p_user UUID)
RETURNS boolean LANGUAGE sql STABLE AS $$
  WITH RECURSIVE chain AS (
    SELECT id, parent_id, community_id, 1 AS depth FROM categories WHERE id = p_category
    UNION ALL
    SELECT c.id, c.parent_id, c.community_id, chain.depth + 1
      FROM categories c JOIN chain ON c.id = chain.parent_id
     WHERE chain.depth < 32
  )
  SELECT CASE
    -- caminho rápido: nada restrito na cadeia (o caso de quase toda categoria)
    WHEN NOT EXISTS (SELECT 1 FROM category_grades cg JOIN chain ON chain.id = cg.category_id) THEN true
    WHEN nx_is_content_staff((SELECT community_id FROM chain WHERE depth = 1), p_user) THEN true
    ELSE NOT EXISTS (SELECT 1 FROM chain WHERE NOT nx_category_self_open(chain.id, chain.community_id, p_user))
  END
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
               JOIN community_members cm ON cm.grade_id = tg.grade_id
              WHERE tg.thread_id     = t.id
                AND cm.user_id       = p_user
                AND cm.community_id  = c.community_id)
    END
      FROM threads t JOIN categories c ON c.id = t.category_id
     WHERE t.id = p_thread
  ), false)
$$;

-- Algo restrito (para não indexar, não anunciar em webhook, não mandar ao feed público).
CREATE OR REPLACE FUNCTION nx_thread_is_restricted(p_thread UUID)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT NOT nx_can_view_thread(p_thread, NULL)
$$;

COMMIT;
