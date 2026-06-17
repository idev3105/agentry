<script lang="ts">
	import { onMount } from 'svelte';
	import { r9 } from '$lib/stores/r9.svelte';
	import { Button } from '$lib/components/ui/button';
	import { Badge } from '$lib/components/ui/badge';
	import RotateCw from '@lucide/svelte/icons/rotate-cw';
	import ExternalLink from '@lucide/svelte/icons/external-link';
	import Square from '@lucide/svelte/icons/square';
	import Play from '@lucide/svelte/icons/play';
	import Loader2 from '@lucide/svelte/icons/loader-2';
	import ZoomIn from '@lucide/svelte/icons/zoom-in';
	import ZoomOut from '@lucide/svelte/icons/zoom-out';

	const DASHBOARD_URL = 'http://localhost:20128/dashboard';

	let reloadKey = $state(0);
	let triedAutoStart = $state(false);

	// Manual dashboard zoom multiplier (default 100%), persisted.
	//
	// Sizing strategy (cross-origin iframe → we cannot read or restyle the inner
	// document, and on WebKitGTK `width/height:100%` gives the iframe a viewport
	// wider than its box so the page overflows + shows scrollbars):
	//   • Give the iframe a FIXED logical viewport width (BASE_WIDTH) so 9router
	//     always lays out at a known desktop width.
	//   • Scale it down with transform:scale(fit) so that BASE_WIDTH renders
	//     exactly to the container width → no horizontal overflow, no h-scrollbar.
	//   • The manual zoom multiplies that fit factor for user fine-tuning.
	const ZOOM_KEY = 'agentry:r9:zoom';
	const ZMIN = 0.5;
	const ZMAX = 1.5;
	const ZSTEP = 0.1;
	const BASE_WIDTH = 1440; // logical viewport handed to the dashboard
	function loadZoom(): number {
		const n = Number(localStorage.getItem(ZOOM_KEY) ?? '1');
		return Number.isFinite(n) && n >= ZMIN && n <= ZMAX ? n : 1;
	}
	let dashZoom = $state(loadZoom());
	$effect(() => {
		localStorage.setItem(ZOOM_KEY, String(dashZoom));
	});
	const clampZoom = (z: number) => Math.min(ZMAX, Math.max(ZMIN, Math.round(z * 100) / 100));
	function zoomIn() { dashZoom = clampZoom(dashZoom + ZSTEP); }
	function zoomOut() { dashZoom = clampZoom(dashZoom - ZSTEP); }
	function zoomReset() { dashZoom = 1; }
	let zoomPct = $derived(Math.round(dashZoom * 100));

	// Measure the container so we can compute the fit-to-width factor.
	let viewport = $state<HTMLDivElement | null>(null);
	let boxW = $state(0);
	let boxH = $state(0);
	$effect(() => {
		const el = viewport;
		if (!el) return;
		const ro = new ResizeObserver((entries) => {
			const r = entries[0]?.contentRect;
			if (r) {
				boxW = Math.round(r.width);
				boxH = Math.round(r.height);
			}
		});
		ro.observe(el);
		return () => ro.disconnect();
	});
	// fit = container / BASE_WIDTH so the 1440px-wide iframe renders to box width.
	// User zoom multiplies it. Height is set so the scaled iframe fills the box.
	let scale = $derived(boxW > 0 ? (boxW / BASE_WIDTH) * dashZoom : dashZoom);
	let frameW = BASE_WIDTH;
	let frameH = $derived(scale > 0 && boxH > 0 ? Math.round(boxH / scale) : 0);

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
				<Badge
					variant="outline"
					class="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30"
				>
					running
				</Badge>
				{#if r9.status.pid}
					<span class="text-muted-foreground">pid {r9.status.pid}</span>
				{/if}
				<span class="text-muted-foreground">:{r9.status.port}</span>
			{:else if r9.status.resolved === 'missing'}
				<Badge variant="outline" class="bg-muted text-muted-foreground">
					not installed
				</Badge>
			{:else}
				<Badge variant="outline" class="bg-muted text-muted-foreground">
					stopped
				</Badge>
			{/if}
		</div>

		<div class="ml-auto flex items-center gap-1">
			{#if r9.status.running}
				<div class="flex items-center gap-0.5 mr-1">
					<Button
						variant="ghost"
						size="icon-sm"
						title="Zoom out dashboard"
						class="text-muted-foreground hover:text-foreground"
						disabled={dashZoom <= ZMIN}
						onclick={zoomOut}
					>
						<ZoomOut size={14} />
					</Button>
					<button
						class="text-[11px] tabular-nums text-muted-foreground hover:text-foreground w-9 text-center"
						title="Reset zoom to 100%"
						onclick={zoomReset}
					>{zoomPct}%</button>
					<Button
						variant="ghost"
						size="icon-sm"
						title="Zoom in dashboard"
						class="text-muted-foreground hover:text-foreground"
						disabled={dashZoom >= ZMAX}
						onclick={zoomIn}
					>
						<ZoomIn size={14} />
					</Button>
				</div>
				<Button
					variant="ghost"
					size="icon-sm"
					title="Reload dashboard"
					class="text-muted-foreground hover:text-foreground"
					onclick={reload}
				>
					<RotateCw size={14} />
				</Button>
				<Button
					variant="ghost"
					size="icon-sm"
					title="Open in external browser"
					class="text-muted-foreground hover:text-foreground"
					onclick={() => r9.openDashboard()}
				>
					<ExternalLink size={14} />
				</Button>
				<Button
					variant="ghost"
					size="icon-sm"
					title="Stop 9Router"
					class="text-muted-foreground hover:text-foreground"
					disabled={r9.busy}
					onclick={stopRouter}
				>
					{#if r9.busy}
						<Loader2 size={14} class="animate-spin" />
					{:else}
						<Square size={14} />
					{/if}
				</Button>
			{:else if r9.status.resolved !== 'missing'}
				<Button
					variant="ghost"
					size="icon-sm"
					title="Start 9Router"
					class="text-muted-foreground hover:text-foreground"
					disabled={r9.busy}
					onclick={startManually}
				>
					{#if r9.busy}
						<Loader2 size={14} class="animate-spin" />
					{:else}
						<Play size={14} />
					{/if}
				</Button>
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
					<Button
						variant="outline"
						size="xs"
						onclick={startManually}
					>
						<Play size={12} /> Start 9Router
					</Button>
				{/if}
				{#if r9.lastError}
					<div class="mt-2 max-w-md text-xs bg-destructive/10 border border-destructive/30 rounded px-3 py-2 font-mono">
						{r9.lastError}
					</div>
				{/if}
			</div>
		{:else}
			<div bind:this={viewport} class="absolute inset-0 overflow-hidden">
				{#key reloadKey}
					<iframe
						title="9Router Dashboard"
						src={DASHBOARD_URL}
						width={frameW}
						height={frameH}
						scrolling="no"
						class="border-0 bg-white origin-top-left"
						style="width: {frameW}px; height: {frameH}px; transform: scale({scale});"
						sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-downloads"
					></iframe>
				{/key}
			</div>
		{/if}
	</div>
</div>
