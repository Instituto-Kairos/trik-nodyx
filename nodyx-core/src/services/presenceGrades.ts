// Cargos mostrados no painel de membros e no presence, atualizados ao vivo.
//
// O socket guarda os cargos visíveis da pessoa na conexão (socket.data.grade /
// grades). Quando eles mudam (a pessoa escolhe o que mostrar, a equipe dá ou
// tira um cargo) este serviço relê do banco, atualiza os sockets dela e avisa
// o painel : sem isso o painel só mudaria na próxima conexão.
// Nunca lança : é só um complemento visual.

import { db } from '../config/database'
import { io } from '../socket/io'
import { visibleGradeJoin, visibleGradesJson } from '../models/grade'

interface Row {
  grade_name:  string | null
  grade_color: string | null
  grades:      { id: string; name: string; color: string; hoist: boolean; position: number }[] | null
}

export async function publishGrades(communityId: string, userId: string): Promise<void> {
  if (!io) return
  try {
    const { rows } = await db.query<Row>(
      `SELECT g.name AS grade_name, g.color AS grade_color, ${visibleGradesJson('cm')} AS grades
         FROM community_members cm
         ${visibleGradeJoin('g', 'cm')}
        WHERE cm.community_id = $1 AND cm.user_id = $2`,
      [communityId, userId]
    )
    const r = rows[0]
    const grade  = r?.grade_name ? { name: r.grade_name, color: r.grade_color! } : null
    const grades = (r?.grades ?? []).map(x => ({ name: x.name, color: x.color, hoist: !!x.hoist, position: x.position ?? 0 }))

    const sockets = await io.in(`user:${userId}`).fetchSockets().catch(() => [])
    for (const s of sockets) { s.data.grade = grade; s.data.grades = grades }

    io.to('presence').emit('presence:grades_update', { userId, grade, grades })
  } catch { /* visual apenas */ }
}

/** Todos os que têm este cargo (editado: nome, cor, separado, secreto) : o painel os relê. */
export async function publishGradeHolders(communityId: string, gradeId: string): Promise<void> {
  if (!io) return
  try {
    const { rows } = await db.query<{ user_id: string }>(
      `SELECT user_id FROM member_grades WHERE community_id = $1 AND grade_id = $2 LIMIT 500`,
      [communityId, gradeId]
    )
    for (const r of rows) await publishGrades(communityId, r.user_id)
  } catch { /* visual apenas */ }
}
