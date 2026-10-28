/**
 * Kho kiến thức — nơi con người nạp và sửa kiến thức cho cả đội agent.
 *
 * Vì sao màn hình này tồn tại: chất lượng câu trả lời của agent bị chặn trên bởi
 * chất lượng kho kiến thức. Màn hình này cho soạn Markdown và xem trước ngay
 * bằng đúng bộ chuyển đổi mà agent nhìn thấy, đồng thời phơi bày trạng thái
 * index — tài liệu chưa có vector thì chỉ tìm được theo từ khoá, và đó là loại
 * lỗi im lặng khiến agent trả lời thiếu ngữ cảnh mà không ai biết.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { MessageKey } from '@marketing-agent/i18n'
import type { KnowledgeDocumentView, KnowledgeResponse, ReindexResponse } from '@marketing-agent/shared'
import type { KnowledgeClassificationFields, KnowledgeSectionView } from '../lib/api.ts'
import { KB_CATEGORIES } from '@marketing-agent/shared'
import { api, ApiError } from '../lib/api.ts'
import { useI18n } from '../lib/i18n.tsx'
import { useOptionalSession } from '../lib/session.tsx'
import { KnowledgeModelStatus } from '../components/KnowledgeModelStatus.tsx'
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
  Truong,
} from '../components/ui.tsx'

interface TepCho {
  id: string
  file: File
  status: 'queued' | 'uploading' | 'success' | 'error'
  message?: string
}

interface TepChoAnh {
  id: string
  file: File
  previewUrl: string
  productName: string
  brandName: string
  status: 'queued' | 'uploading' | 'success' | 'error'
  message?: string
}

const MAX_UPLOAD_FILES = 10
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024
const MAX_IMAGE_UPLOAD_BYTES = 5 * 1024 * 1024
const ALLOWED_UPLOAD_EXTENSIONS = new Set(['pdf', 'docx', 'txt', 'md'])
const ALLOWED_IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'webp'])

type ReindexUiResponse = ReindexResponse & { queued?: number; processing?: number; classificationFailed?: number }

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

function thongBaoPhanLoai(error: string | null | undefined, fallback: string): string | null {
  if (!error) return null
  // Backend details can contain private storage paths; don't render those as user-facing errors.
  if (/(?:[A-Za-z]:\\\\|\\\\\\\\|\/(?:var|tmp|home|srv|app|mnt)\/)[^\s]*/i.test(error)) return fallback
  return error
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
  const session = useOptionalSession()
  const companies = session?.companies ?? []
  const currentCompany = companies.find((c) => c.id === companyId) ?? session?.company

  const [cheDoXem, setCheDoXem] = useState<'tai-lieu' | 'anh-san-pham'>('tai-lieu')
  const [duLieu, setDuLieu] = useState<KnowledgeResponse | null>(null)
  const [dangTai, setDangTai] = useState(true)
  const [loi, setLoi] = useState<ApiError | null>(null)
  const [lanThu, setLanThu] = useState(0)

  const [tuKhoa, setTuKhoa] = useState('')
  const [danhMucDangXem, setDanhMucDangXem] = useState<string>('tat-ca')
  const [chiAnh, setChiAnh] = useState(false)
  const [sanPhamAnh, setSanPhamAnh] = useState('')
  const [thuongHieuAnh, setThuongHieuAnh] = useState('')
  const [chonId, setChonId] = useState<string | null>(null)
  const [bieuMau, setBieuMau] = useState<BieuMau>(() => taoBieuMauRong(t))
  const [anhSanPham, setAnhSanPham] = useState('')
  const [anhThuongHieu, setAnhThuongHieu] = useState('')
  const [anhMoTa, setAnhMoTa] = useState('')
  const [anhTags, setAnhTags] = useState('')
  const [dangTaoMoi, setDangTaoMoi] = useState(false)
  const [tepCho, setTepCho] = useState<TepCho[]>([])
  const [anhTepCho, setAnhTepCho] = useState<TepChoAnh[]>([])
  const [dangTaiLen, setDangTaiLen] = useState(false)
  const [dangTaiAnhLen, setDangTaiAnhLen] = useState(false)
  const [tuKhoaAnh, setTuKhoaAnh] = useState('')
  const [sections, setSections] = useState<KnowledgeSectionView[]>([])
  const [classificationError, setClassificationError] = useState<string | null>(null)
  const [savingSection, setSavingSection] = useState<string | null>(null)
  const [noiDungTaiLen, setNoiDungTaiLen] = useState<string | null>(null)
  const [dangTaiNoiDung, setDangTaiNoiDung] = useState(false)
  const [laTaiLen, setLaTaiLen] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const imageFileInputRef = useRef<HTMLInputElement>(null)
  const selectionEpoch = useRef(0)
  const activeCompany = useRef(companyId)
  activeCompany.current = companyId

  useEffect(() => {
    selectionEpoch.current += 1
    setChonId(null)
    setNoiDungTaiLen(null)
    setLaTaiLen(false)
    setTepCho([])
    for (const item of anhTepCho) {
      try {
        URL.revokeObjectURL(item.previewUrl)
      } catch {}
    }
    setAnhTepCho([])
    setDuLieu(null)
    setBieuMau(taoBieuMauRong(t))
    setAnhSanPham('')
    setAnhThuongHieu('')
    setAnhMoTa('')
    setAnhTags('')
    setDangTaoMoi(false)
    setDangTaiLen(false)
    setDangTaiAnhLen(false)
  }, [companyId])

  const [dangLuu, setDangLuu] = useState(false)
  const [thongBao, setThongBao] = useState<string | null>(null)
  const [loiLuu, setLoiLuu] = useState<string | null>(null)

  const [dangReindex, setDangReindex] = useState(false)
  const [ketQuaReindex, setKetQuaReindex] = useState<ReindexUiResponse | null>(null)
  const [loiReindex, setLoiReindex] = useState<string | null>(null)
  const [dangRetryBulk, setDangRetryBulk] = useState(false)
  const [ketQuaRetryBulk, setKetQuaRetryBulk] = useState<{ queued: number; processing: number; failed: number } | null>(null)

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

  useEffect(() => {
    const processing = duLieu?.documents.some((doc) => {
      const status = (doc as KnowledgeDocumentView & KnowledgeClassificationFields).classificationStatus
      const imageStatus = (doc as KnowledgeDocumentView & { imageAnalysisStatus?: string }).imageAnalysisStatus
      return status === 'pending' || status === 'running' || imageStatus === 'pending' || imageStatus === 'running'
    })
    if (!processing) return
    const timer = setInterval(taiLai, 3000)
    return () => clearInterval(timer)
  }, [duLieu, taiLai])

  const taiLieuTheoDanhMuc = useMemo(() => {
    const tuKhoaChuan = tuKhoa.trim().toLowerCase()
    const loc = (taiLieu: KnowledgeDocumentView): boolean => {
      const laAnh = Boolean(taiLieu.mimeType && taiLieu.mimeType.startsWith('image/'))
      if (chiAnh && !laAnh) return false
      if (danhMucDangXem !== 'tat-ca' && !(taiLieu.categories ?? [taiLieu.category]).includes(danhMucDangXem)) return false
      if (tuKhoaChuan.length === 0) return true
      return (
        taiLieu.title.toLowerCase().includes(tuKhoaChuan) ||
        taiLieu.path.toLowerCase().includes(tuKhoaChuan) ||
        taiLieu.tags.some((tag) => tag.toLowerCase().includes(tuKhoaChuan))
      )
    }
    const nhom = new Map<string, KnowledgeDocumentView[]>()
    for (const taiLieu of duLieu?.documents.filter(loc) ?? []) {
      const category=danhMucDangXem !== 'tat-ca' ? danhMucDangXem : taiLieu.categories?.[0] ?? taiLieu.category
      const bucket = nhom.get(category) ?? []
      bucket.push(taiLieu)
      nhom.set(category, bucket)
    }
    return [...nhom.entries()]
      .map(([code, danhSach]) => ({
        code,
        label: nhanDanhMuc(code, t),
        danhSach: [...danhSach].sort((a, b) => a.title.localeCompare(b.title, locale)),
      }))
      .sort((a, b) => a.code.localeCompare(b.code))
  }, [duLieu, tuKhoa, danhMucDangXem, chiAnh, t, locale])

  const soTaiLieuHienThi = taiLieuTheoDanhMuc.reduce((tong, nhom) => tong + nhom.danhSach.length, 0)

  const danhMucOptions = useMemo(() => {
    const co = new Set<string>(KB_CATEGORIES.map((danhMuc) => danhMuc.code))
    for (const danhMuc of duLieu?.categories ?? []) co.add(danhMuc.code)
    return [...co].sort().map((code) => ({ value: code, label: `${nhanDanhMuc(code, t)} (${code})` }))
  }, [duLieu, t])

  async function chonTaiLieu(taiLieu: KnowledgeDocumentView): Promise<void> {
    const selectedId = taiLieu.id
    const selectedCompany = companyId
    const epoch = ++selectionEpoch.current
    setChonId(selectedId)
    setDangTaoMoi(false)
    setThongBao(null)
    setLoiLuu(null)
    const uploaded = Boolean(taiLieu.originalName)
    setLaTaiLen(uploaded)
    setNoiDungTaiLen(null)
    setDangTaiNoiDung(uploaded)
    setBieuMau({
      path: taiLieu.path,
      title: taiLieu.title,
      category: taiLieu.category,
      tags: taiLieu.tags.join(', '),
      content: taiLieu.content,
    })
    setAnhSanPham(taiLieu.imageProduct ?? '')
    setAnhThuongHieu(taiLieu.imageBrand ?? '')
    setAnhMoTa(taiLieu.imageDescription ?? '')
    setAnhTags(taiLieu.tags.join(', '))
    if (!uploaded) return
    try {
      const response = await api.knowledgeDocument(selectedCompany, selectedId)
      if (companyId !== selectedCompany || epoch !== selectionEpoch.current) return
      setNoiDungTaiLen(response.document.content ?? '')
      setBieuMau((prev) => ({ ...prev, content: response.document.content ?? '' }))
    } catch (error) {
      if (companyId === selectedCompany && epoch === selectionEpoch.current) {
        setLoiLuu(error instanceof ApiError ? error.message : t('knowledge.detailError'))
      }
    } finally {
      if (companyId === selectedCompany && epoch === selectionEpoch.current) setDangTaiNoiDung(false)
    }
  }

  function themTep(files: FileList | File[]): void {
    const incoming = Array.from(files)
    const accepted: TepCho[] = []
    for (const file of incoming) {
      const extension = file.name.split('.').pop()?.toLowerCase() ?? ''
      const isImage = ALLOWED_IMAGE_EXTENSIONS.has(extension)
      const invalid = !ALLOWED_UPLOAD_EXTENSIONS.has(extension) && !isImage
        ? t('knowledge.invalidFileType', { name: file.name })
        : file.size > (isImage ? MAX_IMAGE_UPLOAD_BYTES : MAX_UPLOAD_BYTES)
          ? t('knowledge.fileTooLarge', { name: file.name })
          : undefined
      if (invalid) {
        setLoiLuu(invalid)
        continue
      }
      accepted.push({ id: `${file.name}-${file.lastModified}-${Math.random()}`, file, status: 'queued' })
    }
    setTepCho((current) => {
      const room = Math.max(0, MAX_UPLOAD_FILES - current.length)
      if (accepted.length > room) setLoiLuu(t('knowledge.queueLimit'))
      return [...current, ...accepted.slice(0, room)]
    })
  }

  async function taiLenTep(): Promise<void> {
    if (dangTaiLen || !tepCho.some((item) => item.status === 'queued')) return
    setDangTaiLen(true)
    setLoiLuu(null)
    const batchCompany = companyId
    try {
      for (const item of tepCho) {
        if (activeCompany.current !== batchCompany) return
        if (item.status !== 'queued') continue
        setTepCho((current) => current.map((entry) => entry.id === item.id ? { ...entry, status: 'uploading', message: undefined } : entry))
        try {
          const image = item.file.type.startsWith('image/') || ALLOWED_IMAGE_EXTENSIONS.has(item.file.name.split('.').pop()?.toLowerCase() ?? '')
          const result = image
            ? await api.uploadKnowledgeImage(batchCompany, { file: item.file, product: sanPhamAnh.trim() || undefined, brand: thuongHieuAnh.trim() || undefined })
            : await api.uploadKnowledge(batchCompany, { file: item.file })
          if (activeCompany.current !== batchCompany) return
          setTepCho((current) => current.map((entry) => entry.id === item.id ? { ...entry, status: 'success', message: result.warning } : entry))
          if (result.warning) setThongBao(result.warning)
        } catch (error) {
          if (activeCompany.current !== batchCompany) return
          setTepCho((current) => current.map((entry) => entry.id === item.id ? { ...entry, status: 'error', message: error instanceof ApiError ? error.message : t('knowledge.uploadError') } : entry))
        }
      }
      if (activeCompany.current === batchCompany) taiLai()
    } finally {
      if (activeCompany.current === batchCompany) setDangTaiLen(false)
    }
  }

  function retryUpload(itemId: string): void {
    setTepCho((current) => current.map((entry) => entry.id === itemId ? { ...entry, status: 'queued', message: undefined } : entry))
  }

  const danhSachAnhSanPham = useMemo(() => {
    const tuKhoa = tuKhoaAnh.trim().toLowerCase()
    const tatCaAnh = duLieu?.documents.filter((doc) => doc.mimeType?.startsWith('image/')) ?? []
    if (!tuKhoa) return tatCaAnh
    return tatCaAnh.filter(
      (doc) =>
        doc.title.toLowerCase().includes(tuKhoa) ||
        (doc.imageProduct && doc.imageProduct.toLowerCase().includes(tuKhoa)) ||
        (doc.imageBrand && doc.imageBrand.toLowerCase().includes(tuKhoa)) ||
        (doc.imageDescription && doc.imageDescription.toLowerCase().includes(tuKhoa)) ||
        doc.tags.some((tag) => tag.toLowerCase().includes(tuKhoa)),
    )
  }, [duLieu, tuKhoaAnh])

  function themAnhSanPham(files: FileList | File[]): void {
    const incoming = Array.from(files)
    const accepted: TepChoAnh[] = []
    for (const file of incoming) {
      const extension = file.name.split('.').pop()?.toLowerCase() ?? ''
      const isImage = ALLOWED_IMAGE_EXTENSIONS.has(extension) || file.type.startsWith('image/')
      const invalid = !isImage
        ? t('knowledge.invalidFileType', { name: file.name })
        : file.size > MAX_IMAGE_UPLOAD_BYTES
          ? t('knowledge.fileTooLarge', { name: file.name })
          : undefined
      if (invalid) {
        setLoiLuu(invalid)
        continue
      }
      accepted.push({
        id: `${file.name}-${file.lastModified}-${Math.random()}`,
        file,
        previewUrl: URL.createObjectURL(file),
        productName: sanPhamAnh.trim(),
        brandName: thuongHieuAnh.trim(),
        status: 'queued',
      })
    }
    setAnhTepCho((current) => {
      const room = Math.max(0, MAX_UPLOAD_FILES - current.length)
      if (accepted.length > room) setLoiLuu(t('knowledge.queueLimit'))
      return [...current, ...accepted.slice(0, room)]
    })
  }

  function retryUploadAnh(itemId: string): void {
    setAnhTepCho((current) =>
      current.map((entry) => (entry.id === itemId ? { ...entry, status: 'queued', message: undefined } : entry)),
    )
  }

  function clearAnhQueue(): void {
    for (const item of anhTepCho) {
      try {
        URL.revokeObjectURL(item.previewUrl)
      } catch {}
    }
    setAnhTepCho([])
  }

  async function taiLenAnhSanPham(): Promise<void> {
    if (dangTaiAnhLen || !anhTepCho.some((item) => item.status === 'queued')) return
    setDangTaiAnhLen(true)
    setLoiLuu(null)
    const batchCompany = companyId
    try {
      for (const item of anhTepCho) {
        if (activeCompany.current !== batchCompany) return
        if (item.status !== 'queued') continue
        setAnhTepCho((current) =>
          current.map((entry) => (entry.id === item.id ? { ...entry, status: 'uploading', message: undefined } : entry)),
        )
        try {
          const result = await api.uploadKnowledgeImage(batchCompany, {
            file: item.file,
            product: item.productName || sanPhamAnh.trim() || undefined,
            brand: item.brandName || thuongHieuAnh.trim() || undefined,
            tags: anhTags.split(',').map((tag) => tag.trim()).filter(Boolean),
          })
          if (activeCompany.current !== batchCompany) return
          setAnhTepCho((current) =>
            current.map((entry) => (entry.id === item.id ? { ...entry, status: 'success', message: result.warning } : entry)),
          )
          if (result.warning) setThongBao(result.warning)
        } catch (error) {
          if (activeCompany.current !== batchCompany) return
          setAnhTepCho((current) =>
            current.map((entry) =>
              entry.id === item.id
                ? {
                    ...entry,
                    status: 'error',
                    message: error instanceof ApiError ? error.message : t('knowledge.uploadError'),
                  }
                : entry,
            ),
          )
        }
      }
      if (activeCompany.current === batchCompany) taiLai()
    } finally {
      if (activeCompany.current === batchCompany) setDangTaiAnhLen(false)
    }
  }

  useEffect(() => {
    if (!anhTepCho.some((item) => item.status === 'queued') || dangTaiAnhLen) return
    void taiLenAnhSanPham()
  }, [anhTepCho, dangTaiAnhLen, sanPhamAnh, thuongHieuAnh, anhTags])

  useEffect(() => {
    if (!tepCho.some((item) => item.status === 'queued') || dangTaiLen) return
    void taiLenTep()
  }, [tepCho, dangTaiLen, sanPhamAnh, thuongHieuAnh])

  useEffect(() => {
    if (!chonId || !laTaiLen) {
      setSections([])
      setClassificationError(null)
      return
    }
    const selectedCompany = companyId
    const selectedId = chonId
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const poll = async (): Promise<void> => {
      try {
        const detail = await api.knowledgeDocument(selectedCompany, selectedId)
        if (cancelled || activeCompany.current !== selectedCompany || chonId !== selectedId) return
        setSections(detail.sections ?? [])
        const status = (detail.document as KnowledgeDocumentView & KnowledgeClassificationFields).classificationStatus
        const error = thongBaoPhanLoai((detail.document as KnowledgeDocumentView & KnowledgeClassificationFields).classificationError, t('knowledge.classificationError'))
        setClassificationError(error)
        if (status === 'pending' || status === 'running') {
          timer = setTimeout(() => void poll(), 3000)
        }
      } catch (error) {
        if (!cancelled && activeCompany.current === selectedCompany) setClassificationError(thongBaoPhanLoai(error instanceof ApiError ? error.message : null, t('knowledge.classificationError')))
      }
    }
    void poll()
    return () => { cancelled = true; if (timer) clearTimeout(timer) }
  }, [companyId, chonId, laTaiLen, lanThu, t])

  async function retryClassification(): Promise<void> {
    if (!chonId) return
    setClassificationError(null)
    try {
      await api.retryKnowledgeClassification(companyId, chonId)
      taiLai()
    } catch (error) {
      setClassificationError(thongBaoPhanLoai(error instanceof ApiError ? error.message : null, t('knowledge.classificationError')))
    }
  }

  async function saveSection(sectionId: string, category: string, tags: string[]): Promise<void> {
    if (!chonId) return
    setSavingSection(sectionId)
    try {
      const result = await api.updateKnowledgeSection(companyId, chonId, sectionId, { category, tags })
      setSections(result.sections ?? [])
      setDuLieu((current) => current ? { ...current, documents: current.documents.map((doc) => doc.id === chonId ? { ...doc, ...result.document } : doc) } : current)
    } catch (error) {
      setClassificationError(error instanceof ApiError ? error.message : t('knowledge.sectionSaveError'))
    } finally { setSavingSection(null) }
  }

  async function luuMetadata(): Promise<void> {
    if (!chonId) return
    setDangLuu(true)
    setLoiLuu(null)
    try {
      let result = await api.updateKnowledgeMetadata(companyId, chonId, {
        title: bieuMau.title.trim(), ...(duLieu?.documents.find((doc)=>doc.id===chonId)?.source === 'upload-auto' ? {} : {category:bieuMau.category}),
        tags: bieuMau.tags.split(',').map((tag) => tag.trim()).filter(Boolean),
      })
      if (duLieu?.documents.find((doc) => doc.id === chonId)?.mimeType?.startsWith('image/')) {
        result = await api.updateKnowledgeImageMetadata(companyId, chonId, {
          product: anhSanPham.trim(),
          brand: anhThuongHieu.trim(),
          description: anhMoTa.trim(),
          tags: bieuMau.tags.split(',').map((tag) => tag.trim()).filter(Boolean),
        })
      }
      setThongBao(t('knowledge.saveSuccess'))
      setDuLieu((current) => current ? { ...current, documents: current.documents.map((doc) => doc.id === chonId ? { ...doc, ...result.document } : doc) } : current)
    } catch (error) {
      setLoiLuu(error instanceof ApiError ? error.message : t('knowledge.saveError'))
    } finally { setDangLuu(false) }
  }

  function batDauTaoMoi(): void {
    selectionEpoch.current += 1
    setLaTaiLen(false)
    setNoiDungTaiLen(null)
    setDangTaiNoiDung(false)
    setChonId(null)
    setDangTaoMoi(true)
    setThongBao(null)
    setLoiLuu(null)
    setBieuMau(taoBieuMauRong(t))
    setAnhSanPham('')
    setAnhThuongHieu('')
    setAnhMoTa('')
    setAnhTags('')
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

  async function retryAllFailed(): Promise<void> {
    setDangRetryBulk(true)
    setKetQuaRetryBulk(null)
    setLoiReindex(null)
    try {
      setKetQuaRetryBulk(await api.retryFailedKnowledge(companyId))
      taiLai()
    } catch (error) {
      setLoiReindex(error instanceof ApiError ? error.message : t('knowledge.classificationError'))
    } finally {
      setDangRetryBulk(false)
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

  // Initial render and company changes have no response yet. Keep these pure
  // calculations after the loading/error guards, but all Hooks above them.
  const processingCount = duLieu.documents.filter((doc) => doc.classificationStatus === 'pending' || doc.classificationStatus === 'running').length
  const failedCount = duLieu.documents.filter((doc) => doc.classificationStatus === 'failed').length
  const lexicalReadyCount = duLieu.documents.filter((doc) => !doc.indexed && (doc.chunkCount ?? 0) > 0 && doc.classificationStatus !== 'pending' && doc.classificationStatus !== 'running' && doc.classificationStatus !== 'failed').length
  const activeDocument = chonId ? duLieu.documents.find((doc) => doc.id === chonId) : undefined
  const retryIn = activeDocument?.classificationNextAttemptAt ? Math.max(0, new Date(activeDocument.classificationNextAttemptAt).getTime() - Date.now()) : 0

  const tyLeVector = duLieu.stats.documents > 0 ? (duLieu.stats.embedded / duLieu.stats.documents) * 100 : 0

  const productImagesTotal = duLieu.documents.filter((doc) => doc.mimeType?.startsWith('image/'))
  const imageReadyCount = productImagesTotal.filter(
    (doc) => (doc as KnowledgeDocumentView & { imageAnalysisStatus?: string }).imageAnalysisStatus === 'ready',
  ).length
  const imagePendingCount = productImagesTotal.filter((doc) => {
    const s = (doc as KnowledgeDocumentView & { imageAnalysisStatus?: string }).imageAnalysisStatus
    return s === 'pending' || s === 'running'
  }).length
  const imageFailedCount = productImagesTotal.filter(
    (doc) => (doc as KnowledgeDocumentView & { imageAnalysisStatus?: string }).imageAnalysisStatus === 'failed',
  ).length

  return (
    <Trang rong>
      <TieuDeTrang moTa={t('knowledge.subtitle')}>{t('nav.knowledge')}</TieuDeTrang>
      <KnowledgeModelStatus companyId={companyId} />

      <div className="knowledge-company-bar">
        <div className="hang" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ fontWeight: 600 }}>{t('knowledge.activeCompany')}</span>
          <Nhan loai="chinh">{currentCompany?.name ?? companyId}</Nhan>
          {companies.length > 1 && session ? (
            <span className="hang" style={{ gap: 6, alignItems: 'center' }}>
              <span style={{ fontSize: 13, color: 'var(--mau-chu-mo)' }}>({t('knowledge.switchCompany')}:</span>
              <select
                className="o-chon"
                style={{ width: 'auto', padding: '4px 8px', fontSize: 13 }}
                value={companyId}
                aria-label={t('knowledge.switchCompany')}
                onChange={(event) => session.selectCompany(event.target.value)}
              >
                {companies.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              <span style={{ fontSize: 13, color: 'var(--mau-chu-mo)' }}>)</span>
            </span>
          ) : null}
        </div>

        <div className="knowledge-tabs" style={{ margin: 0, padding: 0, borderBottom: 'none' }}>
          <button
            type="button"
            aria-selected={cheDoXem === 'tai-lieu'}
            onClick={() => setCheDoXem('tai-lieu')}
          >
            📄 {t('knowledge.tabDocuments')}
          </button>
          <button
            type="button"
            aria-selected={cheDoXem === 'anh-san-pham'}
            onClick={() => setCheDoXem('anh-san-pham')}
          >
            🖼️ {t('knowledge.tabProductImages', { n: formatNumber(productImagesTotal.length) })}
          </button>
        </div>
      </div>

      {cheDoXem === 'anh-san-pham' ? (
        <div className="cot" style={{ gap: 16 }}>
          <div className="luoi luoi--4">
            <OSo nhan={t('knowledge.productImagesCount', { n: '' }).trim()} giaTri={formatNumber(productImagesTotal.length)} />
            <OSo nhan={t('knowledge.imageAnalysisReady')} giaTri={formatNumber(imageReadyCount)} loai="thanh-cong" />
            <OSo nhan={t('knowledge.imageAnalysisPending')} giaTri={formatNumber(imagePendingCount)} loai={imagePendingCount ? 'canh-bao' : 'thanh-cong'} />
            <OSo nhan={t('knowledge.imageAnalysisFailed')} giaTri={formatNumber(imageFailedCount)} loai={imageFailedCount ? 'loi' : 'thanh-cong'} />
          </div>

          <Card tieuDe={t('knowledge.productImageUploadTitle')} phu={t('knowledge.productImageUploadHint')}>
            <div className="cot" style={{ gap: 12 }}>
              <div className="luoi luoi--2">
                <Truong nhan={t('knowledge.imageProductName')}>
                  <ONhap value={sanPhamAnh} onChange={setSanPhamAnh} placeholder={t('knowledge.imageProductPlaceholder')} />
                </Truong>
                <Truong nhan={t('knowledge.imageBrandName')}>
                  <ONhap value={thuongHieuAnh} onChange={setThuongHieuAnh} placeholder={t('knowledge.imageBrandPlaceholder')} />
                </Truong>
              </div>
              <div className="luoi luoi--2">
                <Truong nhan={t('knowledge.imageTags')}>
                  <ONhap value={anhTags} onChange={setAnhTags} placeholder={t('knowledge.imageTagsPlaceholder')} />
                </Truong>
                <Truong nhan={t('knowledge.imageDescription')}>
                  <ONhap value={anhMoTa} onChange={setAnhMoTa} placeholder={t('knowledge.imageDescriptionPlaceholder')} />
                </Truong>
              </div>
              <div>
                <Nut
                  className="knowledge__choose-product-files"
                  onClick={() => imageFileInputRef.current?.click()}
                  ariaLabel={t('knowledge.chooseProductImages')}
                >
                  <svg aria-hidden="true" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect width="18" height="18" x="3" y="3" rx="2" ry="2"/>
                    <circle cx="9" cy="9" r="2"/>
                    <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/>
                  </svg>
                  {t('knowledge.chooseProductImages')}
                </Nut>
                <input
                  ref={imageFileInputRef}
                  type="file"
                  multiple
                  accept=".png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp"
                  hidden
                  onChange={(event) => {
                    if (event.currentTarget.files) themAnhSanPham(event.currentTarget.files)
                    event.currentTarget.value = ''
                  }}
                />
              </div>
              <div
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => {
                  event.preventDefault()
                  themAnhSanPham(event.dataTransfer.files)
                }}
                style={{
                  border: '2px dashed var(--mau-vien)',
                  borderRadius: 8,
                  padding: 20,
                  textAlign: 'center',
                  background: 'var(--mau-be-mat)',
                }}
              >
                {t('knowledge.dropProductImages')}
              </div>
              {anhTepCho.length ? (
                <div className="cot" style={{ gap: 8, marginTop: 8 }}>
                  <span style={{ fontWeight: 600, fontSize: 13 }}>
                    {t('knowledge.previewThumbnails')} ({formatNumber(anhTepCho.length)}):
                  </span>
                  {anhTepCho.map((item) => (
                    <div key={item.id} className="knowledge-queue-item" style={{ justifyContent: 'space-between' }}>
                      <div className="hang" style={{ gap: 12, alignItems: 'center' }}>
                        <img src={item.previewUrl} alt={item.file.name} className="knowledge-queue-thumb" />
                        <div>
                          <div style={{ fontWeight: 600 }}>{item.file.name}</div>
                          <div style={{ fontSize: 12, color: 'var(--mau-chu-mo)' }}>
                            {formatNumber(Math.ceil(item.file.size / 1024))} KB
                            {item.productName ? ` · ${t('knowledge.imageProductName')}: ${item.productName}` : ''}
                            {item.brandName ? ` · ${t('knowledge.imageBrandName')}: ${item.brandName}` : ''}
                          </div>
                        </div>
                      </div>
                      <div className="hang" style={{ gap: 8, alignItems: 'center' }}>
                        <span>
                          {item.status === 'queued'
                            ? t('knowledge.queued')
                            : item.status === 'uploading'
                              ? t('knowledge.uploading')
                              : item.status === 'success'
                                ? t('knowledge.uploaded')
                                : t('knowledge.uploadFailed')}
                        </span>
                        {item.message ? <span>{item.message}</span> : null}
                        {item.status === 'error' ? (
                          <Nut nho bien="phu" onClick={() => retryUploadAnh(item.id)}>
                            {t('common.retry')}
                          </Nut>
                        ) : null}
                      </div>
                    </div>
                  ))}
                  <div className="hang" style={{ marginTop: 8 }}>
                    {dangTaiAnhLen ? <DangTai nhan={t('knowledge.uploading')} /> : null}
                    <Nut bien="phu" onClick={clearAnhQueue} disabled={dangTaiAnhLen}>
                      {t('knowledge.clearQueue')}
                    </Nut>
                  </div>
                </div>
              ) : null}
            </div>
          </Card>

          <Card
            tieuDe={t('knowledge.productImageGalleryTitle')}
            phu={t('knowledge.matchCount', { n: formatNumber(danhSachAnhSanPham.length) })}
          >
            <div className="cot" style={{ gap: 12, marginBottom: 16 }}>
              <ONhap
                value={tuKhoaAnh}
                onChange={setTuKhoaAnh}
                placeholder={t('knowledge.searchProductImagesPlaceholder')}
              />
            </div>

            {danhSachAnhSanPham.length === 0 ? (
              <Trong>{t('knowledge.noProductImages')}</Trong>
            ) : (
              <div className="knowledge-image-grid">
                {danhSachAnhSanPham.map((taiLieu) => {
                  const image = taiLieu as KnowledgeDocumentView & { imageAnalysisStatus?: string; imageAnalysisError?: string | null }
                  const imagePending = image.imageAnalysisStatus === 'pending' || image.imageAnalysisStatus === 'running'
                  const imageFailed = image.imageAnalysisStatus === 'failed'
                  const isSelected = chonId === taiLieu.id
                  return (
                    <div
                      key={taiLieu.id}
                      className={`knowledge-image-card ${isSelected ? 'knowledge-image-card--selected' : ''}`}
                      onClick={() => chonTaiLieu(taiLieu)}
                    >
                      <div className="knowledge-image-card__thumb-wrap">
                        <img
                          src={api.knowledgeImageUrl(companyId, taiLieu.id)}
                          alt={taiLieu.title}
                          className="knowledge-image-card__thumb"
                          loading="lazy"
                        />
                      </div>
                      <div className="knowledge-image-card__body">
                        <div className="knowledge-image-card__title" title={taiLieu.imageProduct || taiLieu.title}>
                          {taiLieu.imageProduct || taiLieu.title}
                        </div>
                        {taiLieu.imageBrand ? (
                          <div className="knowledge-image-card__meta">
                            {t('knowledge.imageBrandName')}: <strong>{taiLieu.imageBrand}</strong>
                          </div>
                        ) : null}
                        {taiLieu.tags?.length ? (
                          <div className="hang" style={{ gap: 4, flexWrap: 'wrap', marginTop: 4 }}>
                            {taiLieu.tags.map((tag) => (
                              <Nhan key={tag} loai="mo">{tag}</Nhan>
                            ))}
                          </div>
                        ) : null}
                        <div style={{ fontSize: 11, color: 'var(--mau-chu-mo)', marginTop: 4 }}>
                          {taiLieu.originalName ?? taiLieu.path} · {formatNumber(Math.ceil((taiLieu.sizeBytes ?? 0) / 1024))} KB
                        </div>
                        <div style={{ fontSize: 12, marginTop: 4, color: imageFailed ? 'var(--mau-loi)' : 'var(--mau-chu-mo)' }}>
                          {imagePending
                            ? t('knowledge.imageAnalysisPending')
                            : imageFailed
                              ? (image.imageAnalysisError ?? t('knowledge.imageAnalysisFailed'))
                              : image.imageAnalysisStatus === 'ready'
                                ? t('knowledge.imageAnalysisReady')
                                : t('knowledge.imageAnalysisUnavailable')}
                        </div>
                        <div className="knowledge-image-card__actions">
                          <span style={{ fontSize: 11, color: 'var(--mau-chu-mo)' }}>
                            {formatDateTime(taiLieu.updatedAt)}
                          </span>
                          <span className="hang" style={{ gap: 4 }} onClick={(e) => e.stopPropagation()}>
                            {imageFailed ? (
                              <Nut
                                nho
                                bien="phu"
                                onClick={() => {
                                  void api
                                    .retryKnowledgeImageAnalysis(companyId, taiLieu.id)
                                    .then(() => taiLai())
                                    .catch((error) =>
                                      setLoiLuu(error instanceof ApiError ? error.message : t('knowledge.imageAnalysisFailed')),
                                    )
                                }}
                              >
                                {t('common.retry')}
                              </Nut>
                            ) : null}
                            <Nut
                              nho
                              bien="nguy-hiem"
                              onClick={() => void xoa(taiLieu)}
                            >
                              {t('common.delete')}
                            </Nut>
                          </span>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </Card>

          {chonId && activeDocument?.mimeType?.startsWith('image/') ? (
            <Card tieuDe={t('knowledge.editProductImage')} phu={activeDocument.originalName ?? activeDocument.path}>
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
              <div className="cot" style={{ gap: 12 }}>
                <div className="luoi luoi--2">
                  <Truong nhan={t('knowledge.imageProductName')}>
                    <ONhap value={anhSanPham} onChange={setSanPhamAnh} placeholder={t('knowledge.imageProductPlaceholder')} />
                  </Truong>
                  <Truong nhan={t('knowledge.imageBrandName')}>
                    <ONhap value={thuongHieuAnh} onChange={setThuongHieuAnh} placeholder={t('knowledge.imageBrandPlaceholder')} />
                  </Truong>
                </div>
                <div className="luoi luoi--2">
                  <Truong nhan={t('knowledge.imageTags')}>
                    <ONhap
                      value={bieuMau.tags}
                      onChange={(giaTri) => {
                        setBieuMau((truoc) => ({ ...truoc, tags: giaTri }))
                        setAnhTags(giaTri)
                      }}
                      placeholder="tag1, tag2"
                    />
                  </Truong>
                  <Truong nhan={t('knowledge.imageDescription')}>
                    <ONhap value={anhMoTa} onChange={setAnhMoTa} placeholder={t('knowledge.imageDescriptionPlaceholder')} />
                  </Truong>
                </div>
                <div className="hang" style={{ gap: 8, alignItems: 'center' }}>
                  <Nut onClick={() => void luuMetadata()} dangTai={dangLuu}>
                    {t('knowledge.saveChanges')}
                  </Nut>
                  <Nut bien="phu" onClick={() => setChonId(null)}>
                    {t('common.close')}
                  </Nut>
                  <a
                    className="btn btn--phu btn--nho"
                    href={api.knowledgeDownloadUrl(companyId, chonId)}
                    style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center' }}
                  >
                    {t('knowledge.downloadOriginal')}
                  </a>
                  <Nut
                    bien="nguy-hiem"
                    nho
                    onClick={() => void xoa(activeDocument)}
                  >
                    {t('common.delete')}
                  </Nut>
                </div>
              </div>
            </Card>
          ) : null}
        </div>
      ) : (
        <>
          <div className="luoi luoi--3" style={{ marginBottom: 12 }}>
            <OSo nhan={t('knowledge.documents')} giaTri={formatNumber(duLieu.stats.documents)} />
            <OSo
              nhan={t('knowledge.chunks')}
              giaTri={formatNumber(duLieu.stats.chunks)}
              moTa={t('knowledge.chunksHint')}
            />
            <OSo nhan={t('knowledge.processingCount')} giaTri={formatNumber(processingCount)} loai={processingCount ? 'canh-bao' : 'thanh-cong'} />
            <OSo nhan={t('knowledge.failedCount')} giaTri={formatNumber(failedCount)} loai={failedCount ? 'loi' : 'thanh-cong'} />
            <OSo nhan={t('knowledge.readyNoVectors')} giaTri={formatNumber(lexicalReadyCount)} loai={lexicalReadyCount ? 'canh-bao' : 'thanh-cong'} />
            <OSo
              nhan={t('knowledge.embedded')}
              giaTri={`${formatNumber(duLieu.stats.embedded)}/${formatNumber(duLieu.stats.documents)}`}
              loai={duLieu.stats.embedded === duLieu.stats.documents ? 'thanh-cong' : 'canh-bao'}
              moTa={`${t('knowledge.embeddedHint', { percent: formatNumber(Math.round(tyLeVector)) })} · ${t('knowledge.readyNoVectors')}: ${formatNumber(lexicalReadyCount)}`}
            />
          </div>

          {failedCount > 0 ? <div style={{ marginBottom: 12 }}><ThongBao loai="loi">{t('knowledge.failedCount')}: {formatNumber(failedCount)}</ThongBao></div> : null}

          <Card
            tieuDe={t('knowledge.indexStatus')}
            phu={t('knowledge.indexStatusHint')}
            hanhDong={
              <span className="hang">
                <Nut nho bien="phu" onClick={() => void retryAllFailed()} dangTai={dangRetryBulk} disabled={failedCount === 0}>{t('knowledge.retryFailed')}</Nut>
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
            {ketQuaRetryBulk ? <ThongBao loai={ketQuaRetryBulk.failed > 0 ? 'canh-bao' : 'thanh-cong'}>{t('knowledge.retryResult', { queued: formatNumber(ketQuaRetryBulk.queued), processing: formatNumber(ketQuaRetryBulk.processing), failed: formatNumber(ketQuaRetryBulk.failed) })}</ThongBao> : null}
            {ketQuaReindex ? (
              <ThongBao loai={ketQuaReindex.errors.length > 0 || (ketQuaReindex.classificationFailed ?? 0) > 0 || (ketQuaReindex.queued ?? 0) > 0 || (ketQuaReindex.processing ?? 0) > 0 ? 'canh-bao' : 'thanh-cong'}>
                {(ketQuaReindex.queued ?? 0) > 0 || (ketQuaReindex.processing ?? 0) > 0
                  ? t('knowledge.reindexClassificationResult', { queued: formatNumber(ketQuaReindex.queued ?? 0), processing: formatNumber(ketQuaReindex.processing ?? 0), failed: formatNumber(ketQuaReindex.classificationFailed ?? 0) })
                  : ketQuaReindex.indexed === 0 && ketQuaReindex.skipped === 0 && ketQuaReindex.errors.length === 0
                    ? t('knowledge.empty')
                    : t('knowledge.reindexResult', {
                      indexed: formatNumber(ketQuaReindex.indexed),
                      skipped: formatNumber(ketQuaReindex.skipped),
                      chunks: formatNumber(ketQuaReindex.chunks),
                    })}
                {(ketQuaReindex.queued ?? 0) > 0 || (ketQuaReindex.processing ?? 0) > 0 || (ketQuaReindex.classificationFailed ?? 0) > 0
                  ? ` ${t('knowledge.reindexClassificationResult', { queued: formatNumber(ketQuaReindex.queued ?? 0), processing: formatNumber(ketQuaReindex.processing ?? 0), failed: formatNumber(ketQuaReindex.classificationFailed ?? 0) })}`
                  : ''}
                {ketQuaReindex.errors.length > 0
                  ? ` ${t('knowledge.reindexErrors', { errors: ketQuaReindex.errors.map((error) => thongBaoPhanLoai(error, t('knowledge.classificationError'))).join('; ') })}`
                  : ''}
              </ThongBao>
            ) : null}
            {!ketQuaReindex && !loiReindex ? (
              <p style={{ color: 'var(--mau-chu-mo)', margin: 0 }}>{t('knowledge.vectorNote')}</p>
            ) : null}
          </Card>

      <Card tieuDe={t('knowledge.uploadTitle')} phu={t('knowledge.uploadHint')}>
        <div className="cot" style={{ gap: 10 }}>
          <div style={{ fontSize: 13, color: 'var(--mau-chu-mo)' }}>
            💡 <Nut nho bien="phu" onClick={() => setCheDoXem('anh-san-pham')}>{t('knowledge.switchToProductImages')}</Nut>
          </div>
          <div className="luoi luoi--2">
            <ONhap value={sanPhamAnh} onChange={setSanPhamAnh} placeholder={t('knowledge.imageProductPlaceholder')} />
            <ONhap value={thuongHieuAnh} onChange={setThuongHieuAnh} placeholder={t('knowledge.imageBrandPlaceholder')} />
          </div>
          <div>
            <Nut className="knowledge__choose-files" onClick={() => fileInputRef.current?.click()} ariaLabel={t('knowledge.chooseFiles')}>
              <svg aria-hidden="true" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 16V3m-5 5 5-5 5 5M4 15v5a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-5" />
              </svg>
              {t('knowledge.chooseFiles')}
            </Nut>
            <input ref={fileInputRef} type="file" multiple accept=".pdf,.docx,.txt,.md,.png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp" hidden onChange={(event) => { if (event.currentTarget.files) themTep(event.currentTarget.files); event.currentTarget.value = '' }} />
          </div>
          <div onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); themTep(event.dataTransfer.files) }} style={{ border: '1px dashed var(--mau-vien)', borderRadius: 8, padding: 14, textAlign: 'center' }}>
            {t('knowledge.dropFiles')}
          </div>
          {tepCho.map((item) => <div key={item.id} className="hang" style={{ justifyContent: 'space-between' }}>
            <span>{item.file.name} · {formatNumber(Math.ceil(item.file.size / 1024))} KB</span>
            <span>{item.status === 'queued' ? t('knowledge.queued') : item.status === 'uploading' ? t('knowledge.uploading') : item.status === 'success' ? t('knowledge.uploaded') : t('knowledge.uploadFailed')}</span>
            {item.message ? <span>{item.message}</span> : null}
            {item.status === 'error' ? <Nut nho bien="phu" onClick={() => retryUpload(item.id)}>{t('common.retry')}</Nut> : null}
          </div>)}
          {tepCho.length ? <div className="hang">
            {dangTaiLen ? <DangTai nhan={t('knowledge.processing')} /> : null}
            <Nut bien="phu" onClick={() => setTepCho([])} disabled={dangTaiLen}>{t('knowledge.clearQueue')}</Nut>
          </div> : null}
        </div>
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
            <label className="hang" style={{ gap: 6, fontSize: 14 }}><input type="checkbox" checked={chiAnh} onChange={(event) => setChiAnh(event.target.checked)} />{t('knowledge.imagesOnly')}</label>
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
                        {taiLieu.mimeType?.startsWith('image/') ? <img src={api.knowledgeImageUrl(companyId, taiLieu.id)} alt={taiLieu.title} loading="lazy" style={{ width: 56, height: 56, objectFit: 'cover', borderRadius: 6, float: 'right', marginLeft: 8 }} /> : null}
                        {/* Tiêu đề và đường dẫn là dữ liệu tài liệu, giữ nguyên bản gốc. */}
                        <div style={{ fontWeight: 600 }}>{taiLieu.title}</div>
                        {taiLieu.mimeType?.startsWith('image/') && (taiLieu.imageProduct || taiLieu.imageBrand) ? <div style={{ fontSize: 12, color: 'var(--mau-chu-mo)' }}>
                          {[taiLieu.imageBrand, taiLieu.imageProduct].filter(Boolean).join(' · ')}
                        </div> : null}
                        {taiLieu.source==='upload-auto' ? <div style={{fontSize:12}}>
                          {(taiLieu.categories ?? []).map(code=>nhanDanhMuc(code,t)).join(' · ')}
                          {taiLieu.sectionCount ? ` · ${formatNumber(taiLieu.sectionCount)} ${t('knowledge.sections')}` : ''}
                        </div> : null}
                        <div style={{ fontSize: 12, color: 'var(--mau-chu-mo)' }}>{taiLieu.originalName ?? taiLieu.path}</div>
                        {taiLieu.originalName ? <div style={{ fontSize: 12, color: 'var(--mau-chu-mo)' }}>
                          {taiLieu.originalName.split('.').pop()?.toUpperCase()} · {formatNumber(Math.ceil((taiLieu.sizeBytes ?? 0) / 1024))} KiB
                        </div> : null}
                        {(() => {
                          const doc = taiLieu as KnowledgeDocumentView & KnowledgeClassificationFields
                          const pending = doc.classificationStatus === 'pending' || doc.classificationStatus === 'running'
                          const error = thongBaoPhanLoai(doc.classificationError, t('knowledge.classificationError'))
                          const image = taiLieu as KnowledgeDocumentView & { imageAnalysisStatus?: string; imageAnalysisError?: string | null }
                          const imagePending = image.imageAnalysisStatus === 'pending' || image.imageAnalysisStatus === 'running'
                          const imageFailed = image.imageAnalysisStatus === 'failed'
                          return <>
                            {taiLieu.mimeType?.startsWith('image/') ? <div style={{ fontSize: 12, color: imageFailed ? 'var(--mau-loi)' : 'var(--mau-chu-mo)' }}>
                              {imagePending ? t('knowledge.imageAnalysisPending') : imageFailed ? (image.imageAnalysisError ?? t('knowledge.imageAnalysisFailed')) : image.imageAnalysisStatus === 'ready' ? t('knowledge.imageAnalysisReady') : t('knowledge.imageAnalysisUnavailable')}
                              {imageFailed ? <Nut nho bien="phu" onClick={() => { void api.retryKnowledgeImageAnalysis(companyId, taiLieu.id).then(() => taiLai()).catch((error) => setLoiLuu(error instanceof ApiError ? error.message : t('knowledge.imageAnalysisFailed'))) }}>{t('common.retry')}</Nut> : null}
                            </div> : null}
                            {pending ? <div style={{ fontSize: 12 }}>{t('knowledge.processingNoSearch')}{doc.classificationNextAttemptAt ? ` ${t('knowledge.retryBackoff', { time: formatDateTime(doc.classificationNextAttemptAt) })}` : ''}</div> : null}
                            {doc.classificationStatus === 'failed' ? <div style={{ fontSize: 12, color: 'var(--mau-loi)' }}>{error ?? t('knowledge.classificationError')}</div> : null}
                            <div className="hang" style={{ gap: 6, marginTop: 6 }}>
                              <Nhan loai={taiLieu.indexed ? 'thanh-cong' : 'canh-bao'}>
                                {taiLieu.indexed ? t('knowledge.embedded') : pending || doc.classificationStatus === 'failed' ? t('knowledge.noSearchableData') : (doc.chunkCount ?? 0) > 0 ? t('knowledge.keywordOnly') : t('knowledge.noVectorsYet')}
                              </Nhan>
                          <span style={{ fontSize: 12, color: 'var(--mau-chu-mo)' }}>
                            {t('knowledge.versionLine', {
                              version: formatNumber(taiLieu.version),
                              time: formatDateTime(taiLieu.updatedAt),
                            })}
                          </span>
                            </div>
                          </>
                        })()}
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
          phu={laTaiLen ? t('knowledge.uploadReadonly') : t('knowledge.pathHint')}
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

          {activeDocument?.classificationStatus === 'pending' || activeDocument?.classificationStatus === 'running' ? <ThongBao loai="canh-bao">{t('knowledge.processingNoSearch')}{activeDocument.classificationNextAttemptAt ? ` ${t('knowledge.retryBackoff', { time: formatDateTime(activeDocument.classificationNextAttemptAt) })}` : ''}</ThongBao> : null}
          {classificationError ? <ThongBao loai="loi">{classificationError}</ThongBao> : null}
          {laTaiLen && chonId && (duLieu.documents.find((doc) => doc.id === chonId) as (KnowledgeDocumentView & KnowledgeClassificationFields) | undefined)?.classificationStatus === 'failed' ? <Nut bien="phu" nho onClick={() => void retryClassification()}>{t('knowledge.retryClassification')}</Nut> : null}
          {laTaiLen && sections.length ? <div className="cot" style={{ gap: 10 }}>
            <strong>{t('knowledge.sections')}</strong>
            {sections.map((section) => <div key={section.id} className="cot" style={{ border: '1px solid var(--mau-vien)', padding: 10, borderRadius: 6 }}>
              <strong>{section.title}</strong>
              <div className="luoi luoi--2">
                <OChon value={section.category} onChange={(category) => void saveSection(section.id, category, section.tags)} options={danhMucOptions} />
                <ONhap value={section.tags.join(', ')} onChange={(value) => void saveSection(section.id, section.category, value.split(',').map((tag) => tag.trim()).filter(Boolean))} placeholder={t('knowledge.sectionTags')} />
              </div>
              {savingSection === section.id ? <span>{t('knowledge.processing')}</span> : null}
            </div>)}
          </div> : null}
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
                {!laTaiLen ? <ONhap
                  value={bieuMau.path}
                  onChange={(giaTri) => setBieuMau((truoc) => ({ ...truoc, path: giaTri }))}
                  placeholder="20-thi-truong/nghien-cuu-abc.md"
                /> : <span>{duLieu.documents.find((doc) => doc.id === chonId)?.originalName}</span>}
              </div>
              <div className="luoi luoi--2">
                {duLieu.documents.find((doc)=>doc.id===chonId)?.source !== 'upload-auto' ? <OChon
                  value={bieuMau.category}
                  onChange={(giaTri) => setBieuMau((truoc) => ({ ...truoc, category: giaTri }))}
                  options={danhMucOptions}
                /> : <span>{t('knowledge.autoClassifyHint')}</span>}
                <ONhap
                  value={bieuMau.tags}
                  onChange={(giaTri) => setBieuMau((truoc) => ({ ...truoc, tags: giaTri }))}
                  placeholder="tag1, tag2"
                />
              </div>
              {laTaiLen && activeDocument?.mimeType?.startsWith('image/') ? <div className="cot" style={{ gap: 8 }}>
                <div className="luoi luoi--2">
                  <ONhap value={anhSanPham} onChange={setAnhSanPham} placeholder={t('knowledge.imageProductPlaceholder')} />
                  <ONhap value={anhThuongHieu} onChange={setAnhThuongHieu} placeholder={t('knowledge.imageBrandPlaceholder')} />
                </div>
                <OVanBan value={anhMoTa} onChange={setAnhMoTa} rows={4} placeholder={t('knowledge.imageDescriptionPlaceholder')} />
              </div> : null}
              {laTaiLen ? <div>
                {dangTaiNoiDung ? <DangTai nhan={t('knowledge.loadingContent')} /> : <>
                  <div className="nhan">{t('knowledge.markdownContent')}</div>
                  <textarea className="o-van-ban" value={noiDungTaiLen ?? ''} readOnly rows={16} />
                  <a href={api.knowledgeDownloadUrl(companyId, chonId!)}>{t('knowledge.downloadOriginal')}</a>
                </>}
              </div> : <div className="luoi luoi--2" style={{ alignItems: 'start' }}>
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
              </div>}
              <div className="hang">
                <Nut onClick={() => void (laTaiLen ? luuMetadata() : luu())} dangTai={dangLuu}>
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
        </>
      )}
    </Trang>
  )
}
