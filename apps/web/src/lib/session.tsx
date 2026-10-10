/**
 * Trạng thái phiên và công ty đang chọn.
 *
 * Vì sao không dùng thư viện state: chỉ có hai thứ cần chia sẻ toàn app (người
 * dùng hiện tại và công ty đang mở), và chúng đều đến từ server chứ không sinh ra
 * ở client. Một React context nhỏ là đủ, và giữ được một nguồn sự thật duy nhất.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { CompanySummary, MeResponse, PublicUser } from '@marketing-agent/shared'
import { api, ApiError, setUnauthorizedHandler } from './api.ts'

const COMPANY_STORAGE_KEY = 'ma.companyId'

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
}

const SessionContext = createContext<SessionState | undefined>(undefined)

export function SessionProvider({ children }: { children: ReactNode }): ReactNode {
  const [user, setUser] = useState<PublicUser | null>(null)
  const [companies, setCompanies] = useState<readonly CompanySummary[]>([])
  const [companyId, setCompanyId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [ready, setReady] = useState(false)
  const [systemProblem, setSystemProblem] = useState<string | null>(null)

  /** Chọn công ty đã lưu nếu còn hợp lệ, nếu không lấy công ty đầu tiên. */
  const resolveCompanyId = useCallback((list: readonly CompanySummary[]): string | null => {
    if (list.length === 0) return null
    const stored = localStorage.getItem(COMPANY_STORAGE_KEY)
    if (stored && list.some((company) => company.id === stored)) return stored
    return list[0]?.id ?? null
  }, [])

  const applySession = useCallback(
    (response: MeResponse) => {
      setUser(response.user)
      setCompanies(response.companies)
      setCompanyId((current) => {
        if (current && response.companies.some((company) => company.id === current)) return current
        return resolveCompanyId(response.companies)
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

  const selectCompany = useCallback((next: string) => {
    setCompanyId(next)
    localStorage.setItem(COMPANY_STORAGE_KEY, next)
  }, [])

  const signIn = useCallback(
    (nextUser: PublicUser, nextCompanies: readonly CompanySummary[]) => {
      setUser(nextUser)
      setCompanies(nextCompanies)
      const resolved = resolveCompanyId(nextCompanies)
      setCompanyId(resolved)
      if (resolved) localStorage.setItem(COMPANY_STORAGE_KEY, resolved)
    },
    [resolveCompanyId],
  )

  const signOut = useCallback(async () => {
    try {
      await api.logout()
    } finally {
      setUser(null)
      setCompanies([])
      setCompanyId(null)
      localStorage.removeItem(COMPANY_STORAGE_KEY)
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
