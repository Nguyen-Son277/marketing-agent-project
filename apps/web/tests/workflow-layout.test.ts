import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { en_diagram } from '../../../packages/i18n/src/catalogs/en/diagram.ts'
import { vi_diagram } from '../../../packages/i18n/src/catalogs/vi/diagram.ts'

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')
const screen = read('../src/screens/SoDoDoiAgent.tsx')
const realtime = read('../src/components/workflow/WorkflowRealtime.tsx')
const details = read('../src/components/workflow/WorkflowDetails.tsx')
const css = read('../src/styles.css')

describe('workflow integration accessibility and privacy boundaries', () => {
  it('preserves the default team and static flow while mounting live monitoring only in the active tab', () => {
    expect(screen).toContain("useState<'so-do' | 'luong' | 'workflow'>('so-do')")
    expect(screen).toContain("cheDo === tab && (tab === 'workflow' ? <WorkflowRealtime")
    expect(screen).toContain('duLieu.workflow.map')
    expect(screen).not.toContain('if (dangTai)')
    expect(screen).not.toContain('if (loi)')
    expect(screen).toContain('setDuLieu(null)')
    expect(screen).toContain('setLoi(null)')
  })

  it('uses native roving tabs with linked panels and arrow/Home/End keys', () => {
    for (const token of ['role="tablist"', 'role="tab"', 'role="tabpanel"', 'aria-selected=', 'aria-controls=', 'aria-labelledby=', 'tabIndex={cheDo === tab ? 0 : -1}', "'ArrowRight'", "'ArrowLeft'", "'Home'", "'End'", '.focus()']) expect(screen).toContain(token)
  })

  it('keeps the full list for large graphs and exposes read-only refresh, never execution controls', () => {
    expect(realtime).toContain('!snapshot.graphEligible || tasks.length > 100')
    expect(realtime).toContain('tasks.map((task)')
    expect(realtime).not.toMatch(/tasks\.slice\(/)
    expect(realtime).toContain('live.refreshList()')
    expect(realtime).toContain('live.refresh()')
    expect(realtime + details).not.toMatch(/api\.(reviewTask|retry|run|sendMessage|execute)/)
    expect(details).toContain('api.task(taskId, controller.signal)')
    expect(details).toContain('controller.abort()')
    expect(details).toContain('detail.task.id === taskId')
  })

  it('separates taskless Leader activity, persisted unverified runs and transport status', () => {
    expect(realtime).toContain('run.taskId === null')
    expect(realtime).toContain('diagram.workflow.connection.notActivity')
    expect(realtime).toContain("workflowNodeActivity(task, snapshot.activeRuns) === 'unverified'")
    expect(details).toContain("run.activity === 'unverified'")
    expect(details).toContain('run.modelRequest')
    expect(details).toContain('run.tools')
    expect(details).toContain('run.retry')
    expect(realtime).toContain('diagram.workflow.noConversations')
    expect(realtime).toContain('diagram.workflow.noTasks')
  })

  it('renders bounded translated summaries, not arbitrary event payloads or raw run errors', () => {
    expect(realtime).toContain('live.events.slice(-50)')
    expect(realtime).toContain('workflowEventKey(event.type)')
    expect(details).toContain('detail.events.slice(-50)')
    expect(details).toContain('workflowEventKey(event.kind)')
    expect(details).not.toContain('event.payload')
    expect(realtime).not.toContain('event.data')
    expect(realtime + details).not.toContain('JSON.stringify')
    expect(realtime + details).not.toMatch(/run\.(error|errorMd|providerBody)/)
    expect(realtime + details).toContain('translateError(')
  })

  it('uses theme variables, responsive stacked details, focus indicators and reduced motion', () => {
    const workflowCss = css.slice(css.indexOf('/* Runtime workflow'))
    expect(workflowCss).not.toContain('.wf__')
    expect(workflowCss).toContain('var(--mau-be-mat)')
    expect(workflowCss).toContain('.workflow__workspace { grid-template-columns: minmax(0,1fr); }')
    expect(workflowCss).toContain(':focus-visible')
    expect(workflowCss).toContain('prefers-reduced-motion: reduce')
    expect(workflowCss).toContain('animation: none !important')
    expect(workflowCss).toContain('.workflow__activity--active::before')
    expect(workflowCss).not.toMatch(/unverified[^}]*animation:/)
    expect(workflowCss).toContain('.workflow__canvas { position: relative; height: 560px;')
  })

  it('has identical catalog keys and preserves the canvas contracts', () => {
    expect(Object.keys(en_diagram).sort()).toEqual(Object.keys(vi_diagram).sort())
    expect(vi_diagram['diagram.workflow.canvas.label']).toBe('Sơ đồ workflow')
    expect(vi_diagram['diagram.workflow.node.label']).toBe('{{title}} — {{agent}} — {{status}}')
    for (const locale of [en_diagram, vi_diagram]) {
      for (const [key, value] of Object.entries(locale)) {
        if (key.startsWith('diagram.workflow.')) expect(value.length).toBeGreaterThan(0)
      }
    }
  })
})
