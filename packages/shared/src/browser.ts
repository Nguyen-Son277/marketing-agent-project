/**
 * Điểm vào dành cho trình duyệt.
 *
 * Vì sao cần tệp này thay vì dùng chung `index.ts`: `index.ts` re-export `crypto-util.ts`
 * (dùng `node:crypto`), nên bất kỳ VALUE import nào từ gói này cũng kéo `node:crypto`
 * vào bundle và làm hỏng build giao diện. Ở đây chỉ export những module thuần:
 *
 *  - `domain.ts`  — hằng số và union type, không phụ thuộc gì
 *  - `api.ts`     — hợp đồng API, chỉ type + một bảng đường dẫn
 *  - `errors.ts`  — AppError, dùng được cả hai phía
 *  - `schemas.ts` — zod (chạy được trong trình duyệt)
 *  - `types.ts`   — toàn type, bị xoá khi biên dịch
 *  - `util.ts`    — tiện ích thuần, KHÔNG có `node:*`
 *
 * Tuyệt đối không thêm `crypto-util.ts` vào đây. Giao diện không cần sinh id hay
 * băm nội dung; nếu một màn hình cần, hãy để server làm và trả kết quả về.
 */
export * from './domain.ts'
export * from './errors.ts'
export * from './schemas.ts'
export * from './types.ts'
export * from './util.ts'
export * from './api.ts'
export * from './workforce.ts'
