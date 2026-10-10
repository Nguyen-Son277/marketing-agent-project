/**
 * Công việc — bảng kanban và nơi con người phê duyệt kết quả của agent.
 *
 * Vì sao màn hình này tồn tại: agent tự chia việc và tự chạy, nhưng quyền quyết
 * định cuối cùng vẫn thuộc về con người. Màn hình gom việc theo trạng thái để
 * nhìn ra ngay chỗ tắc, và mở chi tiết ngay trong trang (không đổi route) để
 * người duyệt đọc brief, kết quả, artifact, trao đổi giữa các agent rồi quyết
 * định approve / yêu cầu sửa / huỷ mà không mất ngữ cảnh.
 */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { Translate } from '@marketing-agent/i18n'
import type { TaskDetailResponse, TaskListResponse, TaskStatus, TaskView } from '@marketing-agent/shared'
import { TASK_STATUSES, TERMINAL_TASK_STATUSES } from '@marketing-agent/shared'
import { api, ApiError } from '../lib/api.ts'
import { useI18n } from '../lib/i18n.tsx'
import { Markdown } from '../components/Markdown.tsx'
import {
  Card,
  DangTai,
  Nhan,
  Nut,
  OVanBan,
  ThongBao,
  TieuDeTrang,
  Trang,
  Trong,
} from '../components/ui.tsx'

type LoaiNhan = 'mo' | 'thanh-cong' | 'canh-bao' | 'loi' | 'chinh'

/**
 * Mũi tên chỉ chiều trao đổi giữa hai agent.
 *
 * Viết dạng escape để mã nguồn thuần ASCII ngoài comment tiếng Việt; đây là glyph, không
 * phải câu chữ nên không có gì để dịch.
 */
const MUI_TEN = '\u2192'

function loaiNhanTrangThai(trangThai: TaskStatus): LoaiNhan {
  if (trangThai === 'done') return 'thanh-cong'
  if (trangThai === 'failed' || trangThai === 'blocked') return 'loi'
  if (trangThai === 'review') return 'canh-bao'
  if (trangThai === 'in_progress') return 'chinh'
  return 'mo'
}

/** Ưu tiên càng nhỏ càng gấp (hàng đợi sắp xếp tăng dần theo priority). */
function nhanUuTien(priority: number, t: Translate): { nhan: string; loai: LoaiNhan } {
  // Số ưu tiên là dữ liệu, chỉ mức độ mới là câu chữ — nên số nội suy vào bản dịch chứ
  // không ghép chuỗi ở đây, để tiếng Anh tự quyết định trật tự từ.
  if (priority <= 1) return { nhan: t('tasks.priorityHighest', { priority }), loai: 'loi' }
  if (priority === 2) return { nhan: t('tasks.priorityHigh', { priority }), loai: 'canh-bao' }
  if (priority === 3) return { nhan: t('tasks.priorityMedium', { priority }), loai: 'mo' }
  return { nhan: t('tasks.priorityLow', { priority }), loai: 'mo' }
}

function LoiManHinh({ loi }: { loi: ApiError }): ReactNode {
  const { t } = useI18n()
  return (
    <ThongBao loai="loi">
      {loi.message}
      {loi.needsConfiguration ? ` ${t('dashboard.finishSetup')}` : null}
    </ThongBao>
  )
}

