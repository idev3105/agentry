# Agentry — Instruction cho Claude Design: Remote Control qua Tailscale

> Dán file này vào Claude Design **cùng với** Project Instructions chính (`claude-design-project-instructions.md`).
> Mục tiêu: thiết kế UI/UX cho **webapp điều khiển Agentry từ xa qua Tailscale** — client trình duyệt (điện thoại / tablet / máy khác) trong cùng một Tailscale network (tailnet) với máy dev.
> Thiết kế (layout, màu sắc, navigation, motion...) do Claude Design tự quyết định.

---

## 1. BỐI CẢNH & MÔ HÌNH MẠNG

Agentry daemon chạy nền trên máy dev, sống độc lập với GUI — agent vẫn chạy khi user rời máy. Webapp này cho phép user theo dõi & trả lời agent từ xa, **qua Tailscale**.

**Tailscale làm gì (quan trọng cho UX):** Tailscale là VPN mesh — mọi thiết bị của user (máy dev, điện thoại, laptop khác) nằm trong một mạng riêng ảo (**tailnet**), mỗi máy có một địa chỉ ổn định và tên (vd `dev-macbook.tailnet`). Tailscale lo sẵn ba thứ:

- **Kết nối xuyên mạng**: điện thoại 4G vẫn tới được máy dev sau NAT/firewall, không cần mở port public, không cần cloud trung gian.
- **Danh tính + xác thực**: thiết bị nào vào được tailnet là đã được user xác thực qua Tailscale. → **Webapp KHÔNG cần tự xây pairing/QR/đăng nhập riêng.** Có mặt trong tailnet = đã được tin.
- **Mã hóa đầu-cuối**: traffic giữa các thiết bị đã được mã hóa sẵn.

**Hệ quả cho thiết kế:** đây không phải app public trên internet. User mở webapp bằng cách trỏ trình duyệt tới địa chỉ Tailscale của máy dev (vd `http://dev-macbook.tailnet:PORT`). Vì Tailscale đã lo danh tính, **luồng vào app rất ngắn** — không màn đăng nhập, không ghép cặp thủ công. Trọng tâm thiết kế dồn hết vào việc dùng, không phải onboarding bảo mật.

## 2. TÌNH HUỐNG SỬ DỤNG

- User khởi chạy 3–10 agent rồi rời bàn (họp, ăn trưa, ở nhà).
- Agent chạy việc dài, thỉnh thoảng **dừng chờ user trả lời** (xác nhận / chọn phương án / cho phép chạy lệnh). Không ai trả lời → agent ngồi chờ vô ích.
- User mở webapp trên điện thoại (đang trong tailnet) để: biết agent nào đang chờ → đọc agent hỏi gì → trả lời ngắn → agent chạy tiếp.

Đây là **client giám sát + phản hồi**, không phải bản sao desktop. Nhịp dùng: mở nhanh 30 giây – 2 phút rồi đóng. Thiết bị chính: **điện thoại** (màn nhỏ, cảm ứng, một tay).

## 3. DATA MODEL (tham khảo — giống desktop app)

```
AgentType      = claude | codex | opencode
SessionStatus  = queued | starting | running | finished | failed
ActivityState  = working | idle | awaiting_input   (chỉ khi running)

Project = { id, name, path }
Profile = { id, name, agent_type, params[], env[] }   (có 1 profile default)
Session = { id, title, agent, status, activity, cwd, unread, failReason }
```

Webapp nói chuyện với daemon qua cùng giao thức desktop: xem session theo project, đọc output terminal, gõ input, start/kill session.

---

## 4. TÍNH NĂNG CẦN THIẾT KẾ

### 4.1 Truy cập & trạng thái kết nối (KHÔNG có pairing/login)

- Mở app = trỏ trình duyệt tới địa chỉ Tailscale máy dev. Không màn đăng nhập, không quét QR, không nhập mã.
- App cần thể hiện rõ **đang nói chuyện với máy dev nào** (tên máy trong tailnet) — ngắn gọn, ổn định, để user biết mình đang điều khiển đúng máy (user có thể có nhiều máy dev).
- Các trạng thái kết nối cần xử lý:
  - **Kết nối tốt** — bình thường, ít chiếm chú ý.
  - **Không tới được máy dev** — máy dev tắt, hoặc thiết bị này rớt khỏi tailnet (Tailscale chưa bật / hết phiên). Phân biệt giúp user: gợi ý "kiểm tra máy dev đã bật chưa" vs "kiểm tra Tailscale trên thiết bị này".
  - **Đang kết nối lại**.
