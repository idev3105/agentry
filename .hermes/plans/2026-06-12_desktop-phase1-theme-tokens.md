# Desktop Phase 1 — Theme Tokens & Accent Picker (Junior Edition)

> **For implementer:** Đọc INDEX (`2026-06-12_desktop-INDEX.md`) trước khi bắt đầu. Mỗi task = 1 commit, làm đúng thứ tự T1.1 → T1.6. Sau mỗi task chạy `cd gui && pnpm check` — phải `0 errors`, tối đa `1 warning` (warning `node types` trong tsconfig là pre-existing, KHÔNG sửa).

## Mục tiêu phase

Hệ theme hiện tại: `gruvbox` (default — KHÔNG đổi) + `one-dark`. Tailwind v4 sinh utility classes (`bg-background`, `text-foreground`, `text-gruvbox-*`…) từ block `@theme inline` trong `gui/src/app.css`. Mỗi theme override **giá trị** của các `--color-*` đó lúc runtime qua selector `:root[data-theme="..."]`. Utility classes vẫn hợp lệ vì tên var không đổi.

Phase 1 thêm:
1. Theme `dark` (shadcn zinc dark).
2. Theme `light` (shadcn zinc light).
3. Accent picker: `default` / `teal` / `violet` / `amber` (override `--color-accent`).
4. UI chọn theme + accent trong Settings.
5. Bảng màu xterm cho 2 theme mới.

**Nguyên tắc vàng:** chỉ thêm selector `:root[data-theme="..."]` / `:root[data-accent="..."]` mới. KHÔNG sửa block `@theme inline` (nếu thêm var ngoài `@theme inline` mà tưởng nó sinh utility → utility biến mất → cả app mất màu).

---

## T1.1 — app.css: thêm theme `dark` (shadcn zinc)

**Risk:** low · **Time:** ~45m

### Vấn đề / Mục tiêu
Thêm block override `:root[data-theme="dark"]` map các `--color-*` sang palette shadcn zinc dark. Bắt chước y hệt cấu trúc block `one-dark` đã có (dòng 52–94).

### Files
- Modify: `gui/src/app.css`

### Changes

**1. Chèn block `dark` ngay sau block `one-dark` (sau dòng 94, trước comment Density dòng 96).**

Before (dòng 94–96 hiện tại):
```css
  --color-accent-info:   #61afef;
}

/* Density — switched via data-density attribute on root <div> in +page.svelte.
```

After:
```css
  --color-accent-info:   #61afef;
}

/* Dark (shadcn zinc) — runtime override via data-theme attribute on <html>.
   Same --color-* var names so all utility classes update automatically. */
:root[data-theme="dark"] {
  /* bg */
  --color-background:    #09090b;
  --color-card:          #18181b;
  --color-secondary:     #27272a;
  --color-muted:         #27272a;
  --color-border:        #27272a;
  --color-input:         #18181b;
  --color-popover:       #18181b;

  /* fg */
  --color-foreground:             #fafafa;
  --color-card-foreground:        #fafafa;
  --color-popover-foreground:     #fafafa;
  --color-secondary-foreground:   #fafafa;
  --color-muted-foreground:       #a1a1aa;
  --color-accent:                 #3b82f6;
  --color-accent-foreground:      #ffffff;

  /* primary */
  --color-primary:            #fafafa;
  --color-primary-foreground: #18181b;

  /* semantic */
  --color-destructive:            #ef4444;
  --color-destructive-foreground: #fafafa;

  /* zinc-friendly accent palette (mapped to gruvbox var names for compatibility) */
  --color-gruvbox-yellow:  #eab308;
  --color-gruvbox-green:   #22c55e;
  --color-gruvbox-aqua:    #2dd4bf;
  --color-gruvbox-blue:    #3b82f6;
  --color-gruvbox-orange:  #f97316;
  --color-gruvbox-purple:  #8b5cf6;
  --color-gruvbox-red:     #ef4444;
  --color-gruvbox-gray:    #71717a;

  /* semantic status overrides */
  --color-accent-ok:     #22c55e;
  --color-accent-warn:   #eab308;
  --color-accent-error:  #ef4444;
  --color-accent-info:   #3b82f6;
}

/* Density — switched via data-density attribute on root <div> in +page.svelte.
```

