import { useEffect, useState } from 'react'
import type { DailyPublicReport } from '@marketing-agent/shared'
import { request } from '../lib/api.ts'
import { useI18n } from '../lib/i18n.tsx'
import { DangTai, ThongBao } from '../components/ui.tsx'
import { EnglishReportBody, ReportDate, ReportEmpty, ReportPublicHeader } from '../components/daily-reports/ReportUI.tsx'

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
        if (!controller.signal.aborted) {
          setReport(next)
          setError('')
        }
      } catch (cause) {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : String(cause))
      } finally { busy = false }
    }
    void load()
    const timer = setInterval(() => void load(), 15000)
    return () => {
      controller.abort()
      clearInterval(timer)
    }
  }, [token])

  return <main className="report-public">
    <ReportPublicHeader />
    <div className="report-public-title"><span className="report-eyebrow">{l('TỔNG HỢP CÔNG VIỆC', 'DAILY TEAM SUMMARY')}</span><h1>{report?.title || l('Báo cáo hằng ngày', 'Daily work report')}</h1>
      {report ? <p>{report.groupName} · <ReportDate date={report.date} /></p> : null}</div>
    {error ? <ThongBao loai="loi">{error}</ThongBao> : null}
    {!report && !error ? <DangTai /> : null}
    {report ? <>
      <section className="report-panel">
        <div className="report-schedule"><span>{l('Chỉ đọc', 'Read only')}{report.number ? ` · ${l('Phiên bản', 'Version')} ${report.number}` : ''}</span><span className="report-live">{l('Tự cập nhật mỗi 15 giây', 'Refreshes every 15 seconds')}</span></div>
        {report.status === 'pending' ? <ReportEmpty title={l('Đang chờ bản tổng hợp', 'Waiting for the summary')}>{l('Trang sẽ tự cập nhật khi bản tổng hợp tiếng Anh hoàn tất. Bạn có thể giữ trang này mở để theo dõi.', 'This page updates automatically when the English summary is ready. Keep it open to follow along.')}</ReportEmpty>
          : <div className="report-public-document"><EnglishReportBody summary={report.executiveSummary ?? ''} members={report.members} />
            {report.publishedAt ? <p className="report-note">{l('Hoàn tất lúc', 'Published')} {formatDateTime(report.publishedAt)}</p> : null}</div>}
      </section>
    </> : null}
    <p className="report-public-footnote">{l('Bản tổng hợp tiếng Anh mới nhất đã hoàn tất. Chỉ chia sẻ với người được phép đọc báo cáo.', 'The latest completed English summary. Share only with people authorized to read this report.')}</p>
  </main>
}
