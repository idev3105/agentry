<script lang="ts">
    import { sessions } from "$lib/stores/sessions";
    import { ui, openOnboarding, setView } from "$lib/stores/ui";
    import { profiles } from "$lib/stores/profiles";
    import { settings } from "$lib/stores/settings";
    import { agentMeta } from "$lib/utils/agent";
    import {
        startSession,
        killSession,
        resumeSession,
        sendCmd,
    } from "$lib/ipc";
    import { markSessionEnding, markPendingFocus } from "$lib/stores/sessions";
    import {
        sessionOrder,
        applyOrder,
        moveSession,
    } from "$lib/stores/sessionOrder";
    import { toasts } from "$lib/stores/toasts.svelte";
    import type { SessionState } from "$lib/types";
    import { cn, fmtChord } from "$lib/utils/cn";
    import { Button } from "$lib/components/ui/button";
    import { Input } from "$lib/components/ui/input";
    import * as DropdownMenu from "$lib/components/ui/dropdown-menu";
    import ConfirmDialog from "./ConfirmDialog.svelte";
    import BrandIcon from "./BrandIcon.svelte";
    import EmptyState from "./EmptyState.svelte";
    import { slide } from "svelte/transition";
    import Plus from "@lucide/svelte/icons/plus";
    import Inbox from "@lucide/svelte/icons/inbox";
    import Search from "@lucide/svelte/icons/search";
    import X from "@lucide/svelte/icons/x";
    import RotateCcw from "@lucide/svelte/icons/rotate-ccw";
    import Trash from "@lucide/svelte/icons/trash-2";
    import Trash2 from "@lucide/svelte/icons/trash";
    import ChevronDown from "@lucide/svelte/icons/chevron-down";
    import Check from "@lucide/svelte/icons/check";
    import Settings from "@lucide/svelte/icons/settings";

    const {
        projectId,
        onSelect,
    }: { projectId: string; onSelect?: (id: string) => void } = $props();

    // User-initiated start: focus the new session once the daemon confirms it.
    // Register intent BEFORE the RPC — session_started can arrive before the
    // start_session response.
    function startFocused(
        pid: string,
        profId: string,
    ): Promise<{ session_id: string; status: string }> {
        markPendingFocus();
        return startSession(pid, profId);
    }

    let filter = $state("");
    let filterEl: HTMLInputElement | null = $state(null);
    let confirmTarget = $state<SessionState | null>(null);
    let clearConfirmOpen = $state(false);

    $effect(() => {
        function onKey(e: KeyboardEvent) {
            const t = e.target as HTMLElement | null;
            const inField =
                t &&
                (t.tagName === "INPUT" ||
                    t.tagName === "TEXTAREA" ||
                    t.isContentEditable);
            if (e.key === "/" && !inField) {
                e.preventDefault();
                filterEl?.focus();
                filterEl?.select();
            }
        }
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    });

    let defaultProfile = $derived(
        $settings.defaultProfileId
            ? $profiles.find((p) => p.id === $settings.defaultProfileId)
            : $profiles[0],
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
        // Reference $sessionOrder so this recomputes when ordering changes.
        void $sessionOrder;
        const active: SessionState[] = [];
        const queued: SessionState[] = [];
        const done: SessionState[] = [];
        for (const s of filtered) {
            if (s.status === "queued") queued.push(s);
            else if (s.status === "finished" || s.status === "failed")
                done.push(s);
            else active.push(s);
        }
        return {
            active: applyOrder(projectId, active),
            queued: applyOrder(projectId, queued),
            done: applyOrder(projectId, done),
        };
    });

    // --- Drag & drop reorder -------------------------------------------
    let draggingId = $state<string | null>(null);
    let dropTargetId = $state<string | null>(null);
    let dropBefore = $state(true);

    function onDragStart(e: DragEvent, id: string) {
        draggingId = id;
        if (e.dataTransfer) {
            e.dataTransfer.effectAllowed = "move";
            e.dataTransfer.setData("text/plain", id);
        }
    }

    function onDragOver(e: DragEvent, id: string) {
        if (!draggingId || draggingId === id) return;
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
        dropBefore = e.clientY < rect.top + rect.height / 2;
        dropTargetId = id;
    }

    function onDrop(e: DragEvent, items: SessionState[], targetId: string) {
        e.preventDefault();
        if (draggingId && draggingId !== targetId) {
            moveSession(
                projectId,
                items.map((s) => s.id),
                draggingId,
                targetId,
                dropBefore,
            );
        }
        draggingId = null;
        dropTargetId = null;
    }

    function onDragEnd() {
        draggingId = null;
        dropTargetId = null;
    }

    let completed = $derived(
        Array.from($sessions.values()).filter(
            (s) =>
                s.projectId === projectId &&
                (s.status === "finished" || s.status === "failed"),
        ),
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
                await killSession(s.id).catch((e) =>
                    toasts.error("Kill failed", String(e)),
                );
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
            toasts.error("Delete failed", String(e));
        }
    }
