import { memo, type ReactNode } from 'react'

interface OfficeRoomDecorProps {
  readonly role: string
  readonly themeColor: string
}

export const OfficeRoomDecor = memo(function OfficeRoomDecor({
  role,
  themeColor,
}: OfficeRoomDecorProps): ReactNode {
  switch (role) {
    case 'marketing-leader':
      return (
        <div className="office-decor office-decor--leader" title="Bảng chiến lược & Lãnh đạo">
          {/* Bảng trắng chiến lược với sơ đồ quy trình */}
          <div className="office-decor__whiteboard">
            <div className="office-decor__whiteboard-frame">
              <div className="office-decor__sticky office-decor__sticky--yellow" />
              <div className="office-decor__sticky office-decor__sticky--pink" />
              <div className="office-decor__diagram-line" />
            </div>
            <div className="office-decor__whiteboard-stand" />
          </div>
          {/* Tủ sách tài liệu doanh nghiệp */}
          <div className="office-decor__bookshelf">
            <div className="office-decor__book office-decor__book--1" />
            <div className="office-decor__book office-decor__book--2" />
            <div className="office-decor__book office-decor__book--3" />
          </div>
        </div>
      )

    case 'market-research':
      return (
        <div className="office-decor office-decor--research" title="Hồ sơ phân tích thị trường & đối thủ">
          <div className="office-decor__chart-stand">
            <div className="office-decor__radar-screen">
              <div className="office-decor__radar-sweep" />
            </div>
          </div>
          <div className="office-decor__filing-cabinet" title="Tủ hồ sơ đối thủ">
            <div className="office-decor__cabinet-drawer" />
            <div className="office-decor__cabinet-drawer" />
          </div>
        </div>
      )

    case 'content-writer':
      return (
        <div className="office-decor office-decor--content" title="Bảng ghim ý tưởng & Kịch bản">
          <div className="office-decor__corkboard">
            <div className="office-decor__note office-decor__note--1" />
            <div className="office-decor__note office-decor__note--2" />
            <div className="office-decor__note office-decor__note--3" />
          </div>
          <div className="office-decor__paper-stack" title="Tập bản thảo bài viết" />
        </div>
      )

    case 'seo-technical':
      return (
        <div className="office-decor office-decor--seo" title="Tháp máy chủ & Bot thu thập dữ liệu">
          {/* Tháp Server Rack mini có đèn nhấp nháy */}
          <div className="office-decor__server-rack">
            <div className="office-decor__server-unit">
              <span className="office-decor__server-led office-decor__server-led--green" />
              <span className="office-decor__server-led office-decor__server-led--cyan" />
            </div>
            <div className="office-decor__server-unit">
              <span className="office-decor__server-led office-decor__server-led--green" />
              <span className="office-decor__server-led office-decor__server-led--blink" />
            </div>
            <div className="office-decor__server-unit">
              <span className="office-decor__server-led office-decor__server-led--green" />
            </div>
          </div>
          <div className="office-decor__spider-badge" title="Crawler spider">🕷️</div>
        </div>
      )

    case 'web-technical':
      return (
        <div className="office-decor office-decor--web-tech" title="Trạm điều khiển Server & Web Terminal">
          <div className="office-decor__server-rack">
            <div className="office-decor__server-unit">
              <span className="office-decor__server-led office-decor__server-led--cyan" />
              <span className="office-decor__server-led office-decor__server-led--blink" />
            </div>
            <div className="office-decor__server-unit">
              <span className="office-decor__server-led office-decor__server-led--green" />
              <span className="office-decor__server-led office-decor__server-led--cyan" />
            </div>
          </div>
          <div className="office-decor__spider-badge" title="Web Terminal">💻</div>
        </div>
      )

    case 'social-media':
      return (
        <div className="office-decor office-decor--social" title="Đèn Ring Light & Studio Livestream">
          {/* Đèn Ring Light phát sáng trên tripod */}
          <div className="office-decor__ring-light">
            <div className="office-decor__ring-circle" />
            <div className="office-decor__ring-tripod" />
          </div>
          <div className="office-decor__social-board" title="Kênh tương tác">
            <span className="office-decor__social-pill">❤️ 99+</span>
          </div>
        </div>
      )

    case 'paid-media':
      return (
        <div className="office-decor office-decor--ads" title="Màn hình theo dõi ROAS & Ngân sách">
          <div className="office-decor__roas-screen">
            <div className="office-decor__trendline" />
            <div className="office-decor__roas-value">ROAS 4.8x</div>
          </div>
        </div>
      )

    case 'email-crm':
      return (
        <div className="office-decor office-decor--crm" title="Hộp thư & Luồng tự động hóa">
          <div className="office-decor__mailbox">
            <div className="office-decor__mailbox-flag" />
            <div className="office-decor__letter-badge">✉️</div>
          </div>
          <div className="office-decor__flow-board" />
        </div>
      )

    case 'design-video':
      return (
        <div className="office-decor office-decor--design" title="Bảng vẽ Wacom & Bảng màu sắc">
          <div className="office-decor__drawing-tablet">
            <div className="office-decor__tablet-screen" />
            <div className="office-decor__stylus" />
          </div>
          <div className="office-decor__color-wheel" title="Bánh xe màu sắc" />
        </div>
      )

    case 'analytics':
      return (
        <div className="office-decor office-decor--analytics" title="Biểu đồ phân tích dữ liệu 3D">
          <div className="office-decor__data-tower">
            <div className="office-decor__bar-chart">
              <div className="office-decor__bar office-decor__bar--1" />
              <div className="office-decor__bar office-decor__bar--2" />
              <div className="office-decor__bar office-decor__bar--3" />
            </div>
          </div>
        </div>
      )

    case 'community-care':
      return (
        <div className="office-decor office-decor--care" title="Chăm sóc & Phản hồi khách hàng">
          <div className="office-decor__rating-board">
            <div className="office-decor__star-row">⭐⭐⭐⭐⭐</div>
            <div className="office-decor__satisfaction">99.8%</div>
          </div>
        </div>
      )

    default:
      return null
  }
})

