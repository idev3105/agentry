<script lang="ts">
	// Two-column resizable splitter.
	// Stores the user's chosen split as a *ratio* (0..1) of the left pane's
	// width over the container width, so the layout scales naturally when
	// the window resizes.

	import { onMount } from 'svelte';

	interface Props {
		id: string;                    // localStorage key
		defaultLeft: number;           // initial left width in px (clamped to minLeft..container-minRight)
		minLeft?: number;
		maxLeft?: number;
		minRight?: number;             // reserved space for the right pane
		minLeftRatio?: number;         // ratio mode: left must be >= minLeftRatio of container (e.g. 0.7)
		maxRightWindowRatio?: number;  // ratio mode: right must be <= this fraction of window width (e.g. 0.3)
		mode?: 'fixed' | 'ratio';      // 'fixed' keeps pixel width; 'ratio' scales with container
		left: import('svelte').Snippet;
		right: import('svelte').Snippet;
	}

	const {
		id,
		defaultLeft,
		minLeft = 120,
		maxLeft = 5000,
		minRight = 200,
		minLeftRatio,
		maxRightWindowRatio,
		mode = 'fixed',
		left,
		right
	}: Props = $props();

	let width = $state(0);
	let measured = $state(false);
	let dragging = $state(false);
	let containerEl: HTMLDivElement;
	// Last user-chosen ratio (left / container). Used to scale on resize when mode='ratio'.
	let userRatio: number | null = null;
	// Last user-chosen pixel width. Used in mode='fixed'.
	let userPx: number | null = null;

	onMount(() => {
		const saved = localStorage.getItem(`split:${id}`);
		const containerW = containerEl.clientWidth || 0;

		if (saved) {
			const parsed = parseFloat(saved);
			if (Number.isFinite(parsed)) {
				if (mode === 'ratio' && parsed > 0 && parsed < 1) {
					userRatio = parsed;
				} else if (mode === 'fixed' && parsed >= minLeft && parsed <= maxLeft) {
					userPx = parsed;
				}
			}
		}

		// In ratio mode, always have a ratio set — even before the user drags —
		// so subsequent container resizes scale both panes proportionally.
		if (mode === 'ratio' && userRatio === null && containerW > 0) {
			const initial = Math.min(defaultLeft, Math.max(minLeft, containerW - minRight));
			userRatio = initial / containerW;
		}

		width = clamp(initialWidth(containerW));
		measured = true;

		// Re-clamp / re-scale whenever this pane's container resizes.
		const ro = new ResizeObserver(() => {
			if (dragging) return;
			const w = containerEl.clientWidth;
			if (w === 0) return;
			if (mode === 'ratio' && userRatio !== null) {
				width = clamp(w * userRatio);
			} else {
				width = clamp(width);
			}
		});
		ro.observe(containerEl);
		return () => ro.disconnect();
	});

	function initialWidth(containerW: number): number {
		if (mode === 'ratio') {
			if (userRatio !== null && containerW > 0) return containerW * userRatio;
			// derive a sensible default ratio from defaultLeft / containerW
			if (containerW > 0) return Math.min(defaultLeft, containerW - minRight);
			return defaultLeft;
		}
		return userPx ?? defaultLeft;
	}

	function clamp(n: number): number {
		const containerW = containerEl?.clientWidth ?? 0;
		if (containerW === 0) return Math.max(minLeft, Math.min(maxLeft, n));

		// Floor on left width: pixel min, plus optional minLeftRatio of container,
		// plus optional cap of right pane to a fraction of the window.
		let lo = minLeft;
		if (minLeftRatio !== undefined) {
			lo = Math.max(lo, containerW * minLeftRatio);
		}
		if (maxRightWindowRatio !== undefined && typeof window !== 'undefined') {
			const maxRightPx = window.innerWidth * maxRightWindowRatio;
			// left = container - right - 4(handle); enforce right <= maxRightPx
			lo = Math.max(lo, containerW - maxRightPx);
		}

		const hardMax = Math.min(maxLeft, Math.max(lo, containerW - minRight));
		return Math.max(lo, Math.min(hardMax, n));
	}

	function onPointerDown(e: PointerEvent) {
		dragging = true;
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
		e.preventDefault();
	}

	function onPointerMove(e: PointerEvent) {
		if (!dragging) return;
		const rect = containerEl.getBoundingClientRect();
		width = clamp(e.clientX - rect.left);
	}

	function onPointerUp(e: PointerEvent) {
		if (!dragging) return;
		dragging = false;
		(e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
		const containerW = containerEl.clientWidth;
		if (mode === 'ratio' && containerW > 0) {
			userRatio = width / containerW;
			localStorage.setItem(`split:${id}`, userRatio.toFixed(4));
		} else {
			userPx = width;
			localStorage.setItem(`split:${id}`, String(Math.round(width)));
		}
	}
</script>

<div bind:this={containerEl} class="flex h-full overflow-hidden flex-1 min-w-0">
	<div
		class="overflow-hidden flex-shrink-0"
		style:width={measured
			? `${width}px`
			: mode === 'ratio'
				? `calc(100% - ${minRight}px)`
				: `${Math.min(defaultLeft, 400)}px`}
	>
		{@render left()}
	</div>

	<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
	<div
		role="separator"
		aria-orientation="vertical"
		tabindex="-1"
		class="w-1 cursor-col-resize bg-border hover:bg-gruvbox-yellow/50 active:bg-gruvbox-yellow flex-shrink-0 transition-colors"
		class:bg-gruvbox-yellow={dragging}
		onpointerdown={onPointerDown}
		onpointermove={onPointerMove}
		onpointerup={onPointerUp}
	></div>

	<div class="overflow-hidden flex-1 min-w-0">
		{@render right()}
	</div>
</div>
