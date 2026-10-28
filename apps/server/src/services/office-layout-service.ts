import type { AgentRole } from '@marketing-agent/shared'

/** Furniture props positioned relative to the room's isometric footprint. */
export interface OfficeFurnitureItem {
  readonly id: string
  readonly type: string
  readonly relX: number
  readonly relY: number
  readonly scale: number
}

/** Role-specific desk setup for an AI office workstation. */
export interface OfficeWorkstation {
  readonly deskType: string
  readonly chairType: string
  readonly equipment: readonly string[]
  readonly decorations: readonly string[]
}

const WORKSTATIONS: Record<AgentRole, OfficeWorkstation> = {
  'marketing-leader': {
    deskType: 'executive_l_desk',
    chairType: 'executive_leather_chair',
    equipment: ['dual_ultrawide_monitors', 'mechanical_keyboard', 'conference_mic'],
    decorations: ['strategy_whiteboard', 'desk_lamp_brass', 'succulent_planter'],
  },
  'market-research': {
    deskType: 'standard_pastel_desk',
    chairType: 'mesh_ergonomic_chair',
    equipment: ['dual_monitors', 'laptop', 'radar_chart_screen'],
    decorations: ['research_library_books', 'desk_lamp', 'coffee_mug'],
  },
  'content-writer': {
    deskType: 'creative_wood_desk',
    chairType: 'cushioned_task_chair',
    equipment: ['ultrawide_monitor', 'mechanical_keyboard', 'tablet'],
    decorations: ['story_pinboard', 'steaming_coffee', 'bonsai_plant'],
  },
  'seo-technical': {
    deskType: 'sit_stand_desk',
    chairType: 'high_back_ergonomic_chair',
    equipment: ['dual_vertical_monitors', 'crawler_terminal', 'mechanical_keyboard'],
    decorations: ['mini_server_tower', 'led_strip_cyan', 'energy_drink'],
  },
  'web-technical': {
    deskType: 'dev_dual_monitor_desk',
    chairType: 'mesh_ergonomic_chair',
    equipment: ['dual_code_monitors', 'mechanical_keyboard', 'terminal_screen'],
    decorations: ['code_mascot_duck', 'coffee_mug', 'server_status_light'],
  },
  'social-media': {
    deskType: 'studio_desk',
    chairType: 'modern_swivel_chair',
    equipment: ['curved_monitor', 'smartphone_dock', 'ring_light_stand'],
    decorations: ['social_feed_tablet', 'pastel_mug', 'monstera_plant'],
  },
  'paid-media': {
    deskType: 'metric_war_desk',
    chairType: 'mesh_ergonomic_chair',
    equipment: ['triple_monitors', 'roas_live_display', 'keyboard'],
    decorations: ['budget_ticker', 'desk_clock', 'coffee_tumbler'],
  },
  'email-crm': {
    deskType: 'lounge_desk',
    chairType: 'comfort_armchair',
    equipment: ['dual_monitors', 'automation_flow_screen'],
    decorations: ['mailbox_prop', 'warm_desk_lamp', 'tea_cup'],
  },
  'design-video': {
    deskType: 'creator_drafting_desk',
    chairType: 'pro_studio_chair',
    equipment: ['calibrated_4k_display', 'wacom_drawing_tablet', 'stylus_pen'],
    decorations: ['color_swatch_wheel', 'film_reel_stand', 'cactus_pot'],
  },
  analytics: {
    deskType: 'datacenter_desk',
    chairType: 'mesh_ergonomic_chair',
    equipment: ['triple_analytics_displays', 'matrix_keyboard'],
    decorations: ['mini_server_rack', 'blinking_leds', 'espresso_cup'],
  },
  'community-care': {
    deskType: 'care_desk',
    chairType: 'comfort_swivel_chair',
    equipment: ['dual_monitors', 'headset_with_mic', 'customer_ticket_pad'],
    decorations: ['star_rating_badge', 'pastel_water_bottle', 'peace_lily_plant'],
  },
}

