<script lang="ts">
    import { sessions } from "$lib/stores/sessions";
    import { ui, openOnboarding, setView } from "$lib/stores/ui";
    import { profiles } from "$lib/stores/profiles";
    import { settings } from "$lib/stores/settings";
    import { agentMeta } from "$lib/utils/agent";
    import { startSession, killSession, sendCmd } from "$lib/ipc";
    import { markSessionEnding } from "$lib/stores/sessions";
    import { toasts } from "$lib/stores/toasts.svelte";
    import type { SessionState } from "$lib/types";
    import { cn, fmtChord } from "$lib/utils/cn";
    import ConfirmDialog from "./ConfirmDialog.svelte";
    import { slide } from 'svelte/transition';
    import Plus from "@lucide/svelte/icons/plus";
    import Search from "@lucide/svelte/icons/search";
    import X from "@lucide/svelte/icons/x";
import Trash from "@lucide/svelte/icons/trash-2";
import Trash2 from "@lucide/svelte/icons/trash";
import ChevronRight from "@lucide/svelte/icons/chevron-right";
    import ChevronDown from "@lucide/svelte/icons/chevron-down";
    import Check from "@lucide/svelte/icons/check";
    import Settings from "@lucide/svelte/icons/settings";

    const {
        projectId,
        onSelect,
    }: { projectId: string; onSelect?: (id: string) => void } = $props();

    let filter = $state("");
    let filterEl: HTMLInputElement | null = $state(null);
    let profileMenuOpen = $state(false);
    let confirmTarget = $state<SessionState | null>(null);
    let clearConfirmOpen = $state(false);

    $effect(() => {
        function onKey(e: KeyboardEvent) {
            const t = e.target as HTMLElement | null;
            const inField = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
            if (e.key === '/' && !inField) {
                e.preventDefault();
                filterEl?.focus();
                filterEl?.select();
            }
        }
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    });

    let defaultProfile = $derived(
        $settings.defaultProfileId
            ? $profiles.find(p => p.id === $settings.defaultProfileId)
            : $profiles[0]
    );

    let allInProject = $derived(
        Array.from($sessions.values()).filter((s) => s.projectId === projectId),
    );

    let filtered = $derived.by(() => {
        const q = filter.trim().toLowerCase();
        if (!q) return allInProject;
        return allInProject.filter((s) =>
            `${s.title} ${s.agent} ${s.status} ${s.activity ?? ""}`
                .toLowerCase()
                .includes(q),
        );
    });

    let groups = $derived.by(() => {
        const active: SessionState[] = [];
        const queued: SessionState[] = [];
        const done: SessionState[] = [];
        for (const s of filtered) {
            if (s.status === "queued") queued.push(s);
            else if (s.status === "finished" || s.status === "failed")
                done.push(s);
            else active.push(s);
        }
        return { active, queued, done };
    });

    let completed = $derived(
        Array.from($sessions.values()).filter(
            s => s.projectId === projectId && (s.status === 'finished' || s.status === 'failed')
        )
    );

    function activityDot(s: SessionState): string {
        if (s.status === "failed") return "bg-accent-error";
        if (s.status === "finished") return "bg-muted-foreground";
        if (s.status === "queued") return "bg-accent-info";
        if (s.activity === "awaiting_input") return "bg-accent-error";
        if (s.activity === "working") return "bg-accent-ok animate-pulse";
        return "bg-accent-warn";
    }

    function statusLabel(s: SessionState): string {
        if (s.status === "queued") return "queued";
        if (s.status === "failed") return "failed";
        if (s.status === "finished") return "finished";
        return s.activity ?? "starting";
    }

    function pick(id: string) {
        if (onSelect) onSelect(id);
        else ui.update((u) => ({ ...u, focusedSessionId: id }));
    }

    async function performDelete(s: SessionState) {
        try {
            const wasActive =
                s.status === "running" ||
                s.status === "starting" ||
                s.status === "queued";
            if (wasActive) {
                markSessionEnding(s.id);
                await killSession(s.id).catch((e) => toasts.error('Kill failed', String(e)));
                // Daemon's kill watcher escalates SIGTERM → SIGKILL within
                // 250ms; wait a hair longer so finish_session() lands first.
                await new Promise((r) => setTimeout(r, 350));
            }
            const r = (await sendCmd({
                cmd: "delete_session",
                session_id: s.id,
            })) as { ok: boolean; error?: string };
            if (!r.ok) throw new Error(r.error);
            sessions.update((m) => {
                m.delete(s.id);
                return m;
            });
            if ($ui.focusedSessionId === s.id) {
                ui.update((u) => ({ ...u, focusedSessionId: null }));
            }
        } catch (e) {
            toasts.error('Delete failed', String(e));
        }
    }
