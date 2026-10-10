/**
 * Đội agent — nơi cấu hình từng agent của công ty.
 *
 * Vì sao màn hình này tồn tại: một đội 10 agent chỉ hoạt động đúng khi mỗi agent
 * biết mình chạy model nào, được dùng kỹ năng và tool gì, và được đọc/ghi danh mục
 * kiến thức nào. Đây cũng là nơi phát hiện cấu hình chết — agent không có kỹ năng
 * hoặc không đọc được danh mục nào thì gần như chắc chắn trả lời sai — nên các
 * cảnh báo đó được đặt ngay cạnh nút lưu.
 */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { ModelTier, TeamMemberView, TeamResponse } from '@marketing-agent/shared'
import { KB_CATEGORIES, MODEL_TIERS } from '@marketing-agent/shared'
import { api, ApiError } from '../lib/api.ts'
import {
  Card,
  DangTai,
  Nhan,
  Nut,
  OChon,
  OSo,
  ThongBao,
  TieuDeTrang,
  Trang,
  Trong,
  soNguyen,
} from '../components/ui.tsx'

const NHAN_TIER: Readonly<Record<ModelTier, string>> = {
  light: 'Nhẹ (light)',
  standard: 'Chuẩn (standard)',
  deep: 'Sâu (deep)',
}

interface QuyenKienThuc {
  readonly category: string
  readonly canRead: boolean
  readonly canWrite: boolean
}

/** Bản nháp cấu hình của một agent, tách khỏi dữ liệu server để sửa rồi mới lưu. */
interface BanNhap {
  readonly enabled: boolean
  readonly modelFk: string
  readonly tier: ModelTier
  readonly skills: readonly string[]
  readonly tools: readonly string[]
  readonly knowledge: readonly QuyenKienThuc[]
}

function LoiManHinh({ loi }: { loi: ApiError }): ReactNode {
  return (
    <ThongBao loai="loi">
      {loi.message}
      {loi.needsConfiguration ? ' Vào mục “Cài đặt” để hoàn tất cấu hình trước khi dùng màn hình này.' : null}
    </ThongBao>
  )
}

/** Nhãn hiển thị của một danh mục kiến thức, chấp nhận cả mã lạ ngoài danh mục chuẩn. */
function nhanDanhMuc(code: string): string {
  return KB_CATEGORIES.find((danhMuc) => danhMuc.code === code)?.label ?? code
}

/** Danh sách quyền kiến thức đầy đủ: mọi danh mục chuẩn, cộng danh mục lạ nếu server có. */
function danhMucDayDu(member: TeamMemberView): QuyenKienThuc[] {
  const hienCo = new Map(member.knowledge.map((quyen) => [quyen.category, quyen]))
  const codes = new Set<string>(KB_CATEGORIES.map((danhMuc) => danhMuc.code))
  for (const quyen of member.knowledge) codes.add(quyen.category)
  return [...codes].sort().map((code) => {
    const quyen = hienCo.get(code)
    return { category: code, canRead: quyen?.canRead ?? false, canWrite: quyen?.canWrite ?? false }
  })
}

function taoBanNhap(team: TeamResponse): Record<string, BanNhap> {
  const map: Record<string, BanNhap> = {}
  for (const member of team.members) {
    map[member.role] = {
      enabled: member.enabled,
      // `modelFk` là khoá nội bộ server trả về sẵn để đọc-rồi-ghi lại chính xác.
      modelFk: member.modelFk ?? '',
      tier: member.tier,
      skills: member.skills.map((kyNang) => kyNang.name),
      tools: [...member.tools],
      knowledge: danhMucDayDu(member),
    }
  }
  return map
}

