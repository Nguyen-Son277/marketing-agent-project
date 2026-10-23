import { z } from 'zod'

export const SOCIAL_PLATFORMS = [
  'facebook',
  'tiktok',
  'linkedin',
  'youtube',
  'x',
  'reddit',
  'threads',
  'other',
] as const
export const SOCIAL_ASSET_MAX_BYTES = 256 * 1024 * 1024
export const SOCIAL_ASSET_TYPES: Readonly<Record<string, string>> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  webm: 'video/webm',
}
const text = z.string().trim().min(1)
export const browserDesktopSchema = z.object({
  name: text.max(120),
  endpoint: z.string().url().max(500),
  token: text.min(32).max(512),
  region: text.max(120),
})
export const browserDesktopUpdateSchema = browserDesktopSchema.extend({
  token: text.min(32).max(512).optional(),
})
export const browserChannelSchema = z.object({
  desktopId: text,
  name: text.max(120),
  platform: z.enum(SOCIAL_PLATFORMS),
  entryUrl: z.string().url().max(2000),
  allowedHosts: z
    .array(
      z
        .string()
        .trim()
        .toLowerCase()
        .regex(/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/),
    )
    .min(1)
    .max(20),
  instructions: z.string().trim().max(20000).default(''),
  canPost: z.boolean().default(true),
})
export const browserContentSchema = z.object({ title: text.max(200), body: z.string().max(100000) })
export const browserJobSchema = z
  .object({
    channelId: text,
    contentId: text.optional(),
    kind: z.enum(['publish', 'read']),
    instructions: z.string().trim().max(20000).default(''),
    idempotencyKey: text.max(200),
  })
  .refine((v) => v.kind !== 'publish' || !!v.contentId, 'Đăng bài cần nội dung đã lưu')
export const browserModeSchema = z.object({ mode: z.enum(['human', 'agent', 'paused']) })
export const browserLocatorSchema = z.object({
  role: z.enum([
    'button',
    'link',
    'textbox',
    'combobox',
    'option',
    'menuitem',
    'tab',
    'checkbox',
    'radio',
    'spinbutton',
  ]),
  name: z.string().max(500),
  index: z.number().int().min(0).max(100).default(0),
})
export const browserActionSchema = z.object({
  operation: z.enum([
    'start',
    'snapshot',
    'navigate',
    'click',
    'fill',
    'key',
    'scroll',
    'upload',
    'finish',
    'handoff',
  ]),
  url: z.string().url().max(2000).optional(),
  locator: browserLocatorSchema.optional(),
  text: z.string().max(100000).optional(),
  key: z.enum(['Enter', 'Tab', 'Escape', 'ArrowDown', 'ArrowUp']).optional(),
  direction: z.enum(['up', 'down']).optional(),
  assetIds: z.array(text).max(20).optional(),
  resultUrl: z.string().url().max(2000).optional(),
  result: z.string().max(100000).optional(),
})
export const browserHumanInputSchema = z.discriminatedUnion('operation', [
  z.object({
    operation: z.literal('click'),
    x: z.number().int().min(0).max(10000),
    y: z.number().int().min(0).max(10000),
  }),
  z.object({ operation: z.literal('text'), text: z.string().min(1).max(10000) }),
  z.object({
    operation: z.literal('key'),
    key: z.enum([
      'Return',
      'Tab',
      'Escape',
      'BackSpace',
      'Delete',
      'Left',
      'Right',
      'Up',
      'Down',
      'ctrl+a',
      'ctrl+c',
      'ctrl+v',
      'ctrl+l',
      'ctrl+Tab',
    ]),
  }),
  z.object({ operation: z.literal('scroll'), direction: z.enum(['up', 'down']) }),
  z.object({ operation: z.literal('navigate'), url: z.string().url().max(2000) }),
])
export type BrowserChannelInput = z.infer<typeof browserChannelSchema>
export type BrowserAction = z.infer<typeof browserActionSchema>
export type BrowserHumanInput = z.infer<typeof browserHumanInputSchema>
export interface BrowserDesktopView {
  id: string
  companyId: string
  name: string
  endpoint: string
  region: string
  mode: 'human' | 'agent' | 'paused'
  activeJobId: string | null
  createdAt: string
}
export interface BrowserChannelView extends BrowserChannelInput {
  id: string
  companyId: string
  createdAt: string
}
export interface BrowserAssetView {
  id: string
  companyId: string
  contentId: string
  filename: string
  mimeType: string
  sizeBytes: number
  createdAt: string
}
export interface BrowserContentView {
  id: string
  companyId: string
  title: string
  body: string
  assets: BrowserAssetView[]
  createdAt: string
  updatedAt: string
}
export type BrowserJobStatus = 'queued' | 'running' | 'waiting_human' | 'succeeded' | 'failed' | 'cancelled'
export interface BrowserJobView {
  id: string
  companyId: string
  channelId: string
  contentId: string | null
  kind: 'publish' | 'read'
  status: BrowserJobStatus
  instructions: string
  resultUrl: string | null
  result: string | null
  createdAt: string
  updatedAt: string
}
export interface BrowserJobEvent {
  id: string
  jobId: string
  operation: string
  outcome: string
  createdAt: string
}
export interface BrowserOverview {
  desktops: BrowserDesktopView[]
  channels: BrowserChannelView[]
  contents: BrowserContentView[]
  jobs: BrowserJobView[]
  canManage: boolean
}

/** A channel may use subdomains, never lookalikes or credential-bearing URLs. */
export function isBrowserUrlAllowed(raw: string, hosts: readonly string[]): boolean {
  try {
    const url = new URL(raw)
    return (
      url.protocol === 'https:' &&
      !url.username &&
      !url.password &&
      (!url.port || url.port === '443') &&
      hosts.some((h) => url.hostname === h || url.hostname.endsWith(`.${h}`))
    )
  } catch {
    return false
  }
}

/** These operations are reserved for the human remote-control surface. */
export function isBrowserAuthTarget(value: string): boolean {
  return /(?:\b(?:log[\s_-]?in|log[\s_-]?out|sign[\s_-]?in|sign[\s_-]?out|sign[\s_-]?up|password|passcode|username|captcha|checkpoint|challenge|two[\s_-]?factor|verify[\s_-]?identity)\b|đăng\s*(?:nhập|xuất|ký)|mật\s*khẩu|xác\s*(?:minh|thực))/iu.test(
    value,
  )
}

export function isBrowserAccountChange(value: string): boolean {
  return /(?:\b(?:delete\s+(?:account|profile)|switch\s+account|account\s+settings|security\s+settings|change\s+(?:password|email|username)|billing|payment|purchase|checkout)\b|xóa\s*tài\s*khoản|chuyển\s*tài\s*khoản|cài\s*đặt\s*tài\s*khoản|đổi\s*mật\s*khẩu|thanh\s*toán)/iu.test(
    value,
  )
}
