# Remote Phase R2 — Desktop UI: Settings "Remote Access" (Junior Edition)

> Đọc `2026-06-12_remote-INDEX.md` trước. Yêu cầu R1 đã merge (cần `setRemoteAccess`/`getRemoteStatus` ipc + daemon dispatch). Thuần frontend. Gate: `cd gui && pnpm check` = 0 errors ≤1 warning.

**Goal:** Section "Remote Access" trong SettingsView: toggle bật/tắt (confirm khi bật — quyết định bảo mật), hiện trạng thái + địa chỉ tailnet + QR, hướng dẫn khi Tailscale chưa sẵn.

---

## Task R2.1 — Store runes remote.svelte.ts (poll status)

**Risk:** low · **Time:** ~45m

**Files:**
- Create: `gui/src/lib/stores/remote.svelte.ts`

Pattern theo `r9.svelte.ts` (ĐỌC nó trước — poll + busy + lastError):

```ts
import { getRemoteStatus, setRemoteAccess } from '$lib/ipc';
import type { RemoteStatus } from '$lib/types';

function createRemote() {
	let status = $state<RemoteStatus>({
		enabled: false, listening: false, address: null, hostname: null, error: null
	});
	let busy = $state(false);
	let lastError = $state<string | null>(null);
	let timer: ReturnType<typeof setInterval> | null = null;

	async function refresh() {
		try {
			status = await getRemoteStatus();
			lastError = null;
		} catch (e) {
			lastError = String(e);
		}
	}

	return {
		get status() { return status; },
		get busy() { return busy; },
		get lastError() { return lastError; },
		refresh,
		startPolling() {
			if (timer) return;
			refresh();
			timer = setInterval(refresh, 5000);
		},
		stopPolling() {
			if (timer) { clearInterval(timer); timer = null; }
		},
		async setEnabled(enabled: boolean) {
			busy = true;
			try {
				await setRemoteAccess(enabled);
				await refresh();
			} catch (e) {
				lastError = String(e);
			} finally {
				busy = false;
			}
		}
	};
}

export const remote = createRemote();
```

> KHÔNG dùng `$effect` module-level ở đây (không cần) — chỉ `$state`. Poll start/stop do SettingsView gọi khi mount/unmount.

### Verify
```bash
cd gui && pnpm check
```
### Commit
```bash
git add gui/src/lib/stores/remote.svelte.ts && git commit -m "feat(gui): remote access store with status polling"
```

---

## Task R2.2 — SettingsView: section Remote Access

**Risk:** medium · **Time:** ~2h

**Files:**
- Modify: `gui/src/lib/views/SettingsView.svelte`

**Đọc trước:** section 9Router trong SettingsView (dòng ~47-113) — bắt chước structure badge + nút + error banner. ConfirmDialog props.

### R2.2.1 — Imports + poll lifecycle

Thêm vào `<script>`:
```ts
	import { remote } from '$lib/stores/remote.svelte';
	import ConfirmDialog from '$lib/components/ConfirmDialog.svelte';
	import Wifi from '@lucide/svelte/icons/wifi';
	import Copy from '@lucide/svelte/icons/copy';
	import { toasts } from '$lib/stores/toasts.svelte';
	import { onMount } from 'svelte';

	let confirmEnable = $state(false);

	onMount(() => {
		remote.startPolling();
		return () => remote.stopPolling();
	});

	function copyAddr() {
		if (!remote.status.address) return;
		navigator.clipboard.writeText(`http://${remote.status.address}`);
		toasts.success('Address copied');
	}
```

### R2.2.2 — Markup section (chèn sau section 9Router, trước Theme)

```svelte
		<section class="bg-card border border-border rounded p-4 space-y-3">
			<div class="flex items-center justify-between">
				<div>
					<h2 class="text-sm font-semibold">Remote Access</h2>
					<p class="text-xs text-muted-foreground mt-0.5">
						Control agents from your phone over Tailscale. Devices on your tailnet are trusted — no pairing.
					</p>
				</div>
				{#if remote.status.listening}
					<span class="text-xs px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-500 border border-emerald-500/30">on</span>
				{:else}
					<span class="text-xs px-2 py-0.5 rounded bg-muted text-muted-foreground border border-border">off</span>
				{/if}
			</div>

			{#if remote.status.error}
				<div class="text-xs bg-yellow-500/10 border border-yellow-500/30 rounded px-3 py-2">
					{remote.status.error === 'tailscale interface not found'
						? 'Tailscale is not running on this machine. Install/start Tailscale, then try again.'
						: remote.status.error}
				</div>
			{/if}

			<div class="flex items-center gap-2">
				{#if remote.status.listening}
					<button
						class="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded border border-border hover:bg-secondary disabled:opacity-50"
						disabled={remote.busy}
						onclick={() => remote.setEnabled(false)}
					>
						Turn off
					</button>
				{:else}
					<button
						class="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded border border-border hover:bg-secondary disabled:opacity-50"
						disabled={remote.busy}
						onclick={() => (confirmEnable = true)}
					>
						<Wifi class="size-3" /> Turn on
					</button>
				{/if}

				{#if remote.status.listening && remote.status.address}
					<code class="text-xs px-2 py-1 rounded bg-muted font-mono">http://{remote.status.address}</code>
					<button class="p-1 rounded hover:bg-secondary" title="Copy address" onclick={copyAddr}>
						<Copy class="size-3.5" />
					</button>
				{/if}
			</div>

			{#if remote.status.listening && remote.status.address}
				<p class="text-xs text-muted-foreground">
					Open this address in a browser on any device in your tailnet
					{#if remote.status.hostname}(machine: <span class="font-mono">{remote.status.hostname}</span>){/if}.
				</p>
			{/if}
		</section>

<ConfirmDialog
	open={confirmEnable}
	title="Enable remote access?"
	message="Any device on your tailnet will be able to view and control agent sessions on this machine. Tailscale handles identity and encryption."
	confirmLabel="Enable"
	onConfirm={() => { confirmEnable = false; remote.setEnabled(true); }}
	onCancel={() => (confirmEnable = false)}
/>
```

> ConfirmDialog đặt ngoài `<div>` scroll chính (cuối file, cạnh markup chính) — xem cách ProfilesView/ProjectsView đặt. Đọc props thật của ConfirmDialog.
> QR code: SKIP ở R2 (cần thêm dep qr — để polish sau; copy address + gõ tay đủ dùng).

### Verify
```bash
cd gui && pnpm check && mise run dev
```
Manual (Tailscale ON): Settings → Remote Access → Turn on → confirm → badge "on" + địa chỉ hiện + copy được. Tắt Tailscale → error hint hiện. Turn off → badge "off".
**If fail:** `onMount` cleanup không chạy → đảm bảo return fn; props ConfirmDialog sai → đọc file.

### Commit
```bash
git add gui/src/lib/views/SettingsView.svelte && git commit -m "feat(gui): remote access section in settings"
```

---

## Phạm vi nghiêm ngặt — KHÔNG làm
- KHÔNG đụng daemon/wire (R1 đã xong, chỉ tiêu thụ).
- KHÔNG thêm QR dep ở phase này.
- KHÔNG đổi section khác trong SettingsView.

## Troubleshooting
| Triệu chứng | Sửa |
|---|---|
| `getRemoteStatus is not a function` | R1.1.3 chưa merge — check ipc.ts. |
| Status không cập nhật | `startPolling` chưa gọi (onMount) hoặc daemon chưa chạy bản R1. |
| Toggle không hiệu lực | Daemon cũ — `mise run kill && mise run dev` để restart daemon build mới. |