### Verify
```bash
cd gui && pnpm check
```
Expected: `0 errors`. (CSS không phải TS nên check không bắt; verify mắt thường: theme `dark` sẽ test ở T1.6.)
**If fail:** lỗi check thường do file khác — `git diff gui/src/app.css` xác nhận chỉ thêm block, không xoá nhầm `}`.

### Commit
```bash
git add gui/src/app.css && git commit -m "feat(theme): add shadcn zinc dark theme tokens"
```

---

## T1.2 — app.css: thêm theme `light` (shadcn zinc light)

**Risk:** low · **Time:** ~40m

### Vấn đề / Mục tiêu
Thêm block `:root[data-theme="light"]` nền sáng. Gruvbox-* map sang tông đậm hơn để đọc được trên nền trắng.

### Files
- Modify: `gui/src/app.css`

### Changes

**1. Chèn block `light` ngay sau block `dark` vừa thêm ở T1.1 (trước comment Density).**

Before (cuối block `dark`):
```css
  --color-accent-info:   #3b82f6;
}

/* Density — switched via data-density attribute on root <div> in +page.svelte.
```

After:
```css
  --color-accent-info:   #3b82f6;
}

/* Light (shadcn zinc) — runtime override via data-theme attribute on <html>. */
:root[data-theme="light"] {
  /* bg */
  --color-background:    #ffffff;
  --color-card:          #fafafa;
  --color-secondary:     #f4f4f5;
  --color-muted:         #f4f4f5;
  --color-border:        #e4e4e7;
  --color-input:         #ffffff;
  --color-popover:       #ffffff;

  /* fg */
  --color-foreground:             #09090b;
  --color-card-foreground:        #09090b;
  --color-popover-foreground:     #09090b;
  --color-secondary-foreground:   #18181b;
  --color-muted-foreground:       #71717a;
  --color-accent:                 #2563eb;
  --color-accent-foreground:      #ffffff;

  /* primary */
  --color-primary:            #18181b;
  --color-primary-foreground: #fafafa;

  /* semantic */
  --color-destructive:            #dc2626;
  --color-destructive-foreground: #ffffff;

  /* darker accent palette for light bg (mapped to gruvbox var names) */
  --color-gruvbox-yellow:  #ca8a04;
  --color-gruvbox-green:   #16a34a;
  --color-gruvbox-aqua:    #0d9488;
  --color-gruvbox-blue:    #2563eb;
  --color-gruvbox-orange:  #ea580c;
  --color-gruvbox-purple:  #7c3aed;
  --color-gruvbox-red:     #dc2626;
  --color-gruvbox-gray:    #71717a;

  /* semantic status overrides */
  --color-accent-ok:     #16a34a;
  --color-accent-warn:   #ca8a04;
  --color-accent-error:  #dc2626;
  --color-accent-info:   #2563eb;
}

/* Density — switched via data-density attribute on root <div> in +page.svelte.
```

### Verify
```bash
cd gui && pnpm check
```
Expected: `0 errors`.
**If fail:** `git diff gui/src/app.css` — kiểm tra dấu `{`/`}` cân, không vô tình lồng block.

### Commit
```bash
git add gui/src/app.css && git commit -m "feat(theme): add shadcn zinc light theme tokens"
```

---

## T1.3 — app.css accent overrides + theme.svelte.ts accent store

**Risk:** medium · **Time:** ~1h

### Vấn đề / Mục tiêu
1. Thêm accent override CSS (`teal` / `violet` / `amber`) — chỉ override `--color-accent` + `--color-accent-foreground`. `default` = giữ giá trị accent của theme.
2. Mở rộng `Theme` type sang 4 giá trị + thêm `accent` store cùng pattern `$effect.root`.

### Files
- Modify: `gui/src/app.css`
- Modify: `gui/src/lib/stores/theme.svelte.ts`