</script>

<div data-tour="sidebar" class="flex flex-col h-full overflow-hidden bg-card">
    <!-- Filter -->
    <div
        class="border-b border-border-strong"
        style="padding:var(--row-py) var(--pad-x)"
    >
        <div class="relative">
            <Search
                size={12}
                class="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground"
            />
            <Input
                type="text"
                bind:value={filter}
                bind:ref={filterEl}
                placeholder="Filter sessions"
                class="w-full pl-7 pr-2 text-xs"
            />
        </div>
    </div>

    <!-- Sessions -->
    <div class="flex-1 overflow-y-auto">
        {#if filtered.length === 0}
            {#if filter}
                <div class="p-4 text-xs text-muted-foreground text-center">
                    No matches
                </div>
            {:else}
                <EmptyState
                    icon={Inbox}
                    title="No sessions yet"
                    hint={`Press ${fmtChord(["mod", "t"])} to start one`}
                    action={$ui.activeProjectId && defaultProfile
                        ? {
                              label: "New session",
                              onClick: () =>
                                  $ui.activeProjectId &&
                                  defaultProfile &&
                                  startFocused(
                                      $ui.activeProjectId,
                                      defaultProfile.id,
                                  ),
                          }
                        : undefined}
                />
            {/if}
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
    <div
        class="border-t border-border-strong relative"
        style="padding:var(--row-py) var(--pad-x)"
    >
        <div
            class="flex items-stretch rounded overflow-hidden border border-border"
        >
            <Button
                variant="ghost"
                class="flex-1 rounded-none px-2 py-1.5 text-xs bg-secondary/40 hover:bg-secondary gap-1.5"
                disabled={!$ui.activeProjectId || !defaultProfile}
                onclick={() =>
                    $ui.activeProjectId &&
                    defaultProfile &&
                    startFocused($ui.activeProjectId, defaultProfile.id)}
            >
                <Plus size={12} />
                New {defaultProfile?.name ?? "session"}
            </Button>
            <DropdownMenu.Root>
                <DropdownMenu.Trigger
                    class="px-2 bg-secondary/40 hover:bg-secondary border-l border-border inline-flex items-center"
                    aria-label="Choose profile"
                >
                    <ChevronDown size={12} />
                </DropdownMenu.Trigger>
                <DropdownMenu.Content class="w-56" align="end" side="top">
                    {#each $profiles as p (p.id)}
                        {@const m = agentMeta(p.agent_type)}
                        <DropdownMenu.Item
                            class="text-xs"
                            onclick={() => {
                                $ui.activeProjectId &&
                                    startFocused($ui.activeProjectId, p.id);
                            }}
                        >
                            {#if m.brand}
                                <BrandIcon name={m.brand} size={14} />
                            {:else}
                                <m.icon size={12} class={m.color} />
                            {/if}
                            <span class="flex-1 truncate">{p.name}</span>
                            {#if $settings.defaultProfileId === p.id}
                                <Check size={12} class="text-accent" />
                            {/if}
                        </DropdownMenu.Item>
                    {/each}
                    <DropdownMenu.Separator />
                    <DropdownMenu.Item
                        class="text-xs"
                        onclick={() => setView("profiles")}
                    >
                        <Settings size={12} /> Manage profiles…
                    </DropdownMenu.Item>
                </DropdownMenu.Content>
            </DropdownMenu.Root>
        </div>

        {#if completed.length > 0}
            <Button
                variant="ghost"
                class="w-full justify-start px-2 py-1 h-auto text-[11px] text-muted-foreground hover:text-foreground hover:bg-secondary/40 gap-1.5"
                onclick={() => (clearConfirmOpen = true)}
            >
                <Trash2 size={11} /> Clear {completed.length} completed
            </Button>
        {/if}
    </div>
</div>

<ConfirmDialog
    open={clearConfirmOpen}
    title="Clear completed"
    message={`Delete ${completed.length} finished/failed session${completed.length === 1 ? "" : "s"}? This cannot be undone.`}
    confirmLabel="Delete all"
    destructive
    onConfirm={async () => {
        clearConfirmOpen = false;
        for (const s of completed) {
            try {
                await sendCmd({ cmd: "delete_session", session_id: s.id });
            } catch (e) {
                toasts.error("Delete failed", `${s.title}: ${e}`);
            }
        }
        sessions.update((m) => {
            for (const s of completed) m.delete(s.id);
            return m;
        });
        toasts.success(`Cleared ${completed.length} sessions`);
    }}
    onCancel={() => (clearConfirmOpen = false)}
/>

{#snippet group(title: string, items: SessionState[])}
    <div
        class="px-3 pt-3 pb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground/70 flex items-center gap-1.5"
    >
        {title} <span class="text-muted-foreground/40">{items.length}</span>
    </div>
    {#each items as s, idx (s.id)}
        {@const m = agentMeta(s.agent)}
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div
            class={cn(
                "group relative flex items-center gap-2 mx-1 pl-2 pr-1 rounded-md cursor-pointer transition-colors py-[var(--row-py)]",
                $ui.focusedSessionId === s.id
                    ? "bg-secondary text-foreground"
                    : "hover:bg-secondary/50",
                draggingId === s.id && "opacity-40",
            )}
            draggable="true"
            ondragstart={(e) => onDragStart(e, s.id)}
            ondragover={(e) => onDragOver(e, s.id)}
            ondrop={(e) => onDrop(e, items, s.id)}
            ondragend={onDragEnd}
            onclick={() => pick(s.id)}
            transition:slide={{ duration: 120 }}
        >
            {#if dropTargetId === s.id && draggingId !== s.id}
                <div
                    class={cn(
                        "pointer-events-none absolute left-1 right-1 h-0.5 rounded-full bg-accent",
                        dropBefore ? "-top-px" : "-bottom-px",
                    )}
                ></div>
            {/if}
            {#if m.brand}
                <BrandIcon name={m.brand} size={14} class="flex-shrink-0" />
            {:else}
                <m.icon size={11} class={cn("flex-shrink-0", m.color)} />
            {/if}
            <div class="relative flex-1 min-w-0">
                <div class="text-sm truncate flex items-center gap-1.5">
                    <span class="truncate">{s.title}</span>
                    {#if s.activity === "awaiting_input"}
                        <span
                            class="flex-shrink-0 text-[11px] px-1 py-px rounded bg-accent-error/15 text-accent-error font-medium uppercase tracking-wide animate-pulse"
                        >
                            needs you
                        </span>
                    {/if}
                </div>
                <div class="text-[10px] text-muted-foreground truncate">
                    {statusLabel(s)}
                </div>
                <!-- fade mask so long titles dissolve under hovered actions -->
                <div
                    class="pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-secondary to-transparent opacity-0 group-hover:opacity-100 transition-opacity"
                ></div>
            </div>
            {#if idx < 9}
                <kbd
                    class="ml-1 px-1 py-px text-[11px] font-mono text-muted-foreground/50 opacity-0 group-hover:opacity-100 transition-opacity hidden sm:inline"
                >
                    {fmtChord(["mod", String(idx + 1)])}
                </kbd>
            {/if}

            <div
                class="absolute right-1 flex items-center gap-0.5 opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto transition-opacity"
            >
                {#if s.status === "running" || s.status === "queued"}
                    <Button
                        variant="ghost"
                        size="icon-xs"
                        title="Kill session"
                        aria-label="Kill session"
                        class="text-muted-foreground hover:text-gruvbox-red hover:bg-background/60 shrink-0"
                        onclick={(e) => {
                            e.stopPropagation();
                            markSessionEnding(s.id);
                            killSession(s.id).catch((err) => {
                                toasts.error("Kill failed", String(err));
                                markSessionEnding(s.id, {
                                    failReason: `kill failed: ${err}`,
                                });
                            });
                        }}><X size={14} /></Button
                    >
                {/if}
                {#if s.status === "finished" || s.status === "failed"}
                    {@const profileExists = $profiles.some(
                        (p) => p.id === s.profileId,
                    )}
                    {#if profileExists}
                        <Button
                            variant="ghost"
                            size="icon-xs"
                            title="Restart session (same profile)"
                            aria-label="Restart session"
                            class="text-muted-foreground hover:text-gruvbox-green hover:bg-background/60 shrink-0"
                            onclick={(e) => {
                                e.stopPropagation();
                                startFocused(s.projectId, s.profileId).catch(
                                    (err) =>
                                        toasts.error(
                                            "Restart failed",
                                            String(err),
                                        ),
                                );
                            }}><RotateCcw size={13} /></Button
                        >
                    {:else if s.agent === "claude_code" || !!s.agent_session_id}
                        <Button
                            variant="ghost"
                            size="icon-xs"
                            title="Resume session (profile đã xóa — restart không khả dụng)"
                            aria-label="Resume session"
                            class="text-muted-foreground hover:text-gruvbox-green hover:bg-background/60 shrink-0"
                            onclick={(e) => {
                                e.stopPropagation();
                                resumeSession(s.id).catch((err) =>
                                    toasts.error("Resume failed", String(err)),
                                );
                            }}><RotateCcw size={13} /></Button
                        >
                    {/if}
                {/if}
                <Button
                    variant="ghost"
                    size="icon-xs"
                    title="Delete session"
                    aria-label="Delete session"
                    class="text-muted-foreground hover:text-gruvbox-red hover:bg-background/60 shrink-0"
                    onclick={(e) => {
                        e.stopPropagation();
                        confirmTarget = s;
                    }}><Trash size={12} /></Button
                >
            </div>
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
