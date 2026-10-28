import type { AgentOfficeStatus, TaskRecord } from '@marketing-agent/shared'

export interface AgentActivityDerived {
  readonly status: AgentOfficeStatus
  readonly activityState: 'typing' | 'reading' | 'inspecting' | 'calling' | 'relaxing' | 'idle' | 'offline'
  readonly screenMode: 'active' | 'idle' | 'error' | 'off'
  readonly currentActionVi: string
  readonly currentActionEn: string
}

export function deriveAgentActivity(task: TaskRecord | undefined, presetEnabled: boolean): AgentActivityDerived {
  if (!presetEnabled) {
    return {
      status: 'offline',
      activityState: 'offline',
      screenMode: 'off',
      currentActionVi: 'Đang tắt / Nghỉ ngơi',
      currentActionEn: 'Offline / Standby',
    }
  }

  if (task) {
    if (task.status === 'in_progress') {
      return {
        status: 'working',
        activityState: 'typing',
        screenMode: 'active',
        currentActionVi: `Đang thực hiện: ${task.title}`,
        currentActionEn: `Working on: ${task.title}`,
      }
    }

    if (task.status === 'review') {
      return {
        status: 'reviewing',
        activityState: 'reading',
        screenMode: 'active',
        currentActionVi: `Đang rà soát kết quả: ${task.title}`,
        currentActionEn: `Reviewing: ${task.title}`,
      }
    }

    if (task.status === 'blocked') {
      return {
        status: 'blocked',
        activityState: 'inspecting',
        screenMode: 'error',
        currentActionVi: `Đang bị chặn: ${task.title}`,
        currentActionEn: `Blocked: ${task.title}`,
      }
    }

    if (task.status === 'assigned') {
      return {
        status: 'working',
        activityState: 'typing',
        screenMode: 'active',
        currentActionVi: `Tiếp nhận nhiệm vụ: ${task.title}`,
        currentActionEn: `Starting task: ${task.title}`,
      }
    }
  }

  return {
    status: 'idle',
    activityState: 'relaxing',
    screenMode: 'idle',
    currentActionVi: 'Sẵn sàng nhận nhiệm vụ',
    currentActionEn: 'Ready for tasks',
  }
}

export interface CharacterTraits {
  readonly outfitColor: string
  readonly outfitType: string
  readonly hairStyle: string
  readonly accessory: string
  readonly icon: string
}

export const ROLE_CHARACTER_TRAITS: Record<string, CharacterTraits> = {
  'marketing-leader': {
    outfitColor: '#7C3AED',
    outfitType: 'executive_suit',
    hairStyle: 'neat_parted',
    accessory: 'silk_tie',
    icon: '👔',
  },
  'market-research': {
    outfitColor: '#0D9488',
    outfitType: 'analyst_vest',
    hairStyle: 'short_glasses',
    accessory: 'smart_glasses',
    icon: '🔭',
  },
  'content-writer': {
    outfitColor: '#D97706',
    outfitType: 'casual_knitwear',
    hairStyle: 'creative_bun',
    accessory: 'over_ear_headphones',
    icon: '✍️',
  },
  'seo-technical': {
    outfitColor: '#059669',
    outfitType: 'tech_hoodie',
    hairStyle: 'curly_modern',
    accessory: 'blue_light_glasses',
    icon: '⚙️',
  },
  'web-technical': {
    outfitColor: '#0284C7',
    outfitType: 'tech_hoodie',
    hairStyle: 'short_crew',
    accessory: 'blue_light_glasses',
    icon: '💻',
  },
  'social-media': {
    outfitColor: '#E11D48',
    outfitType: 'trendy_tshirt',
    hairStyle: 'high_ponytail',
    accessory: 'earbuds',
    icon: '📱',
  },
  'paid-media': {
    outfitColor: '#EA580C',
    outfitType: 'smart_polo',
    hairStyle: 'slicked_back',
    accessory: 'smartwatch',
    icon: '🎯',
  },
  'email-crm': {
    outfitColor: '#0284C7',
    outfitType: 'linen_shirt',
    hairStyle: 'wavy_soft',
    accessory: 'id_lanyard',
    icon: '💌',
  },
  'design-video': {
    outfitColor: '#B45309',
    outfitType: 'denim_apron',
    hairStyle: 'artistic_messy',
    accessory: 'bandana',
    icon: '🎨',
  },
  'analytics': {
    outfitColor: '#4F46E5',
    outfitType: 'oxford_shirt',
    hairStyle: 'clean_cut',
    accessory: 'badge_clip',
    icon: '📊',
  },
  'community-care': {
    outfitColor: '#DB2777',
    outfitType: 'soft_cardigan',
    hairStyle: 'bob_cut',
    accessory: 'call_headset',
    icon: '🤝',
  },
}

export function getRoleCharacterTraits(role: string): CharacterTraits {
  return (
    ROLE_CHARACTER_TRAITS[role] ?? {
      outfitColor: '#475569',
      outfitType: 'business_casual',
      hairStyle: 'standard',
      accessory: 'none',
      icon: '🤖',
    }
  )
}
