/**
 * Kho kiến thức — nơi con người nạp và sửa kiến thức cho cả đội agent.
 *
 * Vì sao màn hình này tồn tại: chất lượng câu trả lời của agent bị chặn trên bởi
 * chất lượng kho kiến thức. Màn hình này cho soạn Markdown và xem trước ngay
 * bằng đúng bộ chuyển đổi mà agent nhìn thấy, đồng thời phơi bày trạng thái
 * index — tài liệu chưa có vector thì chỉ tìm được theo từ khoá, và đó là loại
 * lỗi im lặng khiến agent trả lời thiếu ngữ cảnh mà không ai biết.
 */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { MessageKey } from '@marketing-agent/i18n'
import type { KnowledgeDocumentView, KnowledgeResponse, ReindexResponse } from '@marketing-agent/shared'
import { KB_CATEGORIES } from '@marketing-agent/shared'
import { api, ApiError } from '../lib/api.ts'
import { useI18n } from '../lib/i18n.tsx'
import { Markdown } from '../components/Markdown.tsx'
import {
  Card,
  DangTai,
  Nhan,
  Nut,
  OChon,
  ONhap,
  OSo,
  OVanBan,
  ThongBao,
  TieuDeTrang,
  Trang,
  Trong,
} from '../components/ui.tsx'

interface BieuMau {
  path: string
  title: string
  category: string
  tags: string
  content: string
}

/**
 * Bảng tường minh mã danh mục → khoá dịch thay vì ghép `kbCategory.${code}`: khoá là
 * union literal nên ghép chuỗi sẽ mất kiểm tra của TypeScript và lọt khoá sai tới runtime.
 */
const KHOA_DANH_MUC: Readonly<Record<string, MessageKey>> = {
  '00-cong-ty': 'kbCategory.00-cong-ty',
  '10-brand': 'kbCategory.10-brand',
  '20-thi-truong': 'kbCategory.20-thi-truong',
  '30-kenh': 'kbCategory.30-kenh',
  '40-du-lieu': 'kbCategory.40-du-lieu',
  '90-ket-qua': 'kbCategory.90-ket-qua',
}

/**
 * Bản nháp trống. Vì sao là hàm nhận `t` chứ không phải hằng số cấp module: nội dung
 * Markdown mẫu là câu giao diện tự viết, phải đổi theo ngôn ngữ đang chọn.
 */
function taoBieuMauRong(t: (key: MessageKey) => string): BieuMau {
  return {
    path: '',
    title: '',
    category: KB_CATEGORIES[0].code,
    tags: '',
    content: t('knowledge.sampleContent'),
  }
}

/**
 * Nhãn danh mục. Mã lạ ngoài danh mục chuẩn là DỮ LIỆU do backend trả về nên giữ
 * nguyên mã, không bịa nhãn dịch cho nó.
 */
function nhanDanhMuc(code: string, t: (key: MessageKey) => string): string {
  const khoa = KHOA_DANH_MUC[code]
  return khoa ? t(khoa) : code
}

function LoiManHinh({ loi }: { loi: ApiError }): ReactNode {
  const { t } = useI18n()
  return (
    <ThongBao loai="loi">
      {loi.message}
      {loi.needsConfiguration ? ` ${t('knowledge.finishSetup')}` : null}
    </ThongBao>
  )
}

