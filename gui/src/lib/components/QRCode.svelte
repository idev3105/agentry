<script lang="ts">
	import QR from 'qrcode';

	let { value, size = 120 }: { value: string; size?: number } = $props();

	let svg = $state('');

	$effect(() => {
		const v = value;
		if (!v) {
			svg = '';
			return;
		}
		let cancelled = false;
		QR.toString(v, {
			type: 'svg',
			margin: 1,
			errorCorrectionLevel: 'M',
			color: { dark: '#000000', light: '#ffffff' }
		})
			.then((out) => {
				if (!cancelled) svg = out;
			})
			.catch(() => {
				if (!cancelled) svg = '';
			});
		return () => {
			cancelled = true;
		};
	});
</script>

<div
	class="shrink-0 rounded bg-white p-1.5"
	style="width: {size}px; height: {size}px;"
	aria-label="QR code"
>
	<!-- eslint-disable-next-line svelte/no-at-html-tags -->
	{@html svg}
</div>

<style>
	div :global(svg) {
		display: block;
		width: 100%;
		height: 100%;
	}
</style>
