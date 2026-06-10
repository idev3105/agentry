1|1|1|1|# 9Router Embedded Dashboard — Implementation Plan (Junior Edition)
2|2|2|2|
3|3|3|3|> **For implementer:** Plan này nối tiếp plan trước (`2026-06-08_231532-9router-lifecycle.md`). Yêu cầu các Tauri command `r9_status` / `r9_start` / `r9_stop` đã có và hoạt động. Đọc hết "Onboarding" trước khi bắt đầu Task 1. Mỗi task = 1 commit, đúng thứ tự T1 → T5, KHÔNG nhảy task. Sau mỗi task: `mise run check` không tăng số lỗi clippy so với baseline (0), `pnpm check` xanh, GUI chạy được.
4|4|4|4|
5|5|5|5|**Goal:** Mở dashboard 9Router (`http://localhost:20128`) **bên trong cửa sổ Agentry** — không spawn external browser nữa. User click vào tab "9Router" trên ActivityBar → thấy dashboard nhúng trong main window.
6|6|6|6|
7|7|7|7|**Architecture:** Đơn giản — dùng `<iframe src="http://localhost:20128">` trong một Svelte view mới. Verify trước rằng dashboard KHÔNG có header `X-Frame-Options` / `Content-Security-Policy: frame-ancestors` chặn iframe (đã verify: 9Router Next.js KHÔNG có, OK). Thêm view mới vào `View` enum, thêm icon vào ActivityBar, render iframe khi view active. Auto-start 9Router lifecycle khi mở tab nếu chưa chạy.
8|8|8|8|
9|9|9|9|**Tech stack:** Svelte 5 runes, Tauri v2, Lucide icons. **KHÔNG đụng Rust shim** — iframe là fully frontend feature. **KHÔNG dùng `Webview` child API của Tauri** (multi-webview phức tạp, không cần thiết cho dashboard nội bộ trên localhost).
10|10|10|10|
11|11|11|11|**Repo:** `/Users/idev/Documents/projects/agentry`.
12|12|12|12|
13|13|13|13|---
14|14|14|14|
15|15|15|15|## Bối cảnh & giả định hiện tại
16|16|16|16|
17|17|17|17|1. **Plan trước đã merge.** Các file sau đã có và xanh:
18|18|18|18|   - `gui/src-tauri/src/r9.rs`
19|19|19|19|   - Tauri commands `r9_status`, `r9_start`, `r9_stop`, `r9_open_dashboard`
20|20|20|20|   - `gui/src/lib/stores/r9.svelte.ts` với `r9.startPolling()`, `r9.start()`, `r9.stop()`, `r9.openDashboard()`
21|21|21|21|   - Section 9Router trong `SettingsView.svelte` (vẫn giữ — nơi user start/stop và xem status; tab mới chỉ thêm phần xem dashboard).
22|22|22|22|2. **Iframe khả thi.** Đã `curl -I http://localhost:20128/login` → KHÔNG có `X-Frame-Options` hoặc `Content-Security-Policy: frame-ancestors`. Nếu sau này 9Router cập nhật và thêm header này, iframe sẽ trắng. Phải fallback sang external (xem Task 5 — graceful degradation).
23|23|23|23|3. **Phạm vi nghiêm ngặt — KHÔNG làm:**
24|24|24|24|   - KHÔNG dùng Tauri `Webview` child API (multi-webview).
25|25|25|25|   - KHÔNG dùng `<webview>` HTML5 tag (không support trong Tauri WebKit).
26|26|26|26|   - KHÔNG xoá nút "Open Dashboard" ở SettingsView (giữ làm fallback nếu iframe lỗi).
27|27|27|27|   - KHÔNG đụng `crates/wire`, `daemon/`, `gui/src-tauri/`. **Hoàn toàn frontend.**
28|28|28|28|4. **Conventions:** Svelte 5 runes (`$state`, `$derived`, `$effect`). Comment code: English. Plan body: tiếng Việt OK. Commit format: `feat(...)` / `fix(...)`.
29|29|29|29|
30|30|30|30|---
31|31|31|31|
32|32|32|32|## Onboarding — đọc trước khi bắt đầu (10 phút)
33|33|33|33|
34|34|34|34|### Reading order
35|35|35|35|
36|36|36|36|1. `gui/src/lib/stores/ui.ts` — `View` type và `setView()`. Sẽ thêm `'r9'` vào enum.
37|37|37|37|2. `gui/src/lib/components/ActivityBar.svelte` — danh sách tab + icon. Sẽ thêm 1 entry.
38|38|38|38|3. `gui/src/routes/+page.svelte` dòng 549-630 — block `{#if $ui.view === '...'}` switch giữa các view. Sẽ thêm nhánh mới.
39|39|39|39|4. `gui/src/lib/views/SettingsView.svelte` — tham khảo cách dùng `r9` store và polling pattern.
40|40|40|40|5. `gui/src/lib/stores/r9.svelte.ts` — API có sẵn. **KHÔNG sửa file này.**
41|41|41|41|
42|42|42|42|### Common commands
43|43|43|43|
44|44|44|44|| Command | Tác dụng |
45|45|45|45||---|---|
46|46|46|46|| `mise run dev` | Build + chạy daemon + Tauri |
47|47|47|47|| `mise run tauri` | Chỉ chạy frontend + Tauri shim (không build daemon) |
48|48|48|48|| `mise run check` | Clippy + svelte-check |
49|49|49|49|| `cd gui && pnpm check` | Svelte-check riêng |
50|50|50|50|| `npm i -g 9router && 9router` | Chạy 9Router để test (foreground, Ctrl+C để dừng) |
51|51|51|51|| `curl -I http://localhost:20128/login` | Verify dashboard không chặn iframe |
52|52|52|52|
53|53|53|53|### Bug-to-task mapping
54|54|54|54|
55|55|55|55|| # | Mục tiêu | Task |
56|56|56|56||---|---|---|
57|57|57|57|| 1 | Thêm `'r9'` vào `View` enum | T1 |
58|58|58|58|| 2 | Thêm tab 9Router vào ActivityBar | T2 |
59|59|59|59|| 3 | Tạo `R9DashboardView.svelte` (iframe wrapper + auto-start) | T3 |
60|60|60|60|| 4 | Wire vào `+page.svelte` | T4 |
61|61|61|61|| 5 | Graceful degradation (loading / error / fallback to external) | T5 |
62|62|62|62|
63|63|63|63|### Foot-gun callouts
64|64|64|64|
65|65|65|65|- **Iframe và auto-start race:** Nếu user click tab "9Router" khi 9Router chưa chạy, iframe load `http://localhost:20128` sẽ fail (`net::ERR_CONNECTION_REFUSED`). Phải check `r9.status.running` TRƯỚC khi render iframe, gọi `r9.start()` nếu chưa chạy, đợi `running=true`, rồi mới gắn `src`. Nếu không, iframe sẽ cache lỗi và phải reload thủ công.
66|66|66|66|- **Iframe key thay vì reload:** Khi 9Router restart (stop → start), iframe vẫn giữ src cũ và có thể stuck. Dùng `{#key reloadCounter}` hoặc reset `src` để force re-mount khi state đổi từ `running=false` → `running=true`.
67|67|67|67|- **Polling tăng tải khi iframe load:** `r9.startPolling()` đang chạy 2s/lần ở SettingsView (qua `onMount`). Khi user vào tab `r9`, gọi `startPolling()` thêm sẽ KHÔNG nhân đôi (idempotent — đã có `if (pollTimer) return;` trong store), nhưng cần `stopPolling()` ở `onDestroy` của view nào? **Trả lời:** KHÔNG cần stop ở R9DashboardView — SettingsView vẫn có thể stop polling khi unmount, mất polling nếu user chỉ mở tab r9 không qua Settings. Giải pháp đơn giản: cả 2 view đều `startPolling()` ở `onMount`, KHÔNG `stopPolling()` ở `onDestroy` (polling tiếp tục cả khi rời tab — chi phí thấp, status badge ở SettingsView luôn fresh). **Action:** sửa SettingsView trong T5.
68|68|68|68|- **CSP chưa set, sau này set sẽ block iframe:** `tauri.conf.json` hiện không có `app.security.csp`. Nếu sau này thêm CSP strict, phải allow `frame-src http://localhost:20128` và `connect-src http://localhost:20128`. Plan này không thêm CSP — chỉ ghi chú.
69|69|69|69|- **`http://localhost` vs `http://127.0.0.1`:** dùng đúng `localhost` (cùng với `r9::R9_DASHBOARD_URL` trong Rust). Tauri WebKit có thể coi 2 origin khác nhau cho cookie/storage.
70|70|70|70|- **Tauri webview KHÔNG block mixed content khi Tauri devUrl là `http://localhost:5173`** (dev). Production build dùng `tauri://localhost` → load `http://localhost:20128` từ tauri:// scheme có thể bị block bởi mixed-content nếu `tauri.conf.json` set CSP `upgrade-insecure-requests`. Hiện chưa có CSP → OK. Nếu prod build fail iframe, kiểm tra phần này.
71|71|71|71|
72|72|72|---
73|73|73|
74|74|74|## Task 1: Thêm `'r9'` vào `View` enum
75|75|75|
76|76|76|**Risk:** low
77|77|77|**Time:** ~5 phút
78|78|78|
79|79|79|### Files
80|80|80|
81|81|81|- Modify: `gui/src/lib/stores/ui.ts:3`
82|82|82|
83|83|83|### Changes
84|84|84|
85|85|85|#### 1.1 Mở rộng `View` type
86|86|86|
87|87|87|`gui/src/lib/stores/ui.ts` dòng 3 hiện tại:
88|88|88|
89|89|89|**Before:**
90|90|90|```ts
91|91|91|export type View = 'terminal' | 'profiles' | 'settings' | 'overview';
92|92|92|```
93|93|93|
94|94|94|**After:**
95|95|95|```ts
96|96|96|export type View = 'terminal' | 'profiles' | 'settings' | 'overview' | 'r9';
97|97|97|```
98|98|98|
99|99|99|KHÔNG cần thay đổi gì khác trong file này — `setView(view: View)` đã typed generic, tự nhận giá trị mới.
100|100|100|
101|101|101|### Verify
102|102|102|
103|103|103|```bash
104|104|104|cd gui && pnpm check 2>&1 | tail -5
105|105|105|```
106|106|106|
107|107|107|Expected: 0 errors. Có thể có warning compile mới ở `ActivityBar.svelte` / `+page.svelte` báo "missing case in if/else" — sẽ fix ở T2 và T4.
108|108|108|
109|109|109|**If fail:**
110|110|110|- Pre-existing baseline 8 warnings — nếu thấy 9, là task này gây ra. Đọc kỹ.
111|111|111|
112|112|112|### Commit
113|113|113|
114|114|114|```bash
115|115|115|git add gui/src/lib/stores/ui.ts
116|116|116|git commit -m "feat(ui): add 'r9' to View enum"
117|117|117|```
118|118|118|
119|119|119|---
120|120|120|
121|121|121|## Task 2: Thêm tab 9Router vào ActivityBar
122|122|122|
123|123|123|**Risk:** low
124|124|124|**Time:** ~10 phút
125|125|125|
126|126|126|### Files
127|127|127|
128|128|128|- Modify: `gui/src/lib/components/ActivityBar.svelte`
129|129|129|
130|130|130|### Changes
131|131|131|
132|132|132|#### 2.1 Import icon mới + thêm vào `items`
133|133|133|
134|134|134|`gui/src/lib/components/ActivityBar.svelte` dòng 1-16:
135|135|135|
136|136|136|**Before:**
137|137|137|```svelte
138|138|138|<script lang="ts">
139|139|139|	import Home from '@lucide/svelte/icons/home';
140|140|140|	import Folders from '@lucide/svelte/icons/folders';
141|141|141|	import User from '@lucide/svelte/icons/user-cog';
142|142|142|	import Settings from '@lucide/svelte/icons/settings';
143|143|143|	import Plus from '@lucide/svelte/icons/plus';
144|144|144|	import { ui, setView, openWizard } from '$lib/stores/ui';
145|145|145|	import { cn } from '$lib/utils/cn';
146|146|146|	import type { View } from '$lib/stores/ui';
147|147|147|
148|148|148|	const items: { id: View; icon: typeof Home; label: string; shortcut?: string }[] = [
149|149|149|		{ id: 'overview', icon: Home, label: 'Overview' },
150|150|150|		{ id: 'terminal', icon: Folders, label: 'Sessions' },
151|151|151|		{ id: 'profiles', icon: User, label: 'Profiles' },
152|152|152|		{ id: 'settings', icon: Settings, label: 'Settings' }
153|153|153|	];
154|154|154|</script>
155|155|155|```
156|156|156|
157|157|157|**After:**
158|158|158|```svelte
159|159|159|<script lang="ts">
160|160|160|	import Home from '@lucide/svelte/icons/home';
161|161|161|	import Folders from '@lucide/svelte/icons/folders';
162|162|162|	import User from '@lucide/svelte/icons/user-cog';
163|163|163|	import Settings from '@lucide/svelte/icons/settings';
164|164|164|	import Router from '@lucide/svelte/icons/router';
165|165|165|	import Plus from '@lucide/svelte/icons/plus';
166|166|166|	import { ui, setView, openWizard } from '$lib/stores/ui';
167|167|167|	import { r9 } from '$lib/stores/r9.svelte';
168|168|168|	import { cn } from '$lib/utils/cn';
169|169|169|	import type { View } from '$lib/stores/ui';
170|170|170|
171|171|171|	const items: { id: View; icon: typeof Home; label: string; shortcut?: string }[] = [
172|172|172|		{ id: 'overview', icon: Home, label: 'Overview' },
173|173|173|		{ id: 'terminal', icon: Folders, label: 'Sessions' },
174|174|174|		{ id: 'profiles', icon: User, label: 'Profiles' },
175|175|175|		{ id: 'r9', icon: Router, label: '9Router' },
176|176|176|		{ id: 'settings', icon: Settings, label: 'Settings' }
177|177|177|	];
178|178|178|</script>
179|179|179|```
180|180|180|
181|181|181|> Vị trí tab: đặt trước Settings (cuối nhóm "tools"). Logic của `View` switch ở `+page.svelte` phải khớp — sẽ làm ở T4.
182|182|182|
183|183|183|#### 2.2 (optional) Thêm dot indicator nếu 9Router đang chạy
184|184|184|
185|185|185|Sau dòng 31 hiện tại (`<item.icon size={20} />`), thêm:
186|186|186|
187|187|187|**Before:**
188|188|188|```svelte
189|189|189|		<button ...>
190|190|190|			<item.icon size={20} />
191|191|191|			{#if $ui.view === item.id}
192|192|192|				<span class="absolute left-0 top-1.5 bottom-1.5 w-0.5 bg-gruvbox-yellow rounded-r"></span>
193|193|193|			{/if}
194|194|194|```
195|195|195|
196|196|196|**After:**
197|197|197|```svelte
198|198|198|		<button ...>
199|199|199|			<item.icon size={20} />
200|200|200|			{#if item.id === 'r9' && r9.status.running}
201|201|201|				<span class="absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
202|202|202|			{/if}
203|203|203|			{#if $ui.view === item.id}
204|204|204|				<span class="absolute left-0 top-1.5 bottom-1.5 w-0.5 bg-gruvbox-yellow rounded-r"></span>
205|205|205|			{/if}
206|206|206|```
207|207|207|
208|208|208|Rationale: user nhìn ActivityBar biết được 9Router có đang chạy hay không, không phải mở tab.
209|209|209|
210|210|210|> **Foot-gun:** `r9.status.running` chỉ fresh nếu polling đang chạy. SettingsView gọi `startPolling()` lúc mount, nhưng nếu user chưa từng vào Settings, polling chưa start → dot không hiển thị đúng. Sửa ở T5 — sẽ start polling sớm hơn.
211|211|211|
212|212|212|### Verify
213|213|213|
214|214|214|```bash
215|215|215|cd gui && pnpm check 2>&1 | tail -5
216|216|216|```
217|217|217|
218|218|218|Expected: 0 errors. (Lúc này click tab "9Router" sẽ hiện trang trắng vì T4 chưa wire.)
219|219|219|
220|220|220|```bash
221|221|221|mise run tauri
222|222|222|```
223|223|223|
224|224|224|Expected: Tauri mở, ActivityBar có 5 icon (thêm Router icon giữa Profiles và Settings).
225|225|225|
226|226|226|**If fail:**
227|227|227|- "Cannot find module '@lucide/svelte/icons/router'" → check `node_modules/@lucide/svelte/icons/`. Tên icon có thể khác (`router`, `routing`, `network`). Thử thay bằng `Network` từ `@lucide/svelte/icons/network` nếu router không có.
228|228|228|
229|229|229|### Commit
230|230|230|
231|231|231|```bash
232|232|232|git add gui/src/lib/components/ActivityBar.svelte
233|233|233|git commit -m "feat(ui): add 9router tab to ActivityBar with running indicator"
234|234|234|```
235|235|235|
236|236|---
237|237|
238|238|## Task 3: Tạo `R9DashboardView.svelte` (iframe + auto-start)
239|239|
240|240|**Risk:** medium
241|241|**Time:** ~45 phút
242|242|
243|243|### Vấn đề cụ thể
244|244|
245|245|Cần một view:
246|246|- Hiển thị iframe full-height nhúng `http://localhost:20128`
247|247|- Nếu 9Router chưa chạy → hiện loading + tự động gọi `r9.start()`
248|248|- Nếu binary `missing` → hiện hướng dẫn cài + nút cài
249|249|- Nếu user click "Reload" → reset iframe (force re-mount qua `{#key}`)
250|250|- Nếu iframe load fail (network error) → hiện nút "Open in browser" làm fallback (gọi `r9.openDashboard()` đã có)
251|251|
252|252|### Approach
253|253|
254|254|Component layout:
255|255|
256|256|```
257|257|┌──────────────────────────────────────────────────────────┐
258|258|│ [9Router · running · pid 12345 · :20128]   [↻] [↗] [■]  │  ← toolbar
259|259|├──────────────────────────────────────────────────────────┤
260|260|│                                                          │
261|261|│         <iframe src="http://localhost:20128">            │
262|262|│                                                          │
263|263|└──────────────────────────────────────────────────────────┘
264|264|```
265|265|
266|266|State machine của view:
267|267|- `missing` — 9Router chưa cài → render hướng dẫn
268|268|- `starting` — đã gọi `r9.start()`, đang chờ `running` → loading spinner
269|269|- `running` — render iframe
270|270|- `error` — `lastError` có giá trị → hiện error + nút retry / open external
271|271|
272|272|### Files
273|273|
274|274|- Create: `gui/src/lib/views/R9DashboardView.svelte`
275|275|
276|276|### Changes
277|277|
278|278|#### 3.1 Tạo `gui/src/lib/views/R9DashboardView.svelte`
279|279|
280|280|```svelte
281|281|<script lang="ts">
282|282|	import { onMount } from 'svelte';
283|283|	import { r9 } from '$lib/stores/r9.svelte';
284|284|	import RotateCw from '@lucide/svelte/icons/rotate-cw';
285|285|	import ExternalLink from '@lucide/svelte/icons/external-link';
286|286|	import Square from '@lucide/svelte/icons/square';
287|287|	import Play from '@lucide/svelte/icons/play';
288|288|	import Loader2 from '@lucide/svelte/icons/loader-2';
289|289|
290|290|	const DASHBOARD_URL = 'http://localhost:20128/dashboard';
291|291|
292|292|	// Bumped to force iframe re-mount (e.g., after restart or manual reload).
293|293|	let reloadKey = $state(0);
294|294|
295|295|	// Track whether we tried to auto-start on this view mount, so we don't
296|296|	// keep calling start() in a loop if it fails.
297|297|	let triedAutoStart = $state(false);
298|298|
299|299|	onMount(() => {
300|300|		// Make sure polling is alive even if user opened this tab first.
301|301|		r9.startPolling();
302|302|	});
303|303|
304|304|	// Auto-start when user opens this view and 9router is installed but stopped.
305|305|	$effect(() => {
306|306|		if (
307|307|			!triedAutoStart &&
308|308|			r9.status.resolved !== 'missing' &&
309|309|			!r9.status.running &&
310|310|			!r9.busy
311|311|		) {
312|312|			triedAutoStart = true;
313|313|			r9.start();
314|314|		}
315|315|	});
316|316|
317|317|	// Bump reload key when 9router transitions stopped → running, so iframe
318|318|	// doesn't stay stuck on the old "connection refused" page.
319|319|	let prevRunning = $state(false);
320|320|	$effect(() => {
321|321|		if (r9.status.running && !prevRunning) {
322|322|			reloadKey += 1;
323|323|		}
324|324|		prevRunning = r9.status.running;
325|325|	});
326|326|
327|327|	function reload() {
328|328|		reloadKey += 1;
329|329|	}
330|330|
331|331|	async function startManually() {
332|332|		triedAutoStart = true;
333|333|		await r9.start();
334|334|	}
335|335|
336|336|	async function stopRouter() {
337|337|		await r9.stop();
338|338|	}
339|339|</script>
340|340|
341|341|<div class="flex flex-col h-full">
342|342|	<!-- Toolbar -->
343|343|	<header class="flex items-center gap-2 px-4 py-2 border-b border-border bg-card flex-shrink-0">
344|344|		<div class="flex items-center gap-2 text-xs">
345|345|			<span class="font-semibold">9Router</span>
346|346|			{#if r9.status.running}
347|347|				<span class="px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30">
348|348|					running
349|349|				</span>
350|350|				{#if r9.status.pid}
351|351|					<span class="text-muted-foreground">pid {r9.status.pid}</span>
352|352|				{/if}
353|353|				<span class="text-muted-foreground">:{r9.status.port}</span>
354|354|			{:else if r9.status.resolved === 'missing'}
355|355|				<span class="px-1.5 py-0.5 rounded bg-muted text-muted-foreground border border-border">
356|356|					not installed
357|357|				</span>
358|358|			{:else}
359|359|				<span class="px-1.5 py-0.5 rounded bg-muted text-muted-foreground border border-border">
360|360|					stopped
361|361|				</span>
362|362|			{/if}
363|363|		</div>
364|364|
365|365|		<div class="ml-auto flex items-center gap-1">
366|366|			{#if r9.status.running}
367|367|				<button
368|368|					title="Reload dashboard"
369|369|					class="p-1.5 rounded hover:bg-secondary text-muted-foreground hover:text-foreground"
370|370|					onclick={reload}
371|371|				>
372|372|					<RotateCw size={14} />
373|373|				</button>
374|374|				<button
375|375|					title="Open in external browser"
376|376|					class="p-1.5 rounded hover:bg-secondary text-muted-foreground hover:text-foreground"
377|377|					onclick={() => r9.openDashboard()}
378|378|				>
379|379|					<ExternalLink size={14} />
380|380|				</button>
381|381|				<button
382|382|					title="Stop 9Router"
383|383|					class="p-1.5 rounded hover:bg-secondary text-muted-foreground hover:text-foreground disabled:opacity-50"
384|384|					disabled={r9.busy}
385|385|					onclick={stopRouter}
386|386|				>
387|387|					{#if r9.busy}
388|388|						<Loader2 size={14} class="animate-spin" />
389|389|					{:else}
390|390|						<Square size={14} />
391|391|					{/if}
392|392|				</button>
393|393|			{:else if r9.status.resolved !== 'missing'}
394|394|				<button
395|395|					title="Start 9Router"
396|396|					class="p-1.5 rounded hover:bg-secondary text-muted-foreground hover:text-foreground disabled:opacity-50"
397|397|					disabled={r9.busy}
398|398|					onclick={startManually}
399|399|				>
400|400|					{#if r9.busy}
401|401|						<Loader2 size={14} class="animate-spin" />
402|402|					{:else}
403|403|						<Play size={14} />
404|404|					{/if}
405|405|				</button>
406|406|			{/if}
407|407|		</div>
408|408|	</header>
409|409|
410|410|	<!-- Body -->
411|411|	<div class="flex-1 relative bg-background">
412|412|		{#if r9.status.resolved === 'missing'}
413|413|			<!-- Install prompt -->
414|414|			<div class="flex flex-col items-center justify-center h-full p-8 text-center">
415|415|				<div class="text-sm text-muted-foreground max-w-md space-y-3">
416|416|					<p class="font-semibold text-foreground">9Router chưa được cài đặt.</p>
417|417|					<p>Mở terminal và chạy:</p>
418|418|					<code class="block px-3 py-2 rounded bg-muted font-mono text-xs">npm i -g 9router</code>
419|419|					<p class="text-xs">Sau khi cài xong, restart Agentry để re-detect.</p>
420|420|				</div>
421|421|			</div>
422|422|		{:else if !r9.status.running}
423|423|			<!-- Starting / stopped -->
424|424|			<div class="flex flex-col items-center justify-center h-full gap-3">
425|425|				{#if r9.busy}
426|426|					<Loader2 size={24} class="animate-spin text-muted-foreground" />
427|427|					<div class="text-sm text-muted-foreground">Starting 9Router…</div>
428|428|				{:else}
429|429|					<div class="text-sm text-muted-foreground">9Router stopped.</div>
430|430|					<button
431|431|						class="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded border border-border hover:bg-accent"
432|432|						onclick={startManually}
433|433|					>
434|434|						<Play size={12} /> Start 9Router
435|435|					</button>
436|436|				{/if}
437|437|				{#if r9.lastError}
438|438|					<div class="mt-2 max-w-md text-xs bg-destructive/10 border border-destructive/30 rounded px-3 py-2 font-mono">
439|439|						{r9.lastError}
440|440|					</div>
441|441|				{/if}
442|442|			</div>
443|443|		{:else}
444|444|			<!-- Embedded iframe -->
445|445|			{#key reloadKey}
446|446|				<iframe
447|447|					title="9Router Dashboard"
448|448|					src={DASHBOARD_URL}
449|449|					class="w-full h-full border-0 bg-white"
450|450|					sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-downloads"
451|451|				></iframe>
452|452|			{/key}
453|453|		{/if}
454|454|	</div>
455|455|</div>
456|456|```
457|457|
458|458|> **Foot-gun (sandbox):** `sandbox` attribute là phòng vệ XSS. Phải có `allow-same-origin` để JS gọi `/api/...` của Next.js dashboard hoạt động. Bỏ `allow-same-origin` → dashboard sẽ trắng / không login được.
459|459|
460|460|> **Foot-gun ($effect dependency):** `$effect` re-chạy khi BẤT KỲ rune nào trong scope đổi. Dòng `if (!triedAutoStart && r9.status.resolved !== 'missing' && ...)` sẽ re-trigger mỗi lần `r9.status` đổi (kể cả khi pid đổi). Đó là lý do có guard `triedAutoStart` — tránh spam `r9.start()`. Nếu xoá guard → loop start.
461|461|
462|462|> **Foot-gun (stopped → running detection):** Dùng `prevRunning` để detect transition. KHÔNG dùng `$effect.pre` — Svelte 5 chưa phổ biến và pattern trên là idiomatic.
463|463|
464|464|### Verify
465|465|
466|466|```bash
467|467|cd gui && pnpm check 2>&1 | tail -5
468|468|```
469|469|
470|470|Expected: 0 new errors.
471|471|
472|472|Manual smoke test (chưa wire vào +page → tạm chưa thấy được; sẽ smoke ở T4).
473|473|
474|474|**If fail:**
475|475|- "$effect is not exported" → check Svelte 5 version trong `gui/package.json` (cần ≥ 5.0). Nếu < 5 → quay lại T0 cập nhật framework, KHÔNG fallback xuống reactive statements `$:`.
476|476|- "Cannot find module 'rotate-cw'" → tên Lucide thay bằng `refresh-cw` nếu không có.
477|477|- TypeScript than `prevRunning` chưa init → đã set `$state(false)`, nếu vẫn lỗi → khai báo `let prevRunning: boolean = $state(false);`.
478|478|
479|479|### Commit
480|480|
481|481|```bash
482|482|git add gui/src/lib/views/R9DashboardView.svelte
483|483|git commit -m "feat(ui): R9DashboardView with embedded iframe + auto-start"
484|484|```
485|485|
486|---
487|
488|## Task 4: Wire `R9DashboardView` vào `+page.svelte`
489|
490|**Risk:** low
491|**Time:** ~10 phút
492|
493|### Files
494|
495|- Modify: `gui/src/routes/+page.svelte`
496|
497|### Changes
498|
499|#### 4.1 Import view
500|
501|
---

