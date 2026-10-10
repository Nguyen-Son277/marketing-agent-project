/** Màn hình chọn hoặc tạo công ty khi người dùng chưa thuộc công ty nào. */
import { useState, type ReactNode } from 'react'
import { ApiError } from '../lib/api.ts'
import { useSession } from '../lib/session.tsx'
import { Card, Nut, ONhap, ThongBao, Trang, Truong } from '../components/ui.tsx'

export function ChonCongTyScreen(): ReactNode {
  const { companies, createCompany, systemProblem, signOut } = useSession()
  const [ten, setTen] = useState('')
  const [loi, setLoi] = useState<string | null>(null)
  const [dangTao, setDangTao] = useState(false)

  async function tao(): Promise<void> {
    if (ten.trim().length === 0) {
      setLoi('Cần nhập tên công ty.')
      return
    }
    setLoi(null)
    setDangTao(true)
    try {
      await createCompany(ten.trim())
    } catch (error) {
      setLoi(error instanceof ApiError ? error.message : 'Không tạo được công ty.')
    } finally {
      setDangTao(false)
    }
  }

  return (
    <div className="dang-nhap">
      <div style={{ width: '100%', maxWidth: 560 }}>
        <Trang>
          <h1 className="the__tieude">Chọn công ty</h1>
          <p className="the__mo-ta">
            Mỗi công ty là một vùng làm việc riêng: kho kiến thức, đội agent và lịch sử công việc độc lập.
          </p>

          {systemProblem ? (
            <div style={{ marginBottom: 16 }}>
              <ThongBao loai="canh-bao">
                Hệ thống chưa sẵn sàng: {systemProblem}
                <br />
                Quản trị viên cần chạy <code>pnpm db:seed</code> trên máy chủ.
              </ThongBao>
            </div>
          ) : null}

          {loi ? (
            <div style={{ marginBottom: 16 }}>
              <ThongBao loai="loi">{loi}</ThongBao>
            </div>
          ) : null}

          {companies.length > 0 ? (
            <Card tieuDe="Công ty của bạn">
              <div className="cot">
                {companies.map((company) => (
                  <div key={company.id} className="hang" style={{ justifyContent: 'space-between' }}>
                    <div>
                      <div style={{ fontWeight: 600 }}>{company.name}</div>
                      <div style={{ fontSize: 12, color: 'var(--mau-chu-mo)' }}>
                        {company.slug} · vai trò {company.role}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          ) : null}

          <Card tieuDe="Tạo công ty mới" phu="Đội 10 agent và kho kiến thức 6 danh mục sẽ được tạo kèm.">
            <Truong nhan="Tên công ty">
              <ONhap value={ten} onChange={setTen} placeholder="Công ty TNHH An Phát" autoFocus />
            </Truong>
            <div style={{ marginTop: 16 }}>
              <Nut onClick={() => void tao()} dangTai={dangTao} rong>
                Tạo công ty và bắt đầu
              </Nut>
            </div>
          </Card>

          <div style={{ marginTop: 16, textAlign: 'center' }}>
            <Nut bien="phu" nho onClick={() => void signOut()}>
              Đăng xuất
            </Nut>
          </div>
        </Trang>
      </div>
    </div>
  )
}
