<script lang="ts">
    import { sessions } from "$lib/stores/sessions";
    import { ui, openWizard } from "$lib/stores/ui";
    import { profiles } from "$lib/stores/profiles";
    import { startSession, killSession, sendCmd } from "$lib/ipc";
    import { markSessionEnding } from "$lib/stores/sessions";
    import type { SessionState } from "$lib/types";
    import { cn } from "$lib/utils/cn";
    import ConfirmDialog from "./ConfirmDialog.svelte";
    import Plus from "@lucide/svelte/icons/plus";
    import Search from "@lucide/svelte/icons/search";
    import X from "@lucide/svelte/icons/x";
    import Trash from "@lucide/svelte/icons/trash-2";
    import ChevronRight from "@lucide/svelte/icons/chevron-right";

    const {
        projectId,
        onSelect,
    }: { projectId: string; onSelect?: (id: string) => void } = $props();

    let filter = $state("");
    let menuOpen = $state(false);
    let confirmTarget = $state<SessionState | null>(null);

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

    function activityDot(s: SessionState): string {
        if (s.status === "failed") return "bg-gruvbox-red";
        if (s.status === "finished") return "bg-muted-foreground";
        if (s.status === "queued") return "bg-gruvbox-gray";
        if (s.activity === "awaiting_input") return "bg-gruvbox-red";
        if (s.activity === "working") return "bg-gruvbox-green animate-pulse";
        return "bg-gruvbox-yellow";
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

    async function quickStart(profileId: string) {
        menuOpen = false;
        await startSession(projectId, profileId);
    }

    async function performDelete(s: SessionState) {
        try {
            const wasActive =
                s.status === "running" ||
                s.status === "starting" ||
                s.status === "queued";
            if (wasActive) {
                markSessionEnding(s.id);
                await killSession(s.id).catch(() => {});
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
            console.error("delete failed:", e);
        }
    }
</script>

<div class="flex flex-col h-full overflow-hidden bg-card">
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
        {#if menuOpen}
            <!-- svelte-ignore a11y_click_events_have_key_events -->
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <div
                class="fixed inset-0 z-30"
                onclick={() => (menuOpen = false)}
            ></div>
            <div
                class="absolute bottom-full left-2 right-2 mb-1 bg-card border border-border rounded shadow-lg overflow-hidden z-40"
            >
                {#if $profiles.length === 0}
                    <button
                        class="w-full text-left px-3 py-2 text-xs hover:bg-secondary"
                        onclick={() => {
                            menuOpen = false;
                            openWizard();
                        }}
                    >
                        No profiles — set up first agent…
                    </button>
                {:else}
                    {#each $profiles as p (p.id)}
                        <button
                            class="w-full text-left px-3 py-2 text-xs hover:bg-secondary"
                            onclick={() => quickStart(p.id)}
                        >
                            <div class="font-medium">{p.name}</div>
                            <div class="text-[10px] text-muted-foreground">
                                {p.agent_type}
                            </div>
                        </button>
                    {/each}
                {/if}
            </div>
        {/if}
        <button
            class="w-full flex items-center justify-center gap-1.5 text-xs px-3 py-1.5 rounded bg-secondary hover:bg-secondary/80 transition-colors"
            onclick={() => (menuOpen = !menuOpen)}
        >
            <Plus size={12} /> New session
        </button>
    </div>
</div>

{#snippet group(title: string, items: SessionState[])}
    <div
        class="px-2 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1"
    >
        <ChevronRight size={10} />
        {title} <span class="font-normal">· {items.length}</span>
    </div>
    {#each items as s (s.id)}
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div
            class={cn(
                "group flex items-center gap-2 pl-3 pr-1 py-1.5 cursor-pointer hover:bg-secondary/60 border-l-2 transition-colors",
                $ui.focusedSessionId === s.id
                    ? "bg-secondary border-gruvbox-yellow"
                    : "border-transparent",
            )}
            onclick={() => pick(s.id)}
        >
            <span class={cn("w-2 h-2 rounded-full shrink-0", activityDot(s))}
            ></span>
            <div class="flex-1 min-w-0">
                <div class="text-sm truncate">{s.title}</div>
                <div class="text-[10px] text-muted-foreground truncate">
                    {statusLabel(s)}
                </div>
            </div>
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
                    class="w-6 h-6 rounded flex items-center justify-center text-muted-foreground hover:text-gruvbox-red hover:bg-background/60 transition-colors shrink-0"
                    onclick={(e) => {
                        e.stopPropagation();
                        // Optimistic: flip to finished + unfocus immediately so
                        // the row jumps to "Past" and the terminal pane closes
                        // without waiting for the daemon's session_finished event.
                        markSessionEnding(s.id);
                        killSession(s.id).catch((err) => {
                            markSessionEnding(s.id, {
                                failReason: `kill failed: ${err}`,
                            });
                        });
                    }}><X size={14} /></button
                >
            {/if}
            <button
                title="Delete session"
                aria-label="Delete session"
                class="w-6 h-6 rounded flex items-center justify-center text-muted-foreground hover:text-gruvbox-red hover:bg-background/60 transition-colors shrink-0 opacity-0 group-hover:opacity-100"
                onclick={(e) => {
                    e.stopPropagation();
                    confirmTarget = s;
                }}><Trash size={12} /></button
            >
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
