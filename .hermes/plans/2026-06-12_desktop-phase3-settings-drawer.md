# Desktop Phase 3 — Settings tabs + Inspector nâng cấp (Junior Edition)

> Đọc `2026-06-12_desktop-INDEX.md` trước. Yêu cầu Phase 1+2 đã merge. Thuần frontend, zero wire risk. Gate mỗi task: `cd gui && pnpm check` = 0 errors ≤1 warning.

**Goal:** (A) SettingsView từ scroll-sections → 4 tab như design (`#view-settings` trong `ui-design/index.html`): General / Appearance / Integrations / Shortcuts, có persist tab + deep-link. (B) Inspector bổ sung nội dung thiếu so design drawer: row Project (click → switch), timeline events, thời gian created/duration.

**Design tham chiếu:** mở `ui-design/index.html` trong browser → Settings (4 tabs) + click session → drawer (timeline section).

---

## Task P3.1 — SettingsView: tab bar + chia section vào tab

**Risk:** medium · **Time:** ~2.5h

**Files:**
- Modify: `gui/src/lib/views/SettingsView.svelte`

**Đọc trước:** toàn bộ SettingsView (172 dòng). Hiện có sections: Daemon (dòng 35-45), 9Router (47-113), Remote Access (nếu R2 đã merge), Theme/Appearance, Shortcuts (cuối). KHÔNG đổi nội dung section — chỉ bọc vào tab panels.

### P3.1.1 — State + tab list

Thêm vào `<script>`:
```ts
	type SettingsTab = 'general' | 'appearance' | 'integrations' | 'shortcuts';
	const TAB_KEY = 'agentry:settings-tab';
	let tab = $state<SettingsTab>(
		(localStorage.getItem(TAB_KEY) as SettingsTab) || 'general'
	);
	function setTab(t: SettingsTab) {
		tab = t;
		localStorage.setItem(TAB_KEY, t);
	}
	const tabs: { id: SettingsTab; label: string }[] = [
		{ id: 'general', label: 'General' },
		{ id: 'appearance', label: 'Appearance' },
		{ id: 'integrations', label: 'Integrations' },
		{ id: 'shortcuts', label: 'Shortcuts' }
	];
```

### P3.1.2 — Tab bar markup (thay header hiện tại dòng 29-32)

**Before:**
```svelte
	<header class="px-6 py-5 border-b border-border">
		<h1 class="text-base font-semibold">Settings</h1>
		<p class="text-xs text-muted-foreground mt-0.5">Daemon limits and keyboard shortcuts.</p>
	</header>
```

**After:**
```svelte
	<header class="px-6 pt-5 border-b border-border">
		<h1 class="text-base font-semibold">Settings</h1>
		<nav class="flex gap-1 mt-3 -mb-px" role="tablist">
			{#each tabs as t (t.id)}
				<button
					role="tab"
					aria-selected={tab === t.id}
					class={cn(
						'px-3 py-2 text-xs rounded-t border-b-2 transition-colors',
						tab === t.id
							? 'border-primary text-foreground font-medium'
							: 'border-transparent text-muted-foreground hover:text-foreground'
					)}
					onclick={() => setTab(t.id)}
				>
					{t.label}
				</button>
			{/each}
		</nav>
	</header>
```
> `cn` đã import sẵn (dòng 5). `border-primary`: nếu Phase 1 đặt tên token khác (vd `--color-primary`) thì dùng class tương ứng — grep `primary` trong `app.css`.

### P3.1.3 — Phân section vào tab

Bọc các section hiện có trong `{#if}`:
- `general`: section Daemon
- `appearance`: section Theme/Appearance (density + theme picker + accent từ Phase 1) — **gồm cả section Density** (không được bỏ sót)
- `integrations`: section 9Router + section Remote Access (nếu có)
- `shortcuts`: section Shortcuts

```svelte
	<div class="p-6 space-y-6 max-w-2xl">
		{#if tab === 'general'}
			<!-- section Daemon giữ nguyên -->
		{:else if tab === 'appearance'}
			<!-- section Theme -->
		{:else if tab === 'integrations'}
			<!-- 9Router + Remote Access -->
		{:else if tab === 'shortcuts'}
			<!-- Shortcuts -->
		{/if}
	</div>
```
> Di chuyển markup section NGUYÊN VẸN — đừng sửa nội dung bên trong. Snippets (`{#snippet row...}`) để cuối file như cũ, dùng được mọi tab.

