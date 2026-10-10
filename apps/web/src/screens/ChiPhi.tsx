/**
 * Chi phí — nơi trả lời "tiền đã đi đâu".
 *
 * Vì sao màn hình này tồn tại: chi phí model là khoản tăng âm thầm theo từng lượt
 * chạy, và một agent cấu hình sai model có thể đốt ngân sách nhanh hơn mọi thứ
 * khác. Bảng theo ngày để thấy xu hướng, bảng theo agent để thấy thủ phạm, và
 * bảng lượt chạy để soi từng lần lỗi — tất cả đều là bảng chữ, không cần biểu đồ
 * phức tạp.
 */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { MessageKey } from '@marketing-agent/i18n'
import type { CostAgentRow, CostsResponse, RunStatus, RunView } from '@marketing-agent/shared'
import { api, ApiError } from '../lib/api.ts'
import { useI18n } from '../lib/i18n.tsx'
import {
  Card,
  DangTai,
  Nhan,
  Nut,
  ONhap,
  OSo,
  ThongBao,
  TieuDeTrang,
  Trang,
  Trong,
} from '../components/ui.tsx'

/**
 * Trạng thái lượt chạy dùng lại khoá `taskStatus.*` vì đó cũng là bốn trạng thái vòng
 * đời giống công việc; tạo bản sao ở đây sẽ khiến hai màn hình lệch chữ khi sửa một bên.
 * Chỉ `budget_exceeded` không có trong `taskStatus` nên mới cần khoá riêng.
 */
const KHOA_RUN: Readonly<Record<RunStatus, MessageKey>> = {
  running: 'taskStatus.in_progress',
  succeeded: 'taskStatus.done',
  failed: 'taskStatus.failed',
  cancelled: 'taskStatus.cancelled',
  budget_exceeded: 'costs.budgetExceeded',
}

function loaiNhanRun(status: RunStatus): 'mo' | 'thanh-cong' | 'canh-bao' | 'loi' | 'chinh' {
  if (status === 'succeeded') return 'thanh-cong'
  if (status === 'failed') return 'loi'
  if (status === 'budget_exceeded') return 'canh-bao'
  if (status === 'running') return 'chinh'
  return 'mo'
}

function LoiManHinh({ loi }: { loi: ApiError }): ReactNode {
  const { t } = useI18n()
  return (
    <ThongBao loai="loi">
      {loi.message}
      {loi.needsConfiguration ? ` ${t('costs.finishSetup')}` : null}
    </ThongBao>
  )
}

/**
 * Độ trễ hiển thị theo ms khi ngắn, theo giây khi dài — tránh con số 5 chữ số khó đọc.
 *
 * Vì sao nhận hàm định dạng và dấu trống từ ngoài: đơn vị "ms"/"s" giữ nguyên, nhưng
 * dấu thập phân và dấu gạch cho giá trị trống phải theo ngôn ngữ đang chọn, mà hàm này
 * nằm ngoài component nên không gọi được hook dịch.
 */
function doTre(
  ms: number,
  dinhDang: (value: number, options?: Intl.NumberFormatOptions) => string,
  khongCo: string,
): string {
  if (!Number.isFinite(ms) || ms <= 0) return khongCo
  if (ms < 1000) return `${dinhDang(Math.round(ms))} ms`
  return `${dinhDang(ms / 1000, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} s`
}

interface DongNgay {
  readonly day: string
  readonly tokensIn: number
  readonly tokensOut: number
  readonly costUsd: number
  readonly runs: number
}

