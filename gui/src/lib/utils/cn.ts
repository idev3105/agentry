import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
	return twMerge(clsx(inputs));
}

// shadcn-svelte element-ref / child helper types (used by lib/components/ui/*).
export type WithElementRef<T, U extends HTMLElement = HTMLElement> = T & {
	ref?: U | null;
};

export type WithoutChild<T> = T extends { child?: any } ? Omit<T, 'child'> : T;
export type WithoutChildren<T> = T extends { children?: any } ? Omit<T, 'children'> : T;
export type WithoutChildrenOrChild<T> = WithoutChildren<WithoutChild<T>>;

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
