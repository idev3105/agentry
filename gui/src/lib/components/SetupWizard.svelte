<script lang="ts">
    import { open as openDialog } from "@tauri-apps/plugin-dialog";
    import { ui, closeWizard } from "$lib/stores/ui";
    import { profiles } from "$lib/stores/profiles";
    import {
        createProject,
        listProjects,
        listProfiles,
        startSession,
        sendCmd,
    } from "$lib/ipc";
    import { addProject } from "$lib/stores/projects";
    import { cn } from "$lib/utils/cn";
    import FolderOpen from "@lucide/svelte/icons/folder-open";
    import Sparkles from "@lucide/svelte/icons/sparkles";
    import ArrowRight from "@lucide/svelte/icons/arrow-right";
    import ArrowLeft from "@lucide/svelte/icons/arrow-left";
    import Terminal from "@lucide/svelte/icons/terminal";
    import Check from "@lucide/svelte/icons/check";
    import Loader2 from "@lucide/svelte/icons/loader-2";
    import type { AgentType } from "$lib/types";

    type Step = "welcome" | "folder" | "agent" | "creating" | "done";

    let step = $state<Step>("welcome");
    let folder = $state("");
    let projectName = $state("");
    let agent = $state<AgentType>("claude_code");
    let creating = $state(false);
    let error = $state<string | null>(null);

    const agents: { id: AgentType; label: string; desc: string }[] = [
        {
            id: "claude_code",
            label: "Claude Code",
            desc: "Anthropic Claude with native session resume",
        },
        { id: "codex", label: "Codex", desc: "OpenAI Codex CLI" },
        {
            id: "open_code",
            label: "OpenCode",
            desc: "Open-source coding agent",
        },
    ];

    async function pickFolder() {
        try {
            const result = await openDialog({
                directory: true,
                multiple: false,
                title: "Pick a project folder",
            });
            if (typeof result === "string") {
                folder = result;
                if (!projectName.trim()) {
                    projectName =
                        result.split("/").filter(Boolean).pop() ?? "Project";
                }
            }
        } catch (e) {
            error = String(e);
        }
    }

    async function ensureProfile(at: AgentType): Promise<string> {
        // Reuse first profile of this agent type if any.
        const existing = $profiles.find((p) => p.agent_type === at);
        if (existing) return existing.id;

        // Create one with sensible defaults.
        const r = (await sendCmd({
            cmd: "create_profile",
            name: agents.find((a) => a.id === at)!.label,
            agent_type: at,
            params: [],
            env: [],
            start_script: null,
        })) as { ok: boolean; profile_id?: string; error?: string };

        if (!r.ok || !r.profile_id) {
            throw new Error(r.error || "create_profile failed");
        }
        return r.profile_id;
    }

    async function finish() {
        if (!folder.trim() || !projectName.trim()) return;
        creating = true;
        error = null;
        step = "creating";
        try {
            // Create project (idempotent — if it already exists, list_projects will surface it)
            await createProject(projectName.trim(), folder.trim());

            // Resolve fresh project list to find the created id.
            const projs = await listProjects();
            const proj =
                projs.find((p) => p.path === folder.trim()) ??
                projs[projs.length - 1];
            if (!proj) throw new Error("project not found after create");
            addProject({ ...proj, sessions: [] });

            // Ensure profile exists, refresh local store.
            const profileId = await ensureProfile(agent);
            profiles.set(await listProfiles());

            ui.update((u) => ({
                ...u,
                activeProjectId: proj.id,
                view: "terminal",
            }));

            // Kick off first session.
            await startSession(proj.id, profileId);

            step = "done";
        } catch (e) {
            error = String(e);
            step = "agent";
        } finally {
            creating = false;
        }
    }

    function close() {
        closeWizard();
        if (step === 'done' && !localStorage.getItem('agentry:onboarded')) {
            localStorage.setItem('agentry:onboarded', '1');
            setTimeout(() => window.dispatchEvent(new CustomEvent('tour:start')), 400);
        }
        setTimeout(() => {
            step = "welcome";
            folder = "";
            projectName = "";
            error = null;
        }, 200);
    }
</script>

