# Desktop Phase 2 — Projects View & Project Switcher (Junior Edition)

> **For implementer:** Đọc INDEX (`2026-06-12_desktop-INDEX.md`) trước khi bắt đầu. Mỗi task = 1 commit, làm đúng thứ tự T2.1 → T2.7. Sau mỗi task chạy `cd gui && pnpm check` — phải `0 errors`, tối đa `1 warning` (warning `node types` tsconfig là pre-existing, KHÔNG sửa). Yêu cầu: Phase 1 đã merge xong.

## Mục tiêu phase

Theo design `ui-design/index.html` (`#view-projects` + `#project-modal`):
1. View `ProjectsView` mới: grid card project (name, tag active, path mono, stats sessions, Switch/Delete), empty state, nút New project.
2. Modal New Project: path (input + Browse qua Tauri dialog) + name auto-suggest + validate.
3. Nâng cấp project switcher trong TopBar: running-count chip, check icon, footer links.
4. Nav item Projects trong ActivityBar + entry trong CommandPalette.

Wire protocol ĐÃ có sẵn cmd `RemoveProject(RemoveProjectCmd { project_id })` (`crates/wire/src/lib.rs:40,72-74`) — GUI chỉ gọi, KHÔNG sửa Rust.

---

## T2.1 — ui.ts: thêm view `projects`

**Risk:** low · **Time:** ~30m

### Vấn đề / Mục tiêu
`View` union type chưa có `'projects'` — thêm vào để các task sau dùng `setView('projects')`.

### Files
- Modify: `gui/src/lib/stores/ui.ts`

### Changes

**1. Mở rộng View type (dòng 3).**

Before:
```ts
export type View = 'terminal' | 'profiles' | 'settings' | 'overview' | 'r9';
```

After:
```ts
export type View = 'terminal' | 'projects' | 'profiles' | 'settings' | 'overview' | 'r9';
```

### Verify
```bash
cd gui && pnpm check
```
Expected: `0 errors` (union mở rộng không phá chỗ nào).

### Commit
```bash
git add gui/src/lib/stores/ui.ts && git commit -m "feat(ui): add projects view to View union"
```

---

## T2.2 — ipc.ts: wrapper `removeProject` + projects.ts: store remove

**Risk:** low · **Time:** ~30m

### Vấn đề / Mục tiêu
1. Thêm typed wrapper gọi cmd `remove_project` (wire đã hỗ trợ — KHÔNG sửa wire/daemon).
2. `projects.ts` hiện chỉ có `addProject`/`getProject` — thêm `removeProject(id)` cho store.

### Files
- Modify: `gui/src/lib/ipc.ts`
- Modify: `gui/src/lib/stores/projects.ts`

### Changes

**1. ipc.ts — thêm wrapper ngay sau `createProject` (dòng 64–66).**

Before:
```ts
export async function createProject(name: string, path: string): Promise<void> {
	await rpc({ cmd: 'create_project', name, path });
}
```

After:
```ts
export async function createProject(name: string, path: string): Promise<void> {
	await rpc({ cmd: 'create_project', name, path });
}

export async function removeProject(projectId: string): Promise<void> {
	await rpc({ cmd: 'remove_project', project_id: projectId });
}
```

**2. projects.ts — thêm hàm remove trên store.**

Before (toàn bộ file):
```ts
import { writable, get } from 'svelte/store';
import type { ProjectState } from '$lib/types';

export const projects = writable<Map<string, ProjectState>>(new Map());

export function addProject(p: ProjectState) {
	projects.update((m) => {
		m.set(p.id, p);
		return m;
	});
}

export function getProject(id: string): ProjectState | undefined {
	return get(projects).get(id);
}
```

After:
```ts
import { writable, get } from 'svelte/store';
import type { ProjectState } from '$lib/types';

export const projects = writable<Map<string, ProjectState>>(new Map());

export function addProject(p: ProjectState) {
	projects.update((m) => {
		m.set(p.id, p);
		return m;
	});
}

export function getProject(id: string): ProjectState | undefined {
	return get(projects).get(id);
}

export function removeProject(id: string) {
	projects.update((m) => {
		m.delete(id);
		return m;
	});
}
```

