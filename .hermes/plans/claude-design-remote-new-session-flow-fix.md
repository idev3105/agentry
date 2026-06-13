# Agentry Remote (mobile) — Instruction sửa flow tạo session

> Dán cùng Project Instructions chính. Đây là yêu cầu **sửa một flow cụ thể** trên prototype hiện có: luồng tạo session mới. Không thiết kế lại toàn app.
> Claude Design tự quyết hình thức (layout sheet, vị trí, motion). Brief này chỉ mô tả hành vi đúng.

---

## 1. VẤN ĐỀ HIỆN TẠI

Màn Home đã có **dải lọc theo project** (chips: All / api-server / web-dashboard / …). Khi user đang lọc theo một project — tức là app ĐÃ BIẾT user đang quan tâm project nào — bấm nút tạo session mới vẫn mở sheet bắt **chọn lại project từ đầu**.

Đây là thao tác thừa: app bắt user khai lại thứ nó đã biết. Trên mobile, mỗi lần chạm thừa đều đắt — mục tiêu của app là "mở nhanh, xử lý xong, đóng".

## 2. HÀNH VI ĐÚNG CẦN THIẾT KẾ

### 2.1 Kế thừa ngữ cảnh project

- **Đang lọc theo một project** → bấm tạo session: session mới vào thẳng project đó. Sheet KHÔNG hỏi project nữa — chỉ hiện project đã chọn ở dạng xác nhận được (vd một dòng nhỏ "vào api-server", chạm vào mới đổi được nếu muốn).
- **Đang ở "All"** → sheet mới cần hỏi project. Pre-select project user dùng gần nhất (nhớ qua các lần dùng); user đổi được.

### 2.2 Giảm số bước còn tối thiểu

Sheet sau khi sửa, trường hợp phổ biến nhất (đang lọc project + có profile default):

1. Bấm nút tạo.
2. Gõ prompt (hoặc bỏ trống).
3. Bấm Start.

— tức là **không còn lựa chọn bắt buộc nào**:
- **Project**: lấy từ ngữ cảnh (mục 2.1).
- **Profile**: profile default chọn sẵn; đổi được nếu muốn. Hiện tóm tắt profile đang chọn (tên + agent) để user biết mình sắp chạy gì.
- **Prompt**: optional.

### 2.3 Sau khi tạo

- Đưa user đến thẳng session vừa tạo (xem nó khởi động), hoặc về Home với session mới nổi rõ ở nhóm đang chạy — Claude Design chọn hướng nào hợp nhịp dùng mobile hơn.
- Nếu đang lọc theo project A mà session tạo vào project A → giữ nguyên filter. Trường hợp tạo từ "All" → đảm bảo user nhìn thấy session mới ngay, không bị filter che mất.

## 3. RÀNG BUỘC

- Một session luôn thuộc về đúng một project — không có session "không project". Backend yêu cầu cả project và profile khi start; "không hỏi" nghĩa là app tự điền từ ngữ cảnh, không phải bỏ trống.
- Không thêm bước mới nào khác vào flow (không xác nhận trung gian, không màn thành công riêng — toast/điều hướng là đủ).
- Giữ ngôn ngữ & thành phần đã có của prototype (bottom sheet, profile default, toast) — đây là chỉnh hành vi, không đổi vocabulary.
- Thao tác với được bằng ngón cái; nút Start nằm trong vùng chạm dễ.

## 4. NGOÀI PHẠM VI

- Không đụng các màn khác (session detail, settings, connection).
- Không thêm quản lý project/profile vào mobile — vẫn làm trên desktop.
