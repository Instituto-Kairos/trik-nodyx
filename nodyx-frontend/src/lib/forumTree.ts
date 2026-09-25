// ─── Travessia da árvore de categorias ──────────────────────────────────────
//
// As categorias aninham sem limite de profundidade (`parent_id`, migração 005),
// e `GET /instance/categories` devolve a árvore inteira já montada em `children`.
// Três caminhadores independentes faziam essa descida em três arquivos — o
// loader da categoria, o seletor em cascata de novo tópico e (em SQL) o delete
// do admin. Dois deles descartavam os ancestrais no caminho, que é justamente
// o que um fil d'Ariane precisa. Este módulo é a descida única.

export interface CatNode {
	id:        string
	name:      string
	slug?:     string | null
	children?: CatNode[]
	[extra: string]: unknown
}

/**
 * Trilha da raiz até a categoria alvo, inclusive — `null` se não achar.
 *
 * `param` aceita UUID **ou** slug: os links do fórum usam os dois (o slug é a
 * forma canônica, o UUID sobrevive em links antigos e leva a um 301).
 */
export function findCategoryPath(cats: CatNode[] | null | undefined, param: string): CatNode[] | null {
	// Sem alvo não há trilha. Sem esta guarda, um `param` vazio casaria com o
	// primeiro nó de `slug` nulo e devolveria uma trilha inventada.
	if (!param) return null

	for (const cat of cats ?? []) {
		if (cat.id === param || (cat.slug != null && cat.slug === param)) return [cat]
		const sub = findCategoryPath(cat.children, param)
		if (sub) return [cat, ...sub]
	}
	return null
}

/** Só o nó alvo, sem os ancestrais. Atalho sobre `findCategoryPath`. */
export function findCategoryInTree(cats: CatNode[] | null | undefined, param: string): CatNode | null {
	const path = findCategoryPath(cats, param)
	return path ? path[path.length - 1] : null
}

/** Trilha reduzida a ids, na ordem raiz → alvo. */
export function findCategoryIdPath(cats: CatNode[] | null | undefined, param: string): string[] | null {
	return findCategoryPath(cats, param)?.map(c => c.id) ?? null
}