LƯU Ý: 2 hàm trùng tên `removeProject` ở 2 module khác nhau — khi import cả hai trong 1 file, alias: `import { removeProject as removeProjectCmd } from '$lib/ipc';` (T2.3 dùng cách này). Giữ pattern writable Svelte 4, KHÔNG refactor sang runes.

### Verify
```bash
cd gui && pnpm check
```
Expected: `0 errors`.
**If fail:** kiểm tra `rpc` viết đúng (hàm private có sẵn trong ipc.ts), field là `project_id` (snake_case theo wire).

### Commit
```bash
git add gui/src/lib/ipc.ts gui/src/lib/stores/projects.ts && git commit -m "feat(ipc): removeProject command wrapper + store removal"
```

---

## Task T2.3 — Tạo ProjectsView.svelte (grid cards + switch + delete)

**Risk:** medium · **Time:** ~2h

**Mục tiêu:** Màn quản lý project: grid card mỗi project (name, active tag, path, stats running/total), nút Switch (đặt active), nút Delete (confirm + cảnh báo nếu còn session live). Empty state khi chưa có project.

**Files:**
- Create: `gui/src/lib/views/ProjectsView.svelte`

**Tham chiếu trước khi viết:** đọc `gui/src/lib/views/ProfilesView.svelte` (cấu trúc grid card + cn + lucide), `gui/src/lib/components/ConfirmDialog.svelte` (props), `gui/src/lib/views/OverviewView.svelte` (empty state).

### T2.3.1 — Khung component

Tạo file `gui/src/lib/views/ProjectsView.svelte`:

```svelte
<script lang="ts">
	import { projects, removeProject } from '$lib/stores/projects';
	import { sessions } from '$lib/stores/sessions';
	import { ui } from '$lib/stores/ui';
	import { removeProject as removeProjectCmd } from '$lib/ipc';
	import { toasts } from '$lib/stores/toasts.svelte';
	import ConfirmDialog from '$lib/components/ConfirmDialog.svelte';
	import { cn } from '$lib/utils/cn';
	import Plus from '@lucide/svelte/icons/plus';
	import Trash from '@lucide/svelte/icons/trash-2';
	import FolderKanban from '@lucide/svelte/icons/folder-kanban';
	import Check from '@lucide/svelte/icons/check';

	// modal state (New Project) — implemented in T2.4
	let showNew = $state(false);

	// confirm-delete state
	let pendingDelete = $state<string | null>(null);

	let projectList = $derived(Array.from($projects.values()));

	// live session count per project (status not finished/failed)
	function liveCount(projectId: string): number {
		let n = 0;
		for (const s of $sessions.values()) {
			if (s.projectId !== projectId) continue;
			if (s.status === 'finished' || s.status === 'failed') continue;
			n++;
		}
		return n;
	}
	function totalCount(projectId: string): number {
		let n = 0;
		for (const s of $sessions.values()) if (s.projectId === projectId) n++;
		return n;
	}

	function switchTo(id: string) {
		ui.update((u) => ({ ...u, activeProjectId: id }));
		toasts.info('Switched project');
	}

	let pendingProject = $derived(pendingDelete ? $projects.get(pendingDelete) : undefined);
	let pendingLive = $derived(pendingDelete ? liveCount(pendingDelete) : 0);

	async function doDelete() {
		const id = pendingDelete;
		pendingDelete = null;
		if (!id) return;
		try {
			await removeProjectCmd(id);
			removeProject(id);
			// reassign active project if we deleted the active one
			if ($ui.activeProjectId === id) {
				const next = Array.from($projects.keys())[0] ?? null;
				ui.update((u) => ({ ...u, activeProjectId: next }));
			}
			toasts.success('Project removed');
		} catch (e) {
			toasts.error(`Remove failed: ${e}`);
		}
	}
</script>
```

> **Foot-gun:** `removeProjectCmd` (ipc, gửi wire) và `removeProject` (store, xoá local) TRÙNG TÊN — alias ipc thành `removeProjectCmd`. Gọi cmd TRƯỚC, store SAU (store xoá xong thì `$projects.get(id)` mất, cần id đã giữ).

### T2.3.2 — Markup grid + empty state

Thêm ngay dưới `</script>`:

