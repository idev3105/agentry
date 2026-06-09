<script lang="ts">
	import { profiles } from '$lib/stores/profiles';
	import { settings } from '$lib/stores/settings';
	import { sendCmd, listProfiles } from '$lib/ipc';
	import type { AgentType, ProfileInfo } from '$lib/types';
	import { cn } from '$lib/utils/cn';
	import Plus from '@lucide/svelte/icons/plus';
	import Trash from '@lucide/svelte/icons/trash-2';
	import Star from '@lucide/svelte/icons/star';
	import Pencil from '@lucide/svelte/icons/pencil';
	import X from '@lucide/svelte/icons/x';
	import Check from '@lucide/svelte/icons/check';

	let editingId = $state<string | null>(null);
	let creating = $state(false);

	// Draft form for create / edit
	let draftName = $state('');
	let draftAgent = $state<AgentType>('claude_code');
	let draftStartScript = $state('');
	let draftEnvText = $state('');
	let draftParamsText = $state('');
	let saveError = $state<string | null>(null);

	const agents: AgentType[] = ['claude_code', 'codex', 'open_code'];

	async function refresh() {
		profiles.set(await listProfiles());
	}

	function startNew() {
		creating = true;
		editingId = null;
		draftName = '';
		draftAgent = 'claude_code';
		draftStartScript = '';
		draftEnvText = '';
		draftParamsText = '';
		saveError = null;
	}

	function startEdit(p: ProfileInfo) {
		editingId = p.id;
		creating = false;
		draftName = p.name;
		draftAgent = p.agent_type;
		draftStartScript = p.start_script ?? '';
		draftEnvText = p.env.map((e) => `${e.key}=${e.value}`).join('\n');
		draftParamsText = p.params
			.map((p) => (p.value !== null ? `${p.flag}=${p.value}` : p.flag))
			.join('\n');
		saveError = null;
	}

	function cancel() {
		editingId = null;
		creating = false;
		saveError = null;
	}

	function parseEnv(text: string) {
		return text
			.split('\n')
			.map((l) => l.trim())
			.filter(Boolean)
			.map((l) => {
				const i = l.indexOf('=');
				if (i < 0) return { key: l, value: '' };
				return { key: l.slice(0, i), value: l.slice(i + 1) };
			});
	}

	function parseParams(text: string) {
		return text
			.split('\n')
			.map((l) => l.trim())
			.filter(Boolean)
			.map((l) => {
				const i = l.indexOf('=');
				if (i < 0) return { flag: l, value: null };
				return { flag: l.slice(0, i), value: l.slice(i + 1) };
			});
	}

	async function save() {
		if (!draftName.trim()) {
			saveError = 'Name required';
			return;
		}
		const env = parseEnv(draftEnvText);
		const params = parseParams(draftParamsText);
		const start_script = draftStartScript.trim() || null;

		try {
			if (creating) {
				const r = (await sendCmd({
					cmd: 'create_profile',
					name: draftName.trim(),
					agent_type: draftAgent,
					params,
					env,
					start_script
				})) as { ok: boolean; error?: string };
				if (!r.ok) throw new Error(r.error);
			} else if (editingId) {
				const r = (await sendCmd({
					cmd: 'update_profile',
					profile_id: editingId,
					name: draftName.trim(),
					agent_type: draftAgent,
					params,
					env,
					start_script
				})) as { ok: boolean; error?: string };
				if (!r.ok) throw new Error(r.error);
			}
			await refresh();
			cancel();
		} catch (e) {
			saveError = String(e);
		}
	}

	async function deleteProfile(id: string) {
		try {
			const r = (await sendCmd({ cmd: 'delete_profile', profile_id: id })) as {
				ok: boolean;
				error?: string;
			};
			if (!r.ok) throw new Error(r.error);
			await refresh();
		} catch (e) {
			alert(`Delete failed: ${e}`);
		}
	}

	async function setDefault(id: string) {
		await sendCmd({ cmd: 'set_default_profile', profile_id: id });
		settings.update((s) => ({ ...s, defaultProfileId: id }));
	}
</script>

