import type { ReactNode } from 'react'
import type { DailyStatus } from '@marketing-agent/shared'
import { useI18n } from '../../lib/i18n.tsx'
import { Logo } from '../Logo.tsx'
import { LocaleSwitcher } from '../LocaleSwitcher.tsx'
import { ThemeSwitcher } from '../ThemeSwitcher.tsx'
import './reports.css'

type IconName = 'report' | 'people' | 'check' | 'clock' | 'link' | 'eye' | 'copy' | 'arrow' | 'plus' | 'search' | 'download' | 'settings' | 'leaf'

export function ReportIcon({ name, size = 20 }: { name: IconName; size?: number }) {
  const paths: Record<IconName, ReactNode> = {
    report: <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" /><path d="M14 2v6h6M8 13h8M8 17h5" /></>,
    people: <><circle cx="9" cy="8" r="3" /><path d="M3 21v-3a6 6 0 0 1 12 0v3M16 5a3 3 0 0 1 0 6M21 21v-3a6 6 0 0 0-3-5.2" /></>,
    check: <><circle cx="12" cy="12" r="9" /><path d="m8 12 3 3 5-6" /></>,
    clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
    link: <><path d="m10 13 4-4M8 16l-1 1a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0M16 8l1-1a4 4 0 0 1 6 6l-4 4a4 4 0 0 1-6 0" transform="translate(1 0) scale(.92)" /></>,
    eye: <><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="3" /></>,
    copy: <><rect x="8" y="8" width="12" height="13" rx="2" /><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h3" /></>,
    arrow: <><path d="M7 17 17 7M7 7h10v10" /></>,
    plus: <path d="M12 5v14M5 12h14" />,
    search: <><circle cx="10" cy="10" r="6" /><path d="m15 15 5 5" /></>,
    download: <><path d="M12 3v12m-5-5 5 5 5-5M4 16v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4" /></>,
    settings: <><path d="M4 7h16M4 17h16" /><circle cx="9" cy="7" r="3" /><circle cx="15" cy="17" r="3" /></>,
    leaf: <><path d="M20 3C10 2 3 7 5 15c8 5 16-2 15-12ZM4 21 15 10" /></>,
  }
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">{paths[name]}</svg>
}

export function ReportStatus({ status, dayOff = false, pending = false }: { status: DailyStatus; dayOff?: boolean; pending?: boolean }) {
  const { locale } = useI18n()
  const l = (vi: string, en: string) => locale === 'en' ? en : vi
  const label = dayOff ? l('Ngày nghỉ', 'Day off')
    : status === 'overdue' ? (pending ? l('Chưa nộp', 'Pending') : l('Quá hạn chưa nộp', 'Overdue'))
    : status === 'on_time' ? l('Đúng hạn', 'On time')
    : status === 'late_submission' ? l('Nộp sau hạn', 'Late submission')
    : l('Sửa sau hạn', 'Updated after deadline')
  const tone = dayOff ? 'neutral' : status === 'on_time' ? 'success' : status === 'overdue' && !pending ? 'danger' : 'warning'
  return <span className={`report-badge report-badge--${tone}`}><span className="report-badge__dot" />{label}</span>
}

export function ReportEmpty({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return <div className="report-empty">
    <span className="report-empty__icon"><ReportIcon name="report" size={28} /></span>
    <h2>{title}</h2>
    {children ? <p>{children}</p> : null}
    {action}
  </div>
}

export function ReportPublicHeader() {
  const { locale } = useI18n()
  return <header className="report-public-header">
    <div className="report-public-brand"><Logo size={34} /><span>{locale === 'en' ? 'Team workspace' : 'Không gian làm việc'}</span></div>
    <div className="hang"><LocaleSwitcher compact /><ThemeSwitcher compact /></div>
  </header>
}

export function ReportDate({ date }: { date: string }) {
  const { locale } = useI18n()
  const value = new Date(`${date}T12:00:00+07:00`)
  return <time dateTime={date}>{Number.isFinite(value.getTime()) ? new Intl.DateTimeFormat(locale === 'en' ? 'en-GB' : 'vi-VN', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric', timeZone: 'Asia/Ho_Chi_Minh' }).format(value) : date}</time>
}

export function EnglishReportBody({ summary, members }: {
  summary: string
  members: { name: string; status: DailyStatus; isDayOff?: boolean; work: string; blockers: string; nextSteps: string }[]
}) {
  return <div lang="en" className="report-document">
    <section className="report-document__summary"><span className="report-eyebrow">TEAM OVERVIEW</span><h2>Executive Summary</h2><p className="daily-report-text">{summary}</p></section>
    <div className="report-document__members">{members.map((member, index) => <section key={`${index}-${member.name}`} className="report-document__member">
      <div className="report-section-heading"><h3><span className="report-document__number">{String(index + 1).padStart(2, '0')}</span>{member.name}</h3>
        <span className="report-document__status">{member.isDayOff ? 'Day off' : member.status.replaceAll('_', ' ')}</span></div>
      {member.status === 'overdue' ? <p className="report-muted">Overdue — no report submitted by the deadline.</p>
        : member.isDayOff ? <p className="report-muted">Day off.</p>
        : <><p className="daily-report-text">{member.work}</p><div className="report-document__secondary">
          <div><h4>Blockers</h4><p className="daily-report-text">{member.blockers || 'None reported.'}</p></div>
          <div><h4>Next steps</h4><p className="daily-report-text">{member.nextSteps || 'Not provided.'}</p></div>
        </div></>}
    </section>)}</div>
  </div>
}
