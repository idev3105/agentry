import type { DirEntry } from "$lib/types";
import { listDir } from "$lib/ipc";

// Sidebar mode: 'sessions' (default) or 'explorer'.
type SidebarMode = "sessions" | "explorer";

class ExplorerStore {
	mode = $state<SidebarMode>("sessions");
	/** Absolute root of the current tree (session cwd or project path). */
	root = $state<string | null>(null);
	/** Directory paths the user has expanded. */
	expanded = $state<Set<string>>(new Set());
	/** Lazy-loaded children keyed by dir path. */
	children = $state<Map<string, DirEntry[]>>(new Map());
	/** Currently selected file path (drives the viewer). */
	selected = $state<string | null>(null);
	loading = $state<Set<string>>(new Set());

	setMode(m: SidebarMode) {
		this.mode = m;
	}

	/** Point the tree at a new root and reset cached state. */
	setRoot(path: string | null) {
		if (this.root === path) return;
		this.root = path;
		this.expanded = new Set();
		this.children = new Map();
		this.loading = new Set();
		this.selected = null;
		if (path) void this.load(path);
	}

	async load(dir: string) {
		if (this.children.has(dir) || this.loading.has(dir)) return;
		this.loading = new Set(this.loading).add(dir);
		try {
			const entries = await listDir(dir);
			this.children = new Map(this.children).set(dir, entries);
		} catch {
			this.children = new Map(this.children).set(dir, []);
		} finally {
			const next = new Set(this.loading);
			next.delete(dir);
			this.loading = next;
		}
	}

	async reload(dir: string) {
		const next = new Map(this.children);
		next.delete(dir);
		this.children = next;
		await this.load(dir);
	}

	async toggle(dir: string) {
		const next = new Set(this.expanded);
		if (next.has(dir)) {
			next.delete(dir);
		} else {
			next.add(dir);
			await this.load(dir);
		}
		this.expanded = next;
	}

	select(path: string) {
		this.selected = path;
	}

	closeViewer() {
		this.selected = null;
	}
}

export const explorer = new ExplorerStore();
