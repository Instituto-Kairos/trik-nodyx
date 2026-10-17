// Módulo RPG (trik) — Fase 3: tipos e texto dos efeitos (trik_effects),
// compartilhados pelo EffectsEditor (abas Bônus/Panteões) e pela ficha
// completa do personagem (Registros).

export interface TrikEffect {
	id: string;
	effect: string;
	activity: string;
	weapon_id: string | null;
	knowledge_id: string | null;
	weapon_category: string | null;
	knowledge_category: string | null;
	alert_kind: string | null;
	condition_kind: string;
	condition_value: string | null;
	value: string | number | null;
}
export interface CatalogItem {
	id: string;
	name: string;
	category: string | null;
}

const ALERT_LABEL: Record<string, string> = { calor: 'calor', frio: 'frio', umidade: 'ar seco' };
const fmt = (v: string | number | null) => (v === null ? '?' : String(Number(v)).replace('.', ','));
const nameOf = (list: CatalogItem[], id: string | null) => list.find((i) => i.id === id)?.name ?? 'item removido';

/** Frase do efeito, ex.: "×1,5 unidades · à noite". */
export function describeEffect(
	e: TrikEffect,
	weapons: CatalogItem[] = [],
	knowledges: CatalogItem[] = []
): string {
	let text: string;
	switch (e.effect) {
		case 'multiplica': text = `×${fmt(e.value)} unidades`; break;
		case 'reduz_requisito': text = `−${fmt(e.value)} no requisito de nível`; break;
		case 'limite_diario': text = `+${fmt(e.value)} no teto diário`; break;
		case 'anula_alerta': return `Anula alerta laranja de ${ALERT_LABEL[e.alert_kind ?? ''] ?? '?'}`;
		case 'sensibilidade': return `Sensível a ${ALERT_LABEL[e.alert_kind ?? ''] ?? '?'}`;
		case 'espelho': return 'Espelho (usa o conjunto do parceiro jogador, se for melhor)';
		default: text = e.effect;
	}
	if (e.activity === 'treino') text += ' em treino';
	if (e.activity === 'aula') text += ' em aula';
	if (e.weapon_id) text += ` · ${nameOf(weapons, e.weapon_id)}`;
	if (e.knowledge_id) text += ` · ${nameOf(knowledges, e.knowledge_id)}`;
	if (e.weapon_category) text += ` · categoria ${e.weapon_category}`;
	if (e.knowledge_category) text += ` · categoria ${e.knowledge_category}`;
	if (e.condition_kind === 'clima') text += ` · com ${e.condition_value}`;
	if (e.condition_kind === 'periodo') text += e.condition_value === 'noite' ? ' · à noite' : ' · de dia';
	if (e.condition_kind === 'companhia') text += ' · em companhia';
	return text;
}
