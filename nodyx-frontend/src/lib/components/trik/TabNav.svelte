<script lang="ts">
	// Barra de abas do painel admin do módulo RPG (trik) — usada tanto na
	// navegação entre páginas (admin/trik/+layout.svelte) quanto nas abas por
	// querystring dentro de uma página (?type=…). Quem chama decide o que é
	// "ativa"; aqui só a aparência.
	let { tabs }: { tabs: { href: string; label: string; active: boolean }[] } = $props();
</script>

<nav class="flex gap-1 border-b border-gray-800">
	{#each tabs as tab (tab.href)}
		<a
			href={tab.href}
			class="px-4 py-2 text-sm border-b-2 transition-colors {tab.active
				? 'border-indigo-500 text-white font-medium'
				: 'border-transparent text-gray-500 hover:text-gray-300'}"
		>
			{tab.label}
		</a>
	{/each}
</nav>