```svelte
<div class="flex flex-col h-full overflow-y-auto">
	<header class="px-6 py-5 border-b border-border flex items-center justify-between">
		<div>
			<h1 class="text-base font-semibold">Projects</h1>
			<p class="text-xs text-muted-foreground mt-0.5">Switch, create, or remove projects.</p>
		</div>
		<button
			class="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded border border-border hover:bg-secondary"
			onclick={() => (showNew = true)}
		>
			<Plus class="size-3.5" /> New project
		</button>
	</header>

	{#if projectList.length === 0}
		<div class="flex-1 flex flex-col items-center justify-center text-center gap-3 p-10">
			<FolderKanban class="size-10 text-muted-foreground" />
			<div>
				<p class="text-sm font-medium">No projects yet</p>
				<p class="text-xs text-muted-foreground mt-1">Create a project to start launching agents.</p>
			</div>
			<button
				class="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded bg-secondary hover:bg-secondary/70"
				onclick={() => (showNew = true)}
			>
				<Plus class="size-3.5" /> Create project
			</button>
		</div>
	{:else}
		<div class="p-6 grid grid-cols-1 md:grid-cols-2 gap-3">
			{#each projectList as p (p.id)}
				<div class="bg-card border border-border rounded p-4 flex flex-col gap-2">
					<div class="flex items-center gap-2">
						<span class="font-medium text-sm truncate">{p.name}</span>
						{#if $ui.activeProjectId === p.id}
							<span class="text-[10px] px-1.5 py-0.5 rounded bg-accent text-accent-foreground">active</span>
						{/if}
						<button
							class="ml-auto p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive"
							title="Remove project"
							onclick={() => (pendingDelete = p.id)}
						>
							<Trash class="size-3.5" />
						</button>
					</div>
					<div class="text-xs text-muted-foreground font-mono truncate">{p.path}</div>
					<div class="flex items-center gap-3 text-xs text-muted-foreground mt-1">
						<span class="text-accent-ok">{liveCount(p.id)} running</span>
						<span>{totalCount(p.id)} total</span>
					</div>
					{#if $ui.activeProjectId !== p.id}
						<button
							class="mt-1 inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs rounded border border-border hover:bg-secondary"
							onclick={() => switchTo(p.id)}
						>
							<Check class="size-3.5" /> Switch to this project
						</button>
					{/if}
				</div>
			{/each}
		</div>
	{/if}
</div>

<ConfirmDialog
	open={pendingDelete !== null}
	title="Remove project?"
	message={pendingLive > 0
		? `"${pendingProject?.name}" has ${pendingLive} running agent(s). Removing it will kill them.`
		: `"${pendingProject?.name}" will be removed.`}
	confirmLabel="Remove"
	onConfirm={doDelete}
	onCancel={() => (pendingDelete = null)}
/>

<!-- New Project modal: implemented in T2.4 -->
```

> **Kiểm tra props ConfirmDialog:** mở `gui/src/lib/components/ConfirmDialog.svelte` xác nhận tên prop thật (`open`, `title`, `message`, `confirmLabel`/`okLabel`, `onConfirm`, `onCancel`). Sửa tên cho khớp nếu khác — ĐỪNG đoán.

### Verify
```bash
cd gui && pnpm check
```
Expected: `0 errors` (1 warning pre-existing). Component chưa render được (chưa wire vào +page — T2.5), nhưng phải compile sạch.
**If fail:** import sai `$lib/...`; `removeProject` không tồn tại trong store → quay lại T2.2 thêm; props ConfirmDialog sai tên → đọc file xác nhận.

### Commit
```bash
git add gui/src/lib/views/ProjectsView.svelte && git commit -m "feat(gui): ProjectsView grid + switch + delete"
```

---

## Task T2.4 — Modal New Project (path + Browse + name auto-suggest)

**Risk:** medium · **Time:** ~1.5h

**Mục tiêu:** Modal tạo project: chọn thư mục qua Tauri dialog, auto-suggest name từ basename, validate path bắt buộc + chống trùng path, submit qua `createProject` ipc có sẵn, set active = project mới.

**Files:**
- Modify: `gui/src/lib/views/ProjectsView.svelte` (thêm modal markup + logic)