/** Khuôn viên Quảng trường Trung tâm & Quán Cafe Văn phòng */
export const OfficePlazaDecor = memo(function OfficePlazaDecor(): ReactNode {
  return (
    <div className="office-plaza-scene">
      {/* Quầy pha chế cà phê Barista */}
      <div className="office-plaza__coffee-bar">
        <div className="office-plaza__counter">
          {/* Máy pha cà phê Espresso chuyên nghiệp inox sáng bóng */}
          <div className="office-plaza__espresso-machine" title="Máy pha cà phê Ý tự động">
            <div className="office-plaza__espresso-group" />
            <div className="office-plaza__espresso-steam" />
          </div>
          {/* Cốc takeaway & menu */}
          <div className="office-plaza__cups-stack">☕☕</div>
        </div>
        <div className="office-plaza__menu-board" title="Menu đồ uống">
          <span>COFFEE BAR</span>
        </div>
      </div>

      {/* Bàn cafe tròn gỗ và 2 ghế quầy bar */}
      <div className="office-plaza__cafe-seating">
        <div className="office-plaza__cafe-table" />
        <div className="office-plaza__stool office-plaza__stool--left" />
        <div className="office-plaza__stool office-plaza__stool--right" />
      </div>

      {/* Ghế sofa dài thư giãn & Cây xanh kiểng */}
      <div className="office-plaza__lounge">
        <div className="office-plaza__sofa" title="Khu vực thư giãn & Brainstorm">
          <div className="office-plaza__cushion" />
        </div>
        <div className="office-plaza__palm-tree" title="Cây cau kiểng thanh lọc">
          <div className="office-plaza__palm-pot" />
          <div className="office-plaza__palm-leaves">🌿</div>
        </div>
      </div>
    </div>
  )
})
