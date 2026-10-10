/**
 * Trạng thái phiên và công ty đang chọn.
 *
 * Vì sao không dùng thư viện state: chỉ có hai thứ cần chia sẻ toàn app (người
 * dùng hiện tại và công ty đang mở), và chúng đều đến từ server chứ không sinh ra
 * ở client. Một React context nhỏ là đủ, và giữ được một nguồn sự thật duy nhất.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { CompanySummary, MeResponse, PublicUser } from '@marketing-agent/shared'
import { api, ApiError, setUnauthorizedHandler } from './api.ts'

/**
 * Khoá lưu công ty đang chọn, GẮN THEO NGƯỜI DÙNG.
 *
 * Vì sao phải gắn: hai người dùng chung một trình duyệt là chuyện thường. Với một khoá
 * chung, người sau đăng nhập sẽ đọc lựa chọn của người trước; họ không thấy dữ liệu của
 * nhau (danh sách công ty được xác thực lại với server), nhưng bị nhảy vào công ty đầu
 * tiên thay vì công ty họ dùng lần trước — một hành vi khó hiểu.
 */
const COMPANY_STORAGE_PREFIX = 'ma.companyId'
/** Khoá cũ, chỉ đọc một lần để không làm mất lựa chọn đang có của người dùng hiện tại. */
const LEGACY_COMPANY_STORAGE_KEY = 'ma.companyId'

const companyStorageKey = (userId: string): string => `${COMPANY_STORAGE_PREFIX}:${userId}`

const readStoredCompanyId = (userId: string): string | null => {
  try {
    const scoped = localStorage.getItem(companyStorageKey(userId))
    if (scoped) return scoped
    // Di trú một lần: người dùng đang dùng bản cũ có lựa chọn ở khoá chung.
    const legacy = localStorage.getItem(LEGACY_COMPANY_STORAGE_KEY)
    if (legacy) {
      localStorage.setItem(companyStorageKey(userId), legacy)
      localStorage.removeItem(LEGACY_COMPANY_STORAGE_KEY)
      return legacy
    }
    return null
  } catch {
    // Trình duyệt chặn localStorage: vẫn phải chạy, chỉ là không nhớ lựa chọn.
    return null
  }
}

const writeStoredCompanyId = (userId: string, companyId: string): void => {
  try {
    localStorage.setItem(companyStorageKey(userId), companyId)
  } catch {
    // Không lưu được thì lựa chọn chỉ có hiệu lực cho phiên hiện tại.
  }
}

const clearStoredCompanyId = (userId: string): void => {
  try {
    localStorage.removeItem(companyStorageKey(userId))
  } catch {
    // Không xoá được cũng không ảnh hưởng tính đúng đắn: server vẫn xác thực lại.
  }
}

export interface SessionState {
  readonly user: PublicUser | null
  readonly companies: readonly CompanySummary[]
  readonly companyId: string | null
  readonly company: CompanySummary | null
  readonly loading: boolean
  readonly ready: boolean
  readonly systemProblem: string | null
  selectCompany(companyId: string): void
  refresh(): Promise<void>
  signIn(user: PublicUser, companies: readonly CompanySummary[]): void
  signOut(): Promise<void>
  /** Tạo công ty mới rồi chuyển sang công ty đó. */
  createCompany(name: string): Promise<CompanySummary>
  /** Đổi tên hiển thị của một công ty; slug giữ nguyên. */
  renameCompany(companyId: string, name: string): Promise<CompanySummary>
}

const SessionContext = createContext<SessionState | undefined>(undefined)

