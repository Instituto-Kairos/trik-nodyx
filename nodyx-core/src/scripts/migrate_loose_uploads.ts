/**
 * migrate_loose_uploads.ts (trik_019)
 *
 * Move as imagens soltas de uploads/posts/ (antigo POST /social/upload: botão
 * de imagem do feed e do DM) para os assets, como Bulk de quem enviou.
 *
 *   1. Descobre o dono de cada arquivo pela referência: status_posts (autor)
 *      e depois dm_messages (remetente). Sem referência → owner da instância.
 *   2. Cria o asset 'bulk' (uploadAsset: hash, webp, thumb em uploads/assets/)
 *      com metadata.legacy_path = 'posts/<arquivo>'.
 *   3. Reescreve /uploads/posts/<arquivo> → /uploads/assets/<novo> em toda
 *      coluna de texto/json do schema public que contenha a URL antiga.
 *   4. Move o original para uploads/posts/_migrados/ (backup; apagar à mão
 *      depois de conferir). URLs antigas que sobrarem (cache, link copiado)
 *      recebem 301 pelo not-found handler do index.ts.
 *
 * Áudio fica onde está: /social/upload continua servindo áudio.
 *
 * Uso (em nodyx-core/, com o .env de produção):
 *   npx tsx src/scripts/migrate_loose_uploads.ts --dry-run
 *   npx tsx src/scripts/migrate_loose_uploads.ts
 */
import 'dotenv/config'
import fs from 'fs/promises'
import path from 'path'
import { db } from '../config/database'
import { uploadAsset } from '../services/assetService'

const DRY_RUN   = process.argv.includes('--dry-run')
const POSTS_DIR = path.join(process.cwd(), 'uploads', 'posts')
const BACKUP    = path.join(POSTS_DIR, '_migrados')

const MIME_BY_EXT: Record<string, string> = {
  '.webp': 'image/webp', '.gif': 'image/gif', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
}

type Col = { table: string; column: string; type: string }

const q = (id: string) => `"${id.replace(/"/g, '""')}"`

async function textColumns(): Promise<Col[]> {
  const { rows } = await db.query<{ table_name: string; column_name: string; data_type: string }>(
    `SELECT c.table_name, c.column_name, c.data_type
       FROM information_schema.columns c
       JOIN information_schema.tables t
         ON t.table_schema = c.table_schema AND t.table_name = c.table_name
      WHERE c.table_schema = 'public'
        AND t.table_type = 'BASE TABLE'
        AND c.is_generated = 'NEVER'
        AND c.data_type IN ('text', 'character varying', 'json', 'jsonb')`
  )
  return rows.map(r => ({ table: r.table_name, column: r.column_name, type: r.data_type }))
}

/** Só as colunas que têm alguma URL /uploads/posts/ (evita varrer tudo por arquivo). */
async function columnsWithLegacyUrls(cols: Col[]): Promise<Col[]> {
  const hits: Col[] = []
  for (const c of cols) {
    const { rows } = await db.query(
      `SELECT 1 FROM ${q(c.table)} WHERE ${q(c.column)}::text LIKE '%/uploads/posts/%' LIMIT 1`
    )
    if (rows.length) hits.push(c)
  }
  return hits
}

async function findOwner(url: string, fallback: string): Promise<{ id: string; via: string }> {
  const post = await db.query<{ author_id: string }>(
    `SELECT author_id FROM status_posts
      WHERE media_url = $1 OR strpos(content, $1) > 0
      ORDER BY created_at ASC LIMIT 1`, [url]
  )
  if (post.rows[0]) return { id: post.rows[0].author_id, via: 'feed' }
  const dm = await db.query<{ sender_id: string }>(
    `SELECT sender_id FROM dm_messages WHERE strpos(content, $1) > 0
      ORDER BY created_at ASC LIMIT 1`, [url]
  )
  if (dm.rows[0]) return { id: dm.rows[0].sender_id, via: 'dm' }
  return { id: fallback, via: 'sem referência → owner' }
}

async function instanceOwner(): Promise<string> {
  const slug = process.env.NODYX_COMMUNITY_SLUG
  const { rows } = await db.query<{ user_id: string }>(
    `SELECT cm.user_id FROM community_members cm
       JOIN communities c ON c.id = cm.community_id
      WHERE cm.role = 'owner' AND ($1::text IS NULL OR c.slug = $1)
      ORDER BY c.created_at ASC LIMIT 1`, [slug ?? null]
  )
  if (!rows[0]) throw new Error('Owner da instância não encontrado.')
  return rows[0].user_id
}

async function main() {
  const entries = await fs.readdir(POSTS_DIR, { withFileTypes: true }).catch(() => [])
  const files = entries
    .filter(e => e.isFile() && MIME_BY_EXT[path.extname(e.name).toLowerCase()])
    .map(e => e.name)

  console.log(`[loose] ${files.length} imagem(ns) em uploads/posts/${DRY_RUN ? ' (dry-run)' : ''}`)
  if (!files.length) return

  const owner = await instanceOwner()
  const cols  = await columnsWithLegacyUrls(await textColumns())
  console.log(`[loose] colunas com URLs antigas: ${cols.map(c => `${c.table}.${c.column}`).join(', ') || '(nenhuma)'}`)

  if (!DRY_RUN) await fs.mkdir(BACKUP, { recursive: true })

  let moved = 0, refs = 0
  for (const name of files) {
    const oldUrl = `/uploads/posts/${name}`
    const who    = await findOwner(oldUrl, owner)

    if (DRY_RUN) {
      console.log(`  ${name} → bulk de ${who.id} (${who.via})`)
      continue
    }

    const buffer = await fs.readFile(path.join(POSTS_DIR, name))
    const asset  = await uploadAsset({
      creatorId:        who.id,
      buffer,
      originalFilename: name,
      mimeType:         MIME_BY_EXT[path.extname(name).toLowerCase()],
      assetType:        'bulk',
      name:             `${who.via === 'dm' ? 'dm' : 'feed'}-${name.slice(0, 8)}`,
      metadata:         { legacy_path: `posts/${name}` },
    })
    const newUrl = `/uploads/${asset.file_path}`

    for (const c of cols) {
      const set = c.type === 'jsonb' || c.type === 'json'
        ? `replace(${q(c.column)}::text, $1, $2)::${c.type}`
        : `replace(${q(c.column)}, $1, $2)`
      const r = await db.query(
        `UPDATE ${q(c.table)} SET ${q(c.column)} = ${set}
          WHERE strpos(${q(c.column)}::text, $1) > 0`, [oldUrl, newUrl]
      )
      refs += r.rowCount ?? 0
    }

    await fs.rename(path.join(POSTS_DIR, name), path.join(BACKUP, name))
    moved++
    console.log(`  ${name} → ${newUrl} (${who.via})`)
  }

  console.log(DRY_RUN
    ? '[loose] dry-run: nada foi alterado.'
    : `[loose] ✓ ${moved} imagem(ns) migrada(s), ${refs} linha(s) reescrita(s). Originais em uploads/posts/_migrados/.`)
}

main()
  .then(() => process.exit(0))
  .catch(err => { console.error('[loose] erro:', err); process.exit(1) })
