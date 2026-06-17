<script lang="ts">
	import * as Dialog from '$lib/components/ui/dialog';
	import { Button } from '$lib/components/ui/button';

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

	// bits-ui Dialog drives open state; bridge its close events back to onCancel
	// so Escape / overlay-click / X all route through the caller's handler.
	function onOpenChange(next: boolean) {
		if (!next) onCancel();
	}
</script>

<Dialog.Root {open} {onOpenChange}>
	<Dialog.Content class="w-[min(420px,90vw)]" showCloseButton={false}>
		<Dialog.Header>
			<Dialog.Title>{title}</Dialog.Title>
			<Dialog.Description class="whitespace-pre-line">{message}</Dialog.Description>
		</Dialog.Header>
		<Dialog.Footer>
			<Button variant="secondary" onclick={onCancel}>{cancelLabel}</Button>
			<Button
				variant={destructive ? 'destructive' : 'default'}
				autofocus
				onclick={onConfirm}>{confirmLabel}</Button
			>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
