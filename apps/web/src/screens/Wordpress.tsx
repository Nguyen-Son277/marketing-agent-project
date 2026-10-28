import { useEffect, useState, useRef, type ReactNode } from 'react'
import type {
  WordpressSiteView,
  WordpressJobView,
  WordpressJobInput,
} from '@marketing-agent/shared'
import { api, request } from '../lib/api.ts'
import { useSession } from '../lib/session.tsx'
import { useI18n } from '../lib/i18n.tsx'
import {
  Card,
  Trang,
  TieuDeTrang,
  Nut,
  ThongBao,
  Nhan,
  OChon,
  ONhap,
  OVanBan,
  Truong,
  Trong,
  DangTai,
} from '../components/ui.tsx'

export function Wordpress({ companyId }: { companyId: string }): ReactNode {
  const { company } = useSession()
  const { t } = useI18n()
  const manage = company?.role === 'owner' || company?.role === 'admin'
  const root = `/api/companies/${encodeURIComponent(companyId)}/wordpress`

  const [sites, setSites] = useState<WordpressSiteView[] | null>(null)
  const [jobs, setJobs] = useState<WordpressJobView[]>([])
  const [siteId, setSiteId] = useState(() => {
    const hashQuery = window.location.hash.split('?')[1]
    return new URLSearchParams(hashQuery || '').get('siteId') || ''
  })

  // Task form state
  const [action, setAction] = useState<WordpressJobInput['action']>('create')
  const [resource, setResource] = useState<WordpressJobInput['resource']>('pages')
  const [resourceId, setResourceId] = useState('')
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [status, setStatus] = useState('draft')
  const [description, setDescription] = useState('')
  const [canonical, setCanonical] = useState('')
  const [source, setSource] = useState('')
  const [urls, setUrls] = useState('')
  const [operation, setOperation] = useState('backup')
  const [target, setTarget] = useState('')
  const [postId, setPostId] = useState('')
  const [widgetId, setWidgetId] = useState('')
  const [widgetText, setWidgetText] = useState('')

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  async function refresh() {
    const [s, j] = await Promise.all([
      api.wordpressSites(companyId),
      api.wordpressJobs(companyId),
    ])
    setSites(s.sites)
    setJobs(j.jobs)
    setSiteId((old) => old || s.sites[0]?.id || '')
  }

  useEffect(() => {
    let closed = false
    const load = () => {
      if (!closed)
        void refresh().catch((e) => {
          if (!closed) setError(e instanceof Error ? e.message : String(e))
        })
    }
    load()
    const timer = setInterval(load, 4000)
    return () => {
      closed = true
      clearInterval(timer)
    }
  }, [companyId])

  async function perform(work: () => Promise<void>) {
    setBusy(true)
    setError('')
    setMessage('')
    try {
      await work()
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const pendingKey = useRef<{ signature: string; key: string } | null>(null)
  function jobKey(signature: string) {
    if (pendingKey.current?.signature !== signature)
      pendingKey.current = { signature, key: crypto.randomUUID() }
    return pendingKey.current.key
  }

  const selected = sites?.find((s) => s.id === siteId)
  const bridge = selected?.capabilities.bridge as
    | {
        available?: boolean
        seo?: { yoast?: boolean; rankmath?: boolean }
        updraftplus?: boolean
        elementor?: boolean
      }
    | undefined
  const browserCapability = selected?.capabilities.browser as
    | { configured?: boolean }
    | undefined
  const seoAvailable =
    bridge?.seo &&
    (selected?.seoPlugin
      ? bridge.seo[selected.seoPlugin]
      : !!(bridge.seo.yoast !== bridge.seo.rankmath))
  const supportedActions = new Set([
    'audit',
    ...(bridge?.available
      ? [
          'create',
          'update',
          'trash',
          'optimize',
          'restore',
          ...(bridge.updraftplus ? ['admin'] : []),
          ...(seoAvailable ? ['seo'] : []),
        ]
      : []),
  ])
  const adminOperations = [
    ...(browserCapability?.configured
      ? [
          'backup',
          'restore_backup',
          ...(bridge?.elementor ? ['elementor'] : []),
        ]
      : []),
    'plugin_activate',
    'plugin_deactivate',
    'plugin_update',
    'plugin_install',
    'plugin_delete',
    'theme_activate',
    'theme_update',
    'theme_install',
    'theme_delete',
  ]

  const actionLabels: Record<string, string> = {
    create: 'Tạo nội dung mới',
    update: 'Cập nhật nội dung',
    trash: 'Chuyển vào thùng rác',
    seo: 'Tối ưu metadata SEO',
    audit: 'Đo SEO & tốc độ (Lighthouse)',
    optimize: 'Tối ưu media / hình ảnh',
    admin: 'Quản trị hệ thống & plugin',
    restore: 'Khôi phục từ snapshot',
  }

  const siteOptions = (sites || []).map((s) => ({
    value: s.id,
    label: `${s.name} (${s.environment})${!s.enabled ? ' · Đã thu hồi' : ''}`,
  }))

  const actionOptions = Object.entries(actionLabels)
    .filter(([key]) => supportedActions.has(key))
    .map(([key, label]) => ({ value: key, label }))

  const resourceOptions = [
    { value: 'pages', label: 'Trang (Pages)' },
    { value: 'posts', label: 'Bài viết (Posts)' },
    { value: 'media', label: 'Media / Hình ảnh' },
    { value: 'categories', label: 'Chuyên mục (Categories)' },
    { value: 'tags', label: 'Thẻ (Tags)' },
    { value: 'templates', label: 'Template' },
    { value: 'template-parts', label: 'Template part' },
  ] as const

  const statusOptions = [
    { value: 'draft', label: 'Bản nháp (Draft)' },
    { value: 'publish', label: 'Xuất bản (Publish)' },
    { value: 'private', label: 'Riêng tư (Private)' },
  ] as const

  const adminOptions = adminOperations.map((op) => ({ value: op, label: op }))

  return (
    <Trang rong>
      <TieuDeTrang moTa="Thực thi tác vụ nội dung, tối ưu SEO và quản trị website WordPress">
        WordPress
      </TieuDeTrang>

      {error && <ThongBao loai="loi">{error}</ThongBao>}
      {message && <ThongBao loai="thong-tin">{message}</ThongBao>}

      {sites === null ? (
        <DangTai nhan={t('common.loading')} />
      ) : sites.length === 0 ? (
        <Card>
          <Trong>
            <div style={{ textAlign: 'center', padding: '16px 0' }}>
              <p style={{ fontWeight: 650, fontSize: 16, margin: '0 0 6px' }}>
                Chưa có website WordPress nào được kết nối
              </p>
              <p style={{ color: 'var(--mau-chu-mo)', margin: '0 0 16px' }}>
                Vui lòng kết nối website WordPress trong phần Cài đặt để bắt đầu giao việc và quản trị nội dung.
              </p>
              <Nut
                bien="chinh"
                onClick={() => {
                  window.location.hash = '#/cai-dat?tab=wordpress'
                }}
              >
                Đến Cài đặt kết nối WordPress
              </Nut>
            </div>
          </Trong>
        </Card>
      ) : (
        <>
          {/* Site Selector Toolbar */}
          <Card>
            <div
              className="hang"
              style={{
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: 12,
              }}
            >
              <div
                className="hang"
                style={{ gap: 10, flex: 1, minWidth: 260, alignItems: 'center' }}
              >
                <span style={{ fontWeight: 600, fontSize: 14 }}>Website:</span>
                <div style={{ minWidth: 220, maxWidth: 320 }}>
                  <OChon
                    value={siteId}
                    onChange={setSiteId}
                    options={siteOptions}
                  />
                </div>

                {selected && (
                  <div className="hang" style={{ gap: 6 }}>
                    <a
                      href={selected.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ fontSize: 13, color: 'var(--mau-chinh)' }}
                    >
                      {selected.url} ↗
                    </a>
                    <Nhan loai={selected.environment === 'production' ? 'chinh' : 'canh-bao'}>
                      {selected.environment === 'production' ? 'Production' : 'Staging'}
                    </Nhan>
                    <Nhan loai={selected.enabled ? 'thanh-cong' : 'mo'}>
                      {selected.enabled ? 'Đang hoạt động' : 'Đã thu hồi'}
                    </Nhan>
                    {bridge?.available && (
                      <Nhan loai="thanh-cong">Bridge Sẵn sàng</Nhan>
                    )}
                  </div>
                )}
              </div>

              <div className="hang" style={{ gap: 8 }}>
                {manage && selected?.enabled && (
                  <Nut
                    nho
                    onClick={() =>
                      void perform(async () => {
                        await api.testWordpressSite(companyId, selected.id)
                        setMessage('Đã kiểm tra kết nối website')
                      })
                    }
                    disabled={busy}
                  >
                    Kiểm tra kết nối
                  </Nut>
                )}
                <Nut
                  nho
                  bien="phu"
                  onClick={() => {
                    window.location.hash = '#/cai-dat?tab=wordpress'
                  }}
                >
                  ⚙️ Quản lý kết nối trong Cài đặt
                </Nut>
              </div>
            </div>
          </Card>

          {/* Task Execution Form */}
          {manage && selected?.enabled && (
            <Card tieuDe={`Tác vụ: ${selected.name}`}>
              <form
                onSubmit={(e) => {
                  e.preventDefault()
                  void perform(async () => {
                    if (!supportedActions.has(action))
                      throw new Error('Thao tác chưa được xác minh khả năng hỗ trợ')
                    const data: Record<string, unknown> =
                      action === 'seo'
                        ? {
                            ...(title ? { title } : {}),
                            ...(description ? { description } : {}),
                            ...(canonical ? { canonical } : {}),
                          }
                        : action === 'admin'
                          ? {
                              operation,
                              ...(target ? { target } : {}),
                              ...(operation === 'elementor'
                                ? {
                                    values: {
                                      postId: Number(postId),
                                      widgetId,
                                      text: widgetText,
                                    },
                                  }
                                : {}),
                            }
                          : action === 'optimize'
                            ? { alt_text: description }
                            : action === 'trash' ||
                                action === 'restore' ||
                                action === 'audit'
                              ? {}
                              : {
                                  ...(title ? { title } : {}),
                                  ...(content ? { content } : {}),
                                  status,
                                }
                    const result = await request<{ job: WordpressJobView }>(
                      `${root}/jobs`,
                      {
                        method: 'POST',
                        body: {
                          siteId,
                          action,
                          resource,
                          ...(resourceId
                            ? { resourceId: Number(resourceId) || resourceId }
                            : {}),
                          data,
                          ...(source ? { sourceJobId: source } : {}),
                          ...(urls.trim()
                            ? {
                                urls: urls
                                  .split('\n')
                                  .map((u) => u.trim())
                                  .filter(Boolean),
                              }
                            : {}),
                          idempotencyKey: jobKey(
                            JSON.stringify({
                              siteId,
                              action,
                              resource,
                              resourceId,
                              data,
                              source,
                              urls,
                            }),
                          ),
                        },
                      },
                    )
                    pendingKey.current = null
                    setMessage(`Đã tạo job ${result.job.id}`)
                  })
                }}
                className="cot"
                style={{ gap: 12, maxWidth: 840 }}
              >
                <div className="luoi luoi--2">
                  <Truong nhan="Thao tác">
                    <OChon
                      value={action}
                      onChange={(val) => {
                        const act = val as WordpressJobInput['action']
                        setAction(act)
                        if (act === 'optimize') setResource('media')
                      }}
                      options={actionOptions}
                    />
                  </Truong>

                  <Truong nhan="Loại nội dung">
                    <OChon
                      value={resource}
                      onChange={(val) =>
                        setResource(val as WordpressJobInput['resource'])
                      }
                      options={resourceOptions}
                    />
                  </Truong>
                </div>

                {['update', 'seo', 'trash', 'optimize'].includes(action) && (
                  <Truong nhan="ID tài nguyên">
                    <ONhap
                      value={resourceId}
                      onChange={setResourceId}
                      placeholder="Ví dụ: 123"
                    />
                  </Truong>
                )}

                {['create', 'update', 'seo'].includes(action) && (
                  <Truong nhan="Tiêu đề">
                    <ONhap
                      value={title}
                      onChange={setTitle}
                      placeholder="Tiêu đề bài viết hoặc trang"
                    />
                  </Truong>
                )}

                {['create', 'update'].includes(action) && (
                  <>
                    <Truong nhan="Nội dung">
                      <OVanBan
                        value={content}
                        onChange={setContent}
                        rows={8}
                        placeholder="Nội dung văn bản (hỗ trợ HTML / Gutenberg blocks)…"
                      />
                    </Truong>

                    <Truong nhan="Trạng thái">
                      <OChon
                        value={status}
                        onChange={setStatus}
                        options={statusOptions}
                      />
                    </Truong>
                  </>
                )}

                {['seo', 'optimize'].includes(action) && (
                  <Truong nhan={action === 'seo' ? 'Mô tả SEO' : 'Alt text'}>
                    <ONhap
                      value={description}
                      onChange={setDescription}
                      placeholder={action === 'seo' ? 'Meta description…' : 'Mô tả hình ảnh…'}
                    />
                  </Truong>
                )}

                {action === 'seo' && (
                  <Truong nhan="Canonical URL">
                    <ONhap
                      type="url"
                      value={canonical}
                      onChange={setCanonical}
                      placeholder="https://example.com/canonical-url"
                    />
                  </Truong>
                )}

                {['restore', 'optimize'].includes(action) && (
                  <Truong nhan="ID job nguồn">
                    <ONhap
                      value={source}
                      onChange={setSource}
                      placeholder="ID tác vụ cần khôi phục hoặc tối ưu"
                    />
                  </Truong>
                )}

                {action === 'audit' && (
                  <Truong
                    nhan="URL cần đo Lighthouse (mỗi dòng một URL, tối đa 5)"
                    goiY={`Mặc định sẽ đo URL gốc: ${selected.url}`}
                  >
                    <OVanBan
                      value={urls}
                      onChange={setUrls}
                      placeholder={selected.url}
                      rows={4}
                    />
                  </Truong>
                )}

                {action === 'admin' && (
                  <div className="cot" style={{ gap: 10 }}>
                    <div className="luoi luoi--2">
                      <Truong nhan="Thao tác quản trị">
                        <OChon
                          value={operation}
                          onChange={setOperation}
                          options={adminOptions}
                        />
                      </Truong>

                      <Truong nhan="Plugin / theme đích">
                        <ONhap
                          value={target}
                          onChange={setTarget}
                          placeholder="Tên slug plugin hoặc theme"
                        />
                      </Truong>
                    </div>

                    {operation === 'elementor' && (
                      <div className="luoi luoi--3">
                        <Truong nhan="ID trang Elementor">
                          <ONhap
                            value={postId}
                            onChange={setPostId}
                            placeholder="Post ID"
                          />
                        </Truong>
                        <Truong nhan="ID heading widget">
                          <ONhap
                            value={widgetId}
                            onChange={setWidgetId}
                            placeholder="Widget ID"
                          />
                        </Truong>
                        <Truong nhan="Nội dung heading">
                          <ONhap
                            value={widgetText}
                            onChange={setWidgetText}
                            placeholder="Tiêu đề mới"
                          />
                        </Truong>
                      </div>
                    )}

                    <p style={{ fontSize: 13, color: 'var(--mau-chu-mo)', margin: '4px 0' }}>
                      Yêu cầu bản backup UpdraftPlus hợp lệ trước khi thay đổi cấu hình.
                    </p>
                  </div>
                )}

                {!supportedActions.has(action) && (
                  <ThongBao loai="canh-bao">
                    Kiểm tra kết nối rồi chọn một thao tác được hỗ trợ. SEO cần Yoast/Rank Math; quản trị cần UpdraftPlus.
                  </ThongBao>
                )}

                <div>
                  <Nut
                    type="submit"
                    bien="chinh"
                    disabled={
                      busy ||
                      !supportedActions.has(action) ||
                      (action === 'admin' && !adminOperations.includes(operation))
                    }
                    dangTai={busy}
                  >
                    Tạo tác vụ
                  </Nut>
                </div>
              </form>
            </Card>
          )}

          {/* Job History Card */}
          <Card tieuDe="Lịch sử tác vụ và snapshot">
            {jobs.filter((j) => !siteId || j.siteId === siteId).length === 0 ? (
              <p style={{ color: 'var(--mau-chu-mo)', fontStyle: 'italic', margin: 0 }}>
                Chưa có tác vụ nào cho website này.
              </p>
            ) : null}

            {jobs
              .filter((j) => !siteId || j.siteId === siteId)
              .map((job) => {
                const statusType =
                  job.status === 'completed'
                    ? 'thanh-cong'
                    : job.status === 'running'
                      ? 'chinh'
                      : job.status === 'failed'
                        ? 'loi'
                        : job.status === 'awaiting_approval' || job.status === 'waiting_human'
                          ? 'canh-bao'
                          : 'mo'

                return (
                  <div
                    key={job.id}
                    style={{
                      padding: 14,
                      borderBottom: '1px solid var(--mau-vien)',
                    }}
                  >
                    <div className="hang" style={{ justifyContent: 'space-between', marginBottom: 6 }}>
                      <div className="hang" style={{ gap: 8, alignItems: 'center' }}>
                        <strong style={{ fontSize: 15 }}>
                          {actionLabels[job.action] || job.action}
                        </strong>
                        <Nhan loai={statusType}>{job.status}</Nhan>
                      </div>
                      <small style={{ color: 'var(--mau-chu-mo)', fontFamily: 'var(--font-mono)' }}>
                        {job.id}
                      </small>
                    </div>

                    {job.error && (
                      <p style={{ color: 'var(--mau-loi)', margin: '4px 0', fontSize: 13 }}>
                        {job.error}
                      </p>
                    )}

                    <div className="hang" style={{ gap: 8, marginTop: 8, alignItems: 'center' }}>
                      {manage &&
                        job.status === 'awaiting_approval' &&
                        job.approvalHash && (
                          <Nut
                            nho
                            disabled={busy}
                            onClick={() =>
                              void perform(async () => {
                                await api.approveWordpressJob(companyId, job.id, job.approvalHash!)
                              })
                            }
                          >
                            Duyệt xóa phiên bản này
                          </Nut>
                        )}

                      {manage &&
                        ['queued', 'running', 'awaiting_approval', 'waiting_human'].includes(job.status) && (
                          <Nut
                            nho
                            bien="phu"
                            disabled={busy}
                            onClick={() =>
                              void perform(async () => {
                                await api.cancelWordpressJob(companyId, job.id)
                              })
                            }
                          >
                            {t('common.cancel')}
                          </Nut>
                        )}

                      {job.status === 'waiting_human' && (
                        <a
                          href="#/trinh-duyet-xa-hoi"
                          style={{ fontSize: 13, color: 'var(--mau-chinh)', fontWeight: 600 }}
                        >
                          Mở Browser Worker ↗
                        </a>
                      )}
                    </div>

                    {/* Screenshot comparison */}
                    {Boolean(job.result) && typeof job.result === 'object' && (
                      <div className="hang" style={{ gap: 12, marginTop: 10, flexWrap: 'wrap' }}>
                        {['before', 'after'].map((key) => {
                          const result = job.result as {
                            before?: string
                            after?: string
                            _ma_verification?: {
                              beforeCapture?: { image?: string }
                              afterCapture?: { image?: string }
                            }
                          }
                          const data =
                            key === 'before'
                              ? (result.before ??
                                result._ma_verification?.beforeCapture?.image)
                              : (result.after ??
                                result._ma_verification?.afterCapture?.image)
                          return typeof data === 'string' &&
                            /^[A-Za-z0-9+/=]+$/.test(data) &&
                            data.length > 2000 ? (
                            <figure
                              key={key}
                              style={{
                                margin: 0,
                                border: '1px solid var(--mau-vien)',
                                borderRadius: 'var(--ban-kinh-nho)',
                                overflow: 'hidden',
                                background: 'var(--mau-be-mat)',
                              }}
                            >
                              <figcaption
                                style={{
                                  padding: '4px 8px',
                                  fontSize: 12,
                                  fontWeight: 600,
                                  background: 'var(--mau-nen)',
                                  borderBottom: '1px solid var(--mau-vien)',
                                }}
                              >
                                {key === 'before' ? 'Trước thay đổi' : 'Sau thay đổi'}
                              </figcaption>
                              <img
                                src={`data:image/jpeg;base64,${data}`}
                                alt={key === 'before' ? 'Trước thay đổi' : 'Sau thay đổi'}
                                style={{ maxWidth: 360, width: '100%', display: 'block' }}
                              />
                            </figure>
                          ) : null
                        })}
                      </div>
                    )}

                    <details style={{ marginTop: 8, fontSize: 12 }}>
                      <summary style={{ cursor: 'pointer', color: 'var(--mau-chu-mo)' }}>
                        Nội dung, snapshot và kết quả chi tiết
                      </summary>
                      <pre
                        style={{
                          margin: '6px 0 0',
                          padding: 10,
                          borderRadius: 'var(--ban-kinh-nho)',
                          background: 'var(--mau-nen)',
                          fontSize: 12,
                          whiteSpace: 'pre-wrap',
                          overflowWrap: 'anywhere',
                        }}
                      >
                        {JSON.stringify(
                          {
                            input: job.input,
                            snapshot: job.snapshot,
                            result: job.result,
                          },
                          (k, v) =>
                            ['before', 'after', 'image'].includes(k) &&
                            typeof v === 'string' &&
                            v.length > 2000
                              ? '[Ảnh chụp trang]'
                              : k === 'file_base64'
                                ? '[Dữ liệu ảnh]'
                                : v,
                          2,
                        )}
                      </pre>
                    </details>
                  </div>
                )
              })}
          </Card>
        </>
      )}
    </Trang>
  )
}