**Tham chiếu BẮT BUỘC trước khi code:** mở `gui/src/lib/components/Onboarding.svelte`, tìm chỗ gọi `open(` từ `@tauri-apps/plugin-dialog` (bước pick folder) — copy đúng cách import + gọi. Cũng xem cách Onboarding gọi `createProject` và nhận id (đọc `gui/src/lib/ipc.ts` hàm `createProject` xem nó trả gì — nếu resp có `project_id` thì dùng trực tiếp; nếu không, set active trong listener `onProjectCreated` ở `+page.svelte`).

### T2.4.1 — Logic modal (thêm vào `<script>` của ProjectsView)

```ts
	import { open as openDialog } from '@tauri-apps/plugin-dialog';
	import { createProject } from '$lib/ipc';

	let newPath = $state('');
	let newName = $state('');
	let nameTouched = $state(false);
	let pathError = $state('');
	let submitting = $state(false);

	function basename(p: string): string {
		return p.replace(/[/\\]+$/, '').split(/[/\\]/).pop() ?? '';
	}

	async function browse() {
		const dir = await openDialog({ directory: true, multiple: false });
		if (typeof dir === 'string') {
			newPath = dir;
			if (!nameTouched) newName = basename(dir);
			pathError = '';
		}
	}

	function resetNew() {
		newPath = ''; newName = ''; nameTouched = false; pathError = ''; showNew = false;
	}

	async function submitNew() {
		if (!newPath.trim()) { pathError = 'Path is required'; return; }
		const dup = Array.from($projects.values()).find((p) => p.path === newPath.trim());
		if (dup) { pathError = `Already added as "${dup.name}"`; return; }
		submitting = true;
		try {
			await createProject(newName.trim() || basename(newPath), newPath.trim());
			// project_created event updates the store (listener in +page.svelte);
			// set active to the newly created project once it appears
			resetNew();
			toasts.success('Project created');
		} catch (e) {
			pathError = String(e);
		} finally {
			submitting = false;
		}
	}
```

> **Kiểm tra chữ ký `createProject` trong ipc.ts** — thứ tự tham số có thể là `(path, name)` hoặc `(name, path)`. Đọc hàm thật, đừng đoán. Nếu hàm trả `project_id`, sau `await` hãy `ui.update((u) => ({ ...u, activeProjectId: <id> }))`.

### T2.4.2 — Markup modal (thêm cuối file, trước comment T2.4)

```svelte
{#if showNew}
	<div class="fixed inset-0 z-40 bg-black/50" role="presentation" onclick={resetNew}></div>
	<div class="fixed z-50 inset-0 grid place-items-center pointer-events-none">
		<div class="pointer-events-auto w-full max-w-md bg-popover border border-border rounded-lg p-5 space-y-4 shadow-lg">
			<h2 class="text-sm font-semibold">New project</h2>

			<div class="space-y-1.5">
				<label class="text-xs text-muted-foreground" for="np-path">Folder</label>
				<div class="flex gap-2">
					<input
						id="np-path"
						class="flex-1 px-2.5 py-1.5 text-sm rounded bg-input border border-border font-mono"
						placeholder="/path/to/repo"
						bind:value={newPath}
						oninput={() => { pathError = ''; if (!nameTouched) newName = basename(newPath); }}
					/>
					<button class="px-3 py-1.5 text-xs rounded border border-border hover:bg-secondary" onclick={browse}>
						Browse
					</button>
				</div>
				{#if pathError}
					<p class="text-xs text-destructive">{pathError}</p>
				{/if}
			</div>

			<div class="space-y-1.5">
				<label class="text-xs text-muted-foreground" for="np-name">Name</label>
				<input
					id="np-name"
					class="w-full px-2.5 py-1.5 text-sm rounded bg-input border border-border"
					bind:value={newName}
					oninput={() => (nameTouched = true)}
				/>
			</div>

			<div class="flex justify-end gap-2 pt-1">
				<button class="px-3 py-1.5 text-xs rounded border border-border hover:bg-secondary" onclick={resetNew}>
					Cancel
				</button>
				<button
					class="px-3 py-1.5 text-xs rounded bg-accent text-accent-foreground disabled:opacity-50"
					disabled={submitting || !newPath.trim()}
					onclick={submitNew}
				>
					{submitting ? 'Creating…' : 'Create'}
				</button>
			</div>
		</div>
	</div>
{/if}
```

