<script lang="ts">
	import { explorer } from "$lib/stores/explorer.svelte";
	import { readFile } from "$lib/ipc";
	import { isImageFile, fileIcon } from "$lib/utils/fileIcon";
	import { toasts } from "$lib/stores/toasts.svelte";
	import type { FileContent } from "$lib/types";
	import { Button } from "$lib/components/ui/button";
	import X from "@lucide/svelte/icons/x";
	import Copy from "@lucide/svelte/icons/copy";

	let path = $derived(explorer.selected);
	let content = $state<FileContent | null>(null);
	let loading = $state(false);
	let error = $state<string | null>(null);

	let name = $derived(path ? (path.split("/").pop() ?? path) : "");
	let Icon = $derived(fileIcon(name, false));
	let isImage = $derived(isImageFile(name));

	// Decode base64 -> UTF-8 (lossy) for non-binary, non-image files.
	let text = $derived.by(() => {
		if (!content || content.is_binary || isImage) return "";
		try {
			const bin = atob(content.data_b64);
			const bytes = new Uint8Array(bin.length);
			for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
			return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
		} catch {
			return "";
		}
	});
	let lines = $derived(text ? text.split("\n") : []);
	let imageSrc = $derived.by(() => {
		if (!content || !isImage) return "";
		const ext = name.split(".").pop()?.toLowerCase() ?? "png";
		const mime = ext === "svg" ? "image/svg+xml" : `image/${ext === "jpg" ? "jpeg" : ext}`;
		return `data:${mime};base64,${content.data_b64}`;
	});

	$effect(() => {
		const p = path;
		if (!p) {
			content = null;
			return;
		}
		let cancelled = false;
		loading = true;
		error = null;
		readFile(p)
			.then((c) => {
				if (!cancelled) content = c;
			})
			.catch((e) => {
				if (!cancelled) error = String(e);
			})
			.finally(() => {
				if (!cancelled) loading = false;
			});
		return () => {
			cancelled = true;
		};
	});

	$effect(() => {
		function onKey(e: KeyboardEvent) {
			if (e.key === "Escape" && explorer.selected) {
				e.preventDefault();
				explorer.closeViewer();
			}
		}
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	});

	function copyPath() {
		if (!path) return;
		navigator.clipboard.writeText(path);
		toasts.info("Copied path");
	}
</script>

{#if path}
	<div class="absolute inset-0 z-20 flex flex-col bg-background">
		<!-- Header -->
		<div class="flex items-center gap-2 border-b border-border px-3 h-9 flex-shrink-0">
			<Icon size={14} class="text-muted-foreground flex-shrink-0" />
			<span class="text-sm truncate">{name}</span>
			<span class="text-[11px] text-muted-foreground truncate hidden sm:inline">{path}</span>
			{#if content}
				<span class="text-[11px] text-muted-foreground flex-shrink-0">{content.size} B</span>
			{/if}
			<div class="ml-auto flex items-center gap-0.5 flex-shrink-0">
				<Button variant="ghost" size="icon-xs" title="Copy path" onclick={copyPath}>
					<Copy size={12} />
				</Button>
				<Button variant="ghost" size="icon-xs" title="Close (Esc)" onclick={() => explorer.closeViewer()}>
					<X size={14} />
				</Button>
			</div>
		</div>

		<!-- Banners -->
		{#if content?.truncated}
			<div class="px-3 py-1 text-[11px] bg-warning/15 text-warning flex-shrink-0">
				Showing the first part of a large file — content truncated.
			</div>
		{/if}

		<!-- Body -->
		<div class="flex-1 overflow-auto">
			{#if loading}
				<div class="p-4 text-xs text-muted-foreground">Loading…</div>
			{:else if error}
				<div class="p-4 text-xs text-destructive">{error}</div>
			{:else if content?.is_binary}
				<div class="p-6 text-xs text-muted-foreground text-center">
					Binary file — preview not available ({content.size} bytes)
				</div>
			{:else if isImage}
				<div class="p-4 flex items-center justify-center">
					<img src={imageSrc} alt={name} class="max-w-full max-h-full object-contain" />
				</div>
			{:else}
				<div class="flex font-mono text-xs leading-relaxed">
					<div class="select-none text-right text-muted-foreground/40 px-2 py-2 border-r border-border flex-shrink-0">
						{#each lines as _, i (i)}
							<div>{i + 1}</div>
						{/each}
					</div>
					<pre class="py-2 px-3 overflow-x-auto flex-1"><code>{text}</code></pre>
				</div>
			{/if}
		</div>
	</div>
{/if}