export function DoiAgent({ companyId }: { companyId: string }): ReactNode {
  const [duLieu, setDuLieu] = useState<TeamResponse | null>(null)
  const [banNhap, setBanNhap] = useState<Record<string, BanNhap>>({})
  const [dangTai, setDangTai] = useState(true)
  const [loi, setLoi] = useState<ApiError | null>(null)
  const [lanThu, setLanThu] = useState(0)
  const [moRong, setMoRong] = useState<Record<string, boolean>>({})
  const [dangLuu, setDangLuu] = useState<string | null>(null)
  const [thongBao, setThongBao] = useState<Record<string, string>>({})
  const [loiLuu, setLoiLuu] = useState<Record<string, string>>({})

  useEffect(() => {
    let cancelled = false
    setDangTai(true)
    setLoi(null)
    api
      .team(companyId)
      .then((ketQua) => {
        if (cancelled) return
        setDuLieu(ketQua)
        setBanNhap(taoBanNhap(ketQua))
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

  const tongQuan = useMemo(() => {
    if (!duLieu) return null
    const bat = duLieu.members.filter((member) => member.enabled).length
    const thieuKyNang = duLieu.members.filter((member) => member.skills.length === 0).map((member) => member.displayName)
    const khongDocDuoc = duLieu.members
      .filter((member) => !member.knowledge.some((quyen) => quyen.canRead))
      .map((member) => member.displayName)
    return { bat, tong: duLieu.members.length, thieuKyNang, khongDocDuoc }
  }, [duLieu])

  function capNhat(role: string, thayDoi: Partial<BanNhap>): void {
    setBanNhap((truoc) => {
      const hienTai = truoc[role]
      if (!hienTai) return truoc
      return { ...truoc, [role]: { ...hienTai, ...thayDoi } }
    })
  }

  function doiKyNang(role: string, ten: string): void {
    setBanNhap((truoc) => {
      const hienTai = truoc[role]
      if (!hienTai) return truoc
      const co = hienTai.skills.includes(ten)
      const skills = co ? hienTai.skills.filter((item) => item !== ten) : [...hienTai.skills, ten]
      return { ...truoc, [role]: { ...hienTai, skills } }
    })
  }

  function doiTool(role: string, ten: string): void {
    setBanNhap((truoc) => {
      const hienTai = truoc[role]
      if (!hienTai) return truoc
      const co = hienTai.tools.includes(ten)
      const tools = co ? hienTai.tools.filter((item) => item !== ten) : [...hienTai.tools, ten]
      return { ...truoc, [role]: { ...hienTai, tools } }
    })
  }

  function doiQuyen(role: string, category: string, truong: 'canRead' | 'canWrite', giaTri: boolean): void {
    setBanNhap((truoc) => {
      const hienTai = truoc[role]
      if (!hienTai) return truoc
      const knowledge = hienTai.knowledge.map((quyen) =>
        quyen.category === category ? { ...quyen, [truong]: giaTri } : quyen,
      )
      return { ...truoc, [role]: { ...hienTai, knowledge } }
    })
  }

  async function luu(member: TeamMemberView): Promise<void> {
    const nhap = banNhap[member.role]
    if (!nhap) return
    setDangLuu(member.role)
    setThongBao((truoc) => ({ ...truoc, [member.role]: '' }))
    setLoiLuu((truoc) => ({ ...truoc, [member.role]: '' }))
    try {
      const ketQua = await api.updateTeamMember(companyId, member.role, {
        enabled: nhap.enabled,
        tier: nhap.tier,
        modelFk: nhap.modelFk.length > 0 ? nhap.modelFk : null,
        skills: nhap.skills,
        tools: nhap.tools,
        knowledge: nhap.knowledge,
      })
      // Đồng bộ nhãn do server suy ra (modelLabel, providerName) mà bản nháp không có.
      setDuLieu((truoc) =>
        truoc
          ? { ...truoc, members: truoc.members.map((item) => (item.role === member.role ? ketQua.member : item)) }
          : truoc,
      )
      setThongBao((truoc) => ({ ...truoc, [member.role]: `Đã lưu cấu hình cho ${member.displayName}.` }))
    } catch (error) {
      setLoiLuu((truoc) => ({
        ...truoc,
        [member.role]: error instanceof ApiError ? error.message : 'Không lưu được cấu hình.',
      }))
    } finally {
      setDangLuu(null)
    }
  }

  if (dangTai && !duLieu) {
    return (
      <Trang>
        <TieuDeTrang>Đội agent</TieuDeTrang>
        <DangTai nhan="Đang tải cấu hình đội…" />
      </Trang>
    )
  }

  if (loi && !duLieu) {
    return (
      <Trang>
        <TieuDeTrang>Đội agent</TieuDeTrang>
        <LoiManHinh loi={loi} />
        <div style={{ marginTop: 12 }}>
          <Nut bien="phu" onClick={taiLai}>
            Thử lại
          </Nut>
        </div>
      </Trang>
    )
  }

  if (!duLieu || !tongQuan) return null

  return (
    <Trang rong>
      <TieuDeTrang moTa="Bật/tắt agent, chọn model, gán kỹ năng, tool và quyền đọc/ghi kho kiến thức. Mỗi agent lưu riêng.">
        Đội agent
      </TieuDeTrang>

      <div className="luoi luoi--3" style={{ marginBottom: 16 }}>
        <OSo nhan="Agent đang bật" giaTri={`${soNguyen(tongQuan.bat)}/${soNguyen(tongQuan.tong)}`} />
        <OSo nhan="Kỹ năng khả dụng" giaTri={soNguyen(duLieu.availableSkills.length)} moTa="Hệ thống biết" />
        <OSo nhan="Tool khả dụng" giaTri={soNguyen(duLieu.availableTools.length)} moTa="Trong bản triển khai này" />
        <OSo
          nhan="Cần phê duyệt"
          giaTri={soNguyen(duLieu.availableTools.filter((tool) => tool.requiresApproval).length)}
          loai="canh-bao"
          moTa="Tool không tự chạy khi chưa được duyệt"
        />
      </div>

      {tongQuan.thieuKyNang.length > 0 ? (
        <div style={{ marginBottom: 12 }}>
          <ThongBao loai="canh-bao">
            <strong>Agent không có kỹ năng nào:</strong> {tongQuan.thieuKyNang.join(', ')}. Agent không có kỹ năng sẽ
            không nhận được phương pháp làm việc nào; hãy gán ít nhất một kỹ năng.
          </ThongBao>
        </div>
      ) : null}

      {tongQuan.khongDocDuoc.length > 0 ? (
        <div style={{ marginBottom: 12 }}>
          <ThongBao loai="canh-bao">
            <strong>Agent không đọc được danh mục kiến thức nào:</strong> {tongQuan.khongDocDuoc.join(', ')}. Các agent
            này sẽ bị lọc sạch kết quả tìm kiếm kho kiến thức; hãy cấp quyền đọc tối thiểu một danh mục.
          </ThongBao>
        </div>
      ) : null}

      {duLieu.members.length === 0 ? (
        <Trong>Chưa có agent nào trong công ty này. Hãy kiểm tra lại bước khởi tạo công ty.</Trong>
      ) : null}

      {duLieu.members.map((member) => {
        const nhap = banNhap[member.role]
        if (!nhap) return null
        const mo = moRong[member.role] === true
        const soKyNang = nhap.skills.length
        const soDocDuoc = nhap.knowledge.filter((quyen) => quyen.canRead).length
        return (
          <Card
            key={member.agentDefId}
            tieuDe={
              <span className="hang">
                {member.displayName}
                {member.isLeader ? <Nhan loai="chinh">Leader</Nhan> : null}
                <Nhan loai="mo">{member.role}</Nhan>
                {member.requireApproval ? <Nhan loai="canh-bao">Cần phê duyệt</Nhan> : null}
              </span>
            }
            phu={member.description}
            hanhDong={
              <span className="hang">
                <label className="hang" style={{ gap: 6, fontSize: 13 }}>
                  <input
                    type="checkbox"
                    checked={nhap.enabled}
                    onChange={(event) => capNhat(member.role, { enabled: event.target.checked })}
                  />
                  Đang bật
                </label>
                <Nut bien="phu" nho onClick={() => setMoRong((truoc) => ({ ...truoc, [member.role]: !mo }))}>
                  {mo ? 'Thu gọn' : 'Cấu hình'}
                </Nut>
                <Nut nho onClick={() => void luu(member)} dangTai={dangLuu === member.role}>
                  Lưu
                </Nut>
              </span>
            }
          >
            <div className="hang" style={{ marginBottom: 8 }}>
              <Nhan loai="mo">Tier hiện tại: {NHAN_TIER[member.tier]}</Nhan>
              <Nhan loai="mo">Model: {member.modelLabel ?? 'mặc định theo tier'}</Nhan>
              <Nhan loai="mo">Nhà cung cấp: {member.providerName ?? '—'}</Nhan>
              <Nhan loai={soKyNang === 0 ? 'canh-bao' : 'mo'}>{soNguyen(soKyNang)} kỹ năng</Nhan>
              <Nhan loai={nhap.tools.length === 0 ? 'canh-bao' : 'mo'}>{soNguyen(nhap.tools.length)} tool</Nhan>
              <Nhan loai={soDocDuoc === 0 ? 'canh-bao' : 'mo'}>{soNguyen(soDocDuoc)} danh mục đọc được</Nhan>
              <Nhan loai="mo">Ngân sách ngữ cảnh: {soNguyen(member.contextBudgetTokens)} token</Nhan>
            </div>

            {thongBao[member.role] ? (
              <div style={{ marginBottom: 8 }}>
                <ThongBao loai="thanh-cong">{thongBao[member.role]}</ThongBao>
              </div>
            ) : null}
            {loiLuu[member.role] ? (
              <div style={{ marginBottom: 8 }}>
                <ThongBao loai="loi">{loiLuu[member.role]}</ThongBao>
              </div>
            ) : null}

            {soKyNang === 0 ? (
              <div style={{ marginBottom: 8 }}>
                <ThongBao loai="canh-bao">Agent này chưa được gán kỹ năng nào.</ThongBao>
              </div>
            ) : null}
            {soDocDuoc === 0 ? (
              <div style={{ marginBottom: 8 }}>
                <ThongBao loai="canh-bao">Agent này không đọc được danh mục kiến thức nào.</ThongBao>
              </div>
            ) : null}

            {mo ? (
              <div className="cot" style={{ gap: 16, marginTop: 12 }}>
                <div className="luoi luoi--2">
                  <div>
                    <h3 className="card__tieu-de">Model</h3>
                    <OChon
                      value={nhap.modelFk}
                      onChange={(giaTri) => capNhat(member.role, { modelFk: giaTri })}
                      options={[
                        { value: '', label: '— Dùng model mặc định của tier —' },
                        ...duLieu.models.map((model) => ({
                          value: model.id,
                          label: `${model.label} · ${model.providerName}`,
                        })),
                      ]}
                    />
                    <p style={{ fontSize: 12, color: 'var(--mau-chu-mo)', marginBottom: 0 }}>
                      Model không hỗ trợ tool-call sẽ bị router tự động đổi sang model khác cùng tier.
                    </p>
                  </div>
                  <div>
                    <h3 className="card__tieu-de">Tier</h3>
                    <OChon
                      value={nhap.tier}
                      onChange={(giaTri) => {
                        const tier = MODEL_TIERS.find((item) => item === giaTri)
                        if (tier) capNhat(member.role, { tier })
                      }}
                      options={MODEL_TIERS.map((tier) => ({ value: tier, label: NHAN_TIER[tier] }))}
                    />
                    <p style={{ fontSize: 12, color: 'var(--mau-chu-mo)', marginBottom: 0 }}>
                      Tier quyết định model dự phòng khi agent không gán model cứng.
                    </p>
                  </div>
                </div>

                <div>
                  <h3 className="card__tieu-de">Kỹ năng ({soNguyen(soKyNang)})</h3>
                  <div className="hang">
                    {duLieu.availableSkills.map((kyNang) => {
                      const chon = nhap.skills.includes(kyNang.name)
                      return (
                        <Nut
                          key={kyNang.name}
                          nho
                          bien={chon ? 'chinh' : 'phu'}
                          onClick={() => doiKyNang(member.role, kyNang.name)}
                          title={kyNang.description}
                        >
                          {chon ? '✓ ' : '+ '}
                          {kyNang.name}
                        </Nut>
                      )
                    })}
                  </div>
                </div>

                <div>
                  <h3 className="card__tieu-de">Tool ({soNguyen(nhap.tools.length)})</h3>
                  <div className="hang">
                    {duLieu.availableTools.map((tool) => {
                      const chon = nhap.tools.includes(tool.name)
                      return (
                        <Nut
                          key={tool.name}
                          nho
                          bien={chon ? 'chinh' : 'phu'}
                          onClick={() => doiTool(member.role, tool.name)}
                          title={tool.description}
                        >
                          {chon ? '✓ ' : '+ '}
                          {tool.name}
                          {tool.requiresApproval ? ' · cần duyệt' : ''}
                        </Nut>
                      )
                    })}
                  </div>
                  <p style={{ fontSize: 12, color: 'var(--mau-chu-mo)' }}>
                    Các tool ghi ra kênh ngoài (đăng bài, gửi email, chạy quảng cáo) đều đánh dấu “cần duyệt”: agent chỉ
                    tạo bản nháp, con người duyệt ở màn “Công việc” rồi mới thực thi.
                  </p>
                </div>

                <div>
                  <h3 className="card__tieu-de">Ma trận phân quyền kiến thức</h3>
                  <table className="bang">
                    <thead>
                      <tr>
                        <th>Danh mục</th>
                        <th style={{ width: 90 }}>Đọc</th>
                        <th style={{ width: 90 }}>Ghi</th>
                      </tr>
                    </thead>
                    <tbody>
                      {nhap.knowledge.map((quyen) => (
                        <tr key={quyen.category}>
                          <td>
                            {nhanDanhMuc(quyen.category)} <span style={{ color: 'var(--mau-chu-mo)' }}>({quyen.category})</span>
                          </td>
                          <td>
                            <input
                              type="checkbox"
                              checked={quyen.canRead}
                              onChange={(event) =>
                                doiQuyen(member.role, quyen.category, 'canRead', event.target.checked)
                              }
                            />
                          </td>
                          <td>
                            <input
                              type="checkbox"
                              checked={quyen.canWrite}
                              onChange={(event) =>
                                doiQuyen(member.role, quyen.category, 'canWrite', event.target.checked)
                              }
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <p style={{ fontSize: 12, color: 'var(--mau-chu-mo)' }}>
                    Quyền đọc được lọc TRƯỚC khi xếp hạng tìm kiếm: agent thiếu quyền sẽ không nhận được mẩu kiến thức
                    nào từ danh mục đó.
                  </p>
                </div>
              </div>
            ) : null}
          </Card>
        )
      })}
    </Trang>
  )
}
