import { z } from 'zod'

export const wordpressSiteSchema = z.object({
  name: z.string().trim().min(1).max(120),
  url: z
    .string()
    .url()
    .refine((v) => {
      const u = new URL(v)
      return (
        u.protocol === 'https:' &&
        !u.username &&
        !u.password &&
        !u.search &&
        !u.hash
      )
    }, 'Cần URL HTTPS không chứa credential/query'),
  environment: z.enum(['production', 'staging']).default('production'),
  username: z.string().trim().min(1).max(120),
  applicationPassword: z.string().min(8).max(200),
  browserChannelId: z.string().nullable().optional(),
  seoPlugin: z.enum(['yoast', 'rankmath']).nullable().optional(),
})
export type WordpressSiteInput = z.infer<typeof wordpressSiteSchema>
export const wordpressResourceSchema = z.enum([
  'posts',
  'pages',
  'media',
  'categories',
  'tags',
  'templates',
  'template-parts',
  'global-styles',
])
export const wordpressJobSchema = z.object({
  siteId: z.string().min(1),
  action: z.enum([
    'create',
    'update',
    'trash',
    'seo',
    'audit',
    'optimize',
    'admin',
    'restore',
  ]),
  resource: wordpressResourceSchema.default('posts'),
  resourceId: z
    .union([z.number().int().positive(), z.string().regex(/^[a-zA-Z0-9_/-]+$/)])
    .optional(),
  data: z.record(z.unknown()).default({}),
  urls: z.array(z.string().url()).max(5).optional(),
  sourceJobId: z.string().optional(),
  idempotencyKey: z.string().min(8).max(200),
})
export type WordpressJobInput = z.infer<typeof wordpressJobSchema>
export interface WordpressSiteView {
  id: string
  companyId: string
  name: string
  url: string
  environment: 'production' | 'staging'
  username: string
  browserChannelId: string | null
  seoPlugin: 'yoast' | 'rankmath' | null
  enabled: boolean
  capabilities: Record<string, unknown>
  checkedAt: string | null
  createdAt: string
}
export interface WordpressJobView {
  id: string
  companyId: string
  siteId: string
  actorId: string
  action: WordpressJobInput['action']
  input: WordpressJobInput
  status: string
  snapshot: unknown
  result: unknown
  error: string | null
  approvalHash: string | null
  approvedBy: string | null
  createdAt: string
  updatedAt: string
}