export function SessionProvider({ children }: { children: ReactNode }): ReactNode {
  const [user, setUser] = useState<PublicUser | null>(null)
  const [companies, setCompanies] = useState<readonly CompanySummary[]>([])
  const [companyId, setCompanyId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [ready, setReady] = useState(false)
  const [systemProblem, setSystemProblem] = useState<string | null>(null)
  /**
   * Người dùng hiện tại, đọc được từ trong `useCallback` mà không cần thêm phụ thuộc.
   *
   * Vì sao cần: `selectCompany` và `signOut` phải biết đang thao tác cho ai để ghi/xoá
   * đúng khoá `localStorage` theo người dùng. Nếu để `user` làm phụ thuộc thì mọi thay
   * đổi người dùng sẽ tạo lại các callback, kéo theo effect tải lại dữ liệu không cần thiết.
   */
  const userRef = useRef<PublicUser | null>(null)

  /** Chọn công ty đã lưu nếu còn hợp lệ, nếu không lấy công ty đầu tiên. */
  useEffect(() => {
    userRef.current = user
  }, [user])

  const resolveCompanyId = useCallback((userId: string, list: readonly CompanySummary[]): string | null => {
    if (list.length === 0) return null
    const stored = readStoredCompanyId(userId)
    if (stored && list.some((company) => company.id === stored)) return stored
    return list[0]?.id ?? null
  }, [])

  const applySession = useCallback(
    (response: MeResponse) => {
      setUser(response.user)
      setCompanies(response.companies)
      setCompanyId((current) => {
        if (current && response.companies.some((company) => company.id === current)) return current
        return resolveCompanyId(response.user.id, response.companies)
      })
    },
    [resolveCompanyId],
  )

  const refresh = useCallback(async () => {
    try {
      const status = await api.systemStatus()
      setSystemProblem(status.ready ? null : (status.catalog.problem ?? 'Hệ thống chưa sẵn sàng'))
    } catch {
      setSystemProblem(null)
    }
    try {
      const me = await api.me()
      applySession(me)
    } catch (error) {
      if (error instanceof ApiError && error.isUnauthorized) {
        setUser(null)
        setCompanies([])
        setCompanyId(null)
      } else {
        // Lỗi mạng: giữ nguyên trạng thái, không đăng xuất người dùng oan.
      }
    } finally {
      setLoading(false)
      setReady(true)
    }
  }, [applySession])

  useEffect(() => {
    // 401 ở bất kỳ đâu cũng đưa về màn hình đăng nhập, tránh trạng thái nửa vời.
    setUnauthorizedHandler(() => {
      setUser(null)
      setCompanies([])
      setCompanyId(null)
    })
    return () => setUnauthorizedHandler(undefined)
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const selectCompany = useCallback(
    (next: string) => {
      setCompanyId(next)
      const currentUser = userRef.current
      if (currentUser) writeStoredCompanyId(currentUser.id, next)
    },
    [],
  )

  const signIn = useCallback(
    (nextUser: PublicUser, nextCompanies: readonly CompanySummary[]) => {
      setUser(nextUser)
      setCompanies(nextCompanies)
      const resolved = resolveCompanyId(nextUser.id, nextCompanies)
      setCompanyId(resolved)
      if (resolved) writeStoredCompanyId(nextUser.id, resolved)
    },
    [resolveCompanyId],
  )

  const signOut = useCallback(async () => {
    const currentUser = userRef.current
    try {
      await api.logout()
    } finally {
      // Chỉ xoá lựa chọn của CHÍNH người này; người khác dùng chung máy vẫn giữ lựa chọn.
      if (currentUser) clearStoredCompanyId(currentUser.id)
      setUser(null)
      setCompanies([])
      setCompanyId(null)
    }
  }, [])

  const createCompany = useCallback(
    async (name: string) => {
      const created = await api.createCompany({ name })
      const list = await api.listCompanies()
      setCompanies(list.companies)
      const next = list.companies.find((company) => company.id === created.company.id) ?? created.company
      selectCompany(next.id)
      return next
    },
    [selectCompany],
  )

  const renameCompany = useCallback(
    async (targetId: string, name: string) => {
      const updated = await api.renameCompany(targetId, name)
      const list = await api.listCompanies()
      setCompanies(list.companies)
      return list.companies.find((company) => company.id === targetId) ?? updated.company
    },
    [],
  )

  const value = useMemo<SessionState>(
    () => ({
      user,
      companies,
      companyId,
      company: companies.find((company) => company.id === companyId) ?? null,
      loading,
      ready,
      systemProblem,
      selectCompany,
      refresh,
      signIn,
      signOut,
      createCompany,
      renameCompany,
    }),
    [user, companies, companyId, loading, ready, systemProblem, selectCompany, refresh, signIn, signOut, createCompany],
  )

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}

export function useSession(): SessionState {
  const context = useContext(SessionContext)
  if (!context) throw new Error('useSession phải dùng bên trong <SessionProvider>')
  return context
}

/** Lấy công ty đang chọn, ném lỗi rõ ràng nếu chưa chọn — dùng trong màn hình cần companyId. */
export function useRequiredCompany(): CompanySummary {
  const { company } = useSession()
  if (!company) throw new Error('Chưa chọn công ty')
  return company
}
