# Áp dụng UI/UX Design vào Agentry Desktop — INDEX (đọc file này trước)

> **Cho implementer (junior):** Bộ plan này gồm 4 phase, mỗi phase 1 file, làm ĐÚNG THỨ TỰ. Đọc hết phần "Bối cảnh chung" dưới đây trước khi mở Phase 1. Mỗi task = 1 commit. Sau mỗi task: `cd gui && pnpm check` phải đạt gate. KHÔNG nhảy phase.

## Mục tiêu tổng

Áp dụng design prototype `ui-design/` (desktop) vào GUI Svelte thật `gui/src/`, đồng thời bổ sung các chức năng có trong design nhưng chưa có trong app:

1. **Projects view** (quản lý project: list/switch/delete + modal tạo mới)
2. **Theme system mở rộng**: thêm theme `dark` (shadcn zinc) + `light`, accent picker (blue/teal/violet/amber), giữ nguyên gruvbox/one-dark
3. **Settings tabs** + bổ sung UI còn thiếu (agent binary paths, conn status)
4. **Session Detail drawer** (timeline, meta đầy đủ) nâng cấp từ Inspector
5. **Polish theo design**: empty states, badges "needs input", keyboard hints, palette entries mới

## Thứ tự file

| Phase | File | Nội dung | Wire risk |
|---|---|---|---|
| 1 | `2026-06-12_desktop-phase1-theme-tokens.md` | Theme dark/light + accent + tokens | Zero |
| 2 | `2026-06-12_desktop-phase2-projects-view.md` | Projects view + modal + switcher nâng cấp | Zero (wire có sẵn `remove_project`) |
| 3 | `2026-06-12_desktop-phase3-settings-drawer.md` | Settings tabs + Inspector→drawer nâng cấp | Zero |
| 4 | `2026-06-12_desktop-phase4-polish.md` | Empty states, badges, hints, palette | Zero |

Mỗi phase = 1 PR riêng. KHÔNG gộp.

## Bối cảnh chung (đọc 1 lần, áp dụng mọi phase)

### Đọc file theo thứ tự này trước khi code (≈30 phút)

1. `CLAUDE.md` + `AGENTS.md` (gốc repo) — kiến trúc, foot-guns
2. `gui/src/app.css` — theme tokens Tailwind v4 (`@theme inline` + `:root[data-theme]` overrides)
3. `gui/src/lib/stores/theme.svelte.ts` — store runes mẫu (`$state` + `$effect.root`)
4. `gui/src/lib/stores/ui.ts` — store writable Svelte 4 (pattern cũ, vẫn dùng)
5. `gui/src/routes/+page.svelte` — toàn bộ layout (ActivityBar/TopBar/SplitPane/views)
6. `gui/src/lib/types.ts` + `gui/src/lib/ipc.ts` — wire types + IPC wrappers
7. `ui-design/index.html` + `ui-design/style.css` — design đích (mở bằng browser để nhìn)

### Quy ước codebase (bắt buộc)

- **Svelte 5 runes** trong component (`$state`, `$derived`, `$props`, `$effect`). Stores domain cũ (`ui.ts`, `sessions.ts`...) là writable Svelte 4 — GIỮ NGUYÊN pattern khi sửa chúng; store MỚI viết dạng runes `.svelte.ts` (mẫu: `theme.svelte.ts`, `r9.svelte.ts`).
- **Tailwind v4**: utility classes sinh từ `@theme inline {}` trong `app.css`. Var khai trong `:root[data-theme=...]` chỉ là override runtime — KHÔNG sinh class mới. Muốn class mới → khai trong `@theme inline`.
- `$effect()` ở module-level `.svelte.ts` PHẢI bọc `$effect.root()` (xem `theme.svelte.ts:9`) — quên là gray screen.
- Icon: `@lucide/svelte` (đã cài). KHÔNG thêm icon lib khác. KHÔNG dùng emoji.
- Comments + commit messages: **tiếng Anh**, format `feat:`/`fix:`/`chore:`.
- KHÔNG thêm dependency mới khi chưa kiểm tra `gui/package.json` (bits-ui, @lucide/svelte, @xterm/addon-search có sẵn).

