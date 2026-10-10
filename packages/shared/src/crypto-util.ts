/**
 * Tiện ích cần `node:crypto`.
 *
 * Vì sao tách khỏi `util.ts`: `util.ts` được giao diện web dùng (ước lượng token,
 * cắt chuỗi), nhưng `node:crypto` không tồn tại trong trình duyệt. Bundle giao diện
 * sẽ hỏng nếu hai nhóm này nằm chung một module. Mọi thứ ở đây chỉ dùng phía server.
 */
import { createHash, randomBytes, randomUUID } from 'node:crypto'

/** Id ngẫu nhiên kiểu UUID v4. */
export const newId = (): string => randomUUID()

/** Id có tiền tố đọc được, ví dụ `task_1f2c…` — giúp đọc log dễ hơn. */
export function prefixedId(prefix: string): string {
  return `${prefix}_${randomUUID().replaceAll('-', '').slice(0, 24)}`
}

/** Checksum nội dung, dùng để phát hiện tài liệu không đổi trong chỉ mục kiến thức. */
export const sha256 = (input: string | Buffer): string =>
  createHash('sha256').update(input).digest('hex')

/** Token ngẫu nhiên an toàn, dùng cho token phiên. */
export const randomToken = (bytes = 32): string => randomBytes(bytes).toString('base64url')
