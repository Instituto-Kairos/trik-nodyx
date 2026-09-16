<script lang="ts">
    // ── Équaliseur vocal RÉEL ────────────────────────────────────────────────
    //
    // Remplace les barres FACTICES (une animation CSS en boucle, déclenchée par
    // le seul booléen `speaking` : elles ondulaient à l'identique qu'on chuchote
    // ou qu'on crie, et toutes les personnes avaient exactement le même dessin).
    //
    // Ici on lit le VRAI spectre de la personne via son AnalyserNode, en
    // `requestAnimationFrame`. On ne passe PAS par le store : à 60 fps ça
    // re-rendrait tout le roster pour rien. Même patron que le visualiseur du
    // lecteur audio (AudioRecorder), adapté à la voix.

    import { onDestroy } from 'svelte'
    import { getPeerAnalyser, getLocalAnalyser } from '$lib/voice'

    let {
        socketId = null,
        isMe = false,
        bars = 3,
        color = '#4ade80',
        colors = null,
        height = 12,
        barWidth = 2.5,
        gap = 2,
    }: {
        socketId?: string | null
        isMe?:     boolean
        /** Nombre de barres (ignoré si `colors` est fourni). */
        bars?:     number
        /** Couleur unique. */
        color?:    string
        /** Couleur PAR barre (dégradé) : sa longueur fixe le nombre de barres. */
        colors?:   string[] | null
        height?:   number
        barWidth?: number
        gap?:      number
    } = $props()

    // Repos = barres basses mais visibles (la personne est là, elle se tait).
    const FLOOR = 0.18

    const count = $derived(colors?.length ?? bars)

    let levels = $state<number[]>([])
    let raf: number | null = null
    let buf: Uint8Array<ArrayBuffer> | null = null

    function analyser(): AnalyserNode | null {
        if (isMe) return getLocalAnalyser()
        return socketId ? getPeerAnalyser(socketId) : null
    }

    function tick(): void {
        const n = count
        const a = analyser()
        if (a) {
            if (!buf || buf.length !== a.frequencyBinCount) buf = new Uint8Array(a.frequencyBinCount)
            a.getByteFrequencyData(buf)
            // La voix vit dans le BAS du spectre (~85 Hz à 3,5 kHz). L'analyser
            // couvre jusqu'à ~24 kHz : lire tout le spectre écraserait les barres
            // (le haut est vide en permanence). On ne garde donc que le début.
            const usable   = Math.min(buf.length, 36)
            const bandSize = Math.max(1, Math.floor(usable / n))
            const out: number[] = []
            for (let i = 0; i < n; i++) {
                let sum = 0
                for (let j = 0; j < bandSize; j++) sum += buf[i * bandSize + j]
                const v = sum / (bandSize * 160)     // 0..255 par bin → ~0..1
                out.push(Math.max(FLOOR, Math.min(1, v)))
            }
            levels = out
        } else if (levels.length !== n) {
            levels = Array(n).fill(FLOOR)
        }
        raf = requestAnimationFrame(tick)
    }

    $effect(() => {
        levels = Array(count).fill(FLOOR)
        raf = requestAnimationFrame(tick)
        return () => {
            if (raf !== null) cancelAnimationFrame(raf)
            raf = null
        }
    })

    onDestroy(() => { if (raf !== null) cancelAnimationFrame(raf) })
</script>

<div class="vc-eq" style="height: {height}px; gap: {gap}px" aria-hidden="true">
    {#each levels as l, i (i)}
        <span
            class="vc-eq-bar"
            style="width: {barWidth}px; transform: scaleY({l}); background: {colors?.[i] ?? color}"
        ></span>
    {/each}
</div>

<style>
    .vc-eq {
        display: flex;
        align-items: flex-end;
        flex-shrink: 0;
    }
    .vc-eq-bar {
        display: block;
        height: 100%;
        border-radius: 1px;
        transform-origin: bottom center;
        /* Court, pour lisser le rendu sans traîner derrière la voix. */
        transition: transform 60ms linear;
    }
</style>
