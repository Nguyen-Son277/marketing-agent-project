import { useEffect, useRef, useState } from 'react'
import type { DailyMemberSubmissionResponse, DailyPublicInfo, DailySubmissionReceipt } from '@marketing-agent/shared'
import { ApiError, request } from '../lib/api.ts'
import { Card, Nut, OVanBan, OChon, ThongBao, Trang } from '../components/ui.tsx'

export function NhapBaoCaoHangNgay({ token }: { token: string }) {
  return <DailyReportForm key={token} token={token} />
}

function DailyReportForm({ token }: { token: string }) {
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

  return <Trang><div className="cot" style={{ maxWidth: 760, margin: '0 auto', padding: '24px 0' }}>
    <h1>Báo cáo công việc / Daily Work Report</h1>
    {error ? <><ThongBao loai="loi">{error}</ThongBao><Nut bien="phu" onClick={() => setReload(value => value + 1)}>Thử lại / Retry</Nut></> : null}
    {info ? <Card tieuDe={`${info.groupName} · ${info.date}`}><div className="cot">
      <p>Bạn có thể nhập và chỉnh sửa báo cáo bất cứ lúc nào. Chọn tên để tải báo cáo đã lưu, kể cả trên thiết bị khác. / Submit or edit at any time. Select your name to load your saved report on any device.</p>
      <p>Bản tổng hợp tiếng Anh chốt lúc 16:50 giờ Việt Nam. Nội dung nộp hoặc sửa sau mốc này sẽ được đưa vào bản cập nhật khi quản lý tạo lại báo cáo. Bạn có thể nhập tiếng Việt hoặc tiếng Anh. / The English summary has a 16:50 Vietnam-time cutoff. Later submissions and edits appear when a manager generates an updated summary.</p>
      <p>Chỉ chia sẻ link trong nhóm. Người có link có thể chọn tên để xem và sửa báo cáo. / Share the link only within your team. Anyone with it can select a name to view and edit that report.</p>
      <label className="truong"><span className="nhan">Tên của bạn / Your name</span>
        <OChon value={memberId} onChange={setMemberId} options={[{ value: '', label: 'Chọn tên / Select your name' }, ...info.members.map(member => ({ value: member.id, label: member.name }))]} />
      </label>
      {memberId ? <MemberReportForm key={memberId} base={base} memberId={memberId} /> : null}
    </div></Card> : !error ? <p>Đang tải / Loading…</p> : null}
  </div></Trang>
}

function MemberReportForm({ base, memberId }: { base: string; memberId: string }) {
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
    setLoading(true); setLoadFailed(false); setError(''); setNotice(''); setConflict(false)
    void request<DailyMemberSubmissionResponse>(`${base}/members/${encodeURIComponent(memberId)}`, { signal: controller.signal, allowUnauthorized: true })
      .then(({ submission }) => {
        if (controller.signal.aborted) return
        setWork(submission?.work ?? ''); setBlockers(submission?.blockers ?? ''); setNextSteps(submission?.nextSteps ?? '')
        setIsDayOff(submission?.isDayOff ?? false); setVersion(submission?.version ?? 0)
      })
      .catch(cause => {
        if (!controller.signal.aborted) { setLoadFailed(true); setError(cause instanceof Error ? cause.message : String(cause)) }
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [base, memberId, reload])

  async function submit(): Promise<void> {
    if (saving.current || loading || loadFailed || conflict || (!isDayOff && !work.trim())) return
    saving.current = true
    const controller = new AbortController()
    saveController.current = controller
    setBusy(true); setError(''); setNotice('')
    const body = { memberId, isDayOff, work: isDayOff ? '' : work.trim(), blockers: isDayOff ? '' : blockers.trim(), nextSteps: isDayOff ? '' : nextSteps.trim(), ...(version ? { version } : {}) }
    try {
      const receipt = await request<DailySubmissionReceipt>(base, { method: 'POST', body, signal: controller.signal, allowUnauthorized: true })
      if (controller.signal.aborted) return
      setVersion(receipt.version); setWork(body.work); setBlockers(body.blockers); setNextSteps(body.nextSteps)
      setNotice(`${isDayOff ? 'Đã ghi nhận ngày nghỉ / Day off saved.' : 'Đã lưu báo cáo / Report saved.'}${receipt.late ? ' Nội dung sẽ xuất hiện khi quản lý tạo bản cập nhật sau hạn. / Included when a manager generates an updated summary.' : ''}`)
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
  return <form className="cot" onSubmit={event => { event.preventDefault(); void submit() }}>
    <div aria-live="polite">
      {loading ? <p>Đang tải báo cáo đã lưu… / Loading saved report…</p> : null}
      {error ? <ThongBao loai="loi">{error}</ThongBao> : null}
      {notice ? <ThongBao loai="thanh-cong">{notice}</ThongBao> : null}
    </div>
    {loadFailed || conflict ? <Nut bien="phu" disabled={loading} onClick={() => setReload(value => value + 1)}>
      {conflict ? 'Tải bản mới nhất và thay nội dung trong biểu mẫu / Reload latest and replace this form' : 'Thử tải lại / Retry loading'}
    </Nut> : null}
    {!loading && !loadFailed && version > 0 ? <p>Đã tải báo cáo đã lưu. Bạn có thể chỉnh sửa và lưu lại. / Your saved report is ready to edit.</p> : null}
    <label className="hang"><input type="checkbox" checked={isDayOff} disabled={disabled} onChange={event => setIsDayOff(event.target.checked)} /> Ngày này nghỉ / Day off</label>
    {isDayOff ? <ThongBao>Ngày này sẽ được ghi là “Nghỉ / Day off” trong báo cáo. / This report will show “Day off”.</ThongBao> : <>
      <label className="truong"><span className="nhan">Công việc &amp; kết quả hôm nay / Work &amp; results *</span><OVanBan rows={8} value={work} onChange={setWork} disabled={disabled} /></label>
      <label className="truong"><span className="nhan">Khó khăn / Blockers</span><OVanBan rows={3} value={blockers} onChange={setBlockers} disabled={disabled} /></label>
      <label className="truong"><span className="nhan">Kế hoạch tiếp theo / Next steps</span><OVanBan rows={3} value={nextSteps} onChange={setNextSteps} disabled={disabled} /></label>
    </>}
    <Nut type="submit" disabled={disabled || (!isDayOff && !work.trim())} dangTai={busy}>
      {version ? 'Lưu chỉnh sửa / Save changes' : isDayOff ? 'Lưu ngày nghỉ / Save day off' : 'Nộp báo cáo / Submit report'}
    </Nut>
  </form>
}
