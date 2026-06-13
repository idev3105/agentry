# Agentry — Instruction cho Claude Design: Remote Control (Server + Client)

> Dán file này vào Claude Design cùng Project Instructions chính (`claude-design-project-instructions.md`).
> Mục tiêu: thiết kế UI/UX cho cả hai phía của remote control:
>   - SERVER: phần cấu hình & giám sát "expose Agentry ra xa" nằm TRONG desktop app.
>   - CLIENT: giao diện kết nối tới server từ xa (desktop / mobile / web).
> Thiết kế (layout, màu, navigation, motion...) do Claude Design tự quyết định.

---

## 1. KIẾN TRÚC (đọc kỹ — quyết định toàn bộ UX)

Agentry daemon chạy nền trên máy dev, nghe trên **Unix socket cục bộ** (chỉ máy đó truy cập). Tính năng remote control gồm hai phần:

- **SERVER** = lớp đưa Unix socket đó ra mạng riêng **Tailscale (tailnet)**, để các thiết bị khác của user kết nối tới. Server CHẠY TRÊN máy dev. UI của server KHÔNG phải app riêng — nó là phần "Remote Access" tích hợp trong **desktop app** đã có: bật/tắt, xem trạng thái, thấy ai đang kết nối.
- **CLIENT** = thứ kết nối tới server qua Tailscale để điều khiển agent từ xa. Client có thể là: desktop app trên máy khác, webapp trên trình duyệt, hoặc app mobile. Tất cả nói cùng giao thức với daemon.

**Tailscale lo sẵn** (ảnh hưởng lớn tới UX cả hai phía):
- Kết nối xuyên NAT/firewall, không mở port public, không cloud trung gian.
- Danh tính + xác thực: thiết bị vào được tailnet là đã được user xác thực qua Tailscale → CLIENT KHÔNG cần tự xây login/pairing/QR.
- Mã hóa đầu-cuối sẵn.

Hệ quả: đây là truy cập trong mạng riêng của chính user, KHÔNG phải dịch vụ public trên internet. Luồng vào client rất ngắn; trọng tâm thiết kế dồn vào việc dùng, không phải onboarding bảo mật.

## 2. DATA MODEL (tham khảo — dùng chung)

```
AgentType      = claude | codex | opencode
SessionStatus  = queued | starting | running | finished | failed
ActivityState  = working | idle | awaiting_input   (chỉ khi running)

Project = { id, name, path }
Profile = { id, name, agent_type, params[], env[] }   (có 1 profile default)
Session = { id, title, agent, status, activity, cwd, unread, failReason }

RemoteClient = { id, name, kind(desktop|mobile|web), lastSeen, address }   (thiết bị đang kết nối tới server)
```

---

## PHẦN A — SERVER (trong desktop app)

### A.1 Bật/tắt Remote Access
- Một công tắc bật/tắt việc expose daemon ra tailnet. Mặc định TẮT (an toàn trước).
- Khi bật: hiện rõ địa chỉ để client kết nối (tên máy trong tailnet + cổng, vd `dev-macbook.tailnet:PORT`), kèm nút copy. Có thể hiện QR cho client mobile quét nhanh (chỉ là địa chỉ, không phải mã bảo mật).
- Khi tắt: mọi client đang kết nối bị ngắt; nói rõ điều đó.

### A.2 Điều kiện tiên quyết (Tailscale)
- Server phụ thuộc Tailscale đang chạy trên máy dev. UI phải phát hiện & hướng dẫn rõ khi: Tailscale chưa cài / chưa đăng nhập / chưa bật. Đây là trạng thái chặn — không bật remote được cho tới khi tailnet sẵn sàng.
- Hiện tên máy dev trong tailnet để user xác nhận đúng máy.

### A.3 Giám sát client đang kết nối
- Danh sách RemoteClient đang kết nối: tên thiết bị, loại (desktop/mobile/web), địa chỉ, lần hoạt động cuối.
- Thấy được thiết bị nào đang xem/điều khiển session nào (mức tổng quan).
- **Ngắt (disconnect) một client** từ phía server — hành động cần xác nhận.

### A.4 Trạng thái & an toàn
- Trạng thái server luôn rõ: đang tắt / đang bật & lắng nghe / lỗi (vd cổng bận, Tailscale rớt).
- Vì remote cho phép điều khiển agent (chạy lệnh trên máy dev), việc bật cần một bước ý thức rõ ràng — đây là quyết định bảo mật, không bật nhầm.

