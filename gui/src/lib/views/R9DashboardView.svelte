<script lang="ts">
	import { onMount } from 'svelte';
	import { r9 } from '$lib/stores/r9.svelte';
	import RotateCw from '@lucide/svelte/icons/rotate-cw';
	import ExternalLink from '@lucide/svelte/icons/external-link';
	import Square from '@lucide/svelte/icons/square';
	import Play from '@lucide/svelte/icons/play';
	import Loader2 from '@lucide/svelte/icons/loader-2';

	const DASHBOARD_URL = 'http://localhost:20128/dashboard';

	let reloadKey = $state(0);
	let triedAutoStart = $state(false);

	onMount(() => {
		r9.startPolling();
	});

	$effect(() => {
		if (
			!triedAutoStart &&
			r9.status.resolved !== 'missing' &&
			!r9.status.running &&
			!r9.busy
		) {
			triedAutoStart = true;
			r9.start();
		}
	});

	let prevRunning: boolean = $state(false);
	$effect(() => {
		if (r9.status.running && !prevRunning) {
			reloadKey += 1;
		}
		prevRunning = r9.status.running;
	});

	function reload() {
		reloadKey += 1;
	}

	async function startManually() {
		triedAutoStart = true;
		await r9.start();
	}

	async function stopRouter() {
		await r9.stop();
	}
</script>

<div class="flex flex-col h-full">
	<header class="flex items-center gap-2 px-4 py-2 border-b border-border bg-card flex-shrink-0">
		<div class="flex items-center gap-2 text-xs">
			<span class="font-semibold">9Router</span>
			{#if r9.status.running}
				<span class="px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30">
					running
				</span>
				{#if r9.status.pid}
					<span class="text-muted-foreground">pid {r9.status.pid}</span>
				{/if}
				<span class="text-muted-foreground">:{r9.status.port}</span>
			{:else if r9.status.resolved === 'missing'}
				<span class="px-1.5 py-0.5 rounded bg-muted text-muted-foreground border border-border">
					not installed
				</span>
			{:else}
				<span class="px-1.5 py-0.5 rounded bg-muted text-muted-foreground border border-border">
					stopped
				</span>
			{/if}
		</div>

		<div class="ml-auto flex items-center gap-1">
			{#if r9.status.running}
				<button
					title="Reload dashboard"
					class="p-1.5 rounded hover:bg-secondary text-muted-foreground hover:text-foreground"
					onclick={reload}
				>
					<RotateCw size={14} />
				</button>
				<button
					title="Open in external browser"
					class="p-1.5 rounded hover:bg-secondary text-muted-foreground hover:text-foreground"
					onclick={() => r9.openDashboard()}
				>
					<ExternalLink size={14} />
				</button>
				<button
					title="Stop 9Router"
					class="p-1.5 rounded hover:bg-secondary text-muted-foreground hover:text-foreground disabled:opacity-50"
					disabled={r9.busy}
					onclick={stopRouter}
				>
					{#if r9.busy}
						<Loader2 size={14} class="animate-spin" />
					{:else}
						<Square size={14} />
					{/if}
				</button>
			{:else if r9.status.resolved !== 'missing'}
				<button
					title="Start 9Router"
					class="p-1.5 rounded hover:bg-secondary text-muted-foreground hover:text-foreground disabled:opacity-50"
					disabled={r9.busy}
					onclick={startManually}
				>
					{#if r9.busy}
						<Loader2 size={14} class="animate-spin" />
					{:else}
						<Play size={14} />
					{/if}
				</button>
			{/if}
		</div>
	</header>

	<div class="flex-1 relative bg-background min-h-0">
		{#if r9.status.resolved === 'missing'}
			<div class="flex flex-col items-center justify-center h-full p-8 text-center">
				<div class="text-sm text-muted-foreground max-w-md space-y-3">
					<p class="font-semibold text-foreground">9Router chưa được cài đặt.</p>
					<p>Mở terminal và chạy:</p>
					<code class="block px-3 py-2 rounded bg-muted font-mono text-xs">npm i -g 9router</code>
					<p class="text-xs">Sau khi cài xong, restart Agentry để re-detect.</p>
				</div>
			</div>
		{:else if !r9.status.running}
			<div class="flex flex-col items-center justify-center h-full gap-3">
				{#if r9.busy}
					<Loader2 size={24} class="animate-spin text-muted-foreground" />
					<div class="text-sm text-muted-foreground">Starting 9Router…</div>
				{:else}
					<div class="text-sm text-muted-foreground">9Router stopped.</div>
					<button
						class="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded border border-border hover:bg-accent"
						onclick={startManually}
					>
						<Play size={12} /> Start 9Router
					</button>
				{/if}
				{#if r9.lastError}
					<div class="mt-2 max-w-md text-xs bg-destructive/10 border border-destructive/30 rounded px-3 py-2 font-mono">
						{r9.lastError}
					</div>
				{/if}
			</div>
		{:else}
			{#key reloadKey}
				<iframe
					title="9Router Dashboard"
					src={DASHBOARD_URL}
					class="w-full h-full border-0 bg-white"
					sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-downloads"
				></iframe>
			{/key}
		{/if}
	</div>
</div>
