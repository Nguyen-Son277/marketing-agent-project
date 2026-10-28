import { z } from 'zod'
import type { AgentRole, ModelTier, TaskStatus } from './domain.ts'
import type { TaskView } from './api.ts'


/** Thông tin một phòng ban trên khuôn viên văn phòng isometric 3D. */
export interface OfficeRoom {
  readonly id: string
  readonly role: AgentRole
  /** Legacy alias retained for existing consumers; always equals role. */
  readonly department: string
  readonly nameVi: string
  readonly nameEn: string
  readonly descriptionVi: string
  readonly descriptionEn: string
  readonly themeColor: string // Mã màu pastel đặc trưng cho phòng ban
  readonly gridX: number
  readonly gridY: number
  readonly width: number
  readonly height: number
}

/** Danh sách 11 phòng ban tương ứng 11 Agent trong khuôn viên văn phòng AI 3D. */
export const OFFICE_ROOMS: readonly OfficeRoom[] = [
  {
    id: 'marketing-leader',
    role: 'marketing-leader',
    department: 'marketing-leader',
    nameVi: 'Phòng Điều hành & Lãnh đạo',
    nameEn: 'Executive Suite',
    descriptionVi: 'Điều hành chiến lược, phân bổ công việc và kiểm soát chất lượng.',
    descriptionEn: 'Leads strategy, task allocation, and quality control.',
    themeColor: '#E0AAFF',
    gridX: 500,
    gridY: 100,
    width: 320,
    height: 220,
  },
  {
    id: 'market-research',
    role: 'market-research',
    department: 'market-research',
    nameVi: 'Viện Nghiên cứu Thị trường',
    nameEn: 'Market Intel Lab',
    descriptionVi: 'Nghiên cứu thị trường, khách hàng và đối thủ cạnh tranh.',
    descriptionEn: 'Researches markets, customers, and competitors.',
    themeColor: '#A8DADC',
    gridX: 150,
    gridY: 120,
    width: 280,
    height: 200,
  },
  {
    id: 'content-writer',
    role: 'content-writer',
    department: 'content-writer',
    nameVi: 'Xưởng Sáng tạo Nội dung',
    nameEn: 'Content Hub',
    descriptionVi: 'Lên ý tưởng và sản xuất nội dung đa kênh.',
    descriptionEn: 'Plans and produces multi-channel content.',
    themeColor: '#FFD166',
    gridX: 850,
    gridY: 120,
    width: 280,
    height: 200,
  },
  {
    id: 'seo-technical',
    role: 'seo-technical',
    department: 'seo-technical',
    nameVi: 'Trạm Kỹ thuật SEO & Web',
    nameEn: 'SEO & Technical Pod',
    descriptionVi: 'Tối ưu SEO kỹ thuật, website và khả năng hiển thị tìm kiếm.',
    descriptionEn: 'Optimizes technical SEO, websites, and search visibility.',
    themeColor: '#06D6A0',
    gridX: 120,
    gridY: 360,
    width: 280,
    height: 200,
  },
  {
    id: 'web-technical',
    role: 'web-technical',
    department: 'web-technical',
    nameVi: 'Phòng Kỹ thuật Web & IT',
    nameEn: 'Web & IT Pod',
    descriptionVi: 'Quản trị website, sửa nội dung web, triển khai kỹ thuật và mã tracking.',
    descriptionEn: 'Manages websites, updates web content, deploys tracking and tech tasks.',
    themeColor: '#0EA5E9',
    gridX: 500,
    gridY: 640,
    width: 320,
    height: 200,
  },
  {
    id: 'social-media',
    role: 'social-media',
    department: 'social-media',
    nameVi: 'Studio Mạng xã hội',
    nameEn: 'Social Media Studio',
    descriptionVi: 'Lập kế hoạch và quản lý hoạt động trên mạng xã hội.',
    descriptionEn: 'Plans and manages social media activity.',
    themeColor: '#FF9EAA',
    gridX: 880,
    gridY: 360,
    width: 280,
    height: 200,
  },
  {
    id: 'paid-media',
    role: 'paid-media',
    department: 'paid-media',
    nameVi: 'Phòng Chiến dịch Ads',
    nameEn: 'Paid Ads War Room',
    descriptionVi: 'Thiết lập, tối ưu và theo dõi các chiến dịch quảng cáo trả phí.',
    descriptionEn: 'Launches, optimizes, and monitors paid advertising campaigns.',
    themeColor: '#F77F00',
    gridX: 500,
    gridY: 400,
    width: 320,
    height: 200,
  },
  {
    id: 'email-crm',
    role: 'email-crm',
    department: 'email-crm',
    nameVi: 'Trạm Chăm sóc & CRM',
    nameEn: 'CRM & Retention Lounge',
    descriptionVi: 'Nuôi dưỡng khách hàng tiềm năng và tăng khả năng giữ chân.',
    descriptionEn: 'Nurtures leads and improves customer retention.',
    themeColor: '#90E0EF',
    gridX: 150,
    gridY: 600,
    width: 280,
    height: 200,
  },
  {
    id: 'design-video',
    role: 'design-video',
    department: 'design-video',
    nameVi: 'Studio Thiết kế & Video',
    nameEn: 'Design & Motion Hub',
    descriptionVi: 'Tạo thiết kế hình ảnh, video và nội dung chuyển động.',
    descriptionEn: 'Creates visual design, video, and motion content.',
    themeColor: '#DDA15E',
    gridX: 850,
    gridY: 600,
    width: 280,
    height: 200,
  },
  {
    id: 'analytics',
    role: 'analytics',
    department: 'analytics',
    nameVi: 'Trung tâm Dữ liệu & Báo cáo',
    nameEn: 'Data Analytics Center',
    descriptionVi: 'Phân tích hiệu suất và xây dựng báo cáo marketing.',
    descriptionEn: 'Analyzes performance and builds marketing reports.',
    themeColor: '#B5E48C',
    gridX: 800,
    gridY: 820,
    width: 280,
    height: 200,
  },
  {
    id: 'community-care',
    role: 'community-care',
    department: 'community-care',
    nameVi: 'Trạm Hỗ trợ Cộng đồng',
    nameEn: 'Community Care Pod',
    descriptionVi: 'Hỗ trợ cộng đồng và phản hồi tương tác của khách hàng.',
    descriptionEn: 'Supports the community and responds to customer engagement.',
    themeColor: '#F8B4D9',
    gridX: 200,
    gridY: 820,
    width: 280,
    height: 200,
  },
]