{#if $ui.wizardOpen}
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
        class="fixed inset-0 z-50 bg-black/50 flex items-center justify-center"
        onclick={() => close()}
    >
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div
            class="bg-card border border-border rounded-lg shadow-2xl w-140 max-w-[90vw] overflow-hidden"
            onclick={(e) => e.stopPropagation()}
        >
            <!-- progress dots -->
            <div class="flex items-center justify-center gap-2 pt-4 pb-2">
                {#each ["welcome", "folder", "agent", "done"] as s, i}
                    <span
                        class={cn(
                            "w-1.5 h-1.5 rounded-full transition-colors",
                            step === s
                                ? "bg-gruvbox-yellow"
                                : [
                                        "welcome",
                                        "folder",
                                        "agent",
                                        "done",
                                    ].indexOf(step) > i
                                  ? "bg-gruvbox-green"
                                  : "bg-secondary",
                        )}
                    ></span>
                {/each}
            </div>

            <div class="p-6">
                {#if step === "welcome"}
                    <div class="text-center space-y-4">
                        <div
                            class="mx-auto w-12 h-12 rounded-full bg-gruvbox-yellow/10 flex items-center justify-center"
                        >
                            <Sparkles size={24} class="text-gruvbox-yellow" />
                        </div>
                        <div>
                            <h2 class="text-lg font-semibold">
                                Welcome to Agentry
                            </h2>
                            <p class="text-sm text-muted-foreground mt-1">
                                Run multiple coding agents side by side. Let's
                                set up your first project.
                            </p>
                        </div>
                        <button
                            class="px-4 py-2 rounded bg-primary text-primary-foreground hover:bg-primary/90 inline-flex items-center gap-2 text-sm font-medium"
                            onclick={() => (step = "folder")}
                        >
                            Get started <ArrowRight size={14} />
                        </button>
                    </div>
                {:else if step === "folder"}
                    <div class="space-y-4">
                        <div>
                            <h2 class="text-lg font-semibold">
                                Pick a project folder
                            </h2>
                            <p class="text-sm text-muted-foreground mt-1">
                                The agent will run with this folder as cwd.
                            </p>
                        </div>
                        <button
                            class="w-full px-3 py-3 rounded border border-dashed border-border hover:border-gruvbox-yellow hover:bg-secondary/30 transition-colors flex items-center gap-3 text-left"
                            onclick={pickFolder}
                        >
                            <FolderOpen
                                size={18}
                                class="text-muted-foreground"
                            />
                            <div class="flex-1 min-w-0">
                                {#if folder}
                                    <div class="text-sm font-mono truncate">
                                        {folder}
                                    </div>
                                {:else}
                                    <div class="text-sm text-muted-foreground">
                                        Click to choose…
                                    </div>
                                {/if}
                            </div>
                        </button>
                        <label class="block">
                            <span class="block text-xs text-muted-foreground mb-1">Project name</span>
                            <input
                                type="text"
                                bind:value={projectName}
                                class="w-full bg-input rounded px-2 py-1.5 text-sm border border-border focus:border-gruvbox-yellow focus:outline-none"
                                placeholder="My App"
                            />
                        </label>
                        <div class="flex justify-between">
                            <button
                                class="px-3 py-1.5 rounded text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5"
                                onclick={() => (step = "welcome")}
                            >
                                <ArrowLeft size={14} /> Back
                            </button>
                            <button
                                class="px-4 py-1.5 rounded bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 inline-flex items-center gap-1.5 text-sm font-medium"
                                disabled={!folder.trim() || !projectName.trim()}
                                onclick={() => (step = "agent")}
                            >
                                Next <ArrowRight size={14} />
                            </button>
                        </div>
                    </div>
                {:else if step === "agent"}
                    <div class="space-y-4">
                        <div>
                            <h2 class="text-lg font-semibold">Pick an agent</h2>
                            <p class="text-sm text-muted-foreground mt-1">
                                The agent's CLI must already be installed on
                                your system.
                            </p>
                        </div>
                        <div class="flex flex-col gap-2">
                            {#each agents as a (a.id)}
                                <button
                                    class={cn(
                                        "text-left px-3 py-3 rounded border transition-colors",
                                        agent === a.id
                                            ? "border-gruvbox-yellow bg-secondary/50"
                                            : "border-border hover:border-secondary",
                                    )}
                                    onclick={() => (agent = a.id)}
                                >
                                    <div class="text-sm font-medium">
                                        {a.label}
                                    </div>
                                    <div
                                        class="text-xs text-muted-foreground mt-0.5"
                                    >
                                        {a.desc}
                                    </div>
                                </button>
                            {/each}
                        </div>
                        {#if error}
                            <div class="text-xs text-gruvbox-red">{error}</div>
                        {/if}
                        <div class="flex justify-between">
                            <button
                                class="px-3 py-1.5 rounded text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5"
                                onclick={() => (step = "folder")}
                            >
                                <ArrowLeft size={14} /> Back
                            </button>
                            <button
                                class="px-4 py-1.5 rounded bg-primary text-primary-foreground hover:bg-primary/90 inline-flex items-center gap-1.5 text-sm font-medium"
                                onclick={finish}
                            >
                                Create project <ArrowRight size={14} />
                            </button>
                        </div>
                    </div>
                {:else if step === "creating"}
                    <div class="text-center py-8 space-y-3">
                        <Loader2 size={20} class="mx-auto animate-spin text-gruvbox-yellow" />
                        <div class="text-sm text-muted-foreground">Creating project & starting session…</div>
                    </div>
                {:else if step === "done"}
                    <div class="text-center space-y-4">
                        <div
                            class="mx-auto w-12 h-12 rounded-full bg-gruvbox-green/10 flex items-center justify-center"
                        >
                            <Check size={24} class="text-gruvbox-green" />
                        </div>
                        <div>
                            <h2 class="text-lg font-semibold">All set</h2>
                            <p class="text-sm text-muted-foreground mt-1">
                                Your session is starting in the terminal pane.
                            </p>
                        </div>
                            <button
                                class="px-4 py-2 rounded bg-primary text-primary-foreground hover:bg-primary/90 inline-flex items-center gap-2 text-sm font-medium"
                                onclick={close}
                            >
                                <Terminal size={14} /> Open terminal
                            </button>
                    </div>
                {/if}
            </div>
        </div>
    </div>
{/if}
