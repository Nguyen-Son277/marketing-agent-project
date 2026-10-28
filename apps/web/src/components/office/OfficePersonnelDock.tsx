import { memo, type ReactNode } from 'react'
import type { AgentOfficeState } from '@marketing-agent/shared'
import { useI18n } from '../../lib/i18n.tsx'
import { ROLE_ICONS } from './OfficeAgentAvatar.tsx'

interface OfficePersonnelDockProps {
  readonly agents: readonly AgentOfficeState[]
  readonly activeAgentRole: string | null
  readonly onSelectAgent: (role: string) => void
  readonly onOpenDispatch: () => void
}

const STATUS_COLORS: Record<string, string> = {
  idle: '#22C55E',
  working: '#F59E0B',
  reviewing: '#A855F7',
  blocked: '#EF4444',
  done: '#3B82F6',
  offline: '#94A3B8',
}

export const OfficePersonnelDock = memo(function OfficePersonnelDock({
  agents,
  activeAgentRole,
  onSelectAgent,
  onOpenDispatch,
}: OfficePersonnelDockProps): ReactNode {
  const { t } = useI18n()

  return (
    <div className="office-dock-wrap" role="toolbar" aria-label="Thanh nhân sự AI">
      {agents.map((agent) => {
        const isActive = activeAgentRole === agent.role
        const dotColor = STATUS_COLORS[agent.status] ?? '#94A3B8'
        const icon = ROLE_ICONS[agent.role] ?? '🤖'

        return (
          <button
            key={agent.agentDefId || agent.role}
            type="button"
            className={`office-dock-item ${isActive ? 'office-dock-item--active' : ''}`}
            onClick={() => onSelectAgent(agent.role)}
            title={`${agent.displayName} (${agent.name}) - ${t(`office.status.${agent.status}` as never)}`}
          >
            <div className="office-dock-avatar" style={{ '--item-color': dotColor } as Record<string, string>}>
              <span>{icon}</span>
              <span
                className="office-dock-status-dot"
                style={{ backgroundColor: dotColor }}
              />
            </div>
            <span className="office-dock-label">{agent.displayName || agent.name}</span>
          </button>
        )
      })}

      <div className="office-dock-divider" />

      {/* Nút Giao việc nhanh */}
      <button
        type="button"
        className="office-dock-action-btn"
        onClick={onOpenDispatch}
        title={t('office.actions.dispatch')}
      >
        <span>⚡</span>
        <span>{t('office.actions.dispatch')}</span>
      </button>
    </div>
  )
})
