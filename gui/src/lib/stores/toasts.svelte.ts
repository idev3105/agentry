export type ToastKind = 'info' | 'success' | 'error';
export interface Toast {
	id: number;
	kind: ToastKind;
	title: string;
	detail?: string;
}

let nextId = 1;

function createToasts() {
	let list = $state<Toast[]>([]);

	function push(t: Omit<Toast, 'id'>, ttlMs = 4500): number {
		const id = nextId++;
		list.push({ ...t, id });
		setTimeout(() => dismiss(id), ttlMs);
		return id;
	}

	function dismiss(id: number) {
		list = list.filter(t => t.id !== id);
	}

	return {
		get list() { return list; },
		info:    (title: string, detail?: string) => push({ kind: 'info', title, detail }),
		success: (title: string, detail?: string) => push({ kind: 'success', title, detail }),
		error:   (title: string, detail?: string) => push({ kind: 'error', title, detail }, 8000),
		dismiss
	};
}

export const toasts = createToasts();
