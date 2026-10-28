import { memo, type ReactNode } from 'react'
import type { AgentOfficeState } from '@marketing-agent/shared'
import { useI18n } from '../../lib/i18n.tsx'

interface OfficeEmployeeProps {
  readonly agent: AgentOfficeState
  readonly roomColor: string
  readonly isWorking: boolean
  readonly isBlocked: boolean
  readonly isOffline: boolean
  readonly onInteract?: () => void
}

/** Cấu hình nhân vật đồ họa cá nhân hóa theo từng vai trò AI Agent */
interface CharacterStyle {
  readonly hairColor: string
  readonly hairStyle: 'slicked' | 'bob' | 'short_side' | 'messy' | 'ponytail' | 'bun' | 'curly'
  readonly skinColor: string
  readonly shirtColor: string
  readonly pantsColor: string
  readonly accessory?: 'glasses' | 'headset' | 'tie' | 'bandana' | 'lanyard'
  readonly professionLabelVi: string
  readonly professionLabelEn: string
}

const ROLE_STYLES: Record<string, CharacterStyle> = {
  'marketing-leader': {
    hairColor: '#2C1810',
    hairStyle: 'slicked',
    skinColor: '#F7D0B3',
    shirtColor: '#4A154B', // Vest tím than lịch lãm
    pantsColor: '#1E293B',
    accessory: 'tie',
    professionLabelVi: 'Trưởng phòng Điều hành',
    professionLabelEn: 'Marketing Director',
  },
  'market-research': {
    hairColor: '#4A3B32',
    hairStyle: 'short_side',
    skinColor: '#F3D2C1',
    shirtColor: '#0E7490', // Xanh teal học thuật
    pantsColor: '#334155',
    accessory: 'glasses',
    professionLabelVi: 'Chuyên viên Nghiên cứu',
    professionLabelEn: 'Market Analyst',
  },
  'content-writer': {
    hairColor: '#8B4513',
    hairStyle: 'bun',
    skinColor: '#FBE0D0',
    shirtColor: '#D97706', // Áo len ấm vàng mù tạt
    pantsColor: '#475569',
    accessory: 'glasses',
    professionLabelVi: 'Biên tập viên Nội dung',
    professionLabelEn: 'Content Creator',
  },
  'seo-technical': {
    hairColor: '#1C1917',
    hairStyle: 'curly',
    skinColor: '#E8B99A',
    shirtColor: '#059669', // Hoodie xanh kỹ thuật
    pantsColor: '#1E293B',
    accessory: 'glasses',
    professionLabelVi: 'Kỹ sư SEO & Web',
    professionLabelEn: 'SEO Specialist',
  },
  'web-technical': {
    hairColor: '#1E293B',
    hairStyle: 'short_side',
    skinColor: '#F7D0B3',
    shirtColor: '#0EA5E9', // Áo xanh sky tech
    pantsColor: '#0F172A',
    accessory: 'glasses',
    professionLabelVi: 'Kỹ sư Web & IT',
    professionLabelEn: 'Web & IT Engineer',
  },
  'social-media': {
    hairColor: '#B45309',
    hairStyle: 'ponytail',
    skinColor: '#FCE2D6',
    shirtColor: '#E11D48', // Áo hồng pastel năng động
    pantsColor: '#3B82F6',
    accessory: 'bandana',
    professionLabelVi: 'Chuyên viên Mạng xã hội',
    professionLabelEn: 'Social Media Manager',
  },
  'paid-media': {
    hairColor: '#1F2937',
    hairStyle: 'short_side',
    skinColor: '#EFC9AF',
    shirtColor: '#EA580C', // Áo polo cam nhiệt huyết
    pantsColor: '#1E293B',
    accessory: 'lanyard',
    professionLabelVi: 'Chuyên gia Quảng cáo',
    professionLabelEn: 'Paid Media Strategist',
  },
  'email-crm': {
    hairColor: '#374151',
    hairStyle: 'short_side',
    skinColor: '#F5D5C0',
    shirtColor: '#0284C7', // Sơ mi xanh sage thanh lịch
    pantsColor: '#475569',
    accessory: 'lanyard',
    professionLabelVi: 'Chuyên viên CRM & Email',
    professionLabelEn: 'CRM Specialist',
  },
  'design-video': {
    hairColor: '#3B1F2B',
    hairStyle: 'messy',
    skinColor: '#FCE0D2',
    shirtColor: '#854D0E', // Áo yếm nghệ thuật
    pantsColor: '#0F172A',
    accessory: 'bandana',
    professionLabelVi: 'Nhà thiết kế & Motion',
    professionLabelEn: 'Motion Designer',
  },
  'analytics': {
    hairColor: '#2D3748',
    hairStyle: 'short_side',
    skinColor: '#F2CEB8',
    shirtColor: '#4F46E5', // Sơ mi oxford xanh dương
    pantsColor: '#1E293B',
    accessory: 'glasses',
    professionLabelVi: 'Chuyên gia Dữ liệu',
    professionLabelEn: 'Data Analyst',
  },
  'community-care': {
    hairColor: '#451A03',
    hairStyle: 'bob',
    skinColor: '#FDE1D2',
    shirtColor: '#DB2777', // Áo cardigan hồng dịu dàng
    pantsColor: '#334155',
    accessory: 'headset',
    professionLabelVi: 'Chăm sóc Cộng đồng',
    professionLabelEn: 'Community Care',
  },
}

