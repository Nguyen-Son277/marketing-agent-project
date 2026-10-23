import { useEffect, useRef, useState } from 'react'
import type { DailyMemberSubmissionResponse, DailyPublicInfo, DailySubmissionReceipt } from '@marketing-agent/shared'
import { ApiError, request } from '../lib/api.ts'
import { DangTai, Nut, ThongBao } from '../components/ui.tsx'
import { useI18n } from '../lib/i18n.tsx'
import { ReportDate, ReportEmpty, ReportIcon, ReportPublicHeader } from '../components/daily-reports/ReportUI.tsx'

export function NhapBaoCaoHangNgay({ token }: { token: string }) {
  return <DailyReportForm key={token} token={token} />
}

function DailyReportForm({ token }: { token: string }) {
  const { locale } = useI18n()
  const l = (vi: string, en: string) => locale === 'en' ? en : vi
  const [info, setInfo] = useState<DailyPublicInfo | null>(null)
  const [memberId, setMemberId] = useState('')
  const [error, setError] = useState('')
  const [reload, setReload] = useState(0)
  const base = `/api/public/daily-reports/${token}`

  useEffect(() => {
    const controller = new AbortController()
    setError('')
    void request<DailyPublicInfo>(base, { signal: controller.signal, allowUnauthorized: true })
      .then(data => { if (!controller.signal.aborted) setInfo(data) })
      .catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : String(cause)) })
    return () => controller.abort()
  }, [base, reload])

  return <main className="report-public report-public--entry">
    <ReportPublicHeader />
    <div className="report-public-title"><span className="report-eyebrow">{l('MỖI NGÀY MỘT BƯỚC TIẾN', 'EVERY DAY, A STEP FORWARD')}</span><h1>{l('Báo cáo công việc', 'Daily work report')}</h1>
      <p>{info ? <>{info.groupName} · <ReportDate date={info.date} /></> : l('Cập nhật công việc và kết quả trong ngày của bạn.', 'Share your work and results for the day.')}</p></div>
    {error ? <div role="alert"><ThongBao loai="loi">{error}</ThongBao><div className="report-retry"><Nut bien="phu" onClick={() => setReload(value => value + 1)}>{l('Thử lại', 'Retry')}</Nut></div></div> : null}
    {info ? <section className="report-panel report-entry">
      <div className="report-entry-intro"><ReportIcon name="clock" /><div><strong>{l('Chốt tổng hợp lúc 16:50 · Giờ Việt Nam', 'Summary cutoff at 16:50 · Vietnam time')}</strong><p>{l('Bạn vẫn có thể nộp và chỉnh sửa sau hạn. Nội dung mới sẽ xuất hiện khi quản lý tạo bản cập nhật. Có thể nhập bằng tiếng Việt hoặc tiếng Anh.', 'You can submit and edit after the cutoff. Changes appear when a manager generates an update. Write in Vietnamese or English.')}</p></div></div>
      <label className="truong"><span className="nhan">{l('Tên của bạn', 'Your name')}</span><select className="o-chon" aria-label={l('Tên của bạn', 'Your name')} value={memberId} onChange={event => setMemberId(event.target.value)}><option value="">{l('Chọn tên của bạn để bắt đầu', 'Select your name to get started')}</option>{info.members.map(member => <option key={member.id} value={member.id}>{member.name}</option>)}</select></label>
      {memberId ? <MemberReportForm key={memberId} base={base} memberId={memberId} /> : <ReportEmpty title={l('Hôm nay bạn đã làm được gì?', 'What did you accomplish today?')}>{l('Chọn tên để nhập báo cáo mới hoặc tiếp tục chỉnh sửa bài đã lưu trên bất kỳ thiết bị nào.', 'Select your name to write a report or edit your saved submission on any device.')}</ReportEmpty>}
    </section> : !error ? <DangTai /> : null}
    <p className="report-public-footnote">{l('Chỉ chia sẻ link trong nhóm tin cậy. Người có link có thể chọn tên để xem và sửa báo cáo.', 'Share this link only with a trusted team. Anyone with the link can select a name to view and edit reports.')}</p>
  </main>
}

