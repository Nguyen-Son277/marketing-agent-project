/**
 * Namespace `team` cho catalog tiếng Anh.
 *
 * Tách riêng một file cho mỗi màn hình vì lý do phối hợp: nhiều người cùng bổ sung
 * chuỗi dịch, và nếu tất cả sửa chung một file thì mỗi lần gộp là một lần xung đột.
 * Một file một màn hình làm cho phạm vi sửa của mỗi người là rời nhau.
 *
 * Khoá trong file này PHẢI có tiền tố `team.` để không đụng namespace khác.
 *
 * "Agent", "Leader" và "brief" giữ nguyên: chúng là tên vai trò của sản phẩm, dịch ra
 * sẽ khiến giao diện và tài liệu gọi cùng một thứ bằng hai cái tên.
 *
 * Tham số đếm đặt tên `n` chứ không phải `count`: i18next coi `count` là tín hiệu số
 * ít/số nhiều nên sẽ đi tìm khoá `_one`/`_other` không tồn tại trong catalog phẳng.
 */
export const en_team = {
  'team.loading': 'Loading the team configuration…',
  'team.subtitle':
    'Turn agents on or off, pick models, and assign skills, tools, and knowledge read/write access. Each agent is saved separately.',
  'team.finishSetup': 'Open “Settings” to finish configuration before using this screen.',

  'team.enabledAgents': 'Agents enabled',
  'team.availableSkills': 'Available skills',
  'team.availableSkillsHint': 'Known to the system',
  'team.availableTools': 'Available tools',
  'team.availableToolsHint': 'In this deployment',
  'team.needsApproval': 'Needs approval',
  'team.needsApprovalHint': 'Tools do not run until approved',
  'team.toolApprovalMark': ' · needs approval',

  'team.noSkillsTitle': 'Agents with no skills:',
  'team.noSkillsBody':
    '{{members}}. An agent with no skills gets no working method; assign at least one skill.',
  'team.noCategoriesTitle': 'Agents that cannot read any knowledge category:',
  'team.noCategoriesBody':
    '{{members}}. These agents are filtered out of knowledge-base results; grant read access to at least one category.',
  'team.empty': 'This company has no agents yet. Check the company setup step.',

  'team.enabled': 'Enabled',
  'team.collapse': 'Collapse',
  'team.configure': 'Configure',
  'team.currentTier': 'Current tier: {{tier}}',
  'team.modelLabel': 'Model: {{model}}',
  'team.modelOption': '{{model}} · {{provider}}',
  'team.defaultByTier': 'tier default',
  'team.providerLabel': 'Provider: {{provider}}',
  'team.noValue': '—',
  'team.skillCount': '{{n}} skills',
  'team.toolCount': '{{n}} tools',
  'team.readableCategories': '{{n}} readable categories',
  'team.contextBudget': 'Context budget: {{n}} tokens',

  'team.saveSuccess': 'Saved the configuration for {{name}}.',
  'team.saveError': 'Could not save the configuration.',
  'team.memberNoSkills': 'This agent has no skills assigned.',
  'team.memberNoCategories': 'This agent cannot read any knowledge category.',

  'team.skillsHeading': 'Skills ({{n}})',
  'team.toolsHeading': 'Tools ({{n}})',
  'team.useTierDefault': '— No model selected —',
  'team.modelHint':
    'The system never assigns a model on its own. Pick the primary model here; if left empty, the agent uses its tier route (when one exists).',
  'team.tierHint': 'The tier decides which tier route is used when the agent has no primary model.',
  'team.fallbackHeading': 'Fallback models ({{n}})',
  'team.fallbackHint':
    'When the primary model fails, these are tried in order, then routes of higher tiers.',
  'team.fallbackEmpty': 'No fallback models yet.',
  'team.fallbackAddPlaceholder': 'Pick a model to add as fallback',
  'team.fallbackAdd': 'Add',
  'team.fallbackRemoveTitle': 'Remove this model from the fallback list',
  'team.fallbackUp': 'Up',
  'team.fallbackDown': 'Down',
  'team.fallbackMax': 'At most 5 fallback models.',
  'team.noPrimaryModel':
    'This agent has no primary model yet; runs will report a configuration error until you pick one in Settings.',
  'team.toolNote':
    'Tools that write to external channels (publishing posts, sending email, running ads) are all marked “needs approval”: the agent only drafts, a human approves on the “Tasks” screen, and only then does it execute.',

  'team.permissionMatrix': 'Knowledge permission matrix',
  'team.category': 'Category',
  'team.read': 'Read',
  'team.write': 'Write',
  'team.matrixHint':
    'Read permission is filtered BEFORE search ranking: an agent without permission receives no knowledge snippet from that category.',
} as const
