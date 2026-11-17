-- Visibilidade dos cargos (grades), no estilo dos cargos do Discord.
--
--   · community_grades.hoist     : "exibir separado no painel de membros". Os membros
--                                  online que têm este cargo aparecem agrupados sob ele.
--   · community_grades.is_secret : cargo secreto. NUNCA aparece publicamente (posts,
--                                  perfil, painel de membros, lista de membros). Só a
--                                  equipe o vê, na tela de cargos / membros do admin, e
--                                  a própria pessoa nas configurações. Funciona como
--                                  sempre (permissões, conteúdo privado).
--   · member_grades.show_badge   : escolha da PESSOA: quais dos seus cargos (não
--                                  secretos) ficam visíveis ao lado do nome. Padrão: todos.

BEGIN;

ALTER TABLE community_grades ADD COLUMN IF NOT EXISTS hoist     BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE community_grades ADD COLUMN IF NOT EXISTS is_secret BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE member_grades    ADD COLUMN IF NOT EXISTS show_badge BOOLEAN NOT NULL DEFAULT true;

-- Até aqui TODO cargo agrupava os membros online no painel : os cargos que já existem
-- continuam assim (separados). Os criados depois começam desmarcados, como no Discord.
UPDATE community_grades SET hoist = true;

-- Um cargo secreto nunca é "separado" no painel: separar revelaria quem o tem.
ALTER TABLE community_grades DROP CONSTRAINT IF EXISTS community_grades_secret_not_hoisted;
ALTER TABLE community_grades ADD CONSTRAINT community_grades_secret_not_hoisted CHECK (NOT (is_secret AND hoist));

COMMIT;