/** Chuyển payload sự kiện (unknown) thành chuỗi đọc được, không bao giờ ném lỗi. */
function chuoiJson(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

export function CongViec({ companyId }: { companyId: string }): ReactNode {
  const { t, formatNumber, formatDateTime } = useI18n()
  const [duLieu, setDuLieu] = useState<TaskListResponse | null>(null)
  const [dangTai, setDangTai] = useState(true)
  const [loi, setLoi] = useState<ApiError | null>(null)
  const [lanThu, setLanThu] = useState(0)

  const [chonId, setChonId] = useState<string | null>(null)
  const [chiTiet, setChiTiet] = useState<TaskDetailResponse | null>(null)
  const [dangTaiChiTiet, setDangTaiChiTiet] = useState(false)
  const [loiChiTiet, setLoiChiTiet] = useState<ApiError | null>(null)

  const [ghiChu, setGhiChu] = useState('')
  const [dangDuyet, setDangDuyet] = useState(false)
  const [thongBaoDuyet, setThongBaoDuyet] = useState<string | null>(null)
  const [loiDuyet, setLoiDuyet] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setDangTai(true)
    setLoi(null)
    api
      .tasks(companyId)
      .then((ketQua) => {
        if (!cancelled) setDuLieu(ketQua)
      })
      .catch((error: unknown) => {
        if (cancelled) return
        setLoi(error instanceof ApiError ? error : new ApiError(0, 'network', t('common.cannotConnectServer')))
      })
      .finally(() => {
        if (!cancelled) setDangTai(false)
      })
    return () => {
      cancelled = true
    }
  }, [companyId, lanThu, t])

  useEffect(() => {
    if (!chonId) {
      setChiTiet(null)
      return
    }
    let cancelled = false
    setDangTaiChiTiet(true)
    setLoiChiTiet(null)
    setChiTiet(null)
    setThongBaoDuyet(null)
    setLoiDuyet(null)
    setGhiChu('')
    api
      .task(chonId)
      .then((ketQua) => {
        if (!cancelled) setChiTiet(ketQua)
      })
      .catch((error: unknown) => {
        if (cancelled) return
        setLoiChiTiet(error instanceof ApiError ? error : new ApiError(0, 'network', t('common.cannotConnectServer')))
      })
      .finally(() => {
        if (!cancelled) setDangTaiChiTiet(false)
      })
    return () => {
      cancelled = true
    }
  }, [chonId, t])

  const taiLai = useCallback(() => setLanThu((lan) => lan + 1), [])

  const tenTheoId = useMemo(() => {
    const map = new Map<string, string>()
    for (const task of duLieu?.tasks ?? []) map.set(task.id, task.title)
    return map
  }, [duLieu])

  const cotTheoTrangThai = useMemo(() => {
    const map = new Map<TaskStatus, TaskView[]>()
    for (const trangThai of TASK_STATUSES) map.set(trangThai, [])
    for (const task of duLieu?.tasks ?? []) {
      const bucket = map.get(task.status)
      if (bucket) bucket.push(task)
    }
    return map
  }, [duLieu])

  async function duyet(quyetDinh: 'approve' | 'request_changes' | 'cancel'): Promise<void> {
    if (!chonId) return
    setDangDuyet(true)
    setLoiDuyet(null)
    setThongBaoDuyet(null)
    try {
      const ketQua = await api.reviewTask(chonId, {
        decision: quyetDinh,
        ...(ghiChu.trim().length > 0 ? { note: ghiChu.trim() } : {}),
      })
      // Mỗi quyết định là một câu trọn vẹn trong catalog: ghép "Đã duyệt" với tên việc ở
      // đây sẽ khoá cứng trật tự từ, mà tiếng Anh cần trật tự khác.
      const thongDiep =
        quyetDinh === 'approve'
          ? t('tasks.decisionApproved', { title: ketQua.task.title })
          : quyetDinh === 'request_changes'
            ? t('tasks.decisionChangesRequested', { title: ketQua.task.title })
            : t('tasks.decisionCancelled', { title: ketQua.task.title })
      setThongBaoDuyet(thongDiep)
      setGhiChu('')
      setLanThu((lan) => lan + 1)
      // Nạp lại chi tiết để thấy ngay sự kiện review vừa sinh.
      const moi = await api.task(chonId)
      setChiTiet(moi)
    } catch (error) {
      setLoiDuyet(error instanceof ApiError ? error.message : t('tasks.errorReview'))
    } finally {
      setDangDuyet(false)
    }
  }

  const taskDangChon = chiTiet?.task ?? null
  const coTheDuyet = taskDangChon !== null && !TERMINAL_TASK_STATUSES.includes(taskDangChon.status)

  return (
    <Trang rong>
      <TieuDeTrang moTa={t('tasks.subtitle')}>{t('nav.tasks')}</TieuDeTrang>

      {loi ? (
        <div style={{ marginBottom: 16 }}>
          <LoiManHinh loi={loi} />
          <div style={{ marginTop: 12 }}>
            <Nut bien="phu" onClick={taiLai}>
              {t('common.retry')}
            </Nut>
          </div>
        </div>
      ) : null}

      {dangTai && !duLieu ? <DangTai nhan={t('tasks.loadingList')} /> : null}

      {duLieu && duLieu.tasks.length === 0 ? <Trong>{t('tasks.empty')}</Trong> : null}

      {duLieu && duLieu.tasks.length > 0 ? (
        <div className="kanban" style={{ marginBottom: 16 }}>
          {TASK_STATUSES.filter((trangThai) => (cotTheoTrangThai.get(trangThai)?.length ?? 0) > 0).map((trangThai) => {
            const the = cotTheoTrangThai.get(trangThai) ?? []
            return (
              <div key={trangThai} className="kanban__cot">
                <div className="kanban__dau">
                  <span>{t(`taskStatus.${trangThai}`)}</span>
                  <span className="so">{formatNumber(the.length)}</span>
                </div>
                {the.map((task) => {
                  const uuTien = nhanUuTien(task.priority, t)
                  return (
                    <button
                      key={task.id}
                      type="button"
                      className="kanban__the"
                      style={{ display: 'block', width: '100%', textAlign: 'left' }}
                      onClick={() => setChonId(task.id)}
                    >
                      <div className="kanban__the-td">{task.title}</div>
                      <div className="hang" style={{ gap: 6, marginTop: 6 }}>
                        <Nhan loai="mo">{task.assigneeName ?? t('tasks.unassigned')}</Nhan>
                        <Nhan loai={uuTien.loai}>{uuTien.nhan}</Nhan>
                      </div>
                      {task.revisionCount > 0 ? (
                        <div style={{ fontSize: 12, color: 'var(--mau-chu-mo)', marginTop: 6 }}>
                          {t('tasks.revisionCount', { count: task.revisionCount })}
                        </div>
                      ) : null}
                    </button>
                  )
                })}
              </div>
            )
          })}
        </div>
      ) : null}

      {chonId ? (
        <Card
          tieuDe={taskDangChon ? t('tasks.detailTitle', { title: taskDangChon.title }) : t('tasks.detailTitlePlain')}
          hanhDong={
            <Nut bien="phu" nho onClick={() => setChonId(null)}>
              {t('common.close')}
            </Nut>
          }
        >
          {dangTaiChiTiet ? <DangTai nhan={t('tasks.loadingDetail')} /> : null}

          {loiChiTiet ? <LoiManHinh loi={loiChiTiet} /> : null}

          {chiTiet && taskDangChon ? (
            <div className="cot" style={{ gap: 16 }}>
              <div className="hang">
                <Nhan loai={loaiNhanTrangThai(taskDangChon.status)}>{t(`taskStatus.${taskDangChon.status}`)}</Nhan>
                <Nhan loai={nhanUuTien(taskDangChon.priority, t).loai}>{nhanUuTien(taskDangChon.priority, t).nhan}</Nhan>
                <Nhan loai="mo">{taskDangChon.assigneeName ?? t('tasks.unassigned')}</Nhan>
                <span style={{ fontSize: 13, color: 'var(--mau-chu-mo)' }}>
                  {t('tasks.metaCreatedUpdated', {
                    created: formatDateTime(taskDangChon.createdAt),
                    updated: formatDateTime(taskDangChon.updatedAt),
                  })}
                  {taskDangChon.deadline ? t('tasks.metaDeadlineSuffix', { deadline: formatDateTime(taskDangChon.deadline) }) : ''}
                </span>
              </div>

              <div className="luoi luoi--2">
                <div>
                  <h3 className="card__tieu-de">Brief</h3>
                  {taskDangChon.briefMd.trim().length > 0 ? (
                    <Markdown>{taskDangChon.briefMd}</Markdown>
                  ) : (
                    <Trong>{t('tasks.noBrief')}</Trong>
                  )}
                  {taskDangChon.deliverableSpec ? (
                    <p style={{ fontSize: 13, color: 'var(--mau-chu-mo)' }}>
                      {t('tasks.deliverable', { spec: taskDangChon.deliverableSpec })}
                    </p>
                  ) : null}
                </div>
                <div>
                  <h3 className="card__tieu-de">{t('tasks.result')}</h3>
                  {taskDangChon.resultMd && taskDangChon.resultMd.trim().length > 0 ? (
                    <Markdown>{taskDangChon.resultMd}</Markdown>
                  ) : (
                    <Trong>{t('tasks.noResult')}</Trong>
                  )}
                </div>
              </div>

              <div className="luoi luoi--2">
                <div>
                  <h3 className="card__tieu-de">{t('tasks.dependsOn')}</h3>
                  {taskDangChon.dependsOn.length === 0 ? (
                    <p style={{ color: 'var(--mau-chu-mo)' }}>{t('tasks.noDependencies')}</p>
                  ) : (
                    <ul>
                      {taskDangChon.dependsOn.map((id) => (
                        <li key={id}>{tenTheoId.get(id) ?? id}</li>
                      ))}
                    </ul>
                  )}
                </div>
                <div>
                  <h3 className="card__tieu-de">{t('tasks.blocks')}</h3>
                  {taskDangChon.blocks.length === 0 ? (
                    <p style={{ color: 'var(--mau-chu-mo)' }}>{t('tasks.noBlocks')}</p>
                  ) : (
                    <ul>
                      {taskDangChon.blocks.map((id) => (
                        <li key={id}>{tenTheoId.get(id) ?? id}</li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>

              <div>
                <h3 className="card__tieu-de">{t('tasks.artifacts', { count: chiTiet.artifacts.length })}</h3>
                {chiTiet.artifacts.length === 0 ? (
                  <Trong>{t('tasks.noArtifacts')}</Trong>
                ) : (
                  <div className="cot">
                    {chiTiet.artifacts.map((artifact) => (
                      <div key={artifact.id}>
                        <div className="hang">
                          <strong>{artifact.name}</strong>
                          <Nhan loai="mo">{artifact.kind}</Nhan>
                          <span style={{ fontSize: 12, color: 'var(--mau-chu-mo)' }}>{formatDateTime(artifact.createdAt)}</span>
                        </div>
                        {artifact.content ? (
                          artifact.kind === 'markdown' ? (
                            <Markdown>{artifact.content}</Markdown>
                          ) : (
                            <pre style={{ maxHeight: 260, overflow: 'auto' }}>{artifact.content}</pre>
                          )
                        ) : (
                          <div style={{ fontSize: 13, color: 'var(--mau-chu-mo)' }}>
                            {artifact.path ? t('tasks.filePath', { path: artifact.path }) : t('tasks.noAttachment')}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <h3 className="card__tieu-de">{t('tasks.agentMessages', { count: chiTiet.messages.length })}</h3>
                {chiTiet.messages.length === 0 ? (
                  <Trong>{t('tasks.noAgentMessages')}</Trong>
                ) : (
                  <div className="cot">
                    {chiTiet.messages.map((tin) => (
                      <div key={tin.id} className="card" style={{ boxShadow: 'none' }}>
                        <div className="hang" style={{ justifyContent: 'space-between' }}>
                          <span>
                            <strong>{tin.fromAgent}</strong> {MUI_TEN} <strong>{tin.toAgent}</strong> <Nhan loai="mo">{tin.kind}</Nhan>
                          </span>
                          <span style={{ fontSize: 12, color: 'var(--mau-chu-mo)' }}>{formatDateTime(tin.createdAt)}</span>
                        </div>
                        <Markdown>{tin.contentMd}</Markdown>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <h3 className="card__tieu-de">{t('tasks.timeline')}</h3>
                {chiTiet.events.length === 0 ? (
                  <Trong>{t('tasks.noEvents')}</Trong>
                ) : (
                  <div className="cot">
                    {chiTiet.events.map((suKien) => (
                      <div key={suKien.id} className="hang" style={{ alignItems: 'flex-start' }}>
                        <span style={{ flex: '0 0 118px', fontSize: 13, color: 'var(--mau-chu-mo)' }} className="so">
                          {formatDateTime(suKien.createdAt)}
                        </span>
                        <Nhan loai="mo">{suKien.kind}</Nhan>
                        <span style={{ flex: 1, minWidth: 200, fontSize: 13, fontFamily: 'var(--font-mono)' }}>
                          {chuoiJson(suKien.payload)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="card" style={{ boxShadow: 'none', background: 'var(--mau-nen)' }}>
                <h3 className="card__tieu-de">{t('tasks.approval')}</h3>
                {thongBaoDuyet ? (
                  <div style={{ marginBottom: 10 }}>
                    <ThongBao loai="thanh-cong">{thongBaoDuyet}</ThongBao>
                  </div>
                ) : null}
                {loiDuyet ? (
                  <div style={{ marginBottom: 10 }}>
                    <ThongBao loai="loi">{loiDuyet}</ThongBao>
                  </div>
                ) : null}
                {coTheDuyet ? (
                  <>
                    <p style={{ marginTop: 0, color: 'var(--mau-chu-mo)', fontSize: 13 }}>{t('tasks.noteHint')}</p>
                    <OVanBan value={ghiChu} onChange={setGhiChu} rows={3} placeholder={t('tasks.notePlaceholder')} />
                    <div className="hang" style={{ marginTop: 10 }}>
                      <Nut onClick={() => void duyet('approve')} dangTai={dangDuyet}>
                        {t('tasks.approve')}
                      </Nut>
                      <Nut bien="phu" onClick={() => void duyet('request_changes')} dangTai={dangDuyet}>
                        {t('tasks.requestChanges')}
                      </Nut>
                      <Nut bien="nguy-hiem" onClick={() => void duyet('cancel')} dangTai={dangDuyet}>
                        {t('tasks.cancelTask')}
                      </Nut>
                    </div>
                  </>
                ) : (
                  <ThongBao loai="thong-tin">
                    {t('tasks.terminalNotice', { status: t(`taskStatus.${taskDangChon.status}`) })}
                  </ThongBao>
                )}
              </div>
            </div>
          ) : null}
        </Card>
      ) : null}
    </Trang>
  )
}
