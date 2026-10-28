/**
 * Hook quản lý kết nối thời gian thực SSE (Server-Sent Events) cho phân hệ Văn phòng AI 3D.
 * Tự động đồng bộ trạng thái khi có sự kiện và dự phòng bằng polling nếu kết nối rớt.
 */
import { useEffect, useRef, useState, useCallback } from 'react'

export interface UseOfficeRealtimeOptions {
  readonly companyId: string | null
  readonly onRefresh: () => void
  readonly pollIntervalMs?: number
}

export type ConnectionStatus = 'connected' | 'connecting' | 'reconnecting' | 'polling'

export function useOfficeRealtime({
  companyId,
  onRefresh,
  pollIntervalMs = 8000,
}: UseOfficeRealtimeOptions): {
  connectionStatus: ConnectionStatus
  lastEventAt: Date | null
  manualRefresh: () => void
} {
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('connecting')
  const [lastEventAt, setLastEventAt] = useState<Date | null>(null)
  const refreshRef = useRef(onRefresh)
  refreshRef.current = onRefresh

  const manualRefresh = useCallback(() => {
    refreshRef.current()
  }, [])

  useEffect(() => {
    if (!companyId) return

    let isMounted = true
    let source: EventSource | null = null
    let pollTimer: ReturnType<typeof setInterval> | null = null
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null
    let reconnectAttempts = 0

    const startPolling = () => {
      if (pollTimer) return
      setConnectionStatus('polling')
      pollTimer = setInterval(() => {
        if (isMounted) refreshRef.current()
      }, pollIntervalMs)
    }

    const stopPolling = () => {
      if (pollTimer) {
        clearInterval(pollTimer)
        pollTimer = null
      }
    }

    const connectSSE = () => {
      if (!isMounted) return
      setConnectionStatus(reconnectAttempts > 0 ? 'reconnecting' : 'connecting')

      try {
        source = new EventSource(`/api/companies/${encodeURIComponent(companyId)}/office/stream`, {
          withCredentials: true,
        })

        source.onopen = () => {
          if (!isMounted) return
          reconnectAttempts = 0
          stopPolling()
          setConnectionStatus('connected')
          setLastEventAt(new Date())
        }

        source.onmessage = (event) => {
          if (!isMounted) return
          setLastEventAt(new Date())
          try {
            const data = JSON.parse(event.data)
            // Bỏ qua heartbeat ping
            if (data?.type === 'office.connected') {
              setConnectionStatus('connected')
              return
            }
          } catch {
            // plain text ping
          }
          refreshRef.current()
        }

        source.onerror = () => {
          if (!isMounted) return
          source?.close()
          source = null
          startPolling()

          // Thử kết nối lại với backoff
          reconnectAttempts++
          const delay = Math.min(3000 * Math.pow(1.5, reconnectAttempts), 20000)
          reconnectTimer = setTimeout(() => {
            if (isMounted) connectSSE()
          }, delay)
        }
      } catch {
        startPolling()
      }
    }

    connectSSE()

    return () => {
      isMounted = false
      if (source) source.close()
      if (pollTimer) clearInterval(pollTimer)
      if (reconnectTimer) clearTimeout(reconnectTimer)
    }
  }, [companyId, pollIntervalMs])

  return { connectionStatus, lastEventAt, manualRefresh }
}
