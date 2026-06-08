# Bảo mật

## 5.1 Truyền secret cho agent

Secret được khai báo trực tiếp trong **Agent Profile** (field `env`) — không còn dùng file `~/.config/agentry/env.<agent>.yaml`. Daemon merge `process env + profile.env` khi spawn, profile thắng nếu trùng key.

**Lưu trữ:** `env` lưu dạng JSON trong SQLite (`agent_profiles.env`). Cân nhắc mã hóa cột này ở phiên bản sau nếu cần tăng bảo mật lưu trữ.

**Redact output:**
- **Theo giá trị đã biết (chính):** daemon biết giá trị các secret trong `profile.env` → redact đúng chuỗi literal đó trong output trước khi vào ring buffer. Chắc hơn regex đoán mò.
- **Regex bổ sung:** `(?i)(api[_-]?key|authorization|bearer)\s*[:=]\s*\S+` → `***`, chạy trên **sliding window** (giữ tail vài KB chưa flush) để không lọt secret bị chẻ qua 2 chunk PTY.
- Lưu ý: PTY output có ANSI escape → so khớp trên text đã strip ANSI; vẫn là best-effort, không đảm bảo tuyệt đối.

**Start script:** nếu profile có `start_script`, daemon ghi ra file tạm (`mktemp`), chạy `sh -c` / `pwsh -Command`, xóa file sau khi chạy xong. Script có thể export thêm biến nhưng daemon không đọc lại env từ script — chỉ profile.env được inject.

## 5.2 Quyền filesystem

- Agent chạy với `cwd` user chỉ định, không sandbox. Giả định trust agent CLI ở mức trust shell.
