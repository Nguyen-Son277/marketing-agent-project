import { en_workforce } from './en/workforce.ts'
import { en_admin } from './en/admin.ts'
import { en_clarify } from './en/clarify.ts'
import { en_companies } from './en/companies.ts'
import { en_errors } from './en/errors.ts'
/**
 * English catalog.
 *
 * `satisfies Catalog` is the guardrail: every key in `vi.ts` must appear here with a
 * non-empty string, or TypeScript fails the build. That is what makes "missing
 * translation" a compile error instead of a string that silently falls back to
 * Vietnamese at runtime.
 *
 * Translation choices worth knowing:
 *  - "Agent" and "Leader" stay untranslated: they are the product's role names, and
 *    the team roster treats them as proper nouns.
 *  - "Brief" stays as-is: it is the domain term for the six-field task definition.
 *  - "Knowledge base" is used for `kho kiến thức` rather than "warehouse", which
 *    would read as literal storage.
 *  - Imperatives are kept short ("Save", "Retry") because they sit in buttons.
 */
import type { Catalog } from './vi.ts'
import { en_chat } from './en/chat.ts'
import { en_tasks } from './en/tasks.ts'
import { en_team } from './en/team.ts'
import { en_knowledge } from './en/knowledge.ts'
import { en_settings } from './en/settings.ts'
import { en_costs } from './en/costs.ts'
import { en_diagram } from './en/diagram.ts'

import { en_notifications } from './en/notifications.ts'
import { en_socialBrowser } from './en/social-browser.ts'
import { en_campaign } from './en/campaign.ts'
import { en_office } from './en/office.ts'

