import { useState, useEffect, useCallback, type ReactNode } from 'react'
import type { OfficeAgentDeskResponse } from '@marketing-agent/shared'
import { api } from '../../lib/api.ts'
import { useI18n } from '../../lib/i18n.tsx'
import { ROLE_ICONS } from './OfficeAgentAvatar.tsx'

interface OfficeAgentDeskModalProps {
  readonly isOpen: boolean
  readonly onClose: () => void
  readonly companyId: string
  readonly role: string | null
  readonly onOpenDispatchWithRole?: (role: string) => void
}

export function OfficeAgentDeskModal({
  isOpen,
  onClose,
  companyId,
  role,
  onOpenDispatchWithRole,
}: OfficeAgentDeskModalProps): ReactNode {
  const { t } = useI18n()
  const [data, setData] = useState<OfficeAgentDeskResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [pingMessage, setPingMessage] = useState<string | null>(null)
  const [pinging, setPinging] = useState(false)

  const loadDesk = useCallback(async () => {
    if (!role) return
    setLoading(true)
    setData(null)
    setPingMessage(null)
    try {
      const res = await api.officeDesk(companyId, role)
      setData(res)
    } catch (err) {
      console.error('Failed to load agent desk:', err)
    } finally {
      setLoading(false)
    }
  }, [companyId, role])

  useEffect(() => {
    if (isOpen && role) {
      loadDesk()
    }
  }, [isOpen, role, loadDesk])

  const handlePing = async () => {
    if (!role) return
    setPinging(true)
    try {
      const res = await api.officePing(companyId, role)
      setPingMessage(res.message || t('office.desk.pokeResponse'))
    } catch {
      setPingMessage('Đã gõ cửa bàn làm việc!')
    } finally {
      setPinging(false)
    }
  }

  if (!isOpen || !role) return null

  const icon = ROLE_ICONS[role] ?? '🤖'

  return (
    <div className="office-modal-backdrop" onClick={onClose}>
      <div className="office-modal" onClick={(e) => e.stopPropagation()}>
        {/* Modal Header */}
        <div className="office-modal__header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
            <div
              style={{
                width: '48px',
                height: '48px',
                borderRadius: '50%',
                background: '#EEF2F6',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '26px',
              }}
            >
              {icon}
            </div>
            <div>
              <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 700 }}>
                {data?.agent.name || role}
              </h3>
              <p style={{ margin: '2px 0 0 0', fontSize: '12px', color: '#64748B' }}>
                {role} • {t('office.desk.title')}
              </p>
            </div>
          </div>
          <button
            type="button"
            className="office-btn-icon"
            onClick={onClose}
            style={{ width: '32px', height: '32px' }}
          >
            ✕
          </button>
        </div>

        {/* Modal Body */}
        <div className="office-modal__body">
          {loading && (
            <div style={{ textAlign: 'center', padding: '40px 0', color: '#6B7280' }}>
              Đang tải dữ liệu bàn làm việc…
            </div>
          )}

          {pingMessage && (
            <div
              style={{
                padding: '12px 16px',
                borderRadius: '12px',
                background: '#DCFCE7',
                color: '#15803D',
                fontSize: '13px',
                fontWeight: 600,
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
              }}
            >
              <span>🔔</span>
              <span>{pingMessage}</span>
            </div>
          )}

          {data && (
            <>
              {/* Thẻ thông số cấu hình AI Model */}
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
                  gap: '12px',
                  background: 'var(--office-grid-tile)',
                  padding: '14px',
                  borderRadius: '16px',
                }}
              >
                <div>
                  <div style={{ fontSize: '11px', color: '#64748B' }}>{t('office.desk.modelTier')}</div>
                  <div style={{ fontSize: '14px', fontWeight: 700, textTransform: 'uppercase', color: '#2563EB' }}>
                    {data.agent.tier || 'Standard'}
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: '11px', color: '#64748B' }}>{t('office.desk.activeModel')}</div>
                  <div style={{ fontSize: '13px', fontWeight: 600 }}>
                    {data.agent.modelLabel || 'Mặc định hệ thống'}
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: '11px', color: '#64748B' }}>{t('office.desk.tasksCompleted')}</div>
                  <div style={{ fontSize: '14px', fontWeight: 700, color: '#16A34A' }}>
                    {data.agent.stats?.tasksCompletedToday ?? 0}
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: '11px', color: '#64748B' }}>{t('office.desk.costToday')}</div>
                  <div style={{ fontSize: '14px', fontWeight: 700, color: '#D97706' }}>
                    ${(data.agent.stats?.costUsdToday ?? 0).toFixed(4)}
                  </div>
                </div>
              </div>

              {/* Kỹ năng & Công cụ */}
              <div>
                <h4 style={{ margin: '0 0 8px 0', fontSize: '13px', fontWeight: 700 }}>
                  🛠️ {t('office.desk.tools')} & {t('office.desk.skills')}
                </h4>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                  {data.tools.map((tool) => (
                    <span
                      key={tool}
                      style={{
                        padding: '4px 8px',
                        borderRadius: '6px',
                        background: '#EEF2F6',
                        fontSize: '11px',
                        fontFamily: 'monospace',
                        color: '#334155',
                      }}
                    >
                      {tool}
                    </span>
                  ))}
                  {data.skills.map((skill) => (
                    <span
                      key={skill.name}
                      style={{
                        padding: '4px 8px',
                        borderRadius: '6px',
                        background: '#FEF3C7',
                        fontSize: '11px',
                        color: '#92400E',
                        fontWeight: 500,
                      }}
                    >
                      ★ {skill.name}
                    </span>
                  ))}
                </div>
              </div>

              {/* Sản phẩm gần nhất */}
              <div>
                <h4 style={{ margin: '0 0 8px 0', fontSize: '13px', fontWeight: 700 }}>
                  📦 {t('office.desk.recentArtifacts')}
                </h4>
                {data.recentArtifacts.length === 0 ? (
                  <p style={{ margin: 0, fontSize: '12px', color: '#94A3B8' }}>
                    {t('office.desk.noArtifacts')}
                  </p>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    {data.recentArtifacts.map((art) => (
                      <div
                        key={art.id}
                        style={{
                          padding: '8px 12px',
                          borderRadius: '8px',
                          border: '1px solid #E2E8F0',
                          fontSize: '12px',
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                        }}
                      >
                        <span style={{ fontWeight: 600 }}>{art.name}</span>
                        <span style={{ color: '#64748B', fontSize: '11px' }}>{art.kind}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Action buttons */}
              <div style={{ display: 'flex', gap: '10px', marginTop: '10px' }}>
                <button
                  type="button"
                  onClick={handlePing}
                  disabled={pinging}
                  style={{
                    flex: 1,
                    padding: '10px 16px',
                    borderRadius: '12px',
                    border: '1px solid #D1D5DB',
                    background: '#F8FAFC',
                    fontWeight: 600,
                    fontSize: '13px',
                    cursor: pinging ? 'not-allowed' : 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '6px',
                  }}
                >
                  <span>👋</span>
                  <span>{t('office.actions.ping')}</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    onClose()
                    onOpenDispatchWithRole?.(role)
                  }}
                  style={{
                    flex: 1.5,
                    padding: '10px 16px',
                    borderRadius: '12px',
                    border: 'none',
                    background: '#2563EB',
                    color: '#FFFFFF',
                    fontWeight: 600,
                    fontSize: '13px',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '6px',
                    boxShadow: '0 4px 12px rgba(37, 99, 235, 0.25)',
                  }}
                >
                  <span>⚡</span>
                  <span>{t('office.actions.dispatch')}</span>
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
