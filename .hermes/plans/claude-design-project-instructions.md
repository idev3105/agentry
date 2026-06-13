# Agentry — Project Instructions cho Claude Design

> Dán file này vào phần **Project Instructions** của Claude Design.
> Mục tiêu: mô tả Agentry là gì và có những tính năng nào.
> Phần thiết kế (layout, màu sắc, typography, motion...) do Claude Design tự quyết định.

---

## 1. AGENTRY LÀ GÌ

Agentry là **desktop app** để **quản lý nhiều phiên AI coding agent** chạy song song trong một cửa sổ duy nhất. Hỗ trợ 3 loại agent: **Claude Code**, **Codex**, **OpenCode**.

- **Đối tượng:** developer power-user chạy 3–10 agent cùng lúc. KHÔNG phải consumer app.
- **Bối cảnh kiến trúc (ảnh hưởng UX):** daemon chạy nền sống lâu hơn GUI — đóng cửa sổ KHÔNG kill agent. Agent chạy trong terminal (PTY) thật, output là raw terminal bytes.
- **Khái niệm chính:**
  - **Project** = một thư mục code. User làm việc trên nhiều project cùng lúc.
  - **Session** = một phiên agent đang chạy trong một project. Mỗi session có vòng đời: queued → starting → running → finished/failed. Khi running, agent có thể đang **làm việc**, **rảnh (idle)**, hoặc **chờ user trả lời (awaiting input)** — trạng thái chờ input là quan trọng nhất, user cần được báo ngay.
  - **Profile** = cấu hình khởi chạy agent (loại agent + tham số + biến môi trường). Có 1 profile mặc định.

---

## 2. DATA MODEL (tham khảo, đặt tên đúng khi hiển thị)

```
AgentType      = claude | codex | opencode
SessionStatus  = queued | starting | running | finished | failed
ActivityState  = working | idle | awaiting_input   (chỉ khi running)
```

- **Project**: `{ id, name, path }` + danh sách session.
- **Profile**: `{ id, name, agent_type, params[], env[] }`. Có 1 profile default.
- **Session**: `{ id, title, agent, status, activity, cwd, unread, failReason, agent_session_id, agent_session_name }`.
  - `title` tự đặt tên từ prompt đầu tiên.
  - `unread` = số output chưa đọc khi session không được focus.
  - `agent_session_id` = ID phiên riêng của agent (vd Claude session UUID), khác với Agentry session id.
- **Settings**: `{ defaultProfileId, maxConcurrentSessions(=4), idleThresholdS, awaitingThresholdS }`.

---

## 3. TÍNH NĂNG — thiết kế đủ các chức năng sau

### 3.1 Quản lý Project
- Thêm / xoá project (project = tên + đường dẫn thư mục).
- Chuyển qua lại giữa các project; mỗi project thấy được số session đang chạy.

### 3.2 Danh sách Session
- Xem tất cả session của project hiện tại.
- Mỗi session cần thấy nhanh: trạng thái hoạt động (working / idle / **awaiting input — agent đang chờ user, cần nổi bật nhất** / finished / failed / queued), số output chưa đọc khi không focus, tên session, loại agent, thời gian chạy.
- Thao tác trên session: chọn, đổi tên, kill, resume, copy session ID.

### 3.3 Tạo Session mới
- Tạo nhanh bằng profile mặc định (1 click).
- Hoặc chọn profile khác từ danh sách.
- Hoặc form đầy đủ: chọn profile + thư mục làm việc + prompt khởi đầu.
- Khi vượt giới hạn concurrent (mặc định 4): session vào hàng đợi (queued), hiển thị vị trí trong queue.

### 3.4 Terminal
- Hiển thị output thật của agent (terminal emulator, raw bytes).
- User gõ trực tiếp vào terminal để trả lời agent.
- Chuyển session → replay lại buffer output của session đó.
- Tìm kiếm trong output (find: highlight, đếm match, prev/next).
- Clear màn hình.
- Trạng thái đặc biệt cần xử lý: session đã kết thúc (cho resume / tạo mới), session đang queued, daemon mất kết nối.

### 3.5 Thông tin chi tiết Session (inspector)
- Tên session (sửa inline được), loại agent, profile.
- Trạng thái + thời gian chạy.
- Các ID: Agentry session id, agent session id/name — đều copy được.
- Project + đường dẫn cwd (copy được).
- Lệnh khởi chạy đầy đủ (copy được).
- Hành động: Resume (khi đã kết thúc/lỗi), Kill (cần xác nhận), tạo session mới cùng profile.
- Lý do lỗi (stderr) khi session failed.

### 3.6 Command Palette
- Phím tắt toàn cục (Cmd+K): tìm nhanh session, project, và lệnh (tạo session, mở settings, kill...).
- Điều hướng hoàn toàn bằng bàn phím.

### 3.7 Settings
- **Agent Profiles**: danh sách profile, tạo / sửa / xoá / đặt mặc định. Form sửa gồm: tên, loại agent, danh sách tham số dòng lệnh (flag + value).
- **General**: số session chạy đồng thời tối đa, ngưỡng idle (giây), ngưỡng awaiting-input (giây), profile mặc định, chọn theme.

### 3.8 Onboarding (lần chạy đầu)
- Wizard: chào mừng → tạo project đầu tiên → xem lại profile mặc định → bắt đầu session đầu tiên. Có skip.
- Sau setup: tour ngắn giới thiệu các khu vực chính của UI. Có skip.

### 3.9 Thông báo
- Toast cho các sự kiện: session bắt đầu, vào queue, lỗi, daemon mất kết nối.
- Banner khi daemon mất kết nối / đang reconnect / đã kết nối lại.

### 3.10 Trạng thái rỗng
- Chưa có project nào → hướng dẫn tạo project đầu tiên.
- Project chưa có session → hướng dẫn tạo session.
- Đang tải → loading state.

### 3.11 Xác nhận hành động nguy hiểm
- Kill session, xoá profile, xoá project → đều cần dialog xác nhận trước khi thực hiện.

---

## 4. LƯU Ý

- Theme: app hỗ trợ nhiều theme (Gruvbox dark mặc định, One Dark, Catppuccin Mocha, Nord) — user đổi được trong Settings.
- Mọi quyết định về layout, màu sắc, typography, spacing, motion: **Claude Design tự quyết định**, miễn phù hợp với một dev tool dày thông tin dùng hằng ngày.
