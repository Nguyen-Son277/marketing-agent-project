#!/usr/bin/env bash
#
# Kịch bản nghiệm thu đầu-cuối với LLM THẬT.
#
# Vì sao cần kịch bản này ngoài bộ test: bộ test dùng adapter giả, nên nó chứng minh
# luồng dữ liệu đúng nhưng KHÔNG chứng minh được rằng model thật chịu tuân theo định
# dạng mà hệ thống cần — cụ thể là Leader phải trình bày kế hoạch dưới dạng bảng
# Markdown bốn cột mà `parsePlanTable` đọc được. Đây là điểm dễ vỡ nhất khi đổi model
# hoặc đổi gateway, và chỉ lộ ra khi gọi model thật.
#
# Cách dùng:
#   BASE_URL=http://127.0.0.1:3998 bash scripts/acceptance.sh
#
# Yêu cầu: server đang chạy và đã cấu hình provider trỏ tới gateway thật.
set -euo pipefail

BASE_URL="${BASE_URL:-http://127.0.0.1:3000}"
EMAIL="${EMAIL:-acceptance-$(date +%s)@example.com}"
PASSWORD="${PASSWORD:-matkhau-rat-dai-123}"
COOKIES="$(mktemp)"
trap 'rm -f "$COOKIES"' EXIT

buoc() { printf '\n== %s\n' "$*"; }
loi() { printf 'THẤT BẠI: %s\n' "$*" >&2; exit 1; }

# Gọi một endpoint và trả JSON.
#
# Vì sao kiểm mã HTTP ở đây thay vì để `curl -f`: lỗi của API là JSON có cấu trúc
# (`{error:{code,message}}`) và thông điệp đó là thứ cần đọc khi gỡ lỗi. `-f` sẽ
# nuốt mất nó và chỉ trả về mã thoát khô khan.
goi() {
  local method="$1" path="$2" body="${3:-}"
  local args=(-sS -m 600 -b "$COOKIES" -c "$COOKIES" -X "$method" "$BASE_URL$path" -H 'Accept: application/json')
  [ -n "$body" ] && args+=(-H 'Content-Type: application/json' -d "$body")
  local response
  response="$(curl "${args[@]}")" || { printf '   curl lỗi (mã %s) khi gọi %s %s\n' "$?" "$method" "$path" >&2; return 1; }
  printf '%s' "$response"
}

# Gọi và thoát kèm thông điệp API nếu không phải 2xx.
goi_bat_buoc() {
  local method="$1" path="$2" body="${3:-}"
  local response
  response="$(goi "$method" "$path" "$body")" || loi "không gọi được $method $path"
  # Chỉ coi là lỗi khi phong bì lỗi ở CẤP CAO NHẤT ({"error":{...}}). Không được chỉ
  # grep chuỗi '"error"' vì dữ liệu hợp lệ có thể chứa khoá đó ở nơi khác — đã gặp
  # thật: phản hồi /run chứa trường "error" trong bản ghi lượt chạy và bị coi là lỗi.
  if printf '%s' "$response" | python3 -c "
import json, sys
try:
    payload = json.load(sys.stdin)
except Exception:
    sys.exit(1)
sys.exit(0 if isinstance(payload, dict) and 'error' in payload else 1)
"; then
    printf '   API trả lỗi: %s\n' "$(printf '%s' "$response" | head -c 600)" >&2
    return 1
  fi
  printf '%s' "$response"
}

json() { python3 -c "import sys,json;d=json.load(sys.stdin);print($1)" 2>/dev/null; }

buoc "1/8 Sức khoẻ hệ thống"
goi GET /readyz | grep -q '"status":"ready"' || loi "server chưa ready"
goi GET /api/system/status | grep -q '"ready":true' || loi "catalog chưa sẵn sàng"

buoc "2/8 Đăng ký người dùng"
goi POST /api/auth/register "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\",\"name\":\"Nghiệm thu\"}" >/dev/null || true
goi POST /api/auth/login "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}" | grep -q '"id"' || loi "đăng nhập thất bại"
echo "   đăng nhập OK: $EMAIL"
STATUS=$(goi GET /api/auth/me | json "d['user']['approvalStatus']")
[ "$STATUS" = "approved" ] || loi "Tài khoản $EMAIL đang chờ admin duyệt. Duyệt qua giao diện admin rồi chạy lại với EMAIL=$EMAIL; kịch bản không tự vượt hàng rào duyệt."

buoc "3/8 Tạo công ty (kèm 10 agent + phân quyền tri thức)"
COMPANY=$(goi POST /api/companies '{"name":"Cong Ty Nghiem Thu"}')
COMPANY_ID=$(printf '%s' "$COMPANY" | json "d['company']['id']")
[ -n "$COMPANY_ID" ] || loi "không tạo được công ty: $COMPANY"
echo "   companyId=$COMPANY_ID"

