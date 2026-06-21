<script lang="ts">
    import { profiles } from "$lib/stores/profiles";
    import { settings } from "$lib/stores/settings";
    import { projects } from "$lib/stores/projects";
    import {
        sendCmd,
        listProfiles,
        startSession,
        killSession,
        waitForSessionStart,
    } from "$lib/ipc";
    import { getTermSize } from "$lib/stores/termsize";
    import { toasts } from "$lib/stores/toasts.svelte";
    import { get } from "svelte/store";
    import type { AgentType, ProfileInfo } from "$lib/types";
    import { cn } from "$lib/utils/cn";
    import { agentMeta } from "$lib/utils/agent";
    import BrandIcon from "$lib/components/BrandIcon.svelte";
    import { Button } from "$lib/components/ui/button";
    import { Input } from "$lib/components/ui/input";
    import { Textarea } from "$lib/components/ui/textarea";
    import { Badge } from "$lib/components/ui/badge";
    import * as Card from "$lib/components/ui/card";
    import * as Dialog from "$lib/components/ui/dialog";
    import Plus from "@lucide/svelte/icons/plus";
    import Trash from "@lucide/svelte/icons/trash-2";
    import Star from "@lucide/svelte/icons/star";
    import Play from "@lucide/svelte/icons/play";
    import Pencil from "@lucide/svelte/icons/pencil";
    import X from "@lucide/svelte/icons/x";
    import Check from "@lucide/svelte/icons/check";

    let editingId = $state<string | null>(null);
    let creating = $state(false);

    // Draft form for create / edit
    let draftName = $state("");
    let draftAgent = $state<AgentType>("claude_code");
    let draftStartScript = $state("");
    let draftEnvText = $state("");
    let draftParamsText = $state("");
    let saveError = $state<string | null>(null);

    const agents: AgentType[] = ["claude_code", "codex", "open_code", "hermes"];

    async function refresh() {
        profiles.set(await listProfiles());
    }

    function startNew() {
        creating = true;
        editingId = null;
        draftName = "";
        draftAgent = "claude_code";
        draftStartScript = "";
        draftEnvText = "";
        draftParamsText = "";
        saveError = null;
    }

    function startEdit(p: ProfileInfo) {
        editingId = p.id;
        creating = false;
        draftName = p.name;
        draftAgent = p.agent_type;
        draftStartScript = p.start_script ?? "";
        draftEnvText = p.env.map((e) => `${e.key}=${e.value}`).join("\n");
        draftParamsText = p.params
            .map((p) => (p.value !== null ? `${p.flag}=${p.value}` : p.flag))
            .join("\n");
        saveError = null;
    }

    function cancel() {
        editingId = null;
        creating = false;
        saveError = null;
    }

    function parseEnv(text: string) {
        return text
            .split("\n")
            .map((l) => l.trim())
            .filter(Boolean)
            .map((l) => {
                const i = l.indexOf("=");
                if (i < 0) return { key: l, value: "" };
                return { key: l.slice(0, i), value: l.slice(i + 1) };
            });
    }

    function parseParams(text: string) {
        return text
            .split("\n")
            .map((l) => l.trim())
            .filter(Boolean)
            .map((l) => {
                const i = l.indexOf("=");
                if (i < 0) return { flag: l, value: null };
                return { flag: l.slice(0, i), value: l.slice(i + 1) };
            });
    }

    async function save() {
        if (!draftName.trim()) {
            saveError = "Name required";
            return;
        }
        const env = parseEnv(draftEnvText);
        const params = parseParams(draftParamsText);
        const start_script = draftStartScript.trim() || null;

        try {
            if (creating) {
                const r = (await sendCmd({
                    cmd: "create_profile",
                    name: draftName.trim(),
                    agent_type: draftAgent,
                    params,
                    env,
                    start_script,
                })) as { ok: boolean; error?: string };
                if (!r.ok) throw new Error(r.error);
            } else if (editingId) {
                const r = (await sendCmd({
                    cmd: "update_profile",
                    profile_id: editingId,
                    name: draftName.trim(),
                    agent_type: draftAgent,
                    params,
                    env,
                    start_script,
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
            const r = (await sendCmd({
                cmd: "delete_profile",
                profile_id: id,
            })) as {
                ok: boolean;
                error?: string;
            };
            if (!r.ok) throw new Error(r.error);
            await refresh();
        } catch (e) {
            toasts.error("Delete failed", String(e));
        }
    }

    async function setDefault(id: string) {
        await sendCmd({ cmd: "set_default_profile", profile_id: id });
        settings.update((s) => ({ ...s, defaultProfileId: id }));
    }

    async function testProfile(p: ProfileInfo) {
        const toastId = toasts.info(`Testing ${p.name}…`);
        try {
            const projs = Array.from(get(projects).values());
            const proj = projs[0];
            if (!proj) {
                toasts.error("Test failed", "Create a project first");
                return;
            }
            const sz = getTermSize();
            const r = (await startSession(proj.id, p.id, undefined, undefined, sz?.cols, sz?.rows)) as {
                session_id: string;
            };
            const res = await waitForSessionStart(r.session_id, 3000);
            toasts.dismiss(toastId);
            if (res.ok)
                toasts.success(`${p.name}: OK`, `Started in ${res.ms}ms`);
            else toasts.error(`${p.name}: failed`, res.error ?? "unknown");
            await killSession(r.session_id).catch(() => {});
        } catch (e) {
            toasts.error("Test failed", String(e));
        }
    }
</script>

<div class="flex flex-col h-full overflow-hidden">
    <header
        class="flex items-center justify-between px-6 py-4 border-b border-border"
    >
        <div>
            <h1 class="text-base font-semibold">Profiles</h1>
            <p class="text-xs text-muted-foreground mt-0.5">
                Reusable agent configurations — choose when starting a session.
            </p>
        </div>
        <Button variant="default" size="sm" class="gap-1.5" onclick={startNew}>
            <Plus size={14} /> New profile
        </Button>
    </header>

    <Dialog.Root
        open={creating || editingId !== null}
        onOpenChange={(v) => {
            if (!v) cancel();
        }}
    >
        <Dialog.Content
            class="w-full max-w-xl gap-0 p-0"
            showCloseButton={false}
        >
            <div
                class="flex items-center justify-between border-b border-border px-5 py-3.5"
            >
                <Dialog.Title class="text-base font-semibold">
                    {creating ? "New profile" : "Edit profile"}
                </Dialog.Title>
                <Button
                    variant="ghost"
                    size="icon-sm"
                    class="text-muted-foreground"
                    onclick={cancel}
                >
                    <X size={16} />
                </Button>
            </div>

            <div class="px-5 py-4 space-y-5 max-h-[70vh] overflow-y-auto">
                <label class="block space-y-1.5">
                    <span class="block text-xs font-medium text-foreground"
                        >Name</span
                    >
                    <Input
                        bind:value={draftName}
                        class="w-full"
                        placeholder="My Claude profile"
                    />
                </label>

                <div class="space-y-1.5">
                    <span class="block text-xs font-medium text-foreground"
                        >Agent</span
                    >
                    <div class="grid grid-cols-3 gap-2">
                        {#each agents as a (a)}
                            {@const am = agentMeta(a)}
                            <button
                                type="button"
                                aria-pressed={draftAgent === a}
                                onclick={() => (draftAgent = a)}
                                class={cn(
                                    "flex flex-col items-center justify-center gap-1.5 rounded-md border py-3 text-xs transition-colors",
                                    draftAgent === a
                                        ? "border-accent bg-accent/10 text-foreground"
                                        : "border-border text-muted-foreground hover:bg-secondary hover:text-foreground",
                                )}
                            >
                                {#if am.brand}
                                    <BrandIcon name={am.brand} size={20} />
                                {:else}
                                    <am.icon size={18} class={am.color} />
                                {/if}
                                {am.label}
                            </button>
                        {/each}
                    </div>
                </div>

                <label class="block space-y-1.5">
                    <span class="block text-xs font-medium text-foreground"
                        >CLI flags</span
                    >
                    <span class="block text-[11px] text-muted-foreground">
                        One per line — <code class="font-mono">--flag</code>
                        or
                        <code class="font-mono">--flag=value</code>
                    </span>
                    <Textarea
                        bind:value={draftParamsText}
                        rows={3}
                        class="w-full text-xs font-mono"
                        placeholder="--model=sonnet&#10;--no-banner"
                    />
                </label>

                <label class="block space-y-1.5">
                    <span class="block text-xs font-medium text-foreground"
                        >Environment variables</span
                    >
                    <span class="block text-[11px] text-muted-foreground">
                        <code class="font-mono">KEY=VALUE</code> per line
                    </span>
                    <Textarea
                        bind:value={draftEnvText}
                        rows={3}
                        class="w-full text-xs font-mono"
                        placeholder="ANTHROPIC_API_KEY=sk-..."
                    />
                </label>

                <label class="block space-y-1.5">
                    <span class="block text-xs font-medium text-foreground"
                        >Start script <span
                            class="font-normal text-muted-foreground"
                            >(optional)</span
                        ></span
                    >
                    <span class="block text-[11px] text-muted-foreground">
                        Shell snippet run before launch — non-zero exit fails
                        the session
                    </span>
                    <Textarea
                        bind:value={draftStartScript}
                        rows={2}
                        class="w-full text-xs font-mono"
                        placeholder="source .env && nvm use"
                    />
                </label>

                {#if saveError}
                    <div
                        class="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive"
                    >
                        {saveError}
                    </div>
                {/if}
            </div>

            <div
                class="flex justify-end gap-2 border-t border-border px-5 py-3.5"
            >
                <Button
                    variant="ghost"
                    size="sm"
                    class="text-muted-foreground gap-1.5"
                    onclick={cancel}
                >
                    <X size={14} /> Cancel
                </Button>
                <Button
                    variant="default"
                    size="sm"
                    class="gap-1.5"
                    onclick={save}
                >
                    <Check size={14} />
                    {creating ? "Create" : "Save"}
                </Button>
            </div>
        </Dialog.Content>
    </Dialog.Root>

    <div class="flex-1 overflow-y-auto p-6">
        {#if $profiles.length === 0}
            <div class="text-sm text-muted-foreground">
                No profiles yet. Click <strong>New profile</strong> to create one.
            </div>
        {:else}
            <div
                class="grid grid-flow-row grid-cols-1 md:grid-cols-2 gap-3 max-w-4xl"
            >
                {#each $profiles as p (p.id)}
                    {@const m = agentMeta(p.agent_type)}
                    <Card.Root
                        class="h-28 gap-0 rounded-lg border-border/40 py-0 p-3 shadow-none overflow-hidden flex flex-col"
                    >
                        <div class="flex items-start justify-between gap-2">
                            <div class="flex-1 min-w-0">
                                <div class="flex items-center gap-2">
                                    <span class="font-medium text-sm truncate"
                                        >{p.name}</span
                                    >
                                    {#if p.is_builtin}
                                        <Badge
                                            variant="outline"
                                            class="text-[10px] uppercase tracking-wider text-muted-foreground"
                                            >built-in</Badge
                                        >
                                    {:else if $settings.defaultProfileId === p.id}
                                        <Badge
                                            variant="outline"
                                            class="text-[10px] uppercase tracking-wider text-accent gap-0.5"
                                        >
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
                                    <span class="text-xs text-muted-foreground"
                                        >{m.label}</span
                                    >
                                </div>
                            </div>
                            <div class="flex items-center gap-1">
                                {#if !p.is_builtin}
                                    {#if $settings.defaultProfileId !== p.id}
                                        <Button
                                            variant="ghost"
                                            size="icon-xs"
                                            title="Set as default"
                                            class="text-muted-foreground hover:text-accent"
                                            onclick={() => setDefault(p.id)}
                                            ><Star size={14} /></Button
                                        >
                                    {/if}
                                    <Button
                                        variant="ghost"
                                        size="icon-xs"
                                        title="Test"
                                        class="text-muted-foreground hover:text-gruvbox-green"
                                        onclick={() => testProfile(p)}
                                        ><Play size={14} /></Button
                                    >
                                    <Button
                                        variant="ghost"
                                        size="icon-xs"
                                        title="Edit"
                                        class="text-muted-foreground hover:text-foreground"
                                        onclick={() => startEdit(p)}
                                        ><Pencil size={14} /></Button
                                    >
                                    <Button
                                        variant="ghost"
                                        size="icon-xs"
                                        title="Delete"
                                        class="text-muted-foreground hover:text-gruvbox-red"
                                        onclick={() => deleteProfile(p.id)}
                                        ><Trash size={14} /></Button
                                    >
                                {:else}
                                    <Button
                                        variant="ghost"
                                        size="icon-xs"
                                        title="Test"
                                        class="text-muted-foreground hover:text-gruvbox-green"
                                        onclick={() => testProfile(p)}
                                        ><Play size={14} /></Button
                                    >
                                {/if}
                            </div>
                        </div>
                        {#if p.params.length > 0 || p.env.length > 0}
                            <div
                                class="mt-2 flex items-baseline gap-2 overflow-hidden"
                            >
                                {#if p.params.length > 0}
                                    <span
                                        class="text-[10px] uppercase tracking-wider text-muted-foreground shrink-0"
                                        >Flags</span
                                    >
                                    <span
                                        class="text-xs font-mono text-muted-foreground truncate"
                                    >
                                        {p.params
                                            .map((x) =>
                                                x.value !== null
                                                    ? `${x.flag}=${x.value}`
                                                    : x.flag,
                                            )
                                            .join(" ")}
                                    </span>
                                {:else if p.env.length > 0}
                                    <span
                                        class="text-[10px] uppercase tracking-wider text-muted-foreground shrink-0"
                                        >Env</span
                                    >
                                    <span
                                        class="text-xs font-mono text-muted-foreground truncate"
                                    >
                                        {p.env.map((e) => e.key).join(", ")}
                                    </span>
                                {/if}
                            </div>
                        {/if}
                    </Card.Root>
                {/each}
            </div>
        {/if}
    </div>
</div>