---

## PHẦN B — CLIENT (desktop / mobile / web kết nối tới server)

### B.1 Kết nối tới server (KHÔNG login/pairing)
- Client trỏ tới địa chỉ Tailscale của server (nhập địa chỉ, hoặc quét QR từ màn A.1). Không màn đăng nhập, không ghép cặp thủ công — Tailscale đã lo danh tính.
- Client cần thể hiện rõ **đang điều khiển máy dev nào** (tên máy trong tailnet) — user có thể có nhiều máy dev.
- Trạng thái kết nối phải rõ, phân biệt được nguyên nhân lỗi: **máy dev tắt / server đang tắt** vs **Tailscale rớt trên thiết bị này** — gợi ý khắc phục khác nhau.

### B.2 Tổng quan "cần tôi ngay" (màn chính của client)
- Câu trả lời đầu tiên khi mở: **agent nào đang chờ input?** Session `awaiting_input` nổi bật nhất, đứng đầu, đếm được ("2 agent đang chờ bạn").
- Tiếp theo: gì đang chạy (working), gì vừa xong/lỗi gần đây.
- Mỗi session: tên, agent, project, trạng thái + activity, thời gian chạy / **thời gian đã chờ** ("chờ bạn 12 phút").
- Gộp session của mọi project (ở xa muốn nhìn toàn cục), lọc theo project khi danh sách dài.

### B.3 Xem & trả lời session
- Mở session → đọc **output terminal** agent; quan trọng nhất là **đoạn cuối — câu hỏi agent vừa hỏi**.
- Trả lời: gõ text gửi vào session. Phổ biến nhất là trả lời cực ngắn (y / n / 1 / 2 / "ok" / Enter) → thao tác này phải **ít ma sát nhất**, kèm phím đặc biệt hay dùng (Enter, Esc, ↑/↓, Ctrl+C).
- Sau khi gửi: thấy agent nhận & chạy tiếp (activity → working).

### B.4 Thao tác session từ xa
- Kill session (cần xác nhận).
- Tạo session mới tối giản: chọn project + profile (mặc định = profile default) + prompt khởi đầu.
- KHÔNG cần trên client từ xa: quản lý profile, quản lý project, settings daemon — làm trên desktop tại máy.

### B.5 Thích ứng theo loại thiết bị
- Cùng một client UI chạy trên nhiều cỡ màn: **mobile** (ưu tiên một tay, thao tác chính với được bằng ngón cái) và **desktop/tablet browser** (tận dụng màn rộng hơn nhưng vẫn là công cụ giám sát+phản hồi, không cần đủ tính năng như app desktop gốc).
- Thiết kế responsive: chung một bộ tính năng, layout co giãn theo cỡ màn.

### B.6 Thông báo
- Sự kiện đáng báo: agent **bắt đầu chờ input** (quan trọng nhất), session **failed**, session **finished**.
- Chạm thông báo → mở thẳng session, sẵn sàng trả lời. Bật/tắt từng loại. Gộp sự kiện liên tiếp cùng session để chống spam.
- *(Lưu ý: client web qua HTTP nội bộ tailnet có thể bị giới hạn push trình duyệt → cần fallback: badge số-lượng-chờ rõ khi mở app, để "mở ra là biết ngay" vẫn hoạt động không cần push.)*

### B.7 Dữ liệu cũ & trạng thái rỗng
- Mất kết nối: dữ liệu hiển thị là **ảnh chụp cũ** — nói rõ "dữ liệu lúc 14:32, mất kết nối"; chặn mọi hành động (gửi input, kill) + giải thích, không fail im lặng.
- Không session nào chạy → "mọi thứ yên ắng" + lối tắt tạo session.
- Không có gì chờ input → nói rõ (tin tốt — user mở chỉ để xác nhận rồi đóng).

---

## 3. LƯU Ý

- Server và client là hai mặt của một tính năng: server (trong desktop) là **nơi bật & canh cửa**; client là **nơi điều khiển từ xa**. Hai phía dùng chung khái niệm & tên gọi với toàn app.
- Vì Tailscale lo bảo mật mạng, đừng thêm tầng đăng nhập/pairing ở client — sẽ thừa & gây ma sát. Bảo mật ý thức nằm ở phía server (bật/tắt có chủ đích, ngắt client).
- Mọi quyết định layout, navigation, cách hiển thị địa chỉ/QR, kích thước chữ terminal...: **Claude Design tự quyết định**.