export const en = {
  ...en_office,
  'nav.wordpress': 'WordPress',

  ...en_socialBrowser,
  ...en_notifications,
  /* ------------------------------------------------------------- general */
  'common.showSecret': 'Show',
  'common.hideSecret': 'Hide',
  'common.showPassword': 'Show password',
  'common.hidePassword': 'Hide password',
  'common.loading': 'Loading…',
  'common.loadingData': 'Loading data…',
  'common.retry': 'Retry',
  'common.save': 'Save',
  'common.saved': 'Saved',
  'common.cancel': 'Cancel',
  'common.close': 'Close',
  'common.edit': 'Edit',
  'common.create': 'Create',
  'common.delete': 'Delete',
  'common.refresh': 'Refresh',
  'common.confirm': 'Confirm',
  'common.search': 'Search',
  'common.none': 'None',
  'common.unknown': 'Unknown',
  'common.yes': 'Yes',
  'common.no': 'No',
  'common.all': 'All',
  'common.actions': 'Actions',
  'common.status': 'Status',
  'common.createdAt': 'Created',
  'common.updatedAt': 'Updated',
  'common.name': 'Name',
  'common.description': 'Description',
  'common.optional': 'optional',
  'common.required': 'required',
  'common.copied': 'Copied',
  'common.cannotConnectServer': 'Could not reach the server.',
  'common.serverReturnedError': 'Server returned an error: {{message}}',
  'common.emptySection': 'No data yet.',
  'common.unexpectedError': 'Something went wrong.',
  'common.sessionChecking': 'Checking your session…',

  /* ---------------------------------------------------------- navigation */
  'nav.brand': 'Marketing Agent Team',
  'nav.group.work': 'Work',
  'nav.group.config': 'Configuration',
  'nav.group.monitor': 'Monitoring',
  'nav.dashboard': 'Dashboard',
  'nav.chat': 'Chat with the Leader',
  'nav.tasks': 'Tasks',
  'nav.workforce': 'Employee assignments',
  'nav.dailyReports': 'Daily work reports',
  'nav.label': 'Main navigation',
  'nav.collapse': 'Collapse navigation bar',
  'nav.expand': 'Expand navigation bar',
  'nav.team': 'Agent team',
  'nav.knowledge': 'Knowledge base',
  'nav.settings': 'Settings',
  'nav.costs': 'Costs',
  'nav.diagram': 'Agent team diagram',
  'nav.signOut': 'Sign out',
  'nav.userMenu': 'Account menu',
  'nav.switchCompany': 'Switch company',

  /* -------------------------------------------------------------- locale */
  'locale.label': 'Language',
  'locale.switchTo': 'Switch to {{name}}',
  'locale.current': 'Currently {{name}}',

  /* ------------------------------------------------------------- theme */
  'theme.label': 'Appearance',
  'theme.light': 'Light',
  'theme.dark': 'Dark',
  'theme.switchTo': 'Switch to {{name}} mode',
  'theme.current': 'Using {{name}} mode',

  /* --------------------------------------------------------- task status */
  'taskStatus.draft': 'Draft',
  'taskStatus.assigned': 'Assigned',
  'taskStatus.in_progress': 'Running',
  'taskStatus.blocked': 'Blocked',
  'taskStatus.review': 'In review',
  'taskStatus.done': 'Done',
  'taskStatus.failed': 'Failed',
  'taskStatus.cancelled': 'Cancelled',

  /* ---------------------------------------------------- conversation phase */
  'phase.intake': 'Intake',
  'phase.clarify': 'Clarifying',
  'phase.brief': 'Brief agreed',
  'phase.plan': 'Planning',
  'phase.assign': 'Assigning',
  'phase.execute': 'Executing',
  'phase.review': 'Reviewing',
  'phase.report': 'Report ready',
  'phase.closed': 'Closed',

  /* ------------------------------------------------------ knowledge category */
  'kbCategory.00-cong-ty': 'Company & products',
  'kbCategory.10-brand': 'Brand & voice',
  'kbCategory.20-thi-truong': 'Market & competitors',
  'kbCategory.30-kenh': 'Channels & playbooks',
  'kbCategory.40-du-lieu': 'Data & performance',
  'kbCategory.90-ket-qua': 'Results & assets',

  /* ----------------------------------------------------------- model tier */
  'modelTier.light': 'Light',
  'modelTier.standard': 'Standard',
  'modelTier.deep': 'Deep reasoning',

  /* ---------------------------------------------------------------- auth */
  'auth.title': 'Marketing Agent Team',
  'auth.subtitle':
    'Every company gets its own workspace, knowledge base, and team of agents coordinated by a Leader.',
  'auth.email': 'Email',
  'auth.password': 'Password',
  'auth.displayName': 'Display name',
  'auth.passwordHint': 'At least 10 characters.',
  'auth.login': 'Sign in',
  'auth.register': 'Create account',
  'auth.toRegister': 'No account yet?',
  'auth.toLogin': 'Already have an account?',
  'auth.needCredentials': 'Enter your email and password.',
  'auth.passwordTooShort': 'Password must be at least 10 characters.',
  'auth.emailPlaceholder': 'you@company.com',
  'auth.namePlaceholder': 'Jane Doe',
  'auth.defaultUserName': 'User',

  /* ------------------------------------------------------------- company */
  'company.chooseTitle': 'Choose a company',
  'company.chooseSubtitle':
    'Each company is a separate workspace: its own knowledge base, agent team, and work history.',
  'company.yours': 'Your companies',
  'company.role': 'role {{role}}',
  'company.createTitle': 'Create a company',
  'company.createHint': 'A team of 10 agents and a six-category knowledge base are created with it.',
  'company.name': 'Company name',
  'company.namePlaceholder': 'Acme Retail Ltd',
  'company.createAndStart': 'Create company and start',
  'company.needName': 'Enter a company name.',
  'company.systemNotReady':
    'The system is not ready: {{problem}}. An administrator must run pnpm db:seed on the server.',

  /* ----------------------------------------------------------- dashboard */
  'dashboard.title': 'Dashboard',
  'dashboard.subtitle': 'Agent team and task status for {{company}}.',
  'dashboard.tasksByStatus': 'Tasks by status',
  'dashboard.tasksHint': 'Draft, assigned, running, blocked, in review',
  'dashboard.openTasks': 'Open tasks',
  'dashboard.doneTasks': 'Completed',
  'dashboard.needAttention': 'still need attention',
  'dashboard.throughReview': 'Past review',
  'dashboard.agentsEnabled': 'Agents enabled',
  'dashboard.agentsReady': 'Ready for work',
  'dashboard.noAgents': 'No agents can run',
  'dashboard.documents': 'Documents',
  'dashboard.inKnowledgeBase': 'In the knowledge base',
  'dashboard.conversations': 'Conversations',
  'dashboard.withLeader': 'With the Leader',
  'dashboard.costToday': 'Cost today',
  'dashboard.noDailyLimit': 'No daily cost limit set',
  'dashboard.recentActivity': 'Recent activity',
  'dashboard.recentHint': 'Newest events in this company, most recent first.',
  'dashboard.quickActions': 'Quick actions',
  'dashboard.quickHint': 'Shortcuts to the two most common tasks.',
  'dashboard.openChat': 'Chat with the Leader',
  'dashboard.viewTasks': 'View tasks',
  'dashboard.viewTasksHint': 'Press “View tasks” to open the full kanban board.',
  'dashboard.finishSetup': 'Open “Settings” to finish configuration before using this screen.',
  'dashboard.costLimits': 'Daily cost cap: {{limit}} · last 30 days: {{last30}}',
  'dashboard.costUsedPercent': '{{percent}}% of the daily cap used',
  'dashboard.costCapReached': 'The daily cost cap was reached. New runs stop until the cap is raised in “Settings”.',
  'dashboard.noActivity': 'No activity yet. Start with a conversation with the Leader.',
  'dashboard.systemNotReadyTitle': 'System is not ready:',

  /* ------------------------------------------- per-screen namespaces */
  ...en_workforce,
  ...en_admin,
  ...en_errors,
  ...en_companies,
  ...en_clarify,
  ...en_chat,
  ...en_tasks,
  ...en_team,
  ...en_knowledge,
  ...en_settings,
  ...en_costs,
  ...en_diagram,
  ...en_campaign,
} as const satisfies Catalog