export function KhoKienThuc({ companyId }: { companyId: string }): ReactNode {
  // `locale` dùng cho việc sắp xếp tên tài liệu: thứ tự chữ cái phải theo ngôn ngữ
  // đang xem, không phải luôn luôn là tiếng Việt.
  const { t, locale, formatNumber, formatDateTime } = useI18n()
  const [duLieu, setDuLieu] = useState<KnowledgeResponse | null>(null)
  const [dangTai, setDangTai] = useState(true)
  const [loi, setLoi] = useState<ApiError | null>(null)
  const [lanThu, setLanThu] = useState(0)

  const [tuKhoa, setTuKhoa] = useState('')
  const [danhMucDangXem, setDanhMucDangXem] = useState<string>('tat-ca')
  const [chonId, setChonId] = useState<string | null>(null)
  const [bieuMau, setBieuMau] = useState<BieuMau>(() => taoBieuMauRong(t))
  const [dangTaoMoi, setDangTaoMoi] = useState(false)

  const [dangLuu, setDangLuu] = useState(false)
  const [thongBao, setThongBao] = useState<string | null>(null)
  const [loiLuu, setLoiLuu] = useState<string | null>(null)

  const [dangReindex, setDangReindex] = useState(false)
  const [ketQuaReindex, setKetQuaReindex] = useState<ReindexResponse | null>(null)
  const [loiReindex, setLoiReindex] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setDangTai(true)
    setLoi(null)
    api
      .knowledge(companyId)
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
  }, [companyId, lanThu, t])

  const taiLai = useCallback(() => setLanThu((lan) => lan + 1), [])

  const taiLieuTheoDanhMuc = useMemo(() => {
    const tuKhoaChuan = tuKhoa.trim().toLowerCase()
    const loc = (taiLieu: KnowledgeDocumentView): boolean => {
      if (danhMucDangXem !== 'tat-ca' && taiLieu.category !== danhMucDangXem) return false
      if (tuKhoaChuan.length === 0) return true
      return (
        taiLieu.title.toLowerCase().includes(tuKhoaChuan) ||
        taiLieu.path.toLowerCase().includes(tuKhoaChuan) ||
        taiLieu.tags.some((tag) => tag.toLowerCase().includes(tuKhoaChuan))
      )
    }
    const nhom = new Map<string, KnowledgeDocumentView[]>()
    for (const taiLieu of duLieu?.documents.filter(loc) ?? []) {
      const bucket = nhom.get(taiLieu.category) ?? []
      bucket.push(taiLieu)
      nhom.set(taiLieu.category, bucket)
    }
    return [...nhom.entries()]
      .map(([code, danhSach]) => ({
        code,
        label: nhanDanhMuc(code, t),
        danhSach: [...danhSach].sort((a, b) => a.title.localeCompare(b.title, locale)),
      }))
      .sort((a, b) => a.code.localeCompare(b.code))
  }, [duLieu, tuKhoa, danhMucDangXem, t, locale])

  const soTaiLieuHienThi = taiLieuTheoDanhMuc.reduce((tong, nhom) => tong + nhom.danhSach.length, 0)

  const danhMucOptions = useMemo(() => {
    const co = new Set<string>(KB_CATEGORIES.map((danhMuc) => danhMuc.code))
    for (const danhMuc of duLieu?.categories ?? []) co.add(danhMuc.code)
    return [...co].sort().map((code) => ({ value: code, label: `${nhanDanhMuc(code, t)} (${code})` }))
  }, [duLieu, t])

  function chonTaiLieu(taiLieu: KnowledgeDocumentView): void {
    setChonId(taiLieu.id)
    setDangTaoMoi(false)
    setThongBao(null)
    setLoiLuu(null)
    setBieuMau({
      path: taiLieu.path,
      title: taiLieu.title,
      category: taiLieu.category,
      tags: taiLieu.tags.join(', '),
      content: taiLieu.content,
    })
  }

  function batDauTaoMoi(): void {
    setChonId(null)
    setDangTaoMoi(true)
    setThongBao(null)
    setLoiLuu(null)
    setBieuMau(taoBieuMauRong(t))
  }

  async function luu(): Promise<void> {
    setLoiLuu(null)
    setThongBao(null)
    if (bieuMau.path.trim().length === 0 || bieuMau.title.trim().length === 0) {
      setLoiLuu(t('knowledge.needPathAndTitle'))
      return
    }
    setDangLuu(true)
    try {
      const ketQua = await api.upsertKnowledge(companyId, {
        path: bieuMau.path.trim(),
        title: bieuMau.title.trim(),
        category: bieuMau.category,
        tags: bieuMau.tags
          .split(',')
          .map((tag) => tag.trim())
          .filter((tag) => tag.length > 0),
        content: bieuMau.content,
      })
      setDuLieu(ketQua)
      const daLuu = ketQua.documents.find((taiLieu) => taiLieu.path === bieuMau.path.trim())
      if (daLuu) setChonId(daLuu.id)
      setDangTaoMoi(false)
      setThongBao(t('knowledge.saveSuccess'))
    } catch (error) {
      setLoiLuu(error instanceof ApiError ? error.message : t('knowledge.saveError'))
    } finally {
      setDangLuu(false)
    }
  }

  async function xoa(taiLieu: KnowledgeDocumentView): Promise<void> {
    if (!window.confirm(t('knowledge.deleteConfirm', { title: taiLieu.title }))) return
    setLoiLuu(null)
    setThongBao(null)
    try {
      await api.deleteKnowledge(companyId, taiLieu.id)
      if (chonId === taiLieu.id) {
        setChonId(null)
        setBieuMau(taoBieuMauRong(t))
      }
      setThongBao(t('knowledge.deleteSuccess', { title: taiLieu.title }))
      taiLai()
    } catch (error) {
      setLoiLuu(error instanceof ApiError ? error.message : t('knowledge.deleteError'))
    }
  }

  async function reindex(force: boolean): Promise<void> {
    setDangReindex(true)
    setLoiReindex(null)
    setKetQuaReindex(null)
    try {
      const ketQua = await api.reindexKnowledge(companyId, force ? { force: true } : {})
      setKetQuaReindex(ketQua)
      taiLai()
    } catch (error) {
      setLoiReindex(error instanceof ApiError ? error.message : t('knowledge.reindexError'))
    } finally {
      setDangReindex(false)
    }
  }

  if (dangTai && !duLieu) {
    return (
      <Trang>
        <TieuDeTrang>{t('nav.knowledge')}</TieuDeTrang>
        <DangTai nhan={t('knowledge.loading')} />
      </Trang>
    )
  }

  if (loi && !duLieu) {
    return (
      <Trang>
        <TieuDeTrang>{t('nav.knowledge')}</TieuDeTrang>
        <LoiManHinh loi={loi} />
        <div style={{ marginTop: 12 }}>
          <Nut bien="phu" onClick={taiLai}>
            {t('common.retry')}
          </Nut>
        </div>
      </Trang>
    )
  }

  if (!duLieu) return null

  const tyLeVector = duLieu.stats.documents > 0 ? (duLieu.stats.embedded / duLieu.stats.documents) * 100 : 0

  return (
    <Trang rong>
      <TieuDeTrang moTa={t('knowledge.subtitle')}>{t('nav.knowledge')}</TieuDeTrang>

      <div className="luoi luoi--3" style={{ marginBottom: 12 }}>
        <OSo nhan={t('knowledge.documents')} giaTri={formatNumber(duLieu.stats.documents)} />
        <OSo
          nhan={t('knowledge.chunks')}
          giaTri={formatNumber(duLieu.stats.chunks)}
          moTa={t('knowledge.chunksHint')}
        />
        <OSo
          nhan={t('knowledge.embedded')}
          giaTri={`${formatNumber(duLieu.stats.embedded)}/${formatNumber(duLieu.stats.documents)}`}
          loai={duLieu.stats.embedded === duLieu.stats.documents ? 'thanh-cong' : 'canh-bao'}
          moTa={t('knowledge.embeddedHint', { percent: formatNumber(Math.round(tyLeVector)) })}
        />
      </div>

      {duLieu.stats.embedded < duLieu.stats.documents ? (
        <div style={{ marginBottom: 12 }}>
          <ThongBao loai="canh-bao">
            {t('knowledge.missingEmbeddings', {
              n: formatNumber(duLieu.stats.documents - duLieu.stats.embedded),
            })}
          </ThongBao>
        </div>
      ) : null}

      <Card
        tieuDe={t('knowledge.indexStatus')}
        phu={t('knowledge.indexStatusHint')}
        hanhDong={
          <span className="hang">
            <Nut nho onClick={() => void reindex(false)} dangTai={dangReindex}>
              {t('knowledge.reindex')}
            </Nut>
            <Nut bien="phu" nho onClick={() => void reindex(true)} dangTai={dangReindex}>
              {t('knowledge.reindexForce')}
            </Nut>
          </span>
        }
      >
        {loiReindex ? <ThongBao loai="loi">{loiReindex}</ThongBao> : null}
        {ketQuaReindex ? (
          <ThongBao loai={ketQuaReindex.errors.length > 0 ? 'canh-bao' : 'thanh-cong'}>
            {t('knowledge.reindexResult', {
              indexed: formatNumber(ketQuaReindex.indexed),
              skipped: formatNumber(ketQuaReindex.skipped),
              chunks: formatNumber(ketQuaReindex.chunks),
            })}
            {ketQuaReindex.errors.length > 0
              ? ` ${t('knowledge.reindexErrors', { errors: ketQuaReindex.errors.join('; ') })}`
              : ''}
          </ThongBao>
        ) : null}
        {!ketQuaReindex && !loiReindex ? (
          <p style={{ color: 'var(--mau-chu-mo)', margin: 0 }}>{t('knowledge.vectorNote')}</p>
        ) : null}
      </Card>

      <div className="luoi luoi--2" style={{ alignItems: 'start' }}>
        <Card
          tieuDe={t('knowledge.documentsByCategory')}
          phu={t('knowledge.matchCount', { n: formatNumber(soTaiLieuHienThi) })}
          hanhDong={
            <Nut nho onClick={batDauTaoMoi}>
              {t('knowledge.newDocument')}
            </Nut>
          }
        >
          <div className="cot" style={{ marginBottom: 10 }}>
            <ONhap value={tuKhoa} onChange={setTuKhoa} placeholder={t('knowledge.searchPlaceholder')} />
            <OChon
              value={danhMucDangXem}
              onChange={setDanhMucDangXem}
              options={[{ value: 'tat-ca', label: t('knowledge.allCategories') }, ...danhMucOptions]}
            />
          </div>

          {duLieu.documents.length === 0 ? (
            <Trong>{t('knowledge.empty')}</Trong>
          ) : taiLieuTheoDanhMuc.length === 0 ? (
            <Trong>{t('knowledge.noMatch')}</Trong>
          ) : (
            <div className="cot" style={{ gap: 14 }}>
              {taiLieuTheoDanhMuc.map((nhom) => (
                <div key={nhom.code}>
                  <div style={{ fontWeight: 650, fontSize: 13 }}>
                    {nhom.label} <span style={{ color: 'var(--mau-chu-mo)' }}>({nhom.code})</span>
                  </div>
                  <div className="cot" style={{ gap: 6, marginTop: 6 }}>
                    {nhom.danhSach.map((taiLieu) => (
                      <button
                        key={taiLieu.id}
                        type="button"
                        className="kanban__the"
                        style={{
                          marginBottom: 0,
                          width: '100%',
                          textAlign: 'left',
                          borderColor: chonId === taiLieu.id ? 'var(--mau-chinh)' : undefined,
                        }}
                        onClick={() => chonTaiLieu(taiLieu)}
                      >
                        {/* Tiêu đề và đường dẫn là dữ liệu tài liệu, giữ nguyên bản gốc. */}
                        <div style={{ fontWeight: 600 }}>{taiLieu.title}</div>
                        <div style={{ fontSize: 12, color: 'var(--mau-chu-mo)' }}>{taiLieu.path}</div>
                        <div className="hang" style={{ gap: 6, marginTop: 6 }}>
                          <Nhan loai={taiLieu.indexed ? 'thanh-cong' : 'canh-bao'}>
                            {taiLieu.indexed ? t('knowledge.embedded') : t('knowledge.keywordOnly')}
                          </Nhan>
                          <span style={{ fontSize: 12, color: 'var(--mau-chu-mo)' }}>
                            {t('knowledge.versionLine', {
                              version: formatNumber(taiLieu.version),
                              time: formatDateTime(taiLieu.updatedAt),
                            })}
                          </span>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card
          tieuDe={
            dangTaoMoi
              ? t('knowledge.newDocument')
              : chonId
                ? t('knowledge.editDocument')
                : t('knowledge.composeDocument')
          }
          phu={t('knowledge.pathHint')}
          hanhDong={
            chonId && !dangTaoMoi ? (
              <Nut
                bien="nguy-hiem"
                nho
                onClick={() => {
                  const taiLieu = duLieu.documents.find((item) => item.id === chonId)
                  if (taiLieu) void xoa(taiLieu)
                }}
              >
                {t('common.delete')}
              </Nut>
            ) : null
          }
        >
          {thongBao ? (
            <div style={{ marginBottom: 10 }}>
              <ThongBao loai="thanh-cong">{thongBao}</ThongBao>
            </div>
          ) : null}
          {loiLuu ? (
            <div style={{ marginBottom: 10 }}>
              <ThongBao loai="loi">{loiLuu}</ThongBao>
            </div>
          ) : null}

          {!chonId && !dangTaoMoi ? (
            <Trong>{t('knowledge.selectOrCreate')}</Trong>
          ) : (
            <div className="cot" style={{ gap: 12 }}>
              <div className="luoi luoi--2">
                <ONhap
                  value={bieuMau.title}
                  onChange={(giaTri) => setBieuMau((truoc) => ({ ...truoc, title: giaTri }))}
                  placeholder={t('knowledge.titlePlaceholder')}
                />
                {/* Đường dẫn ví dụ giữ nguyên: đây là dữ liệu mẫu, và đổi nó theo ngôn
                    ngữ sẽ khiến người dùng tạo tài liệu sai thư mục danh mục. */}
                <ONhap
                  value={bieuMau.path}
                  onChange={(giaTri) => setBieuMau((truoc) => ({ ...truoc, path: giaTri }))}
                  placeholder="20-thi-truong/nghien-cuu-abc.md"
                />
              </div>
              <div className="luoi luoi--2">
                <OChon
                  value={bieuMau.category}
                  onChange={(giaTri) => setBieuMau((truoc) => ({ ...truoc, category: giaTri }))}
                  options={danhMucOptions}
                />
                <ONhap
                  value={bieuMau.tags}
                  onChange={(giaTri) => setBieuMau((truoc) => ({ ...truoc, tags: giaTri }))}
                  placeholder="tag1, tag2"
                />
              </div>
              <div className="luoi luoi--2" style={{ alignItems: 'start' }}>
                <div>
                  <div className="nhan">{t('knowledge.markdownContent')}</div>
                  <OVanBan
                    value={bieuMau.content}
                    onChange={(giaTri) => setBieuMau((truoc) => ({ ...truoc, content: giaTri }))}
                    rows={20}
                  />
                </div>
                <div>
                  <div className="nhan">{t('knowledge.preview')}</div>
                  <div
                    style={{
                      border: '1px solid var(--mau-vien)',
                      borderRadius: 6,
                      padding: 12,
                      maxHeight: 460,
                      overflow: 'auto',
                      background: 'var(--mau-be-mat)',
                    }}
                  >
                    <Markdown>{bieuMau.content}</Markdown>
                  </div>
                </div>
              </div>
              <div className="hang">
                <Nut onClick={() => void luu()} dangTai={dangLuu}>
                  {dangTaoMoi ? t('knowledge.createDocument') : t('knowledge.saveChanges')}
                </Nut>
                <Nut
                  bien="phu"
                  onClick={() => {
                    setDangTaoMoi(false)
                    setChonId(null)
                    setBieuMau(taoBieuMauRong(t))
                    setThongBao(null)
                    setLoiLuu(null)
                  }}
                >
                  {t('knowledge.discardDraft')}
                </Nut>
              </div>
            </div>
          )}
        </Card>
      </div>
    </Trang>
  )
}
