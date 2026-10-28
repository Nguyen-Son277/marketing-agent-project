/**
 * Màn hình Văn phòng AI 3D Trực quan (AI Office Campus) - #/van-phong
 * Mô phỏng khuôn viên văn phòng isometric 3D phong cách pastel sống động.
 */
import { useState, useEffect, useCallback, useMemo, type ReactNode } from 'react'
import type { OfficeOverviewResponse, OfficeRoom, AgentOfficeState } from '@marketing-agent/shared'
import { api } from '../lib/api.ts'
import { useI18n } from '../lib/i18n.tsx'
import { useOfficeRealtime } from '../lib/useOfficeRealtime.ts'
import { OfficeCampusCanvas } from '../components/office/OfficeCampusCanvas.tsx'
import { OfficePersonnelDock } from '../components/office/OfficePersonnelDock.tsx'
import { OfficeTaskDispatchDrawer } from '../components/office/OfficeTaskDispatchDrawer.tsx'
import { OfficeAgentDeskModal } from '../components/office/OfficeAgentDeskModal.tsx'
import { OfficeViewportControls } from '../components/office/OfficeViewportControls.tsx'
import '../components/office/office.css'

interface VanPhongAIProps {
  readonly companyId: string
  readonly onNavigate?: (route: any) => void
}

