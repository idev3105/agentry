const ZOOM_KEY = 'agentry:zoom';
const FAMILY_KEY = 'agentry:font-family';

export type FontFamily = 'system' | 'inter' | 'geist' | 'mono';

// Font-family presets map to a CSS font stack. No bundled fonts — these
// reference fonts the OS is likely to have, with generic fallbacks so an
// unavailable face degrades gracefully (fail-open).
export const FONT_STACKS: Record<FontFamily, string> = {
	system: 'system-ui, -apple-system, sans-serif',
	inter: '"Inter", "Inter var", system-ui, sans-serif',
	geist: '"Geist", "Geist Sans", system-ui, sans-serif',
	mono: 'ui-monospace, "SF Mono", "Cascadia Code", "JetBrains Mono", Menlo, Consolas, monospace'
};

const VALID_FAMILIES: FontFamily[] = ['system', 'inter', 'geist', 'mono'];

// Continuous zoom controls overall UI scale via CSS `zoom` on <html>.
// Bounds keep the layout usable; step matches a comfortable keyboard increment.
const ZOOM_MIN = 0.7;
const ZOOM_MAX = 1.6;
const ZOOM_STEP = 0.1;
const ZOOM_DEFAULT = 1;

function clampZoom(z: number): number {
	if (!Number.isFinite(z)) return ZOOM_DEFAULT;
	// Round to 2 decimals to avoid float drift (e.g. 1.0000000002).
	const rounded = Math.round(z * 100) / 100;
	return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, rounded));
}

function createZoom() {
	const saved = typeof localStorage !== 'undefined' ? localStorage.getItem(ZOOM_KEY) : null;
	const initial = clampZoom(saved !== null ? parseFloat(saved) : ZOOM_DEFAULT);
	let cur = $state<number>(initial);

	// Apply on boot so the persisted choice takes effect before user interaction.
	if (typeof document !== 'undefined') {
		document.documentElement.style.setProperty('--app-zoom', String(initial));
	}

	function apply(z: number) {
		cur = z;
		if (typeof document !== 'undefined') {
			document.documentElement.style.setProperty('--app-zoom', String(z));
		}
		if (typeof localStorage !== 'undefined') localStorage.setItem(ZOOM_KEY, String(z));
	}

	return {
		get value() {
			return cur;
		},
		/** Current zoom as a percentage integer for display (e.g. 110). */
		get percent() {
			return Math.round(cur * 100);
		},
		get canZoomIn() {
			return cur < ZOOM_MAX;
		},
		get canZoomOut() {
			return cur > ZOOM_MIN;
		},
		get isDefault() {
			return cur === ZOOM_DEFAULT;
		},
		set(z: number) {
			apply(clampZoom(z));
		},
		zoomIn() {
			apply(clampZoom(cur + ZOOM_STEP));
		},
		zoomOut() {
			apply(clampZoom(cur - ZOOM_STEP));
		},
		reset() {
			apply(ZOOM_DEFAULT);
		}
	};
}

function createFontFamily() {
	const saved = typeof localStorage !== 'undefined' ? localStorage.getItem(FAMILY_KEY) : null;
	const initial: FontFamily = VALID_FAMILIES.includes(saved as FontFamily)
		? (saved as FontFamily)
		: 'system';
	let cur = $state<FontFamily>(initial);

	if (typeof document !== 'undefined') {
		document.documentElement.style.setProperty('--app-font-family', FONT_STACKS[initial]);
	}

	return {
		get value() {
			return cur;
		},
		set(f: FontFamily) {
			cur = f;
			if (typeof document !== 'undefined') {
				document.documentElement.style.setProperty('--app-font-family', FONT_STACKS[f]);
			}
			if (typeof localStorage !== 'undefined') localStorage.setItem(FAMILY_KEY, f);
		}
	};
}

export const zoom = createZoom();
export const fontFamily = createFontFamily();
