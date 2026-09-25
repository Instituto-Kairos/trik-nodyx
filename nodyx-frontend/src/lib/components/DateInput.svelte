<script lang="ts">
	import { t } from '$lib/i18n'
	import { mask, maskedToValue, valueToMasked, onlyDigits, isIncomplete, type DateMode } from '$lib/dateMask'

	/**
	 * Campo de data (e hora) digitado em dd/mm/aaaa [hh:mm], sempre nesse
	 * formato e sempre em 24h, independente do navegador.
	 *
	 * Substitui `<input type="date">` e `<input type="datetime-local">` onde o
	 * formato importa: o widget nativo segue o idioma do navegador (Chrome,
	 * Edge) ou o formato regional do sistema (Firefox), e o `lang` da página é
	 * ignorado — não há como garantir dd/mm/aaaa nem 24h com ele. Ver
	 * $lib/dateMask.
	 *
	 * `value` sai no mesmo formato que o input nativo produzia
	 * (`yyyy-mm-dd` ou `yyyy-mm-ddThh:mm`), então nada muda para quem consome.
	 * Com `name`, um input escondido carrega esse valor no POST do formulário —
	 * é o que permite trocar o campo sem tocar nas actions.
	 */
	let {
		value = $bindable(''),
		mode = 'date',
		name = undefined,
		id = undefined,
		required = false,
		placeholder = undefined,
		class: klass = '',
	}: {
		value?: string
		mode?: DateMode
		name?: string
		id?: string
		required?: boolean
		placeholder?: string
		class?: string
	} = $props()

	const tFn = $derived($t)

	/**
	 * Estado é o punhado de dígitos, nunca o texto formatado — é o que faz o
	 * apagar atravessar a pontuação e o que preserva a hora quando o campo
	 * alterna para "dia inteiro" e volta (os dígitos 9-12 continuam aqui,
	 * apenas fora do que se vê).
	 */
	let digitos = $state(onlyDigits(valueToMasked(value, 'datetime')))
	let inputEl = $state<HTMLInputElement>()

	const visiveis = $derived(mode === 'date' ? digitos.slice(0, 8) : digitos)
	const texto    = $derived(mask(visiveis, mode))
	const payload  = $derived(maskedToValue(texto, mode) ?? '')
	const avisar   = $derived(isIncomplete(texto, mode))

	// `payload` não depende de `value`, então escrever aqui não realimenta.
	$effect(() => { value = payload })

	// Texto começado e não fechado bloqueia o envio com a mensagem nativa do
	// navegador. Campo vazio não entra aqui: quem cuida disso é o `required`.
	$effect(() => {
		inputEl?.setCustomValidity(avisar ? tFn('field.date_incomplete') : '')
	})

	function onInput(e: Event & { currentTarget: HTMLInputElement }) {
		const novo = onlyDigits(e.currentTarget.value, mode)
		// No modo data os dígitos de hora ficam guardados no fim da string.
		digitos = mode === 'date' ? novo.slice(0, 8) + digitos.slice(8, 12) : novo
		// Reescreve o campo na mão: quando o texto mascarado não muda (um
		// caractere inválido, por exemplo), o Svelte não re-renderiza o input
		// e o caractere ficaria visível na tela.
		e.currentTarget.value = mask(mode === 'date' ? digitos.slice(0, 8) : digitos, mode)
	}
</script>

{#if name}
	<input type="hidden" {name} value={payload} />
{/if}

<input
	bind:this={inputEl}
	{id}
	{required}
	type="text"
	inputmode="numeric"
	autocomplete="off"
	maxlength={mode === 'date' ? 10 : 16}
	placeholder={placeholder ?? tFn(mode === 'date' ? 'field.date_mask' : 'field.datetime_mask')}
	value={texto}
	oninput={onInput}
	aria-invalid={avisar}
	class="{klass} {avisar ? 'border-amber-600' : ''}"
/>