- Không cần UI quản lý thiết bị trong webapp — việc đó thuộc Tailscale admin và desktop app, nằm ngoài phạm vi.

### 4.2 Tổng quan "cần tôi ngay" (màn hình chính)

- Mở app, câu trả lời đầu tiên: **có agent nào đang chờ input không?** Session `awaiting_input` nổi bật nhất, đứng đầu, đếm được (vd "2 agent đang chờ bạn").
- Tiếp theo: gì đang chạy (working), gì vừa xong/lỗi gần đây (finished/failed).
- Mỗi session: tên, agent, project, trạng thái + activity, thời gian chạy / **thời gian đã chờ** ("chờ bạn 12 phút" — chờ càng lâu càng cần chú ý).
- Gộp session của tất cả project (ở xa user muốn nhìn toàn cục), lọc theo project khi danh sách dài.

### 4.3 Xem & trả lời một session

- Mở session → đọc **output terminal** agent (chữ đọc được trên màn điện thoại; quan trọng nhất là **đoạn cuối — câu hỏi agent vừa hỏi**).
- Trả lời: gõ text gửi vào session. Phổ biến nhất là trả lời cực ngắn (y / n / 1 / 2 / "ok" / Enter) — thao tác này phải **ít ma sát nhất**, kèm các phím đặc biệt hay dùng (Enter, Esc, ↑/↓, Ctrl+C).
- Sau khi gửi: thấy agent nhận và chạy tiếp (activity → working).
- Output là terminal thật (ANSI); trên mobile chỉ cần đọc + cuộn tốt, không cần find/resize như desktop.

### 4.4 Thao tác session từ xa

- **Kill** session (cần xác nhận).
- **Tạo session mới** tối giản: chọn project + profile (mặc định = profile default) + prompt khởi đầu.
- Đổi tên / resume session đã kết thúc: ưu tiên thấp.
- KHÔNG cần trên webapp: quản lý profile, quản lý project, settings daemon — làm trên desktop.

### 4.5 Thông báo đẩy

- Sự kiện đáng báo: agent **bắt đầu chờ input** (quan trọng nhất), session **failed**, session **finished** (việc dài xong).
- Chạm thông báo → mở thẳng session đó, sẵn sàng trả lời.
- Bật/tắt từng loại trong webapp. Gộp các sự kiện liên tiếp từ cùng session để chống spam.
- *(Lưu ý kỹ thuật: webapp truy cập qua Tailscale thường là HTTP nội bộ — push notification trình duyệt có thể bị giới hạn. Thiết kế nên có phương án thay thế nhẹ nhàng: badge số lượng chờ rõ ràng khi mở app, để dù không có push thì việc "mở ra là biết ngay" vẫn hoạt động.)*

### 4.6 Dữ liệu cũ khi mất kết nối

- Khi không tới được máy dev: dữ liệu hiển thị là **ảnh chụp cũ** — nói rõ "dữ liệu lúc 14:32, mất kết nối", đừng để user tưởng realtime rồi trả lời vào session đã chết.
- Mọi hành động (gửi input, kill) khi mất kết nối: chặn + giải thích, không fail im lặng.

### 4.7 Trạng thái rỗng

- Đã kết nối, không session nào chạy → "mọi thứ yên ắng" + lối tắt tạo session.
- Không có gì chờ input → nói rõ (tin tốt — user mở app chỉ để xác nhận rồi đóng).

---

## 5. LƯU Ý

- Webapp & desktop là **một hệ sinh thái**: cùng khái niệm, cùng tên gọi (session/project/profile, working/idle/awaiting input), nhìn là nhận ra cùng sản phẩm. Nhưng webapp KHÔNG phải desktop thu nhỏ — là công cụ giám sát + phản hồi tối ưu cho mobile.
- Vì Tailscale lo bảo mật, đừng thêm tầng đăng nhập/pairing trong UI — sẽ thừa và gây ma sát. Tập trung vào "mở ra → thấy ai cần mình → trả lời".
- Một tay cầm điện thoại: thao tác chính (mở session đang chờ, gửi trả lời nhanh) phải với được bằng ngón cái.
- Mọi quyết định layout, navigation, kích thước chữ terminal, cách hiển thị tên máy dev...: **Claude Design tự quyết định**.
