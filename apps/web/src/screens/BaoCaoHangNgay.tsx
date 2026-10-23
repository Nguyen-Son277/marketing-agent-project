import { useEffect, useRef, useState } from 'react'
import { dailyGroupSchema, dailyReportDateSchema, dailyVietnamDate, dailyWorkingDay, type DailyGroup, type DailyRound, type DailyRoundDetailResponse, type DailyRoundCreateResponse } from '@marketing-agent/shared'
import { request } from '../lib/api.ts'
import { useI18n } from '../lib/i18n.tsx'
import { Card, DangTai, Nut, ONhap, OVanBan, OChon, Truong, ThongBao, Trang } from '../components/ui.tsx'
import { HopThoai } from '../components/HopThoai.tsx'

type GroupForm = { id?: string; version?: number; name: string; title: string; enabled: boolean; modelId: string | null; members: string }
type LoadedReport = { scope: string; detail: DailyRoundDetailResponse | null; error: string }

export function BaoCaoHangNgay({ companyId }: { companyId: string }) {
  return <CompanyDailyReports key={companyId} companyId={companyId} />
}

function CompanyDailyReports({ companyId }: { companyId: string }) {
  const { locale } = useI18n(), l = (vi: string, en: string): string => locale === 'en' ? en : vi
  const base = `/api/companies/${companyId}/daily-report-groups`
  const [groups, setGroups] = useState<DailyGroup[]>([])
  const [models, setModels] = useState<{ id: string; label: string }[]>([])
  const [selected, setSelected] = useState('')
  const [date, setDate] = useState(() => dailyVietnamDate())
  const [loaded, setLoaded] = useState<LoadedReport | null>(null)
  const [error, setError] = useState(''), [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false), [refresh, setRefresh] = useState(0)
  const [employeeNames, setEmployeeNames] = useState<string[]>([])
  const [form, setForm] = useState<GroupForm | null>(null)
  const mounted = useRef(true), actionBusy = useRef(false)
  const scope = `${companyId}/${selected}/${date}`, currentScope = useRef(scope)
  currentScope.current = scope
  const validDate = dailyReportDateSchema.safeParse(date).success
  const current = loaded?.scope === scope ? loaded : null
  const detail = current?.detail ?? null
  const loading = !!selected && validDate && !current
  const group = groups.find(item => item.id === selected)
  const roundBase = detail ? `${base}/${selected}/rounds/${detail.round.id}` : ''

  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  useEffect(() => {
    const controller = new AbortController()
    void request<{ employees: { name: string; companyIds: string[]; active: boolean }[] }>('/api/workforce/employees', { signal: controller.signal })
      .then(result => { if (!controller.signal.aborted) setEmployeeNames(result.employees.filter(item => item.active && item.companyIds.includes(companyId)).map(item => item.name)) })
      .catch(() => {})
    return () => controller.abort()
  }, [companyId])
  useEffect(() => {
    const controller = new AbortController()
    void request<{ groups: DailyGroup[]; models: { id: string; label: string }[] }>(base, { signal: controller.signal })
      .then(result => { if (!controller.signal.aborted) { setGroups(result.groups); setModels(result.models) } })
      .catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : String(cause)) })
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
  useEffect(() => { const timer = setInterval(() => setRefresh(value => value + 1), 15000); return () => clearInterval(timer) }, [])

  async function run(action: (isCurrent: () => boolean) => Promise<void>): Promise<void> {
    if (actionBusy.current) return
    actionBusy.current = true
    const captured = scope, isCurrent = (): boolean => mounted.current && currentScope.current === captured
    setBusy(true); setError(''); setNotice('')
    try { await action(isCurrent); if (isCurrent()) setRefresh(value => value + 1) }
    catch (cause) { if (isCurrent()) setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { actionBusy.current = false; if (mounted.current) setBusy(false) }
  }
  function changeSelection(groupId: string, reportingDate: string): void {
    setSelected(groupId); setDate(reportingDate); setError(''); setNotice('')
  }
  async function save(): Promise<void> {
    if (!form) return
    const parsed = dailyGroupSchema.safeParse({ ...form, members: form.members.split('\n').map(value => value.trim()).filter(Boolean) })
    if (!parsed.success) { setError(parsed.error.issues.map(issue => issue.message).join('; ')); return }
    await run(async isCurrent => {
      const result = await request<{ group: DailyGroup }>(form.id ? `${base}/${form.id}` : base, {
        method: form.id ? 'PATCH' : 'POST', body: form.id ? { version: form.version, group: parsed.data } : parsed.data,
      })
      if (!isCurrent()) return
      setGroups(previous => [result.group, ...previous.filter(item => item.id !== result.group.id)])
      setSelected(result.group.id); setDate(dailyVietnamDate()); setForm(null); setNotice(l('Đã lưu nhóm.', 'Group saved.'))
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
        await navigator.clipboard.writeText(reminder ? `${detail?.current.groupName} — ${date}\n${l('Bạn có thể nhập hoặc sửa báo cáo bất cứ lúc nào bằng cách chọn tên. Nếu ngày này nghỉ, đánh dấu “Ngày này nghỉ”. Bản tổng hợp chốt lúc 16:50 giờ Việt Nam.', 'Submit or edit at any time by selecting your name. If you are off that day, select “Day off”. The summary cutoff is 16:50 Vietnam time.')}\n${url}` : url)
        if (isCurrent()) setNotice(l('Đã sao chép.', 'Copied.'))
      } catch {
        if (isCurrent()) setError(l('Không thể sao chép tự động. Hãy chọn địa chỉ link bên dưới và sao chép thủ công.', 'Automatic copy failed. Select the link address below and copy it manually.'))
      }
    })
  }

  const createReason = !validDate ? l('Hãy chọn ngày báo cáo hợp lệ.', 'Choose a valid reporting date.')
    : detail ? '' : !group?.enabled ? l('Nhóm đang tạm dừng. Bật nhóm để tạo đợt mới.', 'This group is paused. Enable it to create a new round.')
    : date < dailyVietnamDate() ? l('Ngày này chưa có đợt báo cáo. Không thể tạo đợt mới cho ngày đã qua.', 'There is no round for this date. New rounds cannot be created for past dates.')
    : !dailyWorkingDay(date) ? l('Chủ nhật không nhận báo cáo. Chọn ngày từ thứ Hai đến thứ Bảy.', 'Reports are not collected on Sundays. Choose Monday through Saturday.') : ''

  return <Trang rong><div className="cot daily-reports">
    <header className="hang"><h1 className="the__tieu-de" style={{ flex: 1 }}>{l('Báo cáo hằng ngày', 'Daily work reports')}</h1>
      <Nut onClick={() => setForm({ name: '', title: 'Daily Team Work Report', members: '', enabled: true, modelId: null })}>{l('Tạo nhóm', 'Create group')}</Nut></header>
    <Card><p>{l('Lịch thứ Hai–thứ Bảy · Chốt tổng hợp 16:50 giờ Việt Nam · Nhập và sửa báo cáo bất cứ lúc nào, kể cả ngày đã qua.', 'Monday–Saturday schedule · Summary cutoff at 16:50 Vietnam time · Submit and edit at any time, including past dates.')}</p>
      <details><summary>{l('Hướng dẫn chia sẻ và nộp báo cáo', 'Sharing and submission guidance')}</summary>
        <p>{l('Gửi link nộp cho thành viên, link xem tổng hợp cho người cần theo dõi. Biểu mẫu nộp không yêu cầu đăng nhập và không xác thực danh tính; chỉ chia sẻ trong nhóm tin cậy.', 'Send the submission link to members and the summary link to readers. The submission form does not require login or verify identity; share it only within a trusted group.')}</p>
        <p>{l('Đợt tạo trước giữ danh sách thành viên tại lúc tạo. Link xem tự cập nhật khi có bản tổng hợp mới hoàn tất.', 'Future rounds retain the roster at creation. The view link updates when a new summary is ready.')}</p>
      </details></Card>
    <div aria-live="polite">{error || current?.error ? <ThongBao loai="loi">{error || current?.error}</ThongBao> : null}
      {notice ? <ThongBao loai="thanh-cong">{notice}</ThongBao> : null}</div>
    <Card><div className="daily-reports__controls">
      <label className="truong"><span className="nhan">{l('Nhóm', 'Group')}</span><OChon ariaLabel={l('Nhóm', 'Group')} value={selected} onChange={value => changeSelection(value, dailyVietnamDate())}
        options={[{ value: '', label: l('Chọn nhóm', 'Select group') }, ...groups.map(item => ({ value: item.id, label: `${item.name} (${item.members.length})${item.enabled ? '' : l(' — tạm dừng', ' — paused')}` }))]} /></label>
      <label className="truong"><span className="nhan">{l('Ngày báo cáo', 'Reporting date')}</span><input className="o-nhap" type="date" value={date} onChange={event => changeSelection(selected, event.target.value)} /></label>
      <div className="hang daily-reports__actions">
        <Nut bien="phu" onClick={() => changeSelection(selected, dailyVietnamDate())}>{l('Hôm nay', 'Today')}</Nut>
        <Nut disabled={!selected || busy || loading || !!createReason} dangTai={busy} onClick={() => void createLinks()}>{l('Tạo link chia sẻ', 'Create sharing links')}</Nut>
        {group ? <Nut bien="phu" disabled={busy} onClick={() => setForm({ ...group, members: group.members.map(member => member.name).join('\n') })}>{l('Sửa nhóm', 'Edit group')}</Nut> : null}
      </div>
    </div></Card>
    {!groups.length ? <p>{l('Chưa có nhóm báo cáo. Chọn “Tạo nhóm” để bắt đầu.', 'No reporting groups yet. Choose “Create group” to begin.')}</p>
      : !selected ? <p>{l('Chọn nhóm và ngày để xem báo cáo hoặc tạo link chia sẻ.', 'Select a group and date to view a report or create sharing links.')}</p> : null}
    {loading ? <DangTai /> : null}
    {group && !loading && !detail && !current?.error ? <Card tieuDe={l('Chưa có đợt báo cáo', 'No reporting round yet')}>
      <p>{createReason || l('Chọn “Tạo link chia sẻ” để tạo đợt cho ngày này và lấy hai link.', 'Choose “Create sharing links” to prepare this date and get both links.')}</p>
    </Card> : null}
    {detail ? <>
      {detail.share.warning ? <ThongBao loai="canh-bao">{detail.share.warning}</ThongBao> : null}
      <div className="daily-reports__links">
        {([{ title: l('Link nộp báo cáo', 'Submission link'), url: detail.share.url, hint: l('Chọn tên để nhập, sửa báo cáo đã lưu hoặc đánh dấu ngày nghỉ.', 'Select a name to submit, edit a saved report or mark a day off.'), reminder: true },
          { title: l('Link xem tổng hợp', 'Summary view link'), url: detail.share.viewUrl, hint: l('Chỉ đọc · Không cần đăng nhập · Luôn hiển thị bản tổng hợp mới nhất đã hoàn tất.', 'Read only · No login required · Always shows the latest completed summary.'), reminder: false }] as const).map(link =>
          <Card key={link.title} tieuDe={link.title} phu={link.hint}>
            {link.url ? <div className="cot"><label className="truong"><span className="nhan">{link.title}</span><input className="o-nhap" readOnly value={link.url} onFocus={event => event.currentTarget.select()} /></label>
              <div className="hang"><Nut disabled={busy} onClick={() => void copy(link.url!)}>{l('Sao chép link', 'Copy link')}</Nut>
                <a className="nut nut--phu" href={link.url} target="_blank" rel="noopener noreferrer">{l('Mở link', 'Open link')}</a>
                {link.reminder ? <Nut bien="phu" disabled={busy} onClick={() => void copy(link.url!, true)}>{l('Sao chép lời nhắc', 'Copy reminder')}</Nut> : null}</div></div>
              : <p>{l('Chọn “Tạo link chia sẻ” để chuẩn bị link này.', 'Choose “Create sharing links” to prepare this link.')}</p>}
          </Card>)}
      </div>
      <Card tieuDe={`${detail.current.groupName} · ${detail.round.date}`}><div className="cot">
        <strong>{l('Thành viên', 'Members')}: {detail.current.members.length} · {l('Đã nộp', 'Submitted')}: {detail.current.members.filter(member => member.revision).length} · {l('Nghỉ', 'Day off')}: {detail.current.members.filter(member => member.isDayOff).length}</strong>
        {detail.current.members.map(member => <details key={member.memberId}><summary>{member.name} — {member.isDayOff ? `${l('Nghỉ', 'Day off')} · ` : ''}{member.status === 'overdue' && !detail.round.sealedAt ? l('Chưa nộp — chưa đến hạn', 'Pending — deadline not reached') : member.status}</summary>
          <p className="daily-report-text">{member.isDayOff ? l('Nghỉ', 'Day off') : member.work || l('Chưa nộp báo cáo', 'No submission')}</p><p className="daily-report-text">{member.blockers}</p><p className="daily-report-text">{member.nextSteps}</p><small>{member.submittedAt}</small></details>)}
        <Nut bien="phu" disabled={busy || !detail.round.sealedAt} onClick={() => void run(async isCurrent => {
          await request(`${roundBase}/update`, { method: 'POST' }); if (isCurrent()) setNotice(l('Đã xếp hàng tạo bản cập nhật.', 'Updated version queued.'))
        })}>{l('Tạo bản cập nhật sau hạn', 'Generate updated version')}</Nut>
      </div></Card>
      {detail.versions.map(version => <Card key={version.id} tieuDe={`${l('Phiên bản', 'Version')} ${version.number} — ${version.status}`}><div className="cot">
        <small>{version.createdAt} · {l('Bản gốc và dữ liệu chốt không bị ghi đè.', 'Original snapshot is never overwritten.')}</small>
        {version.error ? <ThongBao loai="loi">{version.error}</ThongBao> : null}
        {version.status === 'failed' ? <Nut disabled={busy} onClick={() => void run(async () => { await request(`${roundBase}/versions/${version.id}/retry`, { method: 'POST' }) })}>{l('Thử lại', 'Retry')}</Nut> : null}
        {version.english ? <><div className="hang">{(['docx', 'pdf'] as const).map(format => <a className="nut nut--phu" key={format} href={`${roundBase}/versions/${version.id}/export?format=${format}`}>{l('Tải', 'Download')} {format.toUpperCase()}</a>)}</div>
          <h3>Executive Summary</h3><p className="daily-report-text">{version.english.executiveSummary}</p>
          {version.snapshot.members.map(member => { const translated = version.english!.individuals.find(item => item.memberId === member.memberId); return <section key={member.memberId} lang="en"><h3>{member.name}</h3>
            <p>{member.isDayOff ? 'Day off · ' : ''}{member.status === 'overdue' ? 'Overdue — no report submitted by the deadline.' : member.status.replaceAll('_', ' ')}</p>
            {!member.isDayOff && translated ? <><p className="daily-report-text">{translated.work}</p><p className="daily-report-text">Blockers: {translated.blockers || 'None reported.'}</p><p className="daily-report-text">Next steps: {translated.nextSteps || 'Not provided.'}</p></> : null}</section> })}</> : null}
      </div></Card>)}
    </> : null}
    <HopThoai mo={!!form} tieuDe={l('Thiết lập nhóm báo cáo', 'Reporting group settings')} onDong={() => { if (!busy) setForm(null) }} chanDung={<Nut disabled={busy} onClick={() => void save()}>{l('Lưu nhóm', 'Save group')}</Nut>}>
      {form ? <div className="cot">
        <Truong nhan={l('Tên nhóm', 'Group name')}><ONhap value={form.name} onChange={name => setForm({ ...form, name })} /></Truong>
        <Truong nhan={l('Tiêu đề tài liệu (tiếng Anh)', 'Document title (English)')}><ONhap value={form.title} onChange={title => setForm({ ...form, title })} /></Truong>
        <Truong nhan={l('Thành viên — mỗi dòng một tên, tên phải phân biệt', 'Members — one distinct name per line')}><OVanBan rows={8} value={form.members} onChange={members => setForm({ ...form, members })} /></Truong>
        {employeeNames.length ? <details><summary>{l('Thêm từ nhân viên hiện có', 'Add existing employees')}</summary>{employeeNames.map(name => <label key={name} className="daily-reports__employee"><input type="checkbox" checked={form.members.split('\n').includes(name)} onChange={event => setForm({ ...form, members: event.target.checked ? [...form.members.split('\n').filter(Boolean), name].join('\n') : form.members.split('\n').filter(item => item !== name).join('\n') })} />{name}</label>)}</details> : null}
        <p>{l('Số người', 'Member count')}: {form.members.split('\n').filter(value => value.trim()).length}</p>
        <Truong nhan={l('Model tổng hợp tiếng Anh', 'English synthesis model')}><OChon value={form.modelId ?? ''} onChange={modelId => setForm({ ...form, modelId: modelId || null })} options={[{ value: '', label: l('Chưa chọn — báo cáo sẽ cần cấu hình để tổng hợp', 'Not selected — synthesis requires configuration') }, ...models.map(model => ({ value: model.id, label: model.label }))]} /></Truong>
        <label><input type="checkbox" checked={form.enabled} onChange={event => setForm({ ...form, enabled: event.target.checked })} /> {l('Bật lịch thứ Hai–thứ Bảy', 'Enable Monday–Saturday schedule')}</label>
        <p>{l('Sửa danh sách áp dụng cho đợt chưa tạo, không thay đổi đợt hiện có.', 'Roster changes affect future rounds only, not existing rounds.')}</p>
      </div> : null}
    </HopThoai>
  </div></Trang>
}