export function VanPhongAI({ companyId }: VanPhongAIProps): ReactNode {
  const { t } = useI18n()

  const [data, setData] = useState<OfficeOverviewResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Viewport camera state
  const [zoom, setZoom] = useState(0.9)
  const [pan, setPan] = useState({ x: 0, y: -30 })
  const [viewMode, setViewMode] = useState<'campus' | 'floorplan'>('campus')
  const [filterStatus, setFilterStatus] = useState<string>('all')

  // Selected Agent & Modals
  const [selectedRole, setSelectedRole] = useState<string | null>(null)
  const [isDeskModalOpen, setIsDeskModalOpen] = useState(false)
  const [isDispatchDrawerOpen, setIsDispatchDrawerOpen] = useState(false)
  const [dispatchAssigneeRole, setDispatchAssigneeRole] = useState<string | null>(null)

  const loadOverview = useCallback(async () => {
    try {
      const res = await api.officeOverview(companyId)
      setData(res)
      setError(null)
    } catch (err: unknown) {
      console.error('Failed to load office overview:', err)
      setError(err instanceof Error ? err.message : 'Không thể tải dữ liệu văn phòng')
    } finally {
      setLoading(false)
    }
  }, [companyId])

  useEffect(() => {
    loadOverview()
  }, [loadOverview])

  // Real-time synchronization
  const { connectionStatus, manualRefresh } = useOfficeRealtime({
    companyId,
    onRefresh: loadOverview,
  })

  // Camera Pan and Zoom helpers
  const handleZoomIn = useCallback(() => {
    setZoom((z) => Math.min(Number((z + 0.15).toFixed(2)), 2.2))
  }, [])

  const handleZoomOut = useCallback(() => {
    setZoom((z) => Math.max(Number((z - 0.15).toFixed(2)), 0.45))
  }, [])

  const handleResetView = useCallback(() => {
    setZoom(0.9)
    setPan({ x: 0, y: -30 })
  }, [])

  // Danh sách phòng ban an toàn, hỗ trợ cả data.campus.rooms và data.rooms
  const allRooms = useMemo<readonly OfficeRoom[]>(() => {
    if (!data) return []
    return data.campus?.rooms ?? (data as { rooms?: readonly OfficeRoom[] }).rooms ?? []
  }, [data])

  // Khi chọn Agent từ Dock Bar: Tự động di chuyển camera đến phòng của Agent
  const handleSelectAgentFromDock = useCallback((role: string) => {
    setSelectedRole(role)
    const room = allRooms.find((r) => r.role === role)
    if (room) {
      // Tính toán pan để đưa phòng về trung tâm màn hình
      const centerX = 650
      const centerY = 550
      const roomCenterX = room.gridX + room.width / 2
      const roomCenterY = room.gridY + room.height / 2
      setPan({
        x: Math.round(centerX - roomCenterX),
        y: Math.round(centerY - roomCenterY),
      })
      setZoom(1.1)
    }
    setIsDeskModalOpen(true)
  }, [allRooms])

  const handleSelectRoomFromCanvas = useCallback((role: string) => {
    setSelectedRole(role)
    setIsDeskModalOpen(true)
  }, [])

  const handleOpenDispatch = useCallback((role?: string) => {
    setDispatchAssigneeRole(role || selectedRole || null)
    setIsDispatchDrawerOpen(true)
  }, [selectedRole])

  // Lọc agents theo bộ lọc
  const filteredAgents = useMemo(() => {
    if (!data?.agents) return []
    if (filterStatus === 'working') {
      return data.agents.filter((a) => a.status === 'working')
    }
    return data.agents
  }, [data, filterStatus])

  const filteredRooms = useMemo<readonly OfficeRoom[]>(() => {
    if (!allRooms.length) return []
    if (filterStatus === 'working') {
      const workingRoles = new Set(filteredAgents.map((a) => a.role))
      return allRooms.filter((r) => workingRoles.has(r.role))
    }
    return allRooms
  }, [allRooms, filterStatus, filteredAgents])


  if (loading && !data) {
    return (
      <div className="office-campus" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ textAlign: 'center', color: '#64748B' }}>
          <div style={{ fontSize: '36px', marginBottom: '12px' }}>🏢</div>
          <div style={{ fontWeight: 600 }}>{t('common.loadingData')}</div>
        </div>
      </div>
    )
  }

  if (error && !data) {
    return (
      <div className="office-campus" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ textAlign: 'center', color: '#DC2626' }}>
          <div style={{ fontSize: '36px', marginBottom: '12px' }}>⚠️</div>
          <div style={{ fontWeight: 600 }}>{error}</div>
          <button
            type="button"
            onClick={loadOverview}
            style={{
              marginTop: '16px',
              padding: '8px 18px',
              borderRadius: '8px',
              border: 'none',
              background: '#2563EB',
              color: '#FFF',
              cursor: 'pointer',
            }}
          >
            {t('common.retry')}
          </button>
        </div>
      </div>
    )
  }

  const stats = data?.stats ?? {
    totalAgents: 10,
    activeAgents: 10,
    workingAgents: 0,
    tasksToday: 0,
    totalCostTodayUsd: 0,
  }

  return (
    <div className="office-campus">
      {/* Top Header Floating Card */}
      <div className="office-header">
        <div className="office-title-card">
          <div className="office-title-card__icon">🏢</div>
          <div>
            <h1 className="office-title-card__title">
              <span>{t('office.title')}</span>
              <span className={`office-connection-pill ${connectionStatus === 'reconnecting' ? 'office-connection-pill--reconnecting' : ''}`}>
                <span className="office-connection-pill__dot" />
                <span>
                  {connectionStatus === 'connected'
                    ? t('office.stats.connected')
                    : connectionStatus === 'reconnecting'
                    ? t('office.stats.reconnecting')
                    : 'Live'}
                </span>
              </span>
            </h1>
            <p className="office-title-card__subtitle">{t('office.subtitle')}</p>
          </div>
        </div>

        {/* Live Metrics Bar */}
        <div className="office-stats-bar">
          <div className="office-stat-item">
            <span>👥</span>
            <span>{t('office.stats.totalAgents')}:</span>
            <span className="office-stat-item__val">{stats.totalAgents ?? 10}</span>
          </div>
          <div className="office-stat-item">
            <span>⚡</span>
            <span>{t('office.stats.working')}:</span>
            <span className="office-stat-item__val" style={{ color: '#F59E0B' }}>
              {(stats as any).workingAgents ?? (stats as any).busyAgents ?? 0}
            </span>
          </div>
          <div className="office-stat-item">
            <span>📋</span>
            <span>{t('office.stats.tasksToday')}:</span>
            <span className="office-stat-item__val">
              {(stats as any).tasksToday ?? (stats as any).tasksCompletedToday ?? 0}
            </span>
          </div>
          <div className="office-stat-item">
            <span>💰</span>
            <span>{t('office.stats.costToday')}:</span>
            <span className="office-stat-item__val" style={{ color: '#16A34A' }}>
              ${Number((stats as any).totalCostTodayUsd ?? (stats as any).costUsdToday ?? 0).toFixed(4)}
            </span>
          </div>
        </div>
      </div>

      {/* Viewport Camera & Mode Controls */}
      <OfficeViewportControls
        zoom={zoom}
        onZoomIn={handleZoomIn}
        onZoomOut={handleZoomOut}
        onResetView={handleResetView}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        filterStatus={filterStatus}
        onFilterChange={setFilterStatus}
      />

      {/* 3D Isometric Campus Canvas */}
      <OfficeCampusCanvas
        rooms={filteredRooms}
        agents={data?.agents ?? []}
        selectedRole={selectedRole}
        onSelectRoom={handleSelectRoomFromCanvas}
        zoom={zoom}
        pan={pan}
        viewMode={viewMode}
        onPanChange={setPan}
        onZoomChange={setZoom}
      />

      {/* Bottom Personnel Dock Bar */}
      <OfficePersonnelDock
        agents={data?.agents ?? []}
        activeAgentRole={selectedRole}
        onSelectAgent={handleSelectAgentFromDock}
        onOpenDispatch={() => handleOpenDispatch()}
      />

      {/* Slide-over Task Dispatch Drawer */}
      <OfficeTaskDispatchDrawer
        isOpen={isDispatchDrawerOpen}
        onClose={() => setIsDispatchDrawerOpen(false)}
        companyId={companyId}
        agents={data?.agents ?? []}
        initialAssigneeRole={dispatchAssigneeRole}
        onTaskDispatched={() => {
          manualRefresh()
          loadOverview()
        }}
      />

      {/* Modal chi tiết bàn làm việc của Agent */}
      <OfficeAgentDeskModal
        isOpen={isDeskModalOpen}
        onClose={() => setIsDeskModalOpen(false)}
        companyId={companyId}
        role={selectedRole}
        onOpenDispatchWithRole={(role) => handleOpenDispatch(role)}
      />
    </div>
  )
}