### Changes

**1. app.css — chèn accent block sau block `light` vừa thêm (trước comment Density).**

After (chèn ngay trước `/* Density …`):
```css
/* Accent overrides — runtime via data-accent attribute on <html>.
   data-accent absent OR "default" → accent stays at the theme's own value. */
:root[data-accent="teal"] {
  --color-accent:            #2f9e6e;
  --color-accent-foreground: #ffffff;
}
:root[data-accent="violet"] {
  --color-accent:            #8b5cf6;
  --color-accent-foreground: #ffffff;
}
:root[data-accent="amber"] {
  --color-accent:            #d97706;
  --color-accent-foreground: #ffffff;
}

/* Density — switched via data-density attribute on root <div> in +page.svelte.
```

**2. theme.svelte.ts — mở rộng Theme type + thêm accent store.**

Before (toàn bộ file):
```ts
const KEY = 'agentry:theme';
export type Theme = 'gruvbox' | 'one-dark';

function createTheme() {
	const saved = typeof localStorage !== 'undefined' ? localStorage.getItem(KEY) : null;
	let cur = $state<Theme>((saved as Theme) ?? 'gruvbox');

	// $effect.root() creates its own owner — safe to call at module level in .svelte.ts
	$effect.root(() => {
		$effect(() => {
			if (typeof document !== 'undefined') {
				document.documentElement.dataset.theme = cur;
			}
			if (typeof localStorage !== 'undefined') {
				localStorage.setItem(KEY, cur);
			}
		});
	});

	return {
		get value() { return cur; },
		set(t: Theme) { cur = t; }
	};
}

export const theme = createTheme();
```

After:
```ts
const KEY = 'agentry:theme';
const ACCENT_KEY = 'agentry:accent';
export type Theme = 'gruvbox' | 'one-dark' | 'dark' | 'light';
export type Accent = 'default' | 'teal' | 'violet' | 'amber';

function createTheme() {
	const saved = typeof localStorage !== 'undefined' ? localStorage.getItem(KEY) : null;
	let cur = $state<Theme>((saved as Theme) ?? 'gruvbox');

	// $effect.root() creates its own owner — safe to call at module level in .svelte.ts
	$effect.root(() => {
		$effect(() => {
			if (typeof document !== 'undefined') {
				document.documentElement.dataset.theme = cur;
			}
			if (typeof localStorage !== 'undefined') {
				localStorage.setItem(KEY, cur);
			}
		});
	});

	return {
		get value() { return cur; },
		set(t: Theme) { cur = t; }
	};
}

function createAccent() {
	const saved = typeof localStorage !== 'undefined' ? localStorage.getItem(ACCENT_KEY) : null;
	let cur = $state<Accent>((saved as Accent) ?? 'default');

	$effect.root(() => {
		$effect(() => {
			if (typeof document !== 'undefined') {
				// xoá attr khi 'default' — tránh để rác `data-accent="default"` trên DOM
				if (cur === 'default') {
					delete document.documentElement.dataset.accent;
				} else {
					document.documentElement.dataset.accent = cur;
				}
			}
			if (typeof localStorage !== 'undefined') {
				localStorage.setItem(ACCENT_KEY, cur);
			}
		});
	});

	return {
		get value() { return cur; },
		set(a: Accent) { cur = a; }
	};
}

export const theme = createTheme();
export const accent = createAccent();
```

### Verify
```bash
cd gui && pnpm check
```
Expected: `0 errors`. Type `Accent` được export, không lỗi.
**If fail (`effect_orphan`):** nghĩa là `$effect` đặt ngoài `$effect.root` — kiểm tra `createAccent` bọc đúng `$effect.root(() => { $effect(...) })`.

### Commit
```bash
git add gui/src/app.css gui/src/lib/stores/theme.svelte.ts && git commit -m "feat(theme): add accent overrides + accent runes store"
```

---

## T1.4 — SettingsView: 4 theme buttons + Accent section

**Risk:** low · **Time:** ~45m