export type OfficeFurnitureType =
  | 'desk' | 'chair' | 'dual_monitors' | 'laptop' | 'desk_lamp' | 'plant'
  | 'whiteboard' | 'server_rack' | 'bookshelf' | 'coffee_machine' | 'sofa'
  | 'ring_light' | 'drawing_tablet'

export interface OfficeFurnitureItem {
  readonly id: string
  readonly type: OfficeFurnitureType
  readonly labelVi: string
  readonly labelEn: string
  readonly relX: number
  readonly relY: number
  readonly scale?: number
  readonly rotation?: number
}

export interface OfficeWorkstation {
  readonly deskType: string
  readonly chairType: string
  readonly equipment: readonly string[]
  readonly decor?: readonly string[]
  readonly decorations?: readonly string[]
}

export type AgentOfficeStatus = 'idle' | 'working' | 'reviewing' | 'blocked' | 'done' | 'offline'

/** Trạng thái trực quan theo thời gian thực của từng Agent trong khuôn viên văn phòng. */
export interface AgentOfficeState {
  readonly agentDefId: string
  readonly role: AgentRole
  readonly department: string
  readonly name: string
  readonly displayName: string
  readonly isLeader: boolean
  readonly enabled: boolean
  readonly tier: ModelTier
  readonly modelLabel: string | null
  readonly status: AgentOfficeStatus
  readonly activityState?: 'typing' | 'reading' | 'inspecting' | 'calling' | 'relaxing' | 'idle' | 'offline'
  readonly screenMode?: 'active' | 'idle' | 'error' | 'off'
  readonly currentTaskId: string | null
  readonly currentTaskTitle: string | null
  readonly currentActionVi: string
  readonly currentActionEn: string
  readonly deskPosition: { readonly x: number; readonly y: number; readonly z: number }
  readonly workstation?: OfficeWorkstation
  readonly room?: OfficeRoom
  readonly preset?: unknown
  readonly today?: { readonly tokens: number; readonly costUsd: number; readonly completedTasks: number }
  readonly stats: {
    readonly tasksCompletedToday: number
    readonly tokensUsedToday: number
    readonly costUsdToday: number
  }
  readonly activeTools?: readonly string[]
}

