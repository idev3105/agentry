<!-- LaunchSheet — quick-launch modal khi user đã có projects + profiles.
     Hiện khi onboardingOpen = true nhưng user đã onboarded.
     Cho phép chọn project, profile, CWD override, initial prompt. -->
<script lang="ts">
    import { ui, closeOnboarding } from "$lib/stores/ui";
    import { projects } from "$lib/stores/projects";
    import { profiles } from "$lib/stores/profiles";
    import { settings } from "$lib/stores/settings";
    import { startSession } from "$lib/ipc";
    import { markPendingFocus } from "$lib/stores/sessions";
    import { toasts } from "$lib/stores/toasts.svelte";
    import { agentMeta } from "$lib/utils/agent";
    import { modKey } from "$lib/utils/cn";
    import { Button } from "$lib/components/ui/button";
    import { Input } from "$lib/components/ui/input";
    import { Textarea } from "$lib/components/ui/textarea";
    import { Label } from "$lib/components/ui/label";
    import * as Dialog from "$lib/components/ui/dialog";
    import * as Select from "$lib/components/ui/select";
    import { open as openDialog } from "@tauri-apps/plugin-dialog";
    import FolderOpen from "@lucide/svelte/icons/folder-open";
    import Play from "@lucide/svelte/icons/play";

    let projectList = $derived(Array.from($projects.values()));
    let profileList = $derived($profiles);

    let selProjectId = $state($ui.activeProjectId ?? "");
    let selProfileId = $state($settings.defaultProfileId ?? "");
    let cwdOverride = $state("");
    let initialPrompt = $state("");
    let launching = $state(false);

    // Selected-label helpers for Select triggers.
    let selProjectLabel = $derived(
        projectList.find((p) => p.id === selProjectId)?.name ??
            "— Select project —",
    );
    let selProfileLabel = $derived.by(() => {
        const p = profileList.find((x) => x.id === selProfileId);
        if (!p) return "— Select profile —";
        return `${p.name} (${agentMeta(p.agent_type).label})`;
    });

    // Keep selProjectId in sync if active project changes while open
    $effect(() => {
        if (!selProjectId && $ui.activeProjectId)
            selProjectId = $ui.activeProjectId;
    });
    $effect(() => {
        if (!selProfileId && $settings.defaultProfileId)
            selProfileId = $settings.defaultProfileId;
        else if (!selProfileId && profileList.length > 0)
            selProfileId = profileList[0].id;
    });

    async function pickCwd() {
        try {
            const result = await openDialog({
                directory: true,
                multiple: false,
                title: "Working directory",
            });
            if (typeof result === "string") cwdOverride = result;
        } catch {}
    }

    async function launch() {
        if (!selProjectId || !selProfileId) return;
        launching = true;
        try {
            const cwd = cwdOverride.trim() || undefined;
            const prompt = initialPrompt.trim() || undefined;
            markPendingFocus();
            await startSession(selProjectId, selProfileId, cwd, prompt);
            closeOnboarding();
        } catch (e) {
            toasts.error("Launch failed", String(e));
        } finally {
            launching = false;
        }
    }

    function onKeydown(e: KeyboardEvent) {
        if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
            e.preventDefault();
            launch();
        }
    }
</script>

<!-- bits-ui Dialog handles overlay, Escape and focus-trap. -->
<Dialog.Root
    open
    onOpenChange={(v) => {
        if (!v) closeOnboarding();
    }}
>
    <Dialog.Content class="w-full max-w-lg" onkeydown={onKeydown}>
        <Dialog.Header>
            <Dialog.Title>New Session</Dialog.Title>
        </Dialog.Header>

        <div class="space-y-4">
            <!-- Project -->
            <div class="block">
                <Label class="mb-1 block text-xs text-muted-foreground"
                    >Project <span class="text-destructive">*</span></Label
                >
                <Select.Root type="single" bind:value={selProjectId}>
                    <Select.Trigger class="w-full"
                        >{selProjectLabel}</Select.Trigger
                    >
                    <Select.Content>
                        {#each projectList as p (p.id)}
                            <Select.Item value={p.id}
                                >{p.name}
                                <span class="text-muted-foreground font-mono"
                                    >{p.path}</span
                                ></Select.Item
                            >
                        {/each}
                    </Select.Content>
                </Select.Root>
                {#if projectList.length === 0}
                    <p class="text-xs text-muted-foreground mt-1">
                        No projects yet — create one in Projects view.
                    </p>
                {/if}
            </div>

            <!-- Profile -->
            <div class="block">
                <Label class="mb-1 block text-xs text-muted-foreground"
                    >Profile <span class="text-destructive">*</span></Label
                >
                <Select.Root type="single" bind:value={selProfileId}>
                    <Select.Trigger class="w-full"
                        >{selProfileLabel}</Select.Trigger
                    >
                    <Select.Content>
                        {#each profileList as p (p.id)}
                            {@const m = agentMeta(p.agent_type)}
                            <Select.Item value={p.id}
                                >{p.name} ({m.label})</Select.Item
                            >
                        {/each}
                    </Select.Content>
                </Select.Root>
            </div>

            <!-- CWD override -->
            <div class="block">
                <Label class="mb-1 block text-xs text-muted-foreground"
                    >Working directory <span class="text-muted-foreground/60"
                        >(optional — defaults to project path)</span
                    ></Label
                >
                <div class="flex items-stretch gap-1">
                    <Input
                        type="text"
                        bind:value={cwdOverride}
                        placeholder="Leave blank to use project path"
                        class="flex-1 text-xs font-mono"
                    />
                    <Button
                        variant="outline"
                        size="icon-sm"
                        onclick={pickCwd}
                        title="Browse"
                        aria-label="Browse"><FolderOpen size={13} /></Button
                    >
                </div>
            </div>

            <!-- Initial prompt -->
            <div class="block">
                <Label class="mb-1 block text-xs text-muted-foreground"
                    >Initial prompt <span class="text-muted-foreground/60"
                        >(optional)</span
                    ></Label
                >
                <Textarea
                    bind:value={initialPrompt}
                    rows={3}
                    placeholder="An optional first message for the agent. Leave blank to start an interactive session."
                    class="w-full text-xs resize-none"
                ></Textarea>
            </div>
        </div>

        <Dialog.Footer class="items-center justify-between sm:justify-between">
            <span class="text-[11px] text-muted-foreground font-mono"
                >{modKey}↩ to start</span
            >
            <Button
                disabled={!selProjectId || !selProfileId || launching}
                onclick={launch}
            >
                {#if launching}
                    Starting…
                {:else}
                    <Play size={13} /> Start Session
                {/if}
            </Button>
        </Dialog.Footer>
    </Dialog.Content>
</Dialog.Root>
