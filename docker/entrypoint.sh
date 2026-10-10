#!/usr/bin/env bash
#
# Entrypoint của container.
#
# Vì sao cần script thay vì CMD trực tiếp: lần chạy đầu tiên trên một volume trống
# phải tự cài catalog (định nghĩa agent + model + provider). Nếu bỏ bước đó, người
# vận hành sẽ gặp lỗi khó hiểu ở lần tạo công ty đầu tiên. Script này chỉ chạy seed
# khi catalog THỰC SỰ trống, nên restart bình thường không ghi đè gì.
#
# Lệnh:
#   start   (mặc định) seed nếu cần, rồi chạy server
#   seed    chỉ chạy seed rồi thoát (dùng để cài catalog thủ công)
#   index   index kho kiến thức của mọi công ty rồi thoát
#   shell   mở bash để gỡ lỗi
set -euo pipefail

log() { printf '[entrypoint] %s\n' "$*"; }

require_env() {
  if [ -z "${!1:-}" ]; then
    log "LỖI: thiếu biến môi trường $1. Xem .env.example."
    exit 1
  fi
}

# Catalog rỗng hay chưa? Đọc thẳng bằng node để không phụ thuộc công cụ ngoài.
catalog_trong() {
  node --input-type=module -e '
    import Database from "better-sqlite3";
    import { existsSync } from "node:fs";
    const file = process.env.DATABASE_PATH ?? "data/marketing.db";
    if (!existsSync(file)) { console.log("empty"); process.exit(0); }
    try {
      const db = new Database(file, { readonly: true });
      const row = db.prepare("SELECT COUNT(*) AS n FROM agent_defs").get();
      console.log(row && row.n > 0 ? "full" : "empty");
      db.close();
    } catch {
      // Bảng chưa tồn tại nghĩa là migration chưa chạy -> coi như trống.
      console.log("empty");
    }
  '
}

seed_neu_can() {
  local state
  state="$(catalog_trong | tail -n 1)"
  if [ "$state" = "full" ]; then
    log "catalog đã có, bỏ qua seed."
    return 0
  fi
  log "catalog trống, đang cài (10 agent + kỹ năng + provider + model)…"
  pnpm db:seed
}

index_moi_cong_ty() {
  # Mỗi công ty có thư mục kho kiến thức riêng; index lại tất cả là an toàn vì
  # indexer bỏ qua tài liệu không đổi (so theo checksum).
  local slug
  for dir in "${COMPANIES_ROOT:-/data/companies}"/*/; do
    [ -d "$dir" ] || continue
    slug="$(basename "$dir")"
    log "index kho kiến thức: $slug"
    pnpm kb:index --company "$slug" --root "$dir/kb" || log "cảnh báo: index $slug thất bại, bỏ qua"
  done
}

case "${1:-start}" in
  start)
    require_env APP_SECRET
    seed_neu_can
    log "khởi động server trên ${HOST:-0.0.0.0}:${PORT:-3000}"
    exec pnpm start
    ;;
  seed)
    require_env APP_SECRET
    exec pnpm db:seed "${@:2}"
    ;;
  index)
    require_env APP_SECRET
    index_moi_cong_ty
    ;;
  shell)
    exec bash
    ;;
  *)
    log "lệnh không rõ: $1"
    log "dùng: start | seed | index | shell"
    exit 2
    ;;
esac
