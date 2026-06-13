# Agentry — Instruction cho Claude Design: Remote Control từ Webapp

> Dán file này vào Claude Design **cùng với** Project Instructions chính (`claude-design-project-instructions.md`).
> Mục tiêu: thiết kế UI/UX cho **webapp điều khiển Agentry từ xa** — một client mới, chạy trên trình duyệt (điện thoại / tablet / máy khác), kết nối về daemon Agentry trên máy dev.
> Thiết kế (layout, màu sắc, navigation, motion...) do Claude Design tự quyết định.

---

## 1. BỐI CẢNH & TÌNH HUỐNG SỬ DỤNG

Agentry daemon chạy nền trên máy dev, sống độc lập với GUI — agent vẫn chạy khi user rời máy. Webapp remote control sinh ra cho đúng tình huống đó:

- User khởi chạy 3–10 agent session rồi **rời bàn làm việc** (đi họp, ăn trưa, ở nhà buổi tối).
- Agent chạy việc dài (10–60 phút), thỉnh thoảng **dừng lại chờ user trả lời** (xác nhận, chọn phương án, cho phép chạy lệnh). Nếu không ai trả lời, agent ngồi chờ vô ích.
- User mở webapp trên **điện thoại** để: biết agent nào đang chờ mình → đọc agent hỏi gì → trả lời ngắn → agent chạy tiếp.

Đây là **client giám sát + phản hồi**, KHÔNG phải bản sao đầy đủ của desktop app:

- Nhịp dùng: mở nhanh 30 giây – 2 phút, xử lý xong, đóng. Không phải ngồi làm việc lâu.
- Thiết bị chính: **điện thoại** (màn nhỏ, cảm ứng, một tay). Tablet/desktop browser là phụ.
- Ưu tiên tuyệt đối: **"agent nào cần tôi?"** phải là thứ đầu tiên nhìn thấy.

## 2. DATA MODEL (tham khảo — giống desktop app)

```
AgentType      = claude | codex | opencode
SessionStatus  = queued | starting | running | finished | failed
ActivityState  = working | idle | awaiting_input   (chỉ khi running)

Project = { id, name, path }
Profile = { id, name, agent_type, params[], env[] }   (có 1 profile default)
Session = { id, title, agent, status, activity, cwd, unread, failReason }
```

Webapp nói chuyện với daemon qua cùng giao thức với desktop app: xem danh sách session theo project, đọc output terminal, gõ input vào session, start/kill session.

---

## 3. TÍNH NĂNG CẦN THIẾT KẾ

### 3.1 Kết nối & ghép nối thiết bị (pairing)

- Lần đầu dùng: user ghép webapp với daemon trên máy dev. Luồng ghép nối khởi phát từ desktop app (vd: desktop hiện mã QR / mã ngắn — điện thoại quét hoặc nhập để ghép).
- Sau khi ghép: thiết bị được nhớ, lần sau mở webapp là vào thẳng, không ghép lại.
- Quản lý thiết bị đã ghép nằm ở **desktop app** (Settings): danh sách thiết bị (tên, lần hoạt động cuối), thu hồi (revoke) từng thiết bị. Thu hồi là hành động cần xác nhận.
- Webapp cần màn hình cho trạng thái: chưa ghép (hướng dẫn ghép), đã ghép nhưng không kết nối được daemon (máy dev tắt / mất mạng), đang kết nối lại.

### 3.2 Tổng quan "cần tôi ngay" (màn hình chính)

- Mở app ra, câu trả lời đầu tiên: **có agent nào đang chờ input không?** Session `awaiting_input` phải nổi bật nhất, đứng đầu, đếm được (vd "2 agent đang chờ bạn").
- Tiếp theo: cái gì đang chạy (working), cái gì vừa xong/lỗi (finished/failed gần đây).
- Mỗi session hiện: tên, agent, project, trạng thái + activity, thời gian chạy / thời gian đã chờ ("chờ bạn 12 phút" — thời gian chờ càng lâu càng cần chú ý).
- Session thuộc nhiều project: hiển thị gộp tất cả project (khác desktop — ở xa user muốn nhìn toàn cục), có lọc theo project khi danh sách dài.

### 3.3 Xem & trả lời một session

- Mở một session → đọc được **output terminal** của agent (chữ phải đọc được trên màn điện thoại; phần quan trọng nhất là **đoạn cuối — câu hỏi agent vừa hỏi**).
- Trả lời agent: gõ text gửi vào session. Trường hợp phổ biến nhất là trả lời rất ngắn (y / n / 1 / 2 / "ok" / Enter) — thao tác trả lời nhanh này phải cực kỳ ít ma sát, kể cả các phím đặc biệt hay dùng (Enter, Esc, mũi tên lên/xuống, Ctrl+C).
- Sau khi gửi: thấy được agent nhận và chạy tiếp (activity chuyển working).
- Output là terminal thật (ANSI), trên mobile không cần đủ tính năng như desktop (không cần find-in-output, resize...) — cần đọc được và cuộn được là chính.

### 3.4 Thao tác session từ xa

- **Kill** session (cần xác nhận).
- **Tạo session mới** dạng tối giản: chọn project + profile (mặc định là profile default) + prompt khởi đầu. Không cần form đầy đủ như desktop.
- Đổi tên, resume session đã kết thúc: có thì tốt, ưu tiên thấp.
- KHÔNG cần trên webapp: quản lý profile (tạo/sửa/xoá), quản lý project, settings daemon — các việc này làm trên desktop.

### 3.5 Thông báo đẩy (push notification)

- Sự kiện đáng thông báo: agent **bắt đầu chờ input** (quan trọng nhất), session **failed**, session **finished** (việc dài chạy xong).
- Chạm vào thông báo → mở thẳng session đó, sẵn sàng trả lời.
- User cấu hình được trong webapp: bật/tắt từng loại thông báo.
- Chống spam: nhiều sự kiện liên tiếp từ cùng session phải gộp lại.

### 3.6 Trạng thái kết nối & dữ liệu cũ

- Webapp phụ thuộc mạng + máy dev đang bật → trạng thái kết nối phải luôn rõ: đang kết nối / mất kết nối / đang thử lại.
- Khi mất kết nối: dữ liệu đang hiển thị là **ảnh chụp cũ** — phải nói rõ "dữ liệu lúc 14:32, mất kết nối", không để user tưởng là realtime rồi trả lời vào session đã chết.
- Mọi hành động (gửi input, kill) khi mất kết nối: chặn + giải thích, không fail im lặng.

### 3.7 Trạng thái rỗng

- Chưa ghép thiết bị → hướng dẫn ghép (luồng 3.1).
- Đã kết nối, không có session nào chạy → "mọi thứ yên ắng", kèm lối tắt tạo session mới.
- Không có gì chờ input → nói rõ điều đó (đây là tin tốt — user mở app chỉ để xác nhận điều này rồi đóng).

---

## 4. LƯU Ý

- Webapp và desktop app là **một hệ sinh thái** — cùng khái niệm, cùng tên gọi (session/project/profile, working/idle/awaiting input), nhìn là nhận ra cùng một sản phẩm. Nhưng webapp KHÔNG phải desktop thu nhỏ — nó là công cụ giám sát + phản hồi tối ưu cho mobile.
- Một tay cầm điện thoại: các thao tác chính (mở session đang chờ, gửi trả lời nhanh) phải với được bằng ngón cái.
- Mọi quyết định layout, navigation pattern, kích thước chữ terminal, hình thức pairing screen...: **Claude Design tự quyết định**.
