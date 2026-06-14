/**
 * Platform detection — desktop (Tauri Unix socket) vs mobile (WS).
 * On Android the Tauri `__TAURI_INTERNALS__` object exists but
 * `window.__TAURI_MOBILE__` is set by the Android/iOS shell.
 */
export const isMobile: boolean =
	typeof window !== 'undefined' &&
	// Tauri v2 sets this on mobile targets
	((window as unknown as Record<string, unknown>).__TAURI_MOBILE__ === true ||
		// fallback: user-agent heuristic (useful during browser dev)
		/android|iphone|ipad/i.test(navigator.userAgent));

export const isDesktop = !isMobile;
