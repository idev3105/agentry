import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
	return twMerge(clsx(inputs));
}

// Detect macOS for ⌘ vs Ctrl prompt.
export const isMac =
	typeof navigator !== 'undefined' && /Mac|iPhone|iPod|iPad/.test(navigator.platform);

export const modKey = isMac ? '⌘' : 'Ctrl';

/** Format key chord like ['mod','k'] → "⌘K" or "Ctrl+K". */
export function fmtChord(parts: string[]): string {
	return parts
		.map((p) => {
			if (p === 'mod') return modKey;
			if (p === 'shift') return isMac ? '⇧' : 'Shift';
			if (p === 'alt') return isMac ? '⌥' : 'Alt';
			return p.length === 1 ? p.toUpperCase() : p;
		})
		.join(isMac ? '' : '+');
}
