<script lang="ts">
  import { sessions, markSessionEnding } from '$lib/stores/sessions';
  import { ui } from '$lib/stores/ui';
  import { killSession, resumeSession } from '$lib/ipc';
  import { toasts } from '$lib/stores/toasts.svelte';
  import { agentMeta } from '$lib/utils/agent';
  import { cn } from '$lib/utils/cn';
  import { Button } from '$lib/components/ui/button';
  import Square from '@lucide/svelte/icons/square';
  import RotateCcw from '@lucide/svelte/icons/rotate-ccw';
  import Copy from '@lucide/svelte/icons/copy';

  let s = $derived($ui.focusedSessionId ? $sessions.get($ui.focusedSessionId) : undefined);
</script>

{#if s}
  {@const m = agentMeta(s.agent)}
  <div class="flex items-center gap-2 h-9 px-3 border-b border-border bg-card text-xs">
    <m.icon size={12} class={m.color} />
    <span class="font-medium truncate flex-1">{s.title}</span>
    <span class={cn('text-[11px]', s.activity === 'awaiting_input' ? 'text-gruvbox-red' : s.activity === 'working' ? 'text-gruvbox-green' : 'text-muted-foreground')}>
      {s.status}{s.activity ? ` · ${s.activity.replace('_',' ')}` : ''}
    </span>
    {#if s.status === 'running' || s.status === 'queued'}
      <Button variant="ghost" size="icon-xs" class="text-gruvbox-red" title="Kill" aria-label="Kill"
              onclick={() => { markSessionEnding(s!.id); killSession(s!.id).catch(e => toasts.error('Kill failed', String(e))); }}>
        <Square size={12} fill="currentColor" />
      </Button>
    {/if}
    {#if (s.status === 'finished' || s.status === 'failed') && (s.agent === 'claude_code' || s.agent_session_id)}
      <Button variant="ghost" size="icon-xs" title="Resume" aria-label="Resume"
              onclick={() => resumeSession(s!.id)}>
        <RotateCcw size={12} />
      </Button>
    {/if}
    <Button variant="ghost" size="icon-xs" title="Copy session ID" aria-label="Copy session ID"
            onclick={() => { navigator.clipboard.writeText(s!.id); toasts.info('Copied session ID'); }}>
      <Copy size={12} />
    </Button>
  </div>
{/if}
