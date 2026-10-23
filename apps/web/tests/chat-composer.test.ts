import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { acquireChatSend, shouldSendChatKey } from '../src/lib/chat-composer.ts'
const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')
const screen = read('../src/screens/TraoDoi.tsx')
const composer = read('../src/components/ChatComposer.tsx')
const css = read('../src/styles.css')
const key = { key: 'Enter', shiftKey: false, ctrlKey: false, altKey: false, metaKey: false, repeat: false, isComposing: false, keyCode: 13 }
// Execute the actual screen's async send function with isolated state/API collaborators.
function sender() {
  const body = screen.slice(screen.indexOf('  async function guiNoiDung'), screen.indexOf('\n  async function gui()')).replace('async function guiNoiDung(content: string, answers?: ClarificationAnswer[], attachmentIds: string[] = []): Promise<boolean>', 'async function guiNoiDung(content, answers, attachmentIds = [])')
  const api = { sendMessage: vi.fn(async () => ({ briefComplete: true })) }
  const reload = vi.fn(async () => {})
  const scope = { current: { companyId: 'c', conversationId: 'chat' } }
  const lock = { current: false }
  const focus = vi.fn(), error = vi.fn()
  const create = new Function('api', 'taiChiTiet', 'chatScope', 'sendLock', 'acquireChatSend', 'composerRef', 'requestAnimationFrame', 'setLoi', 'ApiError', `const dangChon='chat',cheDoGiaoViec='campaign';const setBaoKetQua=()=>{},setDangGui=()=>{},t=(key)=>key;${body};return guiNoiDung`)
  const send = create(api, reload, scope, lock, acquireChatSend, { current: { focus } }, (fn: () => void) => fn(), error, Error) as (content: string, answers?: unknown, attachmentIds?: string[]) => Promise<boolean>
  return { send, api, reload, scope, lock, focus, error }
}
describe('chat composer keyboard', () => {
  it('sends only plain Enter', () => {
    expect(shouldSendChatKey(key, false)).toBe(true)
    for (const modifier of ['shiftKey', 'ctrlKey', 'altKey', 'metaKey', 'repeat', 'isComposing'] as const) expect(shouldSendChatKey({ ...key, [modifier]: true }, false)).toBe(false)
    expect(shouldSendChatKey({ ...key, key: 'a' }, false)).toBe(false)
  })
  it('protects active composition and legacy IME229', () => {
    expect(shouldSendChatKey(key, true)).toBe(false)
    expect(shouldSendChatKey({ ...key, keyCode: 229 }, false)).toBe(false)
    expect(composer).toContain('onCompositionStart=')
    expect(composer).toContain('onCompositionEnd=')
    expect(composer).toContain('event.nativeEvent.isComposing')
    expect(composer).toContain('event.preventDefault()')
  })
})
describe('shared screen send lock and recovery', () => {
  it('allows an attachment-only message and sends its IDs without inventing text', async () => {
    const { send, api } = sender()
    expect(await send('', undefined, ['attachment-id'])).toBe(true)
    expect(api.sendMessage).toHaveBeenCalledWith('chat', { content: '', mode: 'campaign', attachmentIds: ['attachment-id'] })
    expect(await send('  ')).toBe(false)
  })
  it('synchronously blocks duplicate Enter/click/card sends until completion', async () => {
    const { send, api, lock, focus } = sender()
    let resolve!: (value: { briefComplete: boolean }) => void
    api.sendMessage.mockImplementation(() => new Promise((done) => { resolve = done }))
    const first = send('line1\nline2')
    expect(lock.current).toBe(true)
    expect(await send('duplicate')).toBe(false)
    expect(api.sendMessage).toHaveBeenCalledTimes(1)
    resolve({ briefComplete: true })
    expect(await first).toBe(true)
    expect(lock.current).toBe(false)
    expect(focus).toHaveBeenCalledTimes(1)
  })
  it('returns failure on POST failure and releases lock/refocuses', async () => {
    const { send, api, lock, focus } = sender()
    api.sendMessage.mockRejectedValue(new Error('offline'))
    expect(await send('  first\nsecond\n')).toBe(false)
    expect(lock.current).toBe(false)
    expect(focus).toHaveBeenCalledTimes(1)
  })
  it('does not restore an already accepted message when detail reload fails', async () => {
    const { send, reload, error } = sender()
    reload.mockRejectedValue(new Error('reload failed'))
    expect(await send('accepted')).toBe(true)
    expect(error).toHaveBeenCalled()
  })
  it('ignores completion and focus when selected conversation changes', async () => {
    const { send, api, scope, reload, focus } = sender()
    let resolve!: (value: { briefComplete: boolean }) => void
    api.sendMessage.mockImplementation(() => new Promise((done) => { resolve = done }))
    const pending = send('old')
    scope.current = { companyId: 'other', conversationId: 'other' }
    resolve({ briefComplete: true })
    expect(await pending).toBe(false)
    expect(reload).not.toHaveBeenCalled()
    expect(focus).not.toHaveBeenCalled()
  })
  it('preserves original draft and guards before clearing in composer and skip paths', () => {
    const send = screen.slice(screen.indexOf('  async function gui()'), screen.indexOf('  async function guiCauTraLoi'))
    expect(send).toContain('const original = noiDung')
    expect(send.indexOf('sendLock.current')).toBeLessThan(send.indexOf("setNoiDung('')"))
    expect(send).toContain('setNoiDung(original)')
    const skip = screen.slice(screen.indexOf('  async function boQuaThe'), screen.indexOf('  async function chayBuoc'))
    expect(skip.indexOf('sendLock.current')).toBeLessThan(skip.indexOf("setNoiDung('')"))
    expect(skip).toContain('setNoiDung(original)')
    const load = screen.slice(screen.indexOf('const taiChiTiet'), screen.indexOf('\n  useEffect', screen.indexOf('const taiChiTiet')))
    expect(load.indexOf('chatScope.current.conversationId !== conversationId')).toBeLessThan(load.indexOf('setChiTiet(ketQua)'))
  })
})
describe('composer layout and localization', () => {
  it('embeds accessible 40px SVG send button with reserved text padding and loading state', () => {
    expect(composer).toContain('<textarea')
    expect(composer).toContain('disabled={!canSend}')
    expect(composer).toContain('aria-describedby={hintId}')
    expect(composer).toContain('aria-busy={busy}')
    expect(composer).toContain('chat-composer__spinner')
    expect(css).toContain('padding-right: 62px; padding-bottom: 52px')
    expect(css).toContain('width: 40px; height: 40px')
    expect(css).toContain('prefers-reduced-motion: reduce')
    for (const locale of ['vi', 'en']) {
      const catalog = read(`../../../packages/i18n/src/catalogs/${locale}/chat.ts`)
      for (const key of ['composerLabel', 'composerHint', 'sending']) expect(catalog).toContain(`'chat.${key}'`)
    }
  })
})
