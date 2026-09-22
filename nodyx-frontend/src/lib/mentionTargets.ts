/**
 * mentionTargets — quem pode ser marcado com `@`, e como isso vira texto.
 *
 * Dois tipos de alvo, um único notificado:
 *   · MEMBRO  → `@username`
 *   · ALIAS   → `@[Nome do Personagem](username)`
 *
 * Um alias é um apelido DO JOGADOR, não uma entidade mencionável à parte: nas
 * duas formas quem recebe a notificação é `username`. O nome do personagem é
 * rótulo — é o que se lê na cena.
 *
 * Este módulo é compartilhado pelo compositor do chat (textarea) e pelo do
 * fórum (TipTap), que precisam da mesma lista e do mesmo formato de inserção.
 * Antes de existir, cada um teria sua cópia — e é assim que as duas divergem.
 *
 * O formato em si é fixado em dois outros lugares, por serem outros bundles:
 *   · $lib/linkify.ts                        → renderiza
 *   · nodyx-core/src/utils/mentions.ts       → notifica
 */

export interface MentionTarget {
	/** Quem é realmente notificado, nas duas formas. */
	username: string
	avatar: string | null
	/** Nome do personagem. Presente só quando o alvo é um alias. */
	alias?: string
	/** Nome OOC do jogador, para a validação combinada no dropdown. */
	playerName?: string
}

/** O que a pessoa lê na lista: "Kaelen Duvray · rafael" ou "@rafael". */
export function mentionLabel(t: MentionTarget): string {
	return t.alias ? `${t.alias} · ${t.playerName ?? t.username}` : `@${t.username}`
}

/**
 * O texto que entra no compositor. É aqui que a escolha "personagem" se torna
 * uma marcação do jogador — e o único lugar que produz o formato de alias.
 */
export function mentionInsertText(t: MentionTarget): string {
	return t.alias ? `@[${t.alias}](${t.username})` : `@${t.username}`
}

interface AliasResposta {
	alias: string
	username: string
	player_name: string
	avatar: string | null
}

/**
 * Um fetch já ancorado na base da API. Injetado em vez de montar a URL aqui:
 * $lib/api resolve a base (que difere entre SSR e browser) e é o que o resto do
 * repo usa. De quebra, o teste passa um duplo e não precisa de rede nem de env.
 */
export type ApiFetch = (path: string, init?: RequestInit) => Promise<Response>

/**
 * Busca membros e aliases em paralelo e devolve uma lista só.
 *
 * Membros primeiro de propósito: quem digita um username o encontra na hora, e
 * quem digita um nome de personagem não casa membro nenhum, então os aliases
 * ocupam a lista naturalmente. Sem abas, sem modo, sem prefixo especial.
 *
 * `/trik/aliases` responde 503 quando o módulo RPG está desligado na instância.
 * Isso NÃO é erro aqui: a lista volta sem aliases e o autocomplete de sempre
 * continua funcionando. Um módulo desligado não pode quebrar o compositor — e,
 * pelo mesmo motivo, a falha de UMA das duas buscas não derruba a outra.
 */
export async function searchMentionTargets(
	api: ApiFetch,
	q: string,
	token?: string,
	limit = 8,
): Promise<MentionTarget[]> {
	const init: RequestInit = token ? { headers: { Authorization: `Bearer ${token}` } } : {}
	const busca = encodeURIComponent(q)

	const [resMembros, resAliases] = await Promise.all([
		api(`/chat/members?q=${busca}`, init).catch(() => null),
		api(`/trik/aliases?q=${busca}`, init).catch(() => null),
	])

	const ler = async <T>(res: Response | null, campo: string): Promise<T[]> => {
		if (!res?.ok) return []
		try {
			return ((await res.json())?.[campo] ?? []) as T[]
		} catch {
			return []
		}
	}

	const membros = (await ler<{ username: string; avatar: string | null }>(resMembros, 'members'))
		.map((m) => ({ username: m.username, avatar: m.avatar }))

	const aliases = (await ler<AliasResposta>(resAliases, 'aliases'))
		.map((a) => ({
			username: a.username,
			avatar: a.avatar,
			alias: a.alias,
			playerName: a.player_name,
		}))

	return [...membros, ...aliases].slice(0, limit)
}
