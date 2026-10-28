import { memo, type ReactNode } from 'react'
import type { AgentOfficeState } from '@marketing-agent/shared'
import { OfficeEmployee } from './OfficeEmployee.tsx'

interface OfficeWorkstationProps {
  readonly agent: AgentOfficeState
  readonly roomColor: string
  readonly onSelect?: () => void
}

export const OfficeWorkstation = memo(function OfficeWorkstation({
  agent,
  roomColor,
  onSelect,
}: OfficeWorkstationProps): ReactNode {
  const isWorking = agent.status === 'working'
  const isBlocked = agent.status === 'blocked'
  const isOffline = agent.status === 'offline'

  // Màn hình hiển thị màu theo vai trò hoặc trạng thái
  const screenGlowColor = isBlocked
    ? '#EF4444'
    : isWorking
    ? '#F59E0B'
    : isOffline
    ? '#334155'
    : roomColor

  return (
    <div
      className={`office-workstation office-workstation--${agent.status}`}
      onClick={(e) => {
        e.stopPropagation()
        onSelect?.()
      }}
    >
      {/* 1. LỚP ĐÁY: Bóng đổ bàn ghế trên sàn */}
      <div className="office-workstation__shadow" />

      {/* 2. LỚP GHẾ VÀ NHÂN VIÊN NGỒI LÀM VIỆC (Seated Behind Desk) */}
      <div className="office-workstation__employee-area">
        <OfficeEmployee
          agent={agent}
          roomColor={roomColor}
          isWorking={isWorking}
          isBlocked={isBlocked}
          isOffline={isOffline}
          onInteract={onSelect}
        />
      </div>

      {/* 3. LỚP BÀN LÀM VIỆC 3D ISOMETRIC (Isometric Desk Structure) */}
      <div className="office-desk-3d">
        {/* Mặt bàn gỗ sồi dày dặn với cạnh viền vát 3D */}
        <div className="office-desk-3d__top" style={{ '--top-accent': roomColor } as Record<string, string>}>
          <div className="office-desk-3d__top-surface">
            {/* Lót chuột cỡ lớn (Desk Mat) */}
            <div className="office-desk-3d__mat" />

            {/* Bàn phím cơ & Chuột quang */}
            <div className="office-desk-3d__keyboard">
              <div className="office-desk-3d__keys" />
            </div>
            <div className="office-desk-3d__mouse" />

            {/* Cốc cafe công sở bốc khói nhẹ khi đang làm việc */}
            <div className="office-desk-3d__coffee" title="Cốc cafe tiếp năng lượng">
              <div className="office-desk-3d__coffee-cup" />
              {isWorking && <div className="office-desk-3d__coffee-steam" />}
            </div>

            {/* Chậu cây sen đá mini để bàn */}
            <div className="office-desk-3d__plant" title="Cây xanh thanh lọc không khí">
              <div className="office-desk-3d__plant-pot" />
              <div className="office-desk-3d__plant-leaves">🌱</div>
            </div>

            {/* Đèn bàn làm việc LED phát sáng */}
            <div className="office-desk-3d__lamp" title="Đèn bàn làm việc">
              <div className="office-desk-3d__lamp-head" style={{ backgroundColor: screenGlowColor }} />
              <div className="office-desk-3d__lamp-arm" />
            </div>

            {/* Cụm Màn hình Máy tính Kép (Dual Monitors Setup) */}
            <div className="office-desk-3d__monitors">
              {/* Màn hình chính (Landscape Display) */}
              <div
                className={`office-screen office-screen--main ${isWorking ? 'office-screen--active' : ''}`}
                style={{ '--screen-glow': screenGlowColor } as Record<string, string>}
              >
                <div className="office-screen__bezel">
                  <div className="office-screen__display">
                    {/* Đường dữ liệu / code / biểu đồ mô phỏng trên màn hình */}
                    <div className="office-screen__line office-screen__line--1" />
                    <div className="office-screen__line office-screen__line--2" />
                    <div className="office-screen__line office-screen__line--3" />
                  </div>
                </div>
                <div className="office-screen__stand" />
              </div>

              {/* Màn hình phụ (Vertical/Secondary Display) */}
              <div
                className={`office-screen office-screen--sub ${isWorking ? 'office-screen--active' : ''}`}
                style={{ '--screen-glow': screenGlowColor } as Record<string, string>}
              >
                <div className="office-screen__bezel">
                  <div className="office-screen__display">
                    <div className="office-screen__chart-bar office-screen__chart-bar--1" />
                    <div className="office-screen__chart-bar office-screen__chart-bar--2" />
                  </div>
                </div>
                <div className="office-screen__stand" />
              </div>
            </div>
          </div>

          {/* Cạnh viền trước và cạnh bên tạo độ dày 3D cho bàn */}
          <div className="office-desk-3d__front-edge" />
          <div className="office-desk-3d__side-edge" />
        </div>

        {/* Chân bàn kim loại và hộc tủ ngăn kéo */}
        <div className="office-desk-3d__legs">
          <div className="office-desk-3d__leg office-desk-3d__leg--front-left" />
          <div className="office-desk-3d__leg office-desk-3d__leg--front-right" />
          <div className="office-desk-3d__leg office-desk-3d__leg--back-left" />
          <div className="office-desk-3d__cabinet">
            <div className="office-desk-3d__drawer office-desk-3d__drawer--top" />
            <div className="office-desk-3d__drawer office-desk-3d__drawer--bottom" />
          </div>
        </div>
      </div>
    </div>
  )
})
