import type { WidgetPlugin } from './_types'
import TrikCharacters from '../widgets/TrikCharacters.svelte'

export default {
	id:      'trik-characters',
	label:   'Meus personagens (RPG)',
	icon:    '🎭',
	desc:    'Carrossel dos personagens do jogador logado: nível, barra de xp, média das últimas 5 cenas normais (sem #treino/#aula), maestrias e pendências de level up. Use a visibilidade "Membros".',
	family:  'gaming',
	phase:   1,
	component: TrikCharacters,
	schema: [
		{ key: 'heading', type: 'text', label: 'Título de seção', placeholder: 'ex : Meus personagens', default: '' },
		{ key: 'show_mastery', type: 'boolean', label: 'Mostrar maestrias e aulas', default: true },
		{
			key: 'show_pending', type: 'boolean', label: 'Mostrar pendências de level up', default: true,
			hint: 'Requisitos de maestria/aula do nível atual e pontos ainda não gastos no /levelup.',
		},
	],
} satisfies WidgetPlugin
