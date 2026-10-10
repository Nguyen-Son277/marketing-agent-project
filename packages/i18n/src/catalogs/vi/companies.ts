/**
 * Namespace `companies` — màn "Công ty của tôi".
 *
 * Vì sao tách khỏi namespace `company` (màn chọn công ty đầu tiên): hai màn phục vụ hai
 * tình huống khác nhau. `company.*` là lần đầu đăng nhập, chỉ có một việc là tạo công ty
 * đầu tiên. `companies.*` là quản lý về sau: danh sách, chuyển đổi, đổi tên. Gộp chung
 * sẽ khiến mỗi lần sửa câu chữ ở một màn phải đọc cả hai ngữ cảnh.
 */
export const vi_companies = {
  /* ------------------------------------------------------- tiêu đề */
  'companies.title': 'Công ty của tôi',
  'companies.subtitle':
    'Một tài khoản có thể thuộc nhiều công ty. Mỗi công ty có kho kiến thức, đội agent, ngân sách và lịch sử công việc riêng — chuyển công ty là đổi toàn bộ ngữ cảnh làm việc.',

  /* ------------------------------------------------------ danh sách */
  'companies.yours': 'Công ty của bạn',
  'companies.loading': 'Đang tải danh sách công ty…',
  'companies.empty': 'Tài khoản này chưa thuộc công ty nào. Tạo công ty đầu tiên ở khung bên dưới.',
  'companies.current': 'Đang dùng',
  'companies.switch': 'Chuyển sang công ty này',
  'companies.roleLabel': 'Vai trò: {{role}}',
  'companies.pathLabel': 'Đường dẫn',
  'companies.memberCount': '{{count}} thành viên',

  /* ---------------------------------------------------------- tạo */
  'companies.createTitle': 'Tạo công ty mới',
  'companies.createHint':
    'Mỗi công ty mới nhận đủ 10 agent và phân quyền kho kiến thức 6 danh mục. Sau khi tạo, hệ thống chuyển ngay sang công ty đó.',
  'companies.name': 'Tên công ty',
  'companies.namePlaceholder': 'Công ty TNHH An Phát',
  'companies.create': 'Tạo công ty',
  'companies.needName': 'Cần nhập tên công ty.',
  'companies.creating': 'Đang tạo công ty…',
  'companies.created': 'Đã tạo công ty mới và chuyển sang công ty đó.',

  /* ------------------------------------------------------- đổi tên */
  'companies.rename': 'Đổi tên',
  'companies.renameTitle': 'Đổi tên công ty',
  'companies.renameSave': 'Lưu tên mới',
  'companies.renameCancel': 'Huỷ',
  'companies.renamed': 'Đã đổi tên công ty.',
  'companies.renaming': 'Đang lưu…',
  /**
   * Vì sao phải nói rõ: người dùng dễ tưởng đổi tên là đổi luôn đường dẫn. Slug là tên
   * thư mục kho kiến thức trên đĩa và là khoá tra cứu tài liệu đã index, nên nó cố ý
   * giữ nguyên. Không nói trước thì đây là nguồn thắc mắc chắc chắn xảy ra.
   */
  'companies.renameSlugNote':
    'Tên hiển thị đổi được, còn đường dẫn ({{slug}}) giữ nguyên — đổi đường dẫn sẽ làm mất liên kết tới tài liệu đã index trong kho kiến thức.',
  'companies.renameNotAllowed': 'Chỉ chủ sở hữu hoặc quản trị viên của công ty mới đổi được tên.',

  /* ------------------------------------------------------ lỗi */
  'companies.errorLoad': 'Không tải được danh sách công ty.',
  'companies.errorCreate': 'Không tạo được công ty.',
  'companies.errorRename': 'Không đổi được tên công ty.',

  /* ---------------------------------------------------- điều hướng */
  'nav.companies': 'Công ty của tôi',
} as const
