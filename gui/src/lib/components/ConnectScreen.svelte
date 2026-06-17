<script lang="ts">
	import { connect, getSavedHost, onConnStateChange, type WsConnState } from '$lib/ipc-ws';
	import { Input } from '$lib/components/ui/input';
	import { Button } from '$lib/components/ui/button';
	import { Label } from '$lib/components/ui/label';

	let { onConnected }: { onConnected: () => void } = $props();

	const saved = getSavedHost();
	let host = $state(saved ?? '');
	let connState = $state<WsConnState>('disconnected');
	let error = $state<string | null>(null);
	let loading = $state(false);

	// examples for placeholder
	const placeholder = '100.x.x.x:20200  or  my-mac.tail…ts.net:20200';

	async function tryConnect() {
		if (!host.trim()) return;
		loading = true;
		error = null;
		try {
			// normalize: strip ws:// if user typed it, add port if missing
			let h = host.trim().replace(/^wss?:\/\//, '');
			if (!h.includes(':')) h = h + ':20200';
			await connect(h);
			onConnected();
		} catch (e) {
			error = (e as Error).message;
		} finally {
			loading = false;
		}
	}

	function onKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter') tryConnect();
	}
</script>

<div class="fixed inset-0 flex flex-col items-center justify-center bg-background px-6 gap-6">
	<!-- Logo -->
	<div class="flex flex-col items-center gap-2">
		<svg width="40" height="40" viewBox="0 0 24 24" fill="currentColor" class="text-accent">
			<path d="M12 3 22 21H2L12 3Z"/>
		</svg>
		<h1 class="text-lg font-semibold">Agentry Remote</h1>
		<p class="text-xs text-muted-foreground text-center">
			Connect to your dev machine over Tailscale
		</p>
	</div>

	<!-- Input card -->
	<div class="w-full max-w-sm bg-card border border-border rounded-lg p-4 space-y-3">
		<Label class="text-xs text-muted-foreground" for="host-input">
			Dev machine address
		</Label>
		<Input
			id="host-input"
			type="text"
			inputmode="url"
			autocomplete="off"
			autocorrect="off"
			autocapitalize="none"
			spellcheck="false"
			bind:value={host}
			onkeydown={onKeydown}
			placeholder={placeholder}
			class="font-mono"
		/>

		{#if error}
			<p class="text-xs text-destructive">{error}</p>
		{/if}

		<Button
			class="w-full"
			onclick={tryConnect}
			disabled={loading || !host.trim()}
		>
			{#if loading}
				Connecting…
			{:else}
				Connect
			{/if}
		</Button>
	</div>

	<!-- Help -->
	<div class="w-full max-w-sm space-y-1.5">
		<p class="text-[11px] text-muted-foreground">
			<span class="font-medium text-foreground">How to find the address:</span>
			Open Agentry on your Mac → Settings → Integrations → Remote Access.
			The address shown there is what you enter here.
		</p>
		<p class="text-[11px] text-muted-foreground">
			Both devices must be on the same Tailscale network (tailnet).
			No port forwarding or public server needed.
		</p>
	</div>
</div>
