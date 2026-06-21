<script lang="ts">
    import { settings } from "$lib/stores/settings";
    import { profiles } from "$lib/stores/profiles";
    import {
        sendCmd,
        checkIntegrations,
        installIntegration,
        listSystemFonts,
    } from "$lib/ipc";
    import { r9 } from "$lib/stores/r9.svelte";
    import QRCode from "$lib/components/QRCode.svelte";
    import { theme, type Theme } from "$lib/stores/theme.svelte";
    import { zoom, fontFamily, type FontPreset } from "$lib/stores/font.svelte";
    import { remote } from "$lib/stores/remote.svelte";
    import { toasts } from "$lib/stores/toasts.svelte";
    import { onMount } from "svelte";
    import type { IntegrationStatus } from "$lib/types";
    import Wifi from "@lucide/svelte/icons/wifi";
    import Copy from "@lucide/svelte/icons/copy";
    import { cn, fmtChord } from "$lib/utils/cn";
    import { Button } from "$lib/components/ui/button";
    import { Badge } from "$lib/components/ui/badge";
    import { Switch } from "$lib/components/ui/switch";
    import * as Select from "$lib/components/ui/select";
    import Play from "@lucide/svelte/icons/play";
    import Square from "@lucide/svelte/icons/square";
    import ExternalLink from "@lucide/svelte/icons/external-link";
    import Loader2 from "@lucide/svelte/icons/loader-2";
    import Download from "@lucide/svelte/icons/download";
    import Check from "@lucide/svelte/icons/check";
    import RefreshCw from "@lucide/svelte/icons/refresh-cw";
    import Minus from "@lucide/svelte/icons/minus";
    import Plus from "@lucide/svelte/icons/plus";
    import RotateCcw from "@lucide/svelte/icons/rotate-ccw";
    import ChevronDown from "@lucide/svelte/icons/chevron-down";

    const shortcuts: { keys: string[]; desc: string }[] = [
        { keys: ["mod", "k"], desc: "Open command palette" },
        { keys: ["mod", "t"], desc: "New session" },
        { keys: ["mod", "p"], desc: "Switch project" },
        { keys: ["mod", "f"], desc: "Find in terminal" },
        { keys: ["mod", "="], desc: "Zoom in" },
        { keys: ["mod", "-"], desc: "Zoom out" },
        { keys: ["mod", "0"], desc: "Reset zoom" },
        { keys: ["mod", "1"], desc: "Focus session 1" },
        { keys: ["mod", "2"], desc: "Focus session 2" },
        { keys: ["mod", "9"], desc: "Focus last session" },
        { keys: ["mod", "shift", "k"], desc: "Kill focused session" },
        { keys: ["Escape"], desc: "Close dialogs" },
        { keys: ["/"], desc: "Focus session filter" },
    ];

    type SettingsTab = "general" | "appearance" | "integrations" | "shortcuts";
    const TAB_KEY = "agentry:settings-tab";
    let tab = $state<SettingsTab>(
        (localStorage.getItem(TAB_KEY) as SettingsTab) || "general",
    );
    function setTab(t: SettingsTab) {
        tab = t;
        localStorage.setItem(TAB_KEY, t);
    }
    let confirmEnable = $state(false);

    // ── System fonts ─────────────────────────────────────────────────────────
    // Loaded lazily from the host via Tauri. Empty in remote/WS browser mode,
    // where only the built-in presets are offered.
    const FONT_PRESETS: FontPreset[] = ["system", "inter", "geist", "mono"];
    let systemFonts = $state<string[]>([]);
    let fontsLoading = $state(false);
    let fontQuery = $state("");
    let fontsLoaded = false;

    async function loadFonts() {
        if (fontsLoaded || fontsLoading) return;
        fontsLoading = true;
        try {
            systemFonts = await listSystemFonts();
            fontsLoaded = true;
        } finally {
            fontsLoading = false;
        }
    }

    const filteredFonts = $derived(
        fontQuery.trim()
            ? systemFonts.filter((f) =>
                  f.toLowerCase().includes(fontQuery.trim().toLowerCase()),
              )
            : systemFonts,
    );

    // Human label for the trigger: presets are capitalized words, a raw system
    // font shows its family name verbatim.
    const fontLabel = $derived(
        fontFamily.isCustom
            ? fontFamily.value
            : fontFamily.value.charAt(0).toUpperCase() +
                  fontFamily.value.slice(1),
    );

    // Custom dropdown (the shared Select primitive forces a tiny viewport
    // height that breaks a search-header layout, so we roll our own popover).
    let fontOpen = $state(false);
    let fontPickerEl = $state<HTMLElement | null>(null);

    function toggleFontPicker() {
        fontOpen = !fontOpen;
        if (fontOpen) loadFonts();
        else fontQuery = "";
    }

    function pickFont(f: string) {
        fontFamily.set(f);
        fontOpen = false;
        fontQuery = "";
    }

    function onFontPointerDown(e: PointerEvent) {
        if (
            fontOpen &&
            fontPickerEl &&
            !fontPickerEl.contains(e.target as Node)
        ) {
            fontOpen = false;
            fontQuery = "";
        }
    }

    // ── Agent integrations ───────────────────────────────────────────────────
    let integrations = $state<IntegrationStatus[]>([]);
    let integrationsLoading = $state(false);
    let installingAgent = $state<string | null>(null);

    async function loadIntegrations() {
        integrationsLoading = true;
        try {
            integrations = await checkIntegrations();
        } catch (e) {
            toasts.error(`Failed to check integrations: ${e}`);
        } finally {
            integrationsLoading = false;
        }
    }

    async function install(agent: string) {
        installingAgent = agent;
        try {
            const updated = await installIntegration(agent);
            integrations = integrations.map((i) =>
                i.agent === agent ? updated : i,
            );
            toasts.success(`${agent} integration installed`);
        } catch (e) {
            toasts.error(`Install failed: ${e}`);
        } finally {
            installingAgent = null;
        }
    }

    onMount(() => {
        remote.startPolling();
        if (tab === "integrations") loadIntegrations();
        if (tab === "appearance") loadFonts();
        return () => remote.stopPolling();
    });

    $effect(() => {
        if (
            tab === "integrations" &&
            integrations.length === 0 &&
            !integrationsLoading
        ) {
            loadIntegrations();
        }
        if (tab === "appearance") loadFonts();
    });

    async function openExternal(url: string) {
        try {
            const { openUrl } = await import("@tauri-apps/plugin-opener");
            await openUrl(url);
        } catch (e) {
            // fallback: shouldn't happen in Tauri context
            window.open(url, "_blank");
        }
    }

    function copyAddr() {
        if (!remote.status.address) return;
        navigator.clipboard.writeText(`http://${remote.status.address}`);
        toasts.success("Address copied");
    }

    async function setDefaultProfile(id: string) {
        await sendCmd({ cmd: "set_default_profile", profile_id: id });
        settings.update((s) => ({ ...s, defaultProfileId: id }));
    }

    const tabs: { id: SettingsTab; label: string }[] = [
        { id: "general", label: "General" },
        { id: "appearance", label: "Appearance" },
        { id: "integrations", label: "Integrations" },
        { id: "shortcuts", label: "Shortcuts" },
    ];
