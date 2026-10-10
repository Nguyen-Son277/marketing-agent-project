/** Màn hình đăng nhập và đăng ký. */
import { useState, type ReactNode } from 'react'
import { api, ApiError } from '../lib/api.ts'
import { useSession } from '../lib/session.tsx'
import { Nut, ONhap, ThongBao, Truong } from '../components/ui.tsx'

export function DangNhapScreen(): ReactNode {
  const { signIn } = useSession()
  const [cheDo, setCheDo] = useState<'dang-nhap' | 'dang-ky'>('dang-nhap')
  const [email, setEmail] = useState('')
  const [matKhau, setMatKhau] = useState('')
  const [ten, setTen] = useState('')
  const [loi, setLoi] = useState<string | null>(null)
  const [dangGui, setDangGui] = useState(false)

  async function gui(): Promise<void> {
    setLoi(null)
    if (email.trim().length === 0 || matKhau.length === 0) {
      setLoi('Cần nhập email và mật khẩu.')
      return
    }
    if (cheDo === 'dang-ky' && matKhau.length < 10) {
      setLoi('Mật khẩu cần ít nhất 10 ký tự.')
      return
    }
    setDangGui(true)
    try {
      const ketQua =
        cheDo === 'dang-ky'
          ? await api.register({ email: email.trim(), password: matKhau, name: ten.trim() || email.split('@')[0] || 'Người dùng' })
          : await api.login({ email: email.trim(), password: matKhau })
      signIn(ketQua.user, ketQua.companies)
    } catch (error) {
      setLoi(error instanceof ApiError ? error.message : 'Không kết nối được máy chủ.')
    } finally {
      setDangGui(false)
    }
  }

  return (
    <div className="dang-nhap">
      <div className="dang-nhap__hop">
        <h1 className="dang-nhap__tieude">Đội Agent Marketing</h1>
        <p className="dang-nhap__phu">
          Mỗi công ty có một vùng làm việc riêng, một kho kiến thức và một đội agent do Leader điều phối.
        </p>

        {loi ? (
          <div style={{ marginBottom: 16 }}>
            <ThongBao loai="loi">{loi}</ThongBao>
          </div>
        ) : null}

        {cheDo === 'dang-ky' ? (
          <Truong nhan="Tên hiển thị">
            <ONhap value={ten} onChange={setTen} placeholder="Nguyễn Văn A" />
          </Truong>
        ) : null}

        <Truong nhan="Email">
          <ONhap value={email} onChange={setEmail} type="email" placeholder="ban@congty.vn" autoFocus />
        </Truong>

        <Truong nhan="Mật khẩu" goiY={cheDo === 'dang-ky' ? 'Tối thiểu 10 ký tự.' : undefined}>
          <ONhap value={matKhau} onChange={setMatKhau} type="password" placeholder="••••••••" />
        </Truong>

        <div style={{ marginTop: 20 }}>
          <Nut onClick={() => void gui()} dangTai={dangGui} rong>
            {cheDo === 'dang-ky' ? 'Tạo tài khoản' : 'Đăng nhập'}
          </Nut>
        </div>

        <div style={{ marginTop: 14, textAlign: 'center', fontSize: 14 }}>
          {cheDo === 'dang-nhap' ? (
            <>
              Chưa có tài khoản?{' '}
              <button
                type="button"
                onClick={() => {
                  setCheDo('dang-ky')
                  setLoi(null)
                }}
                style={{ border: 0, background: 'none', color: 'var(--mau-chinh)', cursor: 'pointer', font: 'inherit', fontWeight: 600 }}
              >
                Đăng ký
              </button>
            </>
          ) : (
            <>
              Đã có tài khoản?{' '}
              <button
                type="button"
                onClick={() => {
                  setCheDo('dang-nhap')
                  setLoi(null)
                }}
                style={{ border: 0, background: 'none', color: 'var(--mau-chinh)', cursor: 'pointer', font: 'inherit', fontWeight: 600 }}
              >
                Đăng nhập
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