export const OfficeEmployee = memo(function OfficeEmployee({
  agent,
  roomColor,
  isWorking,
  isBlocked,
  isOffline,
  onInteract,
}: OfficeEmployeeProps): ReactNode {
  const { locale } = useI18n()
  const style = ROLE_STYLES[agent.role] ?? {
    hairColor: '#334155',
    hairStyle: 'short_side',
    skinColor: '#F7D0B3',
    shirtColor: roomColor,
    pantsColor: '#1E293B',
    professionLabelVi: 'Nhân viên AI',
    professionLabelEn: 'AI Specialist',
  }

  const roleName = locale === 'en' ? style.professionLabelEn : style.professionLabelVi
  const actionText = locale === 'en' ? agent.currentActionEn : agent.currentActionVi

  if (isOffline) {
    return (
      <div
        className="office-employee office-employee--offline"
        title={`${agent.displayName} (${roleName}) - Offline`}
        onClick={onInteract}
      >
        {/* Ghế xoay văn phòng khi nhân viên vắng mặt */}
        <div className="office-chair office-chair--empty">
          <div className="office-chair__backrest" />
          <div className="office-chair__seat" />
          <div className="office-chair__base" />
        </div>
        <div className="office-offline-indicator" title="Nhân viên đang nghỉ ngơi">
          <span>💤</span>
        </div>
      </div>
    )
  }

  return (
    <div
      className={`office-employee office-employee--${agent.status}`}
      title={`${agent.displayName} (${roleName})\n• ${actionText}`}
      onClick={onInteract}
    >
      {/* Bong bóng trạng thái suy nghĩ / cảnh báo phía trên đầu */}
      {(isWorking || isBlocked) && (
        <div className={`office-employee__bubble ${isBlocked ? 'office-employee__bubble--blocked' : ''}`}>
          <span className="office-employee__bubble-icon">{isBlocked ? '⚠️' : '⚡'}</span>
          <span className="office-employee__bubble-text">
            {agent.currentTaskTitle || actionText}
          </span>
        </div>
      )}

      {/* Ghế công thái học tựa lưng phía sau nhân viên */}
      <div className="office-chair">
        <div className="office-chair__backrest" />
        <div className="office-chair__armrest-left" />
        <div className="office-chair__armrest-right" />
        <div className="office-chair__seat" />
        <div className="office-chair__base" />
      </div>

      {/* Nhân vật đồ họa Isometric chi tiết (SVG Nhân viên) */}
      <div className="office-employee__avatar">
        <svg
          width="54"
          height="70"
          viewBox="0 0 54 70"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          className="office-employee__svg"
        >
          {/* Bóng đổ cơ thể */}
          <ellipse cx="27" cy="66" rx="16" ry="4" fill="rgba(0,0,0,0.12)" />

          {/* Chân / Quần */}
          <path d="M19 46 L21 62 L26 62 L24 46 Z" fill={style.pantsColor} />
          <path d="M35 46 L33 62 L28 62 L30 46 Z" fill={style.pantsColor} />

          {/* Giày da công sở */}
          <ellipse cx="23" cy="62" rx="3.5" ry="2" fill="#0F172A" />
          <ellipse cx="31" cy="62" rx="3.5" ry="2" fill="#0F172A" />

          {/* Thân mình / Áo */}
          <path
            d="M17 28 C17 25, 37 25, 37 28 L35 48 C35 50, 19 50, 19 48 Z"
            fill={style.shirtColor}
          />

          {/* Cà vạt / Phụ kiện cổ nếu có */}
          {style.accessory === 'tie' && (
            <path d="M26 27 L28 27 L29 37 L27 40 L25 37 Z" fill="#F43F5E" />
          )}

          {/* Tay áo & Cánh tay (Đang đặt về phía trước bàn) */}
          <g className={`office-employee__arms ${isWorking ? 'office-employee__arms--typing' : ''}`}>
            {/* Cánh tay trái */}
            <path
              d="M18 30 C15 35, 16 42, 22 45"
              stroke={style.shirtColor}
              strokeWidth="5"
              strokeLinecap="round"
            />
            {/* Bàn tay trái */}
            <circle cx="23" cy="45" r="2.5" fill={style.skinColor} />

            {/* Cánh tay phải */}
            <path
              d="M36 30 C39 35, 38 42, 32 45"
              stroke={style.shirtColor}
              strokeWidth="5"
              strokeLinecap="round"
            />
            {/* Bàn tay phải */}
            <circle cx="31" cy="45" r="2.5" fill={style.skinColor} />
          </g>

          {/* Cổ */}
          <rect x="25" y="23" width="4" height="5" rx="1" fill={style.skinColor} />

          {/* Đầu & Khuôn mặt */}
          <circle cx="27" cy="18" r="9.5" fill={style.skinColor} />

          {/* Tai nghe CSKH nếu có */}
          {style.accessory === 'headset' && (
            <g>
              <path d="M16 16 C16 9, 38 9, 38 16" stroke="#475569" strokeWidth="2.5" fill="none" />
              <rect x="15" y="15" width="3" height="6" rx="1.5" fill="#0284C7" />
              <rect x="36" y="15" width="3" height="6" rx="1.5" fill="#0284C7" />
              <path d="M37 19 L32 23" stroke="#475569" strokeWidth="1.5" strokeLinecap="round" />
              <circle cx="31" cy="23.5" r="1.5" fill="#0284C7" />
            </g>
          )}

          {/* Tóc */}
          <path
            d="M17.5 17 C17.5 10, 36.5 10, 36.5 17 C35 14, 30 13, 27 13 C23 13, 19 14, 17.5 17 Z"
            fill={style.hairColor}
          />
          {style.hairStyle === 'bun' && (
            <circle cx="27" cy="7" r="4.5" fill={style.hairColor} />
          )}
          {style.hairStyle === 'ponytail' && (
            <path d="M35 14 C40 16, 42 22, 39 26" stroke={style.hairColor} strokeWidth="3.5" strokeLinecap="round" fill="none" />
          )}

          {/* Mắt & Biểu cảm */}
          <circle cx="24" cy="18" r="1.2" fill="#1E293B" />
          <circle cx="30" cy="18" r="1.2" fill="#1E293B" />

          {/* Kính cận nếu có */}
          {style.accessory === 'glasses' && (
            <g stroke="#334155" strokeWidth="1.2" fill="rgba(255,255,255,0.4)">
              <rect x="21" y="16" width="5.5" height="4.5" rx="1" />
              <rect x="27.5" y="16" width="5.5" height="4.5" rx="1" />
              <line x1="26.5" y1="18" x2="27.5" y2="18" />
            </g>
          )}

          {/* Miệng mỉm cười thân thiện */}
          <path d="M25 22 Q27 23.5 29 22" stroke="#1E293B" strokeWidth="1" strokeLinecap="round" fill="none" />
        </svg>
      </div>
    </div>
  )
})
