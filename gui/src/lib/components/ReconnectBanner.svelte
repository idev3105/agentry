<script lang="ts">
  let { visible }: { visible: boolean } = $props();
  import RefreshCw from '@lucide/svelte/icons/refresh-cw';
</script>

{#if visible}
  <div class="absolute top-0 left-0 right-0 z-40 bg-gruvbox-red text-background text-xs px-3 py-1.5 flex items-center justify-center gap-2">
    <RefreshCw size={11} class="animate-spin" />
    Daemon disconnected — reconnecting…
  </div>
{/if}