### Verify
```bash
cd gui && pnpm check && mise run dev
```
Manual: 4 tab click chuyển đúng; F5 → tab giữ nguyên (localStorage); mọi section cũ vẫn render đủ trong tab tương ứng.
**If fail:** snippet ngoài `{#if}` vẫn OK (file-level); section biến mất → check nhánh `{:else if}` đúng id.

### Commit
```bash
git add gui/src/lib/views/SettingsView.svelte && git commit -m "feat(gui): settings tabs with persisted selection"
```

---

## Task P3.2 — Inspector: row Project click-to-switch + timestamps

**Risk:** low · **Time:** ~1.5h

**Files:**
- Modify: `gui/src/lib/components/Inspector.svelte`

**Đọc trước:** Inspector.svelte:250-313 (section General, snippet `row` dòng 344-349). `SessionState` trong types.ts — check field có gì: `projectId`, `createdAt`?, `startedAt`?, `finishedAt`? — **grep types.ts trước, KHÔNG đoán**. Store `projects` + active project setter từ Phase 2 (`activeProjectId` trong ui store hoặc projects store — đọc Phase 2 đã đặt đâu).

### P3.2.1 — Row Project (sau row Agent, dòng ~252)

```ts
	import { projects } from '$lib/stores/projects';
	import { ui } from '$lib/stores/ui';

	// $projects là Map<string, ProjectState> — dùng .get(), không có .find()
	let project = $derived(
		session ? $projects.get(session.projectId) : undefined
	);

	// switchToProject: đặt activeProjectId + chuyển về view overview
	// (cùng logic với TopBar switcher Phase 2 — đọc TopBar.svelte onProjectSwitch)
	function switchToProject(id: string) {
		ui.update((u) => ({ ...u, activeProjectId: id, view: 'overview' }));
	}
```
Markup sau `{@render row('Agent', session.agent)}`:
```svelte
			{#if project}
				<div class="flex items-baseline justify-between gap-2">
					<span class="text-[10px] uppercase tracking-wider text-muted-foreground">Project</span>
					<button
						class="text-xs hover:text-gruvbox-yellow truncate"
						title="Switch to this project"
						onclick={() => switchToProject(project!.id)}
					>
						{project.name}
					</button>
				</div>
			{/if}
```
`switchToProject` = đúng hàm Phase 2 dùng cho switcher (re-use, đừng viết bản thứ hai).

### P3.2.2 — Timestamps

Nếu `SessionState` có timestamps (created/started/finished — đọc types.ts): thêm rows
```svelte
			{@render row('Created', fmtTime(session.createdAt))}
			{#if session.finishedAt}
				{@render row('Duration', fmtDuration(session.createdAt, session.finishedAt))}
			{/if}
```
với helpers nhỏ trong script (Intl.DateTimeFormat + diff phút). **Nếu types KHÔNG có field thời gian → SKIP task con này** (đừng thêm wire field — ngoài phạm vi).

### Verify
```bash
cd gui && pnpm check && mise run dev
```
Manual: click session → Inspector hiện Project name; click name → app chuyển active project (sidebar đổi); timestamps đúng format.

### Commit
```bash
git add gui/src/lib/components/Inspector.svelte && git commit -m "feat(gui): inspector project row + timestamps"
```

---

## Phạm vi nghiêm ngặt — KHÔNG làm
- KHÔNG chuyển Inspector thành drawer overlay (INDEX quyết định #2: giữ split-pane).
- KHÔNG thêm timeline events phức tạp nếu data không có sẵn trong stores — chỉ render field có thật.
- KHÔNG đụng wire/daemon. KHÔNG sửa nội dung section Settings khi di chuyển.

## Troubleshooting
| Triệu chứng | Sửa |
|---|---|
| Tab render trống | Section nằm ngoài `{#if}` chain hoặc sai id. |
| `cn is not defined` | Import từ `$lib/utils/cn` (đã có dòng 5). |
| Switch project không đổi sidebar | Dùng sai setter — đọc lại cách TopBar switcher (Phase 2) làm. |
| `createdAt` undefined | types.ts không có field — skip P3.2.2 theo plan. |

