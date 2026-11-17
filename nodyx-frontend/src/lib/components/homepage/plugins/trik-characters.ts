import type { WidgetPlugin } from './_types'
import TrikCharacters from '../widgets/TrikCharacters.svelte'

export default {
	id:      'trik-characters',
	label:   'Meus personagens (RPG)',
	icon:    '🎭',
	desc:    'Cartões dos personagens do jogador logado: nível, barra de xp, média das últimas 5 cenas normais (sem #treino/#aula), maestrias e pendências de level up. Se adapta à largura do espaço onde está. Use a visibilidade "Membros".',
	family:  'gaming',
	phase:   1,
	component: TrikCharacters,
	schema: [
		{ key: 'heading', type: 'text', label: 'Título de seção', placeholder: 'ex : Meus personagens', default: '' },
		{
			key: 'layout', type: 'select', label: 'Disposição', default: 'carousel',
			options: [
				{ value: 'carousel', label: 'Carrossel (um personagem por vez)' },
				{ value: 'list',     label: 'Lista (todos, um embaixo do outro)' },
				{ value: 'grid',     label: 'Grade (todos, lado a lado)' },
			],
			hint: 'A grade põe quantos cartões couberem na largura do widget.',
		},
		{
			key: 'size', type: 'select', label: 'Tamanho', default: 'normal',
			options: [
				{ value: 'compact', label: 'Compacto' },
				{ value: 'normal',  label: 'Normal' },
				{ value: 'large',   label: 'Grande' },
			],
			hint: 'Escala o texto e os espaços do widget inteiro.',
		},
		{ key: 'show_xp', type: 'boolean', label: 'Mostrar barra de xp', default: true },
		{ key: 'show_avg', type: 'boolean', label: 'Mostrar média de xp por cena', default: true },
		{ key: 'show_mastery', type: 'boolean', label: 'Mostrar maestrias e aulas', default: true },
		{
			key: 'mastery_limit', type: 'number', label: 'Máximo de maestrias/aulas por grupo', default: 0, min: 0, max: 50,
			hint: '0 mostra todas. Com um número, o resto vira "+N outras". Útil em espaços pequenos.',
		},
		{
			key: 'show_pending', type: 'boolean', label: 'Mostrar pendências de level up', default: true,
			hint: 'Requisitos de maestria/aula do nível atual e pontos ainda não gastos no /levelup.',
		},
		{
			key: 'accent_color', type: 'color', label: 'Cor de destaque (barra, níveis)', default: '',
			hint: 'Apague o texto do campo ao lado (ex.: #a78bfa) para voltar à cor do tema.',
		},
	],
} satisfies WidgetPlugin