function MemberReportForm({ base, memberId }: { base: string; memberId: string }) {
  const { locale } = useI18n()
  const l = (vi: string, en: string) => locale === 'en' ? en : vi
  const [work, setWork] = useState('')
  const [blockers, setBlockers] = useState('')
  const [nextSteps, setNextSteps] = useState('')
  const [isDayOff, setIsDayOff] = useState(false)
  const [version, setVersion] = useState(0)
  const [loading, setLoading] = useState(true)
  const [loadFailed, setLoadFailed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [conflict, setConflict] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [reload, setReload] = useState(0)
  const saving = useRef(false)
  const saveController = useRef<AbortController | null>(null)

  useEffect(() => () => saveController.current?.abort(), [])
  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setLoadFailed(false)
    setError('')
    setNotice('')
    setConflict(false)
    void request<DailyMemberSubmissionResponse>(`${base}/members/${encodeURIComponent(memberId)}`, { signal: controller.signal, allowUnauthorized: true })
      .then(({ submission }) => {
        if (controller.signal.aborted) return
        setWork(submission?.work ?? '')
        setBlockers(submission?.blockers ?? '')
        setNextSteps(submission?.nextSteps ?? '')
        setIsDayOff(submission?.isDayOff ?? false)
        setVersion(submission?.version ?? 0)
      })
      .catch(cause => {
        if (!controller.signal.aborted) {
          setLoadFailed(true)
          setError(cause instanceof Error ? cause.message : String(cause))
        }
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [base, memberId, reload])

  async function submit(): Promise<void> {
    if (saving.current || loading || loadFailed || conflict || (!isDayOff && !work.trim())) return
    saving.current = true
    const controller = new AbortController()
    saveController.current = controller
    setBusy(true)
    setError('')
    setNotice('')
    const body = { memberId, isDayOff, work: isDayOff ? '' : work.trim(), blockers: isDayOff ? '' : blockers.trim(), nextSteps: isDayOff ? '' : nextSteps.trim(), ...(version ? { version } : {}) }
    try {
      const receipt = await request<DailySubmissionReceipt>(base, { method: 'POST', body, signal: controller.signal, allowUnauthorized: true })
      if (controller.signal.aborted) return
      setVersion(receipt.version)
      setWork(body.work)
      setBlockers(body.blockers)
      setNextSteps(body.nextSteps)
      setNotice(`${isDayOff ? l('Đã ghi nhận ngày nghỉ.', 'Day off saved.') : l('Đã lưu báo cáo.', 'Report saved.')}${receipt.late ? l(' Nội dung sẽ xuất hiện khi quản lý tạo bản cập nhật sau hạn.', ' Included when a manager generates an updated summary.') : ''}`)
    } catch (cause) {
      if (!controller.signal.aborted) {
        setError(cause instanceof Error ? cause.message : String(cause))
        setConflict(cause instanceof ApiError && cause.status === 409)
      }
    } finally {
      saving.current = false
      if (!controller.signal.aborted) setBusy(false)
    }
  }

  const disabled = loading || loadFailed || busy || conflict
  return <form className="report-entry-form" onSubmit={event => {
    event.preventDefault()
    void submit()
  }}>
    <div aria-live="polite">
      {loading ? <DangTai nhan={l('Đang tải báo cáo đã lưu…', 'Loading saved report…')} /> : null}
      {error ? <ThongBao loai="loi">{error}</ThongBao> : null}
      {notice ? <ThongBao loai="thanh-cong">{notice}</ThongBao> : null}
    </div>
    {loadFailed || conflict ? <Nut bien="phu" disabled={loading} onClick={() => setReload(value => value + 1)}>
      {conflict ? l('Tải bản mới nhất và thay nội dung trong biểu mẫu', 'Reload latest and replace this form') : l('Thử tải lại', 'Retry loading')}
    </Nut> : null}
    {!loading && !loadFailed && version > 0 ? <div className="report-entry-intro"><ReportIcon name="check" /><span>{l('Đã tải bài nộp của bạn. Bạn có thể chỉnh sửa và lưu lại.', 'Your saved report is ready. You can edit it and save your changes.')}</span></div> : null}
    <label className="report-day-off"><input type="checkbox" checked={isDayOff} disabled={disabled} onChange={event => setIsDayOff(event.target.checked)} /><span>{l('Ngày này nghỉ', 'Day off')}<small>{l('Ghi nhận ngày nghỉ, không cần nhập nội dung công việc.', 'Mark a day off without entering work details.')}</small></span></label>
    {isDayOff ? <ThongBao>{l('Báo cáo sẽ ghi nhận “Nghỉ / Day off” cho ngày này.', 'This report will show “Day off” for this date.')}</ThongBao> : <>
      <label className="truong"><span className="nhan">{l('Công việc & kết quả hôm nay', 'Work & results')} <small>{l('Bắt buộc', 'Required')}</small></span><textarea className="o-van-ban" rows={7} required maxLength={8000} placeholder={l('Bạn đã hoàn thành những công việc nào? Kết quả đạt được là gì?', 'What did you work on? What results did you achieve?')} value={work} onChange={event => setWork(event.target.value)} disabled={disabled} /><span className="report-field-hint">{work.length.toLocaleString()}/8.000</span></label>
      <label className="truong"><span className="nhan">{l('Khó khăn', 'Blockers')} <small>{l('Không bắt buộc', 'Optional')}</small></span><textarea className="o-van-ban" rows={3} maxLength={3000} placeholder={l('Bạn có gặp trở ngại hoặc cần hỗ trợ gì không?', 'Any obstacles or support you need?')} value={blockers} onChange={event => setBlockers(event.target.value)} disabled={disabled} /></label>
      <label className="truong"><span className="nhan">{l('Kế hoạch tiếp theo', 'Next steps')} <small>{l('Không bắt buộc', 'Optional')}</small></span><textarea className="o-van-ban" rows={3} maxLength={3000} placeholder={l('Những việc bạn dự định thực hiện tiếp theo…', 'What are you planning to work on next?')} value={nextSteps} onChange={event => setNextSteps(event.target.value)} disabled={disabled} /></label>
    </>}
    <div className="report-save-footer"><span className="report-note">{l('Bạn có thể quay lại link này để chỉnh sửa sau khi lưu.', 'Return to this link any time to edit your saved report.')}</span><Nut type="submit" disabled={disabled || (!isDayOff && !work.trim())} dangTai={busy}><ReportIcon name="check" size={17} />
      {version ? l('Lưu chỉnh sửa', 'Save changes') : isDayOff ? l('Lưu ngày nghỉ', 'Save day off') : l('Nộp báo cáo', 'Submit report')}
    </Nut></div>
  </form>
}
