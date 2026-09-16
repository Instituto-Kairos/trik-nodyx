import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

// Config Vitest dédiée (séparée de vite.config.ts pour ne pas toucher au build
// SvelteKit statique). Environnement node : suffisant pour crypto.ts, module
// pur (WebCrypto + @noble/*), aucune dépendance à IndexedDB ou au DOM.
export default defineConfig({
	resolve: {
		alias: {
			$lib: fileURLToPath(new URL('./src/lib', import.meta.url)),
		},
	},
	test: {
		environment: 'node',
		include: ['src/**/*.test.ts'],
	},
})