<div class="flex flex-col h-full overflow-hidden">
	<header class="flex items-center justify-between px-6 py-4 border-b border-border">
		<div>
			<h1 class="text-base font-semibold">Profiles</h1>
			<p class="text-xs text-muted-foreground mt-0.5">
				Reusable agent configurations — choose when starting a session.
			</p>
		</div>
		{#if !creating && !editingId}
			<button
				title="New profile"
				class="flex items-center justify-center p-2 rounded bg-primary text-primary-foreground hover:bg-primary/90"
				onclick={startNew}
			>
				<Plus size={14} />
			</button>
		{/if}
	</header>

	<div class="flex-1 overflow-y-auto p-6">
		{#if creating || editingId}
			<div class="max-w-xl bg-card border border-border rounded p-4 space-y-3">
				<div class="flex items-center justify-between">
					<h2 class="text-sm font-semibold">{creating ? 'New profile' : 'Edit profile'}</h2>
					<button class="text-muted-foreground hover:text-foreground" onclick={cancel}>
						<X size={16} />
					</button>
				</div>

				<label class="block">
					<span class="block text-xs text-muted-foreground mb-1">Name</span>
					<input
						bind:value={draftName}
						class="w-full bg-input rounded px-2 py-1.5 text-sm border border-border focus:outline-none focus:border-gruvbox-yellow"
					/>
				</label>

				<div>
					<span class="block text-xs text-muted-foreground mb-1">Agent</span>
					<div class="flex gap-2">
						{#each agents as a (a)}
							<button
								class={cn(
									'px-3 py-1.5 rounded text-xs border',
									draftAgent === a
										? 'border-gruvbox-yellow bg-secondary'
										: 'border-border hover:border-secondary'
								)}
								onclick={() => (draftAgent = a)}
							>
								{a}
							</button>
						{/each}
					</div>
				</div>

				<label class="block">
					<span class="block text-xs text-muted-foreground mb-1">
						CLI flags (one per line, <code>--flag</code> or <code>--flag=value</code>)
					</span>
					<textarea
						bind:value={draftParamsText}
						rows="3"
						class="w-full bg-input rounded px-2 py-1.5 text-xs font-mono border border-border focus:outline-none focus:border-gruvbox-yellow"
						placeholder="--model=sonnet&#10;--no-banner"
					></textarea>
				</label>

				<label class="block">
					<span class="block text-xs text-muted-foreground mb-1">
						Environment vars (KEY=VALUE per line)
					</span>
					<textarea
						bind:value={draftEnvText}
						rows="3"
						class="w-full bg-input rounded px-2 py-1.5 text-xs font-mono border border-border focus:outline-none focus:border-gruvbox-yellow"
						placeholder="ANTHROPIC_API_KEY=sk-..."
					></textarea>
				</label>

				<label class="block">
					<span class="block text-xs text-muted-foreground mb-1">
						Start script (optional shell snippet — if it exits non-zero the session fails)
					</span>
					<textarea
						bind:value={draftStartScript}
						rows="2"
						class="w-full bg-input rounded px-2 py-1.5 text-xs font-mono border border-border focus:outline-none focus:border-gruvbox-yellow"
						placeholder="source .env && nvm use"
					></textarea>
				</label>

				{#if saveError}
					<div class="text-xs text-gruvbox-red">{saveError}</div>
				{/if}

				<div class="flex justify-end gap-2 pt-2">
					<button
						title="Cancel"
						class="flex items-center justify-center p-2 rounded text-muted-foreground hover:text-foreground"
						onclick={cancel}
					><X size={14} /></button>
					<button
						title={creating ? 'Create profile' : 'Save profile'}
						class="flex items-center justify-center p-2 rounded bg-primary text-primary-foreground hover:bg-primary/90"
						onclick={save}
					><Check size={14} /></button>
				</div>
			</div>
		{:else if $profiles.length === 0}
			<div class="text-sm text-muted-foreground">
				No profiles yet. Click <strong>New profile</strong> to create one.
			</div>
		{:else}
			<div class="grid grid-cols-1 md:grid-cols-2 gap-3 max-w-4xl">
				{#each $profiles as p (p.id)}
					<div class="bg-card border border-border rounded p-3">
						<div class="flex items-start justify-between gap-2">
							<div class="flex-1 min-w-0">
								<div class="flex items-center gap-2">
									<span class="font-medium text-sm truncate">{p.name}</span>
									{#if $settings.defaultProfileId === p.id}
										<span class="text-[10px] uppercase tracking-wider text-gruvbox-yellow flex items-center gap-0.5">
											<Star size={10} /> default
										</span>
									{/if}
								</div>
								<div class="text-xs text-muted-foreground mt-0.5">{p.agent_type}</div>
							</div>
							<div class="flex items-center gap-1">
								{#if $settings.defaultProfileId !== p.id}
									<button
										title="Set as default"
										class="p-1 rounded text-muted-foreground hover:text-gruvbox-yellow hover:bg-secondary"
										onclick={() => setDefault(p.id)}
									><Star size={14} /></button>
								{/if}
								<button
									title="Edit"
									class="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-secondary"
									onclick={() => startEdit(p)}
								><Pencil size={14} /></button>
								<button
									title="Delete"
									class="p-1 rounded text-muted-foreground hover:text-gruvbox-red hover:bg-secondary"
									onclick={() => deleteProfile(p.id)}
								><Trash size={14} /></button>
							</div>
						</div>
						{#if p.params.length > 0 || p.env.length > 0}
							<div class="mt-2 space-y-1">
								{#if p.params.length > 0}
									<div class="text-[10px] uppercase tracking-wider text-muted-foreground">Flags</div>
									<div class="text-xs font-mono text-muted-foreground">
										{p.params.map((x) => (x.value !== null ? `${x.flag}=${x.value}` : x.flag)).join(' ')}
									</div>
								{/if}
								{#if p.env.length > 0}
									<div class="text-[10px] uppercase tracking-wider text-muted-foreground mt-1">Env</div>
									<div class="text-xs font-mono text-muted-foreground">
										{p.env.map((e) => e.key).join(', ')}
									</div>
								{/if}
							</div>
						{/if}
					</div>
				{/each}
			</div>
		{/if}
	</div>
</div>
