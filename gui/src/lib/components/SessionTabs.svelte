<script lang="ts">
    import { sessions, markSessionEnding } from "$lib/stores/sessions";
    import { ui } from "$lib/stores/ui";
    import { killSession, resumeSession } from "$lib/ipc";
    import { toasts } from "$lib/stores/toasts.svelte";
    import { agentMeta } from "$lib/utils/agent";
    import { cn } from "$lib/utils/cn";
    import { Button } from "$lib/components/ui/button";
    import BrandIcon from "$lib/components/BrandIcon.svelte";
    import X from "@lucide/svelte/icons/x";
    import Square from "@lucide/svelte/icons/square";
    import RotateCcw from "@lucide/svelte/icons/rotate-ccw";
    import Copy from "@lucide/svelte/icons/copy";

    // onSelect MUST be the parent's pickSession — it clears the terminal and
    // replays the new session's ring buffer. Updating focusedSessionId alone
    // (the old switchTo) leaves the previous session's content on screen.
    let { onSelect }: { onSelect: (id: string) => void } = $props();

    let tabs = $derived(
        Array.from($sessions.values())
            .filter(
                (s) =>
                    s.projectId === $ui.activeProjectId &&
                    s.status !== "finished" &&
                    s.status !== "failed",
            )
            .sort((a, b) => a.title.localeCompare(b.title)),
    );

    // Active session drives the right-side status + actions cluster.
    let active = $derived(
        $ui.focusedSessionId ? $sessions.get($ui.focusedSessionId) : undefined,
    );

    function switchTo(id: string) {
        if (id === $ui.focusedSessionId) return;
        onSelect(id);
    }

    function closeTab(e: MouseEvent, id: string) {
        e.stopPropagation();
        markSessionEnding(id);
        killSession(id).catch((err) =>
            markSessionEnding(id, { failReason: `kill failed: ${err}` }),
        );
    }
</script>

{#if tabs.length > 0}
    <div
        class="flex items-stretch border-b border-border bg-card overflow-hidden"
        style="height:var(--bar-h)"
    >
        <!-- Tab strip — scrolls independently of the action cluster -->
        <div class="flex items-stretch overflow-x-auto min-w-0">
            {#each tabs as s (s.id)}
                {@const m = agentMeta(s.agent)}
                {@const isActive = $ui.focusedSessionId === s.id}
                <!-- svelte-ignore a11y_click_events_have_key_events -->
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <div
                    role="tab"
                    tabindex="0"
                    class={cn(
                        "inline-flex items-center gap-1.5 text-xs cursor-pointer border-r border-border min-w-0 group",
                        isActive
                            ? "bg-background text-foreground"
                            : "text-muted-foreground hover:bg-secondary/40",
                    )}
                    style="padding-inline:var(--pad-x)"
                    onclick={() => switchTo(s.id)}
                    onauxclick={(e) => e.button === 1 && closeTab(e, s.id)}
                >
                    {#if m.brand}
                        <BrandIcon
                            name={m.brand}
                            size={12}
                            class="flex-shrink-0"
                        />
                    {:else}
                        <m.icon
                            size={11}
                            class={cn(m.color, "flex-shrink-0")}
                        />
                    {/if}
                    <span class="truncate max-w-[140px]">{s.title}</span>

                    <Button
                        variant="ghost"
                        size="icon-xs"
                        class="ml-1 size-4 opacity-0 group-hover:opacity-100 hover:bg-secondary"
                        onclick={(e) => closeTab(e, s.id)}
                        aria-label="Close session"
                    >
                        <X size={10} />
                    </Button>
                </div>
            {/each}
        </div>

        <!-- Active-session status + actions, pinned right -->
        {#if active}
            <div
                class="flex items-center gap-1.5 ml-auto flex-shrink-0 border-l border-border"
                style="padding-inline:var(--pad-x)"
            >
                <span
                    class="flex items-center gap-1.5 text-[11px] text-muted-foreground"
                >
                    <span
                        class={cn(
                            "w-1.5 h-1.5 rounded-full",
                            active.activity === "awaiting_input"
                                ? "bg-accent-error"
                                : active.activity === "working"
                                  ? "bg-accent-ok"
                                  : "bg-muted-foreground/50",
                        )}
                    ></span>
                    {active.activity
                        ? active.activity.replace("_", " ")
                        : active.status}
                </span>
                {#if active.status === "running" || active.status === "queued"}
                    <Button
                        variant="ghost"
                        size="icon-xs"
                        class="text-muted-foreground hover:text-gruvbox-red"
                        title="Kill"
                        aria-label="Kill"
                        onclick={() => {
                            markSessionEnding(active!.id);
                            killSession(active!.id).catch((e) =>
                                toasts.error("Kill failed", String(e)),
                            );
                        }}
                    >
                        <Square size={12} fill="currentColor" />
                    </Button>
                {/if}
                {#if (active.status === "finished" || active.status === "failed") && (active.agent === "claude_code" || active.agent_session_id)}
                    <Button
                        variant="ghost"
                        size="icon-xs"
                        title="Resume"
                        aria-label="Resume"
                        onclick={() => resumeSession(active!.id)}
                    >
                        <RotateCcw size={12} />
                    </Button>
                {/if}
                <Button
                    variant="ghost"
                    size="icon-xs"
                    title="Copy session ID"
                    aria-label="Copy session ID"
                    onclick={() => {
                        navigator.clipboard.writeText(active!.id);
                        toasts.info("Copied session ID");
                    }}
                >
                    <Copy size={12} />
                </Button>
            </div>
        {/if}
    </div>
{/if}
