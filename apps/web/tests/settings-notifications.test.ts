import { afterEach, describe, expect, it, vi } from 'vitest'
import { beginSettingsAction, registerSettingsNotificationHost } from '../src/lib/settings-notifications.ts'
import { readFileSync } from 'node:fs'
const tick = async () => { for (let i = 0; i < 12; i++) await Promise.resolve() }
const item = { id: 'self', title: 'safe' }
function setup() {
  vi.stubGlobal('window', { localStorage: { getItem: () => 'en' }, navigator: { languages: ['en'] } })
  const fetch = vi.fn(async () => new Response(JSON.stringify({ item })))
  vi.stubGlobal('fetch', fetch)
  const toast = vi.fn(), persisted = vi.fn(), abort = new AbortController()
  const unregister = registerSettingsNotificationHost({ userId: 'user', companyId: 'company', signal: abort.signal, toast, persisted })
  return { fetch, toast, persisted, abort, unregister }
}
afterEach(() => { vi.unstubAllGlobals() })
describe('settings notification delivery', () => {
  it('emits once immediately, persists only safe allowlisted metadata and accepts returned id', async () => {
    const { fetch, toast, persisted, unregister } = setup()
    const finish = beginSettingsAction('user', 'company', 'provider.test')
    finish('error'); finish('success')
    expect(toast).toHaveBeenCalledTimes(1)
    await tick()
    const body = JSON.parse(fetch.mock.calls[0]![1]!.body as string)
    expect(Object.keys(body).sort()).toEqual(['operation', 'operationId', 'status'])
    expect(body).toEqual({ operation: 'provider.test', status: 'error', operationId: expect.any(String) })
    expect(persisted).toHaveBeenCalledWith(item)
    unregister()
  })
  it('ignores a finishing action after company/user scope changes', async () => {
    const { toast, fetch, unregister } = setup()
    const finish = beginSettingsAction('user', 'company', 'limits.save')
    unregister()
    const unregisterNext = registerSettingsNotificationHost({ userId: 'other', companyId: 'other', signal: new AbortController().signal, toast: vi.fn(), persisted: vi.fn() })
    finish('success')
    await tick()
    expect(toast).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled()
    unregisterNext()
  })
  it('drops late persistence response after logout', async () => {
    const { fetch, persisted, abort, unregister } = setup()
    let resolve!: (response: Response) => void
    fetch.mockImplementation(() => new Promise((done) => { resolve = done }))
    beginSettingsAction('user', 'company', 'key.save')('success')
    unregister(); abort.abort()
    resolve(new Response(JSON.stringify({ item })))
    await tick()
    expect(persisted).not.toHaveBeenCalled()
  })
  it('retries persistence with same operation id without re-emitting toast', async () => {
    const { fetch, toast, unregister } = setup()
    fetch.mockRejectedValueOnce(new Error('offline'))
    beginSettingsAction('user', 'company', 'model.fetch')('warning')
    await tick()
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(fetch.mock.calls[0]![1]!.body).toBe(fetch.mock.calls[1]![1]!.body)
    expect(toast).toHaveBeenCalledTimes(1)
    unregister()
  })
  it('does not retry forbidden or validation responses', async () => {
    const { fetch, unregister } = setup()
    fetch.mockResolvedValue(new Response(JSON.stringify({ error: { code: 'forbidden', message: 'Forbidden' } }), { status: 403 }))
    beginSettingsAction('user', 'company', 'route.save')('error')
    await tick()
    expect(fetch).toHaveBeenCalledTimes(1)
    unregister()
  })
})
describe('settings outcome host wiring', () => {
  it('uses top-layer toast portal, accessible View action and bounded queue', () => {
    const toast = readFileSync(new URL('../src/components/NotificationToast.tsx', import.meta.url), 'utf8')
    const bell = readFileSync(new URL('../src/components/NotificationBell.tsx', import.meta.url), 'utf8')
    expect(toast).toContain('createPortal(')
    expect(toast).toContain("querySelectorAll<HTMLDialogElement>('dialog[open]')")
    expect(toast).toContain('new MutationObserver(sync)')
    expect(toast).toContain('popover="manual"')
    expect(toast).toContain("t('notifications.viewInbox')")
    expect(bell).toContain('enqueueToast(queue, event)')
    expect(bell).not.toContain("querySelectorAll<HTMLDialogElement>('dialog[open]')")
  })
  it('covers every settings operation and removes accumulated action result banners', () => {
    const screen = readFileSync(new URL('../src/screens/CaiDat.tsx', import.meta.url), 'utf8')
    for (const operation of ['provider.save','provider.delete','provider.test','key.save','key.delete','key.test','model.save','model.delete','model.purge','route.save','integration.save','integration.test','limits.save']) expect(screen).toContain(`begin('${operation}')`)
    for (const old of ['{thongBao ?', '{loiXoa ?', '{loiNgoaiHop ?', '{ketQuaTest[', '{loiTest[']) expect(screen).not.toContain(old)
    expect(screen).toContain("setLoiLuu(t('settings.providers.needNameAndBaseUrl'))")
    expect(screen).toContain('<TrangThai dangTai={dangTai} loi={loi} taiLai={taiLai} />')
  })
})