### Vấn đề / Mục tiêu
Theme section hiện hard-code 2 theme. Đổi sang 4 theme + thêm section Accent với 4 swatch.

### Files
- Modify: `gui/src/lib/views/SettingsView.svelte`

### Changes

**1. Import thêm `accent` + type. **

Before (dòng 4):
```svelte
	import { theme } from '$lib/stores/theme.svelte';
```

After:
```svelte
	import { theme, accent, type Theme, type Accent } from '$lib/stores/theme.svelte';
```

**2. Thay Theme section (dòng 115–123) + thêm Accent section ngay sau.**

Before:
```svelte
		<section class="bg-card border border-border rounded p-4 space-y-3">
			<h2 class="text-sm font-semibold">Theme</h2>
			<div class="flex gap-2">
				{#each ['gruvbox','one-dark'] as t}
					<button class={cn('px-3 py-1.5 rounded text-xs border focus-visible:ring-1 focus-visible:ring-gruvbox-yellow focus-visible:outline-none', theme.value === t ? 'border-gruvbox-yellow bg-secondary' : 'border-border hover:border-secondary')}
							onclick={() => theme.set(t as 'gruvbox' | 'one-dark')}>{t}</button>
				{/each}
			</div>
		</section>
```

After:
```svelte
		<section class="bg-card border border-border rounded p-4 space-y-3">
			<h2 class="text-sm font-semibold">Theme</h2>
			<div class="flex gap-2 flex-wrap">
				{#each (['gruvbox', 'one-dark', 'dark', 'light'] as Theme[]) as t (t)}
					<button class={cn('px-3 py-1.5 rounded text-xs border focus-visible:ring-1 focus-visible:ring-gruvbox-yellow focus-visible:outline-none', theme.value === t ? 'border-gruvbox-yellow bg-secondary' : 'border-border hover:border-secondary')}
							onclick={() => theme.set(t)}>{t}</button>
				{/each}
			</div>
		</section>

		<section class="bg-card border border-border rounded p-4 space-y-3">
			<h2 class="text-sm font-semibold">Accent</h2>
			<div class="flex gap-2 flex-wrap">
				{#each (['default', 'teal', 'violet', 'amber'] as Accent[]) as a (a)}
					<button
						class={cn('flex items-center gap-2 px-3 py-1.5 rounded text-xs border focus-visible:ring-1 focus-visible:ring-gruvbox-yellow focus-visible:outline-none', accent.value === a ? 'border-gruvbox-yellow bg-secondary' : 'border-border hover:border-secondary')}
						onclick={() => accent.set(a)}
					>
						<span
							class="w-3 h-3 rounded-full border border-border"
							style={`background:${a === 'teal' ? '#2f9e6e' : a === 'violet' ? '#8b5cf6' : a === 'amber' ? '#d97706' : 'var(--color-accent)'}`}
						></span>
						{a}
					</button>
				{/each}
			</div>
		</section>
```

### Verify
```bash
cd gui && pnpm check
```
Expected: `0 errors`, ≤1 warning pre-existing.
**If fail (`Cannot find name 'Accent'`):** kiểm tra import dòng 4 đã thêm `type Theme, type Accent`.

### Commit
```bash
git add gui/src/lib/views/SettingsView.svelte && git commit -m "feat(settings): 4-theme picker + accent swatches"
```

---

## T1.5 — TerminalView: bảng xterm theme cho `dark` + `light`

**Risk:** medium · **Time:** ~1h

### Vấn đề / Mục tiêu
`gui/src/lib/components/TerminalView.svelte` có map `THEMES` (dòng 134–181) với 2 key `gruvbox` / `'one-dark'`, và `$effect` apply theme (dòng 183–186) cast cứng `theme.value as 'gruvbox' | 'one-dark'` → chọn theme mới sẽ ra `undefined` → xterm rơi về default. Thêm 2 bảng + bỏ cast cứng.

### Files
- Modify: `gui/src/lib/components/TerminalView.svelte`

### Changes

**1. Thêm 2 entry `dark` / `light` vào `THEMES`.**

