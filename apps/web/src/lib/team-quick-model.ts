/**
 * Quy tắc của hộp thoại "Cấu hình nhanh model".
 *
 * Vì sao tách thành hàm thuần thay vì viết thẳng trong component: đây là chỗ dễ làm mất
 * cấu hình của người dùng nhất — "gán theo tier" mà for-each nhầm thì một cú bấm sẽ XOÁ
 * model của những agent thuộc tier để trống, còn "lưu" mà không so sánh thì gọi API cho cả
 * 10 agent mỗi lần bấm. Hàm thuần thì khoá được từng quy tắc bằng test, không cần dựng
 * giao diện.
 *
 * Nguyên tắc chung: mọi hàm đều KHÔNG sửa tham số đầu vào, trả về bản mới (hoặc chính đối
 * tượng cũ khi không có gì đổi), để React so sánh tham chiếu mà bỏ qua render thừa.
 */
import type { ModelTier, TeamMemberView } from '@marketing-agent/shared'

/** Bản nháp nhanh của một agent: chỉ hai trường model, không đụng kỹ năng/tool/quyền. */
export interface BanNhapNhanh {
  readonly modelFk: string
  readonly fallbackModelFks: readonly string[]
}

export type BanNhapNhanhTheoVaiTro = Readonly<Record<string, BanNhapNhanh>>

/** Số model dự phòng tối đa mỗi agent, khớp ràng buộc `updateTeamMemberSchema` ở server. */
export const TOI_DA_DU_PHONG = 5

/** Hai danh sách cùng nội dung và cùng thứ tự; dùng để phát hiện "có thay đổi". */
export function cungDanhSach(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false
  }
  return true
}

/**
 * Bản nháp ban đầu, lấy đúng dữ liệu server trả về.
 *
 * `modelFk` null của server đổi thành `''` vì `<select>` chỉ làm việc với chuỗi; `''` mang
 * nghĩa "chưa chọn model chính" và khi lưu sẽ được đổi ngược lại thành `null`.
 */
export function taoBanNhapNhanh(members: readonly TeamMemberView[]): BanNhapNhanhTheoVaiTro {
  const map: Record<string, BanNhapNhanh> = {}
  for (const member of members) {
    map[member.role] = {
      modelFk: member.modelFk ?? '',
      fallbackModelFks: [...member.fallbackModelFks],
    }
  }
  return map
}

/** Gán một model chính cho MỌI agent. Model rỗng là thao tác vô nghĩa nên trả nguyên trạng. */
export function ganModelChinhTatCa(
  banNhap: BanNhapNhanhTheoVaiTro,
  modelFk: string,
): BanNhapNhanhTheoVaiTro {
  if (modelFk.length === 0) return banNhap
  const next: Record<string, BanNhapNhanh> = {}
  for (const [role, entry] of Object.entries(banNhap)) next[role] = { ...entry, modelFk }
  return next
}

/**
 * Gán model chính theo tier của từng agent.
 *
 * BẤT BIẾN: tier có giá trị rỗng thì BỎ QUA, không xoá model của các agent thuộc tier đó.
 * Người dùng thường chỉ muốn đổi một tier và giữ nguyên hai tier còn lại; coi rỗng là "xoá"
 * sẽ khiến họ mất cấu hình vừa chọn mà không có cảnh báo nào.
 */
export function ganModelChinhTheoTier(
  members: readonly TeamMemberView[],
  banNhap: BanNhapNhanhTheoVaiTro,
  theoTTier: Readonly<Record<ModelTier, string>>,
): BanNhapNhanhTheoVaiTro {
  const next: Record<string, BanNhapNhanh> = { ...banNhap }
  let coDoi = false
  for (const member of members) {
    const chon = theoTTier[member.tier]
    if (!chon || chon.length === 0) continue
    const entry = next[member.role]
    if (!entry || entry.modelFk === chon) continue
    next[member.role] = { ...entry, modelFk: chon }
    coDoi = true
  }
  return coDoi ? next : banNhap
}

/**
 * Thêm một model vào CUỐI danh sách dự phòng của mọi agent.
 *
 * Vì sao là "thêm" chứ không phải "đặt": người dùng có thể đã cấu hình dự phòng riêng cho
 * từng agent; thay thế cả danh sách bằng một cú bấm sẽ xoá công đó. Bỏ qua agent đã có model
 * này hoặc đã đủ `toiDa` để không tạo dữ liệu vượt ràng buộc server.
 */
export function themDuPhongTatCa(
  banNhap: BanNhapNhanhTheoVaiTro,
  modelFk: string,
  toiDa: number = TOI_DA_DU_PHONG,
): BanNhapNhanhTheoVaiTro {
  if (modelFk.length === 0) return banNhap
  let coDoi = false
  const next: Record<string, BanNhapNhanh> = {}
  for (const [role, entry] of Object.entries(banNhap)) {
    if (entry.fallbackModelFks.includes(modelFk) || entry.fallbackModelFks.length >= toiDa) {
      next[role] = entry
      continue
    }
    next[role] = { ...entry, fallbackModelFks: [...entry.fallbackModelFks, modelFk] }
    coDoi = true
  }
  return coDoi ? next : banNhap
}

/** Vai trò có thay đổi so với dữ liệu server: model chính hoặc danh sách dự phòng. */
export function dsVaiTroThayDoi(
  members: readonly TeamMemberView[],
  banNhap: BanNhapNhanhTheoVaiTro,
): readonly string[] {
  const out: string[] = []
  for (const member of members) {
    const entry = banNhap[member.role]
    if (!entry) continue
    if (entry.modelFk !== (member.modelFk ?? '')) {
      out.push(member.role)
      continue
    }
    if (!cungDanhSach(entry.fallbackModelFks, member.fallbackModelFks)) out.push(member.role)
  }
  return out
}

export interface CapNhatNhanh {
  readonly role: string
  /** `null` nghĩa là bỏ model chính, để agent dùng route theo tier. */
  readonly modelFk: string | null
  /** Chỉ có mặt khi danh sách dự phòng thật sự đổi. */
  readonly fallbackModelFks?: readonly string[]
}

/**
 * Payload để lưu: CHỈ những agent thay đổi, và CHỈ trường model.
 *
 * Không bao giờ gửi `skills`/`tools`/`knowledge`/`enabled`: cấu hình nhanh không được phép
 * ghi đè những phần mà người dùng đã chỉnh riêng ở từng thẻ agent.
 */
export function thanhCapNhat(
  members: readonly TeamMemberView[],
  banNhap: BanNhapNhanhTheoVaiTro,
): readonly CapNhatNhanh[] {
  const updates: CapNhatNhanh[] = []
  for (const member of members) {
    const entry = banNhap[member.role]
    if (!entry) continue
    const doiModel = entry.modelFk !== (member.modelFk ?? '')
    const doiDuPhong = !cungDanhSach(entry.fallbackModelFks, member.fallbackModelFks)
    if (!doiModel && !doiDuPhong) continue
    updates.push({
      role: member.role,
      modelFk: entry.modelFk.length > 0 ? entry.modelFk : null,
      ...(doiDuPhong ? { fallbackModelFks: [...entry.fallbackModelFks] } : {}),
    })
  }
  return updates
}
