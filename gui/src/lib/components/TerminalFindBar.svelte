<script lang="ts">
  import { Input } from '$lib/components/ui/input';
  import { Button } from '$lib/components/ui/button';
  let { ctl, onClose }: { ctl: {findNext:(q:string)=>void; findPrev:(q:string)=>void} | null; onClose:()=>void } = $props();
  let q = $state('');
  let el: HTMLInputElement | null = $state(null);
  $effect(() => { el?.focus(); });
</script>

<div class="flex items-center gap-2 px-2 py-1 border-b border-border bg-card">
  <Input bind:ref={el} bind:value={q}
         placeholder="Find in terminal…"
         class="flex-1 h-7 text-xs"
         onkeydown={(e: KeyboardEvent) => {
           if (e.key === 'Enter') { e.shiftKey ? ctl?.findPrev(q) : ctl?.findNext(q); }
           else if (e.key === 'Escape') onClose();
         }} />
  <Button variant="ghost" size="xs" onclick={() => ctl?.findPrev(q)}>↑</Button>
  <Button variant="ghost" size="xs" onclick={() => ctl?.findNext(q)}>↓</Button>
  <Button variant="ghost" size="xs" onclick={onClose}>Esc</Button>
</div>
