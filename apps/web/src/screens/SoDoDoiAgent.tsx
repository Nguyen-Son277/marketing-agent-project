/**
 * Màn hình sơ đồ đội agent và luồng hoạt động.
 *
 * Vì sao cần màn hình này: người dùng phải trả lời được ba câu hỏi mà không cần đọc
 * tài liệu — "đội tôi có những ai", "ai đọc được tài liệu nào", và "một yêu cầu chạy
 * qua những bước nào". Sơ đồ lấy dữ liệu sống từ `/diagram`, nên khi đổi cấu hình
 * trong màn Đội agent thì sơ đồ đổi theo; đây là lý do không vẽ hình tĩnh.
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import type { AgentRole, DiagramNode, DiagramResponse } from '@marketing-agent/shared'
import { api, ApiError } from '../lib/api.ts'
import { Card, DangTai, Nhan, Nut, ThongBao, Trang, TieuDeTrang } from '../components/ui.tsx'

/** Nhãn lớp và thứ tự hiển thị, khớp `layer` trong hợp đồng API. */
const LOP: readonly { id: DiagramNode['layer']; nhan: string; moTa: string }[] = [
  { id: 'leader', nhan: 'Lớp điều hành', moTa: 'Điểm chạm duy nhất với bạn; chia việc, kiểm tra, báo cáo.' },
  { id: 'research', nhan: 'Lớp nghiên cứu & chiến lược', moTa: 'Tạo dữ liệu nền trước khi làm nội dung.' },
  { id: 'content', nhan: 'Lớp nội dung & sáng tạo', moTa: 'Biến chiến lược thành nội dung và đặc tả hình ảnh.' },
  { id: 'channel', nhan: 'Lớp kênh & thực thi', moTa: 'Đưa nội dung ra kênh và vận hành quảng cáo.' },
  { id: 'measure', nhan: 'Lớp đo lường & chăm sóc', moTa: 'Đo kết quả và giữ quan hệ với khách hàng.' },
]

const NHAN_VAI_TRO: Record<string, string> = {
  'marketing-leader': 'Trưởng phòng Marketing',
  'market-research': 'Nghiên cứu thị trường',
  'content-writer': 'Viết nội dung',
  'seo-technical': 'SEO kỹ thuật',
  'social-media': 'Social Media',
  'paid-media': 'Quảng cáo trả phí',
  'email-crm': 'Email & CRM',
  'design-video': 'Thiết kế & Video',
  analytics: 'Phân tích & Báo cáo',
  'community-care': 'Chăm sóc cộng đồng',
}

