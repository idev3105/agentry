# Agentry Remote (mobile) — Instruction redesign UI/UX cho Claude Design

> Dán cùng Project Instructions chính. Đây là yêu cầu **thiết kế lại giao diện** cho webapp mobile điều khiển agent từ xa — đã có prototype chạy được nhưng nhìn còn thô, phẳng, thiếu phân cấp.
> Claude Design tự quyết toàn bộ visual (layout, màu, typography, icon, motion). Brief này chỉ nêu app làm gì, vấn đề hiện tại, và ràng buộc bắt buộc.

---

## 1. APP NÀY LÀ GÌ

Webapp mobile để developer **theo dõi & trả lời các AI coding agent từ xa**. User chạy 3–10 agent trên máy dev rồi rời bàn; agent thỉnh thoảng dừng lại chờ user trả lời (y/n, chọn 1/2, cho phép chạy lệnh). User mở app trên điện thoại để: thấy agent nào đang chờ → đọc nó hỏi gì → trả lời ngắn → agent chạy tiếp.

- Thiết bị chính: **điện thoại**, dùng một tay, mở nhanh 30 giây–2 phút rồi đóng.
- Đây là công cụ **giám sát + phản hồi**, không phải IDE. Mở ra phải trả lời ngay câu: "có ai cần tôi không?"
- Là một phần của hệ Agentry (có desktop app) — cùng khái niệm: Session / Project / Profile; trạng thái session: queued → running → finished/failed; khi running có sub-state working / idle / **awaiting_input** (chờ user — quan trọng nhất).

## 2. CÁC MÀN HÌNH (giữ nguyên chức năng, thiết kế lại hình thức)

1. **Home — "ai cần tôi?"**: con số lớn nhất "N agents need you" ở đầu; bộ lọc theo project; 3 nhóm session: **Needs you** (awaiting_input) / **Running** / **Recent** (finished/failed). Nút tạo session mới.
2. **Session detail**: tiêu đề + agent + project + badge trạng thái; nút kill; dải cảnh báo "đang chờ bạn · 12m"; vùng output terminal (đọc + cuộn); thanh trả lời ghim đáy gồm input text + các phím nhanh.
3. **Settings**: bật/tắt 3 loại thông báo (cần input / failed / finished); thông tin kết nối (tên máy dev, "bảo mật bởi Tailscale, không cần ghép cặp").
4. **Trạng thái kết nối** (toàn màn): không tới được máy dev / thiết bị này rớt tailnet / đang kết nối lại — ba thông điệp khắc phục khác nhau.
5. **New session** (bottom sheet): kế thừa ngữ cảnh project hiện tại — nếu user đang lọc Home theo một project, session mới vào thẳng project đó (sheet chỉ còn profile + prompt, profile mặc định chọn sẵn → thao tác tối thiểu là gõ prompt và bấm start). Chỉ khi đang xem "All" sheet mới hỏi chọn project (gợi ý nhớ project dùng gần nhất).
6. **Confirm dialog** (kill), **toast**, **offline banner** ("dữ liệu lúc 14:32, mất kết nối").

## 3. VẤN ĐỀ HIỆN TẠI CẦN GIẢI (đây là lý do redesign)

