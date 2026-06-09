<script lang="ts">
  let { ctl, onClose }: { ctl: {findNext:(q:string)=>void; findPrev:(q:string)=>void} | null; onClose:()=>void } = $props();
  let q = $state('');
  let el: HTMLInputElement | null = $state(null);
  $effect(() => { el?.focus(); });
</script>

<div class="flex items-center gap-2 px-2 py-1 border-b border-border bg-card">
  <input bind:this={el} bind:value={q}
         placeholder="Find in terminal…"
         class="flex-1 bg-input rounded px-2 py-0.5 text-xs border border-border focus:outline-none focus:border-gruvbox-yellow"
         onkeydown={(e) => {
           if (e.key === 'Enter') { e.shiftKey ? ctl?.findPrev(q) : ctl?.findNext(q); }
           else if (e.key === 'Escape') onClose();
         }} />
  <button class="text-xs px-2 py-0.5 rounded hover:bg-secondary" onclick={() => ctl?.findPrev(q)}>↑</button>
  <button class="text-xs px-2 py-0.5 rounded hover:bg-secondary" onclick={() => ctl?.findNext(q)}>↓</button>
  <button class="text-xs px-2 py-0.5 rounded hover:bg-secondary" onclick={onClose}>Esc</button>
</div>