Before (dòng 158–181 — cuối entry `'one-dark'` và đóng object):
```ts
		'one-dark': {
			background:    '#282c34',
			foreground:    '#abb2bf',
			cursor:        '#e06c75',
			cursorAccent:  '#282c34',
			selectionBackground: '#3a3f4b',
			black:         '#282c34',
			red:           '#e06c75',
			green:         '#98c379',
			yellow:        '#e5c07b',
			blue:          '#61afef',
			magenta:       '#c678dd',
			cyan:          '#56b6c2',
			white:         '#abb2bf',
			brightBlack:   '#5c6370',
			brightRed:     '#e06c75',
			brightGreen:   '#98c379',
			brightYellow:  '#e5c07b',
			brightBlue:    '#61afef',
			brightMagenta: '#c678dd',
			brightCyan:    '#56b6c2',
			brightWhite:   '#fff',
		}
	};
```

After:
```ts
		'one-dark': {
			background:    '#282c34',
			foreground:    '#abb2bf',
			cursor:        '#e06c75',
			cursorAccent:  '#282c34',
			selectionBackground: '#3a3f4b',
			black:         '#282c34',
			red:           '#e06c75',
			green:         '#98c379',
			yellow:        '#e5c07b',
			blue:          '#61afef',
			magenta:       '#c678dd',
			cyan:          '#56b6c2',
			white:         '#abb2bf',
			brightBlack:   '#5c6370',
			brightRed:     '#e06c75',
			brightGreen:   '#98c379',
			brightYellow:  '#e5c07b',
			brightBlue:    '#61afef',
			brightMagenta: '#c678dd',
			brightCyan:    '#56b6c2',
			brightWhite:   '#fff',
		},
		dark: {
			background:    '#09090b',
			foreground:    '#fafafa',
			cursor:        '#fafafa',
			cursorAccent:  '#09090b',
			selectionBackground: '#27272a',
			black:         '#18181b',
			red:           '#ef4444',
			green:         '#22c55e',
			yellow:        '#eab308',
			blue:          '#3b82f6',
			magenta:       '#8b5cf6',
			cyan:          '#2dd4bf',
			white:         '#a1a1aa',
			brightBlack:   '#71717a',
			brightRed:     '#f87171',
			brightGreen:   '#4ade80',
			brightYellow:  '#facc15',
			brightBlue:    '#60a5fa',
			brightMagenta: '#a78bfa',
			brightCyan:    '#5eead4',
			brightWhite:   '#fafafa',
		},
		light: {
			background:    '#ffffff',
			foreground:    '#09090b',
			cursor:        '#09090b',
			cursorAccent:  '#ffffff',
			selectionBackground: '#e4e4e7',
			black:         '#09090b',
			red:           '#dc2626',
			green:         '#16a34a',
			yellow:        '#ca8a04',
			blue:          '#2563eb',
			magenta:       '#7c3aed',
			cyan:          '#0d9488',
			white:         '#71717a',
			brightBlack:   '#52525b',
			brightRed:     '#ef4444',
			brightGreen:   '#22c55e',
			brightYellow:  '#eab308',
			brightBlue:    '#3b82f6',
			brightMagenta: '#8b5cf6',
			brightCyan:    '#14b8a6',
			brightWhite:   '#18181b',
		}
	};
```

**2. Bỏ cast cứng trong `$effect` apply theme.**

Before (dòng 183–186):
```ts
	$effect(() => {
		if (!term) return;
		term.options.theme = THEMES[theme.value as 'gruvbox' | 'one-dark'];
	});
```

After:
```ts
	$effect(() => {
		if (!term) return;
		term.options.theme = THEMES[theme.value];
	});
```

(Sau khi `Theme` type mở rộng ở T1.3 và `THEMES` đủ 4 key, index `THEMES[theme.value]` type-check sạch không cần cast.)

### Verify
```bash
cd gui && pnpm check
```
Expected: `0 errors`.
**If fail (`Element implicitly has an 'any' type` khi index THEMES):** kiểm tra 4 key của `THEMES` trùng đúng 4 giá trị của `Theme` (`gruvbox`, `'one-dark'`, `dark`, `light`) — thiếu key nào TS sẽ báo.

