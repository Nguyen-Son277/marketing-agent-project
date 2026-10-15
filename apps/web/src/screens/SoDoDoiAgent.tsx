/**
 * Màn hình sơ đồ đội agent và luồng hoạt động.
 *
 * Vì sao cần màn hình này: người dùng phải trả lời được ba câu hỏi mà không cần đọc
 * tài liệu — "đội tôi có những ai", "ai đọc được tài liệu nào", và "một yêu cầu chạy
 * qua những bước nào". Sơ đồ lấy dữ liệu sống từ `/diagram`, nên khi đổi cấu hình
 * trong màn Đội agent thì sơ đồ đổi theo; đây là lý do không vẽ hình tĩnh.
 */
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import type { AgentRole, DiagramNode, DiagramResponse } from '@marketing-agent/shared'
import type { MessageKey } from '@marketing-agent/i18n'
import { api } from '../lib/api.ts'
import { WorkflowRealtime } from '../components/workflow/WorkflowRealtime.tsx'
import { useI18n } from '../lib/i18n.tsx'
import { Card, DangTai, Nhan, ThongBao, Trang, TieuDeTrang } from '../components/ui.tsx'

/**
 * Nhãn lớp và thứ tự hiển thị, khớp `layer` trong hợp đồng API.
 *
 * `nhan`/`moTa` là KHOÁ DỊCH chứ không phải câu chữ, cùng lý do như `ROUTES` ở
 * `Shell.tsx`: giữ câu chữ ở đây thì đổi ngôn ngữ không đổi được nhãn.
 */
const LOP: readonly { id: DiagramNode['layer']; nhan: MessageKey; moTa: MessageKey }[] = [
  { id: 'leader', nhan: 'diagram.layer.leader.label', moTa: 'diagram.layer.leader.description' },
  { id: 'research', nhan: 'diagram.layer.research.label', moTa: 'diagram.layer.research.description' },
  { id: 'content', nhan: 'diagram.layer.content.label', moTa: 'diagram.layer.content.description' },
  { id: 'channel', nhan: 'diagram.layer.channel.label', moTa: 'diagram.layer.channel.description' },
  { id: 'measure', nhan: 'diagram.layer.measure.label', moTa: 'diagram.layer.measure.description' },
]

/**
 * Bản dịch cho MÃ vai trò do backend trả về.
 *
 * Vì sao vẫn cần: tên agent người dùng đặt (`node.label`) là dữ liệu và không dịch,
 * nhưng khi agent chưa được đặt tên riêng thì mã vai trò là thứ duy nhất để hiển thị —
 * để nguyên mã tiếng Anh sẽ khó đọc với người dùng tiếng Việt ở đúng màn giải thích đội.
 */
const NHAN_VAI_TRO: Readonly<Record<string, MessageKey>> = {
  'marketing-leader': 'diagram.role.marketingLeader',
  'market-research': 'diagram.role.marketResearch',
  'content-writer': 'diagram.role.contentWriter',
  'seo-technical': 'diagram.role.seoTechnical',
  'social-media': 'diagram.role.socialMedia',
  'paid-media': 'diagram.role.paidMedia',
  'email-crm': 'diagram.role.emailCrm',
  'design-video': 'diagram.role.designVideo',
  analytics: 'diagram.role.analytics',
  'community-care': 'diagram.role.communityCare',
}