### Lệnh

| Lệnh | Dùng khi |
|---|---|
| `cd gui && pnpm check` | Sau MỖI task (svelte-check, nhanh) |
| `mise run check` | Cuối mỗi phase trước khi PR (clippy + svelte-check) |
| `mise run dev` | Chạy app thật để verify tay |
| `mise run reset` | Daemon/DB wedged |

### Baseline (đo ngày 2026-06-12, tree sạch, main)

| Gate | Lệnh | Kết quả |
|---|---|---|
| svelte-check | `cd gui && pnpm check` | **0 errors, 1 warning** (warning `node` types trong tsconfig — pre-existing, KHÔNG phải lỗi của bạn, đừng sửa) |

→ Gate mọi task: `pnpm check` = **0 errors, ≤1 warning**. Warning thứ 2 trở lên = bạn gây ra.

### Phạm vi nghiêm ngặt — KHÔNG làm

- KHÔNG đụng `crates/wire/`, `daemon/`, `cli/` ở MỌI phase (toàn bộ bộ plan này là frontend-only; wire đã có đủ cmd cần dùng: `remove_project`, `rename_session`, `delete_session`...).
- KHÔNG đụng `gui/src-tauri/` (shim Rust).
- KHÔNG refactor stores writable → runes "tiện thể".
- KHÔNG đổi chuỗi text/label ngoài các file được liệt kê trong `Files:` của từng task.
- KHÔNG xoá theme gruvbox/one-dark hay đổi default theme.
- File nào bị modified mà không nằm trong `Files:` của task → revert trước khi commit.

### Map design → code (tham chiếu nhanh)

| Design (ui-design/) | Code thật (gui/src/) |
|---|---|
| `.actbar` 48px | `ActivityBar.svelte` (w-16, giữ size hiện tại) |
| `.sidebar` session list | `SessionSidebar.svelte` |
| `.topbar` + `#proj-switcher` | `TopBar.svelte` |
| `#view-overview` | `lib/views/OverviewView.svelte` |
| `#view-projects` | **CHƯA CÓ** → Phase 2 tạo `lib/views/ProjectsView.svelte` |
| `#view-profiles` | `lib/views/ProfilesView.svelte` |
| `#view-settings` (4 tabs) | `lib/views/SettingsView.svelte` (hiện scroll sections) |
| `#session-drawer` | `Inspector.svelte` (hiện là split-pane, Phase 3 quyết giữ pane) |
| `#palette` ⌘K | `CommandPalette.svelte` |
| `#confirm-dialog` | `ConfirmDialog.svelte` |
| `#toast-container` | `Toaster.svelte` + `toasts.svelte.ts` |
| `state.tweaks{theme,density,accent}` | `theme.svelte.ts` + `settings.ts` density + **accent CHƯA CÓ** |
| localStorage `agentry:*` | đã dùng convention giống nhau |

### Khác biệt design ↔ code ĐÃ QUYẾT (không bàn lại)

1. **Theme**: design dùng shadcn zinc (dark default + light) + 4 accent. Code có gruvbox + one-dark. Quyết định: **THÊM** `dark` (zinc) + `light` vào hệ hiện có → 4 theme tổng; thêm accent picker 4 màu. Gruvbox vẫn là default (đừng đổi — user hiện tại đang dùng).
2. **Inspector**: design là drawer overlay; code là split-pane resize được. Quyết định: **GIỮ split-pane** (tốt hơn cho desktop), chỉ bổ sung nội dung thiếu (timeline, project row click-to-switch).
3. **Activity bar 48px design vs w-16 (64px) code**: giữ 64px hiện tại, không co.
4. **Mobile responsive** (bottom-nav @640px trong design): **BỎ QUA** — Tauri desktop app, không cần.
5. **9Router**: design + code đều có, không đổi gì.
