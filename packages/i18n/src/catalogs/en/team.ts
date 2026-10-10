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
  'team.useTierDefault': '— Use the tier default model —',
  'team.modelHint':
    'A model without tool-call support is automatically switched by the router to another model in the same tier.',
  'team.tierHint': 'The tier decides the fallback model when an agent has no fixed model.',
  'team.toolNote':
    'Tools that write to external channels (publishing posts, sending email, running ads) are all marked “needs approval”: the agent only drafts, a human approves on the “Tasks” screen, and only then does it execute.',

  'team.permissionMatrix': 'Knowledge permission matrix',
  'team.category': 'Category',
  'team.read': 'Read',
  'team.write': 'Write',
  'team.matrixHint':
    'Read permission is filtered BEFORE search ranking: an agent without permission receives no knowledge snippet from that category.',
} as const