### Verify
```bash
cd gui && pnpm check && mise run dev
```
Manual: Projects view → New project → Browse chọn folder → name tự điền → Create → toast + card mới xuất hiện (qua event `project_created`) → thử path trùng → báo lỗi inline, không tạo.
**If fail:** dialog không mở → import `open` từ `@tauri-apps/plugin-dialog` (xem Onboarding.svelte); card không xuất hiện → listener `onProjectCreated` trong `+page.svelte` (đừng tự `addProject` thủ công — sẽ duplicate khi event về).

### Commit
```bash
git add gui/src/lib/views/ProjectsView.svelte && git commit -m "feat(gui): new-project modal with browse + name suggest"
```

---

## Task T2.5 — Wire ProjectsView vào nav + view switch

**Risk:** low · **Time:** ~30m

**Files:**
- Modify: `gui/src/lib/components/ActivityBar.svelte`
- Modify: `gui/src/routes/+page.svelte`

### T2.5.1 — ActivityBar: thêm nav item Projects

Trong `gui/src/lib/components/ActivityBar.svelte`, thêm import (gần các icon import đầu file):

```ts
	import FolderKanban from '@lucide/svelte/icons/folder-kanban';
```

**Before** (mảng `items`, dòng ~13-19):
```ts
	const items: { id: View; icon: typeof Home; label: string; shortcut?: string }[] = [
		{ id: 'overview', icon: Home, label: 'Overview' },
		{ id: 'terminal', icon: Folders, label: 'Sessions' },
		{ id: 'profiles', icon: User, label: 'Profiles' },
		{ id: 'r9', icon: Router, label: '9Router' },
		{ id: 'settings', icon: Settings, label: 'Settings' }
	];
```

**After:**
```ts
	const items: { id: View; icon: typeof Home; label: string; shortcut?: string }[] = [
		{ id: 'overview', icon: Home, label: 'Overview' },
		{ id: 'terminal', icon: Folders, label: 'Sessions' },
		{ id: 'projects', icon: FolderKanban, label: 'Projects' },
		{ id: 'profiles', icon: User, label: 'Profiles' },
		{ id: 'r9', icon: Router, label: '9Router' },
		{ id: 'settings', icon: Settings, label: 'Settings' }
	];
```

### T2.5.2 — +page.svelte: import + nhánh view

Thêm import (cạnh các view import dòng ~17-20):
```ts
	import ProjectsView from '$lib/views/ProjectsView.svelte';
```

**Before** (block view switch đầy đủ, dòng 686-702 — **copy toàn bộ để tìm đúng vị trí**):
```svelte
		{:else if $ui.view === 'overview'}
				<div class="flex-1 overflow-hidden">
					<OverviewView />
				</div>
			{:else if $ui.view === 'profiles'}
				<div class="flex-1 overflow-hidden">
					<ProfilesView />
				</div>
			{:else if $ui.view === 'r9'}
				<div class="flex-1 overflow-hidden">
					<R9DashboardView />
				</div>
			{:else if $ui.view === 'settings'}
				<div class="flex-1 overflow-hidden">
					<SettingsView />
				</div>
			{/if}
```

**After:** chèn nhánh `projects` ngay sau `overview`, trước `profiles`:
```svelte
			{:else if $ui.view === 'overview'}
				<div class="flex-1 overflow-hidden">
					<OverviewView />
				</div>
			{:else if $ui.view === 'projects'}
				<div class="flex-1 overflow-hidden">
					<ProjectsView />
				</div>
			{:else if $ui.view === 'profiles'}
				<div class="flex-1 overflow-hidden">
					<ProfilesView />
				</div>
```

### Verify
```bash
cd gui && pnpm check && mise run dev
```
Manual: ActivityBar có item "Projects" giữa Sessions và Profiles; click → ProjectsView render.
**If fail:** `View` type thiếu `'projects'` → quay lại T2.1; import path sai.

### Commit
```bash
git add gui/src/lib/components/ActivityBar.svelte gui/src/routes/+page.svelte && git commit -m "feat(gui): add Projects to activity bar + view router"
```

---

## Task T2.6 — Nâng cấp project switcher trên TopBar