/** Thống kê hoạt động của toàn khuôn viên văn phòng AI. */
export interface OfficeCampusStats {
  readonly totalAgents: number
  readonly activeAgents?: number
  readonly enabledAgents?: number
  readonly busyAgents?: number
  readonly workingAgents?: number
  readonly tasksToday?: number
  readonly tasksCompletedToday?: number
  readonly costUsdToday?: number
  readonly totalCostTodayUsd?: number
}

/** Phản hồi tổng quan khuôn viên văn phòng AI. */
export interface OfficeOverviewResponse {
  readonly campus: {
    readonly width: number
    readonly height: number
    readonly rooms: readonly OfficeRoom[]
  }
  readonly rooms: readonly OfficeRoom[]
  readonly agents: readonly AgentOfficeState[]
  readonly stats: OfficeCampusStats
  readonly recentTasks?: readonly unknown[]
}

/** Phản hồi chi tiết bàn làm việc của một Agent. */
export interface OfficeAgentDeskResponse {
  readonly agent: AgentOfficeState
  readonly skills: readonly { readonly name: string; readonly description: string; readonly category: string }[]
  readonly tools: readonly string[]
  readonly knowledge: readonly { readonly category: string; readonly canRead: boolean; readonly canWrite: boolean }[]
  readonly recentArtifacts: readonly {
    readonly id: string
    readonly taskId: string | null
    readonly name: string
    readonly kind: string
    readonly createdAt: string
  }[]
  readonly recentMessages: readonly {
    readonly id: string
    readonly fromAgent: string
    readonly toAgent: string
    readonly contentMd: string
    readonly createdAt: string
  }[]
}

/** Dữ liệu đầu vào giao việc nhanh từ văn phòng. */
export interface OfficeDispatchTaskInput {
  readonly assigneeRole: AgentRole
  readonly title: string
  readonly briefMd: string
  readonly priority?: number
  readonly deadline?: string
}

/** Kết quả giao việc nhanh. */
export interface OfficeDispatchTaskResponse {
  readonly task: TaskView
  readonly agentState: AgentOfficeState
}

/** Danh sách tác vụ văn phòng. */
export interface OfficeTasksResponse {
  readonly tasks: readonly TaskView[]
  readonly counts: Readonly<Record<TaskStatus, number>>
}

/** Phản hồi khi ping gõ cửa bàn làm việc. */
export interface OfficeDeskPingResponse {
  readonly ok: boolean
  readonly role: AgentRole
  readonly message: string
  readonly timestamp: string
}

/** Sự kiện stream SSE từ văn phòng. */
export interface OfficeStreamEvent {
  readonly type: string
  readonly companyId: string
  readonly at: string
  readonly payload: unknown
}

/* ------------------------------------------------------------- Zod schemas */

export const officeDispatchSchema = z.object({
  assigneeRole: z.string().min(1),
  title: z.string().min(1).max(200),
  briefMd: z.string().min(1).max(10000),
  priority: z.coerce.number().int().min(1).max(10).optional().default(5),
  deadline: z.string().optional(),
})

export const officeFilterSchema = z.object({
  role: z.string().optional(),
  status: z.string().optional(),
})

export const officeDeskPingSchema = z.object({
  message: z.string().max(500).optional(),
})
