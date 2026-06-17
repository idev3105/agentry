<script lang="ts">
	import { onMount } from 'svelte';
	import { fmtChord } from '$lib/utils/cn';
	import { Button } from '$lib/components/ui/button';
	import X from '@lucide/svelte/icons/x';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';

	const steps = [
		{ id: 'activity', title: 'Activity Bar', text: 'Switch between Sessions, Projects, Profiles, 9Router, and Settings.', pos: 'right' },
		{ id: 'sidebar', title: 'Session Sidebar', text: `Your sessions live here. Click to focus, ${fmtChord(['mod', '1'])}–${fmtChord(['mod', '9'])} for quick switch, ▾ for profile picker.`, pos: 'right' },
		{ id: 'terminal', title: 'Terminal Pane', text: `This is where your agent runs. Use the tab strip above to switch sessions, ${fmtChord(['mod', 'f'])} to find.`, pos: 'left' },
		{ id: 'inspector', title: 'Inspector', text: 'Session details, rename (F2), duplicate, kill, resume, and copy paths or IDs.', pos: 'left' },
		{ id: 'palette', title: 'Command Palette', text: `Press ${fmtChord(['mod', 'k'])} anywhere to search sessions, run commands, and navigate.`, pos: 'left' },
	];

	let currentStep = $state(0);
	let open = $state(false);

	function showCard() {
		return currentStep < steps.length;
	}

	function cardStyle(): string {
		const el = document.querySelector(`[data-tour="${steps[currentStep]?.id}"]`) as HTMLElement | null;
		if (!el) return 'top: 50%; left: 50%; transform: translate(-50%, -50%);';
		const rect = el.getBoundingClientRect();
		const pos = steps[currentStep].pos;
		if (pos === 'right') {
			return `top: ${rect.top + rect.height / 2}px; left: ${rect.right + 12}px; transform: translateY(-50%);`;
		} else {
			return `top: ${rect.top + rect.height / 2}px; right: ${window.innerWidth - rect.left + 12}px; transform: translateY(-50%);`;
		}
	}

	function start() {
		open = true;
		currentStep = 0;
	}

	function next() {
		if (currentStep < steps.length - 1) currentStep++;
		else finish();
	}

	function prev() {
		if (currentStep > 0) currentStep--;
	}

	function finish() {
		open = false;
		localStorage.setItem('agentry:onboarded', '1');
	}

	function skip() {
		finish();
	}

	onMount(() => {
		window.addEventListener('tour:start', start);
		return () => window.removeEventListener('tour:start', start);
	});
</script>

{#if open && showCard()}
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="fixed inset-0 z-50 bg-black/60" onclick={skip}></div>

	<div
		class="fixed z-50 w-80 rounded-lg border border-border bg-card shadow-2xl p-4 pointer-events-auto"
	style={cardStyle()}>
		<div class="flex items-start justify-between gap-2 mb-2">
			<h3 class="text-sm font-semibold">{steps[currentStep].title}</h3>
			<Button variant="ghost" size="icon-xs" class="text-muted-foreground hover:text-foreground" aria-label="Close tour" onclick={skip}><X size={14} /></Button>
		</div>
		<p class="text-xs text-muted-foreground mb-4">{steps[currentStep].text}</p>
		<div class="flex items-center justify-between">
			<span class="text-[10px] text-muted-foreground">{currentStep + 1} / {steps.length}</span>
			<div class="flex gap-2">
				{#if currentStep > 0}
					<Button variant="outline" size="xs" onclick={prev}>
						Back
					</Button>
				{/if}
				<Button size="xs" onclick={next}>
					{currentStep === steps.length - 1 ? 'Got it' : 'Next'}
					{#if currentStep < steps.length - 1}<ChevronRight size={12} />{/if}
				</Button>
			</div>
		</div>
	</div>
{/if}
