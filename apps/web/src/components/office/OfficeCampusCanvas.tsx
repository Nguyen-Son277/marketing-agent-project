import { useState, useRef, useCallback, memo, type ReactNode } from 'react'
import type { OfficeRoom, AgentOfficeState } from '@marketing-agent/shared'
import { useI18n } from '../../lib/i18n.tsx'
import { ROLE_ICONS } from './OfficeAgentAvatar.tsx'
import { OfficeWorkstation } from './OfficeWorkstation.tsx'
import { OfficeRoomDecor, OfficePlazaDecor } from './OfficeRoomDecor.tsx'


interface OfficeCampusCanvasProps {
  readonly rooms: readonly OfficeRoom[]
  readonly agents: readonly AgentOfficeState[]
  readonly selectedRole: string | null
  readonly onSelectRoom: (role: string) => void
  readonly zoom: number
  readonly pan: { readonly x: number; readonly y: number }
  readonly viewMode: 'campus' | 'floorplan'
  readonly onPanChange: (pan: { x: number; y: number }) => void
  readonly onZoomChange: (zoom: number) => void
}

export const OfficeCampusCanvas = memo(function OfficeCampusCanvas({
  rooms,
  agents,
  selectedRole,
  onSelectRoom,
  zoom,
  pan,
  viewMode,
  onPanChange,
  onZoomChange,
}: OfficeCampusCanvasProps): ReactNode {
  const { locale } = useI18n()
  const viewportRef = useRef<HTMLDivElement>(null)

  const isDraggingRef = useRef(false)
  const dragStartRef = useRef({ x: 0, y: 0 })

  // Map agent by role for O(1) lookup
  const agentByRole = new Map(agents.map((a) => [a.role, a]))

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    // Only drag with left click and not on interactive buttons
    if (e.button !== 0) return
    isDraggingRef.current = true
    dragStartRef.current = { x: e.clientX - pan.x, y: e.clientY - pan.y }
  }, [pan])

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isDraggingRef.current) return
    onPanChange({
      x: e.clientX - dragStartRef.current.x,
      y: e.clientY - dragStartRef.current.y,
    })
  }, [onPanChange])

  const handleMouseUp = useCallback(() => {
    isDraggingRef.current = false
  }, [])

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault()
    const delta = e.deltaY > 0 ? -0.08 : 0.08
    const nextZoom = Math.min(Math.max(zoom + delta, 0.4), 2.2)
    onZoomChange(Number(nextZoom.toFixed(2)))
  }, [zoom, onZoomChange])

  const isIsometric = viewMode === 'campus'

  return (
    <div
      ref={viewportRef}
      className="office-viewport"
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      onWheel={handleWheel}
    >
      <div
        className="office-stage"
        style={{
          transform: `translate(-50%, -50%) translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
        }}
      >
        <div
          className="office-isometric-plane"
          style={{
            transform: isIsometric
              ? 'rotateX(55deg) rotateZ(-40deg)'
              : 'rotateX(0deg) rotateZ(0deg)',
            transition: 'transform 0.4s cubic-bezier(0.16, 1, 0.3, 1)',
          }}
        >
          {/* Sàn khuôn viên văn phòng (Floor Tiles Base) */}
          <div className="office-floor" />

          {/* Hành lang đi lại kết nối các phòng (Walkways) */}
          <div className="office-walkway" style={{ top: '300px', left: '100px', width: '1100px', height: '40px' }} />
          <div className="office-walkway" style={{ top: '540px', left: '100px', width: '1100px', height: '40px' }} />
          <div className="office-walkway" style={{ top: '780px', left: '100px', width: '1100px', height: '40px' }} />
          <div className="office-walkway" style={{ top: '100px', left: '620px', width: '40px', height: '900px' }} />

          {/* Quảng trường trung tâm (Central Plaza & Coffee Break Lounge) */}
          <div className="office-central-plaza">
            <span className="office-central-plaza__label">
              ☕ {locale === 'en' ? 'Central Plaza & Barista Coffee Lounge' : 'Quảng trường & Cafe Văn phòng'}
            </span>
            <OfficePlazaDecor />
          </div>

          {/* Render 10 Phòng ban & Vị trí làm việc của Agent */}
          {rooms.map((room) => {
            const agent = agentByRole.get(room.role)
            const isSelected = selectedRole === room.role
            const isWorking = agent?.status === 'working'
            const roomName = locale === 'en' ? room.nameEn : room.nameVi
            const roomDesc = locale === 'en' ? room.descriptionEn : room.descriptionVi

            const icon = ROLE_ICONS[room.role] ?? '🏢'

            return (
              <div
                key={room.id}
                className={`office-room ${isSelected ? 'office-room--active' : ''} ${isWorking ? 'office-room--working' : ''}`}
                style={{
                  top: `${room.gridY}px`,
                  left: `${room.gridX}px`,
                  width: `${room.width}px`,
                  height: `${room.height}px`,
                  '--room-color': room.themeColor,
                } as Record<string, string>}
                onClick={() => onSelectRoom(room.role)}
                title={`${roomName} - ${roomDesc}`}
              >
                {/* Tiêu đề phòng ban & Trạng thái */}
                <div className="office-room__header">
                  <div className="office-room__title-wrap">
                    <div className="office-room__icon">{icon}</div>
                    <span className="office-room__title">{roomName}</span>
                  </div>

                  {agent && (
                    <span className={`office-status-badge office-status-badge--${agent.status}`}>
                      {agent.status}
                    </span>
                  )}
                </div>

                {/* Nội thất 3D & Bàn ghế làm việc của Agent */}
                <div className="office-room__interior">
                  {/* Đồ trang trí đặc thù của phòng ban */}
                  <OfficeRoomDecor role={room.role} themeColor={room.themeColor} />

                  {/* Bàn làm việc 3D, ghế công thái học & Nhân viên AI */}
                  {agent && (
                    <OfficeWorkstation
                      agent={agent}
                      roomColor={room.themeColor}
                      onSelect={() => onSelectRoom(room.role)}
                    />
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
})