### Commit
```bash
git add gui/src/lib/components/TerminalView.svelte && git commit -m "feat(terminal): xterm palettes for dark/light themes"
```

---

## T1.6 — Verify cuối phase

**Risk:** low · **Time:** ~30m

### Vấn đề / Mục tiêu
Xác nhận build sạch và utilities Tailwind còn sống sau khi sửa app.css.

### Files
- Không sửa file nào. Task verify-only, không commit code (nếu phát hiện lỗi → fix trong task gây lỗi, amend commit đó).

### Changes / Steps

**1. Type check + build:**
```bash
cd gui && pnpm check && pnpm build
```
Expected: check `0 errors`; build xanh không lỗi.

**2. Grep CSS output xác nhận utilities còn sống:**
```bash
grep -l "bg-background" gui/.svelte-kit/output/client/_app/immutable/assets/*.css || true
```
Expected: in ra ÍT NHẤT 1 đường dẫn file css. Nếu KHÔNG in gì → utilities đã biến mất → có khai báo `--color-*` mới đặt nhầm **trong** `@theme inline` hoặc xoá nhầm var trong đó — `git diff gui/src/app.css` so với T1.1–T1.3.

**3. Manual test:**
```bash
cd gui && pnpm tauri dev
```
- Settings → Theme: bấm lần lượt `gruvbox` / `one-dark` / `dark` / `light` → toàn app đổi màu tức thì, terminal đổi bảng màu theo.
- Settings → Accent: bấm `default` / `teal` / `violet` / `amber` → các nút primary/accent đổi màu. `default` trả về accent gốc của theme.
- Restart app → theme + accent giữ nguyên (localStorage `agentry:theme` / `agentry:accent`).

### Commit
Không có (verify-only). Nếu mọi thứ xanh:
```bash
git log --oneline -5   # xác nhận 5 commit T1.1→T1.5 đúng thứ tự
```

---

## Phạm vi nghiêm ngặt — KHÔNG làm

- KHÔNG đụng `crates/` (wire, daemon, cli), `gui/src-tauri/`.
- KHÔNG sửa block `@theme inline` trong `app.css` — chỉ THÊM selector override bên dưới.
- KHÔNG đổi default theme (`gruvbox` vẫn là fallback khi localStorage trống).
- KHÔNG refactor store writable (Svelte 4) sang runes — chỉ `theme.svelte.ts` vốn đã là runes.
- KHÔNG sửa warning pre-existing trong tsconfig (node types).
- File ngoài danh sách Files của từng task mà bị thay đổi → `git checkout -- <file>` revert ngay.

## Troubleshooting

| Lỗi | Nguyên nhân / Fix |
|---|---|
| Utilities (`bg-background`…) biến mất, app trắng/mất màu | Khai báo var mới đặt nhầm vị trí làm hỏng `@theme inline`, hoặc thiếu `}` đóng block. `git diff gui/src/app.css`, đếm cặp ngoặc. |
| `effect_orphan` runtime error | `$effect` gọi ở module level mà không bọc `$effect.root` — xem mẫu `createTheme()`. |
| `pnpm check` lỗi `Cannot find module '$lib/...'` | Sai đường dẫn import — alias `$lib` = `gui/src/lib`. Chạy `npx svelte-kit sync` nếu vừa clone. |
| TS lỗi index `THEMES[theme.value]` | `THEMES` thiếu key cho 1 trong 4 theme, hoặc còn sót cast `as 'gruvbox' \| 'one-dark'` cũ. |
| Accent không đổi gì khi bấm | `document.documentElement.dataset.accent` chưa set (check Elements tab: `<html data-accent="teal">`), hoặc selector CSS gõ sai `:root[data-accent="teal"]`. |
| Theme light chữ trắng trên nền trắng | Component nào đó hard-code màu hex thay vì dùng var/utility — KHÔNG fix trong phase này, ghi chú lại báo lead. |
