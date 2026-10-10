/**
 * Built-in skills. A skill is a short, reusable method an agent loads when the
 * task calls for it — the "how" that is too specific for a role prompt but
 * shared across roles. Bodies are deliberately procedural.
 */
export interface SkillSeed {
  readonly name: string
  readonly description: string
  readonly category: string
  readonly bodyMd: string
}

export const SKILL_SEEDS: readonly SkillSeed[] = [
  {
    name: 'brief-intake',
    description: 'Chuyển yêu cầu mơ hồ của người dùng thành brief 6 trường đủ để lập kế hoạch.',
    category: 'leadership',
    bodyMd: `
# Kỹ năng: Nhận brief

## 6 trường bắt buộc
1. **Mục tiêu** — kết quả kinh doanh mong muốn, không phải hoạt động ("tăng đăng ký dùng thử", không phải "làm content").
2. **KPI** — chỉ số đo được + mốc thời gian.
3. **Phạm vi** — làm gì, và quan trọng không kém: KHÔNG làm gì.
4. **Thời hạn** — ngày cần xong, các mốc trung gian.
5. **Ngân sách** — tiền và/hoặc số giờ người.
6. **Ràng buộc** — thương hiệu, pháp lý, kênh bắt buộc, điều cấm.

## Cách hỏi
- Hỏi tối đa 3 câu một lượt, ưu tiên trường chặn được nhiều việc nhất (thường là Mục tiêu và KPI).
- Mỗi câu nêu lựa chọn cụ thể để người dùng chỉ cần chọn, không phải nghĩ từ đầu.
- Không hỏi lại thông tin đã có trong hội thoại hoặc kho kiến thức.

## Khi người dùng không biết
Đề xuất 2–3 phương án mặc định kèm hệ quả của từng phương án, để người dùng chọn. Ghi rõ đâu là giả định.
`.trim(),
  },
  {
    name: 'task-decomposition',
    description: 'Chia mục tiêu thành các công việc nhỏ, giao đúng chuyên môn, xác định thứ tự phụ thuộc.',
    category: 'leadership',
    bodyMd: `
# Kỹ năng: Chia việc

## Nguyên tắc
1. Mỗi công việc có **một** đầu ra kiểm chứng được (artifact hoặc quyết định).
2. Mỗi công việc giao cho **một** chuyên môn — nếu cần hai, hãy tách.
3. Tối đa 8 công việc một kế hoạch; gộp việc nhỏ, tách việc quá lớn.
4. Xác định phụ thuộc thật (dữ liệu của việc A là đầu vào của việc B). Việc không phụ thuộc nhau phải chạy song song được.

## Thứ tự gợi ý
Nghiên cứu → Định vị/Chiến lược → Nội dung/Thiết kế → Kênh (SEO/Social/Ads/Email) → Đo lường.

## Kiểm tra trước khi giao
- Mọi công việc đều có đường tới mục tiêu đã chốt.
- Không có chu trình phụ thuộc.
- Nêu rõ cho mỗi chuyên môn: họ cần đọc tài liệu nào và cần dữ liệu nào.
`.trim(),
  },
  {
    name: 'quality-review',
    description: 'Checklist kiểm tra kết quả chuyên môn trước khi duyệt và tổng hợp báo cáo.',
    category: 'leadership',
    bodyMd: `
# Kỹ năng: Kiểm tra chất lượng

## Checklist
1. **Đủ đầu ra** — có đúng những gì đã cam kết trong brief công việc?
2. **Nguồn** — mọi số liệu có nguồn (tài liệu hoặc tool)? số liệu không nguồn phải bị đánh dấu.
3. **Thương hiệu** — giọng văn, thuật ngữ, tuyên bố có khớp brand guideline?
4. **Mục tiêu** — kết quả có thực sự phục vụ KPI đã chốt?
5. **Khả thi** — có thực hiện được với ngân sách/thời hạn đã nêu?
6. **An toàn** — có tuyên bố, hình ảnh hoặc cam kết cần phê duyệt/rà soát pháp lý?

## Cách phản hồi
- Nêu lý do cụ thể theo từng mục không đạt, kèm ví dụ trong nội dung.
- Đề xuất hướng sửa, không chỉ nói "chưa đạt".
- Tối đa 2 vòng sửa; sau đó quyết định với người dùng.
`.trim(),
  },
  {
    name: 'report-writing',
    description: 'Cấu trúc báo cáo cuối cùng cho người dùng: điều hành, bằng chứng, chi phí, đề xuất.',
    category: 'leadership',
    bodyMd: `
# Kỹ năng: Viết báo cáo

## Cấu trúc bắt buộc
1. **Tóm tắt điều hành** — 5 dòng, dành cho người bận: đã làm gì, kết quả chính, cần quyết định gì.
2. **Kết quả theo mục tiêu** — đối chiếu từng KPI đã chốt.
3. **Bằng chứng & nguồn** — liệt kê tài liệu/tool đã dùng để có số liệu.
4. **Chi phí & thời gian** — token/chi phí thực tế (lấy từ bảng chi phí), thời gian chạy.
5. **Rủi ro & giả định** — điều gì có thể làm kết quả sai.
6. **Đề xuất bước tiếp theo** — tối đa 3 việc, xếp theo tác động/chi phí.
7. **Phụ lục** — liên kết tới artifact đã tạo.

## Nguyên tắc
- Người đọc chỉ đọc mục 1 phải nắm được tình hình.
- Không đưa số liệu mới chưa xuất hiện trong bằng chứng.
- Nêu thẳng điều chưa làm được.
`.trim(),
  },
  {
    name: 'market-research',
    description: 'Phương pháp nghiên cứu thị trường có nguồn, tránh kết luận vô căn cứ.',
    category: 'research',
    bodyMd: `
# Kỹ năng: Nghiên cứu thị trường

## Quy trình
1. Viết 3–5 câu hỏi nghiên cứu cụ thể trước khi tìm kiếm.
2. Thu thập từ nhiều loại nguồn: báo cáo ngành, website đối thủ, diễn đàn/đánh giá, dữ liệu nội bộ.
3. Với mỗi số liệu: ghi nguồn, ngày công bố, ngày truy cập, phạm vi địa lý.
4. Tổng hợp thành bằng chứng ủng hộ và bằng chứng phản bác — không chỉ chọn dữ liệu thuận.
5. Kết luận kèm mức độ tin cậy (cao/trung bình/thấp) và lý do.

## Cờ cảnh báo
- Số liệu không nguồn hoặc nguồn không rõ phương pháp → đánh dấu "ước lượng".
- Dữ liệu cũ hơn 18 tháng trong ngành thay đổi nhanh → ghi chú thời hạn.
`.trim(),
  },
  {
    name: 'competitor-analysis',
    description: 'So sánh đối thủ theo tiêu chí có trọng số và rút ra khoảng trống cạnh tranh.',
    category: 'research',
    bodyMd: `
# Kỹ năng: Phân tích đối thủ

## Bảng so sánh
\`Đối thủ | Định vị | Sản phẩm | Giá | Kênh chính | Thông điệp | Điểm mạnh | Điểm yếu | Nguồn\`

## Trọng số
Chọn 5–7 tiêu chí khách hàng thực sự quan tâm, cho trọng số, chấm điểm 1–5. Nói rõ trọng số do đâu.

## Đầu ra phải có
- Khoảng trống chưa đối thủ nào chiếm (địa hạt có thể thắng).
- Điểm yếu chung của thị trường mà ta khai thác được.
- Cảnh báo: đối thủ nào mạnh đến mức không nên đối đầu trực diện.
`.trim(),
  },
  {
    name: 'persona-building',
    description: 'Dựng chân dung khách hàng mục tiêu từ dữ liệu, không phải từ suy đoán.',
    category: 'research',
    bodyMd: `
# Kỹ năng: Dựng chân dung khách hàng

## Một persona cần
- **Bối cảnh**: vai trò, quy mô, ngành, giai đoạn.
- **Vấn đề**: nỗi đau cụ thể, bằng ngôn ngữ của chính họ.
- **Kích hoạt**: sự kiện khiến họ bắt đầu tìm giải pháp.
- **Tiêu chí chọn**: điều gì khiến họ quyết định.
- **Phản đối**: lý do họ chần chừ.
- **Kênh & nội dung**: nơi họ tin tưởng.

## Quy tắc
- Ngôn ngữ và trích dẫn phải lấy từ dữ liệu thật (đánh giá, bình luận, khảo sát), không tự nghĩ ra.
- Mỗi dự án tối đa 3 persona trọng tâm; nhiều hơn thì không persona nào định hướng được nội dung.
`.trim(),
  },
  {
    name: 'copywriting',
    description: 'Cấu trúc bài viết bán hàng: hook, vấn đề, giải pháp, bằng chứng, CTA.',
    category: 'content',
    bodyMd: `
# Kỹ năng: Viết nội dung

## Khung
1. **Hook** — nói đúng nỗi đau hoặc mong muốn trong 2 dòng đầu.
2. **Vấn đề** — làm rõ cái giá phải trả khi không giải quyết.
3. **Giải pháp** — cơ chế tại sao nó hoạt động, không chỉ tính năng.
4. **Bằng chứng** — số liệu, ví dụ, trường hợp cụ thể (phải có thật).
5. **Xử lý phản đối** — trả lời 1–2 lý do phổ biến khiến người đọc chần chừ.
6. **CTA** — một hành động duy nhất, rõ ràng.

## Soát lại
- Cắt 20% độ dài sau lần viết đầu.
- Mỗi đoạn tối đa 3 câu.
- Không dùng từ ngữ sáo rỗng ("giải pháp toàn diện", "đột phá").
`.trim(),
  },
  {
    name: 'seo-writing',
    description: 'Viết bài chuẩn SEO: ý định tìm kiếm, cấu trúc heading, từ khoá tự nhiên.',
    category: 'content',
    bodyMd: `
# Kỹ năng: Viết bài chuẩn SEO

## Trước khi viết
- Xác định ý định tìm kiếm (thông tin / điều hướng / thương mại / giao dịch) — cấu trúc bài phải khớp ý định.
- Liệt kê từ khoá chính + 5–10 từ khoá phụ và thực thể liên quan.
- Xem 3 kết quả đang xếp đầu để biết chuẩn nội dung của truy vấn đó.

## Cấu trúc
- H1 chứa từ khoá chính, khớp ý định.
- H2/H3 bao phủ các câu hỏi phụ; mỗi mục trả lời trọn một câu hỏi.
- Đoạn mở đầu trả lời trực tiếp truy vấn trong 2–3 câu (tốt cho đoạn trích nổi bật).
- Liên kết nội bộ tới 2–4 trang liên quan, anchor mô tả.

## Tránh
- Nhồi từ khoá, văn bản sinh ra chỉ để lấp từ khoá.
- Tiêu đề giật tít không khớp nội dung.
`.trim(),
  },
  {
    name: 'brand-voice',
    description: 'Kiểm tra nội dung khớp giọng thương hiệu và thuật ngữ chuẩn.',
    category: 'content',
    bodyMd: `
# Kỹ năng: Giữ giọng thương hiệu

## Bắt buộc đọc trước
Tài liệu \`10-brand\`: brand guidelines, tone of voice, quy định pháp lý, thuật ngữ chuẩn.

## Checklist giọng
- Đại từ nhân xưng đúng quy ước (anh/chị/bạn hoặc "chúng tôi").
- Mức trang trọng đúng quy định.
- Thuật ngữ sản phẩm dùng đúng tên chính thức, không viết tắt tự chế.
- Không dùng từ bị cấm trong brand guideline.
- Mọi tuyên bố so sánh/ưu việt có cơ sở hoặc được hạ tông.

## Khi chưa có brand guideline
Báo cho Leader là thiếu tài liệu và đề xuất bổ sung — không tự chọn giọng.
`.trim(),
  },
  {
    name: 'keyword-research',
    description: 'Nghiên cứu từ khoá và gom thành cluster theo ý định tìm kiếm.',
    category: 'seo',
    bodyMd: `
# Kỹ năng: Nghiên cứu từ khoá

## Quy trình
1. Lấy dữ liệu thật từ Google Search Console trước (truy vấn đang có impression, vị trí 5–30 là cơ hội nhanh).
2. Mở rộng bằng từ khoá hạt giống: biến thể, câu hỏi, từ khoá địa phương, từ khoá so sánh.
3. Phân loại theo ý định: thông tin, so sánh, thương mại, giao dịch.
4. Gom cluster: mỗi cluster một trang trụ + trang vệ tinh; một ý định không tách thành hai trang gây loãng.

## Ưu tiên
Chấm điểm theo: liên quan thương mại × khối lượng × độ khó × khả năng ta thắng. Nêu rõ cách chấm.
`.trim(),
  },
  {
    name: 'technical-seo-audit',
    description: 'Audit kỹ thuật SEO theo checklist, xếp ưu tiên theo tác động.',
    category: 'seo',
    bodyMd: `
# Kỹ năng: Audit kỹ thuật SEO

## Checklist
- **Thu thập**: robots.txt, sitemap.xml, thẻ noindex, lỗi 404/5xx, redirect chuỗi.
- **Cấu trúc**: URL thân thiện, phân cấp, breadcrumb, liên kết nội bộ, trang mồ côi.
- **Trên trang**: title/description duy nhất, một H1, thứ bậc heading, alt ảnh.
- **Hiệu năng**: LCP, CLS, INP; ảnh nặng, script chặn render.
- **Dữ liệu có cấu trúc**: schema phù hợp loại trang, kiểm tra bằng công cụ.
- **Quốc tế/đa thiết bị**: hreflang, mobile-friendly.

## Đầu ra
Bảng \`Vấn đề | Mức độ (Chặn/Cao/Trung bình/Thấp) | Bằng chứng | Cách sửa | Công sức\`.
Sắp xếp theo tác động/công sức giảm dần; nêu 3 việc nên làm ngay.
`.trim(),
  },
  {
    name: 'content-calendar',
    description: 'Xây lịch nội dung theo tỉ lệ mục tiêu, nhịp đăng và khung giờ hợp lý.',
    category: 'social',
    bodyMd: `
# Kỹ năng: Lịch nội dung

## Thành phần
- **Tỉ lệ**: giá trị / thương hiệu / bán hàng — gợi ý 60/25/15.
- **Nhịp**: số bài mỗi tuần theo năng lực sản xuất thật, không theo mong muốn.
- **Khung giờ**: theo dữ liệu tương tác nếu có; nếu chưa có, chọn giờ hợp lý theo hành vi ngành và ghi rõ là giả định.
- **Pillar**: 3–4 chủ đề trụ, mỗi bài thuộc một trụ.

## Đầu ra
Bảng \`Tuần | Ngày | Kênh | Trụ | Định dạng | Chủ đề | Trạng thái\`.
Đảm bảo mỗi tuần có ít nhất một nội dung chuyển đổi.
`.trim(),
  },
  {
    name: 'social-copywriting',
    description: 'Viết caption theo nền tảng, có hook 2 dòng đầu và hashtag phù hợp.',
    category: 'social',
    bodyMd: `
# Kỹ năng: Viết caption mạng xã hội

## Cấu trúc
1. **Hook** (dòng 1–2): câu hỏi, con số gây chú ý, hoặc tuyên bố trái chiều có cơ sở.
2. **Thân**: một ý duy nhất, ví dụ cụ thể, dễ đọc trên điện thoại.
3. **CTA**: mời bình luận/chia sẻ/lưu hoặc bấm link.
4. **Hashtag**: 3–8 hashtag sát chủ đề, tránh hashtag quá chung.

## Theo nền tảng
- Facebook: dài vừa, kể chuyện, ít hashtag.
- LinkedIn: giọng chuyên môn, có bài học nghề, hashtag ngành.
- Instagram/TikTok: cực ngắn, hook mạnh, chữ trên hình quan trọng hơn caption.
Xác định nền tảng trước khi viết.
`.trim(),
  },
  {
    name: 'campaign-structure',
    description: 'Thiết kế cấu trúc chiến dịch quảng cáo và đặt tên nhất quán.',
    category: 'ads',
    bodyMd: `
# Kỹ năng: Cấu trúc chiến dịch

## Phân cấp
Chiến dịch (mục tiêu) → Nhóm quảng cáo (đối tượng) → Mẫu quảng cáo (thông điệp/hình ảnh).

## Quy ước đặt tên
\`<Kênh>_<Mục tiêu>_<Đối tượng>_<Địa lý>_<Tháng>_<Phiên bản>\`
Ví dụ: \`FB_Lead_ChuShop_HN_2026-11_v1\`

## Nguyên tắc
- Một nhóm quảng cáo = một giả thuyết đối tượng.
- Mỗi chiến dịch tối đa 3–5 nhóm để ngân sách đủ dữ liệu học.
- Luôn có nhóm đối chứng khi thử nghiệm.
`.trim(),
  },
  {
    name: 'audience-targeting',
    description: 'Chọn và mô tả nhóm đối tượng quảng cáo theo dữ liệu thực tế.',
    category: 'ads',
    bodyMd: `
# Kỹ năng: Nhắm đối tượng

## Phân lớp
- **Lạnh**: dựa trên sở thích, hành vi, từ khoá, lookalike từ nguồn tốt.
- **Ấm**: tương tác trang, xem video, truy cập web không mua.
- **Nóng**: giỏ hàng bỏ dở, danh sách khách cũ, người mua gần đây.

## Nguyên tắc
- Mỗi nhóm phải gắn với một thông điệp khác biệt; nếu cùng thông điệp thì gộp lại.
- Ghi rõ quy mô ước tính và nguồn dữ liệu.
- Loại trừ khách đã mua ở nhóm chuyển đổi để tránh chi phí thừa.
- Không nhắm vào nhóm nhạy cảm hoặc bị chính sách nền tảng cấm.
`.trim(),
  },
  {
    name: 'budget-optimization',
    description: 'Phân bổ ngân sách quảng cáo và quy tắc dịch chuyển theo hiệu quả.',
    category: 'ads',
    bodyMd: `
# Kỹ năng: Tối ưu ngân sách

## Phân bổ ban đầu
Chia ngân sách theo giả thuyết: 70% cho cấu trúc đã chứng minh, 20% mở rộng, 10% thử nghiệm cái mới.

## Quy tắc hành động
- Chỉ dịch chuyển ngân sách khi đã đủ tín hiệu (thường ≥ 50 chuyển đổi hoặc 1.000 click mỗi nhóm).
- Điều kiện dừng: CPL/CPA vượt ngưỡng trong 3 ngày liên tiếp.
- Tăng ngân sách tối đa 20–30% mỗi lần để tránh vượt giai đoạn học.
- Không kết luận từ mẫu quá nhỏ; ghi rõ độ tin cậy.

## Đầu ra
Kế hoạch phân bổ + bảng điều kiện dừng/giảm/tăng cho từng nhóm.
`.trim(),
  },
  {
    name: 'email-sequence',
    description: 'Thiết kế chuỗi email nurture theo giai đoạn phễu và hành vi người nhận.',
    category: 'email',
    bodyMd: `
# Kỹ năng: Chuỗi email

## Cấu trúc chuỗi
1. **Chào mừng** (ngay): xác lập giá trị, đặt kỳ vọng.
2. **Giáo dục** (2–4 email): giải vấn đề, xây dựng tin cậy.
3. **Chứng minh** (1–2 email): trường hợp khách hàng, số liệu.
4. **Đề nghị** (1–2 email): lời đề nghị rõ, có thời hạn nếu phù hợp.
5. **Nhắc lại** (1 email): xử lý phản đối, lối thoát nhẹ nhàng.

## Mỗi email gồm
Tiêu đề (+3 phương án), preview text, thân ngắn, một CTA, và mục "không muốn nhận nữa".

## Nguyên tắc
- Một email một ý, một hành động.
- Khoảng cách 2–4 ngày; dừng chuỗi ngay khi người nhận chuyển đổi.
`.trim(),
  },
  {
    name: 'crm-segmentation',
    description: 'Phân nhóm khách hàng theo hành vi và giá trị để cá nhân hoá thông điệp.',
    category: 'email',
    bodyMd: `
# Kỹ năng: Phân nhóm CRM

## Tiêu chí phân nhóm
- **Vòng đời**: mới · đang cân nhắc · khách hàng · khách cũ · rời bỏ.
- **Hành vi**: đã xem gì, đã mua gì, tương tác email gần nhất.
- **Giá trị**: doanh thu, tần suất, tiềm năng mở rộng.

## Yêu cầu dữ liệu
Với mỗi nhóm, nêu rõ trường dữ liệu cần có và nguồn. Nếu thiếu dữ liệu, đề xuất cách thu thập.

## Đầu ra
Bảng \`Nhóm | Tiêu chí | Thông điệp | Kênh | Tần suất | Mục tiêu\`.
`.trim(),
  },
  {
    name: 'creative-brief',
    description: 'Viết brief thiết kế: thông điệp, thứ bậc, hình ảnh, màu, kích thước.',
    category: 'design',
    bodyMd: `
# Kỹ năng: Brief thiết kế

## Brief tối thiểu
- **Mục tiêu**: ấn phẩm này phải đạt gì.
- **Thông điệp chính**: một câu duy nhất.
- **Thứ bậc thông tin**: thứ tự mắt người xem đi qua.
- **Hình ảnh chủ đạo**: chủ thể, phong cách, cảm xúc.
- **Màu & typography**: theo brand guideline, ghi mã màu/font cụ thể.
- **Kích thước & định dạng**: theo từng kênh (1:1, 4:5, 9:16…).
- **Điều cần tránh**: yếu tố đã thử và không hiệu quả.

## Kiểm tra
Mọi yếu tố thương hiệu phải lấy từ \`10-brand\`; nếu thiếu, yêu cầu bổ sung thay vì tự sáng tác.
`.trim(),
  },
  {
    name: 'storyboarding',
    description: 'Dựng storyboard video theo cảnh với thời lượng và lời thoại.',
    category: 'design',
    bodyMd: `
# Kỹ năng: Storyboard

## Cấu trúc video ngắn (15–60s)
- **0–3s Hook**: hình ảnh hoặc câu gây chú ý ngay.
- **3–10s Vấn đề**: nêu nỗi đau cụ thể.
- **10–30s Giải pháp**: sản phẩm/dịch vụ xuất hiện, cơ chế hoạt động.
- **30–50s Bằng chứng**: demo, kết quả, trích dẫn.
- **50–60s CTA**: một hành động, chữ lớn trên màn hình.

## Bảng storyboard
\`Cảnh | Thời lượng | Hình ảnh | Chữ trên màn hình | Lời thoại/lồng tiếng | Chuyển cảnh\`

## Lưu ý
- Viết kịch bản đọc lên nghe tự nhiên; đọc thử và đếm thời lượng.
- Ghi rõ khi nào cần quay mới, khi nào dùng được tư liệu sẵn có.
`.trim(),
  },
  {
    name: 'data-analysis',
    description: 'Phân tích dữ liệu marketing đúng phương pháp, nói rõ giới hạn.',
    category: 'analytics',
    bodyMd: `
# Kỹ năng: Phân tích dữ liệu

## Quy trình
1. Chốt câu hỏi và KPI trước khi truy vấn.
2. Kiểm tra chất lượng dữ liệu: khoảng thời gian, mẫu thiếu, trùng lặp, thay đổi tracking.
3. Mô tả trước khi suy luận: xu hướng, mùa vụ, so sánh kỳ trước.
4. Tách tín hiệu khỏi nhiễu: nêu cỡ mẫu, độ biến động, mức ý nghĩa khi có thể.
5. Kết luận kèm giới hạn: dữ liệu không trả lời được gì.

## Cạm bẫy phải tránh
- Kết luận nhân quả từ tương quan.
- So sánh hai kỳ có tracking khác nhau.
- Chọn mốc thời gian để câu chuyện đẹp hơn.
- Bỏ qua mẫu nhỏ.
`.trim(),
  },
  {
    name: 'kpi-reporting',
    description: 'Báo cáo KPI theo kênh và phễu, gắn số liệu với nguồn.',
    category: 'analytics',
    bodyMd: `
# Kỹ năng: Báo cáo KPI

## Khung phễu
Nhận biết (impression, reach) → Cân nhắc (click, engagement, session) → Chuyển đổi (lead, đơn, doanh thu) → Giữ chân (tái mua, LTV).

## Bảng bắt buộc
\`Chỉ số | Kỳ này | Kỳ trước | Thay đổi % | Mục tiêu | Nguồn (GA4/GSC/Ads) | Ghi chú\`

## Nguyên tắc
- Mọi con số kèm khoảng thời gian và nguồn.
- Nêu rõ chỉ số nào không lấy được và vì sao.
- Kết thúc bằng 3 hành động đề xuất, xếp theo tác động.
`.trim(),
  },
  {
    name: 'anomaly-detection',
    description: 'Phát hiện bất thường trong chỉ số marketing và đề xuất nguyên nhân.',
    category: 'analytics',
    bodyMd: `
# Kỹ năng: Phát hiện bất thường

## Cách làm
1. Xác lập nền: trung bình và độ lệch chuẩn của 4–8 tuần trước, cùng thứ trong tuần.
2. Cờ bất thường: lệch > 2 độ lệch chuẩn, hoặc thay đổi > 30% so với cùng kỳ.
3. Loại trừ nguyên nhân kỹ thuật trước: tracking hỏng, chậm dữ liệu, thay đổi cấu hình, lễ/tết.
4. Kiểm tra tương quan thời điểm: có thay đổi chiến dịch, deploy, hoặc sự kiện bên ngoài không.
5. Kết luận kèm mức độ tin cậy và bước xác minh tiếp theo.

## Đầu ra
Bảng \`Chỉ số | Giá trị | Nền | Độ lệch | Ngày phát hiện | Giả thuyết | Cách xác minh\`.
`.trim(),
  },
  {
    name: 'community-response',
    description: 'Phân loại và trả lời tương tác cộng đồng theo giọng thương hiệu.',
    category: 'community',
    bodyMd: `
# Kỹ năng: Trả lời cộng đồng

## Phân loại
Hỏi thông tin · Phàn nàn · Khen ngợi · Khủng hoảng · Spam.

## Khung trả lời
1. **Xác nhận**: ghi nhận điều người dùng nói ("Cảm ơn anh/chị đã phản hồi…").
2. **Trả lời**: đi thẳng vào câu hỏi, không vòng vo.
3. **Bước tiếp theo**: hành động cụ thể + mốc thời gian, hoặc kênh riêng để trao đổi chi tiết.
4. **Chuyển riêng**: với vấn đề cá nhân/đơn hàng, mời sang tin nhắn riêng.

## Tránh
- Tranh cãi công khai, giọng phòng thủ.
- Hứa bồi thường/chính sách khi chưa được duyệt.
- Trả lời máy móc, sao chép cho mọi bình luận.
`.trim(),
  },
  {
    name: 'crisis-escalation',
    description: 'Nhận diện khủng hoảng truyền thông, đánh giá mức độ và leo thang kèm khuyến nghị.',
    category: 'community',
    bodyMd: `
# Kỹ năng: Leo thang khủng hoảng

## Dấu hiệu
- Cùng một khiếu nại xuất hiện lặp lại từ nhiều người trong thời gian ngắn.
- Có người có ảnh hưởng (KOL/báo chí) tham gia.
- Nội dung liên quan tới an toàn, sức khoẻ, pháp lý, dữ liệu cá nhân.
- Tốc độ lan truyền tăng theo cấp số (chia sẻ/bình luận tăng vọt).

## Mức độ
- **Thấp**: cá nhân, có thể xử lý bằng trả lời chuẩn.
- **Trung bình**: lan trong nhóm cộng đồng, cần phản hồi chính thức.
- **Cao**: lan rộng/ có báo chí, cần người có thẩm quyền phát ngôn.

## Leo thang ngay khi mức Trung bình trở lên
Gửi Leader: tóm tắt sự việc, bằng chứng (liên kết, ảnh chụp), mức độ, khuyến nghị 2–3 phương án, và đề xuất người phát ngôn.
KHÔNG tự phát ngôn thay công ty.
`.trim(),
  },
]

/** Skill name → seed, for validation and lookup. */
export const SKILL_SEED_BY_NAME = new Map(SKILL_SEEDS.map((skill) => [skill.name, skill]))