## End-to-end verification

```bash
cd /Users/idev/Documents/projects/agentry

# Backend không tăng lỗi clippy (baseline = 0)
cargo clippy -p agentry-wire -p agentry-daemon -p agentry-cli -- -D warnings 2>&1 | grep -c "^error"
# Expected: 0

# Frontend type-check
cd gui && pnpm check
# Expected: 0 errors, ≤8 warnings (pre-existing)

# Full smoke
cd .. && mise run kill && mise run dev
```

Test scenarios (làm tuần tự):

1. **Cold start, 9Router CHƯA chạy:**
   - Click tab "9Router" trên ActivityBar
   - Expected: header hiện status "stopped" → "starting" (busy spinner) → "running"
   - iframe load dashboard 9Router trong < 5s
   - ActivityBar dot xanh xuất hiện trên Router icon
2. **Tab switch không reload iframe:**
   - Tab Overview → tab 9Router → tab Profiles → tab 9Router
   - Expected: iframe vẫn ở trạng thái cũ, KHÔNG reload (Svelte reuse component khi `$ui.view` đổi qua-lại nếu DOM không bị remove — verify trong Network tab)
3. **Click Reload (↻):**
   - Đang ở dashboard nội bộ
   - Click ↻ → iframe re-mount, có thể quay về `/login` redirect chain
