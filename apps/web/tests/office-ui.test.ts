import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { OFFICE_ROOMS, AGENT_ROLES } from '@marketing-agent/shared'
import { vi } from '@marketing-agent/i18n'
import { en } from '@marketing-agent/i18n'

const read = (path: string): string => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')
const shell = read('../src/Shell.tsx')
const officeScreen = read('../src/screens/VanPhongAI.tsx')
const officeCss = read('../src/components/office/office.css')
const apiCode = read('../src/lib/api.ts')

describe('Kiểm thử giao diện Văn phòng AI 3D (#/van-phong)', () => {
  it('đăng ký đúng route van-phong trong Shell và liên kết màn hình VanPhongAI', () => {
    expect(shell).toContain("id: 'van-phong'")
    expect(shell).toContain("nhan: 'nav.office'")
    expect(shell).toContain("bieuTuong: '🏢'")
    expect(shell).toContain("case 'van-phong':")
    expect(shell).toContain("<VanPhongAI")
  })

  it('định nghĩa đầy đủ 11 phòng ban tương ứng 11 vai trò Agent trong dự án', () => {
    expect(OFFICE_ROOMS).toHaveLength(11)
    const roomRoles = OFFICE_ROOMS.map((r) => r.role)
    for (const role of AGENT_ROLES) {
      expect(roomRoles).toContain(role)
    }

    // Kiểm tra các thuộc tính isometric grid
    for (const room of OFFICE_ROOMS) {
      expect(room.id).toBeTruthy()
      expect(room.nameVi).toBeTruthy()
      expect(room.nameEn).toBeTruthy()
      expect(room.themeColor).toMatch(/^#[0-9A-Fa-f]{6}$/)
      expect(room.gridX).toBeGreaterThanOrEqual(0)
      expect(room.gridY).toBeGreaterThanOrEqual(0)
      expect(room.width).toBeGreaterThan(0)
      expect(room.height).toBeGreaterThan(0)
    }
  })

  it('chứa các lớp CSS isometric 3D pastel và hỗ trợ Dark/Light mode', () => {
    expect(officeCss).toContain('.office-campus')
    expect(officeCss).toContain('.office-stage')
    expect(officeCss).toContain('.office-isometric-plane')
    expect(officeCss).toContain('rotateX(55deg) rotateZ(-40deg)')
    expect(officeCss).toContain('.office-floor')
    expect(officeCss).toContain('.office-room')
    expect(officeCss).toContain('.office-desk')
    expect(officeCss).toContain('.office-avatar-figure')
    expect(officeCss).toContain('.office-thinking-bubble')
    expect(officeCss).toContain('.office-dock-wrap')
    expect(officeCss).toContain('.office-drawer')
    expect(officeCss).toContain('.office-modal')
    expect(officeCss).toContain('.office-workstation')
    expect(officeCss).toContain('.office-desk-3d')
    expect(officeCss).toContain('.office-chair')
    expect(officeCss).toContain('.office-employee')
    expect(officeCss).toContain('.office-employee__avatar')
    expect(officeCss).toContain('.office-employee__arms--typing')
    expect(officeCss).toContain('.office-plaza-scene')
    expect(officeCss).toContain("[data-theme='dark'] .office-campus")
    expect(officeCss).toContain("[data-theme='dark'] .office-floor")
  })

  it('cung cấp đầy đủ bản dịch song ngữ VI & EN cho toàn bộ khoá văn phòng', () => {
    expect(vi['nav.office']).toBe('Văn phòng AI')
    expect(en['nav.office']).toBe('AI Office')
    expect(vi['office.title']).toBe('Khuôn viên Văn phòng AI 3D')
    expect(en['office.title']).toBe('3D AI Office Campus')
    expect(vi['office.actions.dispatch']).toBeTruthy()
    expect(en['office.actions.dispatch']).toBeTruthy()
    expect(vi['office.status.working']).toBe('Đang làm việc')
    expect(en['office.status.working']).toBe('Working')
  })

  it('API client cung cấp đầy đủ các phương thức gọi văn phòng', () => {
    expect(apiCode).toContain('officeOverview(')
    expect(apiCode).toContain('officeDesk(')
    expect(apiCode).toContain('officeTasks(')
    expect(apiCode).toContain('officeDispatch(')
    expect(apiCode).toContain('officePing(')
  })

  it('màn hình VanPhongAI tích hợp thời gian thực, điều khiển góc nhìn và các modal', () => {
    expect(officeScreen).toContain('useOfficeRealtime')
    expect(officeScreen).toContain('OfficeCampusCanvas')
    expect(officeScreen).toContain('OfficePersonnelDock')
    expect(officeScreen).toContain('OfficeTaskDispatchDrawer')
    expect(officeScreen).toContain('OfficeAgentDeskModal')
    expect(officeScreen).toContain('OfficeViewportControls')
    // Kiểm tra defensive fallback phòng tránh crash khi data.campus không có
    expect(officeScreen).toContain('data.campus?.rooms ?? (data as { rooms?: readonly OfficeRoom[] }).rooms ?? []')
  })
})
