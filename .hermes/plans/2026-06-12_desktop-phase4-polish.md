# Desktop Phase 4 — Polish theo design (Junior Edition)

> Đọc `2026-06-12_desktop-INDEX.md` trước. Yêu cầu Phase 1-3 merge. Thuần frontend, zero wire. Đây là phase "nice-to-have" — mỗi task độc lập, có thể làm lẻ. Gate: `cd gui && pnpm check` = 0 errors ≤1 warning.

**Goal:** Khớp các chi tiết hoàn thiện trong `ui-design/`: empty states tử tế, badge "needs input" nổi bật, keyboard hints, các entry mới trong command palette cho tính năng Phase 2-3.

**Design tham chiếu:** `ui-design/index.html` — empty states (`.empty-state`), badge awaiting (`.badge-await`), palette (`#palette`).

---

## Task P4.1 — Empty states cho các view

**Risk:** low · **Time:** ~1.5h

**Files:**
- Modify: `gui/src/lib/views/OverviewView.svelte`
- Modify: `gui/src/lib/views/ProjectsView.svelte` (từ Phase 2)
- Modify: `gui/src/lib/components/SessionSidebar.svelte`

**Đọc trước:** mỗi file xem có empty branch chưa. Design empty-state = icon lucide + dòng tiêu đề + dòng phụ + (nếu hợp lý) nút hành động.

Pattern thống nhất — tạo component dùng chung `gui/src/lib/components/EmptyState.svelte`:
```svelte
<script lang="ts">
	import type { Component } from 'svelte';
	let { icon: Icon, title, hint, action }: {
		icon: Component; title: string; hint?: string;
		action?: { label: string; onClick: () => void };
	} = $props();
</script>

<div class="flex flex-col items-center justify-center h-full text-center px-6 py-12 gap-2">
	<Icon class="size-8 text-muted-foreground/50" />
	<p class="text-sm font-medium">{title}</p>
	{#if hint}<p class="text-xs text-muted-foreground max-w-xs">{hint}</p>{/if}
	{#if action}
		<button
			class="mt-2 inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded border border-border hover:bg-secondary"
			onclick={action.onClick}
		>{action.label}</button>
	{/if}
</div>
```

Dùng trong:
- **SessionSidebar** khi không có session: icon `Inbox`, "No sessions", "Press ⌘T to start one", action → newSession.
- **ProjectsView** khi không có project: icon `FolderOpen`, "No projects yet", "Add a project to organize your sessions", action → mở modal New Project.
- **OverviewView** khi rỗng: icon `LayoutGrid`, "Nothing running", hint phù hợp.

> Component props dùng `Component` type của Svelte 5 cho icon. Verify cú pháp `{ icon: Icon }` destructure đổi tên — đúng Svelte 5.

### Verify
```bash
cd gui && pnpm check && mise run dev
```
Manual: xoá hết session → sidebar hiện empty state + nút chạy được; tương tự projects.

### Commit
```bash
git add gui/src/lib/components/EmptyState.svelte gui/src/lib/views/OverviewView.svelte gui/src/lib/views/ProjectsView.svelte gui/src/lib/components/SessionSidebar.svelte && git commit -m "feat(gui): consistent empty states across views"
```

---

## Task P4.2 — Badge "needs input" nổi bật trong sidebar

**Risk:** low · **Time:** ~1h

**Files:**
- Modify: `gui/src/lib/components/SessionSidebar.svelte`

**Đọc trước:** cách sidebar render mỗi session row hiện tại + dùng `activity === 'awaiting_input'` ở đâu (grep). Design: session đang chờ input có badge/pulse rõ ràng (ô vàng/đỏ "needs you"), không chỉ chấm màu.

Thêm: khi `session.activity === 'awaiting_input'`, render badge nhỏ cạnh title:
```svelte
{#if session.activity === 'awaiting_input'}
	<span class="text-[9px] px-1 py-px rounded bg-accent-error/15 text-accent-error font-medium uppercase tracking-wide animate-pulse">
		needs you
	</span>
{/if}
```
> `accent-error` là token hiện có (Inspector dùng `text-accent-error`). `animate-pulse` của Tailwind. Đừng lạm dụng pulse — chỉ badge này.