export function SoDoDoiAgent({ companyId }: { companyId: string }): ReactNode {
  const { t, formatNumber, translateError } = useI18n()
  const [duLieu, setDuLieu] = useState<DiagramResponse | null>(null)
  const [loi, setLoi] = useState<unknown>(null)
  const [dangTai, setDangTai] = useState(true)
  const [configCompanyId, setConfigCompanyId] = useState(companyId)
  const configIsStale = configCompanyId !== companyId
  const [cheDo, setCheDo] = useState<'so-do' | 'luong' | 'workflow'>('so-do')
  const tabId = useId()
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([])
  const tabs = ['so-do', 'luong', 'workflow'] as const
  const tabKeys = ['diagram.tab.team', 'diagram.tab.flow', 'diagram.tab.workflow'] as const
  const onTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let next = index
    if (event.key === 'ArrowRight') next = (index + 1) % tabs.length
    else if (event.key === 'ArrowLeft') next = (index + tabs.length - 1) % tabs.length
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = tabs.length - 1
    else return
    event.preventDefault()
    setCheDo(tabs[next]!)
    tabRefs.current[next]?.focus()
  }

  useEffect(() => {
    let cancelled = false
    setDangTai(true)
    setConfigCompanyId(companyId)
    setDuLieu(null)
    setLoi(null)
    void (async () => {
      try {
        const ketQua = await api.diagram(companyId)
        if (!cancelled) setDuLieu(ketQua)
      } catch (error) {
        if (!cancelled) setLoi(error)
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

  const soAgentBat = configIsStale ? 0 : duLieu?.nodes.filter((node) => node.enabled).length ?? 0

  // Vai trò là mã backend: catalog chỉ dịch mã đã biết, còn lại hiện nguyên mã để sơ đồ
  // không mất tên khi hợp đồng thêm vai trò mới mà giao diện chưa cập nhật.
  const nhanVaiTro = (role: string): string => {
    const khoa = NHAN_VAI_TRO[role]
    return khoa ? t(khoa) : role
  }

  return (
    <Trang rong>
      <TieuDeTrang
        moTa={t('diagram.subtitle', { enabled: formatNumber(soAgentBat), total: formatNumber(configIsStale ? 0 : duLieu?.nodes.length ?? 0) })}
      >
        {t('diagram.title')}
      </TieuDeTrang>

      <div className="workflow__tabs" role="tablist" aria-label={t('diagram.title')}>
        {tabs.map((tab, index) => (
          <button key={tab} type="button" role="tab" id={`${tabId}-${tab}`}
            aria-selected={cheDo === tab} aria-controls={`${tabId}-panel-${tab}`}
            tabIndex={cheDo === tab ? 0 : -1} ref={(element) => { tabRefs.current[index] = element }}
            onKeyDown={(event) => onTabKeyDown(event, index)} onClick={() => setCheDo(tab)}>
            {t(tabKeys[index]!)}
          </button>
        ))}
      </div>
      {tabs.map((tab) => (
        <div key={tab} role="tabpanel" id={`${tabId}-panel-${tab}`} aria-labelledby={`${tabId}-${tab}`}
          hidden={cheDo !== tab} tabIndex={0} className="workflow__tab-panel">
          {cheDo === tab && (tab === 'workflow' ? <WorkflowRealtime key={companyId} companyId={companyId} /> :
            (dangTai || configIsStale) ? <DangTai nhan={t('diagram.loading')} /> :
            loi ? <ThongBao loai="loi">{translateError(loi)}</ThongBao> : duLieu ? (
      <>
      {cheDo === 'so-do' ? (
        <>
          <Card tieuDe={t('diagram.structure.title')} phu={t('diagram.structure.subtitle')}>
            <div className="so-do">
              {theoLop.map((lop) => (
                <div key={lop.id} className="so-do__lop">
                  <div className="so-do__nhan-lop">{t(lop.nhan)}</div>
                  <div style={{ fontSize: 12, color: 'var(--mau-chu-mo)', marginBottom: 8 }}>{t(lop.moTa)}</div>
                  <div className="luoi luoi--3">
                    {lop.nut.map((node) => (
                      <NutAgent key={node.id} node={node} />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </Card>

          <Card tieuDe={t('diagram.permissions.title')} phu={t('diagram.permissions.subtitle')}>
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
                            <Nhan loai="canh-bao">{t('diagram.permissions.write')}</Nhan>
                          ) : doc ? (
                            <Nhan loai="thanh-cong">{t('diagram.permissions.read')}</Nhan>
                          ) : (
                            // `--mau-chu-mo` chứ không phải `--mau-vien`: màu viền gần bằng
                            // màu nền nên dùng làm chữ thì gần như không đọc được ở cả hai
                            // chế độ.
                            <span style={{ color: 'var(--mau-chu-mo)' }}>{t('diagram.permissions.none')}</span>
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
          <Card tieuDe={t('diagram.flow.title')} phu={t('diagram.flow.subtitle')}>
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

          <Card tieuDe={t('diagram.edges.title')} phu={t('diagram.edges.subtitle')}>
            <table className="bang">
              <thead>
                <tr>
                  <th>{t('diagram.edges.from')}</th>
                  <th>{t('diagram.edges.to')}</th>
                  <th>{t('diagram.edges.kind')}</th>
                </tr>
              </thead>
              <tbody>
                {duLieu.edges
                  .filter((edge) => edge.kind === 'delegates' || edge.kind === 'hands_off' || edge.kind === 'peer')
                  .map((edge, index) => (
                    <tr key={`${edge.from}-${edge.to}-${edge.kind}-${index}`}>
                      <td>{nhanVaiTro(edge.from)}</td>
                      <td>{nhanVaiTro(edge.to)}</td>
                      <td>
                        {edge.kind === 'delegates'
                          ? t('diagram.edges.delegates')
                          : edge.kind === 'hands_off'
                            ? t('diagram.edges.handsOff')
                            : t('diagram.edges.peer')}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </Card>
        </>
      )}
      </>
      ) : null)}
        </div>
      ))}
    </Trang>
  )
}

/** Một nút agent trong sơ đồ, kèm model, kỹ năng và tool. */
function NutAgent({ node }: { node: DiagramNode }): ReactNode {
  const { t, formatNumber } = useI18n()
  const laLeader = node.layer === 'leader'
  const lopNut = ['so-do__nut', laLeader ? 'so-do__nut--leader' : '', node.enabled ? '' : 'so-do__nut--tat']
    .filter(Boolean)
    .join(' ')
  // Tên agent do người dùng đặt là dữ liệu nên không dịch; chỉ khi chưa có tên riêng
  // mới rơi về bản dịch của mã vai trò.
  const khoaVaiTro = NHAN_VAI_TRO[node.role]
  const tenHienThi = khoaVaiTro ? t(khoaVaiTro) : node.label

  return (
    <div className={lopNut}>
      <div className="hang" style={{ justifyContent: 'space-between' }}>
        <span className="so-do__ten">
          {laLeader ? `${t('diagram.agent.leaderMark')} ` : ''}
          {tenHienThi}
        </span>
        {node.enabled ? null : <Nhan loai="mo">{t('diagram.agent.disabled')}</Nhan>}
      </div>
      <div className="so-do__meta">{node.role}</div>
      <div className="so-do__meta">
        {t('diagram.agent.model', {
          model: node.modelLabel ?? t('diagram.agent.modelUnassigned'),
          tier: t(`modelTier.${node.tier}`),
        })}
      </div>
      {node.skills.length > 0 ? (
        <div className="so-do__meta" title={node.skills.join(', ')}>
          {t('diagram.agent.skills', { count: formatNumber(node.skills.length) })}
        </div>
      ) : (
        <div className="so-do__meta" style={{ color: 'var(--mau-canh-bao)' }}>
          {t('diagram.agent.noSkills')}
        </div>
      )}
      {node.tools.length > 0 ? (
        <div className="so-do__meta" title={node.tools.join(', ')}>
          {t('diagram.agent.tools', { count: formatNumber(node.tools.length) })}
        </div>
      ) : null}
      {node.knowledgeRead.length === 0 ? (
        <div className="so-do__meta" style={{ color: 'var(--mau-loi)' }}>
          {t('diagram.agent.noKnowledge')}
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
