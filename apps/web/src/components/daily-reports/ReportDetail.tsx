import { useState } from 'react'
import type { DailyRoundDetailResponse } from '@marketing-agent/shared'
import { useI18n } from '../../lib/i18n.tsx'
import { Nut, ThongBao } from '../ui.tsx'
import { EnglishReportBody, ReportEmpty, ReportIcon, ReportStatus } from './ReportUI.tsx'

type MemberFilter = 'all' | 'submitted' | 'pending' | 'off'

export function ReportDetail({ detail, roundBase, busy, onUpdate, onRetry }: {
  detail: DailyRoundDetailResponse
  roundBase: string
  busy: boolean
  onUpdate: () => void
  onRetry: (versionId: string) => void
}) {
  const { locale, formatDateTime } = useI18n()
  const l = (vi: string, en: string) => locale === 'en' ? en : vi
  const [tab, setTab] = useState<'submissions' | 'summary'>('submissions')
  const [filter, setFilter] = useState<MemberFilter>('all')
  const [search, setSearch] = useState('')
  const [versionId, setVersionId] = useState('')
  const members = detail.current.members
  const submitted = members.filter(member => member.revision !== null).length
  const off = members.filter(member => member.isDayOff).length
  const percent = members.length ? Math.round(submitted / members.length * 100) : 0
  const versions = [...detail.versions].sort((a, b) => b.number - a.number)
  const version = versions.find(item => item.id === versionId) ?? versions.find(item => item.status === 'ready') ?? versions[0]
  const labels = {
    pending: l('Đang chờ', 'Queued'),
    running: l('Đang tổng hợp', 'Generating'),
    ready: l('Hoàn tất', 'Ready'),
    failed: l('Cần thử lại', 'Failed'),
  }
  const visible = members.filter(member => {
    const matchesStatus = filter === 'all' || (filter === 'submitted' && member.revision !== null) || (filter === 'pending' && member.revision === null) || (filter === 'off' && member.isDayOff)
    return matchesStatus && member.name.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())
  })
  const stats = [
    { id: 'all', label: l('Thành viên', 'Team members'), count: members.length, icon: 'people', tone: 'neutral' },
    { id: 'submitted', label: l('Đã nộp báo cáo', 'Submitted'), count: submitted, icon: 'check', tone: 'success' },
    { id: 'pending', label: l('Chưa nộp', 'Not submitted'), count: members.length - submitted, icon: 'clock', tone: 'warning' },
    { id: 'off', label: l('Ngày nghỉ', 'Day off'), count: off, icon: 'leaf', tone: 'neutral' },
  ] as const

  return <>
    <div className="report-stats" aria-label={l('Thống kê bài nộp', 'Submission statistics')}>
      {stats.map(stat => <button key={stat.id} type="button" className={`report-stat report-stat--${stat.tone}`} aria-pressed={tab === 'submissions' && filter === stat.id} onClick={() => {
        setFilter(stat.id)
        setTab('submissions')
      }}>
        <span className="report-stat__top"><span>{stat.label}</span><ReportIcon name={stat.icon} /></span>
        <strong>{stat.count}</strong><span className="report-stat__caption">{stat.id === 'off' ? l('Đã tính trong số bài nộp', 'Included in submitted reports') : stat.id === 'submitted' ? `${percent}% ${l('thành viên', 'of the team')}` : stat.id === 'pending' ? l('Chờ thành viên cập nhật', 'Awaiting a submission') : l('Trong đợt báo cáo này', 'In this reporting round')}</span>
      </button>)}
    </div>
    <section className="report-panel">
      <div className="report-progress"><div className="report-section-heading"><strong>{l('Tiến độ báo cáo', 'Reporting progress')}</strong><span>{submitted}/{members.length} · {percent}%</span></div>
        <progress max={Math.max(members.length, 1)} value={submitted} aria-label={l('Tiến độ nộp báo cáo', 'Submission progress')} />
      </div>
      <div className="report-tabs" aria-label={l('Nội dung báo cáo', 'Report content')}>
        <button type="button" aria-pressed={tab === 'submissions'} onClick={() => setTab('submissions')}><ReportIcon name="people" size={18} />{l('Bài nộp của thành viên', 'Member submissions')}<span>{members.length}</span></button>
        <button type="button" aria-pressed={tab === 'summary'} onClick={() => setTab('summary')}><ReportIcon name="report" size={18} />{l('Tổng hợp tiếng Anh', 'English summary')}<span>{versions.length}</span></button>
      </div>
      {tab === 'submissions' ? <div className="report-submissions">
        <div className="report-list-toolbar"><label className="report-search"><ReportIcon name="search" size={18} /><input type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder={l('Tìm thành viên…', 'Search members…')} aria-label={l('Tìm thành viên', 'Search members')} /></label>
          <select className="o-chon" value={filter} onChange={event => setFilter(event.target.value as MemberFilter)} aria-label={l('Lọc trạng thái', 'Filter by status')}>
            {stats.map(stat => <option key={stat.id} value={stat.id}>{stat.id === 'all' ? l('Tất cả trạng thái', 'All statuses') : stat.label} ({stat.count})</option>)}
          </select></div>
        <div className="report-member-list">{visible.length ? visible.map(member => <details key={member.memberId} className="report-member">
          <summary><span className="report-avatar">{member.name.trim().split(/\s+/).slice(-2).map(part => part[0]).join('')}</span>
            <span className="report-member__identity"><strong>{member.name}</strong><span>{member.submittedAt ? formatDateTime(member.submittedAt) : l('Chưa có báo cáo được gửi', 'No report submitted yet')}</span></span>
            <ReportStatus status={member.status} dayOff={member.isDayOff} pending={!detail.round.sealedAt} /><span className="report-member__chevron" aria-hidden="true">⌄</span>
          </summary>
          <div className="report-member__body">{member.isDayOff ? <p className="report-muted">{l('Thành viên đã ghi nhận nghỉ trong ngày này.', 'This member has marked this date as a day off.')}</p>
            : member.revision === null ? <p className="report-muted">{l('Chưa có bài nộp. Thành viên vẫn có thể nhập báo cáo qua link chia sẻ.', 'No submission yet. This member can still submit through the shared link.')}</p>
            : <><h4>{l('Công việc & kết quả', 'Work & results')}</h4><p className="daily-report-text">{member.work}</p>
              <div className="report-document__secondary"><div><h4>{l('Khó khăn', 'Blockers')}</h4><p className="daily-report-text">{member.blockers || l('Không ghi nhận', 'None reported')}</p></div>
                <div><h4>{l('Kế hoạch tiếp theo', 'Next steps')}</h4><p className="daily-report-text">{member.nextSteps || l('Chưa cung cấp', 'Not provided')}</p></div></div></>}
          </div>
        </details>) : <ReportEmpty title={l('Không tìm thấy thành viên', 'No members found')} action={<Nut bien="phu" onClick={() => {
          setSearch('')
          setFilter('all')
        }}>{l('Xóa bộ lọc', 'Clear filters')}</Nut>}>{l('Thử tìm tên khác hoặc thay đổi bộ lọc trạng thái.', 'Try another name or change the status filter.')}</ReportEmpty>}</div>
        <div className="report-list-footer">{l('Hiển thị', 'Showing')} {visible.length}/{members.length} {l('thành viên', 'members')}<span>{l('Nhấn vào thành viên để xem chi tiết', 'Select a member to view details')}</span></div>
      </div> : <div className="report-versions">
        <div className="report-version-toolbar"><label className="truong"><span className="nhan">{l('Phiên bản tổng hợp', 'Summary version')}</span><select className="o-chon" value={version?.id ?? ''} onChange={event => setVersionId(event.target.value)} disabled={!versions.length}>
          {!versions.length ? <option value="">{l('Chưa có phiên bản', 'No versions yet')}</option> : versions.map(item => <option key={item.id} value={item.id}>{l('Phiên bản', 'Version')} {item.number} · {labels[item.status]}</option>)}
        </select></label>
          <Nut bien="phu" disabled={busy || !detail.round.sealedAt} onClick={onUpdate}><ReportIcon name="plus" size={16} />{l('Tạo bản cập nhật sau hạn', 'Generate updated version')}</Nut>
        </div>
        <p className="report-note">{l('Bản chốt được tạo lúc 16:50 giờ Việt Nam. Mỗi bản cập nhật giữ nguyên bản gốc và lịch sử trước đó.', 'The original is sealed at 16:50 Vietnam time. Updates preserve the original snapshot and all previous versions.')}</p>
        {version ? <>
          <div className="report-section-heading report-version-meta"><span className={`report-badge report-badge--${version.status === 'ready' ? 'success' : version.status === 'failed' ? 'danger' : 'warning'}`}>{labels[version.status]}</span><time dateTime={version.createdAt}>{formatDateTime(version.createdAt)}</time></div>
          {version.error ? <ThongBao loai="loi">{version.error}</ThongBao> : null}
          {version.status === 'failed' ? <div className="report-retry"><p className="report-muted">{l('Kiểm tra model tổng hợp của nhóm rồi thử lại. Bài nộp của thành viên vẫn được lưu.', 'Check the group synthesis model and retry. Member submissions are saved.')}</p><Nut disabled={busy} onClick={() => onRetry(version.id)}>{l('Thử tổng hợp lại', 'Retry summary')}</Nut></div> : null}
          {version.status === 'pending' || version.status === 'running' ? <ReportEmpty title={l('Đang chuẩn bị bản tổng hợp', 'Preparing your summary')}>{l('Bạn có thể tiếp tục xem bài nộp. Trạng thái được cập nhật tự động mỗi 15 giây.', 'You can continue reviewing submissions. The status refreshes automatically every 15 seconds.')}</ReportEmpty> : null}
          {version.status === 'ready' && version.english ? <>
            <div className="report-downloads">{(['docx', 'pdf'] as const).map(format => <a className="btn btn--phu" key={format} href={`${roundBase}/versions/${version.id}/export?format=${format}`}><ReportIcon name="download" size={16} />{format === 'docx' ? l('Tải Word', 'Download Word') : l('Tải PDF', 'Download PDF')}</a>)}</div>
            <EnglishReportBody summary={version.english.executiveSummary} members={version.snapshot.members.map(member => ({ ...member, ...version.english!.individuals.find(item => item.memberId === member.memberId) }))} />
          </> : null}
        </> : <ReportEmpty title={l('Bản tổng hợp chưa sẵn sàng', 'No summary yet')}>{l('Hệ thống tự chốt và tổng hợp lúc 16:50. Bài nộp và chỉnh sửa sau hạn sẽ được đưa vào bản cập nhật khi bạn tạo.', 'The summary is generated at the 16:50 cutoff. Later submissions and edits are included when you generate an update.')}</ReportEmpty>}
      </div>}
    </section>
  </>
}
