<script lang="ts">
	import { profiles } from '$lib/stores/profiles';
	import { settings } from '$lib/stores/settings';
	import { projects } from '$lib/stores/projects';
	import { sendCmd, listProfiles, startSession, killSession, waitForSessionStart } from '$lib/ipc';
	import { toasts } from '$lib/stores/toasts.svelte';
	import { get } from 'svelte/store';
	import type { AgentType, ProfileInfo } from '$lib/types';
	import { cn } from '$lib/utils/cn';
	import { agentMeta } from '$lib/utils/agent';
	import BrandIcon from '$lib/components/BrandIcon.svelte';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Textarea } from '$lib/components/ui/textarea';
	import { Badge } from '$lib/components/ui/badge';
	import * as Card from '$lib/components/ui/card';
	import Plus from '@lucide/svelte/icons/plus';
	import Trash from '@lucide/svelte/icons/trash-2';
	import Star from '@lucide/svelte/icons/star';
	import Play from '@lucide/svelte/icons/play';
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
			toasts.error('Delete failed', String(e));
		}
	}

	async function setDefault(id: string) {
		await sendCmd({ cmd: 'set_default_profile', profile_id: id });
		settings.update((s) => ({ ...s, defaultProfileId: id }));
	}

	async function testProfile(p: ProfileInfo) {
		const toastId = toasts.info(`Testing ${p.name}…`);
		try {
			const projs = Array.from(get(projects).values());
			const proj = projs[0];
			if (!proj) { toasts.error('Test failed', 'Create a project first'); return; }
			const r = await startSession(proj.id, p.id) as { session_id: string };
			const res = await waitForSessionStart(r.session_id, 3000);
			toasts.dismiss(toastId);
			if (res.ok) toasts.success(`${p.name}: OK`, `Started in ${res.ms}ms`);
			else        toasts.error(`${p.name}: failed`, res.error ?? 'unknown');
			await killSession(r.session_id).catch(() => {});
		} catch (e) { toasts.error('Test failed', String(e)); }
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
			<Button
				variant="default"
				size="icon"
				title="New profile"
				onclick={startNew}
			>
				<Plus size={14} />
			</Button>
		{/if}
	</header>

	<div class="flex-1 overflow-y-auto p-6">
		{#if creating || editingId}
			<Card.Root class="max-w-xl p-4 space-y-3">
				<div class="flex items-center justify-between">
					<h2 class="text-sm font-semibold">{creating ? 'New profile' : 'Edit profile'}</h2>
					<Button variant="ghost" size="icon-sm" class="text-muted-foreground" onclick={cancel}>
						<X size={16} />
					</Button>
				</div>

				<label class="block">
					<span class="block text-xs text-muted-foreground mb-1">Name</span>
					<Input bind:value={draftName} class="w-full" />
				</label>

				<div>
					<span class="block text-xs text-muted-foreground mb-1">Agent</span>
					<div class="flex gap-2">
						{#each agents as a (a)}
							<Button
								variant="outline"
								size="xs"
								class={cn(draftAgent === a && 'border-accent bg-secondary')}
								onclick={() => (draftAgent = a)}
							>
								{a}
							</Button>
						{/each}
					</div>
				</div>

				<label class="block">
					<span class="block text-xs text-muted-foreground mb-1">
						CLI flags (one per line, <code>--flag</code> or <code>--flag=value</code>)
					</span>
					<Textarea
						bind:value={draftParamsText}
						rows={3}
						class="w-full text-xs font-mono"
						placeholder="--model=sonnet&#10;--no-banner"
					/>
				</label>

				<label class="block">
					<span class="block text-xs text-muted-foreground mb-1">
						Environment vars (KEY=VALUE per line)
					</span>
					<Textarea
						bind:value={draftEnvText}
						rows={3}
						class="w-full text-xs font-mono"
						placeholder="ANTHROPIC_API_KEY=sk-..."
					/>
				</label>

				<label class="block">
					<span class="block text-xs text-muted-foreground mb-1">
						Start script (optional shell snippet — if it exits non-zero the session fails)
					</span>
					<Textarea
						bind:value={draftStartScript}
						rows={2}
						class="w-full text-xs font-mono"
						placeholder="source .env && nvm use"
					/>
				</label>

				{#if saveError}
					<div class="text-xs text-gruvbox-red">{saveError}</div>
				{/if}

				<div class="flex justify-end gap-2 pt-2">
					<Button
						variant="ghost"
						size="icon-sm"
						title="Cancel"
						class="text-muted-foreground"
						onclick={cancel}
					><X size={14} /></Button>
					<Button
						variant="default"
						size="icon-sm"
						title={creating ? 'Create profile' : 'Save profile'}
						onclick={save}
					><Check size={14} /></Button>
				</div>
			</Card.Root>
		{:else if $profiles.length === 0}
			<div class="text-sm text-muted-foreground">
				No profiles yet. Click <strong>New profile</strong> to create one.
			</div>
		{:else}
			<div class="grid grid-cols-1 md:grid-cols-2 gap-3 max-w-4xl">
				{#each $profiles as p (p.id)}
					{@const m = agentMeta(p.agent_type)}
					<Card.Root class="p-3">
						<div class="flex items-start justify-between gap-2">
							<div class="flex-1 min-w-0">
								<div class="flex items-center gap-2">
									<span class="font-medium text-sm truncate">{p.name}</span>
									{#if $settings.defaultProfileId === p.id}
										<Badge variant="outline" class="text-[10px] uppercase tracking-wider text-accent gap-0.5">
											<Star size={10} /> default
										</Badge>
									{/if}
								</div>
								<div class="flex items-center gap-1.5 mt-0.5">
										{#if m.brand}
										<BrandIcon name={m.brand} size={14} />
										{:else}
										<m.icon size={12} class={m.color} />
										{/if}
									<span class="text-xs text-muted-foreground">{m.label}</span>
								</div>
							</div>
							<div class="flex items-center gap-1">
								{#if $settings.defaultProfileId !== p.id}
									<Button
										variant="ghost"
										size="icon-xs"
										title="Set as default"
										class="text-muted-foreground hover:text-accent"
										onclick={() => setDefault(p.id)}
									><Star size={14} /></Button>
								{/if}
								<Button
									variant="ghost"
									size="icon-xs"
									title="Test"
									class="text-muted-foreground hover:text-gruvbox-green"
									onclick={() => testProfile(p)}
								><Play size={14} /></Button>
								<Button
									variant="ghost"
									size="icon-xs"
									title="Edit"
									class="text-muted-foreground hover:text-foreground"
									onclick={() => startEdit(p)}
								><Pencil size={14} /></Button>
								<Button
									variant="ghost"
									size="icon-xs"
									title="Delete"
									class="text-muted-foreground hover:text-gruvbox-red"
									onclick={() => deleteProfile(p.id)}
								><Trash size={14} /></Button>
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
					</Card.Root>
				{/each}
			</div>
		{/if}
	</div>
</div>
