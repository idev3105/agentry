# Agentry — Instruction cho Claude Design: Quản lý nhiều Project

> Dán file này vào Claude Design **cùng với** Project Instructions chính (`claude-design-project-instructions.md`).
> Mục tiêu: bổ sung chi tiết cho tính năng **quản lý nhiều project** — phần prototype hiện tại còn thiếu.
> Thiết kế (layout, màu sắc, vị trí, motion...) do Claude Design tự quyết định.

---

## 1. BỐI CẢNH

Trong prototype hiện tại, Project chỉ xuất hiện ở **một chỗ duy nhất**: dropdown trong form tạo session. Điều này chưa đủ — Project là khái niệm trung tâm của app:

- **Mọi session đều thuộc về đúng một project.** Backend chỉ trả danh sách session theo từng project (`list_sessions` theo `project_id`), không có khái niệm "tất cả session của mọi project" trong một danh sách phẳng.
- User là developer làm việc trên **nhiều project cùng lúc** (vd: 2–5 repo), mỗi project có nhiều agent session chạy song song.
- App cần khái niệm **"project đang active"**: tại một thời điểm, user đang nhìn vào MỘT project; danh sách session, quick-launch, terminal... đều thuộc project đó.

---

## 2. DATA MODEL (tham khảo)

```
Project = { id, name, path }
```

- `name`: tên hiển thị do user đặt (thường là tên thư mục).
- `path`: đường dẫn tuyệt đối đến thư mục code. Đây cũng là working directory mặc định khi session không chỉ định cwd riêng.
- Backend hỗ trợ 3 thao tác: **tạo project** (cần cả name + path), **liệt kê project**, **xoá project**.
- Session ghi nhớ `project_id` của nó vĩnh viễn — không chuyển session giữa các project.

---

## 3. TÍNH NĂNG CẦN THIẾT KẾ

### 3.1 Project đang active (khái niệm xuyên suốt)

- Tại mọi thời điểm, app có một **project active**. User cần luôn biết mình đang ở project nào (tên project phải nhìn thấy được ở vị trí ổn định, không phải mở menu mới biết).
- Khi đổi project active, các vùng sau thay đổi theo:
  - **Danh sách session** (sidebar): chỉ hiện session của project active.
  - **Quick-launch** (nút tạo nhanh bằng profile mặc định): launch vào project active.
  - **Form tạo session**: project active được chọn sẵn (user vẫn đổi được).
- Lựa chọn project active được nhớ qua các lần mở app.

### 3.2 Chuyển đổi project (switcher)

- User chuyển project thường xuyên → thao tác này phải **nhanh** (1 click hoặc phím tắt), không phải đi qua màn settings.
- Switcher cần cho thấy mỗi project: tên, đường dẫn (hoặc dạng rút gọn), và **số session đang chạy** trong project đó — để user biết "repo kia còn 2 agent đang chạy" mà không cần chuyển qua.
- Trong switcher có lối tắt "tạo project mới".
- Command palette (Cmd+K) cũng tìm và nhảy được đến project.

### 3.3 Tạo project

- Form tạo gồm **2 trường**: tên + đường dẫn thư mục (có nút browse chọn thư mục).
- Gợi ý tên tự động từ tên thư mục khi user chọn path (user sửa được).
- Validate: path bắt buộc; báo lỗi rõ nếu trùng project đã có.
- Sau khi tạo: project mới trở thành project active.
- Lối vào: từ switcher, từ màn quản lý project, và từ onboarding (lần chạy đầu).

### 3.4 Xem & quản lý danh sách project

- Một nơi xem được **tất cả project**: tên, đường dẫn, số session đang chạy / tổng số session.
- Thao tác trên từng project: chuyển đến (đặt làm active), xoá.
- Đây là màn quản lý mức "thư viện" — khác với switcher (chuyển nhanh). Hai thứ phục vụ hai nhịp dùng khác nhau: switcher dùng hằng giờ, quản lý dùng thỉnh thoảng.

### 3.5 Xoá project

- **Hành động nguy hiểm** → bắt buộc dialog xác nhận.
- Dialog phải nói rõ hệ quả: project có bao nhiêu session (đặc biệt nếu còn session **đang chạy** — cảnh báo mạnh hơn, vd phải kill các session đó trước hoặc xác nhận kill kèm theo).
- Nếu xoá project đang active → app chuyển active sang project khác còn lại (hoặc về trạng thái rỗng nếu hết project).

### 3.6 Trạng thái rỗng & số ít

- **0 project**: trạng thái rỗng toàn app → dẫn user tạo project đầu tiên (trùng với onboarding).
- **1 project**: app vẫn hoạt động bình thường, project đó tự là active; switcher vẫn tồn tại nhưng đừng làm phiền user.
- **Project chưa có session**: trạng thái rỗng của danh sách session → dẫn user tạo session.

### 3.7 Tích hợp với các tính năng đã có (cập nhật lại các màn cũ)

- **Overview**: thống kê & bảng session nên nhóm/lọc theo project, hoặc cho thấy session thuộc project nào — click một dòng thì chuyển active project + focus session đó.
- **Session inspector (drawer)**: dòng "Project" hiện tên project, click được để nhảy đến project đó.
- **Form tạo session**: giữ nguyên dropdown project nhưng mặc định là project active.
- **Onboarding**: bước tạo project đầu tiên dùng đúng form tạo project ở 3.3.

---

## 4. LƯU Ý

- Số lượng project thực tế: thường 2–5, hiếm khi quá 10 — switcher không cần search/phân trang phức tạp, nhưng đường dẫn dài cần xử lý hiển thị (rút gọn thông minh).
- Mọi quyết định layout, vị trí switcher, hình thức màn quản lý (view riêng / section trong settings / modal...): **Claude Design tự quyết định**, miễn nhất quán với phần UI đã có của prototype.
