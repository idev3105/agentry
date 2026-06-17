<script lang="ts">
  import { sessions, markSessionEnding } from '$lib/stores/sessions';
  import { ui } from '$lib/stores/ui';
  import { focusSession, killSession } from '$lib/ipc';
  import { agentMeta } from '$lib/utils/agent';
  import { cn } from '$lib/utils/cn';
  import { Button } from '$lib/components/ui/button';
  import X from '@lucide/svelte/icons/x';

  let tabs = $derived(
    Array.from($sessions.values())
      .filter(s => s.projectId === $ui.activeProjectId && s.status !== 'finished' && s.status !== 'failed')
      .sort((a, b) => a.title.localeCompare(b.title))
  );

  function switchTo(id: string) {
    ui.update(u => ({ ...u, focusedSessionId: id, view: 'terminal' }));
    focusSession(id).catch(() => {});
  }

  function closeTab(e: MouseEvent, id: string) {
    e.stopPropagation();
    markSessionEnding(id);
    killSession(id).catch(err => markSessionEnding(id, { failReason: `kill failed: ${err}` }));
  }
</script>

{#if tabs.length > 0}
  <div class="flex items-stretch h-8 border-b border-border bg-card overflow-x-auto">
    {#each tabs as s (s.id)}
      {@const m = agentMeta(s.agent)}
      {@const active = $ui.focusedSessionId === s.id}
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div role="tab" tabindex="0"
           class={cn(
             'inline-flex items-center gap-1.5 px-3 text-xs cursor-pointer border-r border-border min-w-0 group',
             active ? 'bg-background text-foreground' : 'text-muted-foreground hover:bg-secondary/40'
           )}
           onclick={() => switchTo(s.id)}
           onauxclick={(e) => e.button === 1 && closeTab(e, s.id)}>
        <m.icon size={11} class={cn(m.color, 'flex-shrink-0')} />
        <span class="truncate max-w-[140px]">{s.title}</span>
        {#if s.unread > 0 && !active}
          <span class="text-[9px] px-1 rounded bg-accent text-background font-mono">{s.unread}</span>
        {/if}
        <Button variant="ghost" size="icon-xs"
                class="ml-1 size-4 opacity-0 group-hover:opacity-100 hover:bg-secondary"
                onclick={(e) => closeTab(e, s.id)}
                aria-label="Close session">
          <X size={10} />
        </Button>
      </div>
    {/each}
  </div>
{/if}
