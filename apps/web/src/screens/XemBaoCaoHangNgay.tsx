import { useEffect, useState } from 'react'
import type { DailyPublicReport } from '@marketing-agent/shared'
import { request } from '../lib/api.ts'
import { useI18n } from '../lib/i18n.tsx'
import { Card, DangTai, ThongBao, Trang } from '../components/ui.tsx'
import { Logo } from '../components/Logo.tsx'
import { LocaleSwitcher } from '../components/LocaleSwitcher.tsx'
import { ThemeSwitcher } from '../components/ThemeSwitcher.tsx'

export function XemBaoCaoHangNgay({ token }: { token: string }) {
  return <PublicDailyReport key={token} token={token} />
}

function PublicDailyReport({ token }: { token: string }) {
  const { locale, formatDateTime } = useI18n()
  const l = (vi: string, en: string): string => locale === 'en' ? en : vi
  const [report, setReport] = useState<DailyPublicReport | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    const controller = new AbortController()
    let busy = false
    async function load(): Promise<void> {
      if (busy) return
      busy = true
      try {
        const next = await request<DailyPublicReport>(`/api/public/daily-report-views/${token}`, { signal: controller.signal, allowUnauthorized: true })
        if (!controller.signal.aborted) { setReport(next); setError('') }
      } catch (cause) {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : String(cause))
      } finally { busy = false }
    }
    void load()
    const timer = setInterval(() => void load(), 15000)
    return () => { controller.abort(); clearInterval(timer) }
  }, [token])

  return <Trang><div className="daily-report-public cot">
    <header className="daily-report-public__header"><Logo size={40} /><div className="hang"><LocaleSwitcher compact /><ThemeSwitcher compact /></div></header>
    <h1 className="the__tieu-de">{l('Báo cáo hằng ngày', 'Daily work report')}</h1>
    {error ? <ThongBao loai="loi">{error}</ThongBao> : null}
    {!report && !error ? <DangTai /> : null}
    {report ? <>
      <Card tieuDe={report.title} phu={`${report.groupName} · ${report.date}`}>
        <p>{l('Chỉ đọc · Tự cập nhật mỗi 15 giây', 'Read only · Refreshes every 15 seconds')}</p>
        {report.status === 'pending' ? <ThongBao>{l('Chưa có báo cáo tổng hợp. Trang sẽ tự cập nhật khi bản tổng hợp hoàn tất.', 'No summary is available yet. This page updates automatically when a summary is ready.')}</ThongBao>
          : <><small>{l('Phiên bản', 'Version')} {report.number}{report.publishedAt ? ` · ${formatDateTime(report.publishedAt)}` : ''}</small>
            <section lang="en"><h2>Executive Summary</h2><p className="daily-report-text">{report.executiveSummary}</p></section></>}
      </Card>
      {report.status === 'ready' ? <div lang="en" className="cot">{report.members.map(member => <Card key={member.name} tieuDe={member.name}>
        <p>{member.isDayOff ? 'Day off · ' : ''}{member.status === 'overdue' ? 'Overdue — no report submitted by the deadline.' : member.status.replaceAll('_', ' ')}</p>
        {!member.isDayOff && member.work ? <><p className="daily-report-text">{member.work}</p><p className="daily-report-text"><strong>Blockers: </strong>{member.blockers || 'None reported.'}</p>
          <p className="daily-report-text"><strong>Next steps: </strong>{member.nextSteps || 'Not provided.'}</p></> : null}
      </Card>)}</div> : null}
    </> : null}
  </div></Trang>
}