**Risk:** medium · **Time:** ~1h

**Mục tiêu:** Dropdown project hiện running-count + check icon active; footer có "New project…" và "Manage projects".

**Files:**
- Modify: `gui/src/lib/components/TopBar.svelte`

**Đọc trước:** `gui/src/lib/components/TopBar.svelte` dòng 39-79 (dropdown hiện tại). Đã có `$projects`, `$sessions`, `$ui`, `cn`.

### T2.6.1 — Helper đếm live + import

Thêm vào `<script>`:
```ts
	import { setView } from '$lib/stores/ui';
	import Check from '@lucide/svelte/icons/check';  // (Check đã import sẵn — bỏ qua nếu trùng)

	function liveCount(projectId: string): number {
		let n = 0;
		for (const s of sessionList) {
			if (s.projectId !== projectId) continue;
			if (s.status === 'finished' || s.status === 'failed') continue;
			n++;
		}
		return n;
	}
```

> `Check` có thể đã import (dòng 8). Nếu trùng → bỏ dòng import thừa, svelte-check sẽ báo.

### T2.6.2 — Mỗi row: count chip + active check

**Before** (dòng ~59-72, mỗi project button trong dropdown):
```svelte
				{#each projectList as p (p.id)}
					<button
						class={cn(
							'w-full text-left px-3 py-1.5 text-sm hover:bg-secondary',
							$ui.activeProjectId === p.id && 'text-gruvbox-yellow'
						)}
						onclick={() => {
							ui.update((u) => ({ ...u, activeProjectId: p.id }));
							projectMenuOpen = false;
						}}
					>
						<div>{p.name}</div>
						<div class="text-xs text-muted-foreground font-mono truncate">{p.path}</div>
					</button>
				{/each}
```

**After:**
```svelte
				{#each projectList as p (p.id)}
					<button
						class={cn(
							'w-full text-left px-3 py-1.5 text-sm hover:bg-secondary flex items-center gap-2',
							$ui.activeProjectId === p.id && 'text-gruvbox-yellow'
						)}
						onclick={() => {
							ui.update((u) => ({ ...u, activeProjectId: p.id }));
							projectMenuOpen = false;
						}}
					>
						<div class="flex-1 min-w-0">
							<div class="flex items-center gap-1.5">
								{#if $ui.activeProjectId === p.id}<Check size={12} />{/if}
								<span class="truncate">{p.name}</span>
							</div>
							<div class="text-xs text-muted-foreground font-mono truncate">{p.path}</div>
						</div>
						{#if liveCount(p.id) > 0}
							<span class="text-[10px] px-1.5 py-0.5 rounded bg-accent-ok/15 text-accent-ok">{liveCount(p.id)}</span>
						{/if}
					</button>
				{/each}
```

### T2.6.3 — Footer dropdown

**Before** (block cuối dropdown — empty state dòng ~74-76):
```svelte
				{#if projectList.length === 0}
					<div class="px-3 py-1.5 text-xs text-muted-foreground">No projects</div>
				{/if}
```

**After:**
```svelte
				{#if projectList.length === 0}
					<div class="px-3 py-1.5 text-xs text-muted-foreground">No projects</div>
				{/if}
				<div class="border-t border-border mt-1 pt-1">
					<button
						class="w-full text-left px-3 py-1.5 text-xs text-muted-foreground hover:bg-secondary hover:text-foreground"
						onclick={() => { setView('projects'); projectMenuOpen = false; }}
					>
						Manage projects…
					</button>
				</div>
```

> "New project…" mở modal nằm trong ProjectsView, nên ở đây ta điều hướng tới Projects view (modal tự bật khi user bấm New). Đơn giản + không cần state cross-component. (Nếu muốn mở thẳng modal: T2.4 export một store flag — KHÔNG bắt buộc, để Phase polish.)

### Verify
```bash
cd gui && pnpm check && mise run dev
```
Manual: mở dropdown project trên topbar → thấy check ở active + số running chip → "Manage projects…" nhảy Projects view.
**If fail:** `Check`/`setView` import trùng hoặc thiếu; `liveCount` đọc `sessionList` (biến `$derived` đã có sẵn trong TopBar — xác nhận tên đúng).

