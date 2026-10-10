/**
 * Lọc và tìm kiếm trong danh sách model lấy từ nhà cung cấp.
 *
 * Vì sao tách thành hàm thuần thay vì viết thẳng trong component: gateway nội bộ trả về
 * **726 model**, nên đây là chỗ người dùng thao tác nhiều nhất và cũng là chỗ dễ sai nhất —
 * "chọn tất cả" mà tác động lên cả 726 dòng thay vì chỉ những dòng đang hiện sẽ khiến người
 * dùng nhập nhầm hàng trăm model vào hệ thống. Hàm thuần thì test được từng quy tắc mà
 * không cần dựng giao diện.
 */
import type { FetchedModelView } from '@marketing-agent/shared'

/**
 * Bỏ dấu tiếng Việt và ký tự không phải chữ/số, để tìm không phân biệt hoa thường và dấu.
 *
 * Vì sao cần: người dùng gõ "claude" hay "Claude" hay "CLAUDE" đều phải ra cùng kết quả,
 * và tên model trong thực tế có đủ kiểu viết. Bỏ dấu `đ` riêng vì `normalize('NFD')` không
 * tách được ký tự này.
 */
export function chuanHoaTimKiem(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

export interface BoLocModel {
  /** Từ khoá tìm theo mã model hoặc tên hiển thị. */
  readonly tuKhoa: string
  /** Chỉ hiện model chưa có trong hệ thống. */
  readonly chiChuaThem: boolean
}

export const BO_LOC_MODEL_MAC_DINH: BoLocModel = { tuKhoa: '', chiChuaThem: true }

/**
 * Lọc danh sách model theo từ khoá và trạng thái đã thêm.
 *
 * Thứ tự áp dụng: lọc trước, tìm sau — cũng cho cùng kết quả, nhưng đọc theo thứ tự này
 * thì rõ ràng hơn khi phải sửa về sau.
 */
export function locModel(
  models: readonly FetchedModelView[],
  boLoc: BoLocModel,
): readonly FetchedModelView[] {
  const daThem = boLoc.chiChuaThem ? models.filter((model) => !model.alreadyAdded) : models
  const tuKhoa = chuanHoaTimKiem(boLoc.tuKhoa)
  if (tuKhoa.length === 0) return daThem

  // Tách từ khoá thành từng từ và yêu cầu MỌI từ đều xuất hiện: gõ "claude opus" phải ra
  // "claude-opus-5-5" chứ không phải mọi model có chữ "claude".
  const tu = tuKhoa.split(' ').filter(Boolean)
  return daThem.filter((model) => {
    const duyet = chuanHoaTimKiem(`${model.modelId} ${model.label}`)
    return tu.every((phan) => duyet.includes(phan))
  })
}

/** Số model đã chọn mà vẫn còn trong danh sách đang hiện (để nút nhập đúng số lượng). */
export function demDaChon(
  models: readonly FetchedModelView[],
  daChon: readonly string[],
): number {
  const chon = new Set(daChon)
  return models.filter((model) => chon.has(model.modelId)).length
}

/** Bật/tắt một model trong danh sách đã chọn. Model đã có trong hệ thống thì bỏ qua. */
export function daoChon(daChon: readonly string[], model: FetchedModelView): readonly string[] {
  if (model.alreadyAdded) return daChon
  const chon = new Set(daChon)
  if (chon.has(model.modelId)) chon.delete(model.modelId)
  else chon.add(model.modelId)
  return [...chon]
}

/**
 * Chọn tất cả model ĐANG HIỆN, hoặc bỏ chọn nếu tất cả đã được chọn.
 *
 * Cố ý chỉ nhận danh sách đã lọc chứ không nhận toàn bộ danh sách gốc. Đây là bất biến quan
 * trọng nhất của tệp này: người dùng gõ tìm kiếm để thu hẹp rồi bấm "chọn tất cả", và họ
 * mong đợi chọn đúng những gì đang nhìn thấy. Nếu chọn cả danh sách gốc thì một cú bấm sẽ
 * nhập hàng trăm model ngoài ý muốn.
 */
export function chonTatCaDangHien(
  dangHien: readonly FetchedModelView[],
  daChon: readonly string[],
): readonly string[] {
  const chon = new Set(daChon)
  const chonDuoc = dangHien.filter((model) => !model.alreadyAdded)
  // Không có gì để chọn thì KHÔNG làm gì. Thiếu điều kiện `length > 0` này, `every` trên
  // mảng rỗng trả về `true`, và hàm sẽ hiểu nhầm thành "đã chọn hết" rồi đi BỎ CHỌN những
  // model đang chọn ở phần bị bộ lọc ẩn — đúng kiểu mất dữ liệu ngoài ý muốn.
  if (chonDuoc.length === 0) return daChon
  const daChonHet = chonDuoc.every((model) => chon.has(model.modelId))

  if (daChonHet) {
    for (const model of chonDuoc) chon.delete(model.modelId)
  } else {
    for (const model of chonDuoc) chon.add(model.modelId)
  }
  return [...chon]
}