</script>

<svelte:window onpointerdown={onFontPointerDown} />

<div class="flex flex-col h-full overflow-y-auto">
    <header class="px-6 pt-5 border-b border-border">
        <h1 class="text-base font-semibold">Settings</h1>
        <div class="flex gap-1 mt-3 -mb-px" role="tablist">
            {#each tabs as t (t.id)}
                <button
                    role="tab"
                    aria-selected={tab === t.id}
                    class={cn(
                        "px-3 py-2 text-xs rounded-t border-b-2 transition-colors",
                        tab === t.id
                            ? "border-accent text-foreground font-medium"
                            : "border-transparent text-muted-foreground hover:text-foreground",
                    )}
                    onclick={() => setTab(t.id)}
                >
                    {t.label}
                </button>
            {/each}
        </div>
    </header>

    <div class="p-6 space-y-6 max-w-2xl">
        {#if tab === "general"}
            <section class="bg-card border border-border rounded p-4 space-y-3">
                <h2 class="text-sm font-semibold">Daemon</h2>
                <div class="flex items-center justify-between gap-4">
                    <span class="text-xs text-muted-foreground shrink-0"
                        >Default profile</span
                    >
                    <Select.Root
                        type="single"
                        value={$settings.defaultProfileId ?? ""}
                        onValueChange={(v) => {
                            if (v) setDefaultProfile(v);
                        }}
                    >
                        <Select.Trigger class="max-w-[200px] h-7 text-xs">
                            {$profiles.find(
                                (p) => p.id === $settings.defaultProfileId,
                            )?.name ?? "— none —"}
                        </Select.Trigger>
                        <Select.Content>
                            {#each $profiles as p (p.id)}
                                <Select.Item value={p.id}>{p.name}</Select.Item>
                            {/each}
                        </Select.Content>
                    </Select.Root>
                </div>
                {@render row(
                    "Max concurrent sessions",
                    String($settings.maxConcurrentSessions),
                )}
                {@render row("Idle threshold", `${$settings.idleThresholdS}s`)}
                {@render row(
                    "Awaiting threshold",
                    `${$settings.awaitingThresholdS}s`,
                )}
                {@render row(
                    "Ring buffer",
                    `${($settings.ringBufferBytes / 1024 / 1024 || 0).toFixed(1)} MiB`,
                )}
            </section>
        {:else if tab === "appearance"}
            <section class="bg-card border border-border rounded p-4 space-y-3">
                <h2 class="text-sm font-semibold">Theme</h2>
                <div class="flex gap-2 flex-wrap">
                    {#each ["dark", "light"] as Theme[] as t (t)}
                        <Button
                            variant={theme.value === t ? "default" : "outline"}
                            size="xs"
                            class="capitalize"
                            onclick={() => theme.set(t)}>{t}</Button
                        >
                    {/each}
                </div>
            </section>

            <section class="bg-card border border-border rounded p-4 space-y-3">
                <div class="flex items-center justify-between gap-4">
                    <h2 class="text-sm font-semibold">Font family</h2>
                    <div class="relative w-[220px]" bind:this={fontPickerEl}>
                        <button
                            type="button"
                            onclick={toggleFontPicker}
                            aria-expanded={fontOpen}
                            class="flex w-full h-8 items-center justify-between gap-2 px-3 text-sm bg-background border border-border rounded hover:bg-accent focus:outline-none focus:ring-1 focus:ring-ring"
                            style={`font-family: var(--app-font-family)`}
                        >
                            <span class="truncate">{fontLabel}</span>
                            <ChevronDown
                                class={cn(
                                    "size-4 shrink-0 text-muted-foreground transition-transform",
                                    fontOpen && "rotate-180",
                                )}
                            />
                        </button>

                        {#if fontOpen}
                            <div
                                class="absolute right-0 z-50 mt-1 w-full flex flex-col rounded-md border border-border bg-popover text-popover-foreground shadow-md"
                            >
                                <div
                                    class="shrink-0 p-1 border-b border-border"
                                >
                                    <!-- svelte-ignore a11y_autofocus -->
                                    <input
                                        type="text"
                                        bind:value={fontQuery}
                                        placeholder="Search fonts…"
                                        autofocus
                                        class="w-full h-7 px-2 text-sm bg-background border border-border rounded focus:outline-none focus:ring-1 focus:ring-ring"
                                    />
                                </div>

                                <div
                                    class="max-h-56 overflow-y-auto overscroll-contain p-1"
                                >
                                    {#if !fontQuery.trim()}
                                        <div
                                            class="px-2 pt-1 pb-0.5 text-[11px] font-medium text-muted-foreground"
                                        >
                                            Presets
                                        </div>
                                        {#each FONT_PRESETS as f (f)}
                                            <button
                                                type="button"
                                                onclick={() => pickFont(f)}
                                                class={cn(
                                                    "w-full text-left px-2 py-1.5 text-sm rounded flex items-center justify-between hover:bg-accent capitalize",
                                                    fontFamily.value === f &&
                                                        "bg-accent font-medium",
                                                )}
                                            >
                                                <span>{f}</span>
                                                {#if fontFamily.value === f}
                                                    <Check
                                                        class="size-3.5 shrink-0"
                                                    />
                                                {/if}
                                            </button>
                                        {/each}
                                    {/if}

                                    {#if systemFonts.length > 0}
                                        <div
                                            class="px-2 pt-2 pb-0.5 text-[11px] font-medium text-muted-foreground"
                                        >
                                            System fonts
                                        </div>
                                        {#each filteredFonts as f (f)}
                                            <button
                                                type="button"
                                                onclick={() => pickFont(f)}
                                                style={`font-family: "${f.replace(/"/g, '\\"')}", system-ui, sans-serif`}
                                                class={cn(
                                                    "w-full text-left px-2 py-1.5 text-sm rounded flex items-center justify-between hover:bg-accent",
                                                    fontFamily.value === f &&
                                                        "bg-accent font-medium",
                                                )}
                                            >
                                                <span class="truncate">{f}</span
                                                >
                                                {#if fontFamily.value === f}
                                                    <Check
                                                        class="size-3.5 shrink-0"
                                                    />
                                                {/if}
                                            </button>
                                        {/each}
                                        {#if filteredFonts.length === 0}
                                            <div
                                                class="px-2 py-1.5 text-[11px] text-muted-foreground"
                                            >
                                                No fonts match “{fontQuery}”.
                                            </div>
                                        {/if}
                                    {:else if fontsLoading}
                                        <div
                                            class="px-2 py-1.5 text-[11px] text-muted-foreground"
                                        >
                                            Loading system fonts…
                                        </div>
                                    {/if}
                                </div>
                            </div>
                        {/if}
                    </div>
                </div>

                <p class="text-[11px] text-muted-foreground">
                    Pick a preset or any font installed on your system. An
                    unavailable choice falls back to the system default.
                </p>
            </section>

            <section class="bg-card border border-border rounded p-4 space-y-3">
                <h2 class="text-sm font-semibold">Zoom</h2>
                <div class="flex items-center gap-2">
                    <Button
                        variant="outline"
                        size="icon-sm"
                        disabled={!zoom.canZoomOut}
                        onclick={() => zoom.zoomOut()}
                        title="Zoom out ({fmtChord(['mod', '-'])})"
                        aria-label="Zoom out"
                    >
                        <Minus class="size-4" />
                    </Button>
                    <span
                        class="min-w-[3.5rem] text-center text-sm tabular-nums font-medium"
                        >{zoom.percent}%</span
                    >
                    <Button
                        variant="outline"
                        size="icon-sm"
                        disabled={!zoom.canZoomIn}
                        onclick={() => zoom.zoomIn()}
                        title="Zoom in ({fmtChord(['mod', '='])})"
                        aria-label="Zoom in"
                    >
                        <Plus class="size-4" />
                    </Button>
                    <Button
                        variant="ghost"
                        size="sm"
                        disabled={zoom.isDefault}
                        onclick={() => zoom.reset()}
                        title="Reset zoom ({fmtChord(['mod', '0'])})"
                        class="ml-1"
                    >
                        <RotateCcw class="size-3.5" />
                        Reset
                    </Button>
                </div>
                <p class="text-[11px] text-muted-foreground">
                    Scales the whole interface. Use {fmtChord(["mod", "="])} / {fmtChord(
                        ["mod", "-"],
                    )} to zoom in/out and {fmtChord(["mod", "0"])} to reset — works
                    anywhere in the app.
                </p>
            </section>
        {:else if tab === "integrations"}
            <section class="bg-card border border-border rounded p-4 space-y-3">
                <div class="flex items-center justify-between">
                    <div>
                        <h2 class="text-sm font-semibold">Agent State Hooks</h2>
                        <p class="text-xs text-muted-foreground mt-0.5">
                            Install hooks so agents report their session id and
                            live state (working / idle / blocked) directly —
                            more reliable than screen scraping.
                        </p>
                    </div>
                    <Button
                        variant="outline"
                        size="xs"
                        disabled={integrationsLoading}
                        onclick={loadIntegrations}
                        title="Re-check"
                    >
                        <RefreshCw
                            class={cn(
                                "size-3",
                                integrationsLoading && "animate-spin",
                            )}
                        />
                        Check
                    </Button>
                </div>

                {#if integrationsLoading && integrations.length === 0}
                    <p class="text-xs text-muted-foreground">Checking…</p>
                {:else}
                    <div class="space-y-2">
                        {#each integrations as it (it.agent)}
                            <div
                                class="flex items-start justify-between gap-3 border border-border rounded px-3 py-2"
                            >
                                <div class="min-w-0">
                                    <div class="flex items-center gap-2">
                                        <span
                                            class="text-sm font-medium capitalize"
                                            >{it.agent}</span
                                        >
                                        {@render integrationBadge(it)}
                                        {#if !it.agent_detected}
                                            <Badge
                                                variant="secondary"
                                                class="text-muted-foreground"
                                            >
                                                CLI not found
                                            </Badge>
                                        {/if}
                                        {#if it.hooks_wired === false}
                                            <Badge
                                                variant="secondary"
                                                class="text-yellow-600 dark:text-yellow-400"
                                            >
                                                hooks not wired
                                            </Badge>
                                        {:else if it.hooks_wired === true}
                                            <Badge
                                                variant="secondary"
                                                class="text-emerald-600 dark:text-emerald-400"
                                            >
                                                hooks wired
                                            </Badge>
                                        {/if}
                                    </div>
                                    <p
                                        class="text-[11px] text-muted-foreground font-mono mt-0.5 truncate"
                                    >
                                        {it.install_path}
                                    </p>
                                    {#if it.manual_step}
                                        <p
                                            class="text-[11px] text-yellow-600 dark:text-yellow-400 mt-1"
                                        >
                                            ⚠ {it.manual_step}
                                        </p>
                                    {/if}
                                </div>
                                <div class="shrink-0">
                                    {#if it.installed && !it.needs_update}
                                        <Button
                                            variant="outline"
                                            size="xs"
                                            disabled={installingAgent ===
                                                it.agent}
                                            onclick={() => install(it.agent)}
                                            title="Reinstall / overwrite"
                                        >
                                            {#if installingAgent === it.agent}
                                                <Loader2
                                                    class="size-3 animate-spin"
                                                />
                                            {:else}
                                                <Check
                                                    class="size-3 text-emerald-500"
                                                />
                                            {/if}
                                            Reinstall
                                        </Button>
                                    {:else}
                                        <Button
                                            variant="outline"
                                            size="xs"
                                            class="border-accent bg-accent/10 hover:bg-accent/20"
                                            disabled={installingAgent ===
                                                it.agent}
                                            onclick={() => install(it.agent)}
                                        >
                                            {#if installingAgent === it.agent}
                                                <Loader2
                                                    class="size-3 animate-spin"
                                                />
                                            {:else}
                                                <Download class="size-3" />
                                            {/if}
                                            {it.needs_update
                                                ? "Update"
                                                : "Install"}
                                        </Button>
                                    {/if}
                                </div>
                            </div>
                        {/each}
                    </div>
                {/if}
            </section>

            <section class="bg-card border border-border rounded p-4 space-y-3">
                <div class="flex items-center justify-between">
                    <div>
                        <h2 class="text-sm font-semibold">9Router</h2>
                        <p class="text-xs text-muted-foreground mt-0.5">
                            FREE AI router. Connect agents to free Claude / GPT
                            / Gemini.
                        </p>
                    </div>
                    {@render r9Badge()}
                </div>

                {#if r9.status.resolved === "missing"}
                    <div
                        class="text-xs bg-yellow-500/10 border border-yellow-500/30 rounded px-3 py-2"
                    >
                        9Router not installed. Run
                        <code class="px-1 rounded bg-muted"
                            >npm i -g 9router</code
                        >
                        then restart Agentry.
                    </div>
                {:else}
                    <div class="flex items-center gap-2">
                        {#if r9.status.running}
                            <Button
                                variant="outline"
                                size="sm"
                                disabled={r9.busy}
                                onclick={() => r9.stop()}
                            >
                                {#if r9.busy}
                                    <Loader2 class="size-3 animate-spin" />
                                {:else}
                                    <Square class="size-3" />
                                {/if}
                                Stop
                            </Button>
                            <Button
                                variant="outline"
                                size="sm"
                                onclick={() => r9.openDashboard()}
                            >
                                <ExternalLink class="size-3" />
                                Open dashboard
                            </Button>
                        {:else}
                            <Button
                                variant="outline"
                                size="sm"
                                disabled={r9.busy}
                                onclick={() => r9.start()}
                            >
                                {#if r9.busy}
                                    <Loader2 class="size-3 animate-spin" />
                                {:else}
                                    <Play class="size-3" />
                                {/if}
                                Start
                            </Button>
                        {/if}
                        <span class="text-xs text-muted-foreground ml-auto">
                            via {r9.status.resolved}
                            {#if r9.status.pid}· pid {r9.status.pid}{/if}
                            · :{r9.status.port}
                        </span>
                    </div>
                {/if}

                {#if r9.lastError}
                    <div
                        class="text-xs bg-destructive/10 border border-destructive/30 rounded px-3 py-2 font-mono"
                    >
                        {r9.lastError}
                    </div>
                {/if}
            </section>

            <section class="bg-card border border-border rounded p-4 space-y-3">
                <div class="flex items-center justify-between">
                    <div>
                        <h2 class="text-sm font-semibold">Remote Access</h2>
                        <p class="text-xs text-muted-foreground mt-0.5">
                            Control agents from your phone over Tailscale.
                            Devices on your tailnet are trusted — no pairing
                            needed.
                        </p>
                    </div>
                    <div class="flex items-center gap-2">
                        {#if remote.status.listening}
                            <Badge
                                class="bg-emerald-500/10 text-emerald-500 border-emerald-500/30 text-xs"
                                >on</Badge
                            >
                        {/if}
                        <Switch
                            checked={remote.status.enabled}
                            disabled={remote.busy}
                            onCheckedChange={(v) => remote.setEnabled(v)}
                        />
                    </div>
                </div>

                {#if !remote.status.enabled}
                    <p class="text-xs text-muted-foreground">
                        Remote access is disabled. Toggle the switch above to
                        enable it.
                    </p>
                {:else if remote.status.error}
                    <div
                        class="text-xs bg-yellow-500/10 border border-yellow-500/30 rounded px-3 py-2 space-y-1.5"
                    >
                        {#if remote.status.error === "tailscale interface not found"}
                            <p>Tailscale is not running on this machine.</p>
                            <p>
                                <button
                                    onclick={() =>
                                        openExternal(
                                            "https://tailscale.com/download",
                                        )}
                                    class="underline underline-offset-2 text-foreground hover:text-primary cursor-pointer"
                                    >Download Tailscale</button
                                > → install → sign in → then restart Agentry.
                            </p>
                        {:else}
                            {remote.status.error}
                        {/if}
                    </div>
                {:else if remote.status.listening && remote.status.address}
                    <div class="flex items-start gap-4">
                        <QRCode
                            value="http://{remote.status.address}"
                            size={120}
                        />
                        <div class="flex flex-col gap-2 min-w-0">
                            <div class="flex items-center gap-2">
                                <code
                                    class="text-xs px-2 py-1 rounded bg-muted font-mono truncate"
                                    >http://{remote.status.address}</code
                                >
                                <Button
                                    variant="ghost"
                                    size="icon-xs"
                                    title="Copy address"
                                    aria-label="Copy address"
                                    onclick={copyAddr}
                                >
                                    <Copy class="size-3.5" />
                                </Button>
                            </div>
                            <p class="text-xs text-muted-foreground">
                                Scan with your phone or open this address in any
                                browser on your tailnet.
                            </p>
                        </div>
                    </div>
                {:else}
                    <div class="text-xs text-muted-foreground space-y-1">
                        <p>
                            Tailscale is not detected. To enable Remote Access:
                        </p>
                        <ol class="list-decimal list-inside space-y-0.5 pl-1">
                            <li>
                                <button
                                    onclick={() =>
                                        openExternal(
                                            "https://tailscale.com/download",
                                        )}
                                    class="underline underline-offset-2 hover:text-foreground cursor-pointer"
                                    >Download & install Tailscale</button
                                >
                            </li>
                            <li>Sign in with your Tailscale account</li>
                            <li>
                                Restart Agentry — it will auto-detect and start
                                listening
                            </li>
                        </ol>
                    </div>
                {/if}

                {#if remote.lastError}
                    <div
                        class="text-xs bg-destructive/10 border border-destructive/30 rounded px-3 py-2 font-mono"
                    >
                        {remote.lastError}
                    </div>
                {/if}
            </section>
        {:else if tab === "shortcuts"}
            <section class="bg-card border border-border rounded p-4 space-y-3">
                <h2 class="text-sm font-semibold">Keyboard shortcuts</h2>
                <div class="space-y-1">
                    {#each shortcuts as sc (sc.desc)}
                        <div
                            class="flex items-center justify-between text-sm py-1"
                        >
                            <span class="text-muted-foreground">{sc.desc}</span>
                            <kbd
                                class="px-1.5 py-0.5 rounded bg-background border border-border text-foreground text-xs font-mono"
                            >
                                {fmtChord(sc.keys)}
                            </kbd>
                        </div>
                    {/each}
                </div>
            </section>
        {/if}
    </div>
</div>

{#snippet row(label: string, value: string)}
    <div class="flex items-center justify-between text-sm">
        <span class="text-muted-foreground">{label}</span>
        <span class="font-mono">{value}</span>
    </div>
{/snippet}

{#snippet integrationBadge(it: IntegrationStatus)}
    {#if it.installed && !it.needs_update}
        <Badge
            class="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30"
        >
            installed{#if it.installed_version}&nbsp;v{it.installed_version}{/if}
        </Badge>
    {:else if it.needs_update}
        <Badge
            class="bg-yellow-500/10 text-yellow-600 dark:text-yellow-400 border-yellow-500/30"
        >
            update available
        </Badge>
    {:else}
        <Badge variant="secondary" class="text-muted-foreground">
            not installed
        </Badge>
    {/if}
{/snippet}

{#snippet r9Badge()}
    {#if r9.status.running}
        <Badge
            class="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30"
        >
            running
        </Badge>
    {:else if r9.status.resolved === "missing"}
        <Badge variant="secondary" class="text-muted-foreground">
            not installed
        </Badge>
    {:else}
        <Badge variant="secondary" class="text-muted-foreground">stopped</Badge>
    {/if}
{/snippet}