1. **Thiếu phân cấp thị giác.** Mọi card trông giống hệt nhau; nhóm "Needs you" (việc quan trọng nhất) chỉ khác bằng viền mờ → không bật ra. Cần làm khối "cần bạn" áp đảo thị giác so với running/recent, để liếc một cái là thấy.
2. **Tiêu điểm Home yếu.** Con số "agents need you" hiện trôi nổi, trông như placeholder. Cần biến nó thành tiêu điểm thật sự, có sức nặng — và đổi giọng khi không có gì chờ (trạng thái "all quiet" là tin tốt, nên cảm giác nhẹ nhõm/yên).
3. **Icon chắp vá.** Đang dùng emoji hệ thống (🖥️ 📡 ✓ ⚙ và các ký tự ‹ ➤ ＋ ⏻) — lệch màu, lệch baseline mỗi máy, trông nghiệp dư. Cần bộ icon nhất quán (icon line/solid đồng bộ), và một logo/nhận diện thật thay cho ký tự "▲" tạm bợ.
4. **Thông tin meta thành nhiễu.** Dòng "agent · project · waiting 12m" dồn một hàng xám đều nhau; tín hiệu quan trọng nhất ("đã chờ bao lâu") không nổi. Thời gian chờ càng lâu càng phải gây chú ý mạnh hơn (vd chờ >15–20m nên đỏ/cảnh báo).
5. **Câu hỏi agent bị cắt.** Card "Needs you" hiển thị câu agent đang hỏi nhưng cắt cụt một dòng — mất đúng phần giá trị nhất. Cho phép 2 dòng để user đọc được câu hỏi mà chưa cần mở session.
6. **Phím trả lời nhanh chưa phân nhóm.** Thanh trả lời có ~9 phím cùng cấp (y/n/1/2 và Enter/Esc/↑/↓/Ctrl+C). Cần tách rõ: **phím trả lời** (y/n/số — dùng nhiều nhất, dễ chạm nhất) khác **phím điều khiển terminal** (Enter/Esc/mũi tên/Ctrl+C). Ctrl+C là phá hoại → phải khó bấm nhầm, tách khỏi cụm an toàn.
7. **Bảng màu lệch brand.** Đang dùng xanh mặc định chung chung. Nên có nhận diện màu riêng cho Agentry, ăn nhập với desktop app (desktop hỗ trợ theme tối kiểu Gruvbox/One Dark/Catppuccin/Nord). Màu trạng thái cần phân biệt rõ trên nền tối: awaiting (vàng/hổ phách) — running (xanh lá) — failed (đỏ) — finished (xám).

8. **Flow tạo session bắt user chọn project thừa.** Home đã có dải lọc theo project ngay trên màn — đó chính là ngữ cảnh project hiện tại. Nhưng sheet New session vẫn bắt chọn lại project từ đầu, lặp thao tác. Cần kế thừa ngữ cảnh: đang lọc theo project nào thì tạo session vào project đó (sheet chỉ còn profile + prompt, profile default chọn sẵn → nhiều khi chỉ cần gõ prompt). Chỉ khi đang ở "All" mới hỏi project, và nên nhớ lựa chọn gần nhất. Mục tiêu: tạo session từ xa nhanh nhất có thể, không bắt user khai lại thứ app đã biết.

## 4. RÀNG BUỘC BẮT BUỘC (không được phá)

- **Mobile-first, một tay.** Thao tác chính (mở session đang chờ, gửi trả lời nhanh) phải nằm trong vùng ngón cái với được. Vùng chạm tối thiểu ~44px. Tôn trọng safe-area (tai thỏ / home indicator).
- **Output terminal là monospace**, giữ ANSI màu, đọc được và cuộn mượt trên màn nhỏ. Không cần find/resize như desktop.
- **Awaiting_input luôn là tín hiệu nổi bật nhất** ở mọi nơi nó xuất hiện (home hero, card, badge, session detail, thông báo).
- **Nói rõ khi mất kết nối**: dữ liệu là ảnh chụp cũ (kèm mốc giờ), và chặn mọi hành động (gửi/kill) khi offline — không fail im lặng.
- **Không thêm pairing/login** trong UI — Tailscale lo danh tính. Đừng vẽ màn đăng nhập.
- Phạm vi giữ nguyên: KHÔNG quản lý profile/project/settings-daemon trên mobile (làm ở desktop). Chỉ: xem, trả lời, kill, tạo session tối giản.

## 5. LƯU Ý

- Tông tổng thể: một dev-tool tối, gọn, đáng tin — dùng hằng ngày, liếc nhanh ra thông tin. Không màu mè/consumer, nhưng phải có cá tính nhận diện (hiện đang quá "Tailwind mặc định").
- Mọi quyết định layout cụ thể, hệ màu chính xác, typographic scale, bộ icon, motion/transition: **Claude Design tự quyết**, miễn giải được 8 vấn đề ở mục 3 và không phá ràng buộc mục 4.
