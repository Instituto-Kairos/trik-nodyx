import { contrast } from '$lib/shellTheme'

/**
 * Cor de texto legível sobre o fundo `bg`: preto ou branco, o que der mais
 * contraste. Cor inválida cai no branco.
 */
export function tagTextColor(bg: string): string {
	try {
		return contrast(bg, '#111111') >= contrast(bg, '#ffffff') ? '#111111' : '#ffffff'
	} catch {
		return '#ffffff'
	}
}

/**
 * Estilo inline de um selo de tag: fundo sólido na cor da tag + texto
 * contrastante. Antes o texto usava a própria cor da tag sobre um fundo
 * translúcido, e tags escuras (ou claras no tema claro) ficavam ilegíveis.
 */
export function tagBadgeStyle(color: string): string {
	return `background-color: ${color}; color: ${tagTextColor(color)}; border: 1px solid ${color}`
}