Tùy chọn: sort session `awaiting_input` lên đầu nhóm (nếu sidebar chưa sort vậy — kiểm tra logic sort hiện tại, đừng phá thứ tự đang có nếu đã ưu tiên).

### Verify
```bash
cd gui && pnpm check && mise run dev
```
Manual: tạo session, chờ tới khi agent hỏi (awaiting_input) → badge "needs you" hiện + pulse. Session khác không có badge.

### Commit
```bash
git add gui/src/lib/components/SessionSidebar.svelte && git commit -m "feat(gui): needs-input badge in session sidebar"
```

---

## Task P4.3 — Command palette: entries mới

**Risk:** low · **Time:** ~1h

**Files:**
- Modify: `gui/src/lib/components/CommandPalette.svelte`

**Đọc trước:** cấu trúc danh sách command hiện có (mảng actions/commands). Thêm entries cho tính năng Phase 2-3:
- "New project" → mở modal New Project (Phase 2)
- "Switch project…" → mở project switcher
- "Settings: Appearance" / "Settings: Integrations" → mở Settings + deep-link tab (set localStorage `agentry:settings-tab` + chuyển view settings)
- "Toggle remote access" → nếu R2 merged: gọi `remote.setEnabled(!listening)`

> **ĐỌC TRƯỚC khi thêm entry:** Đọc `CommandPalette.svelte` để lấy type `ActionItem` thật. Shape hiện tại (dựa vào code thật):
> ```ts
> type ActionItem = {
>   id: string; title: string; subtitle?: string;
>   category: string; icon: typeof Terminal;
>   shortcut?: string[]; run: () => void | Promise<void>;
> }
> ```
> **KHÔNG có** `label`/`action`/`keywords`/`group` — dùng sai tên field → TypeScript error. Dùng `title` (không phải `label`), `run` (không phải `action`), `category` (không phải `group`). Copy y mẫu 1 entry có sẵn là cách nhanh nhất.

### Verify
```bash
cd gui && pnpm check && mise run dev
```
Manual: ⌘K → gõ "project" → thấy New/Switch project; chọn → đúng hành động; "Appearance" → mở Settings tab Appearance.

### Commit
```bash
git add gui/src/lib/components/CommandPalette.svelte && git commit -m "feat(gui): palette entries for projects, settings tabs, remote"
```

---

## Task P4.4 — Keyboard hints + footer polish (tùy chọn)

**Risk:** low · **Time:** ~45m

**Files:**
- Modify: file chứa status bar/footer (grep "footer" hoặc status bar trong `+page.svelte`)

Thêm hint phím tắt ngữ cảnh ở status bar (vd "⌘K commands · ⌘T new session") như design `.statusbar` hints. Dùng `fmtChord` (đã có trong `utils/cn`, SettingsView import nó).

> Đây là cosmetic — nếu không có status bar sẵn thì SKIP, đừng tạo mới chỉ để có hint.

### Verify + Commit
```bash
cd gui && pnpm check
git add -A && git commit -m "chore(gui): contextual keyboard hints in status bar"
```

---

## Verify toàn Phase 4
```bash
cd gui && pnpm check && mise run check
```
Checklist:
- [ ] Empty states 3 view đẹp + nút hành động chạy
- [ ] Badge needs-you hiện đúng lúc awaiting_input
- [ ] Palette có entries mới, mỗi cái dẫn đúng hành động
- [ ] Không regress: mọi flow Phase 1-3 còn nguyên
- [ ] `pnpm check` = 0 errors ≤1 warning

## Phạm vi nghiêm ngặt — KHÔNG làm
- KHÔNG thêm animation/transition nặng (chỉ `animate-pulse` cho 1 badge).
- KHÔNG đụng wire/daemon.
- Task P4.4 cosmetic — bỏ qua được nếu không có chỗ gắn.
- KHÔNG gom 4 task vào 1 commit — mỗi task 1 commit.

## Troubleshooting
| Triệu chứng | Sửa |
|---|---|
| `Component` type lỗi import | `import type { Component } from 'svelte'` (Svelte 5). |
| Badge không hiện | Activity field tên khác — grep `awaiting_input` xem đúng path. |
| Palette entry không chạy | Sai shape action so entries cũ — copy y mẫu 1 entry có sẵn. |
| Deep-link settings tab không nhảy | Set localStorage TRƯỚC khi chuyển view; SettingsView đọc key lúc mount. |

