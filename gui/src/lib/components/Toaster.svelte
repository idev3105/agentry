<script lang="ts">
    import { toasts } from "$lib/stores/toasts.svelte";
    import { cn } from "$lib/utils/cn";
    import { Button } from "$lib/components/ui/button";
    import { fly } from "svelte/transition";
    import X from "@lucide/svelte/icons/x";
    import CheckCircle from "@lucide/svelte/icons/check-circle-2";
    import XCircle from "@lucide/svelte/icons/x-circle";
    import Info from "@lucide/svelte/icons/info";
</script>

<div
    class="fixed bottom-4 left-1/2 -translate-x-1/2 z-[60] flex flex-col items-center gap-2 max-w-sm pointer-events-none"
>
    {#each toasts.list as t (t.id)}
        <div
            class={cn(
                "pointer-events-auto bg-card border rounded shadow-lg px-3 py-2 text-sm flex items-start gap-2",
                t.kind === "error"
                    ? "border-accent-error"
                    : t.kind === "success"
                      ? "border-accent-ok"
                      : "border-border",
            )}
            transition:fly={{ y: 20, duration: 150 }}
        >
            {#if t.kind === "success"}<CheckCircle
                    size={14}
                    class="text-accent-ok flex-shrink-0 mt-0.5"
                />
            {:else if t.kind === "error"}<XCircle
                    size={14}
                    class="text-accent-error flex-shrink-0 mt-0.5"
                />
            {:else}<Info
                    size={14}
                    class="text-muted-foreground flex-shrink-0 mt-0.5"
                />{/if}
            <div class="flex-1 min-w-0">
                <div class="text-sm">{t.title}</div>
                {#if t.detail}<div
                        class="text-[11px] text-muted-foreground break-words"
                    >
                        {t.detail}
                    </div>{/if}
            </div>
            <Button
                variant="ghost"
                size="icon-xs"
                class="text-muted-foreground hover:text-foreground"
                onclick={() => toasts.dismiss(t.id)}
                aria-label="Dismiss"
            >
                <X size={12} />
            </Button>
        </div>
    {/each}
</div>
