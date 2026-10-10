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
import type { KnowledgeDocumentView, KnowledgeResponse, ReindexResponse } from '@marketing-agent/shared'
import { KB_CATEGORIES } from '@marketing-agent/shared'
import { api, ApiError } from '../lib/api.ts'
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
  soNguyen,
  thoiDiem,
} from '../components/ui.tsx'

interface BieuMau {
  path: string
  title: string
  category: string
  tags: string
  content: string
}

const BIEU_MAU_RONG: BieuMau = {
  path: '',
  title: '',
  category: KB_CATEGORIES[0].code,
  tags: '',
  content: '# Tiêu đề\n\nNội dung…\n',
}

function LoiManHinh({ loi }: { loi: ApiError }): ReactNode {
  return (
    <ThongBao loai="loi">
      {loi.message}
      {loi.needsConfiguration ? ' Vào mục “Cài đặt” để hoàn tất cấu hình trước khi dùng màn hình này.' : null}
    </ThongBao>
  )
}

function nhanDanhMuc(code: string): string {
  return KB_CATEGORIES.find((danhMuc) => danhMuc.code === code)?.label ?? code
}

export function KhoKienThuc({ companyId }: { companyId: string }): ReactNode {
  const [duLieu, setDuLieu] = useState<KnowledgeResponse | null>(null)
  const [dangTai, setDangTai] = useState(true)
  const [loi, setLoi] = useState<ApiError | null>(null)
  const [lanThu, setLanThu] = useState(0)

  const [tuKhoa, setTuKhoa] = useState('')
  const [danhMucDangXem, setDanhMucDangXem] = useState<string>('tat-ca')
  const [chonId, setChonId] = useState<string | null>(null)
  const [bieuMau, setBieuMau] = useState<BieuMau>(BIEU_MAU_RONG)
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
        setLoi(error instanceof ApiError ? error : new ApiError(0, 'network', 'Không kết nối được máy chủ.'))
      })
      .finally(() => {
        if (!cancelled) setDangTai(false)
      })
    return () => {
      cancelled = true
    }
  }, [companyId, lanThu])

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
        label: nhanDanhMuc(code),
        danhSach: [...danhSach].sort((a, b) => a.title.localeCompare(b.title, 'vi')),
      }))
      .sort((a, b) => a.code.localeCompare(b.code))
  }, [duLieu, tuKhoa, danhMucDangXem])

  const soTaiLieuHienThi = taiLieuTheoDanhMuc.reduce((tong, nhom) => tong + nhom.danhSach.length, 0)

  const danhMucOptions = useMemo(() => {
    const co = new Set<string>(KB_CATEGORIES.map((danhMuc) => danhMuc.code))
    for (const danhMuc of duLieu?.categories ?? []) co.add(danhMuc.code)
    return [...co].sort().map((code) => ({ value: code, label: `${nhanDanhMuc(code)} (${code})` }))
  }, [duLieu])

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
    setBieuMau(BIEU_MAU_RONG)
  }

  async function luu(): Promise<void> {
    setLoiLuu(null)
    setThongBao(null)
    if (bieuMau.path.trim().length === 0 || bieuMau.title.trim().length === 0) {
      setLoiLuu('Cần nhập đường dẫn và tiêu đề tài liệu.')
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
      setThongBao(
        'Đã lưu tài liệu. Tài liệu mới chưa có vector cho tới khi bấm “Đánh index lại” — trong lúc đó chỉ tìm được theo từ khoá.',
      )
    } catch (error) {
      setLoiLuu(error instanceof ApiError ? error.message : 'Không lưu được tài liệu.')
    } finally {
      setDangLuu(false)
    }
  }

  async function xoa(taiLieu: KnowledgeDocumentView): Promise<void> {
    if (!window.confirm(`Xoá tài liệu “${taiLieu.title}”? Thao tác này không hoàn tác được.`)) return
    setLoiLuu(null)
    setThongBao(null)
    try {
      await api.deleteKnowledge(companyId, taiLieu.id)
      if (chonId === taiLieu.id) {
        setChonId(null)
        setBieuMau(BIEU_MAU_RONG)
      }
      setThongBao(`Đã xoá tài liệu “${taiLieu.title}”.`)
      taiLai()
    } catch (error) {
      setLoiLuu(error instanceof ApiError ? error.message : 'Không xoá được tài liệu.')
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
      setLoiReindex(error instanceof ApiError ? error.message : 'Không chạy được index.')
    } finally {
      setDangReindex(false)
    }
  }

  if (dangTai && !duLieu) {
    return (
      <Trang>
        <TieuDeTrang>Kho kiến thức</TieuDeTrang>
        <DangTai nhan="Đang tải kho kiến thức…" />
      </Trang>
    )
  }

  if (loi && !duLieu) {
    return (
      <Trang>
        <TieuDeTrang>Kho kiến thức</TieuDeTrang>
        <LoiManHinh loi={loi} />
        <div style={{ marginTop: 12 }}>
          <Nut bien="phu" onClick={taiLai}>
            Thử lại
          </Nut>
        </div>
      </Trang>
    )
  }

  if (!duLieu) return null

  const tyLeVector = duLieu.stats.documents > 0 ? (duLieu.stats.embedded / duLieu.stats.documents) * 100 : 0

  return (
    <Trang rong>
      <TieuDeTrang moTa="Soạn và tìm tài liệu nguồn cho agent. Tài liệu có vector mới được tìm bằng ngữ nghĩa.">
        Kho kiến thức
      </TieuDeTrang>

      <div className="luoi luoi--3" style={{ marginBottom: 12 }}>
        <OSo nhan="Tài liệu" giaTri={soNguyen(duLieu.stats.documents)} />
        <OSo nhan="Đoạn (chunk)" giaTri={soNguyen(duLieu.stats.chunks)} moTa="Đơn vị nhỏ nhất được truy hồi" />
        <OSo
          nhan="Đã có vector"
          giaTri={`${soNguyen(duLieu.stats.embedded)}/${soNguyen(duLieu.stats.documents)}`}
          loai={duLieu.stats.embedded === duLieu.stats.documents ? 'thanh-cong' : 'canh-bao'}
          moTa={`${Math.round(tyLeVector)}% tài liệu tìm được theo ngữ nghĩa`}
        />
      </div>

      {duLieu.stats.embedded < duLieu.stats.documents ? (
        <div style={{ marginBottom: 12 }}>
          <ThongBao loai="canh-bao">
            Có {soNguyen(duLieu.stats.documents - duLieu.stats.embedded)} tài liệu CHƯA có vector. Những tài liệu này chỉ
            tìm được theo từ khoá, không được xếp hạng theo ngữ nghĩa — agent có thể bỏ sót nội dung. Bấm “Đánh index
            lại” để xử lý.
          </ThongBao>
        </div>
      ) : null}

      <Card
        tieuDe="Trạng thái index"
        phu="Index lại chỉ đọc tài liệu thay đổi. Chọn “bắt buộc” khi nghi ngờ vector cũ đã lệch."
        hanhDong={
          <span className="hang">
            <Nut nho onClick={() => void reindex(false)} dangTai={dangReindex}>
              Đánh index lại
            </Nut>
            <Nut bien="phu" nho onClick={() => void reindex(true)} dangTai={dangReindex}>
              Bắt buộc index lại
            </Nut>
          </span>
        }
      >
        {loiReindex ? <ThongBao loai="loi">{loiReindex}</ThongBao> : null}
        {ketQuaReindex ? (
          <ThongBao loai={ketQuaReindex.errors.length > 0 ? 'canh-bao' : 'thanh-cong'}>
            Đã index {soNguyen(ketQuaReindex.indexed)} tài liệu, bỏ qua {soNguyen(ketQuaReindex.skipped)}, tạo{' '}
            {soNguyen(ketQuaReindex.chunks)} đoạn.
            {ketQuaReindex.errors.length > 0 ? ` Lỗi: ${ketQuaReindex.errors.join('; ')}` : ''}
          </ThongBao>
        ) : null}
        {!ketQuaReindex && !loiReindex ? (
          <p style={{ color: 'var(--mau-chu-mo)', margin: 0 }}>
            Tài liệu chưa có vector vẫn đọc được nội dung, nhưng tìm kiếm chỉ khớp từ khoá trong tiêu đề, đường dẫn và
            nội dung.
          </p>
        ) : null}
      </Card>

      <div className="luoi luoi--2" style={{ alignItems: 'start' }}>
        <Card
          tieuDe="Danh mục tài liệu"
          phu={`${soNguyen(soTaiLieuHienThi)} tài liệu khớp bộ lọc`}
          hanhDong={
            <Nut nho onClick={batDauTaoMoi}>
              Tài liệu mới
            </Nut>
          }
        >
          <div className="cot" style={{ marginBottom: 10 }}>
            <ONhap value={tuKhoa} onChange={setTuKhoa} placeholder="Tìm theo tiêu đề, đường dẫn, tag…" />
            <OChon
              value={danhMucDangXem}
              onChange={setDanhMucDangXem}
              options={[{ value: 'tat-ca', label: 'Tất cả danh mục' }, ...danhMucOptions]}
            />
          </div>

          {duLieu.documents.length === 0 ? (
            <Trong>Kho kiến thức đang trống. Bấm “Tài liệu mới” để nạp tài liệu đầu tiên.</Trong>
          ) : taiLieuTheoDanhMuc.length === 0 ? (
            <Trong>Không có tài liệu nào khớp bộ lọc hiện tại. Thử xoá từ khoá hoặc chọn “Tất cả danh mục”.</Trong>
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
                        <div style={{ fontWeight: 600 }}>{taiLieu.title}</div>
                        <div style={{ fontSize: 12, color: 'var(--mau-chu-mo)' }}>{taiLieu.path}</div>
                        <div className="hang" style={{ gap: 6, marginTop: 6 }}>
                          <Nhan loai={taiLieu.indexed ? 'thanh-cong' : 'canh-bao'}>
                            {taiLieu.indexed ? 'Đã có vector' : 'Chỉ từ khoá'}
                          </Nhan>
                          <span style={{ fontSize: 12, color: 'var(--mau-chu-mo)' }}>
                            v{soNguyen(taiLieu.version)} · {thoiDiem(taiLieu.updatedAt)}
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
          tieuDe={dangTaoMoi ? 'Tài liệu mới' : chonId ? 'Sửa tài liệu' : 'Soạn tài liệu'}
          phu="Đường dẫn là khoá nhận diện tài liệu; đổi đường dẫn sẽ tạo tài liệu mới thay vì đổi tên."
          hanhDong={
            chonId && !dangTaoMoi ? (
              <Nut bien="nguy-hiem" nho onClick={() => {
                const taiLieu = duLieu.documents.find((item) => item.id === chonId)
                if (taiLieu) void xoa(taiLieu)
              }}>
                Xoá
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
            <Trong>Chọn một tài liệu bên trái để sửa, hoặc bấm “Tài liệu mới” để soạn tài liệu mới.</Trong>
          ) : (
            <div className="cot" style={{ gap: 12 }}>
              <div className="luoi luoi--2">
                <ONhap
                  value={bieuMau.title}
                  onChange={(giaTri) => setBieuMau((truoc) => ({ ...truoc, title: giaTri }))}
                  placeholder="Tiêu đề tài liệu"
                />
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
                  <div className="nhan">Nội dung Markdown</div>
                  <OVanBan
                    value={bieuMau.content}
                    onChange={(giaTri) => setBieuMau((truoc) => ({ ...truoc, content: giaTri }))}
                    rows={20}
                  />
                </div>
                <div>
                  <div className="nhan">Xem trước</div>
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
                  {dangTaoMoi ? 'Tạo tài liệu' : 'Lưu thay đổi'}
                </Nut>
                <Nut
                  bien="phu"
                  onClick={() => {
                    setDangTaoMoi(false)
                    setChonId(null)
                    setBieuMau(BIEU_MAU_RONG)
                    setThongBao(null)
                    setLoiLuu(null)
                  }}
                >
                  Bỏ nháp
                </Nut>
              </div>
            </div>
          )}
        </Card>
      </div>
    </Trang>
  )
}
