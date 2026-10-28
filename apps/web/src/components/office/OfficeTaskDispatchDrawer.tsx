import { useState, useCallback, useEffect, type ReactNode } from 'react'
import type { AgentOfficeState, TaskView } from '@marketing-agent/shared'
import { api } from '../../lib/api.ts'
import { useI18n } from '../../lib/i18n.tsx'

interface OfficeTaskDispatchDrawerProps {
  readonly isOpen: boolean
  readonly onClose: () => void
  readonly companyId: string
  readonly agents: readonly AgentOfficeState[]
  readonly initialAssigneeRole?: string | null
  readonly onTaskDispatched?: () => void
}

export function OfficeTaskDispatchDrawer({
  isOpen,
  onClose,
  companyId,
  agents,
  initialAssigneeRole,
  onTaskDispatched,
}: OfficeTaskDispatchDrawerProps): ReactNode {
  const { t } = useI18n()
  const [activeTab, setActiveTab] = useState<'create' | 'list'>('create')
  const [assigneeRole, setAssigneeRole] = useState<string>(initialAssigneeRole || agents[0]?.role || 'marketing-leader')
  const [title, setTitle] = useState('')
  const [briefMd, setBriefMd] = useState('')
  const [priority, setPriority] = useState(5)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)
  const [tasks, setTasks] = useState<readonly TaskView[]>([])
  const [loadingTasks, setLoadingTasks] = useState(false)

  useEffect(() => {
    if (initialAssigneeRole) {
      setAssigneeRole(initialAssigneeRole)
      setActiveTab('create')
    }
  }, [initialAssigneeRole])

  const loadTasks = useCallback(async () => {
    setLoadingTasks(true)
    try {
      const res = await api.officeTasks(companyId)
      setTasks(res.tasks)
    } catch (err) {
      console.error('Failed to load tasks:', err)
    } finally {
      setLoadingTasks(false)
    }
  }, [companyId])

  useEffect(() => {
    if (isOpen && activeTab === 'list') {
      loadTasks()
    }
  }, [isOpen, activeTab, loadTasks])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!title.trim() || !briefMd.trim()) return

    setSubmitting(true)
    setError(null)
    setSuccessMessage(null)

    try {
      await api.officeDispatch(companyId, {
        assigneeRole: assigneeRole as never,
        title: title.trim(),
        briefMd: briefMd.trim(),
        priority,
      })
      setSuccessMessage(t('office.dispatch.success'))
      setTitle('')
      setBriefMd('')
      onTaskDispatched?.()
      setTimeout(() => {
        setSuccessMessage(null)
      }, 3000)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Lỗi khi giao việc')
    } finally {
      setSubmitting(false)
    }
  }

  if (!isOpen) return null

  return (
    <div className="office-drawer-backdrop" onClick={onClose}>
      <div className="office-drawer" onClick={(e) => e.stopPropagation()}>
        <div className="office-drawer__header">
          <div>
            <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 700 }}>
              {t('office.dispatch.title')}
            </h3>
            <p style={{ margin: '4px 0 0 0', fontSize: '12px', color: '#6B7280' }}>
              {t('office.dispatch.subtitle')}
            </p>
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

        {/* Tab switcher */}
        <div style={{ display: 'flex', borderBottom: '1px solid #E5E7EB', padding: '0 20px' }}>
          <button
            type="button"
            onClick={() => setActiveTab('create')}
            style={{
              padding: '12px 16px',
              border: 'none',
              background: 'transparent',
              fontWeight: 600,
              fontSize: '13px',
              cursor: 'pointer',
              color: activeTab === 'create' ? '#2563EB' : '#6B7280',
              borderBottom: activeTab === 'create' ? '2px solid #2563EB' : '2px solid transparent',
            }}
          >
            ⚡ {t('office.actions.dispatch')}
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('list')}
            style={{
              padding: '12px 16px',
              border: 'none',
              background: 'transparent',
              fontWeight: 600,
              fontSize: '13px',
              cursor: 'pointer',
              color: activeTab === 'list' ? '#2563EB' : '#6B7280',
              borderBottom: activeTab === 'list' ? '2px solid #2563EB' : '2px solid transparent',
            }}
          >
            📋 {t('office.actions.kanbanView')}
          </button>
        </div>

        <div className="office-drawer__body">
          {activeTab === 'create' ? (
            <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              {error && (
                <div style={{ padding: '10px 14px', borderRadius: '8px', background: '#FEE2E2', color: '#B91C1C', fontSize: '13px' }}>
                  {error}
                </div>
              )}
              {successMessage && (
                <div style={{ padding: '10px 14px', borderRadius: '8px', background: '#DCFCE7', color: '#15803D', fontSize: '13px' }}>
                  {successMessage}
                </div>
              )}

              {/* Chọn vai trò Agent */}
              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '6px' }}>
                  {t('office.dispatch.assignee')}
                </label>
                <select
                  value={assigneeRole}
                  onChange={(e) => setAssigneeRole(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '10px 12px',
                    borderRadius: '10px',
                    border: '1px solid #D1D5DB',
                    fontSize: '14px',
                    background: 'var(--dock-bg-light)',
                  }}
                >
                  {agents.map((agent) => (
                    <option key={agent.role} value={agent.role}>
                      {agent.displayName || agent.name} ({agent.role}) - {agent.tier.toUpperCase()}
                    </option>
                  ))}
                </select>
              </div>

              {/* Tiêu đề công việc */}
              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '6px' }}>
                  {t('office.dispatch.taskTitle')}
                </label>
                <input
                  type="text"
                  required
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder={t('office.dispatch.taskTitlePlaceholder')}
                  style={{
                    width: '100%',
                    padding: '10px 12px',
                    borderRadius: '10px',
                    border: '1px solid #D1D5DB',
                    fontSize: '14px',
                    boxSizing: 'border-box',
                  }}
                />
              </div>

              {/* Độ ưu tiên */}
              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '6px' }}>
                  {t('office.dispatch.priority')}
                </label>
                <select
                  value={priority}
                  onChange={(e) => setPriority(Number(e.target.value))}
                  style={{
                    width: '100%',
                    padding: '10px 12px',
                    borderRadius: '10px',
                    border: '1px solid #D1D5DB',
                    fontSize: '14px',
                  }}
                >
                  <option value={5}>{t('office.dispatch.priorityNormal')}</option>
                  <option value={8}>{t('office.dispatch.priorityHigh')}</option>
                  <option value={10}>{t('office.dispatch.priorityUrgent')}</option>
                </select>
              </div>

              {/* Yêu cầu & Mô tả công việc */}
              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '6px' }}>
                  {t('office.dispatch.brief')}
                </label>
                <textarea
                  required
                  rows={6}
                  value={briefMd}
                  onChange={(e) => setBriefMd(e.target.value)}
                  placeholder={t('office.dispatch.briefPlaceholder')}
                  style={{
                    width: '100%',
                    padding: '10px 12px',
                    borderRadius: '10px',
                    border: '1px solid #D1D5DB',
                    fontSize: '13px',
                    fontFamily: 'inherit',
                    boxSizing: 'border-box',
                    resize: 'vertical',
                  }}
                />
              </div>

              <button
                type="submit"
                disabled={submitting}
                style={{
                  padding: '12px 20px',
                  borderRadius: '12px',
                  background: submitting ? '#93C5FD' : '#2563EB',
                  color: '#FFFFFF',
                  fontWeight: 600,
                  fontSize: '14px',
                  border: 'none',
                  cursor: submitting ? 'not-allowed' : 'pointer',
                  marginTop: '10px',
                  boxShadow: '0 4px 12px rgba(37, 99, 235, 0.3)',
                }}
              >
                {submitting ? t('office.dispatch.submitting') : t('office.dispatch.submit')}
              </button>
            </form>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {loadingTasks && <p style={{ fontSize: '13px', color: '#6B7280' }}>Đang tải công việc…</p>}
              {!loadingTasks && tasks.length === 0 && (
                <p style={{ fontSize: '13px', color: '#6B7280', textAlign: 'center', margin: '40px 0' }}>
                  {t('office.dispatch.noTasks')}
                </p>
              )}
              {tasks.map((task) => (
                <div
                  key={task.id}
                  style={{
                    padding: '14px',
                    borderRadius: '12px',
                    border: '1px solid #E5E7EB',
                    background: 'var(--dock-bg-light)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '6px',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: '11px', fontWeight: 700, color: '#3B82F6' }}>
                      {task.assigneeRole || 'unassigned'}
                    </span>
                    <span className={`office-status-badge office-status-badge--${task.status}`}>
                      {task.status}
                    </span>
                  </div>
                  <h4 style={{ margin: 0, fontSize: '14px', fontWeight: 600 }}>{task.title}</h4>
                  <p style={{ margin: 0, fontSize: '12px', color: '#6B7280', maxHeight: '40px', overflow: 'hidden' }}>
                    {task.briefMd}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
