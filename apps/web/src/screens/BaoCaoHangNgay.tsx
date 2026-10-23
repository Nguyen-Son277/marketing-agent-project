import { useEffect, useRef, useState } from 'react'
import { dailyGroupSchema, dailyReportDateSchema, dailyVietnamDate, dailyWorkingDay, type DailyGroup, type DailyRound, type DailyRoundDetailResponse, type DailyRoundCreateResponse } from '@marketing-agent/shared'
import { request } from '../lib/api.ts'
import { useI18n } from '../lib/i18n.tsx'
import { DangTai, Nut, ThongBao, Trang } from '../components/ui.tsx'
import { HopThoai } from '../components/HopThoai.tsx'
import { ReportDate, ReportEmpty, ReportIcon } from '../components/daily-reports/ReportUI.tsx'
import { ReportDetail } from '../components/daily-reports/ReportDetail.tsx'

type GroupForm = { id?: string; version?: number; name: string; title: string; enabled: boolean; modelId: string | null; members: string }
type LoadedReport = { scope: string; detail: DailyRoundDetailResponse | null; error: string }

export function BaoCaoHangNgay({ companyId }: { companyId: string }) {
  return <CompanyDailyReports key={companyId} companyId={companyId} />
}

function CompanyDailyReports({ companyId }: { companyId: string }) {
  const { locale } = useI18n()
  const l = (vi: string, en: string): string => locale === 'en' ? en : vi
  const base = `/api/companies/${companyId}/daily-report-groups`
  const [groups, setGroups] = useState<DailyGroup[]>([])
  const [groupsLoaded, setGroupsLoaded] = useState(false)
  const [models, setModels] = useState<{ id: string; label: string }[]>([])
  const [selected, setSelected] = useState('')
  const [date, setDate] = useState(() => dailyVietnamDate())
  const [loaded, setLoaded] = useState<LoadedReport | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [refresh, setRefresh] = useState(0)
  const [employeeNames, setEmployeeNames] = useState<string[]>([])
  const [form, setForm] = useState<GroupForm | null>(null)
  const mounted = useRef(true)
  const actionBusy = useRef(false)
  const scope = `${companyId}/${selected}/${date}`
  const currentScope = useRef(scope)
  currentScope.current = scope
  const validDate = dailyReportDateSchema.safeParse(date).success
  const current = loaded?.scope === scope ? loaded : null
  const detail = current?.detail ?? null
  const loading = !!selected && validDate && !current
  const group = groups.find(item => item.id === selected)
  const roundBase = detail ? `${base}/${selected}/rounds/${detail.round.id}` : ''

  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    void request<{ employees: { name: string; companyIds: string[]; active: boolean }[] }>('/api/workforce/employees', { signal: controller.signal })
      .then(result => {
        if (!controller.signal.aborted) setEmployeeNames(result.employees.filter(item => item.active && item.companyIds.includes(companyId)).map(item => item.name))
      })
      .catch(() => {})
    return () => controller.abort()
  }, [companyId])

  useEffect(() => {
    const controller = new AbortController()
    void request<{ groups: DailyGroup[]; models: { id: string; label: string }[] }>(base, { signal: controller.signal })
      .then(result => {
        if (controller.signal.aborted) return
        setGroups(result.groups)
        setModels(result.models)
        setSelected(value => result.groups.some(item => item.id === value) ? value : result.groups[0]?.id ?? '')
        setGroupsLoaded(true)
      })
      .catch(cause => {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : String(cause))
      })
    return () => controller.abort()
  }, [base, refresh])

  useEffect(() => {
    if (!selected || !validDate) return
    const controller = new AbortController()
    async function load(): Promise<void> {
      try {
        const result = await request<{ rounds: DailyRound[] }>(`${base}/${selected}/rounds?date=${encodeURIComponent(date)}`, { signal: controller.signal })
        const round = result.rounds[0]
        const next = round ? await request<DailyRoundDetailResponse>(`${base}/${selected}/rounds/${round.id}`, { signal: controller.signal }) : null
        if (!controller.signal.aborted) setLoaded({ scope, detail: next, error: '' })
      } catch (cause) {
        if (!controller.signal.aborted) setLoaded({ scope, detail: null, error: cause instanceof Error ? cause.message : String(cause) })
      }
    }
    void load()
    return () => controller.abort()
  }, [base, selected, date, validDate, scope, refresh])

  useEffect(() => {
    const timer = setInterval(() => setRefresh(value => value + 1), 15000)
    return () => clearInterval(timer)
  }, [])

  async function run(action: (isCurrent: () => boolean) => Promise<void>): Promise<void> {
    if (actionBusy.current) return
    actionBusy.current = true
    const captured = scope
    const isCurrent = (): boolean => mounted.current && currentScope.current === captured
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await action(isCurrent)
      if (isCurrent()) setRefresh(value => value + 1)
    } catch (cause) {
      if (isCurrent()) setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      actionBusy.current = false
      if (mounted.current) setBusy(false)
    }
  }

  function changeSelection(groupId: string, reportingDate: string): void {
    setSelected(groupId)
    setDate(reportingDate)
    setError('')
    setNotice('')
  }

  function openGroupForm(): void {
    setError('')
    setForm({ name: '', title: 'Daily Team Work Report', members: '', enabled: true, modelId: null })
  }

  async function save(): Promise<void> {
    if (!form) return
    const parsed = dailyGroupSchema.safeParse({ ...form, members: form.members.split('\n').map(value => value.trim()).filter(Boolean) })
    if (!parsed.success) {
      setError(parsed.error.issues.map(issue => issue.message).join('; '))
      return
    }
    await run(async isCurrent => {
      const result = await request<{ group: DailyGroup }>(form.id ? `${base}/${form.id}` : base, {
        method: form.id ? 'PATCH' : 'POST',
        body: form.id ? { version: form.version, group: parsed.data } : parsed.data,
      })
      if (!isCurrent()) return
      setGroups(previous => [result.group, ...previous.filter(item => item.id !== result.group.id)])
      setSelected(result.group.id)
      setDate(dailyVietnamDate())
      setForm(null)
      setNotice(l('Đã lưu nhóm.', 'Group saved.'))
      setRefresh(value => value + 1)
    })
  }

  async function createLinks(): Promise<void> {
    if (!selected || !validDate) return
    await run(async isCurrent => {
      const result = await request<DailyRoundCreateResponse>(`${base}/${selected}/rounds`, { method: 'POST', body: { date } })
      const next = await request<DailyRoundDetailResponse>(`${base}/${selected}/rounds/${result.round.id}`)
      if (!isCurrent()) return
      setLoaded({ scope, detail: next, error: '' })
      setNotice(l('Link chia sẻ đã sẵn sàng. Bạn có thể sao chép và gửi cho nhóm.', 'Sharing links are ready. Copy and send them to your group.'))
    })
  }

  async function copy(url: string, reminder = false): Promise<void> {
    await run(async isCurrent => {
      try {
        if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable')
        const text = reminder ? `${detail?.current.groupName} — ${date}\n${l('Bạn có thể nhập hoặc sửa báo cáo bất cứ lúc nào bằng cách chọn tên. Nếu ngày này nghỉ, đánh dấu “Ngày này nghỉ”. Bản tổng hợp chốt lúc 16:50 giờ Việt Nam.', 'Submit or edit at any time by selecting your name. If you are off that day, select “Day off”. The summary cutoff is 16:50 Vietnam time.')}\n${url}` : url
        await navigator.clipboard.writeText(text)
        if (isCurrent()) setNotice(l('Đã sao chép.', 'Copied.'))
      } catch {
        if (isCurrent()) setError(l('Không thể sao chép tự động. Hãy chọn địa chỉ link bên dưới và sao chép thủ công.', 'Automatic copy failed. Select the link address below and copy it manually.'))
      }
    })
  }

  const createReason = !validDate ? l('Hãy chọn ngày báo cáo hợp lệ.', 'Choose a valid reporting date.')
    : detail ? '' : !group?.enabled ? l('Nhóm đang tạm dừng. Bật nhóm để tạo đợt mới.', 'This group is paused. Enable it to create a new round.')
    : date < dailyVietnamDate() ? l('Ngày này chưa có đợt báo cáo. Không thể tạo đợt mới cho ngày đã qua.', 'There is no round for this date. New rounds cannot be created for past dates.')
    : !dailyWorkingDay(date) ? l('Chủ nhật không tạo đợt mới. Chọn ngày từ thứ Hai đến thứ Bảy.', 'New rounds are not created on Sundays. Choose Monday through Saturday.') : ''

  function editGroup(): void {
    if (!group) return
    setError('')
    setForm({ ...group, members: group.members.map(member => member.name).join('\n') })
  }

  return <Trang rong><div className="report-workspace">
    <header className="report-page-heading"><div><span className="report-eyebrow">{l('QUẢN LÝ CÔNG VIỆC', 'WORK MANAGEMENT')}</span><h1>{l('Báo cáo công việc', 'Daily work reports')}</h1><p>{l('Theo dõi tiến độ của nhóm, tổng hợp kết quả mỗi ngày.', 'Keep up with your team and bring each day’s results together.')}</p></div>
      <Nut onClick={openGroupForm} disabled={busy}><ReportIcon name="plus" size={18} />{l('Tạo nhóm', 'Create group')}</Nut>
    </header>
    <div aria-live="polite">{!form && (error || current?.error) ? <ThongBao loai="loi">{error || current?.error}<div><button className="report-text-button" type="button" onClick={() => {
      setError('')
      setRefresh(value => value + 1)
    }}>{l('Tải lại dữ liệu', 'Reload data')}</button></div></ThongBao> : null}
      {notice ? <ThongBao loai="thanh-cong">{notice}</ThongBao> : null}</div>
    {!groupsLoaded && !error ? <DangTai /> : null}
    {groupsLoaded && !groups.length ? <section className="report-panel"><ReportEmpty title={l('Bắt đầu báo cáo cùng nhóm của bạn', 'Start reporting with your team')} action={<Nut onClick={openGroupForm}><ReportIcon name="plus" size={18} />{l('Tạo nhóm đầu tiên', 'Create your first group')}</Nut>}>{l('Thêm thành viên, chọn model tổng hợp và chia sẻ link để thu thập báo cáo mỗi ngày.', 'Add members, choose a synthesis model and share a link to collect daily reports.')}</ReportEmpty></section> : null}
    {groups.length ? <section className="report-panel">
      <div className="report-toolbar">
        <label className="truong"><span className="nhan">{l('Nhóm báo cáo', 'Reporting group')}</span><select className="o-chon" value={selected} onChange={event => changeSelection(event.target.value, dailyVietnamDate())}>
          {groups.map(item => <option key={item.id} value={item.id}>{item.name} · {item.members.length} {l('thành viên', 'members')}{item.enabled ? '' : l(' — tạm dừng', ' — paused')}</option>)}
        </select></label>
        <label className="truong"><span className="nhan">{l('Ngày báo cáo', 'Reporting date')}</span><span className="report-date-control"><input className="o-nhap" type="date" value={date} onChange={event => changeSelection(selected, event.target.value)} /><Nut bien="phu" nho onClick={() => changeSelection(selected, dailyVietnamDate())}>{l('Hôm nay', 'Today')}</Nut></span></label>
        <div className="report-toolbar-actions"><Nut disabled={!selected || busy || loading || !!createReason || !!current?.error} dangTai={busy} onClick={() => void createLinks()}><ReportIcon name="link" size={17} />{l('Tạo link chia sẻ', 'Create sharing links')}</Nut>
          {group ? <Nut bien="phu" disabled={busy} ariaLabel={l('Sửa nhóm', 'Edit group')} title={l('Sửa nhóm', 'Edit group')} onClick={editGroup}><ReportIcon name="settings" size={18} /></Nut> : null}</div>
      </div>
      <div className="report-schedule"><span><ReportIcon name="clock" size={15} />{l('Thứ Hai – Thứ Bảy · Chốt tổng hợp 16:50 (GMT+7)', 'Monday – Saturday · Summary cutoff 16:50 (GMT+7)')}</span><span className="report-live">{l('Tự làm mới mỗi 15 giây', 'Refreshes every 15 seconds')}</span></div>
    </section> : null}
    {selected && !validDate ? <ThongBao loai="canh-bao">{createReason}</ThongBao> : null}
    {loading ? <DangTai /> : null}
    {group && !loading && !detail && validDate && !current?.error ? <section className="report-panel"><ReportEmpty title={l('Chưa có đợt báo cáo', 'No reporting round yet')} action={!createReason ? <Nut disabled={busy} onClick={() => void createLinks()}><ReportIcon name="link" size={17} />{l('Tạo link cho ngày này', 'Create links for this date')}</Nut> : undefined}>{createReason || l('Tạo link chia sẻ để chuẩn bị đợt báo cáo và gửi cho các thành viên trong nhóm.', 'Create sharing links to prepare this reporting round and invite your team to submit.')}</ReportEmpty></section> : null}
    {detail ? <>
      <div className="report-section-heading"><strong>{detail.current.groupName}</strong><span className="report-note"><ReportDate date={detail.round.date} /></span></div>
      <ReportDetail key={scope} detail={detail} roundBase={roundBase} busy={busy} onUpdate={() => void run(async isCurrent => {
        await request(`${roundBase}/update`, { method: 'POST' })
        if (isCurrent()) setNotice(l('Đã xếp hàng tạo bản cập nhật.', 'Updated version queued.'))
      })} onRetry={versionId => void run(async () => { await request(`${roundBase}/versions/${versionId}/retry`, { method: 'POST' }) })} />
      {detail.share.warning ? <ThongBao loai="canh-bao">{detail.share.warning}</ThongBao> : null}
      <div className="report-links">{([
        { title: l('Link nộp báo cáo', 'Submission link'), url: detail.share.url, hint: l('Dành cho thành viên nhập và chỉnh sửa báo cáo.', 'For members to submit and edit their reports.'), icon: 'link', reminder: true },
        { title: l('Link xem tổng hợp', 'Summary view link'), url: detail.share.viewUrl, hint: l('Dành cho người theo dõi · Chỉ xem bản hoàn tất mới nhất.', 'For readers · Shows the latest completed summary.'), icon: 'eye', reminder: false },
      ] as const).map(link => <section key={link.title} className="report-share-card">
        <div className="report-share-heading"><span><ReportIcon name={link.icon} /></span><div><h2>{link.title}</h2><p>{link.hint}</p></div></div>
        {link.url ? <><div className="report-share-input"><input className="o-nhap" aria-label={link.title} readOnly value={link.url} onFocus={event => event.currentTarget.select()} /><Nut bien="phu" disabled={busy} ariaLabel={`${l('Sao chép', 'Copy')} ${link.title}`} onClick={() => void copy(link.url!)}><ReportIcon name="copy" size={16} />{l('Sao chép', 'Copy')}</Nut></div>
          <div className="report-share-footer">{link.reminder ? <button type="button" className="report-text-button" disabled={busy} onClick={() => void copy(link.url!, true)}>{l('Sao chép kèm lời nhắc', 'Copy with a reminder')}</button> : <span className="report-note">{l('Không yêu cầu đăng nhập', 'No login required')}</span>}<a className="report-text-button" href={link.url} target="_blank" rel="noopener noreferrer">{l('Mở link', 'Open link')}<ReportIcon name="arrow" size={14} /></a></div></>
          : <p className="report-note">{l('Chọn “Tạo link chia sẻ” để chuẩn bị link này.', 'Choose “Create sharing links” to prepare this link.')}</p>}
      </section>)}</div>
    </> : null}
    <details className="report-help"><summary>{l('Cách hoạt động & lưu ý chia sẻ', 'How it works & sharing guidance')}</summary><p>{l('Thành viên có thể nộp và sửa bất cứ lúc nào, kể cả ngày đã qua. Bản tổng hợp chốt lúc 16:50 giờ Việt Nam; nội dung sau hạn cần tạo bản cập nhật. Link nộp không xác thực danh tính: người có link có thể chọn tên để xem và sửa báo cáo, vì vậy chỉ chia sẻ trong nhóm tin cậy. Đợt đã tạo giữ nguyên danh sách thành viên tại thời điểm tạo.', 'Members can submit and edit at any time, including past dates. The summary cutoff is 16:50 Vietnam time; later changes require an updated version. Submission links do not verify identity: anyone with the link can select a name to view and edit that report. Share only with a trusted group. Each round retains the roster at creation.')}</p></details>
    <HopThoai mo={!!form} tieuDe={form?.id ? l('Chỉnh sửa nhóm báo cáo', 'Edit reporting group') : l('Tạo nhóm báo cáo', 'Create reporting group')} onDong={() => { if (!busy) setForm(null) }} chanDung={<><Nut bien="phu" disabled={busy} onClick={() => setForm(null)}>{l('Hủy', 'Cancel')}</Nut><Nut disabled={busy} dangTai={busy} onClick={() => {
      const element = document.getElementById('report-group-form') as HTMLFormElement | null
      element?.requestSubmit()
    }}>{l('Lưu nhóm', 'Save group')}</Nut></>}>
      {form ? <form id="report-group-form" className="report-group-form" onSubmit={event => {
        event.preventDefault()
        void save()
      }}>
        {error ? <div role="alert"><ThongBao loai="loi">{error}</ThongBao></div> : null}
        <label className="truong"><span className="nhan">{l('Tên nhóm', 'Group name')}</span><input className="o-nhap" autoFocus required maxLength={120} placeholder={l('Ví dụ: Đội Marketing', 'e.g. Marketing team')} value={form.name} onChange={event => setForm({ ...form, name: event.target.value })} /></label>
        <label className="truong"><span className="nhan">{l('Tiêu đề tài liệu (tiếng Anh)', 'Document title (English)')}</span><input className="o-nhap" required maxLength={200} value={form.title} onChange={event => setForm({ ...form, title: event.target.value })} /></label>
        <label className="truong"><span className="nhan">{l('Danh sách thành viên', 'Team members')}<span className="report-note">{form.members.split('\n').filter(value => value.trim()).length}/100</span></span><textarea className="o-van-ban" rows={6} required placeholder={l('Mỗi dòng một tên, không trùng nhau', 'One distinct name per line')} value={form.members} onChange={event => setForm({ ...form, members: event.target.value })} /><span className="report-field-hint">{l('Mỗi dòng một tên · Tối đa 100 thành viên', 'One distinct name per line · Up to 100 members')}</span></label>
        {employeeNames.length ? <details className="report-help"><summary>{l('Thêm từ nhân viên hiện có', 'Add existing employees')}</summary><div className="report-employee-options">{employeeNames.map(name => <label key={name}><input type="checkbox" checked={form.members.split('\n').map(value => value.trim()).includes(name)} onChange={event => setForm({ ...form, members: event.target.checked ? [...form.members.split('\n').filter(Boolean), name].join('\n') : form.members.split('\n').filter(item => item.trim() !== name).join('\n') })} />{name}</label>)}</div></details> : null}
        <label className="truong"><span className="nhan">{l('Model tổng hợp tiếng Anh', 'English synthesis model')}</span><select className="o-chon" value={form.modelId ?? ''} onChange={event => setForm({ ...form, modelId: event.target.value || null })}><option value="">{l('Chưa chọn model', 'No model selected')}</option>{models.map(model => <option key={model.id} value={model.id}>{model.label}</option>)}</select><span className="report-note">{l('Cần chọn model trước khi hệ thống tổng hợp báo cáo.', 'Choose a model before the system can generate summaries.')}</span></label>
        <label className="report-check"><input type="checkbox" checked={form.enabled} onChange={event => setForm({ ...form, enabled: event.target.checked })} /><span>{l('Bật lịch báo cáo tự động', 'Enable automatic reporting')}<small>{l('Thứ Hai – Thứ Bảy · Chốt lúc 16:50 giờ Việt Nam', 'Monday – Saturday · Cutoff at 16:50 Vietnam time')}</small></span></label>
        <p className="report-note">{l('Thay đổi thành viên áp dụng cho đợt chưa tạo. Các đợt hiện có được giữ nguyên.', 'Roster changes apply to future rounds. Existing rounds keep their current members.')}</p>
      </form> : null}
    </HopThoai>
  </div></Trang>
}
