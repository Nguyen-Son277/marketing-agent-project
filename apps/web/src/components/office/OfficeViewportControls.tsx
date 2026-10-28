import { memo, type ReactNode } from 'react'
import { useI18n } from '../../lib/i18n.tsx'

interface OfficeViewportControlsProps {
  readonly zoom: number
  readonly onZoomIn: () => void
  readonly onZoomOut: () => void
  readonly onResetView: () => void
  readonly viewMode: 'campus' | 'floorplan'
  readonly onViewModeChange: (mode: 'campus' | 'floorplan') => void
  readonly filterStatus: string
  readonly onFilterChange: (status: string) => void
}

export const OfficeViewportControls = memo(function OfficeViewportControls({
  zoom,
  onZoomIn,
  onZoomOut,
  onResetView,
  viewMode,
  onViewModeChange,
  filterStatus,
  onFilterChange,
}: OfficeViewportControlsProps): ReactNode {
  const { t } = useI18n()

  return (
    <>
      {/* Chuyển đổi chế độ xem (3D Campus vs 2D Floor Plan) */}
      <div className="office-mode-switch">
        <button
          type="button"
          className={`office-mode-switch__btn ${viewMode === 'campus' ? 'office-mode-switch__btn--active' : ''}`}
          onClick={() => onViewModeChange('campus')}
          title={t('office.actions.campusView')}
        >
          🏰 {t('office.actions.campusView')}
        </button>
        <button
          type="button"
          className={`office-mode-switch__btn ${viewMode === 'floorplan' ? 'office-mode-switch__btn--active' : ''}`}
          onClick={() => onViewModeChange('floorplan')}
          title={t('office.actions.floorPlan')}
        >
          📐 {t('office.actions.floorPlan')}
        </button>

        {/* Lọc trạng thái */}
        <select
          value={filterStatus}
          onChange={(e) => onFilterChange(e.target.value)}
          style={{
            marginLeft: '6px',
            padding: '4px 8px',
            fontSize: '11px',
            fontWeight: 600,
            borderRadius: '8px',
            border: 'none',
            background: 'transparent',
            color: 'inherit',
            cursor: 'pointer',
          }}
        >
          <option value="all">{t('office.actions.filterAll')}</option>
          <option value="working">{t('office.actions.filterWorking')}</option>
        </select>
      </div>

      {/* Cụm nút Zoom In, Zoom Out, Reset Campus View */}
      <div className="office-controls">
        <button
          type="button"
          className="office-btn-icon"
          onClick={onZoomIn}
          title={t('office.actions.zoomIn')}
        >
          ＋
        </button>
        <button
          type="button"
          className="office-btn-icon"
          onClick={onZoomOut}
          title={t('office.actions.zoomOut')}
        >
          －
        </button>
        <button
          type="button"
          className="office-btn-icon"
          onClick={onResetView}
          title={`${t('office.actions.resetView')} (${Math.round(zoom * 100)}%)`}
        >
          ⟲
        </button>
      </div>
    </>
  )
})
