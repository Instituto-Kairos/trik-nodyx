-- trik_027_grades_mentionable.sql
-- Cargo marcável: decide se @<cargo> (g:grade:<id>) avisa os portadores.
--
--   · TRUE (padrão, mantém o comportamento de antes): qualquer membro marca.
--   · FALSE: só a equipe (dono, admins, moderadores, ou cargo com algum
--     direito — isTeam em services/mentionGroups.ts) consegue marcar; para os
--     outros o cargo some do autocomplete e a marca não avisa ninguém.
--     Mesma regra que o @tous já seguia.

BEGIN;

ALTER TABLE community_grades
  ADD COLUMN IF NOT EXISTS mentionable BOOLEAN NOT NULL DEFAULT TRUE;

COMMIT;