export function ChiPhi({ companyId }: { companyId: string }): ReactNode {
  // Số, ngày và tiền đều đi qua bộ định dạng của hook: chi phí lưu bằng USD nên hiển
  // thị bằng `formatCurrencyUsd`, không quy đổi sang tiền bản địa vì không có tỉ giá.
  const { t, formatNumber, formatDateTime, formatCurrencyUsd } = useI18n()
  const [duLieu, setDuLieu] = useState<CostsResponse | null>(null)
  const [dangTai, setDangTai] = useState(true)
  const [loi, setLoi] = useState<ApiError | null>(null)
  const [lanThu, setLanThu] = useState(0)

  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [boLoc, setBoLoc] = useState<{ from: string; to: string }>({ from: '', to: '' })

  useEffect(() => {
    let cancelled = false
    setDangTai(true)
    setLoi(null)
    api
      .costs(companyId, {
        ...(boLoc.from.length > 0 ? { from: boLoc.from } : {}),
        ...(boLoc.to.length > 0 ? { to: boLoc.to } : {}),
      })
      .then((ketQua) => {
        if (!cancelled) setDuLieu(ketQua)
      })
      .catch((error: unknown) => {
        if (cancelled) return
        // Câu lỗi mạng do giao diện tự viết nên phải nằm trong catalog; lỗi từ backend
        // thì `ApiError.message` đã được backend dịch theo ngôn ngữ gửi lên.
        setLoi(error instanceof ApiError ? error : new ApiError(0, 'network', t('common.cannotConnectServer')))
      })
      .finally(() => {
        if (!cancelled) setDangTai(false)
      })
    return () => {
      cancelled = true
    }
  }, [companyId, boLoc.from, boLoc.to, lanThu, t])

  const taiLai = useCallback(() => setLanThu((lan) => lan + 1), [])

  const theoNgay = useMemo<readonly DongNgay[]>(() => {
    const nhom = new Map<string, DongNgay>()
    for (const dong of duLieu?.daily ?? []) {
      const hienCo: DongNgay = nhom.get(dong.day) ?? { day: dong.day, tokensIn: 0, tokensOut: 0, costUsd: 0, runs: 0 }
      nhom.set(dong.day, {
        day: dong.day,
        tokensIn: hienCo.tokensIn + dong.tokensIn,
        tokensOut: hienCo.tokensOut + dong.tokensOut,
        costUsd: hienCo.costUsd + dong.costUsd,
        runs: hienCo.runs + dong.runs,
      })
    }
    return [...nhom.values()].sort((a, b) => b.day.localeCompare(a.day))
  }, [duLieu])

  const theoAgent = useMemo<readonly CostAgentRow[]>(
    () => [...(duLieu?.byAgent ?? [])].sort((a, b) => b.costUsd - a.costUsd),
    [duLieu],
  )

  const chiPhiLonNhatNgay = theoNgay.reduce((lon, dong) => Math.max(lon, dong.costUsd), 0)
  const chiPhiLonNhatAgent = theoAgent.reduce((lon, dong) => Math.max(lon, dong.costUsd), 0)

  const tongToken = (duLieu?.totals.tokensIn ?? 0) + (duLieu?.totals.tokensOut ?? 0)

  return (
    <Trang rong>
      <TieuDeTrang moTa={t('costs.subtitle')}>{t('nav.costs')}</TieuDeTrang>

      <Card tieuDe={t('costs.range')} phu={t('costs.rangeHint')}>
        <div className="hang" style={{ alignItems: 'flex-end' }}>
          <div style={{ minWidth: 180 }}>
            <div className="nhan">{t('costs.from')}</div>
            <ONhap value={from} onChange={setFrom} type="date" />
          </div>
          <div style={{ minWidth: 180 }}>
            <div className="nhan">{t('costs.to')}</div>
            <ONhap value={to} onChange={setTo} type="date" />
          </div>
          <Nut onClick={() => setBoLoc({ from, to })}>{t('costs.view')}</Nut>
          <Nut
            bien="phu"
            onClick={() => {
              setFrom('')
              setTo('')
              setBoLoc({ from: '', to: '' })
            }}
          >
            {t('costs.clearFilter')}
          </Nut>
          <Nut bien="phu" onClick={taiLai} dangTai={dangTai && duLieu !== null}>
            {t('common.refresh')}
          </Nut>
        </div>
        {boLoc.from.length > 0 || boLoc.to.length > 0 ? (
          <p style={{ marginBottom: 0, fontSize: 13, color: 'var(--mau-chu-mo)' }}>
            {t('costs.filtering', {
              from: boLoc.from || t('costs.rangeStart'),
              to: boLoc.to || t('costs.rangeEnd'),
            })}
          </p>
        ) : null}
      </Card>

      {loi ? (
        <div style={{ marginTop: 16 }}>
          <LoiManHinh loi={loi} />
        </div>
      ) : null}

      {dangTai && !duLieu ? <DangTai nhan={t('costs.loading')} /> : null}

      {duLieu ? (
        <>
          <div className="luoi luoi--4" style={{ marginTop: 16 }}>
            <OSo nhan={t('costs.totalCost')} giaTri={formatCurrencyUsd(duLieu.totals.costUsd)} />
            <OSo nhan={t('costs.runs')} giaTri={formatNumber(duLieu.totals.runs)} moTa={t('costs.runsHint')} />
            <OSo nhan={t('costs.tokensIn')} giaTri={formatNumber(duLieu.totals.tokensIn)} />
            <OSo
              nhan={t('costs.tokensOut')}
              giaTri={formatNumber(duLieu.totals.tokensOut)}
              moTa={t('costs.totalTokens', { n: formatNumber(tongToken) })}
            />
          </div>

          <Card tieuDe={t('costs.byDay')} phu={t('costs.byDayHint')}>
            {theoNgay.length === 0 ? (
              <Trong>{t('costs.noData')}</Trong>
            ) : (
              <table className="bang">
                <thead>
                  <tr>
                    <th>{t('costs.day')}</th>
                    <th>{t('costs.cost')}</th>
                    <th style={{ width: '35%' }}>{t('costs.share')}</th>
                    <th>{t('costs.tokensIn')}</th>
                    <th>{t('costs.tokensOut')}</th>
                    <th>{t('costs.runs')}</th>
                  </tr>
                </thead>
                <tbody>
                  {theoNgay.map((dong) => (
                    <tr key={dong.day}>
                      {/* `dong.day` là ngày ISO từ backend: dữ liệu, không dịch. */}
                      <td className="so">{dong.day}</td>
                      <td className="so">{formatCurrencyUsd(dong.costUsd)}</td>
                      <td>
                        <div style={{ height: 8, borderRadius: 999, background: 'var(--mau-vien)', overflow: 'hidden' }}>
                          <div
                            style={{
                              height: '100%',
                              width: `${chiPhiLonNhatNgay > 0 ? (dong.costUsd / chiPhiLonNhatNgay) * 100 : 0}%`,
                              background: 'var(--mau-chinh)',
                              borderRadius: 999,
                            }}
                          />
                        </div>
                      </td>
                      <td className="so">{formatNumber(dong.tokensIn)}</td>
                      <td className="so">{formatNumber(dong.tokensOut)}</td>
                      <td className="so">{formatNumber(dong.runs)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>

          <Card tieuDe={t('costs.byAgent')} phu={t('costs.byAgentHint')}>
            {theoAgent.length === 0 ? (
              <Trong>{t('costs.noAgentData')}</Trong>
            ) : (
              <table className="bang">
                <thead>
                  <tr>
                    <th>Agent</th>
                    <th>{t('costs.cost')}</th>
                    <th style={{ width: '35%' }}>{t('costs.share')}</th>
                    <th>Token</th>
                    <th>{t('costs.runs')}</th>
                  </tr>
                </thead>
                <tbody>
                  {theoAgent.map((dong) => (
                    <tr key={dong.agentDefId}>
                      {/* `agentDefId` là định danh agent từ backend: dữ liệu, không dịch. */}
                      <td>
                        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>{dong.agentDefId}</span>
                      </td>
                      <td className="so">{formatCurrencyUsd(dong.costUsd)}</td>
                      <td>
                        <div style={{ height: 8, borderRadius: 999, background: 'var(--mau-vien)', overflow: 'hidden' }}>
                          <div
                            style={{
                              height: '100%',
                              width: `${chiPhiLonNhatAgent > 0 ? (dong.costUsd / chiPhiLonNhatAgent) * 100 : 0}%`,
                              background: 'var(--mau-phu)',
                              borderRadius: 999,
                            }}
                          />
                        </div>
                      </td>
                      <td className="so">{formatNumber(dong.tokens)}</td>
                      <td className="so">{formatNumber(dong.runs)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>

          <Card tieuDe={t('costs.runs')} phu={t('costs.runsCardHint')}>
            {duLieu.runs.length === 0 ? (
              <Trong>{t('costs.noData')}</Trong>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table className="bang">
                  <thead>
                    <tr>
                      <th>{t('costs.time')}</th>
                      <th>{t('common.status')}</th>
                      <th>Agent</th>
                      <th>Model</th>
                      <th>{t('costs.tokensIn')}</th>
                      <th>{t('costs.tokensOut')}</th>
                      <th>{t('costs.cost')}</th>
                      <th>{t('costs.latency')}</th>
                      <th>{t('costs.steps')}</th>
                      <th>{t('costs.error')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...duLieu.runs]
                      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
                      .map((run: RunView) => (
                        <tr key={run.id}>
                          <td className="so">{formatDateTime(run.createdAt)}</td>
                          <td>
                            <Nhan loai={loaiNhanRun(run.status)}>{t(KHOA_RUN[run.status])}</Nhan>
                          </td>
                          {/* `agentDefId`, `modelId` và `error` đều là dữ liệu backend. */}
                          <td style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>{run.agentDefId}</td>
                          <td style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>
                            {run.modelId ?? t('costs.noValue')}
                          </td>
                          <td className="so">{formatNumber(run.tokensIn)}</td>
                          <td className="so">{formatNumber(run.tokensOut)}</td>
                          <td className="so">{formatCurrencyUsd(run.costUsd)}</td>
                          <td className="so">{doTre(run.latencyMs, formatNumber, t('costs.noValue'))}</td>
                          <td className="so">{formatNumber(run.steps)}</td>
                          <td style={{ color: run.error ? 'var(--mau-loi)' : undefined, maxWidth: 260 }}>
                            {run.error ?? t('costs.noValue')}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      ) : null}

      {!dangTai && !duLieu && !loi ? <Trong>{t('costs.empty')}</Trong> : null}
    </Trang>
  )
}