4. **Stop từ trong tab:**
   - Click ■ Stop → iframe biến mất, status "stopped" + nút Play
   - Quay sang Settings → nút Stop chuyển thành Start (cùng status)
5. **External fallback vẫn chạy:**
   - Click ↗ → browser ngoài mở `http://localhost:20128/dashboard`
6. **Missing binary:**
   - `npm uninstall -g 9router && which npx | xargs rm` (giả lập missing — backup PATH trước!)
   - Restart Agentry
   - Click tab 9Router → hiện hướng dẫn cài, không spam start
7. **Iframe blocked (giả lập):**
   - Tạm thời chèn header `X-Frame-Options: DENY` bằng nginx proxy hoặc skip — chỉ cần know fallback ↗ button vẫn work
8. **App quit / restart:**
   - Quit app khi 9Router đang chạy → 9Router vẫn chạy ngoài (do `kill_on_drop=false`)
   - Mở lại app → vào tab 9Router → polling phát hiện, render iframe ngay (không cần auto-start lại)

## Troubleshooting appendix

| Triệu chứng | Nguyên nhân | Fix |
|---|---|---|
| Tab 9Router trống trắng | iframe load before 9router up | Effect `prevRunning` chưa bump `reloadKey`. Kiểm tra T3 |
| Iframe không full height | Wrapper thiếu `flex-1 min-h-0` | Inspect parent của `<R9DashboardView>` trong `+page.svelte` |
| Click Start xong, iframe hiện ERR_CONNECTION_REFUSED | Polling chưa update `running=true` | Tăng polling tạm thời 500ms, hoặc thêm `await r9.refresh()` cuối `r9.start()` |
| Console: `Refused to display in a frame X-Frame-Options` | 9Router thêm header chặn | Plan này không có path B — viết plan mới dùng Tauri Webview child |
| Login dashboard infinite loop redirect | iframe sandbox thiếu `allow-same-origin` | Thêm `allow-same-origin` vào sandbox attribute (đã có ở T3) |
| Auto-start spam vô hạn | Guard `triedAutoStart` không hoạt động | Reset chỉ khi user click Start manually, không reset trong $effect |
| Dot xanh trên ActivityBar không xuất hiện | Polling không chạy | T5: `r9.startPolling()` ở `+page.svelte onMount` |
| Tauri prod build, iframe trắng | CSP `upgrade-insecure-requests` chuyển http → https | `tauri.conf.json` add `app.security.csp` allow `http://localhost:20128` cho `frame-src` và `connect-src` |
| Lucide icon `router` không tồn tại | Tên thay đổi | Thử `network`, `wifi`, hoặc `server` |

