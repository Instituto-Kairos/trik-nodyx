import { describe, it, expect } from 'vitest'
import { findCategoryPath, findCategoryInTree, findCategoryIdPath, type CatNode } from './forumTree'

// On > EUA > Nova Orleans > Instituto Kairos — quatro níveis, todos categorias.
const tree: CatNode[] = [
	{ id: 'c-outro', name: 'Outro', slug: 'outro', children: [] },
	{
		id: 'c-on', name: 'On', slug: 'on',
		children: [{
			id: 'c-eua', name: 'EUA', slug: 'eua',
			children: [{
				id: 'c-no', name: 'Nova Orleans', slug: 'nova-orleans',
				children: [{ id: 'c-ik', name: 'Instituto Kairos', slug: 'instituto-kairos', children: [] }],
			}],
		}],
	},
]

describe('findCategoryPath', () => {
	it('devolve a trilha inteira de uma folha profunda', () => {
		expect(findCategoryPath(tree, 'instituto-kairos')?.map(c => c.name))
			.toEqual(['On', 'EUA', 'Nova Orleans', 'Instituto Kairos'])
	})

	it('aceita UUID tanto quanto slug', () => {
		expect(findCategoryIdPath(tree, 'c-ik')).toEqual(['c-on', 'c-eua', 'c-no', 'c-ik'])
		expect(findCategoryIdPath(tree, 'instituto-kairos')).toEqual(['c-on', 'c-eua', 'c-no', 'c-ik'])
	})

	it('devolve trilha de um só nó para uma raiz', () => {
		expect(findCategoryPath(tree, 'on')?.map(c => c.name)).toEqual(['On'])
	})

	it('devolve null quando a categoria não existe', () => {
		expect(findCategoryPath(tree, 'inexistente')).toBeNull()
	})

	// Um param vazio casaria com o primeiro nó de slug nulo e produziria uma
	// trilha que não corresponde a lugar nenhum. O fil d'Ariane mentiria.
	it('não inventa trilha para um param vazio', () => {
		const semSlug: CatNode[] = [{ id: 'x', name: 'Sem slug', slug: null, children: [] }]
		expect(findCategoryPath(semSlug, '')).toBeNull()
	})

	it('tolera árvore ausente ou nós sem children', () => {
		expect(findCategoryPath(null, 'on')).toBeNull()
		expect(findCategoryPath([{ id: 'a', name: 'A' }], 'a')?.map(c => c.id)).toEqual(['a'])
	})
})

describe('findCategoryInTree', () => {
	it('devolve só o nó alvo', () => {
		expect(findCategoryInTree(tree, 'nova-orleans')?.name).toBe('Nova Orleans')
		expect(findCategoryInTree(tree, 'nada')).toBeNull()
	})
})
