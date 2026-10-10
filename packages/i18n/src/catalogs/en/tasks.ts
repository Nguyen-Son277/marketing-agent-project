/**
 * Namespace `tasks` cho catalog tiếng Anh.
 *
 * Tách riêng một file cho mỗi màn hình vì lý do phối hợp: nhiều người cùng bổ sung
 * chuỗi dịch, và nếu tất cả sửa chung một file thì mỗi lần gộp là một lần xung đột.
 * Một file một màn hình làm cho phạm vi sửa của mỗi người là rời nhau.
 *
 * Khoá trong file này PHẢI có tiền tố `tasks.` để không đụng namespace khác.
 */
export const en_tasks = {
  /* --------------------------------------------------------- screen frame */
  'tasks.subtitle': 'Each column is a status. Click a card to see details and approve right here.',
  'tasks.loadingList': 'Loading tasks…',
  'tasks.loadingDetail': 'Loading details…',
  'tasks.empty':
    'No tasks yet. Open “Chat with the Leader”, describe a goal, then let the Leader plan and assign the work.',
  'tasks.unassigned': 'Unassigned',
  'tasks.revisionCount': 'Revised {{count}} times',

  /* ------------------------------------------------------------- priority */
  'tasks.priorityHighest': 'Priority {{priority}} · highest',
  'tasks.priorityHigh': 'Priority {{priority}} · high',
  'tasks.priorityMedium': 'Priority {{priority}} · medium',
  'tasks.priorityLow': 'Priority {{priority}} · low',

  /* -------------------------------------------------------- task details */
  'tasks.detailTitle': 'Task details: {{title}}',
  'tasks.detailTitlePlain': 'Task details',
  'tasks.metaCreatedUpdated': 'Created {{created}} · Updated {{updated}}',
  'tasks.metaDeadlineSuffix': ' · Due {{deadline}}',
  'tasks.result': 'Result',
  'tasks.dependsOn': 'Depends on',
  'tasks.blocks': 'Waiting on this task',
  'tasks.artifacts': 'Artifact ({{count}})',
  'tasks.agentMessages': 'Agent messages ({{count}})',
  'tasks.timeline': 'Event timeline',
  'tasks.approval': 'Approval',

  /* -------------------------------------------------------- empty states */
  'tasks.noBrief': 'No brief yet.',
  'tasks.deliverable': 'Deliverable: {{spec}}',
  'tasks.noResult': 'The agent has not submitted a result for this task yet.',
  'tasks.noDependencies': 'No dependencies.',
  'tasks.noBlocks': 'Blocks nothing.',
  'tasks.noArtifacts': 'No artifacts created yet.',
  'tasks.filePath': 'File: {{path}}',
  'tasks.noAttachment': 'No attached content.',
  'tasks.noAgentMessages': 'The agents have not exchanged anything about this task yet.',
  'tasks.noEvents': 'No events recorded yet.',

  /* ------------------------------------------------------------- approval */
  'tasks.noteHint':
    'The note is optional, but strongly recommended when requesting changes so the agent knows what to fix.',
  'tasks.notePlaceholder': 'e.g. the budget section does not match the agreed KPI.',
  'tasks.approve': 'Approve',
  'tasks.requestChanges': 'Request changes',
  'tasks.cancelTask': 'Cancel task',
  'tasks.decisionApproved': 'Approved task “{{title}}”.',
  'tasks.decisionChangesRequested': 'Requested changes to task “{{title}}”.',
  'tasks.decisionCancelled': 'Cancelled task “{{title}}”.',
  'tasks.terminalNotice': 'This task is “{{status}}”, so no review actions remain.',
  'tasks.errorReview': 'Could not submit the review decision.',
} as const
