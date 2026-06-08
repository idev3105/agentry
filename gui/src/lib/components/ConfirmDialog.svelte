<script lang="ts">
	import { onMount } from 'svelte';

	const {
		open,
		title,
		message,
		confirmLabel = 'Confirm',
		cancelLabel = 'Cancel',
		destructive = false,
		onConfirm,
		onCancel
	}: {
		open: boolean;
		title: string;
		message: string;
		confirmLabel?: string;
		cancelLabel?: string;
		destructive?: boolean;
		onConfirm: () => void;
		onCancel: () => void;
	} = $props();

	let confirmBtn: HTMLButtonElement | undefined = $state();

	$effect(() => {
		if (open && confirmBtn) confirmBtn.focus();
	});

	function onKey(e: KeyboardEvent) {
		if (!open) return;
		if (e.key === 'Escape') {
			e.preventDefault();
			onCancel();
		} else if (e.key === 'Enter') {
			e.preventDefault();
			onConfirm();
		}
	}

	onMount(() => {
		window.addEventListener('keydown', onKey);
		return () => window.removeEventListener('keydown', onKey);
	});
</script>

{#if open}
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
		onclick={onCancel}
	>
		<!-- svelte-ignore a11y_click_events_have_key_events -->
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div
			class="bg-card border border-border rounded shadow-lg w-[min(420px,90vw)] p-4"
			onclick={(e) => e.stopPropagation()}
		>
			<div class="text-sm font-semibold mb-2">{title}</div>
			<div class="text-xs text-muted-foreground mb-4 whitespace-pre-line">{message}</div>
			<div class="flex justify-end gap-2">
				<button
					class="text-xs px-3 py-1.5 rounded bg-secondary hover:bg-secondary/80"
					onclick={onCancel}
				>
					{cancelLabel}
				</button>
				<button
					bind:this={confirmBtn}
					class={destructive
						? 'text-xs px-3 py-1.5 rounded bg-destructive text-destructive-foreground hover:bg-destructive/80'
						: 'text-xs px-3 py-1.5 rounded bg-primary text-primary-foreground hover:bg-primary/90'}
					onclick={onConfirm}
				>
					{confirmLabel}
				</button>
			</div>
		</div>
	</div>
{/if}