### Commit
```bash
git add gui/src/lib/components/TopBar.svelte && git commit -m "feat(gui): topbar project switcher running-count + manage link"
```

---

## Task T2.7 — Command Palette: Projects nav + New project action

**Risk:** low · **Time:** ~45m

**Files:**
- Modify: `gui/src/lib/components/CommandPalette.svelte`

**Đọc trước:** `gui/src/lib/components/CommandPalette.svelte` — xem cấu trúc entry (category, label, action). Thêm 1 entry Navigate→Projects + 1 action "New project…".

### T2.7.1 — Thêm entries

Tìm block tạo entries Navigate (vd nơi push `{ category: 'Navigate', label: 'Overview', action: () => setView('overview') }`). Thêm:
```ts
		{ category: 'Navigate', label: 'Projects', action: () => setView('projects') },
		{ category: 'Projects', label: 'New project…', action: () => { setView('projects'); /* user bấm New trong view */ } },
```

> Khớp đúng SHAPE entry thật trong file (tên field có thể là `run`/`onSelect` thay vì `action`; `name`/`title` thay vì `label`). ĐỌC file, dùng đúng tên — đừng copy mù.

### Verify
```bash
cd gui && pnpm check && mise run dev
```
Manual: ⌘K → gõ "project" → thấy "Projects" (Navigate) + "New project…" → Enter điều hướng đúng.
**If fail:** shape entry sai field → đọc lại type entry trong file.

### Commit
```bash
git add gui/src/lib/components/CommandPalette.svelte && git commit -m "feat(gui): palette entries for projects nav + new project"
```

---

## Verify toàn Phase 2 (trước khi mở PR)

```bash
mise run check          # clippy + svelte-check, phải xanh (≤1 warning pre-existing)
mise run dev            # smoke test thủ công
```

Checklist tay:
- [ ] ActivityBar có "Projects"; click render ProjectsView
- [ ] Grid hiện đúng project + running/total + active tag
- [ ] New project: Browse → name auto → Create → card mới; path trùng báo lỗi
- [ ] Switch project: card đổi active + sidebar/overview đổi scope
- [ ] Delete project có session live → confirm cảnh báo "N running agents"; xoá active → active nhảy sang project khác
- [ ] TopBar dropdown: check active + running chip + "Manage projects…"
- [ ] ⌘K: Projects nav + New project action

---

## Phạm vi nghiêm ngặt — KHÔNG làm

- KHÔNG đụng `crates/wire/`, `daemon/`, `cli/`, `gui/src-tauri/` — wire `remove_project` / `create_project` đã có sẵn, Phase 2 thuần frontend.
- KHÔNG refactor stores writable (`ui`/`projects`/`sessions`) sang runes.
- KHÔNG đổi default theme hay default project.
- KHÔNG đổi text/label ở component ngoài `Files:` của từng task.
- File nào modified mà không nằm trong `Files:` của task đang làm → `git checkout -- <file>` trước khi commit.

## Troubleshooting

| Triệu chứng | Nguyên nhân | Cách sửa |
|---|---|---|
| Card project mới không xuất hiện sau Create | Tự gọi `addProject` thủ công HOẶC listener `onProjectCreated` không chạy | Đừng thêm thủ công — để event `project_created` cập nhật store (xem `+page.svelte`). Kiểm tra listener còn đăng ký. |
| `open is not a function` khi Browse | Import sai dialog API | `import { open } from '@tauri-apps/plugin-dialog'` (xem `Onboarding.svelte`); alias `openDialog` nếu trùng tên. |
| ConfirmDialog không hiện | Sai tên prop | Mở `ConfirmDialog.svelte` đọc đúng prop (`open`/`title`/`message`/`onConfirm`/`onCancel`); sửa cho khớp. |
| `FolderKanban` import lỗi | Sai đường dẫn icon | `@lucide/svelte/icons/folder-kanban` (kebab-case). |
| App trắng/gray sau khi sửa | `$effect` orphan hoặc lỗi runtime | Không thêm `$effect` module-level; check console. |
| Active project = null sau khi xoá hết | Không guard | `activeProject?.name`; UI 0-project → empty state (đã có). |
| svelte-check `Cannot find 'projects' view` | `View` type chưa thêm | T2.1: `View = ... | 'projects'`. |