---

## Out of scope (KHÔNG làm trong plan này)

- Tauri `Webview` child API (multi-webview) — phức tạp, không cần thiết khi iframe khả thi.
- Persist iframe state qua tab switch ngoài Svelte reuse (`<svelte:component this={...}>` keep-alive) — chưa có yêu cầu.
- Auto-detect khi 9Router crash giữa chừng và auto-restart.
- Embed dashboard config trực tiếp trong Agentry UI (bypass iframe) — yêu cầu refactor lớn ở 9Router.
- Custom port (≠ 20128).
- Windows support — `lsof`/`kill` đã là POSIX-only ở plan trước.

Khi user yêu cầu các mục trên, viết plan riêng.

---

## Tóm tắt cho người review

| Task | What | Files |
|---|---|---|
| T1 | Thêm `'r9'` vào `View` enum | `gui/src/lib/stores/ui.ts` |
| T2 | Thêm tab 9Router vào ActivityBar + dot indicator | `gui/src/lib/components/ActivityBar.svelte` |
| T3 | Tạo `R9DashboardView.svelte` với iframe + auto-start + state machine | `gui/src/lib/views/R9DashboardView.svelte` (new) |
| T4 | Wire view switch trong `+page.svelte` | `gui/src/routes/+page.svelte` |
| T5 | Move polling lifecycle lên root | `+page.svelte`, `SettingsView.svelte` |

Tổng: ~1.5 giờ, 5 commit, 0 đụng Rust. Junior PHẢI commit per task để review từng bước.
