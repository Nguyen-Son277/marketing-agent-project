# Phân loại kiến thức bằng model chat

## Hai lớp JSON khác nhau

Ứng dụng gọi API chat của provider. Provider có thể trả SSE (`choices[].delta`) hoặc một JSON ChatCompletion (`choices[].message`). Adapter chuyển hai định dạng này thành cùng luồng nội bộ.

Nội dung `message.content` hoặc các text delta sau đó vẫn cần chứa kết quả phân loại theo schema `{"sections":[...]}`. Model chat không cần là một model chuyên JSON, nhưng câu trả lời chỉ có văn xuôi mà không có kết quả có cấu trúc thì không đủ để phân loại an toàn.

Bộ đọc phân loại chấp nhận JSON thuần hoặc một object JSON không mơ hồ trong code fence/lời dẫn. Vẫn yêu cầu đúng và đủ ID các phần, danh mục hợp lệ cùng metadata đã xác thực. Không đoán danh mục, không tự điền ID, không dùng reasoning làm kết quả và không ghi phân loại một phần khi thất bại.

## Sửa định dạng và model dự phòng

- Tối đa hai model theo cấu hình công ty, tối đa bốn request cho mỗi batch.
- Mỗi model tối đa một lần sửa định dạng. Nếu vẫn lỗi, có thể thử model dự phòng đã cấu hình, trong giới hạn thời gian, context và ngân sách.
- Lỗi xác thực, cấu hình, hủy và hết ngân sách không được lặp bằng fallback để né lỗi.
- Model chat thường cần thêm allowance đầu ra; giới hạn vẫn bị chặn bởi cấu hình model và ngân sách. Không bật JSON mode trên mọi gateway một cách mặc định.

## Xử lý tài liệu đã lỗi

1. Kiểm tra model phân loại chính và dự phòng trong Cài đặt.
2. Sau khi cập nhật backend, dùng thao tác thử lại trong Kho kiến thức cho tài liệu bị lỗi.
3. Không tự động chạy lại toàn bộ tài liệu cũ vì mỗi lần gọi model có thể phát sinh phí.

Mã `invalid_model_response` chỉ lỗi nội dung phân loại: nội dung rỗng, JSON hỏng/không rõ ràng, schema sai hoặc bị cắt. Lỗi envelope/giao thức ChatCompletion được báo là lỗi provider thay vì giả phản hồi rỗng thành công. Dữ liệu nguồn và gán thủ công được giữ nguyên.

## Kiểm chứng

Kiểm thử tương thích dùng phản hồi provider giả lập, không gửi tài liệu hay khóa API tới dịch vụ ngoài. Test đi từ adapter thật qua classifier đến worker/sections/chunks. Một lần chạy với model thật cần lựa chọn model, nguồn dữ liệu thử và cho phép chi phí riêng.
