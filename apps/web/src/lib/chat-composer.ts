/** Plain Enter only; composition guards include legacy browser IME keyCode 229. */
export function shouldSendChatKey(event: {
  key: string; shiftKey: boolean; ctrlKey: boolean; altKey: boolean; metaKey: boolean
  repeat: boolean; isComposing?: boolean; keyCode?: number
}, composing: boolean): boolean {
  return event.key === 'Enter' && !event.shiftKey && !event.ctrlKey && !event.altKey && !event.metaKey &&
    !event.repeat && !event.isComposing && !composing && event.keyCode !== 229
}

/** Synchronous shared lock: React busy state alone doesn't protect same-tick submits. */
export function acquireChatSend(lock: { current: boolean }): boolean {
  if (lock.current) return false
  lock.current = true
  return true
}
