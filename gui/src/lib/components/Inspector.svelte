<script lang="ts">
    import {
        sessions,
        updateSession,
        markSessionEnding,
        markPendingFocus,
    } from "$lib/stores/sessions";
    import { profiles } from "$lib/stores/profiles";
    import { projects } from "$lib/stores/projects";
    import { ui } from "$lib/stores/ui";
    import { toasts } from "$lib/stores/toasts.svelte";
    import type {
        TrackedFileInfo,
        SessionEventInfo,
        SessionState,
    } from "$lib/types";
    import {
        killSession,
        listTrackedFiles,
        listSessionEvents,
        onFileTracked,
        onSessionEventLogged,
        resumeSession,
        sendCmd,
        startSession,
    } from "$lib/ipc";
    import { cn } from "$lib/utils/cn";
    import { shellQuote } from "$lib/utils/shell";
    import { Button } from "$lib/components/ui/button";
    import { Input } from "$lib/components/ui/input";
    import { Badge } from "$lib/components/ui/badge";
    import * as Card from "$lib/components/ui/card";
    import ConfirmDialog from "./ConfirmDialog.svelte";
    import RotateCcw from "@lucide/svelte/icons/rotate-ccw";
    import Square from "@lucide/svelte/icons/square";
    import Pencil from "@lucide/svelte/icons/pencil";
    import FolderOpen from "@lucide/svelte/icons/folder-open";
    import Trash from "@lucide/svelte/icons/trash-2";
    import Copy from "@lucide/svelte/icons/copy";
    import Terminal from "@lucide/svelte/icons/terminal";

    let session = $derived<SessionState | undefined>(
        $ui.focusedSessionId ? $sessions.get($ui.focusedSessionId) : undefined,
    );

    let sessionProfile = $derived(
        session
            ? $profiles.find((p) => p.id === session?.profileId)
            : undefined,
    );

    let sessionProject = $derived(
        session ? $projects.get(session.projectId) : undefined,
    );

    function switchToProject(id: string) {
        ui.update((u) => ({ ...u, activeProjectId: id, view: "overview" }));
    }

    let renaming = $state(false);
    let renameValue = $state("");
    let renameEl = $state<HTMLInputElement | null>(null);
    let copied = $state<string | null>(null);
    let confirmTarget = $state<SessionState | null>(null);
    type InspectorTab = "info" | "files" | "timeline";
    let activeTab = $state<InspectorTab>("info");

    // Every file written/edited by a tool, reported via agent hooks.
    let trackedFiles = $state<TrackedFileInfo[]>([]);
    // Search query for the Files tab.
    let fileQuery = $state("");

    let filteredFiles = $derived.by(() => {
        const q = fileQuery.trim().toLowerCase();
        if (!q) return trackedFiles;
        return trackedFiles.filter(
            (f) =>
                f.name.toLowerCase().includes(q) ||
                f.path.toLowerCase().includes(q),
        );
    });

    // Reload the file list whenever the focused session changes.
    $effect(() => {
        const sid = session?.id;
        if (!sid) {
            trackedFiles = [];
            return;
        }
        let cancelled = false;
        listTrackedFiles(sid)
            .then((files) => {
                if (!cancelled) trackedFiles = files;
            })
            .catch(() => {
                if (!cancelled) trackedFiles = [];
            });
        return () => {
            cancelled = true;
        };
    });

    // Append newly tracked files for the focused session (already deduped by
    // the daemon, but guard against double-render across reloads).
    $effect(() => {
        const unlisten = onFileTracked((e) => {
            if (e.session_id !== session?.id) return;
            if (trackedFiles.some((f) => f.path === e.path)) return;
            trackedFiles = [
                ...trackedFiles,
                { path: e.path, name: e.name, tool: e.tool, ts: e.ts },
            ];
        });
        return () => {
            unlisten.then((f) => f());
        };
    });

    // Event log (timeline): every agent hook event for the focused session.
    let eventLog = $state<SessionEventInfo[]>([]);

    $effect(() => {
        const sid = session?.id;
        if (!sid) {
            eventLog = [];
            return;
        }
        let cancelled = false;
        listSessionEvents(sid)
            .then((evs) => {
                if (!cancelled) eventLog = evs;
            })
            .catch(() => {
                if (!cancelled) eventLog = [];
            });
        return () => {
            cancelled = true;
        };
    });

    $effect(() => {
        const unlisten = onSessionEventLogged((e) => {
            if (e.session_id !== session?.id) return;
            eventLog = [
                ...eventLog,
                { name: e.name, detail: e.detail, ts: e.ts },
            ];
        });
        return () => {
            unlisten.then((f) => f());
        };
    });

    $effect(() => {
        if (renaming) renameEl?.focus();
    });

    $effect(() => {
        function onKey(e: KeyboardEvent) {
            if (e.key === "F2" && session && !renaming) {
                e.preventDefault();
                startRename(session);
            }
        }
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    });

    async function copy(text: string) {
        try {
            await navigator.clipboard.writeText(text);
            copied = text;
            toasts.success("Copied to clipboard");
            setTimeout(() => {
                if (copied === text) copied = null;
            }, 1200);
        } catch (e) {
            toasts.error("Copy failed", String(e));
        }
    }

    function doKill(s: SessionState) {
        markSessionEnding(s.id);
        killSession(s.id).catch((err) => {
            toasts.error("Kill failed", String(err));
            markSessionEnding(s.id, { failReason: `kill failed: ${err}` });
        });
    }

    async function performDelete(s: SessionState) {
        try {
            const wasActive =
                s.status === "running" ||
                s.status === "starting" ||
                s.status === "queued";
            if (wasActive) {
                // Ask daemon to stop the PTY. The kill watcher escalates
                // SIGTERM → SIGKILL within 250ms, so by the time delete_session
                // runs the row is no longer active.
                markSessionEnding(s.id);
                await killSession(s.id).catch(() => {});
                await new Promise((r) => setTimeout(r, 350));
            }
            const r = (await sendCmd({
                cmd: "delete_session",
                session_id: s.id,
            })) as {
                ok: boolean;
                error?: string;
            };
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

    async function duplicate(s: SessionState) {
        try {
            markPendingFocus();
            await startSession(s.projectId, s.profileId);
            toasts.success(`Duplicated ${s.title}`);
        } catch (e) {
            toasts.error("Duplicate failed", String(e));
        }
    }

    function copyAsCli(s: SessionState) {
        const p = $profiles.find((x) => x.id === s.profileId);
        if (!p) {
            toasts.error("Profile not found");
            return;
        }
        const env = p.env
            .map((e) => `${e.key}=${shellQuote(e.value)}`)
            .join(" ");
        const flags = p.params
            .map((x) =>
                x.value !== null ? `${x.flag}=${shellQuote(x.value)}` : x.flag,
            )
            .join(" ");
        const bin =
            p.agent_type === "claude_code"
                ? "claude"
                : p.agent_type === "codex"
                  ? "codex"
                  : "opencode";
        const cmd = `cd ${shellQuote(s.cwd)} && ${env} ${bin} ${flags}`
            .replace(/\s+/g, " ")
            .trim();
        navigator.clipboard.writeText(cmd);
        toasts.success("Copied CLI command");
    }

    function statusColor(s: SessionState): string {
        if (s.status === "failed") return "text-accent-error";
        if (s.status === "finished") return "text-muted-foreground";
        if (s.activity === "awaiting_input") return "text-accent-error";
        if (s.activity === "working") return "text-accent-ok";
        return "text-accent-warn";
    }

    function statusDot(s: SessionState): string {
        if (s.status === "failed") return "bg-accent-error";
        if (s.status === "finished") return "bg-muted-foreground";
        if (s.activity === "awaiting_input") return "bg-accent-error";
        if (s.activity === "working") return "bg-accent-ok";
        return "bg-accent-warn";
    }

    function statusLabel(s: SessionState): string {
        if (s.status === "queued") return "Queued";
        if (s.status === "running")
            return s.activity ? s.activity.replace("_", " ") : "running";
        if (s.status === "failed") return "Failed";
        if (s.status === "finished") return "Finished";
        return s.status;
    }

    async function startRename(s: SessionState) {
        renameValue = s.title;
        renaming = true;
    }

    async function commitRename(id: string) {
        if (!renameValue.trim()) {
            renaming = false;
            return;
        }
        try {
            await sendCmd({
                cmd: "rename_session",
                session_id: id,
                title: renameValue.trim(),
            });
        } catch (e) {
            toasts.error("Rename failed", String(e));
        }
        renaming = false;
    }

    async function openCwd(path: string) {
        try {
            const { openPath } = await import("@tauri-apps/plugin-opener");
            await openPath(path);
        } catch (e) {
            toasts.error("Open failed", String(e));
        }
    }
</script>

<aside
    data-tour="inspector"
    class="flex flex-col h-full w-full overflow-y-auto text-sm bg-background"
>
    {#if !session}
        <div
            class="flex items-center justify-center h-full text-muted-foreground text-xs px-4 text-center"
        >
            Select a session to inspect details.
        </div>
    {:else}
        <!-- Header -->
        <div class="px-4 pt-4 pb-3 border-b border-border space-y-2">
            <div class="flex items-center gap-2">
                {#if renaming}
                    <Input
                        bind:value={renameValue}
                        bind:ref={renameEl}
                        class="flex-1 h-auto py-0.5 text-sm font-medium"
                        onkeydown={(e) =>
                            e.key === "Enter" && commitRename(session!.id)}
                        onblur={() => commitRename(session!.id)}
                    />
                {:else}
                    <Badge
                        variant="outline"
                        class={cn("text-xs", statusColor(session))}
                    >
                        {statusLabel(session)}
                    </Badge>
                {/if}
            </div>

            <div class="flex gap-0.5 pt-1">
                <Button
                    variant="ghost"
                    size="icon-xs"
                    class="text-muted-foreground hover:text-foreground"
                    title="Rename (F2)"
                    onclick={() => startRename(session!)}
                >
                    <Pencil size={12} />
                </Button>
                {#if session.status === "running" || session.status === "queued"}
                    <Button
                        variant="ghost"
                        size="icon-xs"
                        class="text-muted-foreground hover:text-accent-error"
                        title="Kill session"
                        onclick={() => doKill(session!)}
                    >
                        <Square size={14} fill="currentColor" />
                    </Button>
                {/if}
                {#if session.status === "finished" || session.status === "failed"}
                    {@const canResume =
                        session.agent === "claude_code" ||
                        !!session.agent_session_id}
                    <Button
                        variant="ghost"
                        size="icon-xs"
                        class="text-muted-foreground hover:text-foreground"
                        disabled={!canResume}
                        title={canResume
                            ? "Resume session"
                            : `Session này không capture được id — không resume được`}
                        onclick={() => canResume && resumeSession(session!.id)}
                    >
                        <RotateCcw size={14} />
                    </Button>
                {/if}
                <Button
                    variant="ghost"
                    size="icon-xs"
                    title="Delete session permanently"
                    class="text-muted-foreground hover:text-accent-error"
                    onclick={() => (confirmTarget = session!)}
                >
                    <Trash size={14} />
                </Button>
            </div>
        </div>

        <!-- Tab bar -->
        <div class="flex border-b border-border px-4">
            {#each [["info", "Info"], ["files", "Files"], ["timeline", "Timeline"]] as [id, label]}
                <Button
                    variant="ghost"
                    class={cn(
                        "rounded-none px-3 py-2 h-auto text-xs border-b-2 hover:bg-transparent",
                        activeTab === id
                            ? "border-primary text-foreground"
                            : "border-transparent text-muted-foreground hover:text-foreground",
                    )}
                    onclick={() => (activeTab = id as InspectorTab)}
                    >{label}</Button
                >
            {/each}
        </div>

        {#if activeTab === "info"}
            <!-- Sections -->
            <section class="px-4 py-3 border-b border-border space-y-2">
                <h3
                    class="text-[10px] uppercase tracking-wider text-muted-foreground"
                >
                    General
                </h3>
                {@render row("Agent", session.agent)}
                {#if sessionProfile}
                    {@render row("Profile", sessionProfile.name)}
                {/if}
                {#if sessionProject}
                    <div class="flex items-baseline justify-between gap-2">
                        <span
                            class="text-[10px] uppercase tracking-wider text-muted-foreground"
                            >Project</span
                        >
                        <Button
                            variant="link"
                            class="h-auto p-0 text-xs hover:text-accent truncate"
                            title="Switch to this project"
                            onclick={() => switchToProject(sessionProject!.id)}
                        >
                            {sessionProject.name}
                        </Button>
                    </div>
                {/if}
                {@render row("Status", session.status)}
                {#if session.activity}
                    {@render row("Activity", session.activity)}
                {/if}
                <div>
                    <div class="flex items-center justify-between mb-1">
                        <span
                            class="text-[10px] uppercase tracking-wider text-muted-foreground"
                            >Session ID</span
                        >
                        <Button
                            variant="ghost"
                            size="icon-xs"
                            class="text-muted-foreground hover:text-foreground"
                            onclick={() => copy(session!.id)}
                            title="Copy ID"
                            aria-label="Copy ID"
                        >
                            <Copy size={10} />
                        </Button>
                    </div>
                    <div
                        class="font-mono text-[10px] break-all text-muted-foreground select-all"
                    >
                        {session.id}
                    </div>
                </div>
                {#if session.agent_session_id}
                    <div>
                        <div class="flex items-center justify-between mb-1">
                            <span
                                class="text-[10px] uppercase tracking-wider text-muted-foreground"
                                >Agent ID</span
                            >
                            <Button
                                variant="ghost"
                                size="icon-xs"
                                class="text-muted-foreground hover:text-foreground"
                                onclick={() => copy(session!.agent_session_id!)}
                                title="Copy Agent ID"
                                aria-label="Copy Agent ID"
                            >
                                <Copy size={10} />
                            </Button>
                        </div>
                        <div
                            class="font-mono text-[10px] break-all text-muted-foreground select-all"
                        >
                            {session.agent_session_id}
                        </div>
                    </div>
                {/if}
                {#if session.agent_session_name}
                    {@render row("Agent name", session.agent_session_name)}
                {/if}
                <div>
                    <div
                        class="text-[10px] uppercase tracking-wider text-muted-foreground mb-1"
                    >
                        Working dir
                    </div>
                    <div class="flex items-center gap-1">
                        <Button
                            variant="ghost"
                            class="flex-1 justify-start h-auto p-0 font-mono text-xs break-all text-left hover:text-accent hover:bg-transparent items-start gap-1.5"
                            onclick={() => openCwd(session!.cwd)}
                            title="Open in file manager"
                        >
                            <FolderOpen
                                size={11}
                                class="mt-0.5 text-muted-foreground flex-shrink-0"
                            />
                            <span>{session.cwd}</span>
                        </Button>
                        <Button
                            variant="ghost"
                            size="icon-xs"
                            class="text-muted-foreground hover:text-foreground"
                            onclick={() => copy(session!.cwd)}
                            title="Copy path"
                            aria-label="Copy path"
                        >
                            <Copy size={11} />
                        </Button>
                    </div>
                </div>
                {@render row(
                    "Unread",
                    String(session.unread),
                    session.unread === 0,
                )}
                {#if session.exitCode != null}
                    {@render row(
                        "Exit code",
                        String(session.exitCode),
                        session.exitCode === 0,
                    )}
                {/if}
                {#if session.createdAt}
                    {@render row(
                        "Started",
                        new Date(session.createdAt).toLocaleTimeString(),
                    )}
                {/if}
            </section>

            {#if session.failReason}
                <section class="px-4 py-3 border-b border-border space-y-2">
                    <h3
                        class="text-[10px] uppercase tracking-wider text-muted-foreground"
                    >
                        Fail reason
                    </h3>
                    <Card.Root class="border-0 bg-card py-0">
                        <Card.Content class="px-0">
                            <pre
                                class="text-xs text-accent-error rounded p-2 overflow-x-auto whitespace-pre-wrap break-all">{session.failReason}</pre>
                        </Card.Content>
                    </Card.Root>
                </section>
            {/if}
        {:else if activeTab === "files"}
            <!-- Files tab: every file written/edited by the agent, searchable -->
            <section class="px-4 py-3 space-y-2">
                <Input
                    bind:value={fileQuery}
                    placeholder="Search files…"
                    class="h-7 text-xs"
                />
                {#if filteredFiles.length === 0}
                    <div class="text-xs text-muted-foreground py-6 text-center">
                        {trackedFiles.length === 0
                            ? "No files yet."
                            : "No matches."}
                    </div>
                {:else}
                    {#each filteredFiles as file (file.path)}
                        <div
                            class="flex items-center gap-1 rounded border border-border px-2 py-1.5"
                        >
                            <div class="min-w-0 flex-1">
                                <div
                                    class="text-xs font-medium truncate"
                                    title={file.name}
                                >
                                    {file.name}
                                </div>
                                <div
                                    class="text-[10px] text-muted-foreground font-mono truncate"
                                    title={file.path}
                                >
                                    {file.path}
                                </div>
                            </div>
                            {#if file.tool}
                                <span
                                    class="text-[10px] text-muted-foreground shrink-0"
                                    >{file.tool}</span
                                >
                            {/if}
                            <Button
                                variant="ghost"
                                size="icon-xs"
                                class="text-muted-foreground hover:text-foreground"
                                title="Open file"
                                onclick={() => openCwd(file.path)}
                            >
                                <FolderOpen size={12} />
                            </Button>
                            <Button
                                variant="ghost"
                                size="icon-xs"
                                class="text-muted-foreground hover:text-foreground"
                                title="Copy path"
                                onclick={() => copy(file.path)}
                            >
                                <Copy size={11} />
                            </Button>
                        </div>
                    {/each}
                {/if}
            </section>
        {:else}
            <!-- Timeline tab: full agent event log -->
            <section class="px-4 py-3">
                {#if eventLog.length === 0}
                    <div class="text-xs text-muted-foreground py-6 text-center">
                        No events recorded yet.
                    </div>
                {:else}
                    {#each eventLog as ev, i (i)}
                        <div class="flex gap-3">
                            <div class="flex flex-col items-center">
                                <span
                                    class="w-2 h-2 rounded-full border-2 border-accent-ok bg-accent-ok flex-shrink-0 mt-1"
                                ></span>
                                {#if i < eventLog.length - 1}
                                    <span
                                        class="w-0.5 flex-1 min-h-[14px] bg-border"
                                    ></span>
                                {/if}
                            </div>
                            <div class="pb-3 min-w-0 flex-1">
                                <div
                                    class="flex items-baseline justify-between gap-2"
                                >
                                    <span
                                        class="text-xs font-medium truncate"
                                        title={ev.name}
                                    >
                                        {ev.name}
                                    </span>
                                    <span
                                        class="text-[10px] text-muted-foreground font-mono flex-shrink-0"
                                    >
                                        {new Date(
                                            Number(ev.ts) * 1000,
                                        ).toLocaleTimeString()}
                                    </span>
                                </div>
                                {#if ev.detail}
                                    <div
                                        class="text-[10px] text-muted-foreground font-mono truncate"
                                        title={ev.detail}
                                    >
                                        {ev.detail}
                                    </div>
                                {/if}
                            </div>
                        </div>
                    {/each}
                {/if}
            </section>
        {/if}
    {/if}
</aside>

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

{#snippet row(label: string, value: string, muted: boolean = false)}
    <div class="flex items-baseline justify-between gap-2">
        <span class="text-[10px] uppercase tracking-wider text-muted-foreground"
            >{label}</span
        >
        <span class={cn("text-xs", muted && "text-muted-foreground")}
            >{value}</span
        >
    </div>
{/snippet}
