/**
 * Namespace `diagram` cho catalog tiếng Anh.
 *
 * Tách riêng một file cho mỗi màn hình vì lý do phối hợp: nhiều người cùng bổ sung
 * chuỗi dịch, và nếu tất cả sửa chung một file thì mỗi lần gộp là một lần xung đột.
 * Một file một màn hình làm cho phạm vi sửa của mỗi người là rời nhau.
 *
 * Khoá trong file này PHẢI có tiền tố `diagram.` để không đụng namespace khác.
 */
export const en_diagram = {
  /* ----------------------------------------------------------- page */
  'diagram.title': 'Agent team diagram',
  'diagram.subtitle':
    '{{enabled}}/{{total}} agents enabled. The diagram reads live company configuration — change it on the Team screen and the diagram follows.',
  'diagram.loading': 'Loading the agent team diagram…',
  'diagram.loadFailed': 'Could not load the agent team diagram.',
  'diagram.tab.team': 'Agent team',
  'diagram.tab.flow': 'Workflow',

  /* ------------------------------------------------------ structure */
  'diagram.structure.title': 'Team structure',
  'diagram.structure.subtitle': 'Each agent can only read the knowledge categories granted below.',

  /* ---------------------------------------------------- permissions */
  'diagram.permissions.title': 'Knowledge permissions',
  'diagram.permissions.subtitle':
    'An empty cell means the agent CANNOT retrieve content from that category. The retriever filters by permission before ranking, so nothing slips through.',
  'diagram.permissions.write': 'write',
  'diagram.permissions.read': 'read',
  'diagram.permissions.none': '–',

  /* ----------------------------------------------------------- flow */
  'diagram.flow.title': 'What steps a request goes through',
  'diagram.flow.subtitle': 'This is the real path of the system, not a theoretical description.',

  /* ---------------------------------------------------- relationships */
  'diagram.edges.title': 'Team relationships',
  'diagram.edges.subtitle':
    'The Leader delegates down to specialists; specialists hand results back; peer questions are limited to 3 rounds.',
  'diagram.edges.from': 'From',
  'diagram.edges.to': 'To',
  'diagram.edges.kind': 'Relationship',
  'diagram.edges.delegates': 'Delegates',
  'diagram.edges.handsOff': 'Hands off results',
  'diagram.edges.peer': 'Peer question',

  /* ------------------------------------------------------ agent node */
  'diagram.agent.disabled': 'off',
  'diagram.agent.leaderMark': '🎯',
  'diagram.agent.model': 'Model: {{model}} · tier {{tier}}',
  'diagram.agent.modelUnassigned': 'unassigned',
  'diagram.agent.skills': 'Skills: {{count}}',
  'diagram.agent.noSkills': '⚠️ No skills yet',
  'diagram.agent.tools': 'Tools: {{count}}',
  'diagram.agent.noKnowledge': '⚠️ Cannot read any knowledge category',

  /* ----------------------------------------------------------- layers */
  'diagram.layer.leader.label': 'Leadership layer',
  'diagram.layer.leader.description': 'Your single point of contact; splits work, reviews, reports.',
  'diagram.layer.research.label': 'Research & strategy layer',
  'diagram.layer.research.description': 'Produces the underlying data before any content work.',
  'diagram.layer.content.label': 'Content & creative layer',
  'diagram.layer.content.description': 'Turns strategy into content and visual specifications.',
  'diagram.layer.channel.label': 'Channel & execution layer',
  'diagram.layer.channel.description': 'Publishes content to channels and runs ads.',
  'diagram.layer.measure.label': 'Measurement & care layer',
  'diagram.layer.measure.description': 'Measures results and keeps customer relationships.',

  /* ------------------------------------------------------------ roles */
  'diagram.role.marketingLeader': 'Head of Marketing',
  'diagram.role.marketResearch': 'Market research',
  'diagram.role.contentWriter': 'Content writer',
  'diagram.role.seoTechnical': 'Technical SEO',
  'diagram.role.socialMedia': 'Social Media',
  'diagram.role.paidMedia': 'Paid media',
  'diagram.role.emailCrm': 'Email & CRM',
  'diagram.role.designVideo': 'Design & Video',
  'diagram.role.analytics': 'Analytics & Reporting',
  'diagram.role.communityCare': 'Community care',
} as const
