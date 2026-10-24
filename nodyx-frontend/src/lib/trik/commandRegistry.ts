// Módulo RPG (trik) — registro de comandos que abrem modal em vez de
// enviar mensagem de chat. Ver plans/fase-um.md, seção 3.

export const TRIK_COMMANDS = {
	'/registro': 'registro',
	'/plaquinha': 'plaquinha',
	// Fase 2 — distribui pontos ganhos ao subir de nível (Conduct/Principles/
	// Preferências) e escolhe Objetivo quando desbloqueado.
	'/levelup': 'levelup',
	// Fase 3 — escolhe/troca os interesses primário e secundário (troca semanal).
	'/interesse': 'interesse',
	// Universo Alternativo (trik_013) — aliases livres, que só valem no AU.
	'/alias-au': 'alias-au',
	// /teste: comando de teste — marca (@menciona) quem mandou, sem modal,
	// só pra validar a notificação/link de @menção do bot Trik.
	'/teste': 'teste'
} as const;

export type TrikCommandId = (typeof TRIK_COMMANDS)[keyof typeof TRIK_COMMANDS];

export function matchTrikCommand(input: string): TrikCommandId | null {
	const first = input.trim().split(/\s/)[0]?.toLowerCase();
	if (!first) return null;
	return (TRIK_COMMANDS as Record<string, TrikCommandId>)[first] ?? null;
}
