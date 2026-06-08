import { isMac } from './cn';

export interface KeyBinding {
	/** Lowercased key, e.g. "k", "1", "Enter", "Escape", "ArrowDown". */
	key: string;
	mod?: boolean; // ⌘ on mac, Ctrl on others
	shift?: boolean;
	alt?: boolean;
	preventDefault?: boolean;
	handler: (e: KeyboardEvent) => void;
}

/** Returns a cleanup function. */
export function bindKeys(bindings: KeyBinding[]): () => void {
	function onKey(e: KeyboardEvent) {
		const target = e.target as HTMLElement | null;
		// Ignore typing inside inputs/textareas/contenteditables — except Escape, which always fires.
		const inField =
			target &&
			(target.tagName === 'INPUT' ||
				target.tagName === 'TEXTAREA' ||
				target.isContentEditable);
		const allowInField = e.key === 'Escape';

		for (const b of bindings) {
			const modOK = !!b.mod === (isMac ? e.metaKey : e.ctrlKey);
			const shiftOK = !!b.shift === e.shiftKey;
			const altOK = !!b.alt === e.altKey;
			const keyOK = e.key.toLowerCase() === b.key.toLowerCase();
			if (modOK && shiftOK && altOK && keyOK) {
				if (inField && !allowInField && !b.mod) continue;
				if (b.preventDefault !== false) e.preventDefault();
				b.handler(e);
				return;
			}
		}
	}
	window.addEventListener('keydown', onKey);
	return () => window.removeEventListener('keydown', onKey);
}