export function SoDoDoiAgent({ companyId }: { companyId: string }): ReactNode {
  const [duLieu, setDuLieu] = useState<DiagramResponse | null>(null)
  const [loi, setLoi] = useState<string | null>(null)
  const [dangTai, setDangTai] = useState(true)
  const [cheDo, setCheDo] = useState<'so-do' | 'luong'>('so-do')

  useEffect(() => {
    let cancelled = false
    setDangTai(true)
    void (async () => {
      try {
        const ketQua = await api.diagram(companyId)
        if (!cancelled) setDuLieu(ketQua)
      } catch (error) {
        if (!cancelled) setLoi(error instanceof ApiError ? error.message : 'Không tải được sơ đồ đội agent.')
      } finally {
        if (!cancelled) setDangTai(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [companyId])

  const theoLop = useMemo(() => {
    if (!duLieu) return []
    return LOP.map((lop) => ({
      ...lop,
      nut: duLieu.nodes.filter((node) => node.layer === lop.id),
    })).filter((lop) => lop.nut.length > 0)
  }, [duLieu])

  const soAgentBat = duLieu?.nodes.filter((node) => node.enabled).length ?? 0

  if (dangTai) {
    return (
      <Trang>
        <DangTai nhan="Đang tải sơ đồ đội agent…" />
      </Trang>
    )
  }

  if (loi) {
    return (
      <Trang>
        <ThongBao loai="loi">{loi}</ThongBao>
      </Trang>
    )
  }

  if (!duLieu) return null

  return (
    <Trang rong>
      <TieuDeTrang
        moTa={`${soAgentBat}/${duLieu.nodes.length} agent đang bật. Sơ đồ lấy dữ liệu sống từ cấu hình công ty — đổi trong màn Đội agent thì sơ đồ đổi theo.`}
      >
        Sơ đồ đội agent
      </TieuDeTrang>

      <div className="hang" style={{ marginBottom: 16 }}>
        <Nut bien={cheDo === 'so-do' ? 'chinh' : 'phu'} nho onClick={() => setCheDo('so-do')}>
          Đội agent
        </Nut>
        <Nut bien={cheDo === 'luong' ? 'chinh' : 'phu'} nho onClick={() => setCheDo('luong')}>
          Luồng hoạt động
        </Nut>
      </div>

      {cheDo === 'so-do' ? (
        <>
          <Card tieuDe="Cấu trúc đội" phu="Mỗi agent chỉ đọc được những danh mục tri thức được cấp dưới đây.">
            <div className="so-do">
              {theoLop.map((lop) => (
                <div key={lop.id} className="so-do__lop">
                  <div className="so-do__nhan-lop">{lop.nhan}</div>
                  <div style={{ fontSize: 12, color: 'var(--mau-chu-mo)', marginBottom: 8 }}>{lop.moTa}</div>
                  <div className="luoi luoi--3">
                    {lop.nut.map((node) => (
                      <NutAgent key={node.id} node={node} />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </Card>

          <Card
            tieuDe="Phân quyền tri thức"
            phu="Ô trống nghĩa là agent KHÔNG truy xuất được nội dung trong danh mục đó. Bộ truy xuất lọc theo quyền trước khi xếp hạng, nên không có cách nào lọt qua."
          >
            <table className="bang">
              <thead>
                <tr>
                  <th>Agent</th>
                  {duLieu.knowledge.map((category) => (
                    <th key={category.code} title={category.label}>
                      {category.code}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {duLieu.nodes.map((node) => (
                  <tr key={node.id}>
                    <td>
                      <div style={{ fontWeight: 600 }}>{node.label}</div>
                      <div style={{ fontSize: 11, color: 'var(--mau-chu-mo)' }}>{node.role}</div>
                    </td>
                    {duLieu.knowledge.map((category) => {
                      const doc = node.knowledgeRead.includes(category.code)
                      const ghi = node.knowledgeWrite.includes(category.code)
                      return (
                        <td key={category.code} style={{ textAlign: 'center' }}>
                          {ghi ? (
                            <Nhan loai="canh-bao">ghi</Nhan>
                          ) : doc ? (
                            <Nhan loai="thanh-cong">đọc</Nhan>
                          ) : (
                            <span style={{ color: 'var(--mau-vien)' }}>–</span>
                          )}
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </>
      ) : (
        <>
          <Card tieuDe="Một yêu cầu chạy qua những bước nào" phu="Đây là đường đi thật của hệ thống, không phải mô tả lý thuyết.">
            <div className="luong">
              {duLieu.workflow.map((buoc, index) => (
                <div key={buoc.id} className="luong__buoc">
                  <div className="luong__so">{index + 1}</div>
                  <div className="luong__noi-dung">
                    <div style={{ fontWeight: 650 }}>{buoc.title}</div>
                    <div style={{ color: 'var(--mau-chu-mo)', fontSize: 14 }}>{buoc.description}</div>
                  </div>
                </div>
              ))}
            </div>
          </Card>

          <Card tieuDe="Quan hệ trong đội" phu="Leader giao việc xuống chuyên môn; chuyên môn bàn giao ngược lại; hỏi ngang hàng giới hạn 3 vòng.">
            <table className="bang">
              <thead>
                <tr>
                  <th>Từ</th>
                  <th>Đến</th>
                  <th>Loại quan hệ</th>
                </tr>
              </thead>
              <tbody>
                {duLieu.edges
                  .filter((edge) => edge.kind === 'delegates' || edge.kind === 'hands_off' || edge.kind === 'peer')
                  .map((edge, index) => (
                    <tr key={`${edge.from}-${edge.to}-${edge.kind}-${index}`}>
                      <td>{NHAN_VAI_TRO[edge.from] ?? edge.from}</td>
                      <td>{NHAN_VAI_TRO[edge.to] ?? edge.to}</td>
                      <td>
                        {edge.kind === 'delegates' ? 'Giao việc' : edge.kind === 'hands_off' ? 'Bàn giao kết quả' : 'Hỏi ngang hàng'}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </Card>
        </>
      )}
    </Trang>
  )
}

/** Một nút agent trong sơ đồ, kèm model, kỹ năng và tool. */
function NutAgent({ node }: { node: DiagramNode }): ReactNode {
  const laLeader = node.layer === 'leader'
  const lopNut = ['so-do__nut', laLeader ? 'so-do__nut--leader' : '', node.enabled ? '' : 'so-do__nut--tat']
    .filter(Boolean)
    .join(' ')
  const tenHienThi = NHAN_VAI_TRO[node.role] ?? node.label

  return (
    <div className={lopNut}>
      <div className="hang" style={{ justifyContent: 'space-between' }}>
        <span className="so-do__ten">
          {laLeader ? '🎯 ' : ''}
          {tenHienThi}
        </span>
        {node.enabled ? null : <Nhan loai="mo">tắt</Nhan>}
      </div>
      <div className="so-do__meta">{node.role}</div>
      <div className="so-do__meta">
        Model: {node.modelLabel ?? 'chưa gán'} · tier {node.tier}
      </div>
      {node.skills.length > 0 ? (
        <div className="so-do__meta" title={node.skills.join(', ')}>
          Kỹ năng: {node.skills.length}
        </div>
      ) : (
        <div className="so-do__meta" style={{ color: 'var(--mau-canh-bao)' }}>
          ⚠️ Chưa có kỹ năng nào
        </div>
      )}
      {node.tools.length > 0 ? (
        <div className="so-do__meta" title={node.tools.join(', ')}>
          Công cụ: {node.tools.length}
        </div>
      ) : null}
      {node.knowledgeRead.length === 0 ? (
        <div className="so-do__meta" style={{ color: 'var(--mau-loi)' }}>
          ⚠️ Không đọc được danh mục tri thức nào
        </div>
      ) : null}
    </div>
  )
}

/** Danh sách vai trò theo thứ tự hiển thị; dùng cho gợi ý ở nơi khác. */
export const THU_TU_VAI_TRO: readonly AgentRole[] = [
  'marketing-leader',
  'market-research',
  'seo-technical',
  'content-writer',
  'design-video',
  'social-media',
  'paid-media',
  'email-crm',
  'analytics',
  'community-care',
]