const DECOR_ITEMS: Record<AgentRole, readonly OfficeFurnitureItem[]> = {
  'marketing-leader': [
    { id: 'strategy_whiteboard', type: 'strategy_whiteboard', relX: 0.18, relY: 0.18, scale: 1.15 },
    { id: 'desk_lamp_brass', type: 'desk_lamp_brass', relX: 0.73, relY: 0.34, scale: 0.8 },
    { id: 'succulent_planter', type: 'succulent_planter', relX: 0.82, relY: 0.72, scale: 0.7 },
    { id: 'executive_rug', type: 'executive_rug', relX: 0.5, relY: 0.72, scale: 1.1 },
  ],
  'market-research': [
    { id: 'research_library_books', type: 'research_library_books', relX: 0.15, relY: 0.22, scale: 0.9 },
    { id: 'desk_lamp', type: 'desk_lamp', relX: 0.72, relY: 0.3, scale: 0.75 },
    { id: 'coffee_mug', type: 'coffee_mug', relX: 0.78, relY: 0.7, scale: 0.55 },
  ],
  'content-writer': [
    { id: 'story_pinboard', type: 'story_pinboard', relX: 0.16, relY: 0.2, scale: 1.05 },
    { id: 'steaming_coffee', type: 'steaming_coffee', relX: 0.75, relY: 0.31, scale: 0.6 },
    { id: 'bonsai_plant', type: 'bonsai_plant', relX: 0.8, relY: 0.75, scale: 0.75 },
    { id: 'book_stack', type: 'book_stack', relX: 0.2, relY: 0.77, scale: 0.7 },
  ],
  'seo-technical': [
    { id: 'mini_server_tower', type: 'mini_server_tower', relX: 0.18, relY: 0.22, scale: 0.9 },
    { id: 'led_strip_cyan', type: 'led_strip_cyan', relX: 0.76, relY: 0.25, scale: 0.8 },
    { id: 'energy_drink', type: 'energy_drink', relX: 0.8, relY: 0.72, scale: 0.55 },
  ],
  'web-technical': [
    { id: 'server_terminal_rack', type: 'server_terminal_rack', relX: 0.18, relY: 0.22, scale: 0.9 },
    { id: 'dual_monitors_dev', type: 'dual_monitors_dev', relX: 0.76, relY: 0.25, scale: 0.85 },
    { id: 'coffee_machine_dev', type: 'coffee_machine_dev', relX: 0.8, relY: 0.72, scale: 0.6 },
  ],
  'social-media': [
    { id: 'social_feed_tablet', type: 'social_feed_tablet', relX: 0.2, relY: 0.2, scale: 0.8 },
    { id: 'pastel_mug', type: 'pastel_mug', relX: 0.73, relY: 0.32, scale: 0.55 },
    { id: 'monstera_plant', type: 'monstera_plant', relX: 0.82, relY: 0.76, scale: 0.95 },
    { id: 'studio_rug', type: 'studio_rug', relX: 0.48, relY: 0.75, scale: 1.1 },
  ],
  'paid-media': [
    { id: 'budget_ticker', type: 'budget_ticker', relX: 0.16, relY: 0.2, scale: 0.9 },
    { id: 'desk_clock', type: 'desk_clock', relX: 0.75, relY: 0.3, scale: 0.65 },
    { id: 'coffee_tumbler', type: 'coffee_tumbler', relX: 0.8, relY: 0.74, scale: 0.6 },
    { id: 'campaign_board', type: 'campaign_board', relX: 0.83, relY: 0.2, scale: 0.9 },
  ],
  'email-crm': [
    { id: 'mailbox_prop', type: 'mailbox_prop', relX: 0.2, relY: 0.22, scale: 0.85 },
    { id: 'warm_desk_lamp', type: 'warm_desk_lamp', relX: 0.74, relY: 0.3, scale: 0.75 },
    { id: 'tea_cup', type: 'tea_cup', relX: 0.78, relY: 0.72, scale: 0.55 },
  ],
  'design-video': [
    { id: 'color_swatch_wheel', type: 'color_swatch_wheel', relX: 0.18, relY: 0.2, scale: 0.9 },
    { id: 'film_reel_stand', type: 'film_reel_stand', relX: 0.78, relY: 0.22, scale: 0.85 },
    { id: 'cactus_pot', type: 'cactus_pot', relX: 0.8, relY: 0.74, scale: 0.7 },
    { id: 'palette_stand', type: 'palette_stand', relX: 0.2, relY: 0.76, scale: 0.8 },
  ],
  analytics: [
    { id: 'mini_server_rack', type: 'mini_server_rack', relX: 0.17, relY: 0.2, scale: 0.95 },
    { id: 'blinking_leds', type: 'blinking_leds', relX: 0.76, relY: 0.24, scale: 0.65 },
    { id: 'espresso_cup', type: 'espresso_cup', relX: 0.8, relY: 0.73, scale: 0.55 },
  ],
  'community-care': [
    { id: 'star_rating_badge', type: 'star_rating_badge', relX: 0.18, relY: 0.2, scale: 0.85 },
    { id: 'pastel_water_bottle', type: 'pastel_water_bottle', relX: 0.75, relY: 0.3, scale: 0.6 },
    { id: 'peace_lily_plant', type: 'peace_lily_plant', relX: 0.82, relY: 0.75, scale: 0.9 },
  ],
}

const DEFAULT_ROLE: AgentRole = 'marketing-leader'

/** Return the specific workstation setup for a role (unknown roles use the leader setup). */
export function getRoomWorkstation(role: string): OfficeWorkstation {
  const workstation = WORKSTATIONS[role as AgentRole] ?? WORKSTATIONS[DEFAULT_ROLE]
  return {
    ...workstation,
    equipment: [...workstation.equipment],
    decorations: [...workstation.decorations],
  }
}

/** Return 3–5 isometric decor props with normalized room-relative positions. */
export function getRoomDecorItems(role: string): OfficeFurnitureItem[] {
  const items = DECOR_ITEMS[role as AgentRole] ?? DECOR_ITEMS[DEFAULT_ROLE]
  return items.map((item) => ({ ...item }))
}

export { WORKSTATIONS as OFFICE_WORKSTATIONS, DECOR_ITEMS as OFFICE_DECOR_ITEMS }