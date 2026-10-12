/**
 * Namespace `chat` cho catalog tiếng Anh.
 *
 * Tách riêng một file cho mỗi màn hình vì lý do phối hợp: nhiều người cùng bổ sung
 * chuỗi dịch, và nếu tất cả sửa chung một file thì mỗi lần gộp là một lần xung đột.
 * Một file một màn hình làm cho phạm vi sửa của mỗi người là rời nhau.
 *
 * Khoá trong file này PHẢI có tiền tố `chat.` để không đụng namespace khác.
 */
export const en_chat = {
  /* -------------------------------------------------------- screen frame */
  'chat.loadingList': 'Loading conversations…',
  'chat.conversations': 'Conversations',
  'chat.newConversation': 'Start a new conversation',
  'chat.newConversationTitle': 'New conversation',
  // The conversation list now opens on demand, so it has its own open and close buttons.
  'chat.listConversations': 'Conversation list',
  'chat.closeList': 'Close list',
  // This line must name the button that actually exists. It used to say "Press +", but the "+"
  // button was replaced by "Start a new conversation" — pointing at something that is not there
  // sends people looking for a control that does not exist.
  'chat.emptyList': 'No conversations yet. Press "Start a new conversation" to begin.',
  'chat.listMeta': '{{phase}} · {{date}}',
  'chat.chooseConversation': 'Choose or start a conversation to begin.',
  'chat.emptyChat':
    'Describe your marketing goal. The Leader keeps asking until there is enough information to plan.',
  'chat.metaLine': 'Phase {{phase}} · cost {{cost}} · {{runs}} runs',
  'chat.authorYou': 'You',
  'chat.authorSystem': 'System',
  'chat.placeholder': 'e.g. Plan November content for Sapa POS, target 50 leads',
  'chat.send': 'Send',

  /* ------------------------------------ the three irreversible actions */
  'chat.plan': 'Plan',
  'chat.planHint': 'The Leader splits the agreed brief into tasks',
  'chat.run': 'Run plan',
  'chat.runNeedsPlan': 'Plan first',
  'chat.runHint': 'Specialist agents start working',
  'chat.report': 'Write report',
  'chat.reportHint': 'Compile the final report',

  /* ------------------------------------------------------- brief status */
  'chat.briefMissingPrefix': 'The Leader needs more information before planning. Still missing:',
  'chat.briefMissingSuffix': '. Answer the Leader’s questions in the box below.',
  'chat.briefMissingUnknown': 'not determined',
  'chat.briefCompleteHint': 'Enough information to plan. Press “Plan” above.',
  'chat.leaderNeedsMore': 'The Leader needs: {{fields}}',
  'chat.briefField.objective': 'Objective',
  'chat.briefField.kpi': 'KPI',
  'chat.briefField.scope': 'Scope',
  'chat.briefField.deadline': 'Deadline',
  'chat.briefField.budget': 'Budget',
  'chat.briefField.constraints': 'Constraints',

  /* ---------------------------------------------------------- plan table */
  'chat.planTitle': 'Plan',
  'chat.planSubtitle': 'Open the Tasks tab to see each task in detail.',
  'chat.tableTask': 'Task',
  'chat.tableSpecialist': 'Specialist',
  'chat.tableDependsOn': 'Depends on',

  /* ------------------------------------------------------ action results */
  'chat.planCreated': 'Planned {{count}} tasks. Press “Run plan” so the team can start.',
  'chat.runFinished': 'The team finished the plan. Open the Tasks tab for per-task details.',
  'chat.reportCreated': 'Report created (artifact {{artifactId}}).',

  /* --------------------------------------------------------------- errors */
  'chat.errorLoadList': 'Could not load conversations.',
  'chat.errorLoadConversation': 'Could not load the conversation.',
  'chat.errorCreateConversation': 'Could not create the conversation.',
  'chat.errorSendMessage': 'Could not send the message.',
  'chat.errorStep': 'Could not run this step.',

  /* ------------------------------------------------------ SSE event log */
  'chat.event.leaderThinking': '🎯 Leader is analyzing the request…',
  'chat.event.leaderReplied': '🎯 Leader replied.',
  'chat.event.planCreated': '🗂️ Created a plan with {{count}} tasks.',
  'chat.event.agentStarted': '▶️ {{role}} started: {{title}}',
  'chat.event.toolCalled': '🔧 {{role}} called {{tool}}',
  'chat.event.toolCalledFailed': '🔧 {{role}} called {{tool}} (error)',
  'chat.event.taskUpdated': '📌 {{title}} → {{status}}',
  'chat.event.taskUpdatedReason': '📌 {{title}} → {{status}}: {{reason}}',
  'chat.event.artifactCreated': '📄 New artifact available.',
  'chat.event.agentMessage': '💬 {{from}} → {{to}} ({{kind}})',
  'chat.event.reviewPassed': '🔍 Quality review: passed',
  'chat.event.reviewNeedsFix': '🔍 Quality review: needs changes',
  'chat.event.reportCreated': '📊 The final report is ready.',
  'chat.event.briefComplete': '✅ The brief now has all required fields.',
  'chat.event.briefIncomplete': '❓ The brief still needs more information.',
  'chat.event.warning': '⚠️ {{message}}',
  'chat.event.systemWarning': 'The system raised a warning.',

  /* --------------------------------------------------- option picker */
  'chat.scrollToLatest': 'Jump to latest',
  'chat.exclusiveTag': "won't do",
  'chat.questionCount': 'Questions: {{count}}',
  'chat.sendAnswers': 'Send answers',
  'chat.skipAnswers': 'Skip, I will answer in my own words',
  'chat.skipAnswersMessage': "I'll answer in my own words.",
  'chat.answersSent': 'You answered this question.',
  'chat.answersRequired': 'Pick at least one option or write your own note to send.',
} as const