buoc "4/8 Kiểm tra đội agent đã cấu hình đủ"
TEAM=$(goi GET "/api/companies/$COMPANY_ID/team")
SO_AGENT=$(printf '%s' "$TEAM" | json "len(d['members'])")
echo "   số agent: $SO_AGENT"
[ "$SO_AGENT" = "10" ] || loi "mong đợi 10 agent, nhận được $SO_AGENT"

buoc "5/8 Tạo cuộc trao đổi và chốt brief với Leader thật"
CONV=$(goi POST "/api/companies/$COMPANY_ID/conversations" '{"title":"Chiến dịch tháng 11"}')
CONV_ID=$(printf '%s' "$CONV" | json "d['conversation']['id']")
[ -n "$CONV_ID" ] || loi "không tạo được cuộc trao đổi"

BRIEF='Chốt brief: mục tiêu tăng 30% đăng ký dùng thử Sapa POS trong quý 4; KPI 150 lead chất lượng mỗi tháng với CPL không quá 120.000đ; phạm vi chỉ kênh Facebook và SEO, KHÔNG chạy TikTok lần này; thời hạn 31/12/2026; ngân sách 80 triệu VNĐ tiền quảng cáo; ràng buộc: không dùng ảnh khách hàng chưa xin phép và giữ giọng thương hiệu hiện tại.'
TRA_LOI=$(goi POST "/api/conversations/$CONV_ID/messages" "$(python3 -c "
import json,sys
print(json.dumps({'content': sys.argv[1]}))" "$BRIEF")")
DU_BRIEF=$(printf '%s' "$TRA_LOI" | json "d['briefComplete']")
echo "   briefComplete=$DU_BRIEF"
[ "$DU_BRIEF" = "True" ] || loi "Leader chưa chốt được brief: $(printf '%s' "$TRA_LOI" | head -c 400)"

buoc "6/8 Lập kế hoạch bằng model thật (điểm dễ vỡ nhất)"
KE_HOACH=$(goi_bat_buoc POST "/api/conversations/$CONV_ID/plan" '{}') || loi "gọi /plan thất bại"
SO_VIEC=$(printf '%s' "$KE_HOACH" | json "len(d['tasks'])")
if [ -z "$SO_VIEC" ] || [ "$SO_VIEC" = "0" ]; then
  echo "   phản hồi: $(printf '%s' "$KE_HOACH" | head -c 600)"
  loi "Leader không trình bày kế hoạch dưới dạng bảng Markdown mà parser đọc được"
fi
echo "   kế hoạch: $SO_VIEC công việc"
printf '%s' "$KE_HOACH" | python3 -c "
import json,sys
d=json.load(sys.stdin)
for t in d['tasks']:
    print('   -', t['title'], '→', t['assigneeRole'], '(sau:', ', '.join(t['dependsOn']) or 'không', ')')
"

buoc "7/8 Chạy kế hoạch với các agent thật"
CHAY=$(goi_bat_buoc POST "/api/conversations/$CONV_ID/run" '{}') || loi "gọi /run thất bại"
printf '%s' "$CHAY" | python3 -c "
import json,sys
d=json.load(sys.stdin)
s=d['summary']
print('   hoàn thành:', s['completed'], '| bị chặn:', s['blocked'], '| thất bại:', s['failed'])
print('   kết luận kiểm tra chất lượng:', d['review']['verdict'])
"
XONG=$(printf '%s' "$CHAY" | json "d['summary']['completed']")
[ -n "$XONG" ] || loi "không đọc được kết quả chạy"

buoc "8/8 Viết báo cáo và kiểm tra đủ bảy mục"
BAO_CAO=$(goi_bat_buoc POST "/api/conversations/$CONV_ID/report" '{}') || loi "gọi /report thất bại"
printf '%s' "$BAO_CAO" | python3 -c "
import json,sys
d=json.load(sys.stdin)
md=d['markdown']
thieu=[n for n in range(1,8) if f'## {n}.' not in md]
if thieu:
    print('   THIẾU mục:', thieu); sys.exit(1)
print('   đủ 7 mục · dài', len(md), 'ký tự · artifact', d['artifactId'])
" || loi "báo cáo không đủ bảy mục"

CHI_PHI=$(goi GET "/api/companies/$COMPANY_ID/costs")
printf '%s' "$CHI_PHI" | python3 -c "
import json,sys
d=json.load(sys.stdin)
t=d['totals']
print('   chi phí ghi nhận:', t['costUsd'], 'USD ·', t['tokensIn']+t['tokensOut'], 'token ·', t['runs'], 'lượt chạy')
"

printf '\n✅ NGHIỆM THU ĐẠT với LLM thật\n'
