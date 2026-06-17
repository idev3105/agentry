<script lang="ts">
	import { cn } from '$lib/utils/cn';

	// Eagerly load all brand SVGs as raw strings at build time. No runtime fetch.
	const modules = import.meta.glob('$lib/assets/brands/*.svg', {
		query: '?raw',
		import: 'default',
		eager: true
	}) as Record<string, string>;

	// Map basename (without extension) -> raw svg markup.
	const REGISTRY: Record<string, string> = Object.fromEntries(
		Object.entries(modules).map(([path, svg]) => {
			const name = path.split('/').pop()!.replace(/\.svg$/, '');
			return [name, svg];
		})
	);

	let {
		name,
		size = 16,
		class: className
	}: {
		/** Brand file basename, e.g. 'claudecode-color', 'codex-color', 'opencode'. */
		name: string;
		size?: number;
		class?: string;
	} = $props();

	const raw = $derived(REGISTRY[name] ?? '');
</script>

{#if raw}
	<span
		class={cn('inline-flex items-center justify-center', className)}
		style="width:{size}px;height:{size}px"
		aria-hidden="true"
	>
		<!-- SVGs are local, build-time, trusted assets — safe to inline. -->
		{@html raw}
	</span>
{/if}