</script>

<div data-tour="sidebar" class="flex flex-col h-full overflow-hidden bg-card">
    <!-- Filter -->
    <div class="p-2 border-b border-border">
        <div class="relative">
            <Search
                size={12}
                class="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground"
            />
            <input
                type="text"
                bind:value={filter}
                bind:this={filterEl}
                placeholder="Filter sessions"
                class="w-full bg-input rounded pl-7 pr-2 py-1 text-xs border border-border focus:outline-none focus:border-gruvbox-yellow"
            />
        </div>
    </div>

    <!-- Sessions -->
    <div class="flex-1 overflow-y-auto">
        {#if filtered.length === 0}
            <div class="p-4 text-xs text-muted-foreground text-center">
                {filter ? "No matches" : "No sessions yet"}
            </div>
        {:else}
            {#if groups.active.length > 0}
                {@render group("Active", groups.active)}
            {/if}
            {#if groups.queued.length > 0}
                {@render group("Queued", groups.queued)}
            {/if}
            {#if groups.done.length > 0}
                {@render group("Past", groups.done)}
            {/if}
        {/if}
    </div>

    <!-- New session bar -->
    <div class="border-t border-border p-2 relative">
        <div class="flex items-stretch rounded overflow-hidden border border-border">
            <button class="flex-1 px-2 py-1.5 text-xs bg-secondary/40 hover:bg-secondary inline-flex items-center justify-center gap-1.5 disabled:opacity-50"
                    disabled={!$ui.activeProjectId || !defaultProfile}
                    onclick={() => $ui.activeProjectId && defaultProfile && startSession($ui.activeProjectId, defaultProfile.id)}>
                <Plus size={12} />
                New {defaultProfile?.name ?? 'session'}
            </button>
            <button class="px-2 bg-secondary/40 hover:bg-secondary border-l border-border"
                    onclick={() => (profileMenuOpen = !profileMenuOpen)}
                    aria-label="Choose profile">
                <ChevronDown size={12} />
            </button>
        </div>

        {#if profileMenuOpen}
            <!-- svelte-ignore a11y_click_events_have_key_events -->
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <div class="fixed inset-0 z-40" onclick={() => (profileMenuOpen = false)}></div>
            <div class="absolute bottom-12 left-2 right-2 z-50 bg-card border border-border rounded shadow-lg py-1 max-h-64 overflow-y-auto">
                {#each $profiles as p (p.id)}
                    {@const m = agentMeta(p.agent_type)}
                    <button class="w-full px-3 py-1.5 text-left text-xs hover:bg-secondary flex items-center gap-2"
                            onclick={() => { profileMenuOpen = false; $ui.activeProjectId && startSession($ui.activeProjectId, p.id); }}>
                        <m.icon size={12} class={m.color} />
                        <span class="flex-1 truncate">{p.name}</span>
                        {#if $settings.defaultProfileId === p.id}
                            <Check size={12} class="text-gruvbox-yellow" />
                        {/if}
                    </button>
                {/each}
                <div class="border-t border-border mt-1 pt-1">
                    <button class="w-full px-3 py-1.5 text-left text-xs hover:bg-secondary inline-flex items-center gap-2"
                            onclick={() => { profileMenuOpen = false; setView('profiles'); }}>
                        <Settings size={12} /> Manage profiles…
                    </button>
                </div>
            </div>
        {/if}
        {#if completed.length > 0}
            <button class="w-full px-2 py-1 text-[11px] text-muted-foreground hover:text-foreground hover:bg-secondary/40 text-left inline-flex items-center gap-1.5"
                    onclick={() => (clearConfirmOpen = true)}>
                <Trash2 size={11} /> Clear {completed.length} completed
            </button>
        {/if}
    </div>
</div>

<ConfirmDialog
    open={clearConfirmOpen}
    title="Clear completed"
    message={`Delete ${completed.length} finished/failed session${completed.length === 1 ? '' : 's'}? This cannot be undone.`}
    confirmLabel="Delete all"
    destructive
    onConfirm={async () => {
        clearConfirmOpen = false;
        for (const s of completed) {
            try { await sendCmd({ cmd: 'delete_session', session_id: s.id }); }
            catch (e) { toasts.error('Delete failed', `${s.title}: ${e}`); }
        }
        sessions.update(m => { for (const s of completed) m.delete(s.id); return m; });
        toasts.success(`Cleared ${completed.length} sessions`);
    }}
    onCancel={() => (clearConfirmOpen = false)} />

{#snippet group(title: string, items: SessionState[])}
    <div
        class="px-2 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1"
    >
        <ChevronRight size={10} />
        {title} <span class="font-normal">· {items.length}</span>
    </div>
    {#each items as s, idx (s.id)}
        {@const m = agentMeta(s.agent)}
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div
            class={cn(
                "group flex items-center gap-2 pl-3 pr-1 cursor-pointer hover:bg-secondary/60 border-l-2 transition-colors py-[var(--row-py)]",
                $ui.focusedSessionId === s.id
                    ? "bg-secondary border-gruvbox-yellow"
                    : "border-transparent",
            )}
            onclick={() => pick(s.id)}
            transition:slide={{ duration: 120 }}
        >
            <m.icon size={11} class={cn('flex-shrink-0', m.color)} />
            <div class="flex-1 min-w-0">
                <div class="text-sm truncate">{s.title}</div>
                <div class="text-[10px] text-muted-foreground truncate">
                    {statusLabel(s)}
                </div>
            </div>
            {#if idx < 9}
                <kbd class="ml-1 px-1 py-px text-[9px] font-mono text-muted-foreground/60 group-hover:text-muted-foreground hidden sm:inline">
                    {fmtChord(['mod', String(idx + 1)])}
                </kbd>
            {/if}
            {#if s.unread > 0 && $ui.focusedSessionId !== s.id}
                <span
                    class="text-[10px] bg-primary text-primary-foreground rounded-full px-1.5 leading-tight py-0.5"
                >
                    {s.unread > 99 ? "99+" : s.unread}
                </span>
            {/if}
            {#if s.status === "running" || s.status === "queued"}
            <button
                title="Kill session"
                aria-label="Kill session"
                class="w-6 h-6 rounded flex items-center justify-center text-muted-foreground hover:text-gruvbox-red hover:bg-background/60 transition-colors shrink-0 focus-visible:ring-1 focus-visible:ring-gruvbox-yellow focus-visible:outline-none"
                onclick={(e) => {
                    e.stopPropagation();
                    markSessionEnding(s.id);
                    killSession(s.id).catch((err) => {
                        toasts.error('Kill failed', String(err));
                        markSessionEnding(s.id, {
                            failReason: `kill failed: ${err}`,
                        });
                    });
                }}><X size={14} /></button>
        {/if}
        <button
            title="Delete session"
            aria-label="Delete session"
            class="w-6 h-6 rounded flex items-center justify-center text-muted-foreground hover:text-gruvbox-red hover:bg-background/60 transition-colors shrink-0 opacity-0 group-hover:opacity-100 focus-visible:ring-1 focus-visible:ring-gruvbox-yellow focus-visible:outline-none"
                onclick={(e) => {
                    e.stopPropagation();
                    confirmTarget = s;
                }}><Trash size={12} /></button>
        </div>
    {/each}
{/snippet}

<ConfirmDialog
    open={confirmTarget !== null}
    title="Delete session"
    message={confirmTarget
        ? confirmTarget.status === "running" ||
          confirmTarget.status === "starting" ||
          confirmTarget.status === "queued"
            ? `"${confirmTarget.title}" is still active. Kill and delete it?\nThis cannot be undone.`
            : `Delete "${confirmTarget.title}"?\nThis cannot be undone.`
        : ""}
    confirmLabel="Delete"
    destructive
    onConfirm={() => {
        const t = confirmTarget;
        confirmTarget = null;
        if (t) performDelete(t);
    }}
    onCancel={() => (confirmTarget = null)}
/>
