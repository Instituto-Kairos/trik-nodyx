import { describe, it, expect } from 'vitest';
import { matchTrikCommand } from './commandRegistry';

describe('matchTrikCommand', () => {
	it('reconhece /registro isolado', () => {
		expect(matchTrikCommand('/registro')).toBe('registro');
	});

	it('reconhece /registro com texto depois', () => {
		expect(matchTrikCommand('/registro algo')).toBe('registro');
	});

	it('reconhece /plaquinha', () => {
		expect(matchTrikCommand('/plaquinha')).toBe('plaquinha');
	});

	it('reconhece /teste', () => {
		expect(matchTrikCommand('/teste')).toBe('teste');
	});

	it('reconhece /levelup', () => {
		expect(matchTrikCommand('/levelup')).toBe('levelup');
	});

	it('é case-insensitive', () => {
		expect(matchTrikCommand('/REGISTRO')).toBe('registro');
	});

	it('ignora espaços nas pontas', () => {
		expect(matchTrikCommand('  /registro  ')).toBe('registro');
	});

	it('não confunde prefixo parecido', () => {
		expect(matchTrikCommand('/registrofoo')).toBeNull();
	});

	it('texto normal não bate', () => {
		expect(matchTrikCommand('oi pessoal')).toBeNull();
	});

	it('string vazia não bate', () => {
		expect(matchTrikCommand('')).toBeNull();
	});
});
