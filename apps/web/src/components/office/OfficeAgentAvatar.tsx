import { memo, type ReactNode } from 'react'
import type { AgentOfficeState } from '@marketing-agent/shared'
import { useI18n } from '../../lib/i18n.tsx'

export const ROLE_ICONS: Record<string, string> = {
  'marketing-leader': '👔',
  'market-research': '🔭',
  'content-writer': '✍️',
  'seo-technical': '⚙️',
  'web-technical': '💻',
  'social-media': '📱',
  'paid-media': '🎯',
  'email-crm': '💌',
  'design-video': '🎨',
  'analytics': '📊',
  'community-care': '🤝',
}

interface OfficeAgentAvatarProps {
  readonly agent: AgentOfficeState
  readonly roomColor?: string
  readonly onClick?: () => void
}

export const OfficeAgentAvatar = memo(function OfficeAgentAvatar({
  agent,
  roomColor = '#3B82F6',
  onClick,
}: OfficeAgentAvatarProps): ReactNode {
  const { locale } = useI18n()
  const icon = ROLE_ICONS[agent.role] ?? '🤖'
  const isWorking = agent.status === 'working'
  const isBlocked = agent.status === 'blocked'
  const actionText = locale === 'en' ? agent.currentActionEn : agent.currentActionVi


  return (
    <div
      className={`office-agent-character office-agent-character--${agent.status}`}
      onClick={(e) => {
        e.stopPropagation()
        onClick?.()
      }}
      title={`${agent.displayName} (${agent.name}) - ${actionText}`}
    >
      {/* Bong bóng suy nghĩ khi đang làm việc hoặc bị chặn */}
      {(isWorking || isBlocked) && (
        <div className="office-thinking-bubble">
          {isBlocked ? '⚠️ ' : '💬 '}
          {agent.currentTaskTitle || actionText}
        </div>
      )}

      {/* Avatar nhân vật 3D Pastel */}
      <div
        className="office-avatar-figure"
        style={{ '--room-color': roomColor } as Record<string, string>}
      >
        <span>{icon}</span>

        {/* Trạng thái chi tiết dạng badge nhỏ */}
        {agent.status === 'offline' && (
          <span
            style={{
              position: 'absolute',
              top: -6,
              right: -6,
              fontSize: '11px',
              background: '#94A3B8',
              borderRadius: '50%',
              padding: '1px 3px',
              color: '#FFF',
            }}
          >
            💤
          </span>
        )}
      </div>
    </div>
  )
})
