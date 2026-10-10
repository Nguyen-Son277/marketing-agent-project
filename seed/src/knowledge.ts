/** Seed knowledge base content for a demo company, so retrieval has real material. */
export interface SeedDocument {
  readonly path: string
  readonly title: string
  readonly category: string
  readonly tags: readonly string[]
  readonly content: string
}

export const DEMO_KB_DOCUMENTS: readonly SeedDocument[] = [
  {
    path: '00-cong-ty/tong-quan.md',
    title: 'Tổng quan công ty',
    category: '00-cong-ty',
    tags: ['tổng quan', 'định vị'],
    content: `# Tổng quan công ty

## Chúng tôi là ai
**Sapa Digital** là đơn vị cung cấp nền tảng quản lý bán hàng cho các cửa hàng bán lẻ tại Việt Nam.
Thành lập 2023, đội ngũ 18 người, trụ sở Hà Nội, có văn phòng đại diện tại Đà Nẵng.

## Sản phẩm chính
1. **Sapa POS** — phần mềm bán hàng tại quầy, hỗ trợ in hoá đơn, quản lý kho, chạy offline.
2. **Sapa Shop** — website bán hàng liên kết tồn kho với POS.
3. **Sapa Insight** — bảng điều khiển doanh thu, hàng bán chạy, cảnh báo tồn kho.

## Mô hình giá (cập nhật 2026-09)
| Gói | Giá/tháng | Phù hợp | Giới hạn |
|---|---|---|---|
| Khởi nghiệp | 299.000đ | 1 cửa hàng | 1 máy POS, 1.000 sản phẩm |
| Chuyên nghiệp | 699.000đ | 1–3 cửa hàng | 5 máy POS, 10.000 sản phẩm |
| Chuỗi | 1.890.000đ | 4+ cửa hàng | Không giới hạn máy, hỗ trợ API |

Tất cả gói có 14 ngày dùng thử, không cần thẻ tín dụng.

## Khách hàng hiện tại
- 1.240 cửa hàng đang dùng, tập trung tại Hà Nội, TP.HCM, Đà Nẵng.
- Ngành: thời trang (32%), tạp hoá (24%), mỹ phẩm (18%), F&B (14%), khác (12%).
- Tỉ lệ giữ chân sau 12 tháng: 78%.

## Mục tiêu 2027
- 3.000 cửa hàng đang dùng.
- Giảm chi phí thu hút khách (CAC) từ 850.000đ xuống 600.000đ.
- Tăng tỉ lệ chuyển đổi từ dùng thử sang trả phí từ 22% lên 30%.
`,
  },
  {
    path: '00-cong-ty/khach-hang-muc-tieu.md',
    title: 'Khách hàng mục tiêu (ICP)',
    category: '00-cong-ty',
    tags: ['icp', 'persona'],
    content: `# Khách hàng mục tiêu (ICP)

## Chân dung 1 — Chủ cửa hàng thời trang độc lập
- **Bối cảnh**: 28–42 tuổi, 1–2 cửa hàng, doanh thu 300–800 triệu/tháng, quản lý bằng Excel hoặc sổ tay.
- **Nỗi đau**: cuối ngày mới biết bán được gì; không kiểm soát được tồn kho; nhân viên ghi sai đơn.
- **Kích hoạt**: mở cửa hàng thứ hai hoặc bị thất thoát hàng.
- **Tiêu chí chọn**: dễ dùng cho nhân viên ít công nghệ, giá hợp lý, hỗ trợ nhanh.
- **Phản đối chính**: "sợ phức tạp hơn", "đang dùng sổ thấy ổn".
- **Kênh tin cậy**: Facebook group chủ shop, TikTok, giới thiệu từ người quen.

## Chân dung 2 — Quản lý vận hành chuỗi nhỏ
- **Bối cảnh**: 30–45 tuổi, 4–10 chi nhánh, có nhân sự kế toán riêng.
- **Nỗi đau**: số liệu mỗi chi nhánh lệch nhau, mất thời gian tổng hợp báo cáo.
- **Tiêu chí chọn**: báo cáo tập trung, phân quyền, tích hợp được với kế toán.
- **Kênh tin cậy**: LinkedIn, hội thảo ngành, tư vấn trực tiếp.

## Chân dung phụ — Nhân viên bán hàng (người dùng cuối)
Không phải người ra quyết định, nhưng là người quyết định sản phẩm có được dùng thật hay không. Ưu tiên: tốc độ thao tác, ít bước bấm.

## Không phải khách hàng mục tiêu
- Chuỗi lớn (>30 chi nhánh) đã có ERP riêng.
- Cửa hàng online thuần, không có điểm bán vật lý.
`,
  },
  {
    path: '00-cong-ty/doi-thu.md',
    title: 'Đối thủ cạnh tranh',
    category: '00-cong-ty',
    tags: ['đối thủ', 'cạnh tranh'],
    content: `# Đối thủ cạnh tranh

## Bảng so sánh (cập nhật 2026-09)

| Đối thủ | Định vị | Giá khởi điểm | Mạnh | Yếu |
|---|---|---|---|---|
| KiotViet | Dẫn đầu thị trường | 200.000đ/tháng | Thương hiệu mạnh, hệ sinh thái rộng, độ phủ đại lý | Giao diện nhiều tính năng, chủ shop nhỏ thấy rối |
| Sapo | Nền tảng bán hàng đa kênh | 240.000đ/tháng | Mạnh về bán online, nhiều tích hợp sàn TMĐT | Điểm bán offline chưa mượt bằng |
| MISA CukCuk | Tập trung F&B | 350.000đ/tháng | Rất mạnh ngành F&B, hỗ trợ thuế | Không phù hợp bán lẻ thời trang/tạp hoá |
| Bán hàng đơn giản (Excel) | Miễn phí | 0đ | Không mất phí, quen thuộc | Không báo cáo, dễ sai sót, không mở rộng được |

## Khoảng trống chúng ta có thể chiếm
1. **Đơn giản cho người không rành công nghệ** — các đối thủ lớn đang thêm tính năng, làm giao diện nặng dần.
2. **Hỗ trợ thật nhanh cho cửa hàng nhỏ** — kênh hỗ trợ của đối thủ lớn chậm với khách gói thấp.
3. **Giá minh bạch, không phí ẩn** — thị trường có nhiều phàn nàn về phí tăng sau năm đầu.

## Đối thủ không nên đối đầu trực diện
KiotViet về độ phủ thương hiệu và ngân sách quảng cáo. Ta nên đánh vào ngách và sự đơn giản, không đua ngân sách.
`,
  },
  {
    path: '10-brand/guidelines.md',
    title: 'Brand guidelines',
    category: '10-brand',
    tags: ['brand', 'nhận diện'],
    content: `# Brand guidelines

## Định vị
"Phần mềm bán hàng dễ dùng nhất cho cửa hàng Việt" — trọng tâm là **sự đơn giản** và **hỗ trợ tận tay**.

## Giá trị cốt lõi
1. Đơn giản trước, tính năng sau.
2. Nói thật về giới hạn sản phẩm.
3. Hỗ trợ như người cùng làm việc, không như tổng đài.

## Màu sắc
| Vai trò | Mã | Ghi chú |
|---|---|---|
| Chính | #1B5E4A | Xanh rêu đậm — tin cậy, bình tĩnh |
| Phụ | #F2B705 | Vàng — điểm nhấn CTA |
| Nền | #FAF9F6 | Trắng ngà |
| Chữ | #1A1A1A | Đen mềm |
| Cảnh báo | #C0392B | Chỉ dùng cho lỗi/cảnh báo |

## Typography
- Tiêu đề: Be Vietnam Pro Bold.
- Nội dung: Be Vietnam Pro Regular, cỡ tối thiểu 15px.

## Logo
- Khoảng trống quanh logo tối thiểu bằng chiều cao chữ S.
- Không đổi màu logo, không thêm hiệu ứng, không đặt trên ảnh phức tạp.

## Tuyệt đối tránh
- Cam kết kết quả kinh doanh cụ thể ("tăng doanh thu 200%").
- So sánh trực tiếp gọi tên đối thủ theo hướng chê bai.
- Hình ảnh khách hàng không có sự đồng ý.
`,
  },
  {
    path: '10-brand/tone-of-voice.md',
    title: 'Tone of voice',
    category: '10-brand',
    tags: ['brand', 'giọng văn'],
    content: `# Tone of voice

## Bốn nguyên tắc
1. **Rõ ràng** — câu ngắn, một ý một câu, tránh thuật ngữ kỹ thuật khi không cần.
2. **Thân thiện nhưng chuyên nghiệp** — xưng "Sapa" hoặc "chúng tôi", gọi khách là "anh/chị" hoặc "bạn" (chọn một và giữ nhất quán trong cùng ấn phẩm).
3. **Thực tế** — nói bằng ví dụ cụ thể của cửa hàng, không dùng tính từ hoa mỹ.
4. **Không phán xét** — không chê cách khách đang làm ("dùng Excel là sai"), mà nêu cái giá phải trả.

## Nên dùng
- "Thử 14 ngày, không cần thẻ."
- "Anh/chị mất bao lâu để chốt sổ cuối ngày?"
- "Nếu chưa phù hợp, anh/chị cứ nói — chúng tôi hoàn tiền trong 7 ngày."

## Tránh dùng
- "Giải pháp toàn diện", "đột phá", "số 1 thị trường", "tối ưu hoá triệt để".
- Viết hoa toàn bộ câu để nhấn mạnh.
- Emoji trong nội dung chính thức; tối đa 1 emoji trong bài mạng xã hội.

## Ví dụ chuyển giọng
| Chưa đạt | Đạt |
|---|---|
| "Hệ thống quản lý bán hàng thông minh tích hợp AI" | "Phần mềm giúp anh/chị biết hôm nay bán được gì mà không cần mở Excel" |
| "Tối ưu hoá quy trình vận hành" | "Chốt sổ cuối ngày trong 2 phút" |
`,
  },
  {
    path: '10-brand/quy-dinh-phap-ly.md',
    title: 'Quy định pháp lý & tuân thủ',
    category: '10-brand',
    tags: ['pháp lý', 'tuân thủ'],
    content: `# Quy định pháp lý & tuân thủ

## Bắt buộc
1. **Không cam kết kết quả tài chính** — không hứa doanh thu, lợi nhuận, hoặc mức tăng trưởng cụ thể. Chỉ mô tả chức năng.
2. **Dữ liệu khách hàng** — không dùng ảnh, tên, số điện thoại khách hàng khi chưa có văn bản đồng ý.
3. **Hoá đơn điện tử** — mọi nội dung nói về hoá đơn phải nêu rõ "tuỳ theo quy định hiện hành và cấu hình của cửa hàng".
4. **Giá** — mọi bài nói về giá phải kèm "giá chưa bao gồm VAT" và ngày cập nhật.
5. **So sánh** — chỉ so sánh với thông tin công khai của đối thủ, không suy đoán, không bôi nhọ.

## Cần người duyệt trước khi phát hành
- Mọi tuyên bố về hiệu quả kinh doanh có số liệu.
- Nội dung có so sánh đối thủ trực tiếp.
- Nội dung liên quan tới thuế, kế toán, pháp lý.

## Khi không chắc
Dừng lại, đánh dấu nội dung là "cần rà soát pháp lý" và báo Leader. Không tự quyết.
`,
  },
  {
    path: '20-thi-truong/xu-huong-nganh.md',
    title: 'Xu hướng ngành bán lẻ 2026',
    category: '20-thi-truong',
    tags: ['xu hướng', 'thị trường'],
    content: `# Xu hướng ngành bán lẻ 2026

> Ghi chú nguồn: tổng hợp nội bộ từ báo cáo ngành và quan sát thị trường, cập nhật 2026-10. Các số liệu dưới đây là **ước lượng** trừ khi ghi rõ nguồn.

## Xu hướng chính
1. **Bán đa kênh trở thành mặc định** — cửa hàng nhỏ cũng bán qua Facebook/TikTok Shop. Yêu cầu: tồn kho phải đồng bộ giữa quầy và online.
2. **Chủ shop trẻ hoá** — nhóm 25–35 tuổi mở cửa hàng tăng, quen dùng điện thoại, kỳ vọng phần mềm cài trong 10 phút.
3. **Chi phí quảng cáo tăng** — CPM trên Meta tăng (ước lượng 15–25%/năm), buộc chuyển sang kênh sở hữu (email, cộng đồng, SEO).
4. **AI viết nội dung phổ biến** — khách hàng nhận ra nội dung máy móc; nội dung có ví dụ thật và con số thật tạo khác biệt.
5. **Tìm kiếm bằng giọng nói và câu hỏi dài** — cần nội dung trả lời trực tiếp câu hỏi, không chỉ từ khoá ngắn.

## Hàm ý cho Sapa Digital
- Ưu tiên thông điệp "cài trong 10 phút, chốt sổ trong 2 phút".
- Đầu tư nội dung SEO dạng câu hỏi ("cách quản lý tồn kho cho cửa hàng thời trang").
- Xây kênh sở hữu (nhóm Zalo, email) để giảm phụ thuộc quảng cáo.
`,
  },
  {
    path: '30-kenh/seo-keywords.md',
    title: 'Bộ từ khoá SEO & cluster',
    category: '30-kenh',
    tags: ['seo', 'từ khoá'],
    content: `# Bộ từ khoá SEO & cluster

> Chưa kết nối Google Search Console cho tài liệu này — dữ liệu dưới đây là **giả định ban đầu**, cần thay bằng số liệu thật sau khi kết nối.

## Cluster 1 — Phần mềm quản lý bán hàng (trang trụ)
Trang trụ: /phan-mem-quan-ly-ban-hang
- phần mềm quản lý bán hàng
- phần mềm quản lý cửa hàng
- app quản lý bán hàng cho cửa hàng nhỏ

Trang vệ tinh:
- /phan-mem-quan-ly-ban-hang-mien-phi ("miễn phí", "dùng thử")
- /phan-mem-quan-ly-ban-hang-cho-cua-hang-thoi-trang

## Cluster 2 — Quản lý tồn kho
Trang trụ: /quan-ly-ton-kho
- cách quản lý tồn kho cửa hàng
- phần mềm quản lý kho cho cửa hàng nhỏ
- kiểm kê hàng hoá định kỳ

## Cluster 3 — So sánh (ý định thương mại cao)
- so sánh phần mềm bán hàng
- kiotviet hay sapo
- phần mềm bán hàng nào tốt cho cửa hàng nhỏ

## Ưu tiên triển khai
1. Cluster 1 (khối lượng cao nhất, gần chuyển đổi nhất).
2. Cluster 3 (ý định thương mại cao, cạnh tranh cao — cần nội dung so sánh trung thực).
3. Cluster 2 (khối lượng trung bình, dễ thắng).

## Việc cần làm ngay
Kết nối Google Search Console để lấy dữ liệu thật và thay thế danh sách giả định này.
`,
  },
  {
    path: '30-kenh/social-playbook.md',
    title: 'Playbook mạng xã hội',
    category: '30-kenh',
    tags: ['social', 'playbook'],
    content: `# Playbook mạng xã hội

## Kênh và vai trò
| Kênh | Vai trò | Nhịp đăng | Định dạng chính |
|---|---|---|---|
| Facebook Page | Kênh chính, chuyển đổi | 4 bài/tuần | Ảnh + caption, video ngắn |
| TikTok | Nhận biết, thu hút mới | 3 video/tuần | Video 20–45 giây |
| LinkedIn | Khách hàng chuỗi, uy tín | 1 bài/tuần | Bài học vận hành |
| Nhóm Zalo chủ shop | Giữ chân, hỗ trợ | Hàng ngày | Tin nhắn, mẹo ngắn |

## Tỉ lệ nội dung (60/25/15)
- 60% giá trị: mẹo quản lý, cách tính tồn kho, kinh nghiệm chủ shop.
- 25% thương hiệu: câu chuyện khách hàng, hậu trường đội ngũ.
- 15% bán hàng: tính năng, ưu đãi, dùng thử.

## Khung giờ đề xuất (giả định, cần kiểm chứng bằng dữ liệu)
- Facebook: 11:30–13:00 và 20:00–21:30.
- TikTok: 12:00 và 19:00–21:00.
- LinkedIn: 08:00–09:00 thứ Ba–thứ Năm.

## Nội dung hiệu quả đã ghi nhận
- Video "chốt sổ cuối ngày trong 2 phút" (demo thao tác thật).
- Bài so sánh "quản lý bằng Excel vs phần mềm" theo dạng bảng chi phí.
- Chuỗi ảnh "3 sai lầm khiến cửa hàng thất thoát hàng".

## Cần tránh
- Đăng cùng nội dung cho mọi kênh mà không đổi định dạng.
- Hashtag nhồi nhét không liên quan.
- Hứa hẹn kết quả kinh doanh cụ thể.
`,
  },
  {
    path: '30-kenh/ads-playbook.md',
    title: 'Playbook quảng cáo trả phí',
    category: '30-kenh',
    tags: ['ads', 'playbook'],
    content: `# Playbook quảng cáo trả phí

> Chưa kết nối tài khoản quảng cáo. Kế hoạch dưới đây là **khung giả định** để bắt đầu, phải hiệu chỉnh bằng dữ liệu thật.

## Cấu trúc đang dùng
\`FB_Lead_<Đối tượng>_<Địa lý>_<Tháng>_v1\`

| Chiến dịch | Mục tiêu | Đối tượng | Định dạng | KPI |
|---|---|---|---|---|
| FB_Lead_ChuShop_HN_2026-11_v1 | Lead (dùng thử) | Sở thích: quản lý cửa hàng, bán lẻ; 28–45 tuổi; Hà Nội | Video 20s + ảnh | CPL ≤ 120.000đ |
| FB_Lead_ChuShop_HCM_2026-11_v1 | Lead | Tương tự, TP.HCM | Video 20s | CPL ≤ 140.000đ |
| FB_Retarget_TrialDrop_2026-11_v1 | Chuyển đổi | Người đã vào trang dùng thử chưa đăng ký | Ảnh + testimonial | CPA ≤ 450.000đ |

## Nguyên tắc phân bổ
- 70% ngân sách cho cấu trúc đã có tín hiệu tốt.
- 20% mở rộng nhóm đối tượng mới.
- 10% thử nghiệm thông điệp mới.

## Điều kiện dừng
- CPL vượt 180.000đ trong 3 ngày liên tiếp → tạm dừng, rà lại thông điệp và đối tượng.
- Tần suất hiển thị > 3.5 trong 7 ngày → thay mẫu quảng cáo.

## Cần làm trước khi chạy thật
Kết nối tài khoản quảng cáo và GA4 để có số liệu thật; hiện chưa có dữ liệu lịch sử nên không thể cam kết CPL.
`,
  },
  {
    path: '40-du-lieu/kpi-dinh-nghia.md',
    title: 'Định nghĩa KPI & cách đo',
    category: '40-du-lieu',
    tags: ['kpi', 'đo lường'],
    content: `# Định nghĩa KPI & cách đo

> Chưa kết nối GA4/GSC cho công ty này. Định nghĩa dưới đây là quy ước nội bộ để thống nhất cách đo.

## Phễu và chỉ số
| Giai đoạn | Chỉ số | Cách tính | Nguồn |
|---|---|---|---|
| Nhận biết | Impression, Reach | Tổng hiển thị, số người tiếp cận | Ads, Social insight |
| Cân nhắc | Click, CTR, Session | Click / hiển thị; phiên truy cập | Ads, GA4 |
| Chuyển đổi | Lead, Trial, Paid | Số đăng ký dùng thử; số chuyển trả phí | Website, CRM |
| Giữ chân | Churn, LTV | Tỉ lệ rời bỏ theo tháng; giá trị vòng đời | CRM |

## Chỉ số trọng tâm 2027
- **CAC** (chi phí thu hút 1 khách): mục tiêu giảm từ 850.000đ → 600.000đ.
- **Tỉ lệ trial → paid**: 22% → 30%.
- **Tỉ lệ giữ chân 12 tháng**: giữ ở mức ≥ 78%.

## Quy ước
- Mọi con số phải kèm khoảng thời gian.
- So sánh cùng kỳ (tuần này với tuần trước, tháng này với cùng tháng năm ngoái) để loại mùa vụ.
- Không báo cáo chỉ số khi mẫu < 30 sự kiện; ghi rõ "mẫu nhỏ".

## Trạng thái dữ liệu hiện tại
GA4 và Google Search Console: **chưa kết nối**. Cần kết nối trước khi báo cáo hiệu suất thật.
`,
  },
]
